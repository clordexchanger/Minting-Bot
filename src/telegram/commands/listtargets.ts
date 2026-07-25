import { Bot } from "grammy";
import { listTargets } from "../../config/targets.js";

export function registerListTargets(bot: Bot): void {
  bot.command("listtargets", async (ctx) => {
    const targets = listTargets();
    if (targets.length === 0) {
      await ctx.reply("No targets configured yet. Add one with /addtarget.");
      return;
    }

    const lines = targets.map((t) => {
      const chainPart = t.chain === "evm" ? `evm/${t.chainId}` : "solana";
      return `• *${t.label}* (${t.id}) — ${chainPart}\n  \`${t.address}\`${
        t.priceNote ? `\n  price: ${t.priceNote}` : ""
      }${t.wallet ? `\n  wallet: ${t.wallet}` : ""}`;
    });

    await ctx.reply(lines.join("\n\n"), { parse_mode: "Markdown" });
  });
}
