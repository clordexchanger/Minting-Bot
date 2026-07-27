import {
  Connection,
  Transaction,
  TransactionInstruction,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getSecret } from "../wallet/keystore.js";
import { solanaKeypairFromSecret } from "../wallet/solana.js";
import type { MintTarget } from "../config/targets.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { pickJitoTipAccount } from "./jitoTipAccounts.js";
import { submitJitoBundle } from "./jitoBundle.js";

// Solana programs don't have a shared ABI format the way EVM contracts do
// (via a function signature). The operator supplies the fully-formed
// instruction: raw data bytes plus the account list, same way an existing
// sniper would construct it from the target program's IDL or a sample
// transaction. Example:
// {"instructionDataBase64":"AQ==","accounts":[{"pubkey":"...","isSigner":true,"isWritable":true}],"tipLamports":100000,"computeUnitPriceMicroLamports":50000}
//
// An account's pubkey can also be "$ephemeral:<anyToken>" (e.g.
// "$ephemeral:mint") instead of a real address — the engine generates a
// fresh keypair for each unique token, substitutes its real pubkey into the
// instruction, and co-signs the transaction with it. This covers mint flows
// (some Candy Machine-style programs, for one) that create a brand-new
// account inline and need it to sign alongside the wallet. The same token
// used twice in one mintSpec resolves to the same generated keypair.
interface SolanaMintSpec {
  instructionDataBase64: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  tipLamports?: number;
  computeUnitPriceMicroLamports?: number;
}

function parseMintSpec(raw: string): SolanaMintSpec {
  try {
    return JSON.parse(raw) as SolanaMintSpec;
  } catch {
    throw new Error(
      'mintSpec for a solana target must be JSON, e.g. {"instructionDataBase64":"...","accounts":[{"pubkey":"...","isSigner":true,"isWritable":true}],"tipLamports":100000}'
    );
  }
}

export interface SolanaMintResult {
  signature: string;
  wonVia: "jito" | "rpc";
  ephemeralAddresses: string[];
}

const MAX_BLOCKHASH_RETRIES = 2;
const EPHEMERAL_PREFIX = "$ephemeral:";

/** Recognizes the handful of error shapes Solana uses for "your blockhash expired." */
function isStaleBlockhashError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes("blockhash not found") ||
    msg.includes("block height exceeded") ||
    msg.includes("blockhashnotfound") ||
    msg.includes("transactionexpiredblockheightexceedederror")
  );
}

interface BuiltInstructions {
  instructions: TransactionInstruction[];
  ephemeralSigners: Keypair[];
}

function buildInstructions(spec: SolanaMintSpec, target: MintTarget, keypair: Keypair): BuiltInstructions {
  const programId = new PublicKey(target.address);
  const data = Buffer.from(spec.instructionDataBase64, "base64");

  const ephemeralMap = new Map<string, Keypair>();
  const keys = spec.accounts.map((a) => {
    let pubkey: PublicKey;
    if (a.pubkey.startsWith(EPHEMERAL_PREFIX)) {
      if (!ephemeralMap.has(a.pubkey)) {
        ephemeralMap.set(a.pubkey, Keypair.generate());
      }
      pubkey = ephemeralMap.get(a.pubkey)!.publicKey;
    } else {
      pubkey = new PublicKey(a.pubkey);
    }
    return { pubkey, isSigner: a.isSigner, isWritable: a.isWritable };
  });

  if (!keys.some((k) => k.pubkey.equals(keypair.publicKey))) {
    logger.warn(
      "Signing wallet's pubkey isn't in the target's accounts list — double-check the mintSpec was built for this wallet",
      { wallet: keypair.publicKey.toBase58(), target: target.label }
    );
  }

  const instructions: TransactionInstruction[] = [];

  if (spec.computeUnitPriceMicroLamports) {
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: spec.computeUnitPriceMicroLamports }));
  }

  instructions.push(new TransactionInstruction({ programId, keys, data }));

  const tipLamports = spec.tipLamports ?? 0;
  if (tipLamports > 0) {
    instructions.push(
      SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: pickJitoTipAccount(), lamports: tipLamports })
    );
  }

  return { instructions, ephemeralSigners: [...ephemeralMap.values()] };
}

