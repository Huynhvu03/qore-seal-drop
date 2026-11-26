/**
 * CLI helper to generate ML-KEM-1024 + X25519 keys, sign an ML-DSA-87 RecipientCard,
 * and broadcast /qorechain.pqc.v1.MsgRegisterKEMKey on QoreChain Testnet (qorechain-diana).
 *
 * Usage:
 *   QORE_MNEMONIC="word1 word2 ..." npx tsx scripts/register-kem-cli.ts
 */
import { createSigningClient } from "@qorechain/sdk";
import {
  generateSealKeys,
  buildRegisterKemKeyMessage,
  toHex,
} from "@qorechain/qoreseal";

async function main() {
  const mnemonic = process.env.QORE_MNEMONIC;
  if (!mnemonic) {
    console.error("Set QORE_MNEMONIC in your environment.");
    process.exit(1);
  }

  const keys = generateSealKeys();
  const client = await createSigningClient({ network: "testnet", mnemonic });
  const address = client.address;

  console.log("Account:", address);
  console.log("ML-KEM-1024 Public Key (1568B):", toHex(keys.mlkemPublicKey).slice(0, 64) + "...");

  const msg = buildRegisterKemKeyMessage({
    sender: address,
    mlkemPublicKey: keys.mlkemPublicKey,
  });

  const res = await client.signAndBroadcast([msg], "auto", "QoreSeal Drop: Register ML-KEM-1024 key");
  console.log("Broadcast code:", res.code, "txHash:", res.transactionHash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
