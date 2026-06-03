import { useMemo, useState } from "react";
import { api } from "../api";
import type { OptionChain as Chain, OptionContract } from "../../shared/types";
import { fmtNum } from "../lib/format";

export function OptionsChain({
  busy,
  onTrack,
}: {
  busy: string | null;
  onTrack: (contractSymbol: string, name?: string) => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [chain, setChain] = useState<Chain | null>(null);
  const [side, setSide] = useState<"call" | "put">("call");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload is pinned to an explicit symbol so changing the expiration always
  // refetches the loaded underlying, not whatever is currently typed in the box.
  const load = async (sym: string, expiration?: number) => {
    const s = (sym ?? "").trim().toUpperCase();
    if (!s) return;
    setLoading(true);
    setError(null);
    try {
      const c = await api.optionChain(s, expiration);
      setChain(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setChain(null);
    } finally {
      setLoading(false);
    }
  };

  // Show ~14 strikes centered on the underlying price.
  const rows: OptionContract[] = useMemo(() => {
    if (!chain) return [];
    const all = (side === "call" ? chain.calls : chain.puts).slice().sort((a, b) => a.strike - b.strike);
    const px = chain.underlyingPrice ?? 0;
    if (!px || all.length <= 14) return all.slice(0, 14);
    let idx = all.findIndex((o) => o.strike >= px);
    if (idx < 0) idx = all.length - 1;
    return all.slice(Math.max(0, idx - 7), idx + 7);
  }, [chain, side]);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Options chain</h2>
        <span className="muted">Yahoo · delayed</span>
      </div>

      <form
        className="add-asset"
        onSubmit={(e) => {
          e.preventDefault();
          load(symbol);
        }}
      >
        <input
          type="text"
          placeholder="Underlying (e.g. AAPL, SPY)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "…" : "Load"}
        </button>
      </form>

      {error && <div className="empty">{error}</div>}

      {chain && (
        <>
          <div className="chain-meta">
            <span className="sym">{chain.underlying}</span>
            <span className="muted">underlying {fmtNum(chain.underlyingPrice, 2)}</span>
          </div>

          <div className="field-row" style={{ gap: 8, alignItems: "center" }}>
            <select
              value={chain.expiration ?? ""}
              onChange={(e) => load(chain.underlying, parseInt(e.target.value, 10))}
            >
              {chain.expirations.map((ex) => (
                <option key={ex} value={ex}>
                  {new Date(ex).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </option>
              ))}
            </select>
            <div className="segmented" style={{ flex: "0 0 auto" }}>
              <button
                type="button"
                className={`seg ${side === "call" ? "active" : ""}`}
                onClick={() => setSide("call")}
              >
                Calls
              </button>
              <button
                type="button"
                className={`seg ${side === "put" ? "active" : ""}`}
                onClick={() => setSide("put")}
              >
                Puts
              </button>
            </div>
          </div>

          <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Strike</th>
                  <th className="num">Last</th>
                  <th className="num">IV</th>
                  <th className="num">OI</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.contractSymbol} className={o.inTheMoney ? "itm" : ""}>
                    <td className="num sym">{fmtNum(o.strike, 2)}</td>
                    <td className="num">{fmtNum(o.lastPrice, 2)}</td>
                    <td className="num sub">
                      {o.impliedVolatility != null ? `${(o.impliedVolatility * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="num sub">{o.openInterest ?? "—"}</td>
                    <td>
                      <button
                        className="btn tiny ghost"
                        onClick={() => onTrack(o.contractSymbol, `${chain.underlying} ${o.type} ${o.strike}`)}
                        disabled={busy === "trackOption"}
                        title="Add this contract as a tradable asset"
                      >
                        + Track
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
