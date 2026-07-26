import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { listWallets } from "../wallet/keystore.js";
import { sweepNativeSolana, sweepSplToken } from "./sweep.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface WalletWatchHandle {
  stop: () => void;
}

/**
 * Polls a solana wallet's SOL balance and SPL token accounts, sweeping
 * anything found to the wallet's configured sweepTo address. An NFT is just
 * an SPL token with amount 1, so this covers NFTs arriving too, not just
 * fungible tokens or SOL.
 *
 * Idempotent by construction: after a successful sweep the wallet is
 * near-empty, so the next poll is a fast no-op (nothing to sweep) until
 * something new actually arrives — no need to track "have I seen this
 * before," the wallet's current balance is the whole state.
 */
export function watchSolanaWalletDeposits(
  walletLabel: string,
  intervalMs: number,
  onEvent?: (message: string) => void
): WalletWatchHandle {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;

    try {
      const wallet = listWallets().find((w) => w.label === walletLabel);
      if (!wallet) {
        onEvent?.(`Wallet "${walletLabel}" no longer exists — stopping watch.`);
        stopped = true;
        return;
      }
      if (!wallet.sweepTo) {
        onEvent?.(`Wallet "${walletLabel}" has no sweepTo set — stopping watch. Run /setsweep first.`);
        stopped = true;
        return;
      }

      // Native SOL.
      try {
        const signature = await sweepNativeSolana(walletLabel, wallet.sweepTo);
        if (signature) onEvent?.(`Swept native SOL from ${walletLabel}. Tx: ${signature}`);
      } catch (err) {
        logger.warn("Wallet-watch native sweep attempt failed", { walletLabel, err: String(err) });
      }

      // Every SPL token account this wallet holds, NFTs included.
      const connection = new Connection(env.solanaRpcUrls[0], "confirmed");
      const pubkey = new PublicKey(wallet.address);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      });

      for (const { account } of tokenAccounts.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = (account.data as any).parsed.info;
        const amount = Number(info.tokenAmount.amount);
        if (amount > 0) {
          try {
            const signature = await sweepSplToken(walletLabel, info.mint, wallet.sweepTo, amount);
            onEvent?.(`Swept token ${info.mint} (amount ${amount}) from ${walletLabel}. Tx: ${signature}`);
          } catch (err) {
            logger.warn("Wallet-watch token sweep attempt failed", { walletLabel, mint: info.mint, err: String(err) });
          }
        }
      }
    } catch (err) {
      logger.warn("Wallet-watch poll error, retrying next interval", { walletLabel, err: String(err) });
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
