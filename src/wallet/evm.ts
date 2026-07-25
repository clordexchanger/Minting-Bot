import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createPublicClient, http, formatEther, type Address } from "viem";

/** Derives the address for a raw private key without needing an RPC connection. */
export function evmAddressFromPrivateKey(privateKeyHex: string): Address {
  const account = privateKeyToAccount(normalizeHex(privateKeyHex));
  return account.address;
}

export function evmAccountFromPrivateKey(privateKeyHex: string): PrivateKeyAccount {
  return privateKeyToAccount(normalizeHex(privateKeyHex));
}

function normalizeHex(key: string): `0x${string}` {
  const trimmed = key.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

/** Reads a native balance. Returns null if no RPC URL is available rather than throwing,
 * since balance display is a nice-to-have, not something that should crash /status. */
export async function getEvmBalance(rpcUrl: string | undefined, address: Address): Promise<string | null> {
  if (!rpcUrl) return null;
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const balance = await client.getBalance({ address });
    return formatEther(balance);
  } catch {
    return null;
  }
}
