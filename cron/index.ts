// Companion cron Worker for the TRADE-AUTO Pages app.
// Cloudflare Pages can't run cron triggers, so this Worker runs the analysis cycle
// on a schedule against the SAME D1 database, reusing the app's service code.

import { runCronCycle } from "../src/worker/services/analysisEngine";
import type { Env } from "../src/worker/types";

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Secrets are per-Worker on Cloudflare: this Worker needs its OWN GEMINI_API_KEY
    // (wrangler secret put GEMINI_API_KEY --config cron/wrangler.jsonc). Warn loudly
    // if it's missing so the cycle's silent no-op is observable.
    if (!env.GEMINI_API_KEY) {
      console.warn(
        "trade-auto-cron: GEMINI_API_KEY is not set on this Worker — discovery & auto-trade will be skipped. " +
          "Run: wrangler secret put GEMINI_API_KEY --config cron/wrangler.jsonc",
      );
    }
    ctx.waitUntil(
      runCronCycle(env)
        .then((summary) => console.log("cron cycle complete:", JSON.stringify(summary)))
        .catch((err) => console.error("cron cycle failed:", err)),
    );
  },

  // Manual trigger for testing: GET /__run executes one cycle.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/__run") {
      const summary = await runCronCycle(env);
      return Response.json(summary);
    }
    return new Response("trade-auto cron worker — runs the AI cycle every 2h", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
