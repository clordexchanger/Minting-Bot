# telegram-nft-bot

Phase 0-1 scaffold: Telegram control layer for the fast NFT mint bot. See PRD.md, Architecture.md, Tasks.md, Memory.md, and Handoff.md (project root, one level up from this repo) for full context.

## Status
- [x] Phase 0 — repo scaffold, env config
- [x] Phase 1 — Telegram control layer (`/addtarget`, `/listtargets`, `/removetarget`, `/status`, `/help`), operator-only auth
- [x] Phase 2 — wallet/key manager (encrypted keystore, EVM + Solana signer modules, `/wallets` command, local-only import script)
- [x] Phase 3 — EVM mint engine (`/mint`, multi-RPC broadcast of one signed tx, fee scaling, confirmation polling)
- [x] Phase 4 — Solana mint engine (`/mint`, Jito bundle submission with tip, multi-RPC fallback, confirmation polling)
- [x] Phase 5 — sweep/fast wallet-out (`/setsweep`, `/sweep`, auto-sweep of the minted NFT on evm mint confirmation)
- [x] Phase 6 — triggers beyond manual-arm: `/schedule` + `/schedules` + `/unschedule` (fire at a future time, survives bot restarts), `/watch` + `/unwatch` (poll an evm view function, auto-mint the instant it matches — solana state-watch not implemented)
- [x] Phase 7 — hardening: retry/backoff on RPC calls (`src/utils/retry.ts`), stale-blockhash rebuild-and-retry on solana (mint engine and sweep both), `/dryrun` to simulate a mint against current chain state without ever broadcasting
- [x] Phase 8 — evm side fully live-tested end to end on Arbitrum Sepolia: mint, dry-run, auto-sweep, schedule, and watch all confirmed working against a real chain. Solana path (mint engine, sweep) is still unverified against a live RPC — see below.
- [x] Multi-wallet: `/newwallet` (generate a fresh wallet via Telegram, key never shown), `/removewallet`, `/fanoutmint` (fire the same mint from several wallets at once)

## Setup
```
npm install
cp .env.example .env
```
Fill in `.env`:
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `TELEGRAM_OPERATOR_ID` — your numeric Telegram user ID (get it from @userinfobot). Every command is gated on this; anyone else's messages are silently dropped.
- `WALLET_KEYSTORE_PASSPHRASE` — a strong passphrase, needed before importing or using any wallet. Keep it out of version control (it already is, via `.gitignore`).
- RPC URLs — `.env.example` already has a template covering Ethereum, Base, Arbitrum, Optimism, and Polygon (mainnet + testnet) using one Alchemy API key. Open `.env`, find-and-replace every `YOUR_KEY` with your actual Alchemy API key, and delete the chainId entries you don't need. Add more by adding another `"chainId":"url"` pair to the JSON. Recommended for Solana: Helius (free tiers are too slow/rate-limited for racing a mint).

## Get a wallet into the bot
Three options:

**Generate one via Telegram (safest, no key ever changes hands):**
```
/newwallet evm main
```
The bot creates a fresh key, encrypts it straight into the keystore, and tells you the address. It never asks for or displays a private key — safe to run in a chat.

**Import an existing key (local-only, never through Telegram):**
```
npm run import-wallet -- --chain evm --label main --key 0xyourprivatekey
npm run import-wallet -- --chain solana --label main --key yourBase58SecretKey
```
This encrypts the key with `WALLET_KEYSTORE_PASSPHRASE` (AES-256-GCM) and writes it to `data/keystore.enc.json`. Clear your shell history afterward if you typed the key directly on the command line.

**Export a key back out (local-only, for using it elsewhere like MetaMask):**
```
npm run export-wallet -- --label main
```
Prints the raw key to your terminal. Never paste this output into Telegram or anywhere else it could be captured.

## Run
```
npm run dev
```

## Try it
Message your bot on Telegram:
- `/help`
- `/addtarget testdrop|evm|0xYourContract|{"functionAbi":"function mint(uint256) payable","args":[1],"valueEth":"0.01"}|8453|0.01 ETH|main`
- `/listtargets`
- `/wallets` (empty until you run the import script)
- `/mint testdrop` — fires the EVM mint engine
- `/status`

