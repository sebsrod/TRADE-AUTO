// Orchestration layer: snapshot caching, position enrichment, the AI analysis
// pipeline, discovery, auto-trading, and the full scheduled (cron) cycle.

import type {
  Asset,
  Candle,
  GeminiDiscovery,
  Indicators,
  OpenPosition,
  Timeframe,
  Trade,
  User,
} from "../../shared/types";
import type { Env } from "../types";
import {
  defaultUserId,
  expireOldSuggestions,
  getAsset,
  insertAILog,
  insertEquityPoint,
  insertSuggestion,
  listAssets,
  listOpenTrades,
  pruneSnapshots,
  saveSnapshot,
  getFreshSnapshot,
  getUser,
  ensureUser,
} from "../db";
import { hoursBetween, round, safeJsonParse } from "../util";
import { computeIndicators } from "./indicators";
import { fetchMarketData, normalizeInterval } from "./marketData";
import { analyzeAsset as geminiAnalyze, discoverOpportunities } from "./gemini";
import {
  canCloseNow,
  checkStops,
  closePosition,
  openPosition,
  unrealizedPnl,
} from "./paperTrading";

const AUTO_TRADE_MIN_CONFIDENCE = 0.6;

export interface SnapshotData {
  asset: Asset;
  candles: Candle[];
  price: number;
  indicators: Indicators;
  source: string;
  cached: boolean;
  interval: Timeframe;
}

// Fetch a market snapshot, preferring a recent cached row to respect API limits.
export async function getSnapshot(
  env: Env,
  asset: Asset,
  maxAgeMinutes = 30,
  interval: Timeframe = "1d",
): Promise<SnapshotData> {
  const tf = normalizeInterval(interval);
  const cached = await getFreshSnapshot(env, asset.id, tf, maxAgeMinutes);
  if (cached) {
    const candles = safeJsonParse<Candle[]>(cached.ohlcv_json, []);
    const indicators =
      safeJsonParse<Indicators | null>(cached.indicators_json, null) ??
      computeIndicators(candles);
    return {
      asset,
      candles,
      price: cached.price,
      indicators,
      source: "cache",
      cached: true,
      interval: tf,
    };
  }

  const md = await fetchMarketData(asset, env, tf);
  const indicators = computeIndicators(md.candles);
  // Persist a trimmed candle set (keep payload small) + indicators.
  const trimmed = md.candles.slice(-300);
  await saveSnapshot(env, {
    asset_id: asset.id,
    symbol: asset.symbol,
    interval: tf,
    price: md.price,
    ohlcv_json: JSON.stringify(trimmed),
    indicators_json: JSON.stringify(indicators),
  });
  return {
    asset,
    candles: trimmed,
    price: md.price,
    indicators,
    source: md.source,
    cached: false,
    interval: tf,
  };
}

export async function getPrice(
  env: Env,
  asset: Asset,
  maxAgeMinutes = 60,
  interval: Timeframe = "1d",
): Promise<number> {
  const snap = await getSnapshot(env, asset, maxAgeMinutes, interval);
  return snap.price;
}

// Enrich open trades with live price + unrealized PnL + guardrail state.
export async function enrichPositions(
  env: Env,
  user: User,
  trades: Trade[],
): Promise<OpenPosition[]> {
  const out: OpenPosition[] = [];
  const tf = normalizeInterval(user.analysis_timeframe);
  for (const t of trades) {
    let price: number | null = null;
    try {
      const asset = await getAsset(env, t.asset_id);
      if (asset) price = await getPrice(env, asset, 60, tf);
    } catch {
      price = null;
    }
    const holdHours = round(hoursBetween(t.entry_time), 2);
    if (price == null) {
      out.push({
        ...t,
        current_price: null,
        unrealized_pnl: null,
        unrealized_pnl_pct: null,
        market_value: t.position_value,
        hold_hours: holdHours,
        can_close: canCloseNow(t, user),
      });
      continue;
    }
    const uPnl = unrealizedPnl(t, price);
    out.push({
      ...t,
      current_price: price,
      unrealized_pnl: uPnl,
      unrealized_pnl_pct: t.position_value > 0 ? round((uPnl / t.position_value) * 100, 2) : 0,
      market_value: round(t.position_value + uPnl, 2),
      hold_hours: holdHours,
      can_close: canCloseNow(t, user),
    });
  }
  return out;
}

export async function recordEquity(
  env: Env,
  user: User,
  positions?: OpenPosition[],
): Promise<void> {
  const pos = positions ?? (await enrichPositions(env, user, await listOpenTrades(env, user.id)));
  const marketValue = pos.reduce((a, p) => a + (p.market_value ?? p.position_value), 0);
  const unreal = pos.reduce((a, p) => a + (p.unrealized_pnl ?? 0), 0);
  await insertEquityPoint(env, {
    user_id: user.id,
    equity: round(user.cash_balance + marketValue, 2),
    cash: round(user.cash_balance, 2),
    open_positions: pos.length,
    realized_pnl: 0,
    unrealized_pnl: round(unreal, 2),
  });
}

