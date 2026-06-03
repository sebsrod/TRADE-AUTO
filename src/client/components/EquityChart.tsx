import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityPoint } from "../../shared/types";
import { fmtCurrency } from "../lib/format";

export function EquityChart({
  equity,
  startingBalance,
}: {
  equity: EquityPoint[];
  startingBalance: number;
}) {
  const data = equity.map((e) => ({
    t: e.recorded_at,
    equity: e.equity,
    label: new Date(e.recorded_at.includes("T") ? e.recorded_at : e.recorded_at.replace(" ", "T") + "Z")
      .toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit" }),
  }));
  const last = data.length ? data[data.length - 1].equity : startingBalance;
  const up = last >= startingBalance;
  const stroke = up ? "#22d3ee" : "#f43f5e";

  return (
    <div className="card">
      <div className="card-head">
        <h2>Equity curve</h2>
        <span className="muted">{data.length} snapshots</span>
      </div>
      {data.length < 2 ? (
        <div className="empty">
          No equity history yet. It builds up as the AI cycle runs and trades close.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={40} />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 11 }}
              domain={["auto", "auto"]}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={48}
            />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8" }}
              formatter={(v: number) => [fmtCurrency(v), "Equity"]}
            />
            <ReferenceLine y={startingBalance} stroke="#475569" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="equity"
              stroke={stroke}
              strokeWidth={2}
              fill="url(#eqFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
