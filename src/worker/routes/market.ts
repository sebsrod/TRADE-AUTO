import { Hono } from "hono";
import type { Env } from "../types";
import { defaultUserId, ensureUser, getAsset } from "../db";
import { getSnapshot } from "../services/analysisEngine";
import { normalizeInterval } from "../services/marketData";

const market = new Hono<{ Bindings: Env }>();

// GET cached/fresh OHLCV + indicators for an asset (powers the price chart).
// Interval defaults to the user's configured analysis timeframe; ?interval= overrides.
market.get("/:assetId", async (c) => {
  const id = parseInt(c.req.param("assetId"), 10);
  const asset = await getAsset(c.env, id);
  if (!asset) return c.json({ error: "asset not found" }, 404);
  try {
    const maxAge = parseInt(c.req.query("maxAgeMin") ?? "60", 10);
    const qInterval = c.req.query("interval");
    const user = await ensureUser(c.env, defaultUserId(c.env));
    const interval = normalizeInterval(qInterval ?? user.analysis_timeframe);
    const snap = await getSnapshot(c.env, asset, Number.isFinite(maxAge) ? maxAge : 60, interval);
    return c.json({
      asset,
      price: snap.price,
      source: snap.source,
      cached: snap.cached,
      interval: snap.interval,
      indicators: snap.indicators,
      candles: snap.candles,
    });
  } catch (e) {
    return c.json(
      { error: "failed to fetch market data", detail: e instanceof Error ? e.message : String(e) },
      502,
    );
  }
});

export default market;
