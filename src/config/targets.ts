import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

export type Chain = "evm" | "solana";

export interface MintTarget {
  id: string;
  label: string;
  chain: Chain;
  // EVM: numeric chain id (1, 8453, etc). Solana: ignored.
  chainId?: number;
  // EVM: contract address. Solana: program id.
  address: string;
  // Free-form: for EVM this can hold the function signature + args template,
  // for Solana the instruction layout. Phase 3/4 mint engines parse this.
  mintSpec: string;
  priceNote?: string;
  wallet?: string; // which configured wallet label to mint from
  createdAt: string;
}

function ensureFile(): void {
  const dir = dirname(env.targetsFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(env.targetsFile)) writeFileSync(env.targetsFile, "[]", "utf-8");
}

function load(): MintTarget[] {
  ensureFile();
  try {
    const raw = readFileSync(env.targetsFile, "utf-8");
    return JSON.parse(raw) as MintTarget[];
  } catch (err) {
    logger.error("Failed to read targets file, treating as empty", { err: String(err) });
    return [];
  }
}

function save(targets: MintTarget[]): void {
  ensureFile();
  writeFileSync(env.targetsFile, JSON.stringify(targets, null, 2), "utf-8");
}

export function listTargets(): MintTarget[] {
  return load();
}

export function getTarget(id: string): MintTarget | undefined {
  return load().find((t) => t.id === id || t.label === id);
}

export function addTarget(input: Omit<MintTarget, "id" | "createdAt">): MintTarget {
  const targets = load();
  const target: MintTarget = {
    ...input,
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
  };
  targets.push(target);
  save(targets);
  logger.info("Target added", { id: target.id, label: target.label, chain: target.chain });
  return target;
}

export function removeTarget(idOrLabel: string): boolean {
  const targets = load();
  const next = targets.filter((t) => t.id !== idOrLabel && t.label !== idOrLabel);
  const removed = next.length !== targets.length;
  if (removed) {
    save(next);
    logger.info("Target removed", { idOrLabel });
  }
  return removed;
}
