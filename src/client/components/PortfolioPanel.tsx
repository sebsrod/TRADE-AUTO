import type { OpenPosition } from "../../shared/types";
import { fmtCurrency, fmtNum, fmtPct, pnlClass } from "../lib/format";

export function PortfolioPanel({
  positions,
  busy,
  onClose,
}: {
  positions: OpenPosition[];
  busy: string | null;
  onClose: (id: number) => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Open positions</h2>
        <span className="muted">{positions.length} active</span>
      </div>
      {positions.length === 0 ? (
        <div className="empty">No open positions. The AI or you can open trades.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th className="num">Qty</th>
                <th className="num">Entry</th>
                <th className="num">Price</th>
                <th className="num">Stop / Target</th>
                <th className="num">Unrealized</th>
                <th className="num">Hold</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="sym">{p.symbol}</div>
                    <div className="sub">{p.category}</div>
                  </td>
                  <td>
                    <span className={`badge ${p.side === "long" ? "long" : "short"}`}>{p.side}</span>
                  </td>
                  <td className="num">{fmtNum(p.quantity, 4)}</td>
                  <td className="num">{fmtNum(p.entry_price, 2)}</td>
                  <td className="num">{p.current_price == null ? "—" : fmtNum(p.current_price, 2)}</td>
                  <td className="num sub">
                    {fmtNum(p.stop_loss, 2)} / {fmtNum(p.take_profit, 2)}
                  </td>
                  <td className={`num ${pnlClass(p.unrealized_pnl)}`}>
                    {fmtCurrency(p.unrealized_pnl)}
                    <div className="sub">{fmtPct(p.unrealized_pnl_pct)}</div>
                  </td>
                  <td className="num sub">{p.hold_hours.toFixed(1)}h</td>
                  <td>
                    <button
                      className="btn tiny danger"
                      onClick={() => onClose(p.id)}
                      disabled={busy === `close-${p.id}`}
                      title={p.can_close ? "Close position" : "Min-hold not met (manual override)"}
                    >
                      {busy === `close-${p.id}` ? "…" : "Close"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
