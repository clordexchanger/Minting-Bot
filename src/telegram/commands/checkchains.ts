import { Bot } from "grammy";
import { checkAllChains } from "../../evm/chainCheck.js";
import { replyLong } from "../replyLong.js";

// Human-readable labels for the chains this project's .env.example ships
// with. Anything not in this map just shows as "chainId N" — still useful,
// just less pretty.
const CHAIN_NAMES: Record<string, string> = {
  "1": "Ethereum",
  "11155111": "Ethereum Sepolia",
  "8453": "Base",
  "84532": "Base Sepolia",
  "42161": "Arbitrum",
  "421614": "Arbitrum Sepolia",
  "10": "Optimism",
  "11155420": "Optimism Sepolia",
  "137": "Polygon",
  "80002": "Polygon Amoy",
  "7777777": "Zora",
  "999999999": "Zora Sepolia",
  "2741": "Abstract",
  "11124": "Abstract Testnet",
  "143": "Monad",
  "10143": "Monad Testnet",
  "2020": "Ronin",
  "2021": "Ronin Saigon",
  "999": "Hyperliquid",
  "998": "Hyperliquid Testnet",
  "9745": "Plasma",
  "9746": "Plasma Testnet",
  "4663": "Robinhood",
  "46630": "Robinhood Testnet",
};

export function registerCheckChains(bot: Bot): void {
  bot.command("checkchains", async (ctx) => {
    await ctx.reply("Checking RPC connectivity for every configured chain...");

    const results = await checkAllChains();
    if (results.length === 0) {
      await ctx.reply("No chains configured in EVM_RPC_URLS.");
      return;
    }

    const lines = results.map((r) => {
      const name = CHAIN_NAMES[r.chainId] ?? `chainId ${r.chainId}`;
      return r.ok
        ? `✅ ${name} (${r.chainId}) — block ${r.blockNumber}, ${r.latencyMs}ms`
        : `❌ ${name} (${r.chainId}) — ${r.error}`;
    });

    const failCount = results.filter((r) => !r.ok).length;
    const summary = failCount === 0 ? "All chains connected." : `${failCount} of ${results.length} failed — check the chainId/URL for those.`;

    await replyLong(ctx, [summary, "", ...lines].join("\n"));
  });
}
