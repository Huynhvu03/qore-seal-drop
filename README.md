# QoreSeal Drop

Post-quantum encrypted messaging and confidential document drop built for QoreChain (`qorechain-diana`) using **ML-KEM-1024 (FIPS 203)**, **X25519 hybrid key agreement**, **ML-DSA-87 key binding (Recipient Cards)**, and the **on-chain KEM Key Registry** (`/qorechain.pqc.v1.MsgRegisterKEMKey`).

## Features

- **Client-Side ML-KEM-1024 + X25519 Key Generation**: Generates 1,568-byte ML-KEM-1024 encapsulation keys and 32-byte X25519 keys entirely in the browser.
- **On-Chain KEM Key Registry**: Connect QoreX wallet (`@qorechain/react`) to broadcast `/qorechain.pqc.v1.MsgRegisterKEMKey` and look up registered recipient keys via `https://api-testnet.qore.host/qorechain/pqc/v1/kem/{address}`.
- **ML-DSA-87 Key Binding (`RecipientCard`)**: Binds ML-KEM-1024 + X25519 keys to a `qor1...` account with hybrid secp256k1 + ML-DSA-87 signatures.
- **Multi-Recipient & Anonymous Envelopes**: Supports `hybrid` (ML-KEM-1024 + X25519) and `mlkem` modes, optional AAD binding, and optional zero-hint `anonymous` mode.
- **Fail-Closed Verification**: Tampered envelopes, wrong AAD, or non-recipient keys fail closed (`DECRYPTION_FAILED` / `NOT_A_RECIPIENT`).

## Kits & Libraries Used

- `@qorechain/qoreseal` (`0.1.0`) — ML-KEM-1024 + X25519 envelopes, Recipient Cards, and on-chain KEM registry client
- `@qorechain/qoresign` (`0.2.0`) — Hybrid secp256k1 + ML-DSA-87 message signing & key binding
- `@qorechain/sdk` (`0.14.0`) & `@qorechain/react` (`0.14.0`) — QoreChain testnet provider & QoreX wallet hooks
- `@qorechain/pqc` (`0.2.3`) — ML-DSA-87 cryptographic primitives

## Development & Tests

```bash
npm install
npm test
npm run build
```

## License

MIT — see [LICENSE](./LICENSE).
