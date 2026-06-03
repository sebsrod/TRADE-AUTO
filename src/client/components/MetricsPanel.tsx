import type { PerformanceMetrics } from "../../shared/types";
import { fmtCurrency, fmtNum, fmtPct, pnlClass } from "../lib/format";

function Metric({
  label,
  value,
  cls,
  hint,
}: {
  label: string;
  value: string;
  cls?: string;
  hint?: string;
}) {
  return (
    <div className="metric" title={hint}>
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${cls ?? ""}`}>{value}</span>
    </div>
  );
}

export function MetricsPanel({ metrics: m }: { metrics: PerformanceMetrics }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Performance</h2>
        <span className="muted">judging whether the AI is a high-level trader</span>
      </div>
      <div className="metrics-grid">
        <Metric label="Equity" value={fmtCurrency(m.equity)} hint="Cash + open market value" />
        <Metric label="Cash" value={fmtCurrency(m.cash)} />
        <Metric label="ROI" value={fmtPct(m.roiPct)} cls={pnlClass(m.roiPct)} />
        <Metric label="Realized P&L" value={fmtCurrency(m.realizedPnl)} cls={pnlClass(m.realizedPnl)} />
        <Metric
          label="Unrealized P&L"
          value={fmtCurrency(m.unrealizedPnl)}
          cls={pnlClass(m.unrealizedPnl)}
        />
        <Metric
          label="Win rate"
          value={`${(m.winRate * 100).toFixed(0)}%`}
          hint={`${m.wins}W / ${m.losses}L`}
        />
        <Metric
          label="Profit factor"
          value={m.profitFactor == null ? "∞" : fmtNum(m.profitFactor)}
          cls={m.profitFactor != null && m.profitFactor >= 1 ? "pos" : "neg"}
          hint="Gross profit / gross loss"
        />
        <Metric
          label="Sharpe"
          value={m.sharpe == null ? "—" : fmtNum(m.sharpe)}
          cls={m.sharpe != null ? pnlClass(m.sharpe) : ""}
          hint="Annualized, from equity returns"
        />
        <Metric
          label="Max drawdown"
          value={fmtPct(-Math.abs(m.maxDrawdownPct))}
          cls={m.maxDrawdownPct > 0 ? "neg" : "neutral"}
        />
        <Metric label="Expectancy" value={fmtCurrency(m.expectancy)} cls={pnlClass(m.expectancy)} hint="Avg P&L per closed trade" />
        <Metric label="Open / Closed" value={`${m.openPositions} / ${m.closedTrades}`} />
        <Metric
          label="Best / Worst"
          value={`${fmtCurrency(m.bestTradePnl)} / ${fmtCurrency(m.worstTradePnl)}`}
        />
      </div>
    </div>
  );
}
