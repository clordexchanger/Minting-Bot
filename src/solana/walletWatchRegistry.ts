import type { WalletWatchHandle } from "./walletWatch.js";

const activeWatches = new Map<string, WalletWatchHandle>();

export function registerWalletWatch(walletLabel: string, handle: WalletWatchHandle): void {
  activeWatches.get(walletLabel)?.stop(); // replace, don't stack, if re-armed
  activeWatches.set(walletLabel, handle);
}

export function stopWalletWatch(walletLabel: string): boolean {
  const handle = activeWatches.get(walletLabel);
  if (!handle) return false;
  handle.stop();
  activeWatches.delete(walletLabel);
  return true;
}

export function listActiveWalletWatches(): string[] {
  return [...activeWatches.keys()];
}
