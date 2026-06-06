# TRADE-AUTO

**A Claude-powered autonomous paper-trading platform on Cloudflare Pages + D1.**

TRADE-AUTO evaluates whether a Claude-driven AI agent can act as a high-level autonomous
trader. It scans stocks, ETFs, futures, options and crypto, computes technical indicators
locally, asks Claude for explicit Buy/Sell/Hold decisions and trade ideas, and executes them
against a deterministic paper-trading ledger — then scores the results (ROI, win-rate,
Sharpe, drawdown) so you can judge the AI's skill.

> ⚠️ **Paper trading only.** Nothing here places real orders or constitutes financial advice.
> Market data is free/delayed and provided as-is.

🔗 **Live:** deployed to Cloudflare Pages (`*.pages.dev`). See [Deploy](#deploy-to-cloudflare).

---

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend + API | **Cloudflare Pages** (SPA + Pages Function) | One project, free `*.pages.dev` domain. The `/api/*` Function is the Hono app via `hono/cloudflare-pages`. |
| Scheduling | **Companion cron Worker** (`./cron`) | Pages can't run cron triggers, so a tiny Worker runs the AI cycle every 2h against the **same D1** (shares the service code). |
| API router | **Hono** | Tiny, first-class Workers/Pages support; one app shared by the Function and the optional standalone Worker. |
| Database | **Cloudflare D1** (edge SQLite) | Serverless SQL with migrations; bound to both the Pages project and the cron Worker. |
| AI | **Claude Opus 4.8** via the **Anthropic SDK** (`@anthropic-ai/sdk`) | Most capable model for autonomous trading judgement; adaptive thinking on; model configurable via env var. Needs `nodejs_compat`. |
| Market data | **Binance** (crypto) + **Yahoo Finance v8** (stocks/ETF/futures/options) + **CBOE** (option chains) | All keyless. Finnhub/Alpha Vantage are optional keyed fallbacks. |
| Frontend | **Vite + React + TS** + **Recharts** | Fast dashboard built to `dist/client`. |

```
Browser ──► Pages Function (/api/*, Hono) ──► D1            (config, trades, snapshots, ai_logs…)
                │     ├──► Binance / Yahoo / CBOE   (OHLCV + options → local RSI/MACD/MA/ATR/BB)
                │     └──► Claude (Anthropic API)   (decisions + discovery, JSON output)
                ▼
   Static SPA (dist/client, _redirects SPA fallback)

cron Worker (every 2h) ──► runCronCycle(sharedD1) ──► manage stops → discover → auto-trade → record equity
```

### Data model (D1)

`users` (config + paper balance + timeframe) · `assets` (instruments + whitelist) ·
`market_snapshots` (cached OHLCV + indicators, keyed by interval) · `trades` (paper ledger) ·
`ai_logs` (every Claude analysis) · `suggestions` (discovered ideas, one pending entry per asset) ·
`equity_history` (ROI / drawdown / Sharpe series). See `migrations/`.

---

## Quick start (local)

Requirements: Node 20+, a Cloudflare account, and an [Anthropic (Claude) API key](https://console.anthropic.com/settings/keys).

```bash
npm install

# 1. Create the D1 database and paste the returned database_id into wrangler.jsonc
#    (and cron/wrangler.jsonc — both bind the same database)
npm run db:create

# 2. Apply migrations to the LOCAL database
npm run db:migrate

# 3. Add your Claude key for local dev
cp .dev.vars.example .dev.vars      # then edit and set ANTHROPIC_API_KEY

# 4a. Run the Pages app (SPA + API + local D1) on :8788
npm run dev:api

# 4b. In a second terminal, run the Vite dev server on :5173 (proxies /api → :8788)
npm run dev
```

Open http://localhost:5173. Market data, charts, options and manual paper trading work
without a Claude key; the AI features need `ANTHROPIC_API_KEY`.

```bash
npm test          # indicator math + Claude service + paper-trading tests (no network/key)
npm run typecheck # type-check worker + client + cron + functions
```

---

## Deploy to Cloudflare

```bash
# one-time
npx wrangler login

# 1. Create the D1 database, paste database_id into BOTH wrangler.jsonc and cron/wrangler.jsonc
npm run db:create
npm run db:migrate:remote                 # apply schema to production D1

# 2. Create the Pages project and deploy the app (SPA + API Function)
npm run pages:create                      # one-time: creates the *.pages.dev project
npm run deploy                            # build + wrangler pages deploy

# 3. Secrets (only ANTHROPIC_API_KEY is required)
npx wrangler pages secret put ANTHROPIC_API_KEY
#   optional keyed fallbacks:
npx wrangler pages secret put FINNHUB_API_KEY

# 4. Deploy the companion cron Worker (runs the AI cycle every 2h on the shared D1)
npx wrangler secret put ANTHROPIC_API_KEY --config cron/wrangler.jsonc
npm run deploy:cron
```

You get a free `https://trade-auto.pages.dev` URL. The cron Worker handles scheduling; you
can also run a cycle manually from the dashboard ("Run AI cycle") or `POST /api/ai/run-cycle`.

### Configuration (`vars` in wrangler.jsonc)

| Var | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_MODEL` | `claude-opus-4-8` | Model for per-asset analysis. Set to any current Claude model id. |
| `CLAUDE_DISCOVERY_MODEL` | `claude-opus-4-8` | Model for the universe discovery scan. |
| `CRON_AUTO_TRADE` | `true` | Master switch for auto-trading on the cron (still requires the per-user toggle). |
| `DEFAULT_USER_ID` | `1` | The single-user profile the dashboard operates on. |

> `compatibility_flags: ["nodejs_compat"]` is set in both `wrangler.jsonc` and
> `cron/wrangler.jsonc` — the Anthropic SDK requires it on the Workers/Pages runtime.

---

## Features

- **Multi-asset scanning** — stocks, ETFs, futures, options, crypto.
- **Adjustable analysis timeframe** — 1h / 4h / 1d (intraday or daily candles).
- **Local indicators** — RSI, MACD, SMA/EMA, Bollinger Bands, ATR, 52-wk range, trend.
- **Claude decisions** — per-asset Buy/Sell/Hold with rationale, stop, target, R:R; plus a
  universe "discovery" scan that surfaces trend-swing ideas as approve/reject suggestions.
  The Research Hub keeps **one pending entry per asset** — re-scanning refreshes it in place.
- **Options chains** — browse CBOE-sourced strikes/expiries for any underlying and add a
  specific contract (OCC symbol) as a tradable asset.
- **Deterministic paper engine** — risk-based sizing (Low 1% / Medium 2% / High 5%), notional
  caps, exact cash conservation, auto stop-loss / take-profit.
- **Guardrails** — min-hold (default 8h), max-trades/asset/24h (default 3), max-open positions,
  whitelist, optional shorting — all editable live.
- **Performance** — ROI, win-rate, profit factor, expectancy, annualized Sharpe, max drawdown,
  equity curve.

---

## API reference (`/api`)

| Method & path | Purpose |
| --- | --- |
| `GET /health` | Service + Claude status. |
| `GET/PATCH /config` · `POST /config/reset` | Read/update trading config; reset paper account. |
| `GET/POST /assets` · `PATCH/DELETE /assets/:id` | Manage the watchlist + whitelist. |
| `GET /market/:assetId?interval=1h\|4h\|1d` | Cached OHLCV + indicators (powers charts). |
| `GET /options/:symbol` · `POST /options/track` | Option chain for an underlying; track a contract. |
| `GET /portfolio` · `/portfolio/metrics` · `/portfolio/equity` | Positions, metrics, equity curve. |
| `GET/POST /trades` · `POST /trades/:id/close` | Ledger; open/close paper positions. |
| `POST /ai/analyze/:assetId` | Deep Claude analysis of one asset (`{"execute":true}` to act). |
| `POST /ai/discover` · `POST /ai/run-cycle` | Run the discovery scan / full cycle now. |
| `GET /ai/logs` · `GET /ai/suggestions` | AI history + discovered ideas. |
| `POST /ai/suggestions/:id/approve` · `/reject` | Execute or dismiss a suggestion. |

---

## Project layout

```
functions/api/[[route]].ts   # Cloudflare Pages Function → Hono app (/api/*)
cron/                        # companion cron Worker (scheduling) sharing the same D1
src/
  shared/types.ts            # API contract shared by worker + client
  worker/
    app.ts                   # Hono app (shared by the Pages Function + Worker entry)
    index.ts                 # optional standalone Worker entry (native cron)
    db.ts                    # D1 repositories
    routes/                  # config, assets, market, options, portfolio, trades, ai
    services/
      indicators.ts          # SMA/EMA/RSI/MACD/Bollinger/ATR (+ tests)
      marketData.ts          # Binance + Yahoo (+ Finnhub) candles, CBOE option chains
      claude.ts              # Claude (Anthropic SDK) client + prompts + JSON parsing (+ tests)
      paperTrading.ts        # sizing, guardrails, fills, stops (+ tests)
      metrics.ts             # ROI, win-rate, Sharpe, drawdown
      analysisEngine.ts      # orchestration + cron cycle
  client/                    # Vite + React dashboard
migrations/                  # D1 schema + seed + timeframe + ai_model column
wrangler.jsonc               # Pages config (assets, D1, vars)
scripts/run-test.mjs         # esbuild-based test runner
```

## License

MIT — for educational/research use. Not investment advice.