// Check every open position for stop-loss / take-profit hits and close them.
export async function runPositionManagement(
  env: Env,
  user: User,
): Promise<{ closed: Trade[]; checked: number }> {
  const open = await listOpenTrades(env, user.id);
  const closed: Trade[] = [];
  const tf = normalizeInterval(user.analysis_timeframe);
  for (const t of open) {
    try {
      const asset = await getAsset(env, t.asset_id);
      if (!asset) continue;
      const price = await getPrice(env, asset, 20, tf);
      const hit = checkStops(t, price);
      if (hit) {
        // Refresh user cash between closes so balances stay consistent.
        const u = (await getUser(env, user.id)) ?? user;
        const res = await closePosition(env, u, t, price, hit);
        if (res.ok) closed.push(res.trade);
      }
    } catch {
      // ignore a single asset's failure; continue managing the rest
    }
  }
  return { closed, checked: open.length };
}

export interface AnalyzeResult {
  symbol: string;
  decision: string;
  action: string;
  aiLogId: number;
  confidence: number;
}

// Run a deep per-asset Gemini analysis; optionally execute the decision.
export async function analyzeOneAsset(
  env: Env,
  user: User,
  asset: Asset,
  autoTrade: boolean,
): Promise<AnalyzeResult> {
  const snap = await getSnapshot(env, asset, 30, normalizeInterval(user.analysis_timeframe));
  const openTrade = (await listOpenTrades(env, user.id)).find((t) => t.asset_id === asset.id);
  const { decision, raw } = await geminiAnalyze(
    env,
    user,
    asset,
    snap.indicators,
    snap.candles.map((c) => c.c),
    !!openTrade,
  );

  const aiLogId = await insertAILog(env, {
    user_id: user.id,
    asset_id: asset.id,
    symbol: asset.symbol,
    model: raw.model,
    kind: "decision",
    decision: decision.decision,
    confidence: decision.confidence,
    sentiment: decision.sentiment,
    rationale: decision.rationale,
    stop_loss: decision.stopLoss,
    take_profit: decision.takeProfit,
    risk_reward: decision.riskReward,
    indicators_json: JSON.stringify(snap.indicators),
    prompt: raw.prompt,
    raw_response: raw.text,
    grounded: raw.grounded ? 1 : 0,
  });

  let action = "none";
  if (autoTrade) {
    const u = (await getUser(env, user.id)) ?? user;
    if ((decision.decision === "CLOSE" || decision.decision === "SELL") && openTrade) {
      const res = await closePosition(env, u, openTrade, snap.price, "ai_signal");
      action = res.ok ? "closed" : `skip_close:${res.reason}`;
    } else if (decision.decision === "BUY" || decision.decision === "SELL") {
      if (decision.confidence >= AUTO_TRADE_MIN_CONFIDENCE && !openTrade) {
        const res = await openPosition(env, u, asset, {
          side: decision.side,
          entry: snap.price || decision.entry,
          stopLoss: decision.stopLoss,
          takeProfit: decision.takeProfit,
          confidence: decision.confidence,
          rationale: decision.rationale,
          aiLogId,
        });
        action = res.ok ? "opened" : `skip_open:${res.reason}`;
      } else {
        action = "skip_open:low_confidence_or_open";
      }
    } else {
      action = "hold";
    }
  }

  return {
    symbol: asset.symbol,
    decision: decision.decision,
    action,
    aiLogId,
    confidence: decision.confidence,
  };
}

export interface DiscoveryOutcome {
  commentary: string;
  ideas: GeminiDiscovery[];
  suggestionsCreated: number;
}

