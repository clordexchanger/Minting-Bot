import { Router } from "express";
import type { Bot } from "grammy";
import type { Address } from "viem";
import { addTarget, getTarget, listTargets, removeTarget } from "../config/targets.js";
import { listWallets, setSweepTo, removeWallet } from "../wallet/keystore.js";
import { generateEvmKeypair, generateSolanaKeypair } from "../wallet/generate.js";
import { storeSecret } from "../wallet/keystore.js";
import { mintOnEvm, waitForEvmConfirmation, dryRunEvmMint } from "../evm/mintEngine.js";
import { mintOnSolana, waitForSolanaConfirmation, dryRunSolanaMint } from "../solana/mintEngine.js";
import { extractMintedTokenId, sweepErc721 } from "../evm/sweep.js";
import { listSchedules } from "../scheduler/store.js";
import { scheduleMint, cancelSchedule } from "../scheduler/scheduler.js";
import { checkAllChains } from "../evm/chainCheck.js";
import { env, getEvmRpcUrls } from "../config/env.js";
import { logger } from "../utils/logger.js";

function notifyTelegram(bot: Bot, message: string): void {
  // Best-effort mirror of web actions into the same Telegram chat, so
  // there's one activity trail regardless of which interface was used.
  bot.api.sendMessage(env.telegramOperatorId, `[Web] ${message}`).catch(() => {});
}