Solana example (needs the target program's actual instruction data + accounts, this is illustrative shape only):
`/addtarget solanadrop|solana|ProgramId1111...|{"instructionDataBase64":"AQ==","accounts":[{"pubkey":"YourWalletPubkey","isSigner":true,"isWritable":true}],"tipLamports":100000}||1 SOL|main`

Fast wallet-out:
- `/setsweep main 0xYourColdWallet` — evm mints from `main` now auto-sweep to this address once confirmed.
- `/sweep main native 8453 0xYourColdWallet` — manually sweep remaining ETH-family balance.
- `/sweep main spl <mintAddress> 1 <destinationWallet>` — manually sweep an SPL/NFT token on Solana.
- `/setsweep soltest YourColdSolanaWallet` then `/watchwallet soltest` — solana: continuously watches the wallet and auto-sweeps anything that arrives (SOL, any SPL token, any NFT), not tied to a bot-triggered mint the way evm's auto-sweep is.

Triggers:
- `/schedule testdrop main 2026-08-01T14:00:00Z` — fires the mint automatically at that UTC time, even across a bot restart in between.
- `/watch testdrop|main|function mintActive() view returns (bool)|true|3000` — polls the contract's `mintActive()` every 3s, mints the instant it returns `true`.
- `/watchsol soldrop|main|ProgramStateAccount111...|8|1|01|3000` — solana equivalent, polls a raw account's bytes instead of a view function (offsets shown are illustrative — real ones depend on the target program's account layout).

Before a real mint:
- `/dryrun testdrop main` — simulates the mint against current chain state and checks wallet balance, without sending anything. Catches "would revert" before it costs gas.

## Tuning EVM fees
The mintSpec JSON for an evm target accepts optional fee fields:
- `priorityFeeMultiplier` (default 2) — scales the RPC's priority-fee estimate. This is the number that actually buys inclusion priority on fee-auction chains (Ethereum L1 and similar).
- `maxFeeMultiplier` (default 1.3) — headroom over the current base fee. Doesn't need to be aggressive; it's a ceiling, not a bid.
- `minPriorityFeeWei` (default `"1000000000"`, 1 gwei) — a floor. Some RPCs return a priority-fee estimate of exactly 0 on L2s/testnets, and 0 × any multiplier is still 0 — this guarantees the tx always has *some* competitive priority fee rather than silently having none.
- `gasLimit` — if set, skips the `eth_estimateGas` round-trip at mint time entirely, one less RPC call on the critical path. Run `/dryrun` first, it reports `suggestedGasLimit` (the simulated gas, padded 20%) ready to paste in.

Worth knowing: how much fee-tuning actually matters depends on the chain. Ethereum L1 uses a real priority-fee auction, so being aggressive on `priorityFeeMultiplier` genuinely buys you inclusion priority. Rollups with a centralized sequencer (Arbitrum, Base, Optimism) generally order transactions by arrival time at the sequencer, not by fee, so RPC/network latency and using a fast provider matters more there than outbidding anyone on fee.

`/dryrun` reports the actual priority/max fee it would use (`priorityFeeGwei`, `maxFeeGwei`) so you can see what the defaults resolve to before committing to them.

Multi-wallet:
- `/newwallet evm second` — generates a fresh wallet, address only, never the key. Fund it, then it's usable like any other.
- `/fanoutmint testdrop main,second` or `/fanoutmint testdrop all` — fires the same mint from every listed wallet in parallel.

## Running remotely
See `deploy/README.md` for Google Cloud (Compute Engine) or `deploy/AWS_README.md` for AWS (EC2) — same idea either way: a small always-on VM with a systemd service, so it stays up across reboots and crashes instead of dying when you close your laptop.

## Going from testnet to mainnet
This isn't a code change — the bot already supports any evm chain you configure. What actually changes:

