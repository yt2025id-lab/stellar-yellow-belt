# Multi-Wallet dApp — Yellow Belt Submission

A multi-wallet Stellar dApp that connects to Freighter and Albedo wallets, displays XLM balance, and calls a deployed Soroban smart contract on Stellar Testnet.

Built for **Stellar Journey to Mastery — Yellow Belt (Level 2)**.

## Features

- **Multi-Wallet Support**: Freighter, Albedo, xBull, Rabet (Freighter & Albedo fully functional)
- **Smart Contract Call**: Calls deployed `hello-world` contract on Testnet
- **Transaction Status Tracking**: Real-time status (Ready → Pending → Success/Fail)
- **Error Handling**: 3 distinct error types (wallet not found, user rejected, insufficient balance)
- **Balance Display**: Live XLM balance from Horizon
- **Transaction Explorer Link**: View transactions on Stellar Expert

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build Tool | Vite |
| Wallet | Freighter, Albedo Browser Extensions |
| Network | Stellar Testnet |
| SDK | `@stellar/freighter-api` v6, `stellar-sdk` v13 |
| Contract | Soroban Rust Smart Contract |

## Project Structure

```
stellar-yellow-belt/
├── contracts/                   # Smart Contract (Soroban Rust)
│   └── hello-world/
│       ├── Cargo.toml
│       ├── Makefile
│       ├── src/
│       │   ├── lib.rs           # Contract logic: hello()
│       │   └── test.rs          # Unit test
│       └── test_snapshots/
├── Cargo.toml                   # Rust workspace root
├── src/                         # Frontend (React + TypeScript)
│   ├── App.tsx
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
cd contracts/hello-world
make build    # Build WASM binary
make test     # Run unit tests
```

**Test Output:**
```
running 1 test
test test::test ... ok
test result: ok. 1 passed; 0 failed
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
| Contract ID | `CAIXY7P7RF5J2TTAI6BV4IUKAFXKJPUE2VSMM5F5IRHV7ARJ73JAAGSM` |
| Network | Stellar Testnet |
| Function | `hello(to: String) -> Vec<String>` |
| Explorer | [View on Stellar Lab](https://lab.stellar.org/r/testnet/contract/CAIXY7P7RF5J2TTAI6BV4IUKAFXKJPUE2VSMM5F5IRHV7ARJ73JAAGSM) |

## Transaction Hash (Contract Call)

```
(Will be updated after testnet call)
```

## Screenshots

### Wallet Options Available
![Wallet Options](./screenshots/wallet-options.png)

### Wallet Connected with Balance
![Wallet Connected](./screenshots/connected.png)

### Contract Call Success + Transaction Hash
![Contract Call](./screenshots/contract-call.png)

## Error Types Handled

| # | Error | Example |
|---|-------|---------|
| 1 | Wallet Not Found | "Freighter connection rejected or not found. Please install Freighter extension." |
| 2 | User Rejected | "Error: Transaction rejected by user in wallet." |
| 3 | Insufficient Balance | "Error: Insufficient balance to complete the transaction." |

## Requirements Checklist

- [x] 3 error types handled
- [x] Contract deployed on testnet
- [x] Contract source in `contracts/` folder (lib.rs + test.rs + Cargo.toml)
- [x] Local test passing (`cargo test`)
- [x] Contract called from frontend
- [x] Transaction status visible (Ready/Pending/Success/Fail)
- [x] 2+ meaningful commits
- [x] Multi-wallet support (Freighter + Albedo)
- [x] Public GitHub repository
- [x] README with setup instructions

## Author

Built for **Stellar Journey to Mastery** — Yellow Belt Level 2
