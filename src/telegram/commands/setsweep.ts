import { Bot } from "grammy";
import { setSweepTo, listWallets } from "../../wallet/keystore.js";

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

    const wallet = listWallets().find((w) => w.label === label);
    const ok = setSweepTo(label, destination);

    if (!ok) {
      await ctx.reply(`No wallet found with label "${label}". Check /wallets.`);
      return;
    }

    const behaviorNote =
      wallet?.chain === "solana"
        ? "Run /watchwallet " + label + " to start auto-sweeping anything that arrives here (SOL, any SPL token, any NFT) — this destination alone doesn't trigger anything on its own for solana."
        : "EVM mints from this wallet will auto-sweep the minted NFT there once confirmed.";

    await ctx.reply(`Sweep destination for *${label}* set to \`${destination}\`.\n${behaviorNote}`, {
      parse_mode: "Markdown",
    });
  });
}
