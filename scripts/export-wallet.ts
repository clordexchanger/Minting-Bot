/**
 * Usage:
 *   npm run export-wallet -- --label main
 *
 * Prints a wallet's private key to your local terminal only. Run this on the
 * machine that holds the keystore file. Never paste the output into
 * Telegram, a chat log, or anywhere it could be captured — this is the only
 * supported way to get a key out of the bot.
 */
import "dotenv/config";
import { getSecret } from "../src/wallet/keystore.js";
import bs58 from "bs58";

function parseArgs(): { label: string } {
  const args = process.argv.slice(2);
  const i = args.indexOf("--label");
  const label = i >= 0 ? args[i + 1] : undefined;
  if (!label) {
    console.error("Usage: npm run export-wallet -- --label <name>");
    process.exit(1);
  }
  return { label };
}

function main() {
  const { label } = parseArgs();
  const { chain, address, secretBytes } = getSecret(label);

  console.log(`Wallet: ${label} (${chain})`);
  console.log(`Address: ${address}`);

  if (chain === "evm") {
    console.log(`Private key: 0x${secretBytes.toString("hex")}`);
  } else {
    console.log(`Secret key (base58, Phantom-compatible): ${bs58.encode(secretBytes)}`);
  }

  console.log("\nPrinted to your local terminal only. Clear your shell history if you're worried about it lingering there.");
}

main();
