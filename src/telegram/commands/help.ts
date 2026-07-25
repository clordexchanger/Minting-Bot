import { Bot } from "grammy";

const HELP_TEXT = `*Commands*

*Easiest way to use this bot*: run /addtarget, /mint, /dryrun, or /schedule with no arguments and it walks you through it with tappable buttons instead of needing exact syntax. /cancel stops a walk-through in progress. The syntax below still works too, for anyone who wants to skip straight to a one-liner.

/addtarget label|chain|address|mintSpec|chainId|priceNote|wallet
  chain is "evm" or "solana". chainId only matters for evm (required for evm targets). priceNote and wallet are optional.

  For evm targets, mintSpec must be JSON (no "|" inside it, since "|" is the field separator):
  {"functionAbi":"function mint(uint256 quantity) payable","args":[1],"valueEth":"0.01"}
  Optional fee-tuning fields: priorityFeeMultiplier (default 2), maxFeeMultiplier (default 1.3), minPriorityFeeWei (default "1000000000" — a floor, since RPC fee estimates sometimes come back as 0 on L2s/testnets), gasLimit (skips the gas-estimation round-trip at mint time if set — run /dryrun first, it suggests one).
  Example: /addtarget coolcats|evm|0xabc...|{"functionAbi":"function mint(uint256) payable","args":[1],"valueEth":"0.01","gasLimit":"85000"}|8453|0.01 ETH|main

  Solana mintSpec must also be JSON — the instruction's raw data and account list, since Solana programs don't share a common ABI format the way EVM contracts do:
  {"instructionDataBase64":"...","accounts":[{"pubkey":"...","isSigner":true,"isWritable":true}],"tipLamports":100000,"computeUnitPriceMicroLamports":50000}
  tipLamports triggers a Jito bundle submission for priority landing; omit it (or set 0) to just broadcast to configured RPCs. The guided /addtarget walk-through only covers evm — solana targets need this manual syntax.

/listtargets — show all configured targets
/removetarget <label or id>
/wallets — list imported wallets and balances (never shows key material)
/newwallet <chain> <label> — generate a brand-new wallet right from Telegram. This only ever creates a fresh key and tells you the address — it never asks for or displays a private key, so it's safe to use in chat.
/removewallet <label> — remove a wallet from the keystore

/mint [target] [walletLabel] — fire a mint now, evm or solana. Run with no args to pick from buttons instead. Broadcasts to every configured RPC at once (plus Jito for solana if a tip is set) and waits for confirmation. On evm, auto-sweeps the minted NFT if /setsweep was run for that wallet.
/fanoutmint <target> <label1,label2,...|all> — fire the same mint from several wallets at once, in parallel, to raise your odds on a per-wallet-capped drop (evm only).
/dryrun [target] [walletLabel] — validate a mint without sending anything. Run with no args to pick from buttons. Checks wallet balance and simulates the call against current chain state, so a mint that would revert or fail shows up here instead of burning a real attempt.
/setsweep <walletLabel> <destinationAddress> — set where a wallet's fast wallet-out sends assets.
/sweep <walletLabel> native|nft|spl ... — manual fast wallet-out. Run with no args for the exact syntax per chain.

/schedule [target] [walletLabel] [isoTimestamp] — mint automatically at a future time. Run with no args to pick target/wallet/time from buttons (including quick options like "+30 min"). One-liner example: /schedule coolcats main 2026-08-01T14:00:00Z
/schedules — list pending schedules
/unschedule <id> — cancel one

/watch target|walletLabel|viewFunctionAbi|triggerWhen|intervalMs — poll a read-only evm contract function and auto-mint the instant it matches triggerWhen. Example:
  /watch coolcats|main|function mintActive() view returns (bool)|true|3000
/unwatch <target> — stop an active watch. Solana state-watching isn't implemented — schedule or manual-arm instead.

/status — wallet + target summary
/checkchains — pings every chain configured in EVM_RPC_URLS and reports which ones actually connect. Run this after editing your RPC config, especially for less common chains, before trusting any of them for a real mint.
/cancel — stop a guided walk-through (/addtarget, /schedule) in progress
/help — this message

*Wallets* — two ways to get one into the bot:
- \`/newwallet evm main\` — bot generates a fresh key, tells you the address, never shows the key. Safe to run in Telegram.
- Already have a key you want to use? That import stays local-only, never through Telegram: \`npm run import-wallet -- --chain evm --label main --key 0x...\`
- Need the raw key back out (e.g. to view in MetaMask)? Also local-only: \`npm run export-wallet -- --label main\`

Solana sweep for the NFT itself needs the mint address by hand right now — see /sweep spl. Auto-sweep only covers evm for the moment.`;

export function registerHelp(bot: Bot): void {
  bot.command(["help", "start"], async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
  });
}
