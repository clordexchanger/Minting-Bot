import { Bot } from "grammy";
import { listSchedules } from "../../scheduler/store.js";
import { cancelSchedule } from "../../scheduler/scheduler.js";
import { getTarget } from "../../config/targets.js";

export function registerSchedules(bot: Bot): void {
  bot.command("schedules", async (ctx) => {
    const entries = listSchedules();
    if (entries.length === 0) {
      await ctx.reply("No schedules pending.");
      return;
    }
    const lines = entries.map((e) => {
      const target = getTarget(e.targetId);
      return `• ${e.id} — ${target?.label ?? e.targetId} @ ${e.fireAtIso} (wallet: ${e.walletLabel})`;
    });
    await ctx.reply(lines.join("\n"));
  });

  bot.command("unschedule", async (ctx) => {
    const id = ctx.match?.toString().trim();
    if (!id) {
      await ctx.reply("Usage: /unschedule <id>");
      return;
    }
    const removed = cancelSchedule(id);
    await ctx.reply(removed ? `Cancelled schedule ${id}.` : `No schedule found with id "${id}".`);
  });
}
