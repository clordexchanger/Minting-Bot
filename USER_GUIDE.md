# User Guide — Telegram NFT Mint Bot

Everything you need to actually use the bot day to day. For setup/deployment, see README.md, deploy/README.md (Google Cloud), and deploy/AWS_README.md instead — this file is about using the bot once it's running.

## Before adding any target: gather the info

For any drop you want to mint, you need four things:

1. **Contract address** — from the project's official mint page, their Discord, or by searching the project name on Etherscan/Basescan/Arbiscan (whichever explorer matches the chain).
2. **Which chain** — usually stated on the mint page. Needs to match a chain you've configured in `EVM_RPC_URLS` (check with `/checkchains`).
3. **Does the mint function take a quantity?** — on the block explorer, open the contract page → "Contract" tab → "Write Contract" (or "Write as Proxy" for proxy contracts). Find the function named `mint`, `publicMint`, or similar. If it shows an input field like `quantity` or `amount`, it takes an argument. If it has no input fields, it doesn't.
4. **Is it payable, and what's the price?** — same Write Contract page: a payable function shows a "payableAmount (ether)" field. The price is also usually stated on the project's own mint page.

Once you have those four things, you're ready to use `/addtarget`.

## Adding a target

### Guided way (recommended)
Send `/addtarget` with nothing after it. The bot walks you through it:

| It asks | You answer |
|---|---|
| Label | Any short name you'll remember, e.g. `coolcats` |
| Contract address | The 0x... address from step 1 above |
| Which chain? | Tap a button, or "Other" to type a chain ID not listed |
| Takes a quantity argument? | Tap Yes or No, based on what you found on the explorer |
| — if Yes | Type how many to mint per call, e.g. `1` |
| Is it payable? | Tap Yes or No |
| — if Yes | Type the price in ETH, e.g. `0.01` |
| Default wallet? | Tap a wallet, or "None / set later" |

`/cancel` stops the walk-through at any point.

**This guided flow only covers evm targets with a simple mint shape** (no args, or a single quantity arg; free or a flat ETH price). If the contract's mint function is more complex — multiple arguments, a merkle proof for an allowlist, etc. — or the target is on solana, use the manual syntax below instead.

### Manual one-liner (for anything the wizard can't handle, or if you just prefer it)
```
/addtarget label|chain|address|mintSpec|chainId|priceNote|wallet
```
- `chain` is `evm` or `solana`.
- `chainId` is required for evm (see `.env.example` for the reference table of common ones).
- `priceNote` and `wallet` are optional.
- For evm, `mintSpec` must be JSON (careful: no `|` characters inside it, since `|` separates the other fields):
  ```
  {"functionAbi":"function mint(uint256 quantity) payable","args":[1],"valueEth":"0.01"}
  ```
  Optional extra fields in that JSON: `priorityFeeMultiplier`, `maxFeeMultiplier`, `minPriorityFeeWei`, `gasLimit` — see README.md's "Tuning EVM fees" section.
- For solana, `mintSpec` is also JSON, but holds the raw instruction data and accounts instead of a function signature — see `/help` for the exact shape.

Example:
```
/addtarget coolcats|evm|0xabc123...|{"functionAbi":"function mint(uint256) payable","args":[1],"valueEth":"0.01"}|8453|0.01 ETH|main
```

### Managing targets
- `/listtargets` — see everything you've added.
- `/removetarget <label>` — delete one.

## Wallets

- `/newwallet evm main` — generates a brand-new wallet from inside Telegram. Only ever tells you the address, never the private key — safe to run in chat. Fund the address it gives you before using it.
- `/wallets` — list every wallet, its address, balance per chain, and sweep destination.
- `/removewallet <label>` — delete one from the keystore.

Already have a private key you want to use instead of generating a new one? That import stays **local-only, never through Telegram**:
```
npm run import-wallet -- --chain evm --label main --key 0xyourprivatekey
```
Need the raw key back out later (e.g. to view in MetaMask)? Also local-only:
```
npm run export-wallet -- --label main
```

## Minting

- `/mint` (no args) — shows your targets as buttons, tap one, then tap a wallet if the target doesn't have a default. Fires immediately.
- `/mint <target> [walletLabel]` — same thing as a one-liner. Wallet is optional if the target has a default set.
- `/fanoutmint <target> <label1,label2,...|all>` — fires the same mint from several wallets at once, in parallel. Use this to raise your odds on a drop that caps how many an individual wallet can mint. `all` uses every evm wallet in the keystore — double check `/wallets` first so you know exactly what's in there before using `all`.

