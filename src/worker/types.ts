import type { D1Database, Fetcher } from "@cloudflare/workers-types";

// Cloudflare bindings + environment. Secrets are injected at runtime
// (via `.dev.vars` locally or `wrangler secret put` in production).
export interface Env {
  // Bindings
  DB: D1Database;
  ASSETS: Fetcher;

  // Non-secret vars (wrangler.jsonc -> vars)
  GEMINI_MODEL?: string;
  GEMINI_DISCOVERY_MODEL?: string;
  DEFAULT_USER_ID?: string;
  ENABLE_SEARCH_GROUNDING?: string;
  CRON_AUTO_TRADE?: string;

  // Secrets
  GEMINI_API_KEY?: string;
  FINNHUB_API_KEY?: string;
  ALPHAVANTAGE_API_KEY?: string;
  POLYGON_API_KEY?: string;
  COINGECKO_API_KEY?: string;
}
