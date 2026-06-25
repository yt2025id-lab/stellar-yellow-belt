import { useState, useEffect, useCallback, useRef } from "react";
import {
  isConnected,
  getAddress,
  requestAccess,
} from "@stellar/freighter-api";
import {
  Horizon,
  TransactionBuilder,
  Networks,
  Contract,
  xdr,
  Keypair,
  Operation,
  Address,
} from "stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID =
  "CAIXY7P7RF5J2TTAI6BV4IUKAFXKJPUE2VSMM5F5IRHV7ARJ73JAAGSM";
const POLL_CONTRACT_ID = ""; // diisi setelah deploy

const server = new Horizon.Server(HORIZON_URL);
const appKeypair = Keypair.random();

type TxStatus = "idle" | "pending" | "success" | "fail";

interface WalletOption {
  id: string;
  name: string;
  icon: string;
  available: boolean;
}

interface SimulateResult {
  transactionData: string;
  minResourceFee: string;
  events?: string[];
  result?: { auth: string[]; retval: string };
}

interface PollData {
  question: string;
  options: string[];
  votes: number[];
  total: number;
}

interface RpcEvent {
  type: string;
  ledger: number;
  contractId: string;
  topic: string[];
  value: string;
}

async function rpcCall(method: string, params: Record<string, unknown>) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) {
    throw new Error(`RPC ${method}: ${d.error.message ?? JSON.stringify(d.error)}`);
  }
  return d.result;
}

async function fundAccount(addr: string): Promise<boolean> {
  try {
    const r = await fetch(`https://friendbot.stellar.org?addr=${addr}`);
    const d = await r.json();
    return !!(d.successful || d.hash);
  } catch {
    return false;
  }
}

