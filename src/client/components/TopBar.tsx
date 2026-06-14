import type { HealthResponse } from "../api";
import type { PerformanceMetrics, User } from "../../shared/types";
import { fmtCurrency, fmtPct, pnlClass, timeAgo } from "../lib/format";
import { useFlash } from "../lib/useFlash";

// Top navigation / stats bar. Replaces the original Header: adds the live P&L pip
// (with flashing equity + total P&L) and the signed-in account + logout control.
export function Header({
  health,
  metrics,
  user,
  busy,
  live,
  onRefresh,
  onRunCycle,
  onDiscover,
  onLogout,
}: {
  health: HealthResponse | null;
  metrics: PerformanceMetrics | null;
  user: User | null;
  busy: string | null;
  live: { ok: boolean; at: string | null };
  onRefresh: () => void;
  onRunCycle: () => void;
  onDiscover: () => void;
  onLogout: () => void;
}) {
  const equityFlash = useFlash(metrics?.equity);
  const pnlFlash = useFlash(metrics?.totalPnl);

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
          <span className="hstat-label">
            Equity
            <span
              className={`live-pip ${live.ok ? "on" : "off"}`}
              title={`Live market data · updated ${timeAgo(live.at)}`}
            >
              ● LIVE
            </span>
          </span>
          <span className={`hstat-value ${equityFlash}`}>{fmtCurrency(metrics?.equity)}</span>
        </div>
        <div className="hstat">
          <span className="hstat-label">ROI</span>
          <span className={`hstat-value ${pnlClass(metrics?.roiPct)}`}>{fmtPct(metrics?.roiPct)}</span>
        </div>
        <div className="hstat">
          <span className="hstat-label">Total P&amp;L</span>
          <span className={`hstat-value ${pnlClass(metrics?.totalPnl)} ${pnlFlash}`}>
            {fmtCurrency(metrics?.totalPnl)}
          </span>
        </div>
      </div>

      <div className="header-actions">
        <span className={`ai-dot ${health?.aiConfigured ? "on" : "off"}`} title="Gemini API status">
          ● {health?.aiConfigured ? "AI online" : "AI offline"}
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
        {user && (
          <div className="user-chip" title={user.email ?? undefined}>
            <span className="user-name">{user.name}</span>
            <button className="btn tiny ghost" onClick={onLogout} title="Log out">
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
