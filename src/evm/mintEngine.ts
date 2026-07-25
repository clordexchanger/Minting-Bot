import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  encodeFunctionData,
  parseEther,
  formatEther,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { evmAccountFromPrivateKey } from "../wallet/evm.js";
import { getSecret } from "../wallet/keystore.js";
import type { MintTarget } from "../config/targets.js";
import { getEvmRpcUrls } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

// EVM targets store mintSpec as JSON, since a real mint call needs a function
// signature, typed args, and sometimes a payable value — more structure than
// a single pipe-delimited field can hold cleanly.
// Example: {"functionAbi":"function mint(uint256 quantity) payable","args":[1],"valueEth":"0.01"}
interface EvmMintSpec {
  functionAbi: string;
  args: unknown[];
  valueEth?: string;

  // Priority fee is what actually buys inclusion priority on fee-auction
  // chains (Ethereum L1 and similar) — default multiplier is higher than
  // maxFee's since this is the number worth being aggressive on.
  priorityFeeMultiplier?: number; // default 2
  // Headroom over the current base fee so the tx doesn't get stuck if the
  // base fee ticks up before it lands — doesn't need to be huge.
  maxFeeMultiplier?: number; // default 1.3
  // Floor for the priority fee in wei, as a string (bigint-safe). Guards
  // against the RPC's estimate coming back as 0 — which happens on some
  // L2s/testnets — since 0 multiplied by anything is still 0, and a 0
  // priority fee has no competitive edge at all on chains that use one.
  minPriorityFeeWei?: string; // default "1000000000" (1 gwei)
  // Deprecated single knob — still honored as a fallback for either of the
  // two above if they're not set, for targets configured before this split.
  feeMultiplier?: number;

  // Optional explicit gas limit as a string (bigint-safe). If set, skips the
  // eth_estimateGas round-trip at mint time entirely — one less RPC call on
  // the critical path. Get this number by running /dryrun first (it reports
  // estimatedGas) and padding it ~10-20%. If omitted, the wallet client
  // estimates gas automatically before sending, which costs real latency.
  gasLimit?: string;
}

const DEFAULT_PRIORITY_FEE_MULTIPLIER = 2;
const DEFAULT_MAX_FEE_MULTIPLIER = 1.3;
const DEFAULT_MIN_PRIORITY_FEE_WEI = 1_000_000_000n; // 1 gwei

function parseMintSpec(raw: string): EvmMintSpec {
  try {
    return JSON.parse(raw) as EvmMintSpec;
  } catch {
    throw new Error(
      'mintSpec for an evm target must be JSON, e.g. {"functionAbi":"function mint(uint256 quantity) payable","args":[1],"valueEth":"0.01"}'
    );
  }
}

export interface EvmMintResult {
  txHash: Hex;
  submittedToRpcs: string[];
  walletAddress: Address;
}

/**
 * Builds one signed transaction and broadcasts it to every configured RPC
 * simultaneously. Same nonce and fee params across all of them means the
 * signature — and therefore the tx hash — is identical everywhere, so this
 * is genuinely one transaction racing across multiple entry points into the
 * mempool, not N competing transactions.
 */
