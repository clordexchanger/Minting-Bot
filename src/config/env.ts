import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export interface EvmRpcMap {
  [chainId: string]: string[];
}

function parseEvmRpcMap(raw: string): EvmRpcMap {
  if (!raw) return {};
  let parsed: Record<string, string | string[]>;
  try {
    parsed = JSON.parse(raw) as Record<string, string | string[]>;
  } catch {
    throw new Error(
      'EVM_RPC_URLS must be JSON mapping chainId to an RPC URL or array of URLs, e.g. {"84532":"https://base-sepolia.g.alchemy.com/v2/KEY","8453":"https://base-mainnet.g.alchemy.com/v2/KEY"}'
    );
  }
  const map: EvmRpcMap = {};
  for (const [chainId, value] of Object.entries(parsed)) {
    map[chainId] = Array.isArray(value) ? value : splitList(value);
  }
  return map;
}

export const env = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  // Operator ID gates every command. Everyone else is ignored.
  telegramOperatorId: Number(required("TELEGRAM_OPERATOR_ID")),

  // Keyed by chainId (as a string) so one .env can hold RPC URLs for every
  // network you target at once, instead of just one chain at a time.
  evmRpcMap: parseEvmRpcMap(optional("EVM_RPC_URLS", "")),
  solanaRpcUrls: splitList(optional("SOLANA_RPC_URLS", "")),
  jitoBlockEngineUrl: optional("JITO_BLOCK_ENGINE_URL", "https://mainnet.block-engine.jito.wtf"),

  walletKeystorePath: optional("WALLET_KEYSTORE_PATH", "./data/keystore.enc.json"),
  walletKeystorePassphrase: process.env.WALLET_KEYSTORE_PASSPHRASE ?? "",

  targetsFile: optional("TARGETS_FILE", "./data/targets.json"),
};

/** RPC URLs configured for a given evm chain. Empty array if none are set for it. */
export function getEvmRpcUrls(chainId: number): string[] {
  return env.evmRpcMap[String(chainId)] ?? [];
}

if (Number.isNaN(env.telegramOperatorId)) {
  throw new Error("TELEGRAM_OPERATOR_ID must be a numeric Telegram user ID.");
}
