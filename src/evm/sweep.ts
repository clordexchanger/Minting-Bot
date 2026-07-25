import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  encodeFunctionData,
  decodeEventLog,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { evmAccountFromPrivateKey } from "../wallet/evm.js";
import { getSecret } from "../wallet/keystore.js";
import { getEvmRpcUrls } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

const ERC721_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

/**
 * Scans mint receipt logs for an ERC-721 Transfer event landing on
 * `toAddress` from the target contract, and returns the tokenId.
 * KNOWN LIMITATION: this can't distinguish an ERC-721 Transfer from an
 * ERC-20 one that happens to share the same topic0 — fine for a contract
 * you already know is an NFT mint, not a generalized token classifier.
 */
export function extractMintedTokenId(
  logs: readonly Log[],
  contractAddress: Address,
  toAddress: Address
): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: [ERC721_TRANSFER_EVENT], topics: log.topics, data: log.data });
      const args = decoded.args as unknown as { from: Address; to: Address; tokenId: bigint };
      if (args.to.toLowerCase() === toAddress.toLowerCase()) return args.tokenId;
    } catch {
      continue; // log didn't match the Transfer(address,address,uint256) shape — not what we're looking for
    }
  }
  return null;
}

export async function sweepErc721(
  walletLabel: string,
  contractAddress: Address,
  tokenId: bigint,
  toAddress: Address,
  chainId: number
): Promise<Hex> {
  const secret = getSecret(walletLabel);
  if (secret.chain !== "evm") throw new Error(`Wallet "${walletLabel}" is not an evm wallet`);
  const privateKeyHex = ("0x" + secret.secretBytes.toString("hex")) as Hex;
  const account = evmAccountFromPrivateKey(privateKeyHex);

  const data = encodeFunctionData({
    abi: [parseAbiItem("function safeTransferFrom(address from, address to, uint256 tokenId)")],
    args: [account.address, toAddress, tokenId],
  });

  const rpcUrls = getEvmRpcUrls(chainId);
  if (rpcUrls.length === 0) throw new Error(`No RPC configured for chainId ${chainId} in EVM_RPC_URLS.`);

  const walletClient = createWalletClient({ account, transport: http(rpcUrls[0]) });
  logger.info("Sweeping ERC-721 out", { wallet: walletLabel, contractAddress, tokenId: tokenId.toString(), toAddress });
  return withRetry(() => walletClient.sendTransaction({ chain: null, to: contractAddress, data, chainId }), {
    label: "sweepErc721 sendTransaction",
  });
}

/**
 * Sends the wallet's remaining native balance out, minus a gas buffer sized
 * for one more simple transfer. Returns null (not an error) if there's
 * nothing worth sweeping after the buffer.
 */
export async function sweepNativeEvm(
  walletLabel: string,
  toAddress: Address,
  chainId: number
): Promise<Hex | null> {
  const secret = getSecret(walletLabel);
  if (secret.chain !== "evm") throw new Error(`Wallet "${walletLabel}" is not an evm wallet`);
  const privateKeyHex = ("0x" + secret.secretBytes.toString("hex")) as Hex;
  const account = evmAccountFromPrivateKey(privateKeyHex);

  const rpcUrls = getEvmRpcUrls(chainId);
  if (rpcUrls.length === 0) throw new Error(`No RPC configured for chainId ${chainId} in EVM_RPC_URLS.`);

  const publicClient = createPublicClient({ transport: http(rpcUrls[0]) });
  const [balance, feeData] = await Promise.all([
    withRetry(() => publicClient.getBalance({ address: account.address }), { label: "getBalance" }),
    withRetry(() => publicClient.estimateFeesPerGas(), { label: "estimateFeesPerGas" }),
  ]);

  const gasLimit = 21_000n; // plain native transfer
  // 1.2x padding on the estimated fee — without this, a fee bump between
  // estimation and broadcast can make the actual send cost more than the
  // buffer reserved, and the transfer fails for being 1 wei short.
  const maxFeePerGas = ((feeData.maxFeePerGas ?? 2_000_000_000n) * 12n) / 10n;
  const buffer = gasLimit * maxFeePerGas;
  const amount = balance - buffer;

  if (amount <= 0n) {
    logger.warn("Nothing to sweep after gas buffer", { wallet: walletLabel, balance: balance.toString() });
    return null;
  }

  const walletClient = createWalletClient({ account, transport: http(rpcUrls[0]) });
  // Same floor as the mint engine — a 0 estimate is common on some
  // L2s/testnets, and some nodes reject a literal 0 priority fee outright.
  const maxPriorityFeePerGas =
    (feeData.maxPriorityFeePerGas ?? 0n) > 0n ? feeData.maxPriorityFeePerGas! : 1_000_000_000n;
  logger.info("Sweeping native balance out", { wallet: walletLabel, amount: amount.toString(), toAddress });
  return withRetry(
    () =>
      walletClient.sendTransaction({
        chain: null,
        to: toAddress,
        value: amount,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId,
      }),
    { label: "sweepNativeEvm sendTransaction" }
  );
}
