import { createPublicClient, http, parseAbiItem } from "viem";
import { getEvmRpcUrls } from "../config/env.js";

export interface WatchHandle {
  stop: () => void;
}

/**
 * Polls a read-only contract function at an interval and fires onTrigger
 * once the stringified result matches triggerWhen exactly (e.g. "true",
 * "1234"). One-shot — stops itself after triggering.
 *
 * KNOWN LIMITATION: only supports zero-argument view functions returning a
 * single value that can be meaningfully stringified (bool, uint, address).
 * Structs/arrays or functions needing args aren't handled — the mintSpec
 * JSON format doesn't have a way to express args for a watch condition yet.
 */
export function watchEvmCondition(
  contractAddress: `0x${string}`,
  chainId: number,
  viewFunctionAbi: string,
  triggerWhen: string,
  intervalMs: number,
  onTrigger: () => void,
  onError?: (err: unknown) => void
): WatchHandle {
  const rpcUrls = getEvmRpcUrls(chainId);
  if (rpcUrls.length === 0) {
    throw new Error(`No RPC configured for chainId ${chainId} in EVM_RPC_URLS.`);
  }
  const publicClient = createPublicClient({ transport: http(rpcUrls[0]) });
  const abiItem = parseAbiItem(viewFunctionAbi) as { name: string };

  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await publicClient.readContract({
        address: contractAddress,
        abi: [abiItem as never],
        functionName: abiItem.name,
      });
      if (String(result) === triggerWhen) {
        stopped = true;
        onTrigger();
        return;
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
