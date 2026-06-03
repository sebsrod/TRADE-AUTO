import { Hono } from "hono";
import type { Env } from "../types";
import type { AssetCategory } from "../../shared/types";
import { deleteAsset, insertAsset, listAssets, updateAsset } from "../db";

const assets = new Hono<{ Bindings: Env }>();

const CATEGORIES: AssetCategory[] = ["stock", "etf", "future", "option", "crypto"];

assets.get("/", async (c) => {
  const all = await listAssets(c.env);
  return c.json(all);
});

// Add a monitored instrument.
assets.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const category = String(body.category ?? "").toLowerCase() as AssetCategory;
  if (!symbol) return c.json({ error: "symbol is required" }, 400);
  if (!CATEGORIES.includes(category)) {
    return c.json({ error: `category must be one of ${CATEGORIES.join(", ")}` }, 400);
  }
  const data_source =
    typeof body.data_source === "string" && body.data_source
      ? String(body.data_source)
      : category === "crypto"
        ? "binance"
        : "yahoo";
  const asset = await insertAsset(c.env, {
    symbol,
    display_symbol: body.display_symbol ? String(body.display_symbol) : symbol,
    name: body.name ? String(body.name) : symbol,
    category,
    data_source,
    quote_currency: body.quote_currency ? String(body.quote_currency) : "USD",
  });
  return c.json(asset, 201);
});

// Update whitelist / active flags (the asset whitelist controls the AI).
assets.patch("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (body.whitelisted !== undefined) patch.whitelisted = body.whitelisted ? 1 : 0;
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  if (body.data_source !== undefined) patch.data_source = String(body.data_source);
  if (body.name !== undefined) patch.name = String(body.name);
  const updated = await updateAsset(c.env, id, patch);
  if (!updated) return c.json({ error: "asset not found" }, 404);
  return c.json(updated);
});

assets.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await deleteAsset(c.env, id);
  return c.json({ ok: true });
});

export default assets;
