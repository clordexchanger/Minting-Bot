import { Bot } from "grammy";
import { getTarget } from "../../config/targets.js";
import { dryRunEvmMint } from "../../evm/mintEngine.js";
import { dryRunSolanaMint } from "../../solana/mintEngine.js";

export function registerDryRun(bot: Bot): void {
  bot.command("dryrun", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply("Usage: /dryrun <target> [walletLabel]");
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

    await ctx.reply(`Running dry run for ${target.label}... (no transaction will be sent)`);

    try {
      const result =
        target.chain === "evm" ? await dryRunEvmMint(target, walletLabel) : await dryRunSolanaMint(target, walletLabel);

      const infoLines = Object.entries(result.info).map(([k, v]) => `  ${k}: ${v}`);
      const lines = [
        result.ok ? "✅ Dry run passed — this mint would likely succeed." : "❌ Dry run found issues:",
        ...(result.ok ? [] : result.issues.map((i) => `  - ${i}`)),
        "",
        "Details:",
        ...infoLines,
      ];

      await ctx.reply(lines.join("\n"));
    } catch (err) {
      await ctx.reply(`Dry run itself failed to run: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