/** Builds and signs a fresh transaction against the current blockhash. Called once up front, and again if a broadcast attempt fails with a stale-blockhash error. Reuses the same ephemeral signers across retries — they represent a specific new account being created, which shouldn't change identity just because the blockhash went stale. */
async function buildSignedTx(
  connection: Connection,
  instructions: TransactionInstruction[],
  keypair: Keypair,
  ephemeralSigners: Keypair[]
): Promise<{ txSignature: string; rawTx: Buffer }> {
  const { blockhash } = await withRetry(() => connection.getLatestBlockhash("confirmed"), {
    label: "getLatestBlockhash",
  });
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey }).add(...instructions);
  tx.sign(keypair, ...ephemeralSigners);
  if (!tx.signature) throw new Error("Transaction signing failed to produce a signature");
  return { txSignature: bs58.encode(tx.signature), rawTx: tx.serialize() };
}

export async function mintOnSolana(target: MintTarget, walletLabel: string): Promise<SolanaMintResult> {
  if (target.chain !== "solana") throw new Error("mintOnSolana called with a non-solana target");
  if (env.solanaRpcUrls.length === 0) throw new Error("No SOLANA_RPC_URLS configured in .env");

  const spec = parseMintSpec(target.mintSpec);
  const secret = getSecret(walletLabel);
  if (secret.chain !== "solana") throw new Error(`Wallet "${walletLabel}" is not a solana wallet`);
  const keypair = solanaKeypairFromSecret(secret.secretBytes);

  const { instructions, ephemeralSigners } = buildInstructions(spec, target, keypair);
  const ephemeralAddresses = ephemeralSigners.map((k) => k.publicKey.toBase58());
  const useJito = (spec.tipLamports ?? 0) > 0;
  const primaryConnection = new Connection(env.solanaRpcUrls[0], "confirmed");

  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_BLOCKHASH_RETRIES; attempt++) {
    const { txSignature, rawTx } = await buildSignedTx(primaryConnection, instructions, keypair, ephemeralSigners);

    logger.info("Broadcasting Solana mint tx", {
      target: target.label,
      wallet: walletLabel,
      tipLamports: spec.tipLamports ?? 0,
      rpcs: env.solanaRpcUrls.length,
      blockhashAttempt: attempt + 1,
      ephemeralSigners: ephemeralAddresses.length,
    });

    const attempts: Promise<"jito" | "rpc">[] = [];

    if (useJito) {
      attempts.push(submitJitoBundle(bs58.encode(rawTx), env.jitoBlockEngineUrl).then(() => "jito" as const));
    }

    for (const rpcUrl of env.solanaRpcUrls) {
      const conn = new Connection(rpcUrl, "confirmed");
      attempts.push(
        withRetry(() => conn.sendRawTransaction(rawTx, { skipPreflight: true }), {
          retries: 1,
          baseDelayMs: 150,
          label: `sendRawTransaction via ${rpcUrl}`,
        }).then(() => "rpc" as const)
      );
    }

    const results = await Promise.allSettled(attempts);
    const successes = results.filter((r): r is PromiseFulfilledResult<"jito" | "rpc"> => r.status === "fulfilled");

    if (successes.length > 0) {
      const wonVia = successes.some((s) => s.value === "jito") ? "jito" : "rpc";
      return { signature: txSignature, wonVia, ephemeralAddresses };
    }

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason));
    lastErrors = errors;

    const staleBlockhash = errors.some(isStaleBlockhashError);
    if (staleBlockhash && attempt < MAX_BLOCKHASH_RETRIES) {
      logger.warn("Blockhash went stale mid-broadcast, rebuilding with a fresh one", {
        target: target.label,
        attempt: attempt + 1,
      });
      continue; // loop rebuilds with a fresh blockhash, same ephemeral signers
    }

    break; // not a blockhash issue, or out of retries — give up
  }

  throw new Error(`All submissions failed: ${lastErrors.join(" | ")}`);
}

