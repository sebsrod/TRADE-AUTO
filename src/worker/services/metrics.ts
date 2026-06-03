// Performance analytics computed from the trade ledger + equity history.

import type {
  EquityPoint,
  OpenPosition,
  PerformanceMetrics,
  Trade,
  User,
} from "../../shared/types";
import { normalizeSqlTime, round } from "../util";

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// Annualized Sharpe from an equity curve (risk-free ~0 for a paper account).
function sharpeFromEquity(curve: EquityPoint[]): number | null {
  if (curve.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity;
    if (prev > 0) returns.push((curve[i].equity - prev) / prev);
  }
  if (returns.length < 2) return null;
  const sd = stddev(returns);
  if (sd === 0) return null;

  // Estimate samples/year from the median spacing of recordings.
  const deltas: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const a = Date.parse(normalizeSqlTime(curve[i - 1].recorded_at));
    const b = Date.parse(normalizeSqlTime(curve[i].recorded_at));
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) deltas.push(b - a);
  }
  deltas.sort((a, b) => a - b);
  const medianDeltaMs = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 2 * 3600_000;
  const samplesPerYear = (365 * 24 * 3600_000) / Math.max(medianDeltaMs, 60_000);
  const sharpe = (mean(returns) / sd) * Math.sqrt(samplesPerYear);
  return round(sharpe, 2);
}

function maxDrawdown(curve: EquityPoint[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) {
      const dd = (peak - p.equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return round(maxDd * 100, 2);
}

export function computeMetrics(
  user: User,
  closedTrades: Trade[],
  positions: Pick<OpenPosition, "unrealized_pnl" | "market_value">[],
  equityCurve: EquityPoint[],
): PerformanceMetrics {
  const cash = user.cash_balance;
  const marketValueTotal = positions.reduce((a, p) => a + (p.market_value ?? 0), 0);
  const unrealizedPnl = positions.reduce((a, p) => a + (p.unrealized_pnl ?? 0), 0);
  const equity = round(cash + marketValueTotal, 2);

  const pnls = closedTrades.map((t) => t.pnl ?? 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const realizedPnl = round(pnls.reduce((a, b) => a + b, 0), 2);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const closedCount = closedTrades.length;
  const winRate = closedCount ? wins.length / closedCount : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = closedCount ? realizedPnl / closedCount : 0;

  // Build a curve that includes the live point so drawdown/Sharpe stay current.
  const curve: EquityPoint[] =
    equityCurve.length && equityCurve[equityCurve.length - 1].equity === equity
      ? equityCurve
      : [
          ...equityCurve,
          {
            id: -1,
            user_id: user.id,
            equity,
            cash,
            open_positions: positions.length,
            realized_pnl: realizedPnl,
            unrealized_pnl: round(unrealizedPnl, 2),
            recorded_at: new Date().toISOString(),
          },
        ];

  return {
    startingBalance: user.starting_balance,
    cash: round(cash, 2),
    equity,
    unrealizedPnl: round(unrealizedPnl, 2),
    realizedPnl,
    totalPnl: round(realizedPnl + unrealizedPnl, 2),
    roiPct:
      user.starting_balance > 0
        ? round(((equity - user.starting_balance) / user.starting_balance) * 100, 2)
        : 0,
    openPositions: positions.length,
    totalTrades: closedCount + positions.length,
    closedTrades: closedCount,
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate, 4),
    avgWin: round(avgWin, 2),
    avgLoss: round(avgLoss, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? null : 0,
    expectancy: round(expectancy, 2),
    sharpe: sharpeFromEquity(curve),
    maxDrawdownPct: maxDrawdown(curve),
    bestTradePnl: round(pnls.length ? Math.max(...pnls) : 0, 2),
    worstTradePnl: round(pnls.length ? Math.min(...pnls) : 0, 2),
  };
}
