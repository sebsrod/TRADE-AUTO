// The Hono application: /api routes + SPA fallback. Shared by the Worker entry
// (src/worker/index.ts) and the Cloudflare Pages function (functions/api/[[route]].ts).

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import type { AppBindings } from "./types";
import { getSessionUserId } from "./db";
import { SESSION_COOKIE, hashToken } from "./services/auth";
import auth from "./routes/auth";
import config from "./routes/config";
import assets from "./routes/assets";
import market from "./routes/market";
import options from "./routes/options";
import portfolio from "./routes/portfolio";
import trades from "./routes/trades";
import ai from "./routes/ai";

export const app = new Hono<AppBindings>();

app.use("/api/*", cors());

// Endpoints reachable without a session. Everything else requires a valid cookie.
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/logout",
]);

// Session guard: resolve the opaque cookie token → user id, or 401. Runs before the
// API router so every protected route can trust c.get("userId").
app.use("/api/*", async (c, next) => {
  if (c.req.method === "OPTIONS" || PUBLIC_PATHS.has(c.req.path)) return next();
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const userId = await getSessionUserId(c.env, await hashToken(token));
    if (userId != null) {
      c.set("userId", userId);
      return next();
    }
  }
  return c.json({ error: "unauthorized" }, 401);
});

const api = new Hono<AppBindings>();
api.get("/health", (c) =>
  c.json({
    ok: true,
    service: "trade-auto",
    geminiConfigured: !!c.env.GEMINI_API_KEY,
    model: c.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    time: new Date().toISOString(),
  }),
);
api.route("/auth", auth);
api.route("/config", config);
api.route("/assets", assets);
api.route("/market", market);
api.route("/options", options);
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

// Non-API requests fall back to the static-asset bundle (Worker mode only; on
// Pages, static assets + _redirects handle this before the function is reached).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
