import { Bot } from "grammy";
import { getTarget } from "../../config/targets.js";
import { scheduleMint } from "../../scheduler/scheduler.js";

export function registerSchedule(bot: Bot): void {
  bot.command("schedule", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply("Usage: /schedule <target> <walletLabel> <isoTimestamp>\nExample: /schedule testdrop main 2026-08-01T14:00:00Z");
      return;
    }

    const [targetId, walletLabel, ...timeParts] = raw.split(/\s+/);
    const fireAtIso = timeParts.join(" ");
    if (!targetId || !walletLabel || !fireAtIso) {
      await ctx.reply("Usage: /schedule <target> <walletLabel> <isoTimestamp>");
      return;
    }

    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply(`No target found matching "${targetId}". Check /listtargets.`);
      return;
    }

    try {
      const entry = scheduleMint(bot, target.id, walletLabel, fireAtIso, ctx.chat.id);
      const delayMs = new Date(entry.fireAtIso).getTime() - Date.now();
      await ctx.reply(
        `Scheduled *${target.label}* to mint at ${entry.fireAtIso} (in ~${Math.round(delayMs / 1000)}s). Schedule id: ${entry.id}`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(err instanceof Error ? err.message : String(err));
    }
  });
}
