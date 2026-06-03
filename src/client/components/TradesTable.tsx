import type { Trade } from "../../shared/types";
import { fmtCurrency, fmtNum, fmtPct, pnlClass, timeAgo, titleCase } from "../lib/format";

export function TradesTable({ trades }: { trades: Trade[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Trade history</h2>
        <span className="muted">{trades.length} closed</span>
      </div>
      {trades.length === 0 ? (
        <div className="empty">No closed trades yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th className="num">Entry</th>
                <th className="num">Exit</th>
                <th className="num">P&L</th>
                <th>Reason</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 50).map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="sym">{t.symbol}</div>
                    <div className="sub">{t.category}</div>
                  </td>
                  <td>
                    <span className={`badge ${t.side === "long" ? "long" : "short"}`}>{t.side}</span>
                  </td>
                  <td className="num">{fmtNum(t.entry_price, 2)}</td>
                  <td className="num">{fmtNum(t.exit_price, 2)}</td>
                  <td className={`num ${pnlClass(t.pnl)}`}>
                    {fmtCurrency(t.pnl)}
                    <div className="sub">{fmtPct(t.pnl_pct)}</div>
                  </td>
                  <td className="sub">{titleCase(t.exit_reason?.replace(/_/g, " "))}</td>
                  <td className="sub">{timeAgo(t.exit_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
