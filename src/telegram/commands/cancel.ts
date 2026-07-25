import { Bot } from "grammy";
import { getWizard, clearWizard } from "../wizard.js";

export function registerCancel(bot: Bot): void {
  bot.command("cancel", async (ctx) => {
    const hadWizard = getWizard(ctx.chat.id);
    clearWizard(ctx.chat.id);
    await ctx.reply(hadWizard ? "Cancelled." : "Nothing to cancel.");
  });
}
