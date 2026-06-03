import { Hono } from "hono";
import type { Env } from "../types";
import { getAsset } from "../db";
import { getSnapshot } from "../services/analysisEngine";

const market = new Hono<{ Bindings: Env }>();

// GET cached/fresh OHLCV + indicators for an asset (powers the price chart).
market.get("/:assetId", async (c) => {
  const id = parseInt(c.req.param("assetId"), 10);
  const asset = await getAsset(c.env, id);
  if (!asset) return c.json({ error: "asset not found" }, 404);
  try {
    const maxAge = parseInt(c.req.query("maxAgeMin") ?? "60", 10);
    const snap = await getSnapshot(c.env, asset, Number.isFinite(maxAge) ? maxAge : 60);
    return c.json({
      asset,
      price: snap.price,
      source: snap.source,
      cached: snap.cached,
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
