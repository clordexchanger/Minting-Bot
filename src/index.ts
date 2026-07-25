import { createBot } from "./telegram/bot.js";
import { logger } from "./utils/logger.js";

async function main() {
  const bot = await createBot();

  await bot.api.setMyCommands([
    { command: "help", description: "Show available commands" },
    { command: "addtarget", description: "Add a mint target" },
    { command: "listtargets", description: "List configured targets" },
    { command: "removetarget", description: "Remove a target" },
    { command: "wallets", description: "List wallets and balances" },
    { command: "newwallet", description: "Generate a new wallet (never asks for a key)" },
    { command: "removewallet", description: "Remove a wallet from the keystore" },
    { command: "mint", description: "Fire a mint for a target" },
    { command: "fanoutmint", description: "Fire a mint from multiple wallets at once" },
    { command: "checkchains", description: "Verify RPC connectivity for every configured chain" },
    { command: "dryrun", description: "Validate a mint without sending it" },
    { command: "setsweep", description: "Set a wallet's fast wallet-out destination" },
    { command: "sweep", description: "Manually sweep native balance or a token out" },
    { command: "schedule", description: "Schedule a mint for a future time" },
    { command: "schedules", description: "List pending schedules" },
    { command: "unschedule", description: "Cancel a pending schedule" },
    { command: "watch", description: "Watch on-chain state and auto-mint (evm)" },
    { command: "unwatch", description: "Stop an active watch" },
    { command: "status", description: "Show bot status" },
  ]);

  logger.info("Starting bot...");
  await bot.start({
    onStart: (info) => logger.info("Bot started", { username: info.username }),
  });
}

main().catch((err) => {
  logger.error("Fatal error on startup", { err: String(err) });
  process.exit(1);
});
