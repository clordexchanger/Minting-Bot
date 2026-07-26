import { Bot } from "grammy";
import { listWallets } from "../../wallet/keystore.js";
import { getEvmBalance } from "../../wallet/evm.js";
import { getSolanaBalance } from "../../wallet/solana.js";
import { env } from "../../config/env.js";
import { replyLong } from "../replyLong.js";
import type { Address } from "viem";

export function registerWallets(bot: Bot): void {
  bot.command("wallets", async (ctx) => {
    const wallets = listWallets();
    if (wallets.length === 0) {
      await ctx.reply(
        "No wallets imported yet. Run `npm run import-wallet -- --chain evm --label main --key <key>` locally — never through Telegram.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const lines = await Promise.all(
      wallets.map(async (w) => {
        let balanceStr: string;

        if (w.chain === "evm") {
          const chainIds = Object.keys(env.evmRpcMap);
          if (chainIds.length === 0) {
            balanceStr = "no RPC configured";
          } else {
            const balances = await Promise.all(
              chainIds.map(async (chainId) => {
                const urls = env.evmRpcMap[chainId];
                const balance = await getEvmBalance(urls[0], w.address as Address);
                return `chain ${chainId}: ${balance ?? "error"}`;
              })
            );
            balanceStr = balances.join(", ");
          }
        } else {
          const balance = await getSolanaBalance(env.solanaRpcUrls[0], w.address);
          balanceStr = balance !== null ? balance : "no RPC configured";
        }

        return `• *${w.label}* (${w.chain})\n  \`${w.address}\`\n  balance: ${balanceStr}\n  sweep to: ${
          w.sweepTo ? `\`${w.sweepTo}\`` : "not set (/setsweep)"
        }`;
      })
    );

    await replyLong(ctx, lines.join("\n\n"), { parse_mode: "Markdown" });
  });
}