export function buildApiRouter(bot: Bot): Router {
  const router = Router();

  // ---- Status ----
  router.get("/status", (_req, res) => {
    const targets = listTargets();
    const wallets = listWallets();
    res.json({
      targets: targets.length,
      evmTargets: targets.filter((t) => t.chain === "evm").length,
      solanaTargets: targets.filter((t) => t.chain === "solana").length,
      wallets: wallets.length,
      evmChainsConfigured: Object.keys(env.evmRpcMap),
      solanaRpcsConfigured: env.solanaRpcUrls.length,
      schedulesPending: listSchedules().length,
    });
  });

  // ---- Targets ----
  router.get("/targets", (_req, res) => {
    res.json(listTargets());
  });

  router.post("/targets", (req, res) => {
    const { label, chain, address, mintSpec, chainId, priceNote, wallet } = req.body ?? {};
    if (!label || !chain || !address || !mintSpec) {
      res.status(400).json({ error: "label, chain, address, and mintSpec are required" });
      return;
    }
    if (chain !== "evm" && chain !== "solana") {
      res.status(400).json({ error: 'chain must be "evm" or "solana"' });
      return;
    }
    if (chain === "evm" && !chainId) {
      res.status(400).json({ error: "chainId is required for evm targets" });
      return;
    }
    try {
      JSON.parse(mintSpec); // validate it's real JSON before storing
    } catch {
      res.status(400).json({ error: "mintSpec must be valid JSON" });
      return;
    }
    const target = addTarget({ label, chain, address, mintSpec, chainId, priceNote, wallet });
    notifyTelegram(bot, `Target added: ${target.label}`);
    res.json(target);
  });

  router.delete("/targets/:id", (req, res) => {
    const removed = removeTarget(req.params.id);
    res.json({ removed });
  });

  // ---- Wallets ----
  router.get("/wallets", (_req, res) => {
    res.json(listWallets());
  });

  router.post("/wallets", (req, res) => {
    const { chain, label } = req.body ?? {};
    if (!label || (chain !== "evm" && chain !== "solana")) {
      res.status(400).json({ error: 'chain must be "evm" or "solana", and label is required' });
      return;
    }
    if (listWallets().some((w) => w.label === label)) {
      res.status(409).json({ error: `A wallet labeled "${label}" already exists` });
      return;
    }
    if (chain === "evm") {
      const { address, privateKeyHex } = generateEvmKeypair();
      storeSecret("evm", label, address, Buffer.from(privateKeyHex.slice(2), "hex"));
      notifyTelegram(bot, `New evm wallet generated: ${label}`);
      res.json({ label, chain, address });
    } else {
      const { address, secretBytes } = generateSolanaKeypair();
      storeSecret("solana", label, address, secretBytes);
      notifyTelegram(bot, `New solana wallet generated: ${label}`);
      res.json({ label, chain, address });
    }
  });

  router.delete("/wallets/:label", (req, res) => {
    const removed = removeWallet(req.params.label);
    res.json({ removed });
  });

  router.post("/wallets/:label/sweep-destination", (req, res) => {
    const { destination } = req.body ?? {};
    if (!destination) {
      res.status(400).json({ error: "destination is required" });
      return;
    }
    const ok = setSweepTo(req.params.label, destination);
    res.json({ ok });
  });

  // ---- Minting ----
  router.post("/mint", async (req, res) => {
    const { targetId, walletLabel } = req.body ?? {};
    const target = getTarget(targetId);
    if (!target) {
      res.status(404).json({ error: "Target not found" });
      return;
    }
    const wallet = walletLabel || target.wallet;
    if (!wallet) {
      res.status(400).json({ error: "No wallet specified and target has no default" });
      return;
    }

    try {
      if (target.chain === "evm") {
        const result = await mintOnEvm(target, wallet);
        const confirmation = await waitForEvmConfirmation(result.txHash, target.chainId!);

        let sweep: { tokenId?: string; sweepHash?: string; error?: string } | null = null;
        if (confirmation?.status === "success") {
          const w = listWallets().find((x) => x.label === wallet);
          if (w?.sweepTo) {
            const tokenId = extractMintedTokenId(confirmation.logs, target.address as Address, result.walletAddress);
            if (tokenId !== null) {
              try {
                const sweepHash = await sweepErc721(wallet, target.address as Address, tokenId, w.sweepTo as Address, target.chainId!);
                sweep = { tokenId: tokenId.toString(), sweepHash };
              } catch (err) {
                sweep = { error: err instanceof Error ? err.message : String(err) };
              }
            }
          }
        }

        notifyTelegram(bot, `Mint fired for ${target.label} via ${wallet}: ${result.txHash}`);
        res.json({
          chain: "evm",
          txHash: result.txHash,
          confirmed: confirmation?.status === "success",
          reverted: confirmation?.status === "reverted",
          blockNumber: confirmation?.blockNumber?.toString(),
          sweep,
        });
      } else {
        const result = await mintOnSolana(target, wallet);
        const confirmed = await waitForSolanaConfirmation(result.signature);
        notifyTelegram(bot, `Mint fired for ${target.label} via ${wallet}: ${result.signature}`);
        res.json({
          chain: "solana",
          signature: result.signature,
          wonVia: result.wonVia,
          confirmed: confirmed === "confirmed",
          ephemeralAddresses: result.ephemeralAddresses,
        });
      }
    } catch (err) {
      logger.error("Web mint failed", { target: target.label, err: String(err) });
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/dryrun", async (req, res) => {
    const { targetId, walletLabel } = req.body ?? {};
    const target = getTarget(targetId);
    if (!target) {
      res.status(404).json({ error: "Target not found" });
      return;
    }
    const wallet = walletLabel || target.wallet;
    if (!wallet) {
      res.status(400).json({ error: "No wallet specified and target has no default" });
      return;
    }
    try {
      const result = target.chain === "evm" ? await dryRunEvmMint(target, wallet) : await dryRunSolanaMint(target, wallet);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Schedules ----
  router.get("/schedules", (_req, res) => {
    res.json(listSchedules());
  });

  router.post("/schedules", (req, res) => {
    const { targetId, walletLabel, fireAtIso } = req.body ?? {};
    const target = getTarget(targetId);
    if (!target) {
      res.status(404).json({ error: "Target not found" });
      return;
    }
    try {
      const entry = scheduleMint(bot, target.id, walletLabel, fireAtIso, env.telegramOperatorId);
      notifyTelegram(bot, `Scheduled ${target.label} for ${entry.fireAtIso} (via web dashboard)`);
      res.json(entry);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/schedules/:id", (req, res) => {
    const cancelled = cancelSchedule(req.params.id);
    res.json({ cancelled });
  });

  // ---- Diagnostics ----
  router.get("/checkchains", async (_req, res) => {
    const results = await checkAllChains();
    res.json(results);
  });

  router.get("/rpc-config", (_req, res) => {
    res.json({
      evmChains: Object.keys(env.evmRpcMap).map((chainId) => ({ chainId, rpcCount: getEvmRpcUrls(Number(chainId)).length })),
      solanaRpcCount: env.solanaRpcUrls.length,
    });
  });

  return router;
}
