// Paper-trading engine: deterministic position sizing, risk guardrails, and
// fills. Cash is conserved exactly: opening subtracts notional from cash,
// closing returns notional + realized PnL.

import type { Asset, RiskLevel, Trade, TradeSide, User } from "../../shared/types";
import type { Env } from "../types";
import {
  adjustCash,
  closeTradeRow,
  countRecentTradesForAsset,
  getOpenTradeForAsset,
  insertTrade,
  listOpenTrades,
  tryDebitCash,
} from "../db";
import { hoursBetween, round, roundPrice } from "../util";

// Fraction of cash risked per trade (entry → stop distance).
const RISK_FRACTION: Record<RiskLevel, number> = { low: 0.01, medium: 0.02, high: 0.05 };
// Max fraction of cash committed as notional to a single position (no leverage).
const MAX_NOTIONAL_FRACTION: Record<RiskLevel, number> = { low: 0.2, medium: 0.35, high: 0.6 };
// Default protective stop distance when the AI gives an unusable stop.
const DEFAULT_STOP_PCT: Record<RiskLevel, number> = { low: 0.03, medium: 0.05, high: 0.08 };

export interface SizingResult {
  quantity: number;
  positionValue: number;
  riskAmount: number;
  stopLoss: number;
  takeProfit: number;
}

export function sizePosition(
  user: User,
  side: TradeSide,
  entry: number,
  stopLoss: number,
  takeProfit: number,
): SizingResult {
  const risk = user.risk_level;
  const cash = Math.max(0, user.cash_balance);

  // Sanitize the stop so it sits on the correct side of entry.
  let stop = stopLoss;
  const stopValid =
    Number.isFinite(stop) &&
    stop > 0 &&
    (side === "long" ? stop < entry : stop > entry);
  if (!stopValid) {
    const pct = DEFAULT_STOP_PCT[risk];
    stop = side === "long" ? entry * (1 - pct) : entry * (1 + pct);
  }

  // Default/repair the take-profit to the correct side too.
  let target = takeProfit;
  const targetValid =
    Number.isFinite(target) &&
    target > 0 &&
    (side === "long" ? target > entry : target < entry);
  if (!targetValid) {
    const dist = Math.abs(entry - stop) * 2; // default 2R
    target = side === "long" ? entry + dist : entry - dist;
  }

  const riskPerUnit = Math.abs(entry - stop);
  const riskAmount = cash * RISK_FRACTION[risk];
  let quantity = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;

  // Cap notional so we never exceed the per-position / cash ceilings.
  const maxNotional = Math.min(cash, cash * MAX_NOTIONAL_FRACTION[risk]);
  let positionValue = quantity * entry;
  if (positionValue > maxNotional && entry > 0) {
    quantity = maxNotional / entry;
    positionValue = quantity * entry;
  }

  return {
    quantity: round(quantity, 8),
    positionValue: round(positionValue, 2),
    riskAmount: round(quantity * riskPerUnit, 2),
    stopLoss: roundPrice(stop),
    takeProfit: roundPrice(target),
  };
}

export interface OpenParams {
  side: TradeSide;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number | null;
  rationale: string | null;
  aiLogId: number | null;
}

export type OpenOutcome =
  | { ok: true; trade: Trade }
  | { ok: false; reason: string };

