import { Bot, InlineKeyboard } from "grammy";
import { getTarget, listTargets } from "../../config/targets.js";
import { executeMint } from "../../mint/executeMint.js";
import { listWallets } from "../../wallet/keystore.js";

export function registerMint(bot: Bot): void {
  bot.command("mint", async (ctx) => {
    const raw = ctx.match?.toString().trim();

    if (!raw) {
      // No args — quick-pick via buttons instead of requiring exact typed syntax.
      const targets = listTargets();
      if (targets.length === 0) {
        await ctx.reply("No targets configured yet. Add one with /addtarget.");
        return;
      }
      const kb = new InlineKeyboard();
      targets.forEach((t, i) => {
        kb.text(t.label, `mint_target_${t.id}`);
        if (i % 2 === 1) kb.row();
      });
      await ctx.reply("Mint which target?", { reply_markup: kb });
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

  bot.callbackQuery(/^mint_target_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const target = getTarget(ctx.match![1]);
    if (!target) {
      await ctx.reply("Target not found.");
      return;
    }

    if (target.wallet) {
      await executeMint(bot, ctx.chat!.id, target, target.wallet);
      return;
    }

    const wallets = listWallets().filter((w) => w.chain === target.chain);
    if (wallets.length === 0) {
      await ctx.reply(`No ${target.chain} wallets available. Add one with /newwallet first.`);
      return;
    }
    const kb = new InlineKeyboard();
    wallets.forEach((w, i) => {
      kb.text(w.label, `mint_wallet::${target.id}::${w.label}`);
      if (i % 2 === 1) kb.row();
    });
    await ctx.reply(`Mint ${target.label} from which wallet?`, { reply_markup: kb });
  });

  bot.callbackQuery(/^mint_wallet::([^:]+)::(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, targetId, walletLabel] = ctx.match!;
    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply("Target not found.");
      return;
    }
    await executeMint(bot, ctx.chat!.id, target, walletLabel);
  });
}
