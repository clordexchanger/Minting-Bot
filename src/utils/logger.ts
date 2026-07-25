type Level = "info" | "warn" | "error" | "debug";

function line(level: Level, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? " " + JSON.stringify(meta) : "";
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(line("info", msg, meta)),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(line("warn", msg, meta)),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(line("error", msg, meta)),
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.DEBUG) console.log(line("debug", msg, meta));
  },
};
