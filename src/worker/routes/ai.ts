import { Hono } from "hono";
import type { AppBindings } from "../types";
import type { TradeSide } from "../../shared/types";
import {
  getAsset,
  getSuggestion,
  getUser,
  listAILogs,
  listAssets,
  listSuggestions,
  setSuggestionStatus,
} from "../db";
import { openPosition } from "../services/paperTrading";
import { normalizeInterval } from "../services/marketData";
import {
  analyzeOneAsset,
  getPrice,
  recordEquity,
  runCronCycle,
  runDiscovery,
} from "../services/analysisEngine";

const ai = new Hono<AppBindings>();

// Recent Gemini analysis logs.
ai.get("/logs", async (c) => {
  const kind = c.req.query("kind") ?? undefined;
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const logs = await listAILogs(c.env, { kind, limit: Number.isFinite(limit) ? limit : 50 });
  return c.json(logs);
});

// Discovered "Suggested Assets to Trade".
ai.get("/suggestions", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const status = c.req.query("status") ?? undefined;
  const list = await listSuggestions(c.env, user.id, { status });
  return c.json(list);
});

// Run a deep per-asset analysis. Pass {"execute": true} to act on the decision.
ai.post("/analyze/:assetId", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const id = parseInt(c.req.param("assetId"), 10);
  const asset = await getAsset(c.env, id);
  if (!asset) return c.json({ error: "asset not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await analyzeOneAsset(c.env, user, asset, !!body.execute);
    if (body.execute) await recordEquity(c.env, (await getUser(c.env, user.id)) ?? user);
    return c.json(result);
  } catch (e) {
    return c.json({ error: "analysis failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// Run the market-discovery scan now.
ai.post("/discover", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const maxIdeas = parseInt(c.req.query("maxIdeas") ?? "5", 10);
  try {
    const result = await runDiscovery(c.env, user, Number.isFinite(maxIdeas) ? maxIdeas : 5);
    const suggestions = await listSuggestions(c.env, user.id, { status: "pending" });
    return c.json({ ...result, suggestions });
  } catch (e) {
    return c.json({ error: "discovery failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// Manually trigger the full scheduled cycle for the current user.
ai.post("/run-cycle", async (c) => {
  try {
    const summary = await runCronCycle(c.env, c.get("userId"));
    return c.json(summary);
  } catch (e) {
    return c.json({ error: "cycle failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// Approve a suggestion → open a paper position from it.
ai.post("/suggestions/:id/approve", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const id = parseInt(c.req.param("id"), 10);
  const sug = await getSuggestion(c.env, id);
  if (!sug || sug.user_id !== user.id) return c.json({ error: "suggestion not found" }, 404);
  if (sug.status !== "pending") return c.json({ error: `suggestion is ${sug.status}` }, 400);

  let asset = sug.asset_id ? await getAsset(c.env, sug.asset_id) : null;
  if (!asset) {
    const all = await listAssets(c.env);
    asset = all.find((a) => a.symbol === sug.symbol) ?? null;
  }
  if (!asset) return c.json({ error: "asset for suggestion not found" }, 404);

  let entry = sug.entry ?? 0;
  try {
    entry = (await getPrice(c.env, asset, 15, normalizeInterval(user.analysis_timeframe))) || sug.entry || 0;
  } catch {
    /* fall back to suggestion entry */
  }

  const side: TradeSide = sug.direction === "short" ? "short" : "long";
  const res = await openPosition(c.env, user, asset, {
    side,
    entry,
    stopLoss: sug.stop_loss ?? 0,
    takeProfit: sug.take_profit ?? 0,
    confidence: sug.confidence,
    rationale: `[approved] ${sug.strategy ?? ""}: ${sug.rationale ?? ""}`.slice(0, 1000),
    aiLogId: sug.ai_log_id,
  });
  if (!res.ok) return c.json({ error: res.reason }, 400);

  await setSuggestionStatus(c.env, id, "executed");
  await recordEquity(c.env, (await getUser(c.env, user.id)) ?? user);
  return c.json({ ok: true, trade: res.trade });
});

// Reject a suggestion.
ai.post("/suggestions/:id/reject", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const id = parseInt(c.req.param("id"), 10);
  const sug = await getSuggestion(c.env, id);
  if (!sug || sug.user_id !== user.id) return c.json({ error: "suggestion not found" }, 404);
  await setSuggestionStatus(c.env, id, "rejected");
  return c.json({ ok: true });
});

export default ai;
