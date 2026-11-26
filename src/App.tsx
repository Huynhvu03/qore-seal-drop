import { useState } from "react";
import {
  ConnectButton,
  PqcStatusBadge,
  QuantumSafeBadge,
  useAccount,
  useBalance,
  useTx,
} from "@qorechain/react";
import {
  CHAIN_ID,
  REST_URL,
  buildKemRegistrationTxMsg,
  createKeyPair,
  decryptMessage,
  encryptMessage,
  fromHex,
  lookupOnChainKemKey,
  recipientFromHex,
  recipientFromKeys,
  toHex,
  type KemKeyStatus,
  type SealKeyPair,
  type SealRecipient,
} from "./seal";
import type { SealMode } from "@qorechain/qoreseal";

type Tab = "keys" | "seal" | "open";

export default function App() {
  const { address, isConnected } = useAccount();
  const { data: balanceCoin } = useBalance(address, { denom: "uqor" });
  const balanceText = balanceCoin
    ? `${(Number(balanceCoin.amount) / 1_000_000).toFixed(4)} QOR`
    : undefined;
  const { send, isPending: isTxPending } = useTx();

  const [tab, setTab] = useState<Tab>("keys");

  // Local client-side ML-KEM-1024 + X25519 keys
  const [myKeys, setMyKeys] = useState<SealKeyPair | null>(null);
  const [lookupAddr, setLookupAddr] = useState("");
  const [kemStatus, setKemStatus] = useState<KemKeyStatus | null>(null);
  const [registryStatus, setRegistryStatus] = useState<string | null>(null);
  const [regTxHash, setRegTxHash] = useState<string | null>(null);

  // Encrypt (Seal) state
  const [plaintext, setPlaintext] = useState(
    "Confidential Q-Day briefing: Treasury rotation scheduled for block 10,800,000."
  );
  const [aadText, setAadText] = useState("channel:qoreseal-drop");
  const [sealMode, setSealMode] = useState<SealMode>("hybrid");
  const [anonymous, setAnonymous] = useState(false);
  const [includeSelf, setIncludeSelf] = useState(true);
  const [extraMlkemHex, setExtraMlkemHex] = useState("");
  const [extraX25519Hex, setExtraX25519Hex] = useState("");
  const [sealOutput, setSealOutput] = useState<{
    envelopeText: string;
    byteLength: number;
    entryCount: number;
    mode: SealMode;
    anonymous: boolean;
  } | null>(null);
  const [sealError, setSealError] = useState<string | null>(null);

  // Decrypt (Open) state
  const [envelopeInput, setEnvelopeInput] = useState("");
  const [openAadText, setOpenAadText] = useState("channel:qoreseal-drop");
  const [openResult, setOpenResult] = useState<{
    ok: boolean;
    plaintext?: string;
    mode?: SealMode;
    anonymous?: boolean;
    errorCode?: string;
    errorMessage?: string;
  } | null>(null);

  const handleGenerateKeys = () => {
    const { keys } = createKeyPair();
    setMyKeys(keys);
    setRegistryStatus("Generated fresh ML-KEM-1024 (1568B) + X25519 (32B) keypair client-side.");
  };

  const handleLookupKem = async (targetAddr?: string) => {
    const addr = (targetAddr ?? lookupAddr) || address || "";
    if (!addr.trim()) {
      setRegistryStatus("Enter a qor1... or 0x... address to query on-chain KEM registry.");
      return;
    }
    setRegistryStatus("Querying QoreChain testnet KEM registry...");
    try {
      const status = await lookupOnChainKemKey(addr);
      setKemStatus(status);
      setRegistryStatus(
        status.registered
          ? `On-chain ML-KEM-1024 key found (height ${status.registeredHeight ?? "?"}).`
          : "No ML-KEM-1024 key registered on-chain for this address yet."
      );
    } catch (err) {
      setRegistryStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRegisterOnChain = async () => {
    if (!address || !myKeys) {
      setRegistryStatus("Connect QoreX wallet and generate keys first.");
      return;
    }
    setRegistryStatus("Building /qorechain.pqc.v1.MsgRegisterKEMKey transaction...");
    try {
      const msg = buildKemRegistrationTxMsg(address, myKeys.mlkemPublicKey);
      const res = await send([msg], { memo: "QoreSeal Drop: Register ML-KEM-1024 key" });
      const hash = res.transactionHash ?? JSON.stringify(res);
      setRegTxHash(hash);
      setRegistryStatus("ML-KEM-1024 public key registered on QoreChain testnet!");
    } catch (err) {
      setRegistryStatus(`Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSeal = () => {
    setSealError(null);
    try {
      const recipients: SealRecipient[] = [];
      if (includeSelf) {
        if (!myKeys) throw new Error("Generate your local keys first or uncheck Include Self.");
        recipients.push(recipientFromKeys(myKeys));
      }
      if (extraMlkemHex.trim()) {
        recipients.push(recipientFromHex(extraMlkemHex, extraX25519Hex));
      }
      if (recipients.length === 0) {
        throw new Error("Add at least one recipient (self or external public key).");
      }
      const res = encryptMessage({
        plaintext,
        recipients,
        mode: sealMode,
        anonymous,
        aadText: aadText.trim() || undefined,
      });
      setSealOutput(res);
      setEnvelopeInput(res.envelopeText);
      setOpenAadText(aadText);
    } catch (err) {
      setSealError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpen = () => {
    if (!myKeys) {
      setOpenResult({
        ok: false,
        errorCode: "NO_KEYS",
        errorMessage: "Generate or load your SealKeyPair in Tab 1 first.",
      });
      return;
    }
    const res = decryptMessage({
      envelopeText: envelopeInput,
      keys: myKeys,
      aadText: openAadText.trim() || undefined,
    });
    setOpenResult(res);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="logo">QS</div>
          <div>
            <h1>QoreSeal Drop</h1>
            <p className="subtitle">
              ML-KEM-1024 (FIPS 203) + X25519 Hybrid Encrypted Messaging &amp; On-Chain Key Registry
            </p>
          </div>
        </div>
        <div className="wallet-bar">
          <PqcStatusBadge />
          <QuantumSafeBadge />
          {isConnected && balanceText && <span className="balance-pill">{balanceText}</span>}
          <ConnectButton />
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}>
          1. Keys &amp; On-Chain Registry
        </button>
        <button className={tab === "seal" ? "active" : ""} onClick={() => setTab("seal")}>
          2. Seal (Encrypt)
        </button>
        <button className={tab === "open" ? "active" : ""} onClick={() => setTab("open")}>
          3. Open (Decrypt)
        </button>
      </nav>

      {tab === "keys" && (
        <section className="grid-two">
          <div className="card">
            <h2>Client-Side ML-KEM-1024 + X25519 Keys</h2>
            <p className="muted">
              Generate post-quantum ML-KEM-1024 (1,568-byte public / 3,168-byte secret) and X25519 keys in your browser.
              Private keys never leave memory.
            </p>
            <div className="actions-row">
              <button className="primary" onClick={handleGenerateKeys}>
                Generate SealKeyPair
              </button>
              <button
                className="secondary"
                disabled={!isConnected || !myKeys || isTxPending}
                onClick={handleRegisterOnChain}
              >
                {isTxPending ? "Broadcasting..." : "Register ML-KEM-1024 On-Chain"}
              </button>
            </div>
            {myKeys && (
              <div className="kv-box">
                <div>
                  <strong>ML-KEM-1024 Public ({myKeys.mlkemPublicKey.length}B):</strong>
                  <code>{toHex(myKeys.mlkemPublicKey).slice(0, 64)}...</code>
                </div>
                <div>
                  <strong>X25519 Public ({myKeys.x25519PublicKey.length}B):</strong>
                  <code>{toHex(myKeys.x25519PublicKey)}</code>
                </div>
                <button
                  className="ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(toHex(myKeys.mlkemPublicKey));
                    setRegistryStatus("Copied full 1568B ML-KEM-1024 public key hex.");
                  }}
                >
                  Copy ML-KEM Public Hex
                </button>
              </div>
            )}
            {regTxHash && (
              <div className="status-box ok">
                <strong>Registry Tx:</strong> <code>{regTxHash}</code>
              </div>
            )}
          </div>

          <div className="card">
            <h2>On-Chain KEM Key Registry Lookup</h2>
            <p className="muted">
              Query <code>{REST_URL}/qorechain/pqc/v1/kem/&#123;address&#125;</code> on <code>{CHAIN_ID}</code>.
            </p>
            <div className="field-row">
              <input
                type="text"
                placeholder="qor1... or 0x..."
                value={lookupAddr}
                onChange={(e) => setLookupAddr(e.target.value)}
              />
              <button className="primary" onClick={() => handleLookupKem()}>
                Lookup Key
              </button>
            </div>
            {registryStatus && <div className="status-box info">{registryStatus}</div>}
            {kemStatus && (
              <div className="kv-box">
                <div>
                  <strong>Registered:</strong> {kemStatus.registered ? "YES" : "NO"}
                </div>
                {kemStatus.registered && (
                  <>
                    <div>
                      <strong>Algorithm:</strong> {kemStatus.algorithmName ?? `id=${kemStatus.algorithmId}`}
                    </div>
                    <div>
                      <strong>Height:</strong> {String(kemStatus.registeredHeight ?? "-")}
                    </div>
                    {kemStatus.publicKey && (
                      <div>
                        <strong>Public Key ({kemStatus.publicKey.length}B):</strong>
                        <code>{toHex(kemStatus.publicKey).slice(0, 64)}...</code>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "seal" && (
        <section className="grid-two">
          <div className="card">
            <h2>Encrypt Confidential Payload (Client-Side)</h2>
            <label>
              Plaintext Message / Document
              <textarea rows={5} value={plaintext} onChange={(e) => setPlaintext(e.target.value)} />
            </label>
            <label>
              Authenticated Associated Data (AAD, optional)
              <input type="text" value={aadText} onChange={(e) => setAadText(e.target.value)} />
            </label>
            <div className="options-row">
              <label className="inline">
                Mode:
                <select value={sealMode} onChange={(e) => setSealMode(e.target.value as SealMode)}>
                  <option value="hybrid">Hybrid (ML-KEM-1024 + X25519)</option>
                  <option value="mlkem">Pure ML-KEM-1024</option>
                </select>
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                Anonymous Mode (Zero Hints)
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={includeSelf}
                  onChange={(e) => setIncludeSelf(e.target.checked)}
                />
                Include My Key
              </label>
            </div>
            <label>
              Extra Recipient ML-KEM-1024 Hex (optional, 1568B)
              <input
                type="text"
                placeholder="Optional 3136 hex chars..."
                value={extraMlkemHex}
                onChange={(e) => setExtraMlkemHex(e.target.value)}
              />
            </label>
            {sealMode === "hybrid" && (
              <label>
                Extra Recipient X25519 Hex (required for hybrid extra recipient)
                <input
                  type="text"
                  placeholder="Optional 64 hex chars..."
                  value={extraX25519Hex}
                  onChange={(e) => setExtraX25519Hex(e.target.value)}
                />
              </label>
            )}
            <button className="primary" onClick={handleSeal}>
              Seal with ML-KEM-1024
            </button>
            {sealError && <div className="status-box err">{sealError}</div>}
          </div>

          <div className="card">
            <h2>Sealed Envelope Output</h2>
            {!sealOutput ? (
              <p className="muted">Click &ldquo;Seal with ML-KEM-1024&rdquo; to generate a post-quantum envelope.</p>
            ) : (
              <>
                <div className="badges">
                  <span className="pill ok">Mode: {sealOutput.mode}</span>
                  <span className="pill">{sealOutput.entryCount} recipient(s)</span>
                  <span className="pill">{sealOutput.byteLength} bytes</span>
                  {sealOutput.anonymous && <span className="pill">Anonymous (Zero Hint)</span>}
                </div>
                <textarea className="mono" rows={9} readOnly value={sealOutput.envelopeText} />
                <button className="secondary" onClick={() => setTab("open")}>
                  Send to Open / Decrypt Tab &rarr;
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {tab === "open" && (
        <section className="grid-two">
          <div className="card">
            <h2>Open Sealed Envelope</h2>
            <label>
              QoreSeal Envelope (<code>qoreseal:...</code>)
              <textarea
                className="mono"
                rows={7}
                placeholder="Paste qoreseal:... envelope here"
                value={envelopeInput}
                onChange={(e) => setEnvelopeInput(e.target.value)}
              />
            </label>
            <label>
              Expected AAD (must match sender&apos;s AAD)
              <input type="text" value={openAadText} onChange={(e) => setOpenAadText(e.target.value)} />
            </label>
            <button className="primary" onClick={handleOpen}>
              Decrypt Client-Side
            </button>
          </div>

          <div className="card">
            <h2>Decryption &amp; Integrity Status</h2>
            {!openResult ? (
              <p className="muted">Paste an envelope and click Decrypt. Tampered bytes or wrong AAD fail closed.</p>
            ) : openResult.ok ? (
              <div className="status-box ok">
                <strong>DECRYPTION VERIFIED ({openResult.mode?.toUpperCase()})</strong>
                <pre className="plaintext-box">{openResult.plaintext}</pre>
              </div>
            ) : (
              <div className="status-box err">
                <strong>FAIL-CLOSED: {openResult.errorCode}</strong>
                <p>{openResult.errorMessage}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
