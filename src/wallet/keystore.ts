import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { Chain } from "../config/targets.js";

interface EncryptedEntry {
  label: string;
  chain: Chain;
  address: string; // public, safe to store in the clear
  sweepTo?: string; // public destination address for fast wallet-out, not a secret
  salt: string; // hex, per-entry
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex — the raw private key / secret key bytes
}

interface KeystoreFile {
  entries: EncryptedEntry[];
}

function ensureFile(): void {
  const dir = dirname(env.walletKeystorePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(env.walletKeystorePath)) {
    writeFileSync(env.walletKeystorePath, JSON.stringify({ entries: [] }, null, 2), "utf-8");
  }
}

function load(): KeystoreFile {
  ensureFile();
  const raw = readFileSync(env.walletKeystorePath, "utf-8");
  return JSON.parse(raw) as KeystoreFile;
}

function save(file: KeystoreFile): void {
  ensureFile();
  writeFileSync(env.walletKeystorePath, JSON.stringify(file, null, 2), "utf-8");
}

function deriveKey(passphrase: string, saltHex: string): Buffer {
  return scryptSync(passphrase, Buffer.from(saltHex, "hex"), 32);
}

function requirePassphrase(): string {
  if (!env.walletKeystorePassphrase) {
    throw new Error(
      "WALLET_KEYSTORE_PASSPHRASE is not set. Set it in .env before adding or reading wallets."
    );
  }
  return env.walletKeystorePassphrase;
}

/** Encrypts and stores a secret (raw bytes, as a Buffer) under a label. Overwrites if the label exists. */
export function storeSecret(chain: Chain, label: string, address: string, secretBytes: Buffer): void {
  const passphrase = requirePassphrase();
  const file = load();

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt.toString("hex"));

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const existing = file.entries.find((e) => e.label === label);
  const entry: EncryptedEntry = {
    label,
    chain,
    address,
    sweepTo: existing?.sweepTo,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };

  const next = file.entries.filter((e) => e.label !== label);
  next.push(entry);
  save({ entries: next });
  logger.info("Wallet stored in keystore", { label, chain, address });
}

/** Decrypts and returns the raw secret bytes for a label. Only ever call this right before signing — don't cache the result longer than needed. */
export function getSecret(label: string): { chain: Chain; address: string; secretBytes: Buffer } {
  const passphrase = requirePassphrase();
  const file = load();
  const entry = file.entries.find((e) => e.label === label);
  if (!entry) throw new Error(`No wallet found with label "${label}"`);

  const key = deriveKey(passphrase, entry.salt);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "hex"));
  decipher.setAuthTag(Buffer.from(entry.authTag, "hex"));
  const secretBytes = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "hex")),
    decipher.final(),
  ]);

  return { chain: entry.chain, address: entry.address, secretBytes };
}

/** Public listing — labels, chains, addresses, and sweep destination only. Never returns key material. */
export function listWallets(): Array<{ label: string; chain: Chain; address: string; sweepTo?: string }> {
  const file = load();
  return file.entries.map(({ label, chain, address, sweepTo }) => ({ label, chain, address, sweepTo }));
}

export function setSweepTo(label: string, destination: string): boolean {
  const file = load();
  const entry = file.entries.find((e) => e.label === label);
  if (!entry) return false;
  entry.sweepTo = destination;
  save(file);
  logger.info("Sweep destination set", { label, destination });
  return true;
}

export function removeWallet(label: string): boolean {
  const file = load();
  const next = file.entries.filter((e) => e.label !== label);
  const removed = next.length !== file.entries.length;
  if (removed) save({ entries: next });
  return removed;
}
