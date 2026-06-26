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
  "CCJEQ6KIRJNQ4PLU2TUDESF4NBPGSPDW3JWO42OYGVI2XONDRFUJ6PDA";
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

const SIM_SOURCE = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

async function simulateRead(contractId: string, method: string, args: xdr.ScVal[] = []) {
  const contract = new Contract(contractId);
  const mockAcct = {
    accountId: () => SIM_SOURCE,
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  };
  const tx = new TransactionBuilder(mockAcct as never, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  const result = await rpcCall("simulateTransaction", {
    transaction: tx.toXDR(),
  }) as unknown as SimulateResult;
  return result;
}

type TxStatus = "idle" | "pending" | "success" | "fail";

interface SimulateHostFnResult {
  auth: string[];
  xdr: string;
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
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [currentPollTxHash, setCurrentPollTxHash] = useState<string | null>(() => {
    try { return localStorage.getItem("poll_create_tx_hash"); }
    catch { return null; }
  });
  const [pollCreator, setPollCreator] = useState<string | null>(() => {
    try { return localStorage.getItem("poll_creator"); }
    catch { return null; }
  });
  const [recentVoteHashes, setRecentVoteHashes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("poll_vote_hashes") || "[]"); }
    catch { return []; }
  });
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

  const [pollHistory, setPollHistory] = useState<{ data: PollData; timestamp: string; txHash?: string; voteHashes?: string[] }[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("poll_history") || "[]");
      return raw.map((item: unknown) => {
        if (item && typeof item === "object" && "data" in (item as Record<string, unknown>))
          return item as { data: PollData; timestamp: string; txHash?: string; voteHashes?: string[] };
        const d = item as PollData;
        return { data: d, timestamp: "—" };
      });
    } catch { return []; }
  });

  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [liveUpdated, setLiveUpdated] = useState(false);
  const [view, setView] = useState<"landing" | "app">(() => {
    return (localStorage.getItem("livepoll_view") as "landing" | "app") || "landing";
  });

  const switchView = (v: "landing" | "app") => {
    localStorage.setItem("livepoll_view", v);
    setView(v);
  };
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
      if (sim.results?.[0]?.xdr) {
        const questionScVal = xdr.ScVal.fromXDR(sim.results[0].xdr, "base64");
        const question = questionScVal.str()?.toString() ?? "";
        if (question) {
          setPollExists(true);
          setPollLoading(false);
          await loadFullPoll();
          return;
        }
      }
    } catch (e) {
      console.error("checkPoll error:", e);
    }
    setPollExists(false);
    setPollLoading(false);
  }, [contractId]);

  const loadFullPoll = useCallback(async () => {
    try {
      const simQ = await simulateRead(contractId, "get_question");
      const question =
        xdr.ScVal.fromXDR(simQ.results?.[0]?.xdr ?? "", "base64").str()?.toString() ?? "";

      const options: string[] = [];
      const votes: number[] = [];
      let total = 0;

      for (let i = 0; i < 6; i++) {
        const simOpt = await simulateRead(contractId, "get_option", [xdr.ScVal.scvU32(i)]);
        options.push(
          xdr.ScVal.fromXDR(simOpt.results?.[0]?.xdr ?? "", "base64").str()?.toString() ?? ""
        );

        const simV = await simulateRead(contractId, "get_votes", [xdr.ScVal.scvU32(i)]);
        const v = xdr.ScVal.fromXDR(simV.results?.[0]?.xdr ?? "", "base64").u32() ?? 0;
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
    fundAccount(appKeypair.publicKey()).catch(() => {});
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
      const voted = xdr.ScVal.fromXDR(sim.results?.[0]?.xdr ?? "", "base64").b() ?? false;
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
    setCurrentPollTxHash(null);
    localStorage.removeItem("poll_create_tx_hash");
    setPollCreator(null);
    localStorage.removeItem("poll_creator");
    setRecentVoteHashes([]);
    localStorage.setItem("poll_vote_hashes", "[]");
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
      if (pollExists && pollData) {
        const entry = {
          data: { ...pollData },
          timestamp: new Date().toISOString().replace("T", " ").slice(0, 19) + " GMT",
          txHash: currentPollTxHash || undefined,
          voteHashes: recentVoteHashes.length > 0 ? [...recentVoteHashes] : undefined,
        };
        const history = [...pollHistory, entry];
        localStorage.setItem("poll_history", JSON.stringify(history));
        setPollHistory(history);
        setRecentVoteHashes([]);
        localStorage.setItem("poll_vote_hashes", "[]");
        setHasVoted(false);
        setUserVotedOption(null);
        setSelectedOption(null);
      }

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
      setCurrentPollTxHash(send.hash);
      localStorage.setItem("poll_create_tx_hash", send.hash);
      setPollCreator(address);
      localStorage.setItem("poll_creator", address);
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

  // ============ CLOSE POLL ============

  const closePoll = () => {
    if (!pollData || !pollExists) return;
    const entry = {
      data: { ...pollData },
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19) + " GMT",
      txHash: currentPollTxHash || undefined,
      voteHashes: recentVoteHashes.length > 0 ? [...recentVoteHashes] : undefined,
    };
    const history = [...pollHistory, entry];
    localStorage.setItem("poll_history", JSON.stringify(history));
    setPollHistory(history);
    setPollExists(false);
    setPollData(null);
    setCurrentPollTxHash(null);
    localStorage.removeItem("poll_create_tx_hash");
    setPollCreator(null);
    localStorage.removeItem("poll_creator");
    setRecentVoteHashes([]);
    localStorage.setItem("poll_vote_hashes", "[]");
    setHasVoted(false);
    setUserVotedOption(null);
    setSelectedOption(null);
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
          contract.call("cast_vote", voterScAddress, xdr.ScVal.scvU32(optionId))
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
            function: "cast_vote",
            args: [voterScAddress, xdr.ScVal.scvU32(optionId)],
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
      setRecentVoteHashes(prev => {
        const next = [...prev, send.hash];
        localStorage.setItem("poll_vote_hashes", JSON.stringify(next));
        return next;
      });
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

  const deleteHistory = (idx: number) => {
    const next = pollHistory.filter((_, i) => i !== idx);
    localStorage.setItem("poll_history", JSON.stringify(next));
    setPollHistory(next);
  };

  // ============ RENDER ============

  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

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
            <button className="btn btn-hero" onClick={() => switchView("app")}>
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
            <button className="btn-back" onClick={() => switchView("landing")}>
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

        {!pollLoading && !showCreatePoll && (
          <section className="card card-full">
            <h2 className="card-title">Create Poll</h2>
            <p className="card-desc">
              Start a new poll on Stellar Testnet. Each poll is a Soroban smart contract.
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

        {!pollLoading && pollExists && pollData && !showVoting && (
          <div className="poll-history-grid">
            {pollHistory.map((entry, idx) => {
              const p = entry.data;
              return (
                <div key={idx} className="poll-summary-card poll-card-uniform">
                  <div className="poll-summary-card-header history-header">
                    <div className="poll-summary-card-badge history-badge">Closed</div>
                    <button className="history-delete" onClick={() => deleteHistory(idx)} title="Hapus dari history">&times;</button>
                    <h2 className="poll-summary-card-title">{p.question}</h2>
                    <p className="poll-summary-card-id">{entry.timestamp}</p>
                    {entry.txHash && (
                      <p className="poll-summary-card-txhash">
                        <span className="tx-label">Create Poll</span>
                        <a href={`https://stellar.expert/explorer/testnet/tx/${entry.txHash}`} target="_blank" rel="noopener noreferrer" className="tx-link">
                          {entry.txHash.slice(0, 10)}...{entry.txHash.slice(-6)}
                        </a>
                      </p>
                    )}
                  </div>
                  <div className="poll-summary-card-info">
                    <div className="poll-summary-card-stats">
                      <div className="poll-summary-card-stat">
                        <span className="poll-summary-card-stat-value">{p.total}</span>
                        <span className="poll-summary-card-stat-label">Total Votes</span>
                      </div>
                      <div className="poll-summary-card-stat">
                        <span className="poll-summary-card-stat-value">{p.options.length}</span>
                        <span className="poll-summary-card-stat-label">Options</span>
                      </div>
                    </div>
                  </div>
                  <div className="poll-summary-card-footer history-footer">
                    <span className="poll-summary-card-tag">
                      {p.options.map((_, i) => `${"ABCDEF"[i]}:${p.votes[i]}`).join("  ")}
                    </span>
                    {entry.voteHashes && entry.voteHashes.length > 0 && (
                      <div className="poll-summary-card-votes">
                        <span className="vote-hash-label">Votes ({entry.voteHashes.length})</span>
                        {entry.voteHashes.slice(-3).map((vh, vi) => (
                          <a key={vi} href={`https://stellar.expert/explorer/testnet/tx/${vh}`} target="_blank" rel="noopener noreferrer" className="tx-link vote-link">
                            {vh.slice(0, 8)}...{vh.slice(-4)}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="poll-summary-card poll-card-uniform">
              <div className="poll-summary-card-header">
                <div className="poll-summary-card-badge">
                  <span className="poll-summary-card-dot" />
                  Active Poll
                </div>
                <h2 className="poll-summary-card-title">{pollData.question}</h2>
                <p className="poll-summary-card-id">
                  {contractId.slice(0, 8)}...{contractId.slice(-4)}
                </p>
                {currentPollTxHash && (
                  <p className="poll-summary-card-txhash">
                    <span className="tx-label">Create Poll</span>
                    <a href={`https://stellar.expert/explorer/testnet/tx/${currentPollTxHash}`} target="_blank" rel="noopener noreferrer" className="tx-link">
                      {currentPollTxHash.slice(0, 10)}...{currentPollTxHash.slice(-6)}
                    </a>
                  </p>
                )}
              </div>
              <div className="poll-summary-card-info">
                <div className="poll-summary-card-stats">
                  <div className="poll-summary-card-stat">
                    <span className="poll-summary-card-stat-value">{pollData.total}</span>
                    <span className="poll-summary-card-stat-label">Total Votes</span>
                  </div>
                  <div className="poll-summary-card-stat">
                    <span className="poll-summary-card-stat-value">{pollData.options.length}</span>
                    <span className="poll-summary-card-stat-label">Options</span>
                  </div>
                </div>
                {recentVoteHashes.length > 0 && (
                  <div className="poll-summary-card-votes">
                    <span className="vote-hash-label">Vote TX Hashes</span>
                    {recentVoteHashes.slice(-3).map((vh, vi) => (
                      <a key={vi} href={`https://stellar.expert/explorer/testnet/tx/${vh}`} target="_blank" rel="noopener noreferrer" className="tx-link vote-link">
                        {vh.slice(0, 10)}...{vh.slice(-6)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="poll-summary-card-footer">
                <span className="poll-summary-card-tag">
                  Vote on-chain via Soroban contract. Results update live.
                </span>
                <div className="poll-summary-card-footer-actions">
                  {address === pollCreator && (
                    <button className="poll-summary-card-close" onClick={closePoll}>
                      Close Poll
                    </button>
                  )}
                {address ? (
                  <button className="poll-summary-card-action" onClick={() => setShowVoting(true)}>
                    Vote Now
                  </button>
                ) : (
                  <p className="info-hint">Connect wallet to vote</p>
                )}
                </div>
              </div>
            </div>
          </div>
        )}

        {showCreatePoll && (
          <div className="wallet-modal-overlay" onClick={() => setShowCreatePoll(false)}>
            <form className="form-wizard" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); createPoll(); }}>
              <div className="wiz-title">New Poll</div>
              <p className="wiz-message">Create a poll on Stellar Testnet. Votes are recorded on-chain.</p>

              <div className="wiz-group">
                <label>
                  <input
                    className="input"
                    required
                    value={createQuestion}
                    onChange={(e) => setCreateQuestion(e.target.value)}
                  />
                  <span>Question</span>
                </label>
              </div>

              {createOptions.map((opt, i) => (
                <div className="wiz-group" key={i}>
                  <label>
                    <input
                      className="input"
                      required
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

              <button className="submit" type="submit" disabled={txStatus === "pending"}>
                {txStatus === "pending" ? "Creating..." : "Create Poll"}
              </button>

              {txStatus === "success" && successMsg && (
                <div className="wiz-status success">
                  <strong>&#10003; {successMsg}</strong>
                  {txHash && (
                    <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="explorer-link">View on Stellar Expert &rarr;</a>
                  )}
                </div>
              )}
              {error && txStatus === "fail" && (
                <div className="wiz-status error">
                  <strong>&#10007; {error}</strong>
                </div>
              )}

              <p className="wiz-signin">
                <button type="button" className="wiz-cancel" onClick={() => { setShowCreatePoll(false); setTxStatus("idle"); setError(null); setSuccessMsg(null); }}>Cancel</button>
              </p>
            </form>
          </div>
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

      {showVoting && pollExists && pollData && (
        <div className="wallet-modal-overlay" onClick={() => setShowVoting(false)}>
          <div className="vote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vote-modal-header">
              <div className="vote-modal-live">
                <span className={`vote-modal-dot ${liveUpdated ? "pulse" : ""}`} />
                {liveUpdated ? "Updated!" : "Live"}
              </div>
              <button className="vote-modal-close" onClick={() => setShowVoting(false)}>&times;</button>
            </div>

            <h2 className="vote-modal-title">{pollData.question}</h2>

            <div className="vote-options-list">
              {pollData.options.map((opt, i) => {
                const pct =
                  pollData.total > 0
                    ? Math.round((pollData.votes[i] / pollData.total) * 100)
                    : 0;
                const letters = ["A", "B", "C", "D", "E", "F"];
                return (
                  <button
                    key={i}
                    className={`vote-option-btn ${
                      userVotedOption === i ? "voted" : ""
                    } ${hasVoted ? "disabled" : ""} ${
                      selectedOption === i && txStatus === "pending" ? "selected" : ""
                    }`}
                    onClick={() => castVote(i)}
                    disabled={hasVoted || !address || txStatus === "pending"}
                  >
                    <span className="vote-opt-letter">{letters[i]}</span>
                    <div className="vote-opt-body">
                      <div className="vote-opt-row">
                        <span className="vote-opt-label">{opt}</span>
                        <span className="vote-opt-pct">{pct}%</span>
                      </div>
                      <div className="vote-opt-track">
                        <div className="vote-opt-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="vote-opt-right">
                      <span className="vote-opt-count">{pollData.votes[i]}</span>
                      {userVotedOption === i && <span className="vote-opt-check">Voted</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="vote-modal-footer">
              <span className="vote-modal-total">
                Total: {pollData.total} vote{pollData.total !== 1 ? "s" : ""}
              </span>
              {hasVoted && (
                <span className="vote-modal-voted">
                  &#10003; You: {pollData.options[userVotedOption ?? 0]}
                </span>
              )}
            </div>

            {txStatus === "success" && successMsg && (
              <div className="vote-modal-status success">
                <strong>&#10003; {successMsg}</strong>
                {txHash && (
                  <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="explorer-link">View on Stellar Expert &rarr;</a>
                )}
              </div>
            )}

            {error && txStatus === "fail" && selectedOption !== null && (
              <div className="vote-modal-status error">
                <strong>&#10007; {error}</strong>
              </div>
            )}
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
