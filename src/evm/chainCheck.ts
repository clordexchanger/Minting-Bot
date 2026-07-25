import { createPublicClient, http } from "viem";
import { env } from "../config/env.js";

export interface ChainCheckResult {
  chainId: string;
  ok: boolean;
  blockNumber?: string;
  latencyMs: number;
  error?: string;
}

/**
 * Hits eth_blockNumber on every configured chain's first RPC URL. A pass
 * here means the URL, chainId, and API key are all actually correct — the
 * only real way to confirm a chain config rather than trust a guess.
 */
export async function checkAllChains(): Promise<ChainCheckResult[]> {
  const chainIds = Object.keys(env.evmRpcMap);
  return Promise.all(
    chainIds.map(async (chainId) => {
      const url = env.evmRpcMap[chainId][0];
      const start = Date.now();
      try {
        const client = createPublicClient({ transport: http(url) });
        const blockNumber = await client.getBlockNumber();
        return { chainId, ok: true, blockNumber: blockNumber.toString(), latencyMs: Date.now() - start };
      } catch (err) {
        return {
          chainId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - start,
        };
      }
    })
  );
}
