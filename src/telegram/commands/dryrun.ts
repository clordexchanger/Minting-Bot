import { Bot, InlineKeyboard } from "grammy";
import { getTarget, listTargets } from "../../config/targets.js";
import { dryRunEvmMint } from "../../evm/mintEngine.js";
import { dryRunSolanaMint } from "../../solana/mintEngine.js";
import { listWallets } from "../../wallet/keystore.js";
import { replyLong } from "../replyLong.js";

export function registerDryRun(bot: Bot): void {
  bot.command("dryrun", async (ctx) => {
    const raw = ctx.match?.toString().trim();

    if (!raw) {
      const targets = listTargets();
      if (targets.length === 0) {
        await ctx.reply("No targets configured yet. Add one with /addtarget.");
        return;
      }
      const kb = new InlineKeyboard();
      targets.forEach((t, i) => {
        kb.text(t.label, `dryrun_target_${t.id}`);
        if (i % 2 === 1) kb.row();
      });
      await ctx.reply("Dry-run which target?", { reply_markup: kb });
      return;
    }

    const [targetId, walletLabelArg] = raw.split(/\s+/);
    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply(`No target found matching "${targetId}". Check /listtargets.`);
      return;
    }
    const walletLabel = walletLabelArg || target.wallet;
    if (!walletLabel) {
      await ctx.reply(`Target "${target.label}" has no default wallet and none was given.`);
      return;
    }

    await runDryRun(ctx, target, walletLabel);
  });

  bot.callbackQuery(/^dryrun_target_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const target = getTarget(ctx.match![1]);
    if (!target) {
      await ctx.reply("Target not found.");
      return;
    }

    if (target.wallet) {
      await runDryRun(ctx, target, target.wallet);
      return;
    }

    const wallets = listWallets().filter((w) => w.chain === target.chain);
    if (wallets.length === 0) {
      await ctx.reply(`No ${target.chain} wallets available. Add one with /newwallet first.`);
      return;
    }
    const kb = new InlineKeyboard();
    wallets.forEach((w, i) => {
      kb.text(w.label, `dryrun_wallet::${target.id}::${w.label}`);
      if (i % 2 === 1) kb.row();
    });
    await ctx.reply(`Dry-run ${target.label} using which wallet?`, { reply_markup: kb });
  });

  bot.callbackQuery(/^dryrun_wallet::([^:]+)::(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, targetId, walletLabel] = ctx.match!;
    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply("Target not found.");
      return;
    }
    await runDryRun(ctx, target, walletLabel);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runDryRun(ctx: any, target: any, walletLabel: string): Promise<void> {
  await ctx.reply(`Running dry run for ${target.label}... (no transaction will be sent)`);
  try {
    const result =
      target.chain === "evm" ? await dryRunEvmMint(target, walletLabel) : await dryRunSolanaMint(target, walletLabel);

    const infoLines = Object.entries(result.info).map(([k, v]) => `  ${k}: ${v}`);
    const lines = [
      result.ok ? "✅ Dry run passed — this mint would likely succeed." : "❌ Dry run found issues:",
      ...(result.ok ? [] : result.issues.map((i: string) => `  - ${i}`)),
      "",
      "Details:",
      ...infoLines,
    ];
    await replyLong(ctx, lines.join("\n"));
  } catch (err) {
    await ctx.reply(`Dry run itself failed to run: ${err instanceof Error ? err.message : String(err)}`);
  }
}
