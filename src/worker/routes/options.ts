import { Hono } from "hono";
import type { AppBindings } from "../types";
import { fetchOptionChain } from "../services/marketData";
import { insertAsset } from "../db";

const options = new Hono<AppBindings>();

// GET the option chain for an underlying symbol.
// ?expiration=<epochMs> selects a specific expiry (defaults to the nearest).
options.get("/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  const expQ = c.req.query("expiration");
  const expiration = expQ ? parseInt(expQ, 10) : undefined;
  try {
    const chain = await fetchOptionChain(
      symbol,
      c.env,
      expiration && Number.isFinite(expiration) ? expiration : undefined,
    );
    return c.json(chain);
  } catch (e) {
    return c.json(
      { error: "failed to fetch option chain", detail: e instanceof Error ? e.message : String(e) },
      502,
    );
  }
});

// Add a specific option contract (OCC symbol) to the watchlist as a tradable asset.
options.post("/track", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const contractSymbol = String(body.contractSymbol ?? "").trim().toUpperCase();
  if (!contractSymbol) return c.json({ error: "contractSymbol is required" }, 400);
  const asset = await insertAsset(c.env, {
    symbol: contractSymbol,
    display_symbol: body.display_symbol ? String(body.display_symbol) : contractSymbol,
    name: body.name ? String(body.name) : contractSymbol,
    category: "option",
    data_source: "yahoo",
  });
  return c.json(asset, 201);
});

export default options;
