import { Hono } from "hono";
import type { AppBindings } from "../types";
import type { TradeSide } from "../../shared/types";
import {
  getAsset,
  getTrade,
  getUser,
  listTrades,
} from "../db";
import { num } from "../util";
import { closePosition, openPosition } from "../services/paperTrading";
import { getLivePrice, recordEquity } from "../services/analysisEngine";
import { normalizeInterval } from "../services/marketData";

const trades = new Hono<AppBindings>();

trades.get("/", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const status = c.req.query("status") as "open" | "closed" | undefined;
  const limit = parseInt(c.req.query("limit") ?? "200", 10);
  const list = await listTrades(c.env, user.id, {
    status: status === "open" || status === "closed" ? status : undefined,
    limit: Number.isFinite(limit) ? limit : 200,
  });
  return c.json(list);
});

// Manually open a paper position.
trades.post("/", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const assetId = parseInt(String(body.assetId ?? body.asset_id ?? ""), 10);
  const asset = await getAsset(c.env, assetId);
  if (!asset) return c.json({ error: "asset not found" }, 404);

  const side: TradeSide = body.side === "short" ? "short" : "long";
  let entry = num(body.entry, 0);
  if (!(entry > 0)) {
    // Fill at the live spot quote — the same price feed the dashboard shows — so a
    // position's realized P&L is consistent with the live P&L the user saw.
    const live = await getLivePrice(c.env, asset, 8, normalizeInterval(user.analysis_timeframe));
    if (!(live != null && live > 0)) {
      return c.json({ error: "could not determine a live price for this asset" }, 502);
    }
    entry = live;
  }

  const res = await openPosition(c.env, user, asset, {
    side,
    entry,
    stopLoss: num(body.stopLoss ?? body.stop_loss, 0),
    takeProfit: num(body.takeProfit ?? body.take_profit, 0),
    confidence: body.confidence !== undefined ? num(body.confidence) : null,
    rationale: body.rationale ? String(body.rationale) : "Manual trade",
    aiLogId: null,
  });
  if (!res.ok) return c.json({ error: res.reason }, 400);

  const fresh = (await getUser(c.env, user.id)) ?? user;
  await recordEquity(c.env, fresh);
  return c.json(res.trade, 201);
});

// Manually close a position (overrides the min-hold guardrail).
trades.post("/:id/close", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const id = parseInt(c.req.param("id"), 10);
  const trade = await getTrade(c.env, id);
  if (!trade || trade.user_id !== user.id) return c.json({ error: "trade not found" }, 404);
  if (trade.status !== "open") return c.json({ error: "trade already closed" }, 400);

  const asset = await getAsset(c.env, trade.asset_id);
  if (!asset) return c.json({ error: "asset not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let price = num(body.exit_price ?? body.price, 0);
  if (!(price > 0)) {
    // Close at the live spot quote so the realized P&L matches the live unrealized
    // P&L shown on the dashboard (not a stale cached snapshot price).
    const live = await getLivePrice(c.env, asset, 8, normalizeInterval(user.analysis_timeframe));
    if (!(live != null && live > 0)) {
      return c.json({ error: "could not determine a live price for this asset" }, 502);
    }
    price = live;
  }

  const res = await closePosition(c.env, user, trade, price, "manual", { force: true });
  if (!res.ok) return c.json({ error: res.reason }, 400);

  const fresh = (await getUser(c.env, user.id)) ?? user;
  await recordEquity(c.env, fresh);
  return c.json(res.trade);
});

export default trades;
