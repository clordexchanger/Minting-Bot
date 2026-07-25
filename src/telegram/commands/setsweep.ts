import { Bot } from "grammy";
import { setSweepTo } from "../../wallet/keystore.js";

export function registerSetSweep(bot: Bot): void {
  bot.command("setsweep", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply("Usage: /setsweep <walletLabel> <destinationAddress>");
      return;
    }

    const [label, destination] = raw.split(/\s+/);
    if (!label || !destination) {
      await ctx.reply("Usage: /setsweep <walletLabel> <destinationAddress>");
      return;
    }

    const ok = setSweepTo(label, destination);
    await ctx.reply(
      ok
        ? `Sweep destination for *${label}* set to \`${destination}\`.\nEVM mints from this wallet will auto-sweep the minted NFT there once confirmed.`
        : `No wallet found with label "${label}". Check /wallets.`,
      { parse_mode: "Markdown" }
    );
  });
}
