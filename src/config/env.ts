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

  // Web dashboard — off by default. Set WEB_DASHBOARD_ENABLED=true plus a
  // password to turn it on. This runs alongside the Telegram bot in the
  // same process, not instead of it.
  webDashboardEnabled: optional("WEB_DASHBOARD_ENABLED", "false") === "true",
  webDashboardPort: Number(optional("WEB_DASHBOARD_PORT", "8443")),
  webDashboardPassword: process.env.WEB_DASHBOARD_PASSWORD ?? "",
  webSessionSecret: process.env.WEB_SESSION_SECRET ?? "",
  // Only set this true once the dashboard is actually served over HTTPS —
  // a "secure" cookie is refused by the browser over plain HTTP, which
  // would make login silently fail.
  webCookieSecure: optional("WEB_COOKIE_SECURE", "false") === "true",
};

/** RPC URLs configured for a given evm chain. Empty array if none are set for it. */
export function getEvmRpcUrls(chainId: number): string[] {
  return env.evmRpcMap[String(chainId)] ?? [];
}

if (Number.isNaN(env.telegramOperatorId)) {
  throw new Error("TELEGRAM_OPERATOR_ID must be a numeric Telegram user ID.");
}

if (env.webDashboardEnabled) {
  if (!env.webDashboardPassword) {
    throw new Error("WEB_DASHBOARD_ENABLED is true but WEB_DASHBOARD_PASSWORD is not set — set a strong password before enabling the dashboard.");
  }
  if (!env.webSessionSecret) {
    throw new Error("WEB_DASHBOARD_ENABLED is true but WEB_SESSION_SECRET is not set — set any long random string.");
  }
}
