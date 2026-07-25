import { Bot, InlineKeyboard, Context } from "grammy";
import { getTarget, listTargets } from "../../config/targets.js";
import { listWallets } from "../../wallet/keystore.js";
import { scheduleMint } from "../../scheduler/scheduler.js";
import { getWizard, setWizard, clearWizard } from "../wizard.js";

export function registerSchedule(bot: Bot): void {
  // ---- Fast path: original one-line syntax. ----
  bot.command("schedule", async (ctx, next) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) return next();

    const [targetId, walletLabel, ...timeParts] = raw.split(/\s+/);
    const fireAtIso = timeParts.join(" ");
    if (!targetId || !walletLabel || !fireAtIso) {
      await ctx.reply("Usage: /schedule <target> <walletLabel> <isoTimestamp>\n\nOr run /schedule with no arguments for a guided walk-through instead.");
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

  // ---- Guided wizard: /schedule with no arguments. ----
  bot.command("schedule", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (raw) return;

    const targets = listTargets();
    if (targets.length === 0) {
      await ctx.reply("No targets configured yet. Add one first with /addtarget.");
      return;
    }

    setWizard(ctx.chat.id, { kind: "schedule", step: 0, data: {} });
    const kb = new InlineKeyboard();
    targets.forEach((t, i) => {
      kb.text(t.label, `wizsched_target_${t.id}`);
      if (i % 2 === 1) kb.row();
    });
    await ctx.reply("Which target do you want to schedule? Send /cancel any time to stop.", { reply_markup: kb });
  });

  bot.callbackQuery(/^wizsched_target_(.+)$/, async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "schedule") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const target = getTarget(ctx.match![1]);
    if (!target) {
      await ctx.reply("Target not found — start over with /schedule.");
      clearWizard(ctx.chat!.id);
      return;
    }
    wizard.data.targetId = target.id;

    const wallets = listWallets().filter((w) => w.chain === target.chain);        
    if (wallets.length === 0 && !target.wallet) {
      await ctx.reply(`No ${target.chain} wallets available. Add one with /newwallet first.`);
      clearWizard(ctx.chat!.id);
      return;
    }
    if (wallets.length <= 1 && target.wallet) {
      wizard.data.wallet = target.wallet;
      wizard.step = 2;
      setWizard(ctx.chat!.id, wizard);
      await askForTime(ctx);
      return;
    }

    wizard.step = 1;
    setWizard(ctx.chat!.id, wizard);
    const kb = new InlineKeyboard();
    wallets.forEach((w, i) => {
      kb.text(w.label, `wizsched_wallet_${w.label}`);
      if (i % 2 === 1) kb.row();
    });
    await ctx.reply("Which wallet?", { reply_markup: kb });
  });

  bot.callbackQuery(/^wizsched_wallet_(.+)$/, async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "schedule") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    wizard.data.wallet = ctx.match![1];
    wizard.step = 2;
    setWizard(ctx.chat!.id, wizard);
    await askForTime(ctx);
  });

  bot.callbackQuery(/^wizsched_time_(\d+)$/, async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "schedule") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const minutesFromNow = Number(ctx.match![1]);
    const fireAt = new Date(Date.now() + minutesFromNow * 60_000).toISOString();  
    clearWizard(ctx.chat!.id);
    await finalizeSchedule(bot, ctx, wizard.data, fireAt);
  });

  bot.callbackQuery("wizsched_time_custom", async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "schedule") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    wizard.step = 3;
    setWizard(ctx.chat!.id, wizard);
    await ctx.reply("Type the exact time in ISO format, e.g. 2026-08-01T14:00:00Z");
  });

  bot.on("message:text", async (ctx, next) => {
    const wizard = getWizard(ctx.chat.id);
    if (!wizard || wizard.kind !== "schedule" || wizard.step !== 3) return next();
    const text = ctx.message.text.trim();

    if (text.startsWith("/")) {
      clearWizard(ctx.chat.id);
      return next();
    }

    clearWizard(ctx.chat.id);
    await finalizeSchedule(bot, ctx, wizard.data, text);
  });
}

async function askForTime(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text("+5 min", "wizsched_time_5")
    .text("+30 min", "wizsched_time_30")
    .row()
    .text("+1 hour", "wizsched_time_60")
    .text("+1 day", "wizsched_time_1440")
    .row()
    .text("Custom time", "wizsched_time_custom");
  await ctx.reply("When should this fire?", { reply_markup: kb });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finalizeSchedule(bot: Bot, ctx: Context, data: Record<string, any>, fireAtIso: string): Promise<void> {
  try {
    const entry = scheduleMint(bot, data.targetId, data.wallet, fireAtIso, ctx.chat!.id);
    const delayMs = new Date(entry.fireAtIso).getTime() - Date.now();
    await ctx.reply(`Scheduled to fire at ${entry.fireAtIso} (in ~${Math.round(delayMs / 1000)}s). Schedule id: ${entry.id}`);
  } catch (err) {
    await ctx.reply(err instanceof Error ? err.message : String(err));
  }
}