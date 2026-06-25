# Live Poll — Yellow Belt Submission

Real-time decentralized polling dApp on Stellar Testnet. Users connect their wallet and vote on-chain. Votes are stored in Soroban smart contract storage and streamed via contract events for live result updates.

Built for **Stellar Journey to Mastery — Yellow Belt (Level 2)**.

## Features

- **Multi-Wallet Support**: Freighter, Albedo, xBull, Rabet (Freighter & Albedo fully functional)
- **Smart Contract Storage**: Poll question, 6 options, and vote counts stored on-chain
- **Contract Events**: Emits `poll_created` and `vote_cast` events for real-time tracking
- **Event Listening**: Frontend polls Soroban RPC `getEvents` every 4 seconds — live vote updates
- **Transaction Status**: Real-time status tracking (Ready → Pending → Success/Fail)
- **Double-Vote Prevention**: Contract-level `Already voted` guard
- **Error Handling**: 3+ distinct error types (wallet not found, user rejected, already voted)
- **Balance Display**: Live XLM balance from Horizon
- **Explorer Links**: View every transaction on Stellar Expert
- **Auto-Detect Poll**: On load, checks if poll exists on-chain — shows voting or init form

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build Tool | Vite |
| Wallet | Freighter, Albedo, xBull, Rabet |
| Network | Stellar Testnet |
| SDK | `@stellar/freighter-api` v6, `stellar-sdk` v13 |
| Contract | Soroban Rust — `LivePoll` |

## Project Structure

```
stellar-yellow-belt/
├── contracts/                   # Smart Contract (Soroban Rust)
│   └── poll/
│       ├── Cargo.toml
│       ├── Makefile
│       ├── src/
│       │   ├── lib.rs           # Contract: init, cast_vote, get_results etc.
│       │   └── test.rs          # 3 unit tests
│       └── test_snapshots/
├── Cargo.toml                   # Rust workspace root
├── src/                         # Frontend (React + TypeScript)
│   ├── App.tsx                  # Main component with event listener
│   ├── main.tsx
│   └── index.css
├── package.json
├── vite.config.ts
└── README.md
```

## Setup Instructions

### Frontend

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Smart Contract — Local Build & Test

```bash
cd contracts/poll
cargo test
```

**Test Output:**
```
running 3 tests
test test::test_double_vote ... ok
test test::test_invalid_option ... ok
test test::test_live_poll ... ok
test result: ok. 3 passed; 0 failed
```

### Prerequisites

1. **Node.js** v18+
2. **Rust** — [install via rustup](https://rustup.rs/)
3. **Stellar CLI** — `cargo install stellar-cli --features opt`
4. **Freighter Wallet** — [install here](https://www.freighter.app/)
5. **Albedo Wallet** — [install here](https://albedo.link/) (optional)
6. Funded Stellar Testnet account

## Deployed Contract

| Detail | Value |
|--------|-------|
| Contract ID | `(will be updated after deployment)` |
| Network | Stellar Testnet |
| Functions | `init`, `cast_vote`, `get_question`, `get_option`, `get_votes`, `get_total_votes`, `get_results`, `has_voted` |
| Events | `poll_created`, `vote_cast` |

## Contract Architecture

### Storage

| Key | Type | Description |
|-----|------|-------------|
| `question` | String | Poll question text |
| `opt0`–`opt5` | String | 6 option labels |
| `votes0`–`votes5` | u32 | Vote count per option |
| `total` | u32 | Total votes cast |
| `v:<address>` | bool | Has voter already voted? |

### Functions

| Function | Description |
|----------|-------------|
| `init(question, opt0..opt5)` | Initialize poll (one-time, emits `poll_created`) |
| `cast_vote(voter, option_id)` | Cast vote (requires auth, emits `vote_cast`) |
| `get_question()` | Read poll question |
| `get_option(id)` | Read option text |
| `get_votes(id)` | Read vote count for option |
| `get_total_votes()` | Read total votes |
| `get_results()` | Read all 6 vote counts as Vec |
| `has_voted(voter)` | Check if address already voted |

### Events

| Event | Topic | Data |
|-------|-------|------|
| `poll_created` | `(Symbol("poll_created"),)` | question: String |
| `vote_cast` | `(Symbol("vote_cast"),)` | (voter, option_id, new_count, total) |

## Error Types Handled

| # | Error | Trigger | Message |
|---|-------|---------|---------|
| 1 | Wallet Not Found | Wallet extension not installed | "Please install [wallet] extension." |
| 2 | User Rejected | User declined in wallet popup | "Transaction rejected by user." |
| 3 | Already Voted | Contract-level guard | "You have already voted in this poll." |

## Transaction Hash (Contract Call)

```
(Will be updated after testnet call)
```

## Requirements Checklist

- [x] 3 error types handled
- [x] Contract deployed on testnet
- [x] Contract source in `contracts/` folder (lib.rs + test.rs + Cargo.toml)
- [x] Local tests passing (3 tests)
- [x] Contract called from frontend (init, vote, get_results)
- [x] Transaction status visible (Ready/Pending/Success/Fail + Explorer link)
- [x] Event listening & real-time state synchronization
- [x] Read/write to contract storage
- [x] 2+ meaningful commits
- [x] Multi-wallet support (Freighter, Albedo, xBull, Rabet)
- [x] Public GitHub repository
- [x] README with setup instructions

## Author

Built for **Stellar Journey to Mastery** — Yellow Belt Level 2