export async function mintOnEvm(target: MintTarget, walletLabel: string): Promise<EvmMintResult> {
  if (target.chain !== "evm") throw new Error("mintOnEvm called with a non-evm target");
  if (!target.chainId) throw new Error(`Target "${target.label}" has no chainId set`);
  const rpcUrls = getEvmRpcUrls(target.chainId);
  if (rpcUrls.length === 0) {
    throw new Error(
      `No RPC configured for chainId ${target.chainId} in EVM_RPC_URLS. Add an entry for it in .env.`
    );
  }

  const spec = parseMintSpec(target.mintSpec);

  const secret = getSecret(walletLabel);
  if (secret.chain !== "evm") throw new Error(`Wallet "${walletLabel}" is not an evm wallet`);
  const privateKeyHex = ("0x" + secret.secretBytes.toString("hex")) as Hex;
  const account = evmAccountFromPrivateKey(privateKeyHex);

  const abiItem = parseAbiItem(spec.functionAbi);
  const data = encodeFunctionData({ abi: [abiItem], args: spec.args as readonly unknown[] });
  const value = spec.valueEth ? parseEther(spec.valueEth) : 0n;

  const publicClient = createPublicClient({ transport: http(rpcUrls[0]) });
  const feeData = await withRetry(() => publicClient.estimateFeesPerGas(), { label: "estimateFeesPerGas" });

  const priorityMultiplier = spec.priorityFeeMultiplier ?? spec.feeMultiplier ?? DEFAULT_PRIORITY_FEE_MULTIPLIER;
  const maxMultiplier = spec.maxFeeMultiplier ?? spec.feeMultiplier ?? DEFAULT_MAX_FEE_MULTIPLIER;
  const minPriorityFee = spec.minPriorityFeeWei ? BigInt(spec.minPriorityFeeWei) : DEFAULT_MIN_PRIORITY_FEE_WEI;

  let maxPriorityFeePerGas = scaleFee(feeData.maxPriorityFeePerGas ?? 1_000_000_000n, priorityMultiplier);
  if (maxPriorityFeePerGas < minPriorityFee) {
    logger.info("Priority fee estimate was below the floor, using the floor instead", {
      estimated: (feeData.maxPriorityFeePerGas ?? 0n).toString(),
      floor: minPriorityFee.toString(),
    });
    maxPriorityFeePerGas = minPriorityFee;
  }

  let maxFeePerGas = scaleFee(feeData.maxFeePerGas ?? 2_000_000_000n, maxMultiplier);
  // maxFeePerGas must be >= maxPriorityFeePerGas or every node will reject the
  // tx outright — cheap invariant to enforce here rather than find out from a
  // confusing RPC error mid-mint.
  if (maxFeePerGas < maxPriorityFeePerGas) {
    maxFeePerGas = maxPriorityFeePerGas + (feeData.maxFeePerGas ?? 2_000_000_000n);
  }

  const gasLimit = spec.gasLimit ? BigInt(spec.gasLimit) : undefined;

  const nonce = await withRetry(
    () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    { label: "getTransactionCount" }
  );

  logger.info("Broadcasting EVM mint tx", {
    target: target.label,
    wallet: walletLabel,
    chainId: target.chainId,
    rpcs: rpcUrls.length,
    nonce,
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    gasLimit: gasLimit?.toString() ?? "auto-estimated",
  });

  const attempts = rpcUrls.map(async (url) => {
    const walletClient = createWalletClient({ account, transport: http(url) });
    const hash = await withRetry(
      () =>
        walletClient.sendTransaction({
          chain: null,
          to: target.address as Address,
          data,
          value,
          maxFeePerGas,
          maxPriorityFeePerGas,
          nonce,
          chainId: target.chainId,
          ...(gasLimit ? { gas: gasLimit } : {}),
        }),
      // Light retry only — this is racing for speed, not resilience. Same
      // nonce/fees/data every attempt means the signature (and tx hash) is
      // identical each time, so resending is safe, never a double-send.
      { retries: 2, baseDelayMs: 150, label: `sendTransaction via ${url}` }
    );
    return { hash, rpc: url };
  });

  const results = await Promise.allSettled(attempts);
  const successes = results.filter(
    (r): r is PromiseFulfilledResult<{ hash: Hex; rpc: string }> => r.status === "fulfilled"
  );

  if (successes.length === 0) {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason));
    throw new Error(`All RPC submissions failed: ${errors.join(" | ")}`);
  }

  return {
    txHash: successes[0].value.hash,
    submittedToRpcs: successes.map((s) => s.value.rpc),
    walletAddress: account.address,
  };
}

function scaleFee(fee: bigint, multiplier: number): bigint {
  return BigInt(Math.ceil(Number(fee) * multiplier));
}

export async function waitForEvmConfirmation(
  txHash: Hex,
  chainId: number,
  timeoutMs = 30_000
): Promise<{ status: "success" | "reverted"; blockNumber: bigint; logs: Log[] } | null> {
  const rpcUrls = getEvmRpcUrls(chainId);
  if (rpcUrls.length === 0) return null;
  const publicClient = createPublicClient({ transport: http(rpcUrls[0]) });
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs });
    return {
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: receipt.blockNumber,
      logs: receipt.logs,
    };
  } catch {
    return null; // timed out or RPC error — caller treats this as "unknown, check the explorer"
  }
}

export interface DryRunResult {
  ok: boolean;
  issues: string[];
  info: Record<string, string>;
}

/**
 * Validates everything a real mint would need — mintSpec parses, wallet
 * exists and matches the chain, calldata encodes, and (the valuable part)
 * actually simulates the call via eth_estimateGas against current chain
 * state, so a mint that would revert shows up as an issue here instead of
 * burning gas for real. Never signs or broadcasts anything.
 */
