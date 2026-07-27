import type { WatchHandle } from "./stateWatch.js";

const activeWatches = new Map<string, WatchHandle>();

export function registerSolWatch(targetId: string, handle: WatchHandle): void {
  activeWatches.get(targetId)?.stop(); // replace, don't stack, if re-armed
  activeWatches.set(targetId, handle);
}

export function stopSolWatch(targetId: string): boolean {
  const handle = activeWatches.get(targetId);
  if (!handle) return false;
  handle.stop();
  activeWatches.delete(targetId);
  return true;
}

export function clearSolWatch(targetId: string): void {
  activeWatches.delete(targetId);
}

export function listActiveSolWatches(): string[] {
  return [...activeWatches.keys()];
}