function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [walletName, setWalletName] = useState("");
  const [appFunded, setAppFunded] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [pollData, setPollData] = useState<PollData | null>(null);
  const [pollExists, setPollExists] = useState(false);
  const [pollLoading, setPollLoading] = useState(true);
  const [hasVoted, setHasVoted] = useState(false);
  const [userVotedOption, setUserVotedOption] = useState<number | null>(null);

  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [createQuestion, setCreateQuestion] = useState("Best Blockchain?");
  const [createOptions, setCreateOptions] = useState([
    "Stellar", "Solana", "Ethereum", "Polygon", "Sui", "ICP",
  ]);

  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [liveUpdated, setLiveUpdated] = useState(false);

  const lastLedgerRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const contractId = POLL_CONTRACT_ID || CONTRACT_ID;

  const fetchBalance = useCallback(async (addr: string) => {
    try {
      const acct = await server.loadAccount(addr);
      const xlm = acct.balances.find((b) => b.asset_type === "native");
      setBalance(xlm?.balance ?? "0");
    } catch {
      setBalance("0");
    }
  }, []);

  const checkPoll = useCallback(async () => {
    try {
      const contract = new Contract(contractId);
      const sim = (await rpcCall("simulateTransaction", {
        transaction: new TransactionBuilder(
          await server.loadAccount(appKeypair.publicKey()),
          { fee: "100000", networkPassphrase: Networks.TESTNET }
        )
          .addOperation(contract.call("get_question"))
          .setTimeout(300)
          .build()
          .toXDR(),
      })) as unknown as { result?: { retval: string } };

      if (sim.result?.retval) {
        const questionScVal = xdr.ScVal.fromXDR(sim.result.retval, "base64");
        const question = questionScVal.str()?.toString() ?? "";
        if (question) {
          setPollExists(true);
          await loadFullPoll();
          return;
        }
      }
    } catch {
      // poll not initialized
    }
    setPollExists(false);
    setPollLoading(false);
  }, [contractId]);

  const loadFullPoll = useCallback(async () => {
    try {
      const acct = await server.loadAccount(appKeypair.publicKey());
      const contract = new Contract(contractId);

      const simQ = (await rpcCall("simulateTransaction", {
        transaction: new TransactionBuilder(acct, {
          fee: "100000",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(contract.call("get_question"))
          .setTimeout(300)
          .build()
          .toXDR(),
      })) as unknown as { result?: { retval: string } };

      const question =
        xdr.ScVal.fromXDR(simQ.result?.retval ?? "", "base64").str()?.toString() ?? "";

      const options: string[] = [];
      const votes: number[] = [];
      let total = 0;

      for (let i = 0; i < 6; i++) {
        const simOpt = (await rpcCall("simulateTransaction", {
          transaction: new TransactionBuilder(acct, {
            fee: "100000",
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              contract.call("get_option", xdr.ScVal.scvU32(i))
            )
            .setTimeout(300)
            .build()
            .toXDR(),
        })) as unknown as { result?: { retval: string } };
        options.push(
          xdr.ScVal.fromXDR(simOpt.result?.retval ?? "", "base64").str()?.toString() ?? ""
        );

        const simV = (await rpcCall("simulateTransaction", {
          transaction: new TransactionBuilder(acct, {
            fee: "100000",
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(contract.call("get_votes", xdr.ScVal.scvU32(i)))
            .setTimeout(300)
            .build()
            .toXDR(),
        })) as unknown as { result?: { retval: string } };
        const v = xdr.ScVal.fromXDR(simV.result?.retval ?? "", "base64").u32() ?? 0;
        votes.push(v);
        total += v;
      }

      setPollData({ question, options, votes, total });
    } catch (e) {
      console.error("loadFullPoll", e);
    }
    setPollLoading(false);
  }, [contractId]);

  useEffect(() => {
    fundAccount(appKeypair.publicKey()).then((ok) => {
      if (ok) {
        setAppFunded(true);
        checkPoll();
        return;
      }
      server
        .loadAccount(appKeypair.publicKey())
        .then(() => {
          setAppFunded(true);
          checkPoll();
        })
        .catch(() => setPollLoading(false));
    });
  }, [checkPoll]);

  useEffect(() => {
    if (address) fetchBalance(address);
  }, [address, fetchBalance]);

  useEffect(() => {
    isConnected()
      .then(({ isConnected: c }) => {
        if (c) {
          getAddress().then(({ address: a }) => {
            setAddress(a);
            setWalletName("Freighter");
            fetchBalance(a);
          });
        }
      })
      .catch(() => {});
  }, [fetchBalance]);

  useEffect(() => {
    if (address && pollExists) {
      checkHasVoted(address);
    }
  }, [address, pollExists]);

  const checkHasVoted = async (addr: string) => {
    try {
      const acct = await server.loadAccount(appKeypair.publicKey());
      const contract = new Contract(contractId);
      const userScAddress = new Address(addr).toScVal();

      const sim = (await rpcCall("simulateTransaction", {
        transaction: new TransactionBuilder(acct, {
          fee: "100000",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(contract.call("has_voted", userScAddress))
          .setTimeout(300)
          .build()
          .toXDR(),
      })) as unknown as { result?: { retval: string } };

      const voted = xdr.ScVal.fromXDR(sim.result?.retval ?? "", "base64").b() ?? false;
      setHasVoted(voted);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!pollExists) return;

    intervalRef.current = setInterval(async () => {
      try {
        const ledger = (await rpcCall("getLatestLedger", {})) as unknown as {
          sequence: number;
        };
        const start = lastLedgerRef.current || ledger.sequence - 10;
        lastLedgerRef.current = ledger.sequence;

        const events = (await rpcCall("getEvents", {
          startLedger: start,
          filters: [
            {
              type: "contract",
              contractIds: [contractId],
              topics: [["*"]],
            },
          ],
          pagination: { limit: 100 },
        })) as unknown as { events: RpcEvent[] };

        let newEvents = false;
        for (const evt of events.events ?? []) {
          const firstTopic =
            typeof evt.topic?.[0] === "string" &&
            evt.topic[0].includes("vote_cast");
          if (firstTopic) {
            newEvents = true;
          }
        }

        if (newEvents) {
          await loadFullPoll();
          setLiveUpdated(true);
          setTimeout(() => setLiveUpdated(false), 2000);
        }
      } catch {
        // silent
      }
    }, 3000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pollExists, contractId, loadFullPoll]);

  // ============ WALLET ============

  const connectWallet = async (walletId: string) => {
    try {
      setError(null);
      if (walletId === "freighter") {
        const { address: addr, error: e } = await requestAccess();
        if (e || !addr) {
          setError(
            "Error 1/3 — Wallet Not Found: Please install Freighter extension."
          );
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
            setError(
              "Error 1/3 — Wallet Not Found: Please install Albedo extension."
            );
            setTxStatus("fail");
            return;
          }
          const { pubkey } = await albedo.publicKey();
          setAddress(pubkey);
          setWalletName("Albedo");
          await fetchBalance(pubkey);
        } catch {
          setError(
            "Error 2/3 — Transaction Rejected: User rejected in Albedo wallet."
          );
          setTxStatus("fail");
        }
      } else if (walletId === "xbull") {
        setError(
          "xBull support requires xBull extension. Install from xbull.app"
        );
        setTxStatus("fail");
      } else if (walletId === "rabet") {
        setError(
          "Rabet support requires Rabet extension. Install from rabet.io"
        );
        setTxStatus("fail");
      }
    } catch {
      setError(
        "Error 1/3 — Wallet Not Found: Please install wallet extension first."
      );
      setTxStatus("fail");
    }
  };

  const disconnectWallet = () => {
    setAddress(null);
    setBalance(null);
    setWalletName("");
    setHasVoted(false);
    setUserVotedOption(null);
    setTxStatus("idle");
    setTxHash(null);
    setError(null);
    setSuccessMsg(null);
  };

  // ============ CREATE POLL ============

  const createPoll = async () => {
    if (!address) return;
    setTxStatus("pending");
    setError(null);
    setSuccessMsg(null);

    try {
      const acct = await server.loadAccount(appKeypair.publicKey());
      const contract = new Contract(contractId);

      const raw = new TransactionBuilder(acct, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "init",
            xdr.ScVal.scvString(createQuestion),
            xdr.ScVal.scvString(createOptions[0]),
            xdr.ScVal.scvString(createOptions[1]),
            xdr.ScVal.scvString(createOptions[2]),
            xdr.ScVal.scvString(createOptions[3]),
            xdr.ScVal.scvString(createOptions[4]),
            xdr.ScVal.scvString(createOptions[5])
          )
        )
        .setTimeout(300)
        .build();

      const sim = (await rpcCall("simulateTransaction", {
        transaction: raw.toXDR(),
      })) as unknown as SimulateResult;

      if (!sim.transactionData) throw new Error("Simulation failed");

      const fee = (
        (parseInt(raw.fee, 10) || 0) +
        (parseInt(String(sim.minResourceFee), 10) || 0)
      ).toString();

      const sorobanData = xdr.SorobanTransactionData.fromXDR(
        sim.transactionData,
        "base64"
      );

      const fresh = await server.loadAccount(appKeypair.publicKey());
      const tx = new TransactionBuilder(fresh, {
        fee,
        networkPassphrase: Networks.TESTNET,
        sorobanData,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: contractId,
            function: "init",
            args: [
              xdr.ScVal.scvString(createQuestion),
              xdr.ScVal.scvString(createOptions[0]),
              xdr.ScVal.scvString(createOptions[1]),
              xdr.ScVal.scvString(createOptions[2]),
              xdr.ScVal.scvString(createOptions[3]),
              xdr.ScVal.scvString(createOptions[4]),
              xdr.ScVal.scvString(createOptions[5]),
            ],
          })
        )
        .setTimeout(300)
        .build();

      tx.sign(appKeypair);

      const send = (await rpcCall("sendTransaction", {
        transaction: tx.toXDR(),
      })) as unknown as { hash: string; status: string; errorResultXdr?: string };

      if (send.errorResultXdr) throw new Error(`TX failed: ${send.errorResultXdr}`);

      setTxHash(send.hash);
      setTxStatus("success");
      setSuccessMsg("Poll created! Contract emits event: poll_created");
      setShowCreatePoll(false);
      setPollExists(true);
      await loadFullPoll();
    } catch (e: unknown) {
      setTxStatus("fail");
      setError(`Error: ${(e as Error).message || "Create poll failed"}`);
    }
  };

  // ============ VOTE ============

  const castVote = async (optionId: number) => {
    if (!address || hasVoted) return;
    setSelectedOption(optionId);
    setTxStatus("pending");
    setError(null);
    setSuccessMsg(null);
    setTxHash(null);

    try {
      const acct = await server.loadAccount(appKeypair.publicKey());
      const contract = new Contract(contractId);
      const voterScAddress = new Address(address).toScVal();

      const raw = new TransactionBuilder(acct, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "cast_vote",
            voterScAddress,
            xdr.ScVal.scvU32(optionId)
          )
        )
        .setTimeout(300)
        .build();

      const sim = (await rpcCall("simulateTransaction", {
        transaction: raw.toXDR(),
      })) as unknown as SimulateResult;

      if (!sim.transactionData) throw new Error("Simulation failed");

      const authXdr: xdr.SorobanAuthorizationEntry[] = [];
      if (sim.result?.auth) {
        for (const a of sim.result.auth) {
          authXdr.push(xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
        }
      }

      const fee = (
        (parseInt(raw.fee, 10) || 0) +
        (parseInt(String(sim.minResourceFee), 10) || 0)
      ).toString();

      const sorobanData = xdr.SorobanTransactionData.fromXDR(
        sim.transactionData,
        "base64"
      );

      const fresh = await server.loadAccount(appKeypair.publicKey());
      const tx = new TransactionBuilder(fresh, {
        fee,
        networkPassphrase: Networks.TESTNET,
        sorobanData,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: contractId,
            function: "cast_vote",
            args: [voterScAddress, xdr.ScVal.scvU32(optionId)],
            auth: authXdr.length > 0 ? authXdr : undefined,
          })
        )
        .setTimeout(300)
        .build();

      tx.sign(appKeypair);

      const send = (await rpcCall("sendTransaction", {
        transaction: tx.toXDR(),
      })) as unknown as { hash: string; status: string; errorResultXdr?: string };

      if (send.errorResultXdr) throw new Error(`TX failed: ${send.errorResultXdr}`);

      setTxHash(send.hash);
      setTxStatus("success");
      setSuccessMsg(`Vote recorded for "${pollData?.options[optionId]}"!`);
      setHasVoted(true);
      setUserVotedOption(optionId);
      await loadFullPoll();
      await fetchBalance(address);
    } catch (e: unknown) {
      setTxStatus("fail");
      const msg = (e as Error).message || "";
      if (msg.includes("Already voted")) {
        setError(
          "Error 3/3 — Already Voted: You have already voted in this poll."
        );
      } else {
        setError(`Error: ${msg || "Vote failed"}`);
      }
    }
  };

  // ============ RENDER ============

  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  const wallets: WalletOption[] = [
    { id: "freighter", name: "Freighter", icon: "🦊", available: true },
    { id: "albedo", name: "Albedo", icon: "🌐", available: true },
    { id: "xbull", name: "xBull", icon: "🐂", available: false },
    { id: "rabet", name: "Rabet", icon: "🚀", available: false },
  ];

  const BAR_COLORS = [
    "#7c3aed", "#06b6d4", "#f59e0b", "#ef4444", "#10b981", "#ec4899",
  ];

  return (
    <div className="container">
      <header className="header">
        <div className="logo">
          <img src="/logoStellar.png" alt="Stellar" className="logo-img" />
          <h1>Live Poll dApp</h1>
        </div>
        <p className="subtitle">
          Yellow Belt &mdash; Stellar Journey to Mastery
        </p>

        {address ? (
          <div className="wallet-bar">
            <span className="badge">{walletName}</span>
            <span className="address">{formatAddr(address)}</span>
            <span className="badge-balance">
              {balance
                ? `${parseFloat(balance).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })} XLM`
                : "..."}
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
                  className={`btn ${
                    w.id === "freighter" ? "btn-primary" : "btn-wallet"
                  } ${!w.available ? "btn-disabled" : ""}`}
                  onClick={() => connectWallet(w.id)}
                  disabled={!w.available}
                >
                  <span className="btn-text">
                    {w.icon} {w.name}
                  </span>
                </button>
              ))}
            </div>
            <p className="wallet-hint">Connect wallet to vote (Freighter recommended)</p>
          </>
        )}
      </header>

      <main className="main">
        {pollLoading && (
          <div className="center-card">
            <div className="loader" />
            <p>Loading poll data...</p>
          </div>
        )}

        {!pollLoading && !pollExists && !showCreatePoll && (
          <section className="card">
            <h2 className="card-title">No Active Poll</h2>
            <p className="card-desc">
              Create a new poll to get started. You&apos;ll be the first voter!
            </p>
            {address ? (
              <button
                className="btn btn-primary btn-full"
                onClick={() => setShowCreatePoll(true)}
              >
                <span className="btn-text">+ Create Poll</span>
              </button>
            ) : (
              <p className="info-hint">Connect wallet first to create a poll.</p>
            )}
          </section>
        )}

        {showCreatePoll && (
          <section className="card">
            <h2 className="card-title">Create New Poll</h2>
            <div className="form-group floating">
              <label>
                <input
                  className="input"
                  placeholder=" "
                  value={createQuestion}
                  onChange={(e) => setCreateQuestion(e.target.value)}
                />
                <span>Poll Question</span>
              </label>
            </div>
            {createOptions.map((opt, i) => (
              <div className="form-group floating" key={i}>
                <label>
                  <input
                    className="input"
                    placeholder=" "
                    value={opt}
                    onChange={(e) => {
                      const next = [...createOptions];
                      next[i] = e.target.value;
                      setCreateOptions(next);
                    }}
                  />
                  <span>Option {i + 1}</span>
                </label>
              </div>
            ))}
            <div className="btn-row">
              <button
                className="btn btn-outline"
                onClick={() => setShowCreatePoll(false)}
              >
                <span className="btn-text">Cancel</span>
              </button>
              <button
                className="btn btn-primary"
                onClick={createPoll}
                disabled={txStatus === "pending" || !appFunded}
              >
                <span className="btn-text">
                  {!appFunded ? "Funding..." : txStatus === "pending" ? "Creating..." : "Create Poll"}
                </span>
              </button>
            </div>
          </section>
        )}

        {!pollLoading && pollExists && pollData && (
          <section className="card poll-card">
            <div className="poll-header">
              <h2 className="card-title">{pollData.question}</h2>
              <div className="live-indicator">
                <span className={`pulse-dot ${liveUpdated ? "pulse" : ""}`} />
                <span className="live-text">
                  {liveUpdated ? "Updated!" : "Live"}
                </span>
              </div>
            </div>

            <div className="options-list">
              {pollData.options.map((opt, i) => {
                const pct =
                  pollData.total > 0
                    ? Math.round((pollData.votes[i] / pollData.total) * 100)
                    : 0;
                return (
                  <button
                    key={i}
                    className={`option-bar ${
                      userVotedOption === i ? "voted" : ""
                    } ${hasVoted ? "disabled" : ""} ${
                      selectedOption === i && txStatus === "pending"
                        ? "selected"
                        : ""
                    }`}
                    onClick={() => castVote(i)}
                    disabled={hasVoted || !address || txStatus === "pending"}
                  >
                    <div className="option-bar-inner">
                      <div
                        className="option-fill"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: BAR_COLORS[i],
                        }}
                      />
                      <span className="option-label">{opt}</span>
                      <span className="option-votes">
                        {pollData.votes[i]} vote{pollData.votes[i] !== 1 ? "s" : ""} ({pct}%)
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="poll-footer">
              <span className="total-votes">
                Total: {pollData.total} vote{pollData.total !== 1 ? "s" : ""}
              </span>
              {hasVoted && (
                <span className="voted-badge">
                  You voted: {pollData.options[userVotedOption ?? 0]}
                </span>
              )}
            </div>

            {!address && (
              <p className="info-hint">Connect wallet above to vote</p>
            )}
          </section>
        )}

        {(txStatus !== "idle" || error || successMsg || txHash) && (
          <section className="card status-section">
            <h3 className="status-title">Transaction Status</h3>
            <div className="tx-status-row">
              <span className={`tx-badge ${txStatus}`}>
                {txStatus === "idle" && "Ready"}
                {txStatus === "pending" && "Pending..."}
                {txStatus === "success" && "Success"}
                {txStatus === "fail" && "Failed"}
              </span>
            </div>

            {txStatus === "success" && successMsg && (
              <div className="status-card success">
                <strong>&#10003; {successMsg}</strong>
                {txHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="explorer-link"
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

            <div className="error-types-info">
              <p className="info-hint">
                Error types handled: ① Wallet Not Found &bull; ② Transaction
                Rejected &bull; ③ Already Voted
              </p>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>
          Live Poll &bull; Yellow Belt &bull; Stellar Journey to Mastery &bull;
          June 2026
        </p>
      </footer>
    </div>
  );
}

export default App;
