import { useMemo, useState } from "react";
import type { Asset, AssetCategory } from "../../shared/types";

const CATEGORIES: AssetCategory[] = ["stock", "etf", "future", "option", "crypto"];

export function AssetManager({
  assets,
  busy,
  onAdd,
  onToggle,
  onDelete,
  onAnalyze,
  onTrade,
}: {
  assets: Asset[];
  busy: string | null;
  onAdd: (a: { symbol: string; category: string }) => void;
  onToggle: (id: number, patch: Partial<Asset> & Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  onAnalyze: (id: number) => void;
  onTrade: (assetId: number, side: "long" | "short") => void;
}) {
  const [filter, setFilter] = useState<Set<AssetCategory>>(new Set());
  const [symbol, setSymbol] = useState("");
  const [category, setCategory] = useState<AssetCategory>("stock");

  const toggleFilter = (c: AssetCategory) => {
    setFilter((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const shown = useMemo(
    () => (filter.size === 0 ? assets : assets.filter((a) => filter.has(a.category))),
    [assets, filter],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    onAdd({ symbol: s, category });
    setSymbol("");
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Assets &amp; whitelist</h2>
        <span className="muted">{assets.filter((a) => a.whitelisted).length} AI-enabled</span>
      </div>

      <div className="filter-chips">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip toggle-chip ${filter.has(c) ? "active" : ""}`}
            onClick={() => toggleFilter(c)}
            type="button"
          >
            {c}
          </button>
        ))}
      </div>

      <form className="add-asset" onSubmit={submit}>
        <input
          type="text"
          placeholder="Symbol (e.g. AAPL, BTCUSDT, ES=F)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button className="btn" type="submit" disabled={busy === "addAsset"}>
          {busy === "addAsset" ? "…" : "Add"}
        </button>
      </form>

      <div className="asset-list">
        {shown.map((a) => (
          <div key={a.id} className={`asset-row ${a.active ? "" : "inactive"}`}>
            <label className="wl-check" title="AI permitted to trade">
              <input
                type="checkbox"
                checked={a.whitelisted === 1}
                onChange={(e) => onToggle(a.id, { whitelisted: e.target.checked ? 1 : 0 })}
              />
            </label>
            <div className="asset-id">
              <span className="sym">{a.display_symbol || a.symbol}</span>
              <span className="badge muted-badge">{a.category}</span>
            </div>
            <div className="asset-actions">
              <button
                className="btn tiny ghost"
                onClick={() => onAnalyze(a.id)}
                disabled={busy === `analyze-${a.id}`}
                title="Ask Claude for a fresh decision"
              >
                {busy === `analyze-${a.id}` ? "…" : "Analyze"}
              </button>
              <button
                className="btn tiny long-btn"
                onClick={() => onTrade(a.id, "long")}
                disabled={busy === `open-${a.id}`}
                title="Open long (manual)"
              >
                Long
              </button>
              <button
                className="btn tiny icon"
                onClick={() => onDelete(a.id)}
                disabled={busy === `asset-${a.id}`}
                title="Remove asset"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {shown.length === 0 && <div className="empty">No assets match the filter.</div>}
      </div>
    </div>
  );
}
