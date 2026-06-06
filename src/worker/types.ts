import type { D1Database, Fetcher } from "@cloudflare/workers-types";
import type { User } from "../shared/types";

// Cloudflare bindings + environment. Secrets are injected at runtime
// (via `.dev.vars` locally or `wrangler secret put` in production).
export interface Env {
  // Bindings
  DB: D1Database;
  ASSETS: Fetcher;

  // Non-secret vars (wrangler.jsonc -> vars)
  CLAUDE_MODEL?: string;
  CLAUDE_DISCOVERY_MODEL?: string;
  DEFAULT_USER_ID?: string;
  CRON_AUTO_TRADE?: string;

  // Secrets
  ANTHROPIC_API_KEY?: string;
  FINNHUB_API_KEY?: string;
  ALPHAVANTAGE_API_KEY?: string;
  POLYGON_API_KEY?: string;
  COINGECKO_API_KEY?: string;
}

// A users row as stored in D1: the public User plus secret credential columns
// (added in migration 0005). Never send a UserRow to the client unsanitized —
// use sanitizeUser() so password_hash/password_salt never leave the Worker.
export interface UserRow extends User {
  password_hash: string | null;
  password_salt: string | null;
}

// Hono app type: D1/asset bindings + the authenticated user id that the session
// middleware sets on every protected /api/* request.
export type AppBindings = {
  Bindings: Env;
  Variables: { userId: number };
};
