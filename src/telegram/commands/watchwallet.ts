import { Bot } from "grammy";
import { listWallets } from "../../wallet/keystore.js";
import { watchSolanaWalletDeposits } from "../../solana/walletWatch.js";
import { registerWalletWatch, stopWalletWatch, listActiveWalletWatches } from "../../solana/walletWatchRegistry.js";
import { addWalletWatchEntry, removeWalletWatchEntry, listWalletWatchEntries } from "../../solana/walletWatchStore.js";
import { logger } from "../../utils/logger.js";

function arm(bot: Bot, walletLabel: string, intervalMs: number, chatId: number): void {
  const handle = watchSolanaWalletDeposits(walletLabel, intervalMs, (message) => {
    bot.api.sendMessage(chatId, message).catch(() => {});
  });
  registerWalletWatch(walletLabel, handle);
}

/** Call once at startup — reloads any wallet watches that survived a restart and re-arms them. */
export function initWalletWatches(bot: Bot): void {
  const entries = listWalletWatchEntries();
  for (const entry of entries) {
    arm(bot, entry.walletLabel, entry.intervalMs, entry.chatId);
  }
  logger.info("Wallet watches initialized", { count: entries.length });
}

export function registerWatchWallet(bot: Bot): void {
  bot.command("watchwallet", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply(
        `Usage: /watchwallet <walletLabel> [intervalMs]\nActive: ${listActiveWalletWatches().join(", ") || "none"}`
      );
      return;
    }

    const [walletLabel, intervalMsRaw] = raw.split(/\s+/);
    const wallet = listWallets().find((w) => w.label === walletLabel);
    if (!wallet) {
      await ctx.reply(`No wallet found with label "${walletLabel}". Check /wallets.`);
      return;
    }
    if (wallet.chain !== "solana") {
      await ctx.reply("Wallet deposit-watching currently only supports solana wallets.");
      return;
    }
    if (!wallet.sweepTo) {
      await ctx.reply(`Wallet "${walletLabel}" has no sweep destination set. Run /setsweep ${walletLabel} <address> first.`);
      return;
    }

    const intervalMs = intervalMsRaw ? Number(intervalMsRaw) : 10_000;
    const chatId = ctx.chat.id;

    arm(bot, walletLabel, intervalMs, chatId);
    addWalletWatchEntry({ walletLabel, intervalMs, chatId });

    await ctx.reply(
      `Watching wallet *${walletLabel}* every ${intervalMs}ms — anything that arrives (SOL or any SPL token/NFT) gets auto-swept to \`${wallet.sweepTo}\`. Survives a bot restart. /unwatchwallet ${walletLabel} to stop.`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("unwatchwallet", async (ctx) => {
    const walletLabel = ctx.match?.toString().trim();
    if (!walletLabel) {
      await ctx.reply(`Usage: /unwatchwallet <walletLabel>\nActive: ${listActiveWalletWatches().join(", ") || "none"}`);
      return;
    }
    const stopped = stopWalletWatch(walletLabel);
    removeWalletWatchEntry(walletLabel);
    await ctx.reply(stopped ? `Stopped watching ${walletLabel}.` : `No active watch found for "${walletLabel}" (removed from persisted list either way, in case it was stale).`);
  });
}
