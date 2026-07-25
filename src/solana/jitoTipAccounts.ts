import { PublicKey } from "@solana/web3.js";

// Published Jito tip accounts (mainnet). Sending a tip to any one of these,
// bundled with the mint instruction, is what buys priority inclusion via
// Jito's block engine. Picking one at random spreads load across them —
// Jito's own docs recommend this rather than hammering a single account.
const TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

// Worth double-checking this list against Jito's current docs before relying
// on it — tip accounts have changed before and a stale one just means the
// tip (and the priority it buys) is wasted, not a hard failure.
export function pickJitoTipAccount(): PublicKey {
  const address = TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];
  return new PublicKey(address);
}