export async function dryRunEvmMint(target: MintTarget, walletLabel: string): Promise<DryRunResult> {
  const issues: string[] = [];
  const info: Record<string, string> = {};

  if (target.chain !== "evm") {
    issues.push("Target is not an evm target");
    return { ok: false, issues, info };
  }
  if (!target.chainId) {
    issues.push("Target has no chainId set");
    return { ok: false, issues, info };
  }

  let spec: EvmMintSpec;
  try {
    spec = parseMintSpec(target.mintSpec);
  } catch (err) {
    issues.push(err instanceof Error ? err.message : String(err));
    return { ok: false, issues, info };
  }

  const secret = getSecret(walletLabel);
  if (secret.chain !== "evm") {
    issues.push(`Wallet "${walletLabel}" is not an evm wallet`);
    return { ok: false, issues, info };
  }
  const privateKeyHex = ("0x" + secret.secretBytes.toString("hex")) as Hex;
  const account = evmAccountFromPrivateKey(privateKeyHex);
  info.walletAddress = account.address;

  const rpcUrls = getEvmRpcUrls(target.chainId);
  if (rpcUrls.length === 0) {
    issues.push(`No RPC configured for chainId ${target.chainId} in EVM_RPC_URLS`);
    return { ok: false, issues, info };
  }

  let data: Hex;
  try {
    const abiItem = parseAbiItem(spec.functionAbi);
    data = encodeFunctionData({ abi: [abiItem], args: spec.args as readonly unknown[] });
  } catch (err) {
    issues.push(`Failed to encode calldata from functionAbi/args: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, issues, info };
  }

  const value = spec.valueEth ? parseEther(spec.valueEth) : 0n;
  info.value = `${formatEther(value)} ETH`;

  const publicClient = createPublicClient({ transport: http(rpcUrls[0]) });

  try {
    const [balance, feeData, gasEstimate] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.estimateFeesPerGas(),
      // This is the real check — it simulates the call against current chain
      // state and throws if it would revert (sold out, not started, wrong
      // price, wallet not allowlisted, etc).
      publicClient.estimateGas({ account: account.address, to: target.address as Address, data, value }),
    ]);

    info.walletBalance = `${formatEther(balance)} ETH`;
    info.estimatedGas = gasEstimate.toString();

    const suggestedGasLimit = (gasEstimate * 120n) / 100n; // 20% padding
    info.suggestedGasLimit = `${suggestedGasLimit} (add "gasLimit":"${suggestedGasLimit}" to mintSpec to skip gas estimation at mint time)`;

    const priorityMultiplier = spec.priorityFeeMultiplier ?? spec.feeMultiplier ?? DEFAULT_PRIORITY_FEE_MULTIPLIER;
    const maxMultiplier = spec.maxFeeMultiplier ?? spec.feeMultiplier ?? DEFAULT_MAX_FEE_MULTIPLIER;
    const minPriorityFee = spec.minPriorityFeeWei ? BigInt(spec.minPriorityFeeWei) : DEFAULT_MIN_PRIORITY_FEE_WEI;

    let maxPriorityFeePerGas = scaleFee(feeData.maxPriorityFeePerGas ?? 1_000_000_000n, priorityMultiplier);
    if (maxPriorityFeePerGas < minPriorityFee) maxPriorityFeePerGas = minPriorityFee;
    let maxFeePerGas = scaleFee(feeData.maxFeePerGas ?? 2_000_000_000n, maxMultiplier);
    if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas + (feeData.maxFeePerGas ?? 2_000_000_000n);

    info.priorityFeeGwei = (Number(maxPriorityFeePerGas) / 1e9).toFixed(4);
    info.maxFeeGwei = (Number(maxFeePerGas) / 1e9).toFixed(4);
    if ((feeData.maxPriorityFeePerGas ?? 0n) === 0n) {
      info.note = "RPC's priority fee estimate came back as 0 — the configured floor (minPriorityFeeWei) is what's actually being used.";
    }

    const estimatedGasCost = gasEstimate * maxFeePerGas;
    const estimatedTotalCost = estimatedGasCost + value;
    info.estimatedGasCost = `${formatEther(estimatedGasCost)} ETH`;
    info.estimatedTotalCost = `${formatEther(estimatedTotalCost)} ETH`;

    if (balance < estimatedTotalCost) {
      issues.push(
        `Wallet balance (${formatEther(balance)} ETH) is less than estimated total cost (${formatEther(estimatedTotalCost)} ETH)`
      );
    }
  } catch (err) {
    // estimateGas throwing almost always means the call would revert on-chain —
    // this is the dry run doing its job, not an infrastructure failure.
    issues.push(
      `Simulation failed — the mint would likely revert on-chain: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { ok: issues.length === 0, issues, info };
}
