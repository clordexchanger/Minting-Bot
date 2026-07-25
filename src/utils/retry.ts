import { logger } from "./logger.js";

export interface RetryOptions {
  retries?: number; // number of retries after the first attempt, default 3
  baseDelayMs?: number; // delay before the first retry, doubles each time, default 300
  label?: string; // for log messages
}

/**
 * Retries a flaky async call with exponential backoff. Meant for individual
 * RPC calls (fee estimation, nonce fetch, a single broadcast attempt) — not
 * for wrapping an entire multi-RPC race, since that already has its own
 * redundancy via Promise.allSettled.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn(`Retrying after failure${options.label ? ` (${options.label})` : ""}`, {
        attempt: attempt + 1,
        ofRetries: retries,
        delayMs: delay,
        err: String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