// Open a paper position, enforcing every guardrail. Returns a reason if skipped.
export async function openPosition(
  env: Env,
  user: User,
  asset: Asset,
  p: OpenParams,
): Promise<OpenOutcome> {
  if (asset.whitelisted !== 1) return { ok: false, reason: "asset not whitelisted" };
  if (p.side === "short" && user.allow_shorting !== 1) {
    return { ok: false, reason: "shorting disabled" };
  }

  const existing = await getOpenTradeForAsset(env, user.id, asset.id);
  if (existing) return { ok: false, reason: "position already open for asset" };

  const open = await listOpenTrades(env, user.id);
  if (open.length >= user.max_open_positions) {
    return { ok: false, reason: `max open positions (${user.max_open_positions}) reached` };
  }

  const recent = await countRecentTradesForAsset(env, user.id, asset.id, 24);
  if (recent >= user.max_trades_per_day) {
    return {
      ok: false,
      reason: `max trades/24h for asset (${user.max_trades_per_day}) reached`,
    };
  }

  const entry = roundPrice(p.entry);
  if (!(entry > 0)) return { ok: false, reason: "invalid entry price" };

  const sizing = sizePosition(user, p.side, entry, p.stopLoss, p.takeProfit);
  if (!(sizing.quantity > 0) || !(sizing.positionValue > 0)) {
    return { ok: false, reason: "position size rounds to zero" };
  }

  // Atomically reserve notional from cash (guards against concurrent over-spend).
  const debited = await tryDebitCash(env, user.id, sizing.positionValue);
  if (!debited) return { ok: false, reason: "insufficient cash" };

  // Write the trade. A partial unique index enforces one open position per asset;
  // if a concurrent caller already opened one, the INSERT throws — refund the debit.
  try {
    const trade = await insertTrade(env, {
      user_id: user.id,
      asset_id: asset.id,
      symbol: asset.symbol,
      category: asset.category,
      side: p.side,
      quantity: sizing.quantity,
      entry_price: entry,
      stop_loss: sizing.stopLoss,
      take_profit: sizing.takeProfit,
      position_value: sizing.positionValue,
      risk_amount: sizing.riskAmount,
      ai_rationale: p.rationale,
      ai_log_id: p.aiLogId,
      confidence: p.confidence,
    });
    return { ok: true, trade };
  } catch (e) {
    await adjustCash(env, user.id, sizing.positionValue); // refund the reserved cash
    return { ok: false, reason: "position already open for asset" };
  }
}

export function realizedPnl(trade: Trade, exitPrice: number): number {
  const dir = trade.side === "short" ? -1 : 1;
  return round(trade.quantity * (exitPrice - trade.entry_price) * dir, 2);
}

export function unrealizedPnl(trade: Trade, price: number): number {
  const dir = trade.side === "short" ? -1 : 1;
  return round(trade.quantity * (price - trade.entry_price) * dir, 2);
}

// Whether the min-hold guardrail currently permits a (non-protective) close.
export function canCloseNow(trade: Trade, user: User): boolean {
  return hoursBetween(trade.entry_time) >= user.min_hold_hours;
}

// Does the live price hit the stop or target? (Protective exits bypass min-hold.)
export function checkStops(trade: Trade, price: number): "stop_loss" | "take_profit" | null {
  if (trade.side === "long") {
    if (trade.stop_loss != null && price <= trade.stop_loss) return "stop_loss";
    if (trade.take_profit != null && price >= trade.take_profit) return "take_profit";
  } else {
    if (trade.stop_loss != null && price >= trade.stop_loss) return "stop_loss";
    if (trade.take_profit != null && price <= trade.take_profit) return "take_profit";
  }
  return null;
}

export type CloseOutcome =
  | { ok: true; trade: Trade; pnl: number }
  | { ok: false; reason: string };

// Close a position at exitPrice. `force` (manual override) and protective exits
// bypass the min-hold guardrail; AI-signalled closes respect it.
export async function closePosition(
  env: Env,
  user: User,
  trade: Trade,
  exitPrice: number,
  reason: string,
  opts: { force?: boolean } = {},
): Promise<CloseOutcome> {
  if (trade.status !== "open") return { ok: false, reason: "trade not open" };
  const protective = reason === "stop_loss" || reason === "take_profit";
  if (!opts.force && !protective && !canCloseNow(trade, user)) {
    const remaining = round(user.min_hold_hours - hoursBetween(trade.entry_time), 2);
    return { ok: false, reason: `min-hold guardrail: ${remaining}h remaining` };
  }
  const exit = roundPrice(exitPrice);
  const pnl = realizedPnl(trade, exit);
  const pnlPct =
    trade.position_value > 0 ? round((pnl / trade.position_value) * 100, 2) : 0;

  // Close first (guarded UPDATE). Only credit cash if THIS call closed the row,
  // so a concurrent/duplicate close can't double-credit the account.
  const closed = await closeTradeRow(env, trade.id, {
    exit_price: exit,
    pnl,
    pnl_pct: pnlPct,
    exit_reason: reason,
  });
  if (!closed) return { ok: false, reason: "already closed" };
  await adjustCash(env, user.id, trade.position_value + pnl);
  return { ok: true, trade: closed, pnl };
}
