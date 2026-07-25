import type { Bot } from "grammy";
import { addSchedule, listSchedules, removeSchedule, type ScheduleEntry } from "./store.js";
import { executeMint } from "../mint/executeMint.js";
import { logger } from "../utils/logger.js";

// setTimeout's delay is a 32-bit signed int under the hood — anything longer
// than ~24.8 days needs to be chunked into repeated waits rather than one
// call, or it fires immediately instead of waiting.
const MAX_TIMEOUT_MS = 2_147_483_000;

function armTimeout(delayMs: number, callback: () => void): void {
  if (delayMs <= MAX_TIMEOUT_MS) {
    setTimeout(callback, Math.max(0, delayMs));
  } else {
    setTimeout(() => armTimeout(delayMs - MAX_TIMEOUT_MS, callback), MAX_TIMEOUT_MS);
  }
}

function arm(bot: Bot, entry: ScheduleEntry): void {
  const delayMs = new Date(entry.fireAtIso).getTime() - Date.now();
  if (delayMs <= 0) {
    logger.warn("Schedule already past due, skipping", { id: entry.id, fireAtIso: entry.fireAtIso });
    bot.api
      .sendMessage(entry.chatId, `Schedule ${entry.id} for target ${entry.targetId} was past due on startup and was skipped.`)
      .catch(() => {});
    removeSchedule(entry.id);
    return;
  }

  armTimeout(delayMs, async () => {
    // Check the entry is still on disk — /unschedule removes it, but doesn't
    // (and can't) cancel a setTimeout across a bot restart, so this is the
    // actual cancellation check.
    const stillPending = listSchedules().some((e) => e.id === entry.id);
    if (!stillPending) {
      logger.info("Scheduled mint skipped, was cancelled", { id: entry.id });
      return;
    }
    logger.info("Scheduled mint firing", { id: entry.id, targetId: entry.targetId });
    removeSchedule(entry.id);
    await executeMint(bot, entry.chatId, entry.targetId, entry.walletLabel);
  });
}

/** Call once at startup — reloads any schedules that survived a restart and re-arms them. */
export function initScheduler(bot: Bot): void {
  const entries = listSchedules();
  for (const entry of entries) arm(bot, entry);
  logger.info("Scheduler initialized", { pending: entries.length });
}

export function scheduleMint(bot: Bot, targetId: string, walletLabel: string, fireAtIso: string, chatId: number): ScheduleEntry {
  const fireAt = new Date(fireAtIso);
  if (Number.isNaN(fireAt.getTime())) {
    throw new Error(`"${fireAtIso}" isn't a valid date. Use ISO format, e.g. 2026-08-01T14:00:00Z`);
  }
  if (fireAt.getTime() <= Date.now()) {
    throw new Error("That time is in the past.");
  }

  const entry = addSchedule({ targetId, walletLabel, fireAtIso: fireAt.toISOString(), chatId });
  arm(bot, entry);
  return entry;
}

export function cancelSchedule(id: string): boolean {
  return removeSchedule(id);
}
