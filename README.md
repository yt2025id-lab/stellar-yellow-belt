# LivePoll

> **Decentralized Real-Time Voting Protocol on Stellar Testnet**  
> Every vote is a transaction. Every result is verifiable.

---

## Overview

LivePoll is a fully on-chain polling dApp built on **Soroban** (Stellar's smart contract platform). Users connect their wallet (Freighter, Albedo, xBull, or Rabet), create polls with up to six options, and cast votes that are written directly to the Stellar ledger. Results update in real time via contract event streaming.

Built for the **Stellar Journey to Mastery — Yellow Belt (Level 2)** challenge.

**[Launch Live Demo](https://stellar-yellow-belt-jade.vercel.app)**

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React 19)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Freighter │  │  Albedo  │  │  xBull   │  Rabet   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       └──────────────┴─────────────┘                 │
│                        │                             │
│              Soroban RPC (testnet)                   │
│                        │                             │
└────────────────────────┼─────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │  LivePoll Contract  │
              │   (Soroban Rust)    │
              │                     │
              │  • init()           │
              │  • cast_vote()      │
              │  • get_results()    │
              │  • 8 total fns     │
              └─────────────────────┘
                         │
              ┌──────────┴──────────┐
              │   Stellar Ledger     │
              │  (Testnet Network)   │
              └─────────────────────┘
```

---

## Key Features

| Feature | Detail |
|---------|--------|
| **Multi-Wallet** | Freighter, Albedo, xBull, Rabet — single Connect button |
| **On-Chain Storage** | Question, 6 options, vote counts, voter map — all on Soroban instance storage |
| **Live Events** | `poll_created` & `vote_cast` events streamed every 4 seconds |
| **Double-Vote Guard** | Contract-level `Map<Address, bool>` prevents replay attacks |
| **3 Error Types** | Wallet not found, user rejected, already voted — distinct UX for each |
| **TX Explorer Links** | Every create/vote transaction links directly to Stellar Expert |
| **Poll History** | Closed polls preserved in localStorage with TX hashes & vote breakdown |
| **Creator Controls** | Poll creator sees a Close Poll button to archive the poll |
| **Landing Page** | Midnight-sky starfield with animated bar loader (Uiverse design) |
| **Responsive** | Mobile-first grid layout with horizontal card scroll |

---

## Smart Contract

### Deployed Contract

| Detail | Value |
|--------|-------|
| **Contract ID** | `CCJEQ6KIRJNQ4PLU2TUDESF4NBPGSPDW3JWO42OYGVI2XONDRFUJ6PDA` |
| **Network** | Stellar Testnet |
| **WASM Hash** | `0e77dabf22fd170ead49b533ac8d3b6212180ea086be1eb6b7c46b77b0670ff8` |
| **Stellar Lab** | [View Contract](https://lab.stellar.org/r/testnet/contract/CCJEQ6KIRJNQ4PLU2TUDESF4NBPGSPDW3JWO42OYGVI2XONDRFUJ6PDA) |

### Storage Model

| Key | Type | Description |
|-----|------|-------------|
| `Symbol("question")` | `String` | Poll question |
| `Symbol("opt{N}")` | `String` | Option label (0–5) |
| `Symbol("votes{N}")` | `u32` | Vote count per option |
| `Symbol("total")` | `u32` | Total votes cast |
| `Symbol("voters")` | `Map<Address, bool>` | Voter registry (prevents double-vote) |

### Functions

| Function | Description |
|----------|-------------|
| `init(question, opt0..opt5)` | Initialize poll (resets all state including voter map) |
| `cast_vote(voter, option_id)` | Record a vote, emit `vote_cast` event |
| `get_question()` | Read current question |
| `get_option(id)` | Read option text by index |
| `get_votes(id)` | Read vote count for an option |
| `get_total_votes()` | Read total vote count |
| `get_results()` | Read all 6 vote counts as a vector |
| `has_voted(voter)` | Check if an address has already voted |

### Events

| Event | Topics | Data |
|-------|--------|------|
| `poll_created` | `Symbol("poll_created")` | `question: String` |
| `vote_cast` | `Symbol("vote_cast")` | `(voter, option_id, new_count, total)` |

### Error Handling (Contract Level)

| Error | Condition |
|-------|-----------|
| `Already voted` | Voter address found in `voters` Map |
| `Invalid option` | `option_id >= 6` |

---

## Transaction Hashes

| Action | TX Hash | Explorer |
|--------|---------|----------|
| WASM Upload + Deploy | `3ae73a65...7d44` | [View](https://stellar.expert/explorer/testnet/tx/3ae73a65293699d3825c0a513bb8ab4a9ea58e4b2815570c7da0e936f4807d44) |
| Contract Init (create) | `5b210a04...ea3` | [View](https://stellar.expert/explorer/testnet/tx/5b210a0407d3c84b0050de0a778e135f75e91ebde0a16f217d73ff29bf971ea3) |
| Create Poll (`init`) | *(generated from dApp)* | — |
| Cast Vote (`cast_vote`) | *(generated from dApp)* | — |

---

## Frontend

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + TypeScript |
| **Bundler** | Vite 8 |
| **Wallets** | Freighter, Albedo, xBull, Rabet |
| **SDK** | `stellar-sdk` v13, `@stellar/freighter-api` |
| **Network** | Stellar Testnet (Soroban RPC + Horizon) |
| **Styling** | Pure CSS (Uiverse-inspired components) |
| **Deployment** | Vercel (auto-aliased) |

### Project Structure

```
src/
├── App.tsx          # Main component — all UI, wallet, voting, history
├── main.tsx         # Entry point
└── index.css        # All styles (starfield, wizard, cards, modals)

contracts/poll/
├── Cargo.toml       # Rust crate config
├── Makefile         # Build helpers
└── src/
    ├── lib.rs       # Contract logic (8 functions)
    └── test.rs      # 3 unit tests
```

---

## Getting Started

### Prerequisites

- Node.js v18+
- Rust (`rustup`)
- Stellar CLI (`cargo install stellar-cli --features opt`)
- Freighter Wallet (browser extension)
- Funded Stellar Testnet account

### Run Locally

```bash
# Frontend
npm install
npm run dev
# → http://localhost:5173

# Contract tests
cd contracts/poll
cargo test
```

### Test Output

```
running 3 tests
test test::test_double_vote ... ok
test test::test_invalid_option ... ok
test test::test_live_poll ... ok
test result: ok. 3 passed; 0 failed
```

---

## User Flow

```
1. Open dApp → Landing page (starfield + animated loader)
2. Click "Launch dApp" → App view (persisted via localStorage)
3. Click "Connect Wallet" → Modal → Select wallet → Authorize
4. Wallet info card shows (name, address, balance)
5. Click "+ Create Poll" → Wizard modal → Fill question + 6 options → Submit
6. Active Poll card appears with:
   ├── Header: Create TX hash (clickable → Stellar Expert)
   ├── Stats: Total Votes + Options
   └── Vote TX hashes (appear after votes cast)
7. Click "Vote Now" → Vote modal → Select option → Sign transaction
8. Results update live via event polling (4s interval)
9. Creator can click "Close Poll" → Poll moves to history
10. History cards show: Closed badge, timestamp, TX hashes, vote breakdown
```

---

## Error Types

| # | Error | UI Message |
|---|-------|------------|
| 1 | Wallet not installed | "Please install [wallet] extension." |
| 2 | User rejected TX | "Transaction rejected by user." |
| 3 | Already voted | "You have already voted in this poll." |

---

## Requirements Checklist (Yellow Belt)

- [x] 3 error types handled
- [x] Contract deployed on testnet
- [x] Contract source in `contracts/` folder
- [x] 3 unit tests passing
- [x] Contract called from frontend (`init`, `cast_vote`, `get_results`)
- [x] Transaction status visible (Ready → Pending → Success/Fail + Explorer link)
- [x] Event listening & real-time state synchronization
- [x] Read/write to Soroban contract storage
- [x] 2+ meaningful commits on GitHub
- [x] Multi-wallet support (4 wallets)
- [x] Public GitHub repository
- [x] README with setup instructions

---

## Links

| Resource | URL |
|----------|-----|
| **Live Demo** | https://stellar-yellow-belt-jade.vercel.app |
| **GitHub** | https://github.com/yt2025id-lab/stellar-yellow-belt |
| **Contract** | https://lab.stellar.org/r/testnet/contract/CCJEQ6KIRJNQ4PLU2TUDESF4NBPGSPDW3JWO42OYGVI2XONDRFUJ6PDA |
| **Rise In** | https://www.risein.com/programs/stellar-journey-to-mastery-monthly-builder-challenges |

---

*Built for **Stellar Journey to Mastery — Yellow Belt (Level 2)**. June 2026.*
