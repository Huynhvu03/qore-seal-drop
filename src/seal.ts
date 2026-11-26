import {
  generateSealKeys,
  seal,
  open,
  envelopeToText,
  envelopeFromText,
  parseEnvelope,
  recipientOf,
  recipientCardFields,
  signRecipientCard,
  verifyRecipientCard,
  buildRegisterKemKeyMessage,
  isQoreSealError,
  toHex,
  fromHex,
  type SealKeyPair,
  type SealMode,
  type SealRecipient,
  type RecipientCard,
} from "@qorechain/qoreseal";
import { fetchKemKey, type KemKeyStatus } from "@qorechain/qoreseal/network";
import type { ClassicalKey, PqKeyPair } from "@qorechain/qoresign";

export const CHAIN_ID = "qorechain-diana";
export const REST_URL = "https://api-testnet.qore.host";
export const DEFAULT_PURPOSE = "qoreseal-drop-v1";

export interface SerializedSealKeys {
  seedHex: string;
  mlkemPublicKeyHex: string;
  x25519PublicKeyHex: string;
}

export function createKeyPair(): { keys: SealKeyPair; summary: SerializedSealKeys } {
  const keys = generateSealKeys();
  return {
    keys,
    summary: {
      seedHex: toHex(keys.seed),
      mlkemPublicKeyHex: toHex(keys.mlkemPublicKey),
      x25519PublicKeyHex: toHex(keys.x25519PublicKey),
    },
  };
}

export function encryptMessage(params: {
  plaintext: string;
  recipients: SealRecipient[];
  mode?: SealMode;
  anonymous?: boolean;
  aadText?: string;
  purpose?: string;
}): {
  envelopeText: string;
  byteLength: number;
  entryCount: number;
  mode: SealMode;
  anonymous: boolean;
} {
  const encoder = new TextEncoder();
  const mode = params.mode ?? "hybrid";
  const anonymous = params.anonymous ?? false;
  const envelope = seal({
    chainId: CHAIN_ID,
    purpose: params.purpose ?? DEFAULT_PURPOSE,
    recipients: params.recipients,
    plaintext: encoder.encode(params.plaintext),
    aad: params.aadText ? encoder.encode(params.aadText) : undefined,
    mode,
    anonymous,
  });
  const parsed = parseEnvelope(envelope);
  return {
    envelopeText: envelopeToText(envelope),
    byteLength: envelope.length,
    entryCount: parsed.entries.length,
    mode: parsed.mode,
    anonymous: parsed.anonymous,
  };
}

export function decryptMessage(params: {
  envelopeText: string;
  keys: SealKeyPair;
  aadText?: string;
  purpose?: string;
}): {
  ok: boolean;
  plaintext?: string;
  mode?: SealMode;
  anonymous?: boolean;
  errorCode?: string;
  errorMessage?: string;
} {
  try {
    const encoder = new TextEncoder();
    const raw = envelopeFromText(params.envelopeText.trim());
    const parsed = parseEnvelope(raw);
    const pt = open({
      chainId: CHAIN_ID,
      purpose: params.purpose ?? DEFAULT_PURPOSE,
      envelope: raw,
      keys: params.keys,
      aad: params.aadText ? encoder.encode(params.aadText) : undefined,
    });
    return {
      ok: true,
      plaintext: new TextDecoder().decode(pt),
      mode: parsed.mode,
      anonymous: parsed.anonymous,
    };
  } catch (err) {
    if (isQoreSealError(err)) {
      return { ok: false, errorCode: err.code, errorMessage: err.message };
    }
    return {
      ok: false,
      errorCode: "DECRYPTION_FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createSignedRecipientCard(params: {
  address: string;
  keys: SealKeyPair;
  classicalKey: ClassicalKey;
  pqKey: Pick<PqKeyPair, "secretKey">;
}): RecipientCard {
  return signRecipientCard({
    chainId: CHAIN_ID,
    address: params.address,
    keys: params.keys,
    classicalKey: params.classicalKey,
    pqKey: params.pqKey,
  });
}

export function verifyCardOnKeys(params: {
  card: RecipientCard;
  pqPublicKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
  expectedAddress?: string;
}): SealRecipient {
  return verifyRecipientCard({
    card: params.card,
    chainId: CHAIN_ID,
    address: params.expectedAddress,
    pqPublicKey: params.pqPublicKey,
    mlkemPublicKey: params.mlkemPublicKey,
  });
}

export async function lookupOnChainKemKey(address: string): Promise<KemKeyStatus> {
  return fetchKemKey({ rest: REST_URL, address: address.trim() });
}

export function buildKemRegistrationTxMsg(address: string, mlkemPublicKey: Uint8Array) {
  return buildRegisterKemKeyMessage({ sender: address, mlkemPublicKey });
}

export function recipientFromKeys(keys: SealKeyPair): SealRecipient {
  return recipientOf(keys);
}

export function recipientFromHex(mlkemPublicKeyHex: string, x25519PublicKeyHex?: string): SealRecipient {
  return {
    mlkemPublicKey: fromHex(mlkemPublicKeyHex.trim()),
    x25519PublicKey: x25519PublicKeyHex?.trim() ? fromHex(x25519PublicKeyHex.trim()) : undefined,
  };
}

export { recipientCardFields, toHex, fromHex, type SealKeyPair, type SealRecipient, type RecipientCard, type KemKeyStatus };
