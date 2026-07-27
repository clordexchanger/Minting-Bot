import { Connection, PublicKey } from "@solana/web3.js";
import { env } from "../config/env.js";

export interface WatchHandle {
  stop: () => void;
}

/**
 * Polls a solana account's raw data at [byteOffset, byteOffset+byteLength)
 * and fires onTrigger once those bytes equal expectedHex exactly. Solana
 * doesn't have "view functions" the way EVM does — there's no equivalent to
 * calling mintActive() and reading a bool back — so this works directly on
 * account bytes instead. Finding the right offset/length for a given
 * program means knowing its account layout ahead of time (an Anchor IDL,
 * the program's source, or an Anchor-aware explorer that decodes accounts).
 * That's a genuinely more expert-level starting point than evm's /watch,
 * not a shortcut around needing to understand the target program.
 */
export function watchSolanaAccountCondition(
  accountPubkey: string,
  byteOffset: number,
  byteLength: number,
  expectedHex: string,
  intervalMs: number,
  onTrigger: () => void,
  onError?: (err: unknown) => void
): WatchHandle {
  if (env.solanaRpcUrls.length === 0) {
    throw new Error("No SOLANA_RPC_URLS configured in .env");
  }

  const connection = new Connection(env.solanaRpcUrls[0], "confirmed");
  const pubkey = new PublicKey(accountPubkey);
  const normalizedExpected = expectedHex.toLowerCase().replace(/^0x/, "");

  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const info = await connection.getAccountInfo(pubkey);
      if (info) {
        const slice = info.data.subarray(byteOffset, byteOffset + byteLength);
        if (slice.toString("hex") === normalizedExpected) {
          stopped = true;
          onTrigger();
          return;
        }
      }
    } catch (err) {
      onError?.(err);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };

  tick();
  return {
    stop: () => {
      stopped = true;
    },
  };
}
