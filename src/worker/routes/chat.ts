import { Hono } from "hono";
import type { AppBindings, Env } from "../types";
import type { Asset, User } from "../../shared/types";
import {
  deleteChatMessages,
  getUser,
  insertChatMessage,
  listAssets,
  listChatMessages,
} from "../db";
import { getSnapshot } from "../services/analysisEngine";
import { chatWithGemini } from "../services/gemini";
import { normalizeInterval } from "../services/marketData";

const chat = new Hono<AppBindings>();

const fmt = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? "n/a" : Number(n).toFixed(dp);

// One compact, model-readable context line for an asset (live indicators snapshot).
async function assetContext(env: Env, user: User, asset: Asset): Promise<string | null> {
  try {
    const tf = normalizeInterval(user.analysis_timeframe);
    const snap = await getSnapshot(env, asset, 30, tf);
    const i = snap.indicators;
    return (
      `${asset.display_symbol || asset.symbol} (${asset.category}, ${tf}): ` +
      `price=${fmt(i.price, 4)}, trend=${i.trend}, rsi14=${fmt(i.rsi14)}, ` +
      `macd=${fmt(i.macd, 4)}/${fmt(i.macdSignal, 4)}, sma20=${fmt(i.sma20, 4)} sma50=${fmt(i.sma50, 4)} sma200=${fmt(i.sma200, 4)}, ` +
      `bb=${fmt(i.bbLower, 4)}..${fmt(i.bbUpper, 4)}, atr14=${fmt(i.atr14, 4)}, ` +
      `52w=${fmt(i.low52, 4)}..${fmt(i.high52, 4)}, chg24h%=${fmt(i.changePct24h)}`
    );
  } catch {
    return null;
  }
}

// Find up to `max` assets the message is plausibly about: the explicit symbol first,
// then any watchlist symbol (or its base ticker, e.g. BTC for BTCUSDT) named in the text.
async function resolveContextAssets(
  env: Env,
  explicitSymbol: string | null,
  message: string,
  max = 3,
): Promise<Asset[]> {
  const assets = await listAssets(env, { activeOnly: true });
  const upper = message.toUpperCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole-token match only: the ticker must be bounded by non-alphanumerics (or string
  // ends), so it can't match inside an ordinary word. e.g. "ES" never matches "best" or
  // the Spanish "es", "SOL" never matches "consolidate".
  const mentions = (t: string) =>
    new RegExp(`(?:^|[^A-Z0-9])${esc(t.toUpperCase())}(?:[^A-Z0-9]|$)`).test(upper);
  const picked: Asset[] = [];
  const seen = new Set<number>();
  const add = (a: Asset | undefined | null) => {
    if (a && !seen.has(a.id) && picked.length < max) {
      seen.add(a.id);
      picked.push(a);
    }
  };
  if (explicitSymbol) {
    const want = explicitSymbol.toUpperCase();
    add(
      assets.find(
        (a) => a.symbol.toUpperCase() === want || (a.display_symbol ?? "").toUpperCase() === want,
      ),
    );
  }
  for (const a of assets) {
    if (picked.length >= max) break;
    const base = a.symbol.replace(/USDT$|USD$|=F$/i, "");
    // Require ≥3 chars for a loose match so 2-letter futures aliases (ES/NQ/GC) can't
    // false-positive on prose; those are still reachable via explicit selection.
    const tokens = [a.symbol, a.display_symbol ?? "", base].filter((t) => t && t.length >= 3);
    if (tokens.some(mentions)) add(a);
  }
  return picked;
}

// GET /api/chat — the user's conversation history (oldest→newest).
chat.get("/", async (c) => {
  const userId = c.get("userId");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const msgs = await listChatMessages(c.env, userId, Number.isFinite(limit) ? limit : 50);
  return c.json(msgs);
});

// POST /api/chat — send a message, get Gemini's reply (+ optional strategy update).
chat.post("/", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const message = String(body.message ?? "").trim().slice(0, 4000);
  if (!message) return c.json({ error: "message is required" }, 400);
  const explicitSymbol = body.symbol ? String(body.symbol).slice(0, 40) : null;

  // History BEFORE we persist the new turn (chatWithGemini takes the new message separately).
  const history = await listChatMessages(c.env, user.id, 12);
  const contextAssets = await resolveContextAssets(c.env, explicitSymbol, message);
  const contextBlocks = (
    await Promise.all(contextAssets.map((a) => assetContext(c.env, user, a)))
  ).filter((x): x is string => !!x);

  await insertChatMessage(c.env, {
    user_id: user.id,
    role: "user",
    content: message,
    asset_symbol: contextAssets[0]?.symbol ?? explicitSymbol,
  });

  try {
    const res = await chatWithGemini(c.env, user, history, message, contextBlocks);
    const reply = await insertChatMessage(c.env, {
      user_id: user.id,
      role: "assistant",
      content: res.reply,
      asset_symbol: contextAssets[0]?.symbol ?? explicitSymbol,
      model: res.raw.model,
    });
    return c.json({
      reply,
      strategyUpdate: res.strategyUpdate,
      contextSymbols: contextAssets.map((a) => a.symbol),
    });
  } catch (e) {
    return c.json({ error: "chat failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// DELETE /api/chat — clear the user's conversation.
chat.delete("/", async (c) => {
  await deleteChatMessages(c.env, c.get("userId"));
  return c.json({ ok: true });
});

export default chat;
