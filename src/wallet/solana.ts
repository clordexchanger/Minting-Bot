import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

/** Accepts either a base58-encoded secret key (Phantom export format) or raw bytes. */
export function solanaKeypairFromSecret(secretBytes: Buffer): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(secretBytes));
}

export function solanaSecretFromBase58(base58Secret: string): Buffer {
  return Buffer.from(bs58.decode(base58Secret.trim()));
}

export async function getSolanaBalance(rpcUrl: string | undefined, address: string): Promise<string | null> {
  if (!rpcUrl) return null;
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const lamports = await connection.getBalance(new PublicKey(address));
    return (lamports / LAMPORTS_PER_SOL).toString();
  } catch {
    return null;
  }
}