Every mint broadcasts to every RPC configured for that chain simultaneously, waits for confirmation, and — if you've set a sweep destination for the wallet (see below) — automatically moves the minted NFT out the moment it confirms.

## Before minting for real: dry run it

- `/dryrun` (no args) — same button picker as `/mint`, but never actually sends anything.
- `/dryrun <target> [walletLabel]` — one-liner version.

This simulates the mint against live chain state (the same way the real transaction would be validated) and checks your wallet's balance. If the mint would revert — sold out, not started yet, wrong price, wallet not allowlisted — this tells you *before* you spend any gas. Get in the habit of running this before every real mint, especially the first time you use a new target.

## Getting the NFT out of the mint wallet fast (sweeping)

- `/setsweep <walletLabel> <destinationAddress>` — set where a wallet's fast wallet-out sends assets. Once set, every evm mint from that wallet automatically sweeps the newly-minted NFT to that address the moment it confirms — no extra command needed.
- `/sweep <walletLabel> native|nft|spl ...` — manual sweep, for when you want to move something without waiting for a mint to trigger it. Run with no arguments to see the exact syntax for each mode (moving leftover ETH, a specific NFT, or a solana token).

## Scheduling a mint for later

- `/schedule` (no args) — pick a target, then a wallet (if it has more than one available), then a time via quick buttons (+5 min, +30 min, +1 hour, +1 day, or type an exact time).
- `/schedule <target> <walletLabel> <isoTimestamp>` — one-liner version, e.g. `/schedule coolcats main 2026-08-01T14:00:00Z`.
- `/schedules` — list everything pending.
- `/unschedule <id>` — cancel one.

Schedules are saved to disk, so they survive the bot restarting — if the server reboots between now and when it's due to fire, it'll still go off on schedule (unless the reboot happens *after* the scheduled time already passed, in which case it's marked past-due and skipped rather than fired late).

## Auto-minting the instant a contract's state changes (evm only)

```
/watch target|walletLabel|viewFunctionAbi|triggerWhen|intervalMs
```
Example:
```
/watch coolcats|main|function mintActive() view returns (bool)|true|3000
```
This polls that read-only function every `intervalMs` (3000 = every 3 seconds) and fires the mint the instant the result matches `triggerWhen`. Useful for drops where you know the exact contract function that flips when minting opens, but not the exact time.

`/unwatch <target>` stops an active watch. Solana state-watching isn't implemented — use `/schedule` instead for solana targets where you know the time, or mint manually with `/mint` the moment you see it's live.

## Checking on things

- `/status` — quick summary: how many targets and wallets you have, which chains are configured, pending schedules, active watches.
- `/wallets` — every wallet with balance and sweep destination.
- `/checkchains` — pings every chain in your `EVM_RPC_URLS` config and tells you which ones actually connect. Run this any time you edit your RPC config, especially for less common chains.
- `/cancel` — stops a guided walk-through (`/addtarget` or `/schedule`) if you're stuck partway through one.
- `/help` — full command reference, always current with whatever's actually built into the bot at the time you run it.

## Quick reference — everything in one place

| Command | What it does |
|---|---|
| `/addtarget` | Add a mint target (guided, or one-liner with args) |
| `/listtargets` | List targets |
| `/removetarget <label>` | Delete a target |
| `/newwallet <chain> <label>` | Generate a wallet (never shows the key) |
| `/wallets` | List wallets + balances |
| `/removewallet <label>` | Delete a wallet |
| `/mint [target] [wallet]` | Mint now |
| `/fanoutmint <target> <wallets\|all>` | Mint from multiple wallets at once |
| `/dryrun [target] [wallet]` | Simulate a mint without sending it |
| `/setsweep <wallet> <address>` | Set auto-sweep destination |
| `/sweep <wallet> native\|nft\|spl` | Manual sweep |
| `/schedule [target] [wallet] [time]` | Mint at a future time |
| `/schedules` | List pending schedules |
| `/unschedule <id>` | Cancel a schedule |
| `/watch target\|wallet\|abi\|value\|ms` | Auto-mint on a contract condition |
| `/unwatch <target>` | Stop a watch |
| `/status` | Bot summary |
| `/checkchains` | Test RPC connectivity per chain |
| `/cancel` | Stop a guided walk-through |
| `/help` | Full command reference |