1. **Real money.** Mainnet gas and mint prices cost real ETH, not faucet ETH. There's no undo on a bad mintSpec or a wrong address.
2. **Fund real wallets.** Either `/newwallet evm main` (fresh, then send real ETH to the address it gives you) or import an existing funded wallet locally via `npm run import-wallet`. No faucet exists for mainnet — you're sending your own funds.
3. **Point targets at real chainIds.** Same `/addtarget` syntax, just use the mainnet chainId (1 for Ethereum, 8453 for Base, 42161 for Arbitrum, etc. — see `.env.example`'s reference table) and the real contract address instead of your test contract.
4. **`/dryrun` still works and is worth using every time** — it simulates against live mainnet state, so it'll genuinely tell you if a mint would revert (wrong price, not started, sold out, not allowlisted) before you spend anything.
5. **Start small.** Test a mainnet mint on the cheapest, lowest-stakes real drop you can find before trusting this with anything expensive — the testnet run proved the architecture works, not that every edge case on every contract is handled.
6. **Fan-out multiplies risk with reward.** `/fanoutmint ... all` fires from every wallet in the keystore — make sure every wallet you don't want included isn't sitting in there, or use an explicit label list instead of `all`.

None of this is something I can do for you — funding wallets and pointing at a real drop are decisions with real money attached, so they're yours to make when you're ready.

## Notes
- Targets are stored in `data/targets.json`, schedules in `data/schedules.json`, both plain JSON, no secrets in either.
- `EVM_RPC_URLS` is keyed by chainId, so a mint/sweep/watch on a target automatically uses the RPC(s) configured for that target's `chainId`. A target whose chain has no entry in `EVM_RPC_URLS` fails with a clear error naming the missing chainId, rather than silently trying the wrong network.
- Wallet keys are encrypted at rest in `data/keystore.enc.json`. `/wallets` only ever shows label, chain, address, sweep destination, and balance, never key material. Nothing in the Telegram surface can accept or display a private key.
- Auto-sweep works differently per chain: evm auto-sweeps the specific NFT right after a bot-triggered mint confirms (reads the tokenId out of the receipt's Transfer event). Solana instead uses `/watchwallet` — a standing watch on the wallet itself that sweeps anything that shows up (SOL, any SPL token, any NFT), regardless of what put it there. Both end at the same `sweepTo` destination set via `/setsweep`.
- **Solana multi-signer**: supported via `"$ephemeral:anyName"` as an account's pubkey in mintSpec — the bot generates a fresh keypair and co-signs with it, covering mint flows (some Candy Machine-style programs) that create a brand-new account inline. Any newly-created account address is reported back after the mint. Not yet live-tested against a real program that needs this — the mechanism is sound but unverified end to end.
- **State watching (`/watch`) limitation**: evm only, and only zero-argument view functions returning a single simple value (bool/uint/address). No solana equivalent yet.
- Schedules persist to disk and re-arm on restart. If the bot is down when a scheduled time passes, it's treated as past-due and skipped (with a message) rather than fired late.

## What's actually been tested live vs. still unverified
The full evm feature set has been run for real on Arbitrum Sepolia, not just compiled: `/mint` (build/sign/broadcast/confirm), `/dryrun` (estimateGas simulation), `/setsweep` + auto-sweep on confirmation (Transfer-event parsing + safeTransferFrom), `/schedule` (fired unattended at the scheduled time), and `/watch` (detected a mint triggered outside the bot via Remix and reacted on its own within the poll interval). That's real evidence the evm side of this architecture works end to end, not just that the types check out.

Still unverified against a live RPC, because this build environment has no network access:
- The **Solana mint engine** — Jito bundle submission, multi-RPC fallback, and the stale-blockhash retry path have never touched devnet or mainnet.
- **Solana sweep** (`/sweep native` and `/sweep spl` for solana wallets) — reviewed carefully, never fired for real.
- Solana on-chain *contract* state-watching now has an equivalent to evm's `/watch`: `/watchsol` polls a raw account's bytes (Solana has no view functions, so there's no equivalent to calling a read-only function) and fires a mint once they match. Finding the right byte offset/length needs the target program's account layout — more manual than evm's version, which just needs a function signature. Wallet *deposit* watching (`/watchwallet`) is a different thing — that watches a wallet for anything arriving, not a program account for a condition.
- `/watchwallet` now persists across bot restarts (saved to `data/walletwatches.json`, re-armed automatically on startup) — `/watchsol` and evm's `/watch` do not persist yet, they're purely in-memory and need re-arming manually after a restart.

Before relying on the solana side for a real drop:
1. Test against devnet first — Jito's block engine may not have a devnet equivalent, so the RPC-fallback path is what you'd exercise there; test the Jito tip path carefully on mainnet with a small tip before trusting it on a real drop.
2. Double-check the Jito tip account list in `src/solana/jitoTipAccounts.ts` against Jito's current docs — these accounts have changed before.
3. Watch the fee numbers `/mint` and `/dryrun` compute — Solana's `tipLamports`/`computeUnitPriceMicroLamports` are starting points, not tuned values for any specific drop.
4. The rent/fee buffer in `sweepNativeSolana` (10,000 lamports) is a rough estimate — verify it's enough headroom before relying on a full sweep.
