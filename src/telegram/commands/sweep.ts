import { Bot } from "grammy";
import { listWallets } from "../../wallet/keystore.js";
import { sweepNativeEvm, sweepErc721 } from "../../evm/sweep.js";
import { sweepNativeSolana, sweepSplToken } from "../../solana/sweep.js";
import type { Address } from "viem";

const USAGE = [
  "Usage:",
  "/sweep <walletLabel> native <chainId> [toAddress]  — evm",
  "/sweep <walletLabel> native [toAddress]  — solana",
  "/sweep <walletLabel> nft <chainId> <contractAddress> <tokenId> [toAddress]  — evm",
  "/sweep <walletLabel> spl <mintAddress> [amount] [toAddress]  — solana",
  "toAddress is optional if /setsweep has already been run for this wallet.",
].join("\n");

export function registerSweep(bot: Bot): void {
  bot.command("sweep", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply(USAGE);
      return;
    }

    const parts = raw.split(/\s+/);
    const [label, mode, ...rest] = parts;
    const wallet = listWallets().find((w) => w.label === label);
    if (!wallet) {
      await ctx.reply(`No wallet found with label "${label}". Check /wallets.`);
      return;
    }

    try {
      if (mode === "native" && wallet.chain === "evm") {
        const [chainIdRaw, toArg] = rest;
        const to = (toArg || wallet.sweepTo) as Address | undefined;
        if (!chainIdRaw || !to) {
          await ctx.reply("Need a chainId, and a destination (either as an arg or via /setsweep).\n\n" + USAGE);
          return;
        }
        const hash = await sweepNativeEvm(label, to, Number(chainIdRaw));
        await ctx.reply(hash ? `Swept. Tx: \`${hash}\`` : "Nothing to sweep after the gas buffer.", {
          parse_mode: "Markdown",
        });
      } else if (mode === "native" && wallet.chain === "solana") {
        const [toArg] = rest;
        const to = toArg || wallet.sweepTo;
        if (!to) {
          await ctx.reply("Need a destination (either as an arg or via /setsweep).\n\n" + USAGE);
          return;
        }
        const signature = await sweepNativeSolana(label, to);
        await ctx.reply(signature ? `Swept. Tx: \`${signature}\`` : "Nothing to sweep after the rent/fee buffer.", {
          parse_mode: "Markdown",
        });
      } else if (mode === "nft" && wallet.chain === "evm") {
        const [chainIdRaw, contractAddress, tokenIdRaw, toArg] = rest;
        const to = (toArg || wallet.sweepTo) as Address | undefined;
        if (!chainIdRaw || !contractAddress || !tokenIdRaw || !to) {
          await ctx.reply(USAGE);
          return;
        }
        const hash = await sweepErc721(
          label,
          contractAddress as Address,
          BigInt(tokenIdRaw),
          to,
          Number(chainIdRaw)
        );
        await ctx.reply(`Swept NFT. Tx: \`${hash}\``, { parse_mode: "Markdown" });
      } else if (mode === "spl" && wallet.chain === "solana") {
        const [mintAddress, amountRaw, toArg] = rest;
        const to = toArg || wallet.sweepTo;
        if (!mintAddress || !to) {
          await ctx.reply(USAGE);
          return;
        }
        const signature = await sweepSplToken(label, mintAddress, to, amountRaw ? Number(amountRaw) : 1);
        await ctx.reply(`Swept token. Tx: \`${signature}\``, { parse_mode: "Markdown" });
      } else {
        await ctx.reply(`Mode "${mode}" doesn't apply to a ${wallet.chain} wallet.\n\n` + USAGE);
      }
    } catch (err) {
      await ctx.reply(`Sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
