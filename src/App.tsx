import { useState, useEffect, useCallback, useRef } from "react";
import {
  isConnected,
  getAddress,
  requestAccess,
  signTransaction,
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
  "CCSSUUVYZ5YS4HN74BKMGLEZR4S5NHBNY6JWYIBDRAJLI64RIH7KBS2W";
const POLL_CONTRACT_ID = ""; // diisi setelah deploy

const server = new Horizon.Server(HORIZON_URL);

function getAppKeypair(): Keypair {
  const stored = localStorage.getItem("livepoll_keypair");
  if (stored) return Keypair.fromSecret(stored);
  const kp = Keypair.random();
  localStorage.setItem("livepoll_keypair", kp.secret());
  return kp;
}

const appKeypair = getAppKeypair();

const ALICE_PUBKEY = "GC4ZDZ5R5EKUKF5DY4KZ5PCZDYXRST2WUG2GYHCYMOEP7MDCN5FDN5TJ";

async function simulateRead(contractId: string, method: string, args: xdr.ScVal[] = []) {
  const acct = await server.loadAccount(ALICE_PUBKEY);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(acct, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  const sim = await rpcCall("simulateTransaction", {
    transaction: tx.toXDR(),
  }) as unknown as SimulateResult;
  return sim;
}

type TxStatus = "idle" | "pending" | "success" | "fail";

interface SimulateHostFnResult {
  auth: string[];
  retval: string;
}

interface SimulateResult {
  transactionData: string;
  minResourceFee: string;
  events?: string[];
  results?: SimulateHostFnResult[];
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
  if (d.error) throw new Error(`RPC ${method}: ${d.error.message ?? JSON.stringify(d.error)}`);
  if (d.result?.error) throw new Error(String(d.result.error));
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
  const [view, setView] = useState<"landing" | "app">("landing");
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showVoting, setShowVoting] = useState(false);

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
      const sim = await simulateRead(contractId, "get_question");
      if (sim.results?.[0]?.retval) {
        const questionScVal = xdr.ScVal.fromXDR(sim.results[0].retval, "base64");
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
      const simQ = await simulateRead(contractId, "get_question");
      const question =
        xdr.ScVal.fromXDR(simQ.results?.[0]?.retval ?? "", "base64").str()?.toString() ?? "";

      const options: string[] = [];
      const votes: number[] = [];
      let total = 0;

      for (let i = 0; i < 6; i++) {
        const simOpt = await simulateRead(contractId, "get_option", [xdr.ScVal.scvU32(i)]);
        options.push(
          xdr.ScVal.fromXDR(simOpt.results?.[0]?.retval ?? "", "base64").str()?.toString() ?? ""
        );

        const simV = await simulateRead(contractId, "get_votes", [xdr.ScVal.scvU32(i)]);
        const v = xdr.ScVal.fromXDR(simV.results?.[0]?.retval ?? "", "base64").u32() ?? 0;
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
        return;
      }
      server
        .loadAccount(appKeypair.publicKey())
        .then(() => setAppFunded(true))
        .catch(() => {});
    });
    checkPoll();
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
      const userScAddress = new Address(addr).toScVal();
      const sim = await simulateRead(contractId, "has_voted", [userScAddress]);
      const voted = xdr.ScVal.fromXDR(sim.results?.[0]?.retval ?? "", "base64").b() ?? false;
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
          setError("Please install Freighter extension.");
          setTxStatus("fail");
          return;
        }
        setAddress(addr);
        setWalletName("Freighter");
        await fetchBalance(addr);
      } else if (walletId === "albedo") {
        const albedo = (window as unknown as Record<string, unknown>).albedo as
          | { publicKey: () => Promise<{ pubkey: string }> }
          | undefined;
        if (!albedo) {
          setError("Please install Albedo extension.");
          setTxStatus("fail");
          return;
        }
        try {
          const { pubkey } = await albedo.publicKey();
          setAddress(pubkey);
          setWalletName("Albedo");
          await fetchBalance(pubkey);
        } catch {
          setError("Albedo connection rejected by user.");
          setTxStatus("fail");
          return;
        }
      } else if (walletId === "xbull") {
        const xbull = (window as unknown as Record<string, unknown>).xBullSDK as
          | { getPublicKey: () => Promise<string> }
          | undefined;
        if (!xbull) {
          setError("Please install xBull extension from xbull.app");
          setTxStatus("fail");
          return;
        }
        try {
          const pubkey = await xbull.getPublicKey();
          setAddress(pubkey);
          setWalletName("xBull");
          await fetchBalance(pubkey);
        } catch {
          setError("xBull connection rejected by user.");
          setTxStatus("fail");
          return;
        }
      } else if (walletId === "rabet") {
        const rabet = (window as unknown as Record<string, unknown>).rabet as
          | { connect: () => Promise<{ publicKey: string }> }
          | undefined;
        if (!rabet) {
          setError("Please install Rabet extension from rabet.io");
          setTxStatus("fail");
          return;
        }
        try {
          const { publicKey: pk } = await rabet.connect();
          setAddress(pk);
          setWalletName("Rabet");
          await fetchBalance(pk);
        } catch {
          setError("Rabet connection rejected by user.");
          setTxStatus("fail");
          return;
        }
      }
      setShowWalletModal(false);
    } catch {
      setError("Wallet not found. Please install the wallet extension first.");
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
    setShowVoting(false);
  };

  // ============ CREATE POLL ============

  const createPoll = async () => {
    if (!address) return;
    setTxStatus("pending");
    setError(null);
    setSuccessMsg(null);

    try {
      const acct = await server.loadAccount(address);
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

      const fresh = await server.loadAccount(address);
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

      const signedXdr = await signTransaction(tx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });

      const send = (await rpcCall("sendTransaction", {
        transaction: signedXdr,
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
      const voterAcct = await server.loadAccount(address);
      const contract = new Contract(contractId);
      const voterScAddress = new Address(address).toScVal();

      const raw = new TransactionBuilder(voterAcct, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call("cast_vote", voterScAddress, xdr.ScVal.scvU32(optionId))
        )
        .setTimeout(300)
        .build();

      const sim = (await rpcCall("simulateTransaction", {
        transaction: raw.toXDR(),
      })) as unknown as SimulateResult;

      if (!sim.transactionData) throw new Error("Simulation failed");

      const authXdr: xdr.SorobanAuthorizationEntry[] = [];
      if (sim.results?.[0]?.auth) {
        for (const a of sim.results[0].auth) {
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

      const fresh = await server.loadAccount(address);
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

      const signedXdr = await signTransaction(tx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });

      const send = (await rpcCall("sendTransaction", {
        transaction: signedXdr,
      })) as unknown as { hash: string; status: string; errorResultXdr?: string };

      if (send.errorResultXdr) throw new Error(`TX failed: ${send.errorResultXdr}`);

      setTxHash(send.hash);
      setTxStatus("success");
      setSuccessMsg(`Vote recorded for "${pollData?.options[optionId]}"!`);
      setHasVoted(true);
      setUserVotedOption(optionId);
      await fetchBalance(address);
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

  const BAR_COLORS = [
    "#7c3aed", "#06b6d4", "#f59e0b", "#ef4444", "#10b981", "#ec4899",
  ];

  return (
    <div className="container">
      {view === "landing" ? (
        <div className="landing">
          <div className="uiverse-midnight-sky">
            <div className="sky-canvas">
              <div className="stars stars-1" />
              <div className="stars stars-2" />
              <div className="stars stars-3" />
              <div className="meteor m1" />
              <div className="meteor m2" />
              <div className="meteor m3" />
              <div className="moon" />
            </div>
          </div>

          <header className="landing-header">
            <img src="/logo-livepoll.png" alt="LivePoll" className="landing-logo" />
            <div className="logo-text">
              <span className="logo-name">LivePoll</span>
              <span className="logo-tagline">Decentralized Voting Protocol</span>
            </div>
          </header>

          <section className="landing-hero">
            <div className="hero-badge">
              <span className="hero-badge-dot" />
              Stellar Testnet
            </div>

            <div className="loader">
              <div className="loader__bar" />
              <div className="loader__bar" />
              <div className="loader__bar" />
              <div className="loader__bar" />
              <div className="loader__bar" />
              <div className="loader__ball" />
            </div>

            <h2 className="hero-title">
              Every vote is a transaction.
              <br />
              Every result is verifiable.
            </h2>
            <p className="hero-desc">
              A decentralized voting protocol on Stellar. Polls live in Soroban
              contract storage. Votes are signed by your wallet and written to
              the ledger. Results stream directly from on-chain events.
            </p>
            <button className="btn btn-hero" onClick={() => setView("app")}>
              Launch dApp
            </button>
          </section>

          <section className="landing-features">
            <div className="feature-card">
              <h3>On-Chain Voting</h3>
              <p>
                Each vote writes to Soroban instance storage. The tally is
                public, anyone can verify it independently on Stellar Testnet.
              </p>
            </div>
            <div className="feature-card">
              <h3>Live Event Stream</h3>
              <p>
                The contract fires a <code>vote_cast</code> event on every
                ballot. The frontend subscribes and refreshes results as they
                arrive.
              </p>
            </div>
            <div className="feature-card">
              <h3>One Wallet, One Vote</h3>
              <p>
                <code>require_auth</code> at the contract level ties each vote
                to a wallet signature. Casting twice is rejected on-chain.
              </p>
            </div>
          </section>

          <section className="landing-tech">
            <h3>Tech Stack</h3>
            <div className="tech-tags">
              <span>React 19</span>
              <span>TypeScript</span>
              <span>Soroban Rust</span>
              <span>Stellar SDK v13</span>
              <span>Freighter</span>
              <span>Albedo</span>
              <span>Testnet</span>
            </div>
            <p className="landing-program">
              Built for{" "}
              <a
                href="https://www.risein.com/programs/stellar-journey-to-mastery-monthly-builder-challenges/tasks/submission/zLD7OI0BUvUusdOgS"
                target="_blank"
                rel="noopener noreferrer"
              >
                Stellar Journey to Mastery
              </a>{" "}
              by Rise In &mdash; Yellow Belt
            </p>
          </section>

          <footer className="footer">
            <p>
              Live Poll &bull; Yellow Belt &bull; Stellar Journey to Mastery
              &bull; June 2026
            </p>
          </footer>
        </div>
      ) : (
        <>
          <header className="header">
            <button className="btn-back" onClick={() => setView("landing")}>
              &larr; Back
            </button>
            <div className="logo">
              <img src="/logo-livepoll.png" alt="Live Poll" className="logo-img" />
              <div className="logo-text">
                <span className="logo-name">LivePoll</span>
                <span className="logo-tagline">Decentralized Voting Protocol</span>
              </div>
            </div>

            {address ? (
              <button className="btn btn-outline" onClick={disconnectWallet}>
                Disconnect
              </button>
            ) : (
              <button
                className="btn-wallet btn-connect"
                onClick={() => setShowWalletModal(true)}
              >
                Connect Wallet
              </button>
            )}
          </header>

      <main className="main">
        {address && (
          <>
            <div className="wallet-info-card card-full">
              <div className="wallet-info-row">
                <div className="wallet-info-item">
                  <span className="wallet-info-label">Wallet</span>
                  <span className="wallet-info-value">{walletName}</span>
                </div>
                <div className="wallet-info-item">
                  <span className="wallet-info-label">Address</span>
                  <span className="wallet-info-value mono">{formatAddr(address)}</span>
                </div>
                <div className="wallet-info-item">
                  <span className="wallet-info-label">Balance</span>
                  <span className="wallet-info-value highlight">
                    {balance
                      ? `${parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`
                      : "..."}
                  </span>
                </div>
              </div>
            </div>

            <div className="guide-card card-full">
              <h3 className="guide-title">How it works</h3>
              <div className="guide-steps">
                <div className="guide-step">
                  <span className="guide-num">1</span>
                  <div>
                    <strong>Create a poll</strong>
                    <p>
                      Click + Create Poll, set a question and up to six options.
                      The poll is stored on-chain via the Soroban contract.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="guide-num">2</span>
                  <div>
                    <strong>Share the link</strong>
                    <p>
                      Anyone with a funded Stellar Testnet wallet can visit and
                      vote. No sign-up, no permissions.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="guide-num">3</span>
                  <div>
                    <strong>Cast a vote</strong>
                    <p>
                      Click an option, sign the transaction in your wallet.
                      Each vote costs a fraction of XLM in gas.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="guide-num">4</span>
                  <div>
                    <strong>Watch it update</strong>
                    <p>
                      Results refresh automatically as votes come in. The
                      contract prevents double voting. Every transaction is
                      verifiable on Stellar Expert.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {pollLoading && (
          <div className="center-card card-full">
            <div className="loader" />
            <p>Loading poll data...</p>
          </div>
        )}

        {!pollLoading && !pollExists && !showCreatePoll && (
          <section className="card card-full">
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
          <section className="card card-full">
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

        {!pollLoading && pollExists && pollData && !showVoting && (
          <section className="card card-full poll-summary">
            <div className="poll-summary-header">
              <div className="poll-live-badge">
                <span className="poll-live-dot" />
                Active Poll
              </div>
              <h2 className="poll-question-title">{pollData.question}</h2>
            </div>

            <div className="poll-summary-stats">
              <div className="poll-stat">
                <span className="poll-stat-value">{pollData.total}</span>
                <span className="poll-stat-label">Total Votes</span>
              </div>
              <div className="poll-stat">
                <span className="poll-stat-value">{pollData.options.length}</span>
                <span className="poll-stat-label">Options</span>
              </div>
            </div>

            {address ? (
              <button
                className="btn btn-primary btn-full"
                onClick={() => setShowVoting(true)}
              >
                Vote Now
              </button>
            ) : (
              <p className="info-hint">Connect wallet to vote</p>
            )}
          </section>
        )}

        {!pollLoading && pollExists && pollData && showVoting && (
          <>
            <button
              className="btn-back btn-back-poll"
              onClick={() => setShowVoting(false)}
            >
              &larr; Back to Poll
            </button>

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
          </>
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

      {showWalletModal && (
        <div className="wallet-modal-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-modal-header">
              <h3>Connect a Wallet</h3>
              <button
                className="wallet-modal-close"
                onClick={() => setShowWalletModal(false)}
              >
                &times;
              </button>
            </div>
            <div className="wallet-modal-list">
              <button
                className="wallet-modal-item"
                onClick={() => connectWallet("freighter")}
              >
                <span className="wallet-modal-icon">
                  <img src="/logoStellar.png" alt="" className="wallet-modal-logo" />
                </span>
                <span className="wallet-modal-name">Freighter</span>
              </button>
              <button
                className="wallet-modal-item"
                onClick={() => connectWallet("albedo")}
              >
                <span className="wallet-modal-icon">A</span>
                <span className="wallet-modal-name">Albedo</span>
              </button>
              <button
                className="wallet-modal-item"
                onClick={() => connectWallet("xbull")}
              >
                <span className="wallet-modal-icon">X</span>
                <span className="wallet-modal-name">xBull</span>
              </button>
              <button
                className="wallet-modal-item"
                onClick={() => connectWallet("rabet")}
              >
                <span className="wallet-modal-icon">R</span>
                <span className="wallet-modal-name">Rabet</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <p>
          Live Poll &bull; Yellow Belt &bull; Stellar Journey to Mastery &bull;
          June 2026
        </p>
      </footer>
        </>
      )}
    </div>
  );
}

export default App;
