import type { HealthResponse } from "../api";
import type { PerformanceMetrics, User } from "../../shared/types";
import { fmtCurrency, fmtPct, pnlClass } from "../lib/format";

export function Header({
  health,
  metrics,
  user,
  busy,
  onRefresh,
  onRunCycle,
  onDiscover,
}: {
  health: HealthResponse | null;
  metrics: PerformanceMetrics | null;
  user: User | null;
  busy: string | null;
  onRefresh: () => void;
  onRunCycle: () => void;
  onDiscover: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">▲</div>
        <div>
          <h1>TRADE-AUTO</h1>
          <p className="brand-sub">Autonomous Gemini paper-trading desk</p>
        </div>
      </div>

      <div className="header-stats">
        <div className="hstat">
          <span className="hstat-label">Equity</span>
          <span className="hstat-value">{fmtCurrency(metrics?.equity)}</span>
        </div>
        <div className="hstat">
          <span className="hstat-label">ROI</span>
          <span className={`hstat-value ${pnlClass(metrics?.roiPct)}`}>{fmtPct(metrics?.roiPct)}</span>
        </div>
        <div className="hstat">
          <span className="hstat-label">Total P&amp;L</span>
          <span className={`hstat-value ${pnlClass(metrics?.totalPnl)}`}>
            {fmtCurrency(metrics?.totalPnl)}
          </span>
        </div>
      </div>

      <div className="header-actions">
        <span className={`gemini-dot ${health?.geminiConfigured ? "on" : "off"}`} title="Gemini API status">
          ● {health?.geminiConfigured ? "AI online" : "AI offline"}
        </span>
        <button className="btn ghost" onClick={onRefresh} disabled={busy != null}>
          ⟳ Refresh
        </button>
        <button className="btn" onClick={onDiscover} disabled={busy != null}>
          {busy === "discover" ? "Scanning…" : "Discover"}
        </button>
        <button className="btn primary" onClick={onRunCycle} disabled={busy != null}>
          {busy === "cycle" ? "Running…" : "Run AI cycle"}
        </button>
      </div>
    </header>
  );
}
