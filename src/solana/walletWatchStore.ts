import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface WalletWatchEntry {
  walletLabel: string;
  intervalMs: number;
  chatId: number;
}

const FILE = "./data/walletwatches.json";

function ensureFile(): void {
  const dir = dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(FILE)) writeFileSync(FILE, "[]", "utf-8");
}

function load(): WalletWatchEntry[] {
  ensureFile();
  return JSON.parse(readFileSync(FILE, "utf-8")) as WalletWatchEntry[];
}

function save(entries: WalletWatchEntry[]): void {
  ensureFile();
  writeFileSync(FILE, JSON.stringify(entries, null, 2), "utf-8");
}

export function listWalletWatchEntries(): WalletWatchEntry[] {
  return load();
}

export function addWalletWatchEntry(entry: WalletWatchEntry): void {
  const entries = load().filter((e) => e.walletLabel !== entry.walletLabel);
  entries.push(entry);
  save(entries);
}

export function removeWalletWatchEntry(walletLabel: string): void {
  const entries = load().filter((e) => e.walletLabel !== walletLabel);
  save(entries);
}
