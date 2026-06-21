import { useState, useEffect, useCallback } from "react";
import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
} from "@stellar/freighter-api";
import {
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  Contract,
  Memo,
  xdr,
} from "stellar-sdk";
import { Server as RpcServer, assembleTransaction } from "stellar-sdk/rpc";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID =
  "CAIXY7P7RF5J2TTAI6BV4IUKAFXKJPUE2VSMM5F5IRHV7ARJ73JAAGSM";

const server = new Horizon.Server(HORIZON_URL);
const rpc = new RpcServer(RPC_URL);

type TxStatus = "idle" | "pending" | "success" | "fail";

interface WalletOption {
  id: string;
  name: string;
  icon: string;
  available: boolean;
}

function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string>("");
  const [greetingInput, setGreetingInput] = useState("Dev");
  const [contractResult, setContractResult] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async (addr: string) => {
    try {
      const acct = await server.loadAccount(addr);
      const xlm = acct.balances.find((b) => b.asset_type === "native");
      setBalance(xlm?.balance ?? "0");
    } catch {
      setBalance("0");
    }
  }, []);

  const connectWallet = async (walletId: string) => {
    try {
      setError(null);

      if (walletId === "freighter") {
        const { address: addr, error: e } = await requestAccess();
        if (e || !addr) {
          setError("Freighter connection rejected or not found. Please install Freighter extension.");
          setTxStatus("fail");
          return;
        }
        setAddress(addr);
        setWalletName("Freighter");
        await fetchBalance(addr);
      } else if (walletId === "albedo") {
        try {
          const albedo = (window as unknown as Record<string, unknown>).albedo as
            | { publicKey: () => Promise<{ pubkey: string }> }
            | undefined;
          if (!albedo) {
            setError("Albedo not found. Please install Albedo extension.");
            setTxStatus("fail");
            return;
          }
          const { pubkey } = await albedo.publicKey();
          setAddress(pubkey);
          setWalletName("Albedo");
          await fetchBalance(pubkey);
        } catch {
          setError("Albedo connection rejected by user.");
          setTxStatus("fail");
        }
      } else if (walletId === "xbull") {
        setError("xBull wallet support requires xBull extension. Install from xbull.app");
        setTxStatus("fail");
      } else if (walletId === "rabet") {
        setError("Rabet wallet support requires Rabet extension. Install from rabet.io");
        setTxStatus("fail");
      }
    } catch {
      setError("Wallet not found. Please install the wallet extension first.");
      setTxStatus("fail");
    }
  };

  const disconnectWallet = () => {
    setAddress(null);
    setBalance(null);
    setWalletName("");
    setContractResult(null);
    setTxStatus("idle");
    setTxHash(null);
    setError(null);
  };

  const callContract = async () => {
    if (!address) return;
    setTxStatus("pending");
    setError(null);
    setContractResult(null);
    setTxHash(null);

    try {
      const acct = await server.loadAccount(address);
      const contract = new Contract(CONTRACT_ID);

      const tx = new TransactionBuilder(acct, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call("hello", xdr.ScVal.scvString(greetingInput || "Dev"))
        )
        .setTimeout(300)
        .build();

      const sim = await rpc.simulateTransaction(tx);
      const assembled = assembleTransaction(tx, sim);

      const { signedTxXdr } = await signTransaction(
        assembled.toEnvelope().toXDR("base64"),
        {
          networkPassphrase: Networks.TESTNET,
          address,
        }
      );

      const result = await rpc.sendTransaction(signedTxXdr);

      if (result.status === "PENDING" || result.status === "SUCCESS") {
        setTxHash(result.hash);
        setTxStatus("success");
        setContractResult(
          `Contract hello("${greetingInput}") called successfully!`
        );
        await fetchBalance(address);
      } else {
        setTxStatus("fail");
        setError(`Transaction status: ${result.status}`);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: Record<string, unknown> } };
      setTxStatus("fail");

      const msg = err.message ?? "";

      if (msg.includes("rejected") || msg.includes("denied")) {
        setError("Error: Transaction rejected by user in wallet.");
      } else {
        setError(`Error: ${msg || "Contract call failed"}`);
      }
    }
  };

  useEffect(() => {
    if (address) fetchBalance(address);
  }, [address, fetchBalance]);

  useEffect(() => {
    isConnected().then(({ isConnected: c }) => {
      if (c) {
        getAddress().then(({ address: a }) => {
          setAddress(a);
          setWalletName("Freighter");
          fetchBalance(a);
        });
      }
    }).catch(() => {});
  }, [fetchBalance]);

  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  const wallets: WalletOption[] = [
    { id: "freighter", name: "Freighter", icon: "🦊", available: true },
    { id: "albedo", name: "Albedo", icon: "🌐", available: true },
    { id: "xbull", name: "xBull", icon: "🐂", available: false },
    { id: "rabet", name: "Rabet", icon: "🚀", available: false },
  ];

  return (
    <div className="container">
      <header className="header">
        <div className="logo">
          <img src="/logoStellar.png" alt="Stellar" className="logo-img" />
          <h1>Multi-Wallet dApp</h1>
        </div>
        <p className="subtitle">
          Yellow Belt &mdash; Stellar Journey to Mastery
        </p>

        {address ? (
          <div className="wallet-bar">
            <span className="badge">{walletName}</span>
            <span className="address">{formatAddr(address)}</span>
            <span className="badge-balance">
              {balance ? `${parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM` : "..."}
            </span>
            <button className="btn btn-outline" onClick={disconnectWallet}>
              <span className="btn-text">Disconnect</span>
            </button>
          </div>
        ) : (
          <>
            <div className="wallet-options">
              {wallets.map((w) => (
                <button
                key={w.id}
                className={`btn ${w.id === "freighter" ? "btn-primary" : "btn-wallet"} ${!w.available ? "btn-disabled" : ""}`}
                onClick={() => connectWallet(w.id)}
                disabled={!w.available}
              >
                <span className="btn-text">
                  {w.icon} {w.name}
                </span>
              </button>
              ))}
            </div>
            <p className="wallet-hint">Click a wallet to connect (Freighter recommended)</p>
          </>
        )}
      </header>

      {address && (
        <main className="main">
          <section className="card">
            <h2 className="card-title">Call Smart Contract</h2>
            <p className="card-desc">
              Interact with the deployed hello-world contract on Stellar Testnet
            </p>

            <div className="contract-info">
              <span className="label">Deployed Contract</span>
              <code>{CONTRACT_ID}</code>
            </div>

            <div className="form-group floating">
              <label>
                <input
                  className="input"
                  placeholder=" "
                  value={greetingInput}
                  onChange={(e) => setGreetingInput(e.target.value)}
                />
                <span>Your Name</span>
              </label>
            </div>

            <div className="tx-status-row">
              <span className={`tx-badge ${txStatus}`}>
                {txStatus === "idle" && "Ready"}
                {txStatus === "pending" && "Pending..."}
                {txStatus === "success" && "Success"}
                {txStatus === "fail" && "Failed"}
              </span>
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={callContract}
              disabled={txStatus === "pending"}
            >
              <span className="btn-text">
                {txStatus === "pending" ? "Processing..." : `Call hello("${greetingInput}")`}
              </span>
            </button>

            {txStatus === "success" && contractResult && (
              <div className="status-card success">
                <strong>&#10003; Transaction Successful</strong>
                <p>{contractResult}</p>
                {txHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on Stellar Expert &rarr;
                  </a>
                )}
              </div>
            )}

            {error && txStatus === "fail" && (
              <div className="status-card error">
                <strong>&#10007; {error}</strong>
              </div>
            )}
          </section>
        </main>
      )}

      <footer className="footer">
        <p>
          Yellow Belt &bull; Stellar Journey to Mastery &bull; June 2026
        </p>
      </footer>
    </div>
  );
}

export default App;
