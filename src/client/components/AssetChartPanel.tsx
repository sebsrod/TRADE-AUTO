import { useEffect, useRef, useState } from "react";
import type { Asset, OpenPosition, Timeframe, Trade } from "../../shared/types";
import { TIMEFRAMES } from "../../shared/types";
import { api, ApiError, type MarketResponse } from "../api";
import { CandlestickChart, type ChartOverlay } from "./CandlestickChart";
import { fmtCurrency, fmtNum, fmtPct, pnlClass, timeAgo, titleCase } from "../lib/format";

const TF_LABEL: Record<Timeframe, string> = {
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "8h": "8H",
  "1d": "1D",
  "3d": "3D",
  "1w": "1W",
  "1M": "1M",
};

// Top-of-desk price chart with a variable timeframe + the reasoning behind the
// currently selected trade. Driven by clicks on positions / the trade log.
export function AssetChartPanel({
  assets,
  positions,
  assetId,
  overlayTrade,
  defaultTimeframe,
  onPickAsset,
  onUnauthorized,
}: {
  assets: Asset[];
  positions: OpenPosition[];
  assetId: number | null;
  overlayTrade: Trade | OpenPosition | null;
  defaultTimeframe: Timeframe;
  onPickAsset: (assetId: number) => void;
  onUnauthorized: () => void;
}) {
  const [tf, setTf] = useState<Timeframe>(defaultTimeframe);
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Resolve which asset to chart: explicit selection → first open position → first asset.
  const resolvedId = assetId ?? positions[0]?.asset_id ?? assets[0]?.id ?? null;
  const asset = assets.find((a) => a.id === resolvedId) ?? null;
  // Only overlay the trade's levels when it belongs to the asset on screen.
  const overlay: ChartOverlay | null =
    overlayTrade && overlayTrade.asset_id === resolvedId
      ? {
          side: overlayTrade.side,
          entry: overlayTrade.entry_price,
          stopLoss: overlayTrade.stop_loss,
          takeProfit: overlayTrade.take_profit,
        }
      : null;

  useEffect(() => {
    if (resolvedId == null) {
      setData(null);
      return;
    }
    const mySeq = ++seq.current;
    setLoading(true);
    setError(null);
    api
      .market(resolvedId, tf)
      .then((r) => {
        if (mySeq === seq.current) setData(r);
      })
      .catch((e) => {
        if (mySeq !== seq.current) return;
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : String(e));
        setData(null);
      })
      .finally(() => {
        if (mySeq === seq.current) setLoading(false);
      });
  }, [resolvedId, tf, onUnauthorized]);

  return (
    <div className="card">
      <div className="card-head chart-head">
        <div className="chart-title">
          <h2>{asset ? asset.display_symbol || asset.symbol : "Price chart"}</h2>
          {asset && <span className="muted">{asset.category}</span>}
          {data && <span className="sub">· {data.source}{data.cached ? " (cached)" : ""}</span>}
        </div>
        <select
          className="chart-asset-select"
          value={resolvedId ?? ""}
          onChange={(e) => onPickAsset(parseInt(e.target.value, 10))}
          aria-label="Select asset"
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_symbol || a.symbol}
            </option>
          ))}
        </select>
      </div>

      <div className="tf-bar">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            className={`seg ${tf === t ? "active" : ""}`}
            onClick={() => setTf(t)}
            type="button"
          >
            {TF_LABEL[t]}
          </button>
        ))}
      </div>

      {error && <div className="banner error">⚠ {error}</div>}
      {!asset ? (
        <div className="empty">Add an asset to your watchlist to see its chart.</div>
      ) : loading && !data ? (
        <div className="empty">Loading {TF_LABEL[tf]} candles…</div>
      ) : data ? (
        <CandlestickChart candles={data.candles} interval={data.interval} overlay={overlay} />
      ) : (
        <div className="empty">No chart data.</div>
      )}

      {overlayTrade && overlayTrade.asset_id === resolvedId && <TradeReason trade={overlayTrade} />}
    </div>
  );
}

// The "why" behind a trade: entry rationale, and for closed trades the exit reason.
function TradeReason({ trade: t }: { trade: Trade | OpenPosition }) {
  const closed = t.status === "closed";
  return (
    <div className="trade-reason">
      <div className="trade-reason-head">
        <span className={`badge ${t.side === "long" ? "long" : "short"}`}>{t.side}</span>
        <span className="sym">{t.symbol}</span>
        <span className={`badge ${closed ? "muted-badge" : "long"}`}>{closed ? "closed" : "open"}</span>
        {closed && (
          <span className={`pnl ${pnlClass(t.pnl)}`}>
            {fmtCurrency(t.pnl)} ({fmtPct(t.pnl_pct)})
          </span>
        )}
      </div>

      <div className="trade-reason-levels">
        <span>Entry <b>{fmtNum(t.entry_price, 2)}</b></span>
        {closed && <span>Exit <b>{fmtNum(t.exit_price, 2)}</b></span>}
        <span className="neg">Stop <b>{fmtNum(t.stop_loss, 2)}</b></span>
        <span className="pos">Target <b>{fmtNum(t.take_profit, 2)}</b></span>
        {t.confidence != null && <span>Conf <b>{(t.confidence * 100).toFixed(0)}%</b></span>}
      </div>

      {t.ai_rationale && (
        <div className="reason-block">
          <div className="reason-label">Why Claude opened this</div>
          <p>{t.ai_rationale}</p>
        </div>
      )}

      {closed && (
        <div className="reason-block">
          <div className="reason-label">
            Why it closed · {titleCase(t.exit_reason?.replace(/_/g, " "))}
            {t.exit_time ? ` · ${timeAgo(t.exit_time)}` : ""}
          </div>
          {t.exit_rationale ? (
            <p>{t.exit_rationale}</p>
          ) : (
            <p className="muted">
              {t.exit_reason === "stop_loss"
                ? "Price hit the protective stop."
                : t.exit_reason === "take_profit"
                  ? "Price reached the profit target."
                  : t.exit_reason === "manual"
                    ? "Closed manually."
                    : "Closed by the trading engine."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
