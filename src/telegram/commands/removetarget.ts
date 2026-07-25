import { Bot } from "grammy";
import { removeTarget } from "../../config/targets.js";

export function registerRemoveTarget(bot: Bot): void {
  bot.command("removetarget", async (ctx) => {
    const idOrLabel = ctx.match?.toString().trim();
    if (!idOrLabel) {
      await ctx.reply("Usage: /removetarget <label or id>");
      return;
    }

    const removed = removeTarget(idOrLabel);
    await ctx.reply(removed ? `Removed "${idOrLabel}".` : `No target found matching "${idOrLabel}".`);
  });
}
