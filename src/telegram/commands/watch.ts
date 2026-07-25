import { Bot } from "grammy";
import { getTarget } from "../../config/targets.js";
import { watchEvmCondition } from "../../evm/stateWatch.js";
import { registerWatch, stopWatch, clearWatch, listActiveWatches } from "../../evm/watchRegistry.js";
import { executeMint } from "../../mint/executeMint.js";
import { logger } from "../../utils/logger.js";
import type { Address } from "viem";

// Pipe-delimited since viewFunctionAbi contains spaces:
// /watch target|walletLabel|viewFunctionAbi|triggerWhen|intervalMs
export function registerWatchCommands(bot: Bot): void {
  bot.command("watch", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply(
        'Usage: /watch target|walletLabel|viewFunctionAbi|triggerWhen|intervalMs\nExample: /watch coolcats|main|function mintActive() view returns (bool)|true|3000'
      );
      return;
    }

    const parts = raw.split("|").map((p) => p.trim());
    const [targetId, walletLabel, viewFunctionAbi, triggerWhen, intervalMsRaw] = parts;
    if (!targetId || !walletLabel || !viewFunctionAbi || !triggerWhen) {
      await ctx.reply("Missing fields. Need: target|walletLabel|viewFunctionAbi|triggerWhen|intervalMs");
      return;
    }

    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply(`No target found matching "${targetId}". Check /listtargets.`);
      return;
    }
    if (target.chain !== "evm") {
      await ctx.reply("State watching only works for evm targets right now.");
      return;
    }

    if (!target.chainId) {
      await ctx.reply(`Target "${target.label}" has no chainId set.`);
      return;
    }

    const intervalMs = intervalMsRaw ? Number(intervalMsRaw) : 3000;
    const chatId = ctx.chat.id;

    let handle;
    try {
      handle = watchEvmCondition(
        target.address as Address,
        target.chainId,
        viewFunctionAbi,
        triggerWhen,
        intervalMs,
        () => {
          clearWatch(target.id);
          bot.api.sendMessage(chatId, `Condition met for ${target.label} — firing mint.`).catch(() => {});
          executeMint(bot, chatId, target, walletLabel).catch((err) => logger.error("Watch-triggered mint failed", { err: String(err) }));
        },
        (err) => logger.warn("Watch poll error, retrying next interval", { target: target.label, err: String(err) })
      );
    } catch (err) {
      await ctx.reply(err instanceof Error ? err.message : String(err));
      return;
    }

    registerWatch(target.id, handle);
    await ctx.reply(`Watching *${target.label}* every ${intervalMs}ms for \`${viewFunctionAbi}\` == \`${triggerWhen}\`. /unwatch ${target.label} to stop.`, {
      parse_mode: "Markdown",
    });
  });

  bot.command("unwatch", async (ctx) => {
    const targetId = ctx.match?.toString().trim();
    if (!targetId) {
      await ctx.reply(`Usage: /unwatch <target>\nActive: ${listActiveWatches().join(", ") || "none"}`);
      return;
    }
    const target = getTarget(targetId);
    const id = target?.id ?? targetId;
    const stopped = stopWatch(id);
    await ctx.reply(stopped ? `Stopped watching ${targetId}.` : `No active watch found for "${targetId}".`);
  });
}
