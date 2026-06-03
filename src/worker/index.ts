// TRADE-AUTO Worker entry point.
// Handles HTTP (Hono router for /api/*, static SPA for everything else) and the
// scheduled cron trigger that runs the Gemini analysis + paper-trading cycle.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import config from "./routes/config";
import assets from "./routes/assets";
import market from "./routes/market";
import portfolio from "./routes/portfolio";
import trades from "./routes/trades";
import ai from "./routes/ai";
import { runCronCycle } from "./services/analysisEngine";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

const api = new Hono<{ Bindings: Env }>();
api.get("/health", (c) =>
  c.json({
    ok: true,
    service: "trade-auto",
    geminiConfigured: !!c.env.GEMINI_API_KEY,
    model: c.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    time: new Date().toISOString(),
  }),
);
api.route("/config", config);
api.route("/assets", assets);
api.route("/market", market);
api.route("/portfolio", portfolio);
api.route("/trades", trades);
api.route("/ai", ai);

// Unknown API routes → JSON 404 (don't fall through to the SPA).
api.all("*", (c) => c.json({ error: "not found" }, 404));

app.route("/api", api);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "internal error", detail: err.message }, 500);
});

// Everything that isn't /api is served by the static-asset bundle.
// not_found_handling="single-page-application" returns index.html for client routes.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runCronCycle(env)
        .then((summary) => console.log("cron cycle complete:", JSON.stringify(summary)))
        .catch((err) => console.error("cron cycle failed:", err)),
    );
  },
} satisfies ExportedHandler<Env>;
