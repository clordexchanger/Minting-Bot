import { generatePrivateKey } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import { evmAddressFromPrivateKey } from "./evm.js";

export function generateEvmKeypair(): { address: string; privateKeyHex: string } {
  const privateKeyHex = generatePrivateKey(); // cryptographically secure, 0x-prefixed
  const address = evmAddressFromPrivateKey(privateKeyHex);
  return { address, privateKeyHex };
}

export function generateSolanaKeypair(): { address: string; secretBytes: Buffer } {
  const keypair = Keypair.generate();
  return { address: keypair.publicKey.toBase58(), secretBytes: Buffer.from(keypair.secretKey) };
}
