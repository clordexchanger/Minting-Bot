import { Bot } from "grammy";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { registerAddTarget } from "./commands/addtarget.js";
import { registerListTargets } from "./commands/listtargets.js";
import { registerRemoveTarget } from "./commands/removetarget.js";
import { registerStatus } from "./commands/status.js";
import { registerHelp } from "./commands/help.js";
import { registerWallets } from "./commands/wallets.js";
import { registerMint } from "./commands/mint.js";
import { registerSetSweep } from "./commands/setsweep.js";
import { registerSweep } from "./commands/sweep.js";
import { registerSchedule } from "./commands/schedule.js";
import { registerSchedules } from "./commands/schedules.js";
import { registerWatchCommands } from "./commands/watch.js";
import { registerDryRun } from "./commands/dryrun.js";
import { registerNewWallet } from "./commands/newwallet.js";
import { registerFanoutMint } from "./commands/fanoutmint.js";
import { registerCheckChains } from "./commands/checkchains.js";
import { registerCancel } from "./commands/cancel.js";
import { registerWatchWallet, initWalletWatches } from "./commands/watchwallet.js";
import { registerWatchSol } from "./commands/watchsol.js";
import { initScheduler } from "../scheduler/scheduler.js";

export function createBot(): Bot {
  const bot = new Bot(env.telegramBotToken);

  // Operator-only gate. Every command handler runs after this, so nothing
  // needs to re-check identity itself. Anyone else's messages are dropped
  // silently — no error reply, so the bot doesn't confirm it exists to
  // random users probing it.
  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (fromId !== env.telegramOperatorId) {
      logger.warn("Ignored message from non-operator", { fromId });
      return;
    }
    await next();
  });

  registerHelp(bot);
  registerAddTarget(bot);
  registerListTargets(bot);
  registerRemoveTarget(bot);
  registerStatus(bot);
  registerWallets(bot);
  registerMint(bot);
  registerSetSweep(bot);
  registerSweep(bot);
  registerSchedule(bot);
  registerSchedules(bot);
  registerWatchCommands(bot);
  registerDryRun(bot);
  registerNewWallet(bot);
  registerFanoutMint(bot);
  registerCheckChains(bot);
  registerCancel(bot);
  registerWatchWallet(bot);
  registerWatchSol(bot);

  bot.catch((err) => {
    logger.error("Unhandled bot error", { err: String(err) });
  });

  initScheduler(bot);
  initWalletWatches(bot);

  return bot;
}
