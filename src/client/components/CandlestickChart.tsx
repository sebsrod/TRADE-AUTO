import { useEffect, useRef, useState } from "react";
import type { Candle, Timeframe, TradeSide } from "../../shared/types";

export interface ChartOverlay {
  side?: TradeSide | null;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  label?: string | null;
}

const UP = "#34d399";
const DOWN = "#f43f5e";
const AXIS = "#64748b";
const GRID = "#1e293b";

// Decimals appropriate to the price magnitude (crypto sub-dollar vs index thousands).
function dp(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return 2;
  if (a < 1) return 5;
  if (a < 100) return 3;
  if (a < 10000) return 2;
  return 2;
}
function fmtP(v: number | null | undefined, d = dp(v ?? 0)): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtAxisTime(t: number, interval: Timeframe): string {
  const d = new Date(t);
  const intraday = interval === "15m" || interval === "30m" || interval === "1h" || interval === "4h" || interval === "8h";
  if (intraday) {
    return d.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  if (interval === "1M") return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}
function fmtFullTime(t: number, interval: Timeframe): string {
  const d = new Date(t);
  const intraday = interval === "15m" || interval === "30m" || interval === "1h" || interval === "4h" || interval === "8h";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(intraday ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

// Measure a container's width and keep it in sync on resize.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function CandlestickChart({
  candles,
  interval,
  overlay,
  height = 300,
}: {
  candles: Candle[];
  interval: Timeframe;
  overlay?: ChartOverlay | null;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const padL = 58;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = Math.max(0, height - padT - padB);

  if (candles.length < 2) {
    return (
      <div className="empty">Not enough data to draw a chart for this timeframe.</div>
    );
  }

  // Keep at most the last ~180 candles so bodies stay legible.
  const data = candles.slice(-180);
  const n = data.length;

  const overlayLevels = [overlay?.entry, overlay?.stopLoss, overlay?.takeProfit].filter(
    (x): x is number => x != null && Number.isFinite(x) && x > 0,
  );
  let lo = Math.min(...data.map((c) => c.l), ...overlayLevels);
  let hi = Math.max(...data.map((c) => c.h), ...overlayLevels);
  if (!(hi > lo)) {
    hi = hi + 1;
    lo = lo - 1;
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;

  const x = (i: number) => padL + (plotW * (i + 0.5)) / n;
  const slot = plotW / n;
  const bodyW = Math.max(1, Math.min(14, slot * 0.62));
  const y = (p: number) => padT + plotH * (1 - (p - lo) / (hi - lo));

  // Y grid ticks (5).
  const yTicks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * k) / 4);
  // X ticks: ~6 evenly spaced labels.
  const xCount = Math.min(6, n);
  const xTicks = Array.from({ length: xCount }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, xCount - 1)));

  const last = data[n - 1];
  const first = data[0];
  const periodUp = last.c >= first.o;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = Math.round(((mx - padL) / plotW) * n - 0.5);
    setHover(i >= 0 && i < n ? i : null);
  };

  const hv = hover != null ? data[hover] : null;
  const tipLeft = hover != null ? Math.min(Math.max(x(hover) + 10, padL), width - 150) : 0;

  return (
    <div className="cchart" ref={ref} style={{ position: "relative", width: "100%" }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: "block", cursor: "crosshair" }}
        >
          {/* Y grid + labels */}
          {yTicks.map((p, k) => (
            <g key={`y${k}`}>
              <line x1={padL} y1={y(p)} x2={width - padR} y2={y(p)} stroke={GRID} strokeWidth={1} />
              <text x={padL - 8} y={y(p) + 3} textAnchor="end" fontSize={10} fill={AXIS}>
                {fmtP(p)}
              </text>
            </g>
          ))}

          {/* X labels */}
          {xTicks.map((i, k) => (
            <text key={`x${k}`} x={x(i)} y={height - 8} textAnchor="middle" fontSize={10} fill={AXIS}>
              {fmtAxisTime(data[i].t, interval)}
            </text>
          ))}

          {/* Candles */}
          {data.map((c, i) => {
            const up = c.c >= c.o;
            const color = up ? UP : DOWN;
            const yo = y(c.o);
            const yc = y(c.c);
            const top = Math.min(yo, yc);
            const h = Math.max(1, Math.abs(yc - yo));
            return (
              <g key={i}>
                <line x1={x(i)} y1={y(c.h)} x2={x(i)} y2={y(c.l)} stroke={color} strokeWidth={1} />
                <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={h} fill={color} opacity={hover == null || hover === i ? 1 : 0.78} />
              </g>
            );
          })}

          {/* Trade overlay reference lines */}
          {overlay?.entry != null && overlay.entry > 0 && (
            <RefLine y={y(overlay.entry)} x1={padL} x2={width - padR} color="#22d3ee" label={`entry ${fmtP(overlay.entry)}`} />
          )}
          {overlay?.stopLoss != null && overlay.stopLoss > 0 && (
            <RefLine y={y(overlay.stopLoss)} x1={padL} x2={width - padR} color={DOWN} label={`stop ${fmtP(overlay.stopLoss)}`} />
          )}
          {overlay?.takeProfit != null && overlay.takeProfit > 0 && (
            <RefLine y={y(overlay.takeProfit)} x1={padL} x2={width - padR} color={UP} label={`target ${fmtP(overlay.takeProfit)}`} />
          )}

          {/* Crosshair */}
          {hover != null && (
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + plotH} stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
          )}
        </svg>
      )}

      {hv && (
        <div className="cchart-tip" style={{ left: tipLeft, top: padT + 4 }}>
          <div className="cchart-tip-t">{fmtFullTime(hv.t, interval)}</div>
          <div className="cchart-tip-row"><span>O</span><b>{fmtP(hv.o)}</b></div>
          <div className="cchart-tip-row"><span>H</span><b>{fmtP(hv.h)}</b></div>
          <div className="cchart-tip-row"><span>L</span><b>{fmtP(hv.l)}</b></div>
          <div className="cchart-tip-row"><span>C</span><b style={{ color: hv.c >= hv.o ? UP : DOWN }}>{fmtP(hv.c)}</b></div>
        </div>
      )}

      <div className="cchart-foot">
        <span className="sub">{n} × {interval}</span>
        <span className={periodUp ? "pos" : "neg"}>
          {fmtP(last.c)} · {periodUp ? "+" : ""}{(((last.c - first.o) / first.o) * 100).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

function RefLine({ y, x1, x2, color, label }: { y: number; x1: number; x2: number; color: string; label: string }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth={1} strokeDasharray="5 4" opacity={0.85} />
      <text x={x2 - 4} y={y - 3} textAnchor="end" fontSize={9} fill={color}>
        {label}
      </text>
    </g>
  );
}
