import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HealthResponse } from "./api";
import type {
  AILog,
  Asset,
  EquityPoint,
  PortfolioResponse,
  Suggestion,
  Trade,
  User,
} from "../shared/types";
import { Header } from "./components/Header";
import { MetricsPanel } from "./components/MetricsPanel";
import { EquityChart } from "./components/EquityChart";
import { PortfolioPanel } from "./components/PortfolioPanel";
import { ResearchHub } from "./components/ResearchHub";
import { ConfigPanel } from "./components/ConfigPanel";
import { AssetManager } from "./components/AssetManager";
import { TradesTable } from "./components/TradesTable";
import { AILogsPanel } from "./components/AILogsPanel";
import { Toast, type ToastMsg } from "./components/Toast";

const REFRESH_MS = 30_000;

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [aiLogs, setAILogs] = useState<AILog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string, kind: ToastMsg["kind"] = "info") => {
    setToast({ message, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [p, eq, sug, closed, as, logs, h] = await Promise.all([
        api.portfolio(),
        api.equity(),
        api.suggestions(),
        api.trades("closed"),
        api.getAssets(),
        api.aiLogs(30),
        api.health().catch(() => null),
      ]);
      setPortfolio(p);
      setEquity(eq);
      setSuggestions(sug);
      setClosedTrades(closed);
      setAssets(as);
      setAILogs(logs);
      if (h) setHealth(h);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(() => loadAll(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [loadAll]);

  // Wrap an async action: show busy state, toast result, then refresh.
  const run = useCallback(
    async (key: string, fn: () => Promise<string | void>, okKind: ToastMsg["kind"] = "success") => {
      setBusy(key);
      try {
        const msg = await fn();
        await loadAll(true);
        if (msg) notify(msg, okKind);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setBusy(null);
      }
    },
    [loadAll, notify],
  );

  const actions = {
    updateConfig: (patch: Partial<User> & Record<string, unknown>) =>
      run("config", async () => {
        await api.updateConfig(patch);
        return "Configuration saved";
      }),
    resetAccount: () =>
      run("reset", async () => {
        await api.resetAccount();
        return "Paper account reset to starting balance";
      }),
    addAsset: (a: { symbol: string; category: string }) =>
      run("addAsset", async () => {
        const created = await api.addAsset(a);
        return `Added ${created.symbol}`;
      }),
    toggleAsset: (id: number, patch: Partial<Asset> & Record<string, unknown>) =>
      run(`asset-${id}`, async () => {
        await api.updateAsset(id, patch);
      }),
    deleteAsset: (id: number) =>
      run(`asset-${id}`, async () => {
        await api.deleteAsset(id);
        return "Asset removed";
      }),
    analyze: (id: number) =>
      run(`analyze-${id}`, async () => {
        const r = await api.analyze(id, false);
        return `${r.symbol}: ${r.decision} (conf ${(r.confidence * 100).toFixed(0)}%)`;
      }),
    closeTrade: (id: number) =>
      run(`close-${id}`, async () => {
        const t = await api.closeTrade(id);
        return `Closed ${t.symbol}: ${t.pnl != null && t.pnl >= 0 ? "+" : ""}${t.pnl ?? 0} USD`;
      }),
    openTrade: (assetId: number, side: "long" | "short") =>
      run(`open-${assetId}`, async () => {
        const t = await api.openTrade({ assetId, side });
        return `Opened ${side} ${t.symbol}`;
      }),
    approve: (id: number) =>
      run(`sug-${id}`, async () => {
        const r = await api.approveSuggestion(id);
        return `Executed ${r.trade.symbol}`;
      }),
    reject: (id: number) =>
      run(`sug-${id}`, async () => {
        await api.rejectSuggestion(id);
        return "Suggestion rejected";
      }),
    discover: () =>
      run("discover", async () => {
        const r = await api.discover();
        return `Discovery complete — ${r.suggestionsCreated} idea(s)`;
      }),
    runCycle: () =>
      run("cycle", async () => {
        const r = await api.runCycle();
        return `Cycle: ${r.autoOpened} opened, ${r.closedByStops} stopped, ${r.suggestions} ideas`;
      }),
  };

  if (loading && !portfolio) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading TRADE-AUTO…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        health={health}
        metrics={portfolio?.metrics ?? null}
        user={portfolio?.user ?? null}
        busy={busy}
        onRefresh={() => loadAll()}
        onRunCycle={actions.runCycle}
        onDiscover={actions.discover}
      />

      {error && <div className="banner error">⚠ {error}</div>}
      {health && !health.geminiConfigured && (
        <div className="banner warn">
          Gemini API key not configured — set <code>GEMINI_API_KEY</code> to enable AI analysis.
          Market data, charts and manual paper trading still work.
        </div>
      )}

      <main className="grid">
        <section className="col-main">
          {portfolio && <MetricsPanel metrics={portfolio.metrics} />}
          <EquityChart equity={equity} startingBalance={portfolio?.user.starting_balance ?? 0} />
          {portfolio && (
            <PortfolioPanel
              positions={portfolio.positions}
              busy={busy}
              onClose={actions.closeTrade}
            />
          )}
          <ResearchHub
            suggestions={suggestions}
            aiLogs={aiLogs}
            busy={busy}
            onApprove={actions.approve}
            onReject={actions.reject}
            onDiscover={actions.discover}
          />
          <TradesTable trades={closedTrades} />
          <AILogsPanel logs={aiLogs} />
        </section>

        <aside className="col-side">
          {portfolio && (
            <ConfigPanel user={portfolio.user} busy={busy} onSave={actions.updateConfig} onReset={actions.resetAccount} />
          )}
          <AssetManager
            assets={assets}
            busy={busy}
            onAdd={actions.addAsset}
            onToggle={actions.toggleAsset}
            onDelete={actions.deleteAsset}
            onAnalyze={actions.analyze}
            onTrade={actions.openTrade}
          />
        </aside>
      </main>

      <footer className="footer">
        TRADE-AUTO · Gemini-powered paper trading · {health?.model ?? "gemini"} ·{" "}
        <span className="muted">data: Binance + Yahoo Finance (delayed)</span>
      </footer>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
