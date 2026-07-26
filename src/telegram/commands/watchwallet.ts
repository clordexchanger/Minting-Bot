import { Bot } from "grammy";
import { listWallets } from "../../wallet/keystore.js";
import { watchSolanaWalletDeposits } from "../../solana/walletWatch.js";
import { registerWalletWatch, stopWalletWatch, listActiveWalletWatches } from "../../solana/walletWatchRegistry.js";

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

    const handle = watchSolanaWalletDeposits(walletLabel, intervalMs, (message) => {
      bot.api.sendMessage(chatId, message).catch(() => {});
    });
    registerWalletWatch(walletLabel, handle);

    await ctx.reply(
      `Watching wallet *${walletLabel}* every ${intervalMs}ms — anything that arrives (SOL or any SPL token/NFT) gets auto-swept to \`${wallet.sweepTo}\`. /unwatchwallet ${walletLabel} to stop.`,
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
    await ctx.reply(stopped ? `Stopped watching ${walletLabel}.` : `No active watch found for "${walletLabel}".`);
  });
}
