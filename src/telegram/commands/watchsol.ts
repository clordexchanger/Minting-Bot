import { Bot } from "grammy";
import { getTarget } from "../../config/targets.js";
import { watchSolanaAccountCondition } from "../../solana/stateWatch.js";
import { registerSolWatch, stopSolWatch, clearSolWatch, listActiveSolWatches } from "../../solana/watchRegistry.js";
import { executeMint } from "../../mint/executeMint.js";
import { logger } from "../../utils/logger.js";

const USAGE =
  'Usage: /watchsol target|walletLabel|accountPubkey|byteOffset|byteLength|expectedHex|intervalMs\n' +
  "Polls a raw account's bytes at [byteOffset, byteOffset+byteLength) and fires the mint once they equal expectedHex (hex, no 0x needed). Finding the right offset means knowing the program's account layout ahead of time (Anchor IDL, source, or an Anchor-aware explorer) — this is more expert-level than evm's /watch, not a shortcut around it.\n" +
  "Example (offsets are program-specific, this is illustrative only): /watchsol mydrop|main|4mint1111...AccountPubkey|8|1|01|3000";

export function registerWatchSol(bot: Bot): void {
  bot.command("watchsol", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply(USAGE);
      return;
    }

    const parts = raw.split("|").map((p) => p.trim());
    const [targetId, walletLabel, accountPubkey, byteOffsetRaw, byteLengthRaw, expectedHex, intervalMsRaw] = parts;
    if (!targetId || !walletLabel || !accountPubkey || !byteOffsetRaw || !byteLengthRaw || !expectedHex) {
      await ctx.reply("Missing fields.\n\n" + USAGE);
      return;
    }

    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply(`No target found matching "${targetId}". Check /listtargets.`);
      return;
    }
    if (target.chain !== "solana") {
      await ctx.reply("/watchsol is for solana targets only — use /watch for evm.");
      return;
    }

    const byteOffset = Number(byteOffsetRaw);
    const byteLength = Number(byteLengthRaw);
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || !Number.isInteger(byteLength) || byteLength <= 0) {
      await ctx.reply("byteOffset and byteLength must be non-negative whole numbers.\n\n" + USAGE);
      return;
    }

    const intervalMs = intervalMsRaw ? Number(intervalMsRaw) : 3000;
    const chatId = ctx.chat.id;

    let handle;
    try {
      handle = watchSolanaAccountCondition(
        accountPubkey,
        byteOffset,
        byteLength,
        expectedHex,
        intervalMs,
        () => {
          clearSolWatch(target.id);
          bot.api.sendMessage(chatId, `Condition met for ${target.label} — firing mint.`).catch(() => {});
          executeMint(bot, chatId, target, walletLabel).catch((err) =>
            logger.error("Solana watch-triggered mint failed", { err: String(err) })
          );
        },
        (err) => logger.warn("Solana watch poll error, retrying next interval", { target: target.label, err: String(err) })
      );
    } catch (err) {
      await ctx.reply(err instanceof Error ? err.message : String(err));
      return;
    }

    registerSolWatch(target.id, handle);
    await ctx.reply(
      `Watching account ${accountPubkey} every ${intervalMs}ms for bytes[${byteOffset}:${byteOffset + byteLength}] == ${expectedHex}. /unwatchsol ${target.label} to stop.`
    );
  });

  bot.command("unwatchsol", async (ctx) => {
    const targetId = ctx.match?.toString().trim();
    if (!targetId) {
      await ctx.reply(`Usage: /unwatchsol <target>\nActive: ${listActiveSolWatches().join(", ") || "none"}`);
      return;
    }
    const target = getTarget(targetId);
    const id = target?.id ?? targetId;
    const stopped = stopSolWatch(id);
    await ctx.reply(stopped ? `Stopped watching ${targetId}.` : `No active watch found for "${targetId}".`);
  });
}
