import { useEffect, useState } from "react";
import type { RiskLevel, User } from "../../shared/types";
import { fmtCurrency } from "../lib/format";

const RISK_INFO: Record<RiskLevel, string> = {
  low: "1% risk / trade",
  medium: "2% risk / trade",
  high: "5% risk / trade",
};
const HOLD_OPTIONS = [1, 2, 4, 8, 12, 24, 48];

export function ConfigPanel({
  user,
  busy,
  onSave,
  onReset,
}: {
  user: User;
  busy: string | null;
  onSave: (patch: Partial<User> & Record<string, unknown>) => void;
  onReset: () => void;
}) {
  const [risk, setRisk] = useState<RiskLevel>(user.risk_level);
  const [minHold, setMinHold] = useState(user.min_hold_hours);
  const [maxTrades, setMaxTrades] = useState(user.max_trades_per_day);
  const [maxOpen, setMaxOpen] = useState(user.max_open_positions);
  const [autoTrade, setAutoTrade] = useState(user.auto_trade_enabled === 1);
  const [allowShort, setAllowShort] = useState(user.allow_shorting === 1);
  const [model, setModel] = useState(user.gemini_model ?? "");

  // Re-sync when the server state changes (e.g. after reset).
  useEffect(() => {
    setRisk(user.risk_level);
    setMinHold(user.min_hold_hours);
    setMaxTrades(user.max_trades_per_day);
    setMaxOpen(user.max_open_positions);
    setAutoTrade(user.auto_trade_enabled === 1);
    setAllowShort(user.allow_shorting === 1);
    setModel(user.gemini_model ?? "");
  }, [user]);

  const dirty =
    risk !== user.risk_level ||
    minHold !== user.min_hold_hours ||
    maxTrades !== user.max_trades_per_day ||
    maxOpen !== user.max_open_positions ||
    autoTrade !== (user.auto_trade_enabled === 1) ||
    allowShort !== (user.allow_shorting === 1) ||
    (model || null) !== (user.gemini_model || null);

  const save = () =>
    onSave({
      risk_level: risk,
      min_hold_hours: minHold,
      max_trades_per_day: maxTrades,
      max_open_positions: maxOpen,
      auto_trade_enabled: autoTrade ? 1 : 0,
      allow_shorting: allowShort ? 1 : 0,
      gemini_model: model || null,
    });

  return (
    <div className="card">
      <div className="card-head">
        <h2>Configuration</h2>
        <span className="muted">{fmtCurrency(user.cash_balance)} cash</span>
      </div>

      <label className="field-label">Risk level — {RISK_INFO[risk]}</label>
      <div className="segmented">
        {(["low", "medium", "high"] as RiskLevel[]).map((r) => (
          <button
            key={r}
            className={`seg ${risk === r ? "active" : ""}`}
            onClick={() => setRisk(r)}
            type="button"
          >
            {r}
          </button>
        ))}
      </div>

      <label className="field-label">Minimum hold time</label>
      <div className="segmented wrap">
        {HOLD_OPTIONS.map((h) => (
          <button
            key={h}
            className={`seg ${minHold === h ? "active" : ""}`}
            onClick={() => setMinHold(h)}
            type="button"
          >
            {h}h
          </button>
        ))}
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field-label">Max trades / asset / 24h</label>
          <input
            type="number"
            min={1}
            max={100}
            value={maxTrades}
            onChange={(e) => setMaxTrades(parseInt(e.target.value || "1", 10))}
          />
        </div>
        <div className="field">
          <label className="field-label">Max open positions</label>
          <input
            type="number"
            min={1}
            max={200}
            value={maxOpen}
            onChange={(e) => setMaxOpen(parseInt(e.target.value || "1", 10))}
          />
        </div>
      </div>

      <label className="field-label">Gemini model (optional override)</label>
      <input
        type="text"
        placeholder="gemini-2.5-flash"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      />

      <label className="toggle">
        <input type="checkbox" checked={autoTrade} onChange={(e) => setAutoTrade(e.target.checked)} />
        <span>Auto-trade on AI cycle (executes discovered ideas)</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={allowShort} onChange={(e) => setAllowShort(e.target.checked)} />
        <span>Allow short positions</span>
      </label>

      <div className="config-actions">
        <button className="btn primary" onClick={save} disabled={!dirty || busy != null}>
          {busy === "config" ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          className="btn ghost danger"
          onClick={() => {
            if (confirm("Reset paper account to starting balance and wipe all trades?")) onReset();
          }}
          disabled={busy != null}
        >
          Reset account
        </button>
      </div>
    </div>
  );
}
