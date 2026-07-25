import { Bot } from "grammy";
import { addTarget, Chain } from "../../config/targets.js";

// Pipe-delimited: label|chain|address|mintSpec|chainId|priceNote|wallet
export function registerAddTarget(bot: Bot): void {
  bot.command("addtarget", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply(
        "Usage: /addtarget label|chain|address|mintSpec|chainId|priceNote|wallet\nSee /help for an example."
      );
      return;
    }

    const parts = raw.split("|").map((p) => p.trim());
    const [label, chainRaw, address, mintSpec, chainIdRaw, priceNote, wallet] = parts;

    if (!label || !chainRaw || !address || !mintSpec) {
      await ctx.reply("Missing required fields. Need at least: label|chain|address|mintSpec");
      return;
    }

    if (chainRaw !== "evm" && chainRaw !== "solana") {
      await ctx.reply(`Invalid chain "${chainRaw}". Must be "evm" or "solana".`);
      return;
    }
    const chain = chainRaw as Chain;

    if (chain === "evm" && !chainIdRaw) {
      await ctx.reply("EVM targets need a chainId (e.g. 1 for mainnet, 8453 for Base).");
      return;
    }

    const target = addTarget({
      label,
      chain,
      address,
      mintSpec,
      chainId: chainIdRaw ? Number(chainIdRaw) : undefined,
      priceNote: priceNote || undefined,
      wallet: wallet || undefined,
    });

    await ctx.reply(
      `Target added: *${target.label}* (${target.id})\nChain: ${target.chain}${
        target.chainId ? " / chainId " + target.chainId : ""
      }\nAddress: \`${target.address}\``,
      { parse_mode: "Markdown" }
    );
  });
}
