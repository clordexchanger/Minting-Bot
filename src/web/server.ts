import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Bot } from "grammy";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { buildApiRouter } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (req.session.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}

/**
 * Starts the web dashboard on its own port, in the same process as the
 * Telegram bot. Every state-changing route reuses the exact same engine
 * functions the bot uses (mintOnEvm, sweep functions, keystore, etc.) —
 * this is a second interface onto the same backend, not a separate system.
 */
export function startWebDashboard(bot: Bot): void {
  if (!env.webDashboardEnabled) return;

  const app = express();
  // Caddy terminates TLS and forwards to this app over plain HTTP on
  // localhost — without this, Express has no way to know the original
  // browser connection was HTTPS, and express-session silently refuses to
  // reliably set a "secure" cookie behind a reverse proxy.
  app.set("trust proxy", 1);
  app.use(express.json());

  // Without this, browsers can cache a GET /api/me response (e.g. "not
  // authenticated") and reuse it via a 304 on the next request instead of
  // asking again — which makes a successful login look like it silently
  // did nothing, since the client never learns the session actually
  // changed. Every /api/* response must always be re-fetched fresh.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    session({
      secret: env.webSessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: true, // trust X-Forwarded-Proto from Caddy when deciding if the cookie can be marked secure
      cookie: {
        httpOnly: true,
        secure: env.webCookieSecure,
        maxAge: 1000 * 60 * 60 * 12, // 12 hours
      },
    })
  );

  // Login/logout are the only unauthenticated routes.
  app.post("/api/login", (req, res) => {
    const { password } = req.body ?? {};
    if (typeof password === "string" && password === env.webDashboardPassword) {
      req.session.authenticated = true;
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: "Wrong password" });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/me", (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
  });

  // Everything else under /api needs a session.
  app.use("/api", requireAuth, buildApiRouter(bot));

  // Static frontend. index.html itself checks auth client-side via /api/me
  // and shows a login form if not authenticated — the HTML/JS/CSS are not
  // secret, only the API routes are gated.
  app.use(express.static(path.join(__dirname, "public")));

  app.listen(env.webDashboardPort, () => {
    logger.info("Web dashboard listening", { port: env.webDashboardPort });
  });
}