export async function waitForSolanaConfirmation(signature: string, timeoutMs = 30_000): Promise<"confirmed" | "unknown"> {
  const connection = new Connection(env.solanaRpcUrls[0], "confirmed");
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const confirmation = await Promise.race([
      connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return confirmation.value.err ? "unknown" : "confirmed";
  } catch {
    return "unknown";
  }
}

export interface DryRunResult {
  ok: boolean;
  issues: string[];
  info: Record<string, string>;
}

/**
 * Validates a solana mint without ever sending it — mintSpec parses, wallet
 * exists and matches the chain, instruction builds, and (the valuable part)
 * runs it through simulateTransaction against current chain state, so a
 * mint that would fail shows up as an issue here instead of burning a real
 * attempt.
 */
export async function dryRunSolanaMint(target: MintTarget, walletLabel: string): Promise<DryRunResult> {
  const issues: string[] = [];
  const info: Record<string, string> = {};

  if (target.chain !== "solana") {
    issues.push("Target is not a solana target");
    return { ok: false, issues, info };
  }
  if (env.solanaRpcUrls.length === 0) {
    issues.push("No SOLANA_RPC_URLS configured in .env");
    return { ok: false, issues, info };
  }

  let spec: SolanaMintSpec;
  try {
    spec = parseMintSpec(target.mintSpec);
  } catch (err) {
    issues.push(err instanceof Error ? err.message : String(err));
    return { ok: false, issues, info };
  }

  const secret = getSecret(walletLabel);
  if (secret.chain !== "solana") {
    issues.push(`Wallet "${walletLabel}" is not a solana wallet`);
    return { ok: false, issues, info };
  }
  const keypair = solanaKeypairFromSecret(secret.secretBytes);
  info.walletAddress = keypair.publicKey.toBase58();

  let instructions: TransactionInstruction[];
  let ephemeralSigners: Keypair[];
  try {
    const built = buildInstructions(spec, target, keypair);
    instructions = built.instructions;
    ephemeralSigners = built.ephemeralSigners;
    if (ephemeralSigners.length > 0) {
      info.ephemeralSigners = ephemeralSigners.map((k) => k.publicKey.toBase58()).join(", ");
    }
  } catch (err) {
    issues.push(`Failed to build instruction from mintSpec: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, issues, info };
  }

  const connection = new Connection(env.solanaRpcUrls[0], "confirmed");

  try {
    const balance = await withRetry(() => connection.getBalance(keypair.publicKey), { label: "getBalance" });
    info.walletBalance = `${(balance / 1_000_000_000).toFixed(6)} SOL`;

    const { blockhash } = await withRetry(() => connection.getLatestBlockhash("confirmed"), {
      label: "getLatestBlockhash",
    });
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey }).add(...instructions);
    tx.sign(keypair, ...ephemeralSigners);

    const simulation = await connection.simulateTransaction(tx);
    if (simulation.value.err) {
      issues.push(`Simulation failed — the mint would likely fail on-chain: ${JSON.stringify(simulation.value.err)}`);
    }
    if (simulation.value.unitsConsumed !== undefined) {
      info.computeUnitsUsed = String(simulation.value.unitsConsumed);
    }
    if (simulation.value.logs && simulation.value.logs.length > 0) {
      info.lastProgramLogs = simulation.value.logs.slice(-3).join(" | ");
    }

    const tipLamports = spec.tipLamports ?? 0;
    const roughFeeBuffer = 5_000 + tipLamports;
    info.tipLamports = String(tipLamports);
    if (balance < roughFeeBuffer) {
      issues.push(`Wallet balance may be insufficient for network fee + tip (~${roughFeeBuffer} lamports needed)`);
    }
  } catch (err) {
    issues.push(`Simulation RPC error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { ok: issues.length === 0, issues, info };
}
