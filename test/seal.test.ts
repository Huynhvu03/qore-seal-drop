import test from "node:test";
import assert from "node:assert/strict";
import { mldsa87 } from "@qorechain/pqc";
import { addressFromPublicKey, classicalKeyFromPrivate } from "@qorechain/qoresign";
import {
  createKeyPair,
  encryptMessage,
  decryptMessage,
  createSignedRecipientCard,
  verifyCardOnKeys,
  recipientFromKeys,
  buildKemRegistrationTxMsg,
} from "../src/seal.ts";

test("generates valid ML-KEM-1024 (1568B) and X25519 (32B) keys", () => {
  const { keys } = createKeyPair();
  assert.equal(keys.mlkemPublicKey.length, 1568);
  assert.equal(keys.mlkemSecretKey.length, 3168);
  assert.equal(keys.x25519PublicKey.length, 32);
  assert.equal(keys.x25519SecretKey.length, 32);
});

test("multi-recipient hybrid seal & open roundtrip", () => {
  const alice = createKeyPair().keys;
  const bob = createKeyPair().keys;
  const charlie = createKeyPair().keys;

  const secretText = "Confidential Q-Day audit payload #2026-11-25";
  const sealed = encryptMessage({
    plaintext: secretText,
    recipients: [recipientFromKeys(alice), recipientFromKeys(bob)],
    mode: "hybrid",
    aadText: "doc-id:42",
  });

  assert.equal(sealed.entryCount, 2);
  assert.equal(sealed.mode, "hybrid");
  assert.ok(sealed.envelopeText.startsWith("qoreseal:"));

  const openBob = decryptMessage({
    envelopeText: sealed.envelopeText,
    keys: bob,
    aadText: "doc-id:42",
  });
  assert.equal(openBob.ok, true);
  assert.equal(openBob.plaintext, secretText);

  const openCharlie = decryptMessage({
    envelopeText: sealed.envelopeText,
    keys: charlie,
    aadText: "doc-id:42",
  });
  assert.equal(openCharlie.ok, false);
  assert.equal(openCharlie.errorCode, "NOT_A_RECIPIENT");
});

test("fail-closed on wrong AAD or tampered envelope bytes", () => {
  const alice = createKeyPair().keys;
  const sealed = encryptMessage({
    plaintext: "Top secret",
    recipients: [recipientFromKeys(alice)],
    aadText: "epoch:1",
  });

  const wrongAad = decryptMessage({
    envelopeText: sealed.envelopeText,
    keys: alice,
    aadText: "epoch:2",
  });
  assert.equal(wrongAad.ok, false);
  assert.equal(wrongAad.errorCode, "DECRYPTION_FAILED");

  const mid = Math.floor(sealed.envelopeText.length / 2);
  const flipped =
    sealed.envelopeText.slice(0, mid) +
    (sealed.envelopeText[mid] === "A" ? "B" : "A") +
    sealed.envelopeText.slice(mid + 1);
  const tampered = decryptMessage({
    envelopeText: flipped,
    keys: alice,
    aadText: "epoch:1",
  });
  assert.equal(tampered.ok, false);
});

test("anonymous mode hides recipient hints and still decrypts", () => {
  const alice = createKeyPair().keys;
  const sealed = encryptMessage({
    plaintext: "Zero-hint anonymous drop",
    recipients: [recipientFromKeys(alice)],
    anonymous: true,
  });
  assert.equal(sealed.anonymous, true);

  const opened = decryptMessage({
    envelopeText: sealed.envelopeText,
    keys: alice,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.plaintext, "Zero-hint anonymous drop");
});

test("ML-DSA-87 + secp256k1 recipient card binding and tamper detection", async () => {
  const alice = createKeyPair().keys;
  const pq = mldsa87.keygen();
  const privKey = new Uint8Array(32).fill(7);
  const classicalKey = classicalKeyFromPrivate(privKey, "eth_secp256k1");
  const account = addressFromPublicKey(classicalKey.publicKey, "eth_secp256k1");
  const address = account.bech32;

  const card = createSignedRecipientCard({
    address,
    keys: alice,
    classicalKey,
    pqKey: { secretKey: pq.secretKey },
  });

  const verifiedRecipient = verifyCardOnKeys({
    card,
    pqPublicKey: pq.publicKey,
    mlkemPublicKey: alice.mlkemPublicKey,
  });
  assert.equal(verifiedRecipient.mlkemPublicKey.length, 1568);

  const tamperedCard = { ...card, x25519PublicKey: "00".repeat(32) };
  assert.throws(() =>
    verifyCardOnKeys({
      card: tamperedCard,
      pqPublicKey: pq.publicKey,
      mlkemPublicKey: alice.mlkemPublicKey,
    })
  );

  const regMsg = buildKemRegistrationTxMsg(address, alice.mlkemPublicKey);
  assert.equal(regMsg.typeUrl, "/qorechain.pqc.v1.MsgRegisterKEMKey");
});
