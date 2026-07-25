import { Connection, Transaction, TransactionInstruction, Keypair } from "@solana/web3.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const MAX_BLOCKHASH_RETRIES = 2;

function isStaleBlockhashError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes("blockhash not found") ||
    msg.includes("block height exceeded") ||
    msg.includes("blockhashnotfound") ||
    msg.includes("transactionexpiredblockheightexceedederror")
  );
}

/**
 * Builds, signs, sends, and confirms a transaction from a fixed list of
 * instructions, rebuilding against a fresh blockhash if the send or confirm
 * step fails because the blockhash expired mid-flight. Used by the sweep
 * functions, which send one transaction to one RPC rather than racing
 * several — the mint engine has its own version of this since it also has
 * to juggle Jito and multiple RPCs at once.
 */
export async function sendWithBlockhashRetry(
  connection: Connection,
  instructions: TransactionInstruction[],
  keypair: Keypair,
  label: string
): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_BLOCKHASH_RETRIES; attempt++) {
    const { blockhash, lastValidBlockHeight } = await withRetry(() => connection.getLatestBlockhash("confirmed"), {
      label: "getLatestBlockhash",
    });
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey }).add(...instructions);
    tx.sign(keypair);

    try {
      const signature = await withRetry(() => connection.sendRawTransaction(tx.serialize()), {
        retries: 1,
        baseDelayMs: 150,
        label: `${label} sendRawTransaction`,
      });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      return signature;
    } catch (err) {
      lastErr = err;
      if (isStaleBlockhashError(err) && attempt < MAX_BLOCKHASH_RETRIES) {
        logger.warn("Blockhash went stale, rebuilding and retrying", { label, attempt: attempt + 1 });
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}
