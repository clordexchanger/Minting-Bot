import { Bot } from "grammy";
import { listTargets } from "../../config/targets.js";
import { listWallets } from "../../wallet/keystore.js";
import { listSchedules } from "../../scheduler/store.js";
import { listActiveWatches } from "../../evm/watchRegistry.js";
import { env } from "../../config/env.js";

export function registerStatus(bot: Bot): void {
  bot.command("status", async (ctx) => {
    const targets = listTargets();
    const evmCount = targets.filter((t) => t.chain === "evm").length;
    const solCount = targets.filter((t) => t.chain === "solana").length;
    const wallets = listWallets();

    const lines = [
      "*Bot status*",
      `Targets: ${targets.length} (${evmCount} evm, ${solCount} solana)`,
      `Wallets: ${wallets.length} (see /wallets for balances)`,
      `EVM chains configured: ${Object.keys(env.evmRpcMap).length ? Object.keys(env.evmRpcMap).join(", ") : "none"}`,
      `Solana RPCs configured: ${env.solanaRpcUrls.length}`,
      "EVM mint engine: live",
      "Solana mint engine: live (Jito bundle + multi-RPC fallback)",
      `Jito block engine: ${env.jitoBlockEngineUrl}`,
      `Sweep destinations configured: ${wallets.filter((w) => w.sweepTo).length}/${wallets.length}`,
      `Pending schedules: ${listSchedules().length}`,
      `Active watches: ${listActiveWatches().length}`,
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
