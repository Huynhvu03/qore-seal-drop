/**
 * register-kem-cli-key.ts — variant of register-kem-cli.ts for accounts that
 * hold a PRIVATE_KEY + QORE_PQC_RECOVERY_CODE instead of a mnemonic (the
 * QoreSeal Drop agent account qor18tzl... was created that way).
 *
 * Generates a fresh ML-KEM-1024 + X25519 seal keypair, saves it to
 * QORESEAL_KEYS_OUT (default ./qoreseal-keys.local.json — keep it OUT of git),
 * then broadcasts /qorechain.pqc.v1.MsgRegisterKEMKey hybrid-signed
 * (secp256k1 + ML-DSA-87) and verifies the registration via the REST API.
 *
 * Env: PRIVATE_KEY, QORE_PQC_RECOVERY_CODE (e.g. tsx --env-file=<agent .env>).
 */
import { writeFileSync } from "node:fs";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  isValidRecoveryCode,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import {
  generateSealKeys,
  buildRegisterKemKeyMessage,
  toHex,
} from "@qorechain/qoreseal";

const REST = "https://api-testnet.qore.host";
const RPC = "https://rpc-testnet.qore.host";
const CHAIN_ID = "qorechain-diana";
/** Native-lane fee: hybrid transactions are large, so the gas limit is generous. */
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

function account(): UnifiedAccount {
  const key = process.env.PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Set PRIVATE_KEY as 0x followed by 64 hex characters in env");
  }
  const recoveryCode = process.env.QORE_PQC_RECOVERY_CODE?.trim();
  if (!recoveryCode || !isValidRecoveryCode(recoveryCode)) {
    throw new Error("Set a valid QORE_PQC_RECOVERY_CODE in env");
  }
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { recoveryCode });
}

async function accountSequence(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${address}`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

/** Minimal protobuf reader for MsgRegisterKEMKey { 1: sender, 2: algorithm_id, 3: public_key }. */
function decodeRegisterKemKey(buf: Uint8Array): { sender: string; algorithmId: number; publicKey: Uint8Array } {
  let pos = 0;
  const out = { sender: "", algorithmId: 0, publicKey: new Uint8Array(0) };
  const readVarint = (): number => {
    let shift = 0;
    let result = 0;
    for (;;) {
      const b = buf[pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
  };
  while (pos < buf.length) {
    const tag = readVarint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 0) {
      const v = readVarint();
      if (field === 2) out.algorithmId = v;
    } else if (wire === 2) {
      const len = readVarint();
      const bytes = buf.slice(pos, pos + len);
      pos += len;
      if (field === 1) out.sender = new TextDecoder().decode(bytes);
      if (field === 3) out.publicKey = bytes;
    } else {
      throw new Error(`Unexpected wire type ${wire}`);
    }
  }
  return out;
}

async function main() {
  const acc = account();
  console.log("Account:", acc.cosmos);

  const keys = generateSealKeys();
  const keysOut = process.env.QORESEAL_KEYS_OUT?.trim() || "./qoreseal-keys.local.json";
  writeFileSync(
    keysOut,
    JSON.stringify(
      {
        address: acc.cosmos,
        seed: toHex(keys.seed),
        mlkemPublicKey: toHex(keys.mlkemPublicKey),
        mlkemSecretKey: toHex(keys.mlkemSecretKey),
        x25519PublicKey: toHex(keys.x25519PublicKey),
        x25519SecretKey: toHex(keys.x25519SecretKey),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("Seal keys saved to:", keysOut);
  console.log("ML-KEM-1024 public key:", keys.mlkemPublicKey.length, "bytes");

  // Build the registry message with the library encoder, then recover the
  // plain object form ({ sender, algorithmId, publicKey }) the signer's
  // registry expects by parsing the protobuf fields back out and asserting
  // they match what we generated.
  const encoded = buildRegisterKemKeyMessage({ sender: acc.cosmos, mlkemPublicKey: keys.mlkemPublicKey });
  const value = decodeRegisterKemKey(encoded.value);
  if (value.sender !== acc.cosmos || value.algorithmId !== 2 || toHex(value.publicKey) !== toHex(keys.mlkemPublicKey)) {
    throw new Error("Decoded MsgRegisterKEMKey does not match the generated key");
  }
  console.log("algorithmId:", value.algorithmId);

  const { accountNumber, sequence } = await accountSequence(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: "hybrid", rest: REST });
  const transport = await StargateClient.connect(RPC);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber,
      sequence,
      fee: FEE,
      memo: "QoreSeal Drop: Register ML-KEM-1024 key",
      messages: [{ typeUrl: encoded.typeUrl, value }],
    });
    console.log("Broadcast code:", res.code, "txHash:", res.transactionHash);
    if (res.code !== 0) {
      console.error("Registration FAILED on-chain, rawLog:", res.rawLog);
      process.exit(2);
    }
    console.log("TXHASH:", res.transactionHash);
  } finally {
    transport.disconnect();
  }

  // Verify the registration is visible in the on-chain KEM registry.
  const check = await fetch(`${REST}/qorechain/pqc/v1/kem/${acc.cosmos}`);
  console.log("Registry lookup HTTP:", check.status);
  if (check.ok) {
    const body = (await check.json()) as Record<string, unknown>;
    console.log("Registry entry:", JSON.stringify(body).slice(0, 300));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
