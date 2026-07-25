import { Bot } from "grammy";
import { getTarget } from "../../config/targets.js";
import { executeMint } from "../../mint/executeMint.js";

export function registerMint(bot: Bot): void {
  bot.command("mint", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply("Usage: /mint <target label or id> [walletLabel]\nWallet is optional if the target has a default wallet set.");
      return;
    }

    const [targetId, walletLabelArg] = raw.split(/\s+/);
    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply(`No target found matching "${targetId}". Check /listtargets.`);
      return;
    }

    await executeMint(bot, ctx.chat.id, target, walletLabelArg);
  });
}
