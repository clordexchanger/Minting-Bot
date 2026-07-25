/**
 * Usage:
 *   npm run import-wallet -- --chain evm --label main --key 0xabc123...
 *   npm run import-wallet -- --chain solana --label main --key 5Jx...base58secret...
 *
 * Run this locally on the machine that holds the keystore file. Never paste a
 * private key into Telegram, a chat log, or anywhere it could be captured —
 * this script is the only supported way to get a key into the bot.
 */
import "dotenv/config";
import { storeSecret } from "../src/wallet/keystore.js";
import { evmAddressFromPrivateKey } from "../src/wallet/evm.js";
import { solanaKeypairFromSecret, solanaSecretFromBase58 } from "../src/wallet/solana.js";

function parseArgs(): { chain: string; label: string; key: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const chain = get("--chain");
  const label = get("--label");
  const key = get("--key");
  if (!chain || !label || !key) {
    console.error("Usage: npm run import-wallet -- --chain <evm|solana> --label <name> --key <secret>");
    process.exit(1);
  }
  return { chain, label, key };
}

function main() {
  const { chain, label, key } = parseArgs();

  if (chain === "evm") {
    const address = evmAddressFromPrivateKey(key);
    const keyHex = key.trim().startsWith("0x") ? key.trim().slice(2) : key.trim();
    storeSecret("evm", label, address, Buffer.from(keyHex, "hex"));
    console.log(`Stored EVM wallet "${label}" — address ${address}`);
  } else if (chain === "solana") {
    const secretBytes = solanaSecretFromBase58(key);
    const keypair = solanaKeypairFromSecret(secretBytes);
    const address = keypair.publicKey.toBase58();
    storeSecret("solana", label, address, secretBytes);
    console.log(`Stored Solana wallet "${label}" — address ${address}`);
  } else {
    console.error(`Unknown chain "${chain}". Must be "evm" or "solana".`);
    process.exit(1);
  }

  console.log("Clear your shell history if this key was typed directly into the command line.");
}

main();
