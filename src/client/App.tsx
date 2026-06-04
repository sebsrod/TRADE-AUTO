import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type HealthResponse } from "./api";
import type {
  AILog,
  Asset,
  EquityPoint,
  PortfolioResponse,
  Suggestion,
  Trade,
  User,
} from "../shared/types";
import { Header } from "./components/TopBar";
import { MetricsPanel } from "./components/MetricsPanel";
import { EquityChart } from "./components/EquityChart";
import { PositionsPanel } from "./components/PositionsPanel";
import { ResearchHub } from "./components/ResearchHub";
import { ConfigPanel } from "./components/ConfigPanel";
import { AssetManager } from "./components/AssetManager";
import { OptionsChain } from "./components/OptionsChain";
import { TradesTable } from "./components/TradesTable";
import { AILogsPanel } from "./components/AILogsPanel";
import { AuthScreen } from "./components/AuthGate";
import { Toast, type ToastMsg } from "./components/Toast";
import "./styles-extra.css";

const REFRESH_MS = 30_000; // full dashboard reload (trades, suggestions, logs…)
const LIVE_MS = 5_000; // fast P&L poll (positions repriced at spot)

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

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
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [liveOk, setLiveOk] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);

  const notify = useCallback((message: string, kind: ToastMsg["kind"] = "info") => {
    setToast({ message, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  // Treat a 401 from any call as "session ended" → bounce back to the login gate.
  const onUnauthorized = useCallback(() => {
    setAuthUser(null);
    setPortfolio(null);
    setEquity([]);
    setSuggestions([]);
    setClosedTrades([]);
    setAssets([]);
    setAILogs([]);
    setLiveOk(false);
    setLiveAt(null);
    setLoading(true);
  }, []);

  // Check for an existing session on first load.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((r) => {
        if (!cancelled) setAuthUser(r.user);
      })
      .catch(() => {
        /* not logged in */
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAll = useCallback(
    async (silent = false) => {
      const seq = ++loadSeq.current;
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
        if (seq !== loadSeq.current) return;
        setPortfolio(p);
        setEquity(eq);
        setSuggestions(sug);
        setClosedTrades(closed);
        setAssets(as);
        setAILogs(logs);
        if (h) setHealth(h);
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          onUnauthorized();
          return;
        }
        if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [onUnauthorized],
  );

  // Fast poll: reprice open positions + recompute metrics so P&L moves live.
  const loadLive = useCallback(async () => {
    try {
      const live = await api.portfolioLive();
      setPortfolio((prev) =>
        prev ? { ...prev, positions: live.positions, metrics: live.metrics } : prev,
      );
      setLiveAt(live.asOf);
      setLiveOk(true);
    } catch (e) {
      setLiveOk(false);
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
    }
  }, [onUnauthorized]);

  // Once authenticated: load everything + start both poll loops.
  useEffect(() => {
    if (!authUser) return;
    loadAll();
    const t = setInterval(() => loadAll(true), REFRESH_MS);
    const lt = setInterval(() => loadLive(), LIVE_MS);
    return () => {
      clearInterval(t);
      clearInterval(lt);
    };
  }, [authUser, loadAll, loadLive]);

  const run = useCallback(
    async (key: string, fn: () => Promise<string | void>, okKind: ToastMsg["kind"] = "success") => {
      setBusy(key);
      try {
        const msg = await fn();
        await loadAll(true);
        if (msg) notify(msg, okKind);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          onUnauthorized();
          return;
        }
        notify(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setBusy(null);
      }
    },
    [loadAll, notify, onUnauthorized],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* clear local state regardless */
    }
    onUnauthorized();
  }, [onUnauthorized]);

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
    trackOption: (contractSymbol: string, name?: string) =>
      run("trackOption", async () => {
        const a = await api.trackOption(contractSymbol, name);
        return `Tracking ${a.symbol}`;
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

  // --- gate: still checking session ---
  if (!authChecked) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading TRADE-AUTO…</p>
      </div>
    );
  }

  // --- gate: not logged in ---
  if (!authUser) {
    return <AuthScreen onAuthed={(u) => setAuthUser(u)} />;
  }

  // --- dashboard ---
  if (loading && !portfolio) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading your desk…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        health={health}
        metrics={portfolio?.metrics ?? null}
        user={authUser ?? portfolio?.user ?? null}
        busy={busy}
        live={{ ok: liveOk, at: liveAt }}
        onRefresh={() => loadAll()}
        onRunCycle={actions.runCycle}
        onDiscover={actions.discover}
        onLogout={logout}
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
            <PositionsPanel
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
            <ConfigPanel
              user={portfolio.user}
              busy={busy}
              onSave={actions.updateConfig}
              onReset={actions.resetAccount}
            />
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
          <OptionsChain busy={busy} onTrack={actions.trackOption} />
        </aside>
      </main>

      <footer className="footer">
        TRADE-AUTO · Gemini-powered paper trading · {health?.model ?? "gemini"} ·{" "}
        <span className="muted">data: Binance + Yahoo Finance (live)</span>
      </footer>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
