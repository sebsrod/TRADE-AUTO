import { useEffect, useState } from "react";
import type { RiskLevel, Timeframe, User } from "../../shared/types";
import { TIMEFRAMES } from "../../shared/types";
import { fmtCurrency } from "../lib/format";

const RISK_INFO: Record<RiskLevel, string> = {
  low: "1% risk / trade",
  medium: "2% risk / trade",
  high: "5% risk / trade",
};

// Minimum-hold presets. Short-timeframe mode swaps in minutes-to-hours holds for
// swing/momentum trading; normal mode keeps the multi-hour/day options.
const HOLD_NORMAL = [1, 2, 4, 8, 12, 24, 48]; // hours
const HOLD_SHORT = [5 / 60, 15 / 60, 30 / 60, 1, 2, 4, 8]; // 5m … 8h, in hours
const holdLabel = (h: number) => (h < 1 ? `${Math.round(h * 60)}m` : `${h}h`);
const sameHold = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export function ConfigPanel({
  user,
  busy,
  onSave,
  onReset,
  onDelete,
}: {
  user: User;
  busy: string | null;
  onSave: (patch: Partial<User> & Record<string, unknown>) => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const [risk, setRisk] = useState<RiskLevel>(user.risk_level);
  const [minHold, setMinHold] = useState(user.min_hold_hours);
  const [maxTrades, setMaxTrades] = useState(user.max_trades_per_day);
  const [maxOpen, setMaxOpen] = useState(user.max_open_positions);
  const [autoTrade, setAutoTrade] = useState(user.auto_trade_enabled === 1);
  const [allowShort, setAllowShort] = useState(user.allow_shorting === 1);
  const [shortTf, setShortTf] = useState(user.short_timeframe === 1);
  const [model, setModel] = useState(user.ai_model ?? "");
  const [timeframe, setTimeframe] = useState<Timeframe>(user.analysis_timeframe ?? "1d");
  const [notes, setNotes] = useState(user.strategy_notes ?? "");

  // Re-sync when the server state changes (e.g. after reset).
  useEffect(() => {
    setRisk(user.risk_level);
    setMinHold(user.min_hold_hours);
    setMaxTrades(user.max_trades_per_day);
    setMaxOpen(user.max_open_positions);
    setAutoTrade(user.auto_trade_enabled === 1);
    setAllowShort(user.allow_shorting === 1);
    setShortTf(user.short_timeframe === 1);
    setModel(user.ai_model ?? "");
    setTimeframe(user.analysis_timeframe ?? "1d");
    setNotes(user.strategy_notes ?? "");
  }, [user]);

  const holdOptions = shortTf ? HOLD_SHORT : HOLD_NORMAL;

  // Switching mode snaps the min-hold to a sensible default if the current value
  // isn't one of the new mode's presets.
  const toggleShortTf = (on: boolean) => {
    setShortTf(on);
    const opts = on ? HOLD_SHORT : HOLD_NORMAL;
    if (!opts.some((h) => sameHold(h, minHold))) setMinHold(on ? 15 / 60 : 8);
  };

  const dirty =
    risk !== user.risk_level ||
    !sameHold(minHold, user.min_hold_hours) ||
    maxTrades !== user.max_trades_per_day ||
    maxOpen !== user.max_open_positions ||
    autoTrade !== (user.auto_trade_enabled === 1) ||
    allowShort !== (user.allow_shorting === 1) ||
    shortTf !== (user.short_timeframe === 1) ||
    timeframe !== (user.analysis_timeframe ?? "1d") ||
    notes.trim() !== (user.strategy_notes ?? "").trim() ||
    (model || null) !== (user.ai_model || null);

  const save = () =>
    onSave({
      risk_level: risk,
      min_hold_hours: minHold,
      max_trades_per_day: maxTrades,
      max_open_positions: maxOpen,
      auto_trade_enabled: autoTrade ? 1 : 0,
      allow_shorting: allowShort ? 1 : 0,
      short_timeframe: shortTf ? 1 : 0,
      ai_model: model || null,
      analysis_timeframe: timeframe,
      strategy_notes: notes.trim() ? notes.trim() : null,
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

      <label className="field-label">Analysis timeframe (drives AI decisions)</label>
      <div className="segmented wrap">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            className={`seg ${timeframe === tf ? "active" : ""}`}
            onClick={() => setTimeframe(tf)}
            type="button"
          >
            {tf}
          </button>
        ))}
      </div>

      <label className="toggle">
        <input type="checkbox" checked={shortTf} onChange={(e) => toggleShortTf(e.target.checked)} />
        <span>Short-timeframe operation — swing &amp; momentum (minutes-to-hours holds)</span>
      </label>

      <label className="field-label">Minimum hold time{shortTf ? " (short mode)" : ""}</label>
      <div className="segmented wrap">
        {holdOptions.map((h) => (
          <button
            key={h}
            className={`seg ${sameHold(minHold, h) ? "active" : ""}`}
            onClick={() => setMinHold(h)}
            type="button"
          >
            {holdLabel(h)}
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

      <label className="field-label">My trading style / instructions for the AI</label>
      <textarea
        className="strategy-textarea"
        placeholder="e.g. I favor momentum swing trades on large-cap crypto, hold 2–5 days, avoid options and earnings, scale out at +1R. The AI folds this into every open/close decision."
        value={notes}
        rows={4}
        maxLength={2000}
        onChange={(e) => setNotes(e.target.value)}
      />
      <span className="sub strategy-hint">
        Applied to every analysis, discovery scan and chat. You can also tell Gemini in chat and apply its draft here.
      </span>

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
          {busy === "reset" ? "Resetting…" : "Reset account"}
        </button>
      </div>

      <div className="danger-zone">
        <p className="muted danger-note">
          Permanently delete this account and all of its data (trades, equity, AI logs).
          This cannot be undone.
        </p>
        <button
          className="btn ghost danger"
          onClick={() => {
            if (!confirm("Permanently delete your account and ALL of its data? This cannot be undone."))
              return;
            const typed = prompt('Type "DELETE" to confirm permanent account deletion:');
            if (typed?.trim().toUpperCase() === "DELETE") onDelete();
          }}
          disabled={busy != null}
        >
          {busy === "delete-account" ? "Deleting…" : "Delete account permanently"}
        </button>
      </div>
    </div>
  );
}