// Scan the whitelisted universe and persist suggestions.
export async function runDiscovery(
  env: Env,
  user: User,
  maxIdeas = 5,
): Promise<DiscoveryOutcome> {
  const assets = (await listAssets(env, { activeOnly: true, whitelistedOnly: true })).slice(0, 30);
  const tf = normalizeInterval(user.analysis_timeframe);
  const rows: Array<{ asset: Asset; ind: Indicators }> = [];
  for (const asset of assets) {
    try {
      const snap = await getSnapshot(env, asset, 60, tf);
      rows.push({ asset, ind: snap.indicators });
    } catch {
      // skip assets we couldn't fetch
    }
  }
  if (!rows.length) return { commentary: "No market data available.", ideas: [], suggestionsCreated: 0 };

  const result = await discoverOpportunities(env, user, rows, maxIdeas);

  const aiLogId = await insertAILog(env, {
    user_id: user.id,
    asset_id: null,
    symbol: null,
    model: result.raw.model,
    kind: "discovery",
    rationale: result.commentary,
    indicators_json: null,
    prompt: result.raw.prompt,
    raw_response: result.raw.text,
    grounded: result.raw.grounded ? 1 : 0,
  });

  await expireOldSuggestions(env, user.id, 24);
  let created = 0;
  for (const idea of result.ideas) {
    const asset = rows.find((r) => r.asset.symbol === idea.symbol)?.asset ?? null;
    await insertSuggestion(env, {
      user_id: user.id,
      asset_id: asset?.id ?? null,
      symbol: idea.symbol,
      category: asset?.category ?? null,
      direction: idea.direction,
      strategy: idea.strategy,
      rationale: idea.rationale,
      indicators_hit: JSON.stringify(idea.indicatorsHit),
      risk_reward: idea.riskReward,
      entry: idea.entry,
      stop_loss: idea.stopLoss,
      take_profit: idea.takeProfit,
      confidence: idea.confidence,
      ai_log_id: aiLogId,
    });
    created++;
  }
  return { commentary: result.commentary, ideas: result.ideas, suggestionsCreated: created };
}

// Auto-execute the strongest discovered ideas, honoring all guardrails.
export async function autoTradeFromIdeas(
  env: Env,
  user: User,
  ideas: GeminiDiscovery[],
): Promise<{ opened: Trade[]; skipped: Array<{ symbol: string; reason: string }> }> {
  const opened: Trade[] = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];
  const sorted = [...ideas].sort((a, b) => b.confidence - a.confidence);
  for (const idea of sorted) {
    if (idea.confidence < AUTO_TRADE_MIN_CONFIDENCE) {
      skipped.push({ symbol: idea.symbol, reason: "low confidence" });
      continue;
    }
    const assets = await listAssets(env, { activeOnly: true });
    const asset = assets.find((a) => a.symbol === idea.symbol);
    if (!asset) {
      skipped.push({ symbol: idea.symbol, reason: "asset not found" });
      continue;
    }
    const u = (await getUser(env, user.id)) ?? user;
    let entry = idea.entry;
    try {
      entry = (await getPrice(env, asset, 30, normalizeInterval(u.analysis_timeframe))) || idea.entry;
    } catch {
      /* use idea.entry */
    }
    const res = await openPosition(env, u, asset, {
      side: idea.direction,
      entry,
      stopLoss: idea.stopLoss,
      takeProfit: idea.takeProfit,
      confidence: idea.confidence,
      rationale: `[discovery:${idea.strategy}] ${idea.rationale}`,
      aiLogId: null,
    });
    if (res.ok) opened.push(res.trade);
    else skipped.push({ symbol: idea.symbol, reason: res.reason });
  }
  return { opened, skipped };
}

export interface CronSummary {
  closedByStops: number;
  suggestions: number;
  autoOpened: number;
  errors: string[];
}

// The full scheduled cycle invoked by the cron trigger.
export async function runCronCycle(env: Env): Promise<CronSummary> {
  const errors: string[] = [];
  const userId = defaultUserId(env);
  const user = await ensureUser(env, userId);

  let closedByStops = 0;
  try {
    const mgmt = await runPositionManagement(env, user);
    closedByStops = mgmt.closed.length;
  } catch (e) {
    errors.push(`position-management: ${msg(e)}`);
  }

  let suggestions = 0;
  let autoOpened = 0;
  let ideas: GeminiDiscovery[] = [];
  try {
    const fresh = (await getUser(env, userId)) ?? user;
    const disc = await runDiscovery(env, fresh, 5);
    suggestions = disc.suggestionsCreated;
    ideas = disc.ideas;
  } catch (e) {
    errors.push(`discovery: ${msg(e)}`);
  }

  // Auto-trade only when both the worker var and the user toggle are on.
  const cronAuto = (env.CRON_AUTO_TRADE || "true") === "true";
  try {
    const fresh = (await getUser(env, userId)) ?? user;
    if (cronAuto && fresh.auto_trade_enabled === 1 && ideas.length) {
      const res = await autoTradeFromIdeas(env, fresh, ideas);
      autoOpened = res.opened.length;
    }
  } catch (e) {
    errors.push(`auto-trade: ${msg(e)}`);
  }

  try {
    const fresh = (await getUser(env, userId)) ?? user;
    await recordEquity(env, fresh);
    await pruneSnapshots(env, 7);
  } catch (e) {
    errors.push(`bookkeeping: ${msg(e)}`);
  }

  return { closedByStops, suggestions, autoOpened, errors };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
