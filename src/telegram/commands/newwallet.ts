import { Bot } from "grammy";
import { storeSecret, listWallets, removeWallet } from "../../wallet/keystore.js";
import { generateEvmKeypair, generateSolanaKeypair } from "../../wallet/generate.js";

export function registerNewWallet(bot: Bot): void {
  bot.command("newwallet", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply(
        "Usage: /newwallet <chain> <label>\nchain is evm or solana. Generates a brand-new wallet — this never asks for or accepts an existing private key."
      );
      return;
    }

    const [chainRaw, label] = raw.split(/\s+/);
    if (!label || (chainRaw !== "evm" && chainRaw !== "solana")) {
      await ctx.reply("Usage: /newwallet <chain> <label>\nchain is evm or solana.");
      return;
    }

    if (listWallets().some((w) => w.label === label)) {
      await ctx.reply(`A wallet labeled "${label}" already exists. Pick a different label, or /removewallet it first.`);
      return;
    }

    if (chainRaw === "evm") {
      const { address, privateKeyHex } = generateEvmKeypair();
      storeSecret("evm", label, address, Buffer.from(privateKeyHex.slice(2), "hex"));
      await ctx.reply(
        `New evm wallet *${label}* created.\nAddress: \`${address}\`\n\n` +
          `The private key is never shown here — it went straight into the encrypted keystore and stays there. Fund this address to use it. ` +
          `If you ever need the raw key (e.g. to view it in MetaMask), run this locally: \`npm run export-wallet -- --label ${label}\` — never through Telegram.`,
        { parse_mode: "Markdown" }
      );
    } else {
      const { address, secretBytes } = generateSolanaKeypair();
      storeSecret("solana", label, address, secretBytes);
      await ctx.reply(
        `New solana wallet *${label}* created.\nAddress: \`${address}\`\n\n` +
          `Same deal — private key never shown here. Export locally if needed: \`npm run export-wallet -- --label ${label}\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  bot.command("removewallet", async (ctx) => {
    const label = ctx.match?.toString().trim();
    if (!label) {
      await ctx.reply("Usage: /removewallet <label>");
      return;
    }
    const removed = removeWallet(label);
    await ctx.reply(removed ? `Removed wallet "${label}" from the keystore.` : `No wallet found with label "${label}".`);
  });
}
