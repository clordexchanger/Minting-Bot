import type { Bot } from "grammy";
import type { Address } from "viem";
import { getTarget, type MintTarget } from "../config/targets.js";
import { mintOnEvm, waitForEvmConfirmation } from "../evm/mintEngine.js";
import { mintOnSolana, waitForSolanaConfirmation } from "../solana/mintEngine.js";
import { extractMintedTokenId, sweepErc721 } from "../evm/sweep.js";
import { listWallets } from "../wallet/keystore.js";
import { logger } from "../utils/logger.js";

/**
 * Runs a full mint attempt — build, sign, broadcast, wait for confirmation,
 * and auto-sweep on evm — and reports progress to the given chat. Shared by
 * the manual /mint command, scheduled triggers, and the state watcher, so
 * there's exactly one place that implements "what happens when we mint."
 */
export async function executeMint(bot: Bot, chatId: number, targetOrId: MintTarget | string, walletLabelArg?: string): Promise<void> {
  const target = typeof targetOrId === "string" ? getTarget(targetOrId) : targetOrId;
  if (!target) {
    await bot.api.sendMessage(chatId, `No target found matching "${targetOrId}".`);
    return;
  }

  const walletLabel = walletLabelArg || target.wallet;
  if (!walletLabel) {
    await bot.api.sendMessage(chatId, `Target "${target.label}" has no default wallet and none was given.`);
    return;
  }

  await bot.api.sendMessage(chatId, `Firing mint for ${target.label} from wallet ${walletLabel}...`);

  try {
    if (target.chain === "evm") {
      const result = await mintOnEvm(target, walletLabel);
      await bot.api.sendMessage(
        chatId,
        `Submitted: ${result.txHash}\nBroadcast to ${result.submittedToRpcs.length} RPC(s). Waiting for confirmation...`
      );

      const confirmation = await waitForEvmConfirmation(result.txHash, target.chainId!);
      if (!confirmation) {
        await bot.api.sendMessage(chatId, "Still unconfirmed after 30s. Check the explorer with the tx hash above.");
        return;
      }
      if (confirmation.status !== "success") {
        await bot.api.sendMessage(chatId, `Confirmed in block ${confirmation.blockNumber}, but the transaction reverted.`);
        return;
      }

      await bot.api.sendMessage(chatId, `Confirmed in block ${confirmation.blockNumber}. Mint succeeded.`);

      const wallet = listWallets().find((w) => w.label === walletLabel);
      if (wallet?.sweepTo) {
        const tokenId = extractMintedTokenId(confirmation.logs, target.address as Address, result.walletAddress);
        if (tokenId === null) {
          await bot.api.sendMessage(
            chatId,
            "Couldn't find a matching ERC-721 Transfer in the receipt logs — skipping auto-sweep. Use /sweep manually if needed."
          );
        } else {
          try {
            const sweepHash = await sweepErc721(
              walletLabel,
              target.address as Address,
              tokenId,
              wallet.sweepTo as Address,
              target.chainId!
            );
            await bot.api.sendMessage(chatId, `Auto-swept tokenId ${tokenId} to ${wallet.sweepTo}. Tx: ${sweepHash}`);
          } catch (sweepErr) {
            await bot.api.sendMessage(
              chatId,
              `Auto-sweep failed: ${sweepErr instanceof Error ? sweepErr.message : String(sweepErr)}. The NFT is still in the mint wallet — use /sweep manually.`
            );
          }
        }
      }
    } else {
      const result = await mintOnSolana(target, walletLabel);
      await bot.api.sendMessage(chatId, `Submitted via ${result.wonVia}: ${result.signature}\nWaiting for confirmation...`);
      if (result.ephemeralAddresses.length > 0) {
        await bot.api.sendMessage(
          chatId,
          `New account(s) created by this mint: ${result.ephemeralAddresses.join(", ")}`
        );
      }

      const confirmation = await waitForSolanaConfirmation(result.signature);
      await bot.api.sendMessage(
        chatId,
        confirmation === "confirmed"
          ? "Confirmed. Mint succeeded. (Auto-sweep isn't wired up for solana yet — use /sweep spl manually.)"
          : "Still unconfirmed after 30s, or the tx errored. Check the explorer with the signature above."
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("executeMint failed", { target: target.label, wallet: walletLabel, err: message });
    await bot.api.sendMessage(chatId, `Mint failed: ${message}`);
  }
}
