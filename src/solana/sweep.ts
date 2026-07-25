import { Connection, SystemProgram, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import { getSecret } from "../wallet/keystore.js";
import { solanaKeypairFromSecret } from "../wallet/solana.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { sendWithBlockhashRetry } from "./broadcast.js";

/**
 * Sends the wallet's remaining SOL out, minus a fee buffer and the
 * rent-exempt minimum for the account itself. Returns null (not an error)
 * if there's nothing worth sweeping after the buffer.
 */
export async function sweepNativeSolana(walletLabel: string, toAddress: string): Promise<string | null> {
  const secret = getSecret(walletLabel);
  if (secret.chain !== "solana") throw new Error(`Wallet "${walletLabel}" is not a solana wallet`);
  const keypair = solanaKeypairFromSecret(secret.secretBytes);

  const connection = new Connection(env.solanaRpcUrls[0], "confirmed");
  const [balance, rentExempt] = await Promise.all([
    withRetry(() => connection.getBalance(keypair.publicKey), { label: "getBalance" }),
    withRetry(() => connection.getMinimumBalanceForRentExemption(0), { label: "getMinimumBalanceForRentExemption" }),
  ]);

  const feeBuffer = 10_000; // lamports — generous for a single simple transfer
  const amount = balance - rentExempt - feeBuffer;

  if (amount <= 0) {
    logger.warn("Nothing to sweep after rent + fee buffer", { wallet: walletLabel, balance });
    return null;
  }

  logger.info("Sweeping native SOL out", { wallet: walletLabel, amount, toAddress });
  const instructions = [
    SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(toAddress), lamports: amount }),
  ];
  return sendWithBlockhashRetry(connection, instructions, keypair, "sweepNativeSolana");
}

/**
 * Transfers an SPL token — an NFT is just a token with amount 1 and 0
 * decimals — to a destination wallet. Creates the destination's associated
 * token account if it doesn't exist yet, which costs a little rent paid by
 * the source wallet.
 */
export async function sweepSplToken(
  walletLabel: string,
  mintAddress: string,
  toAddress: string,
  amount = 1
): Promise<string> {
  const secret = getSecret(walletLabel);
  if (secret.chain !== "solana") throw new Error(`Wallet "${walletLabel}" is not a solana wallet`);
  const keypair = solanaKeypairFromSecret(secret.secretBytes);

  const connection = new Connection(env.solanaRpcUrls[0], "confirmed");
  const mint = new PublicKey(mintAddress);
  const toOwner = new PublicKey(toAddress);

  const fromAta = await withRetry(() => getAssociatedTokenAddress(mint, keypair.publicKey), {
    label: "getAssociatedTokenAddress",
  });
  // Payer for account creation is the source wallet (keypair) — this signs and sends
  // its own transaction, separate from the transfer below.
  const toAta = await withRetry(() => getOrCreateAssociatedTokenAccount(connection, keypair, mint, toOwner), {
    label: "getOrCreateAssociatedTokenAccount",
  });

  logger.info("Sweeping SPL token out", { wallet: walletLabel, mintAddress, toAddress, amount });
  const instructions = [createTransferInstruction(fromAta, toAta.address, keypair.publicKey, amount)];
  return sendWithBlockhashRetry(connection, instructions, keypair, "sweepSplToken");
}
