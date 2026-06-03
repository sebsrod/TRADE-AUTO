# TRADE-AUTO

**A Gemini-powered autonomous paper-trading platform on Cloudflare Workers + D1.**

TRADE-AUTO evaluates whether a Gemini-driven AI agent can act as a high-level autonomous
trader. It scans stocks, ETFs, futures, options and crypto, computes technical indicators
locally, asks Gemini for explicit Buy/Sell/Hold decisions and trade ideas, and executes them
against a deterministic paper-trading ledger — then scores the results (ROI, win-rate,
Sharpe, drawdown) so you can judge the AI's skill.

> ⚠️ **Paper trading only.** Nothing here places real orders or constitutes financial advice.
> Market data is free/delayed and provided as-is.

---

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | **Cloudflare Workers** (Static Assets) | One deployable that serves the SPA, the API, **and** cron jobs. Cloudflare Pages can't run cron triggers — Workers can. |
| API router | **Hono** | First-class Workers support, tiny, plays well with D1 + static assets. |
| Database | **Cloudflare D1** (edge SQLite) | Serverless SQL with migrations; perfect for the lean schema. |
| AI | **Gemini REST API** (`fetch`) | Most reliable on the Workers runtime; model is configurable via env var. |
| Market data | **Binance** (crypto, keyless) + **Yahoo Finance v8** (everything else, keyless) | Works out of the box with no API keys; Finnhub/Alpha Vantage/Polygon are optional fallbacks. |
| Frontend | **Vite + React + TypeScript** SPA + **Recharts** | Fast, modern dashboard built to `dist/client` and served by the Worker. |

```
Browser ──► Worker (Hono) ──► D1            (config, trades, snapshots, ai_logs…)
                │     ├──► Binance / Yahoo   (OHLCV → local RSI/MACD/MA/ATR/BB)
                │     └──► Gemini API        (decisions + discovery, JSON mode)
                ▼
   Static SPA (dist/client)

Cron (every 2h) ──► scheduled() ──► manage stops → discover ideas → auto-trade → record equity
```

### Data model (D1)

`users` (config + paper balance) · `assets` (monitored instruments + whitelist) ·
`market_snapshots` (cached OHLCV + indicators) · `trades` (paper ledger) ·
`ai_logs` (every Gemini analysis) · `suggestions` (discovered ideas) ·
`equity_history` (ROI / drawdown / Sharpe series). See `migrations/0001_init.sql`.

---

## Quick start (local)

Requirements: Node 20+ (Node 23+ for the indicator test), a Cloudflare account, and a
[Gemini API key](https://aistudio.google.com/apikey).

```bash
npm install

# 1. Create the D1 database and paste the returned database_id into wrangler.jsonc
npm run db:create
#   -> copy "database_id" into wrangler.jsonc  (d1_databases[0].database_id)

# 2. Apply migrations to the LOCAL database
npm run db:migrate

# 3. Add your Gemini key for local dev
cp .dev.vars.example .dev.vars      # then edit .dev.vars and set GEMINI_API_KEY

# 4a. Run the API (Worker + local D1) on :8787
npm run dev:api

# 4b. In a second terminal, run the React dev server on :5173 (proxies /api → :8787)
npm run dev
```

Open http://localhost:5173. Market data, charts and manual paper trading work without a
Gemini key; the AI features need `GEMINI_API_KEY`.

> Prefer a single process? Run `npm run preview` — it builds the SPA and serves everything
> (SPA + API + local D1 + cron) from `wrangler dev` on http://localhost:8787.

---

## Deploy to Cloudflare

```bash
# one-time
npx wrangler login
npm run db:create                       # if you haven't already; paste id into wrangler.jsonc
npm run db:migrate:remote               # apply schema to the production D1

# secrets (only GEMINI_API_KEY is required)
npx wrangler secret put GEMINI_API_KEY
# optional fallbacks:
npx wrangler secret put FINNHUB_API_KEY
npx wrangler secret put ALPHAVANTAGE_API_KEY
npx wrangler secret put POLYGON_API_KEY

# build SPA + deploy worker (cron trigger ships automatically)
npm run deploy
```

`npm run deploy` runs `vite build` then `wrangler deploy`. The cron trigger (`0 */2 * * *`)
starts running the AI cycle automatically. You can also trigger it manually from the
dashboard ("Run AI cycle") or via `POST /api/ai/run-cycle`.

### Configuration (wrangler.jsonc → `vars`)

| Var | Default | Meaning |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model for per-asset analysis. Set to any current Gemini model. |
| `GEMINI_DISCOVERY_MODEL` | `gemini-2.5-flash` | Model for the universe discovery scan. |
| `ENABLE_SEARCH_GROUNDING` | `false` | `true` enables Gemini's Google-Search grounding for live sentiment (extra cost). |
| `CRON_AUTO_TRADE` | `true` | Master switch for auto-trading on the cron (still requires the per-user toggle). |
| `DEFAULT_USER_ID` | `1` | The single-user profile the dashboard operates on. |

---

## Trading rules & guardrails

- **Position sizing** scales with the risk level: Low = 1%, Medium = 2%, High = 5% of cash
  risked per trade (entry→stop distance), capped by a per-position notional ceiling.
- **Min-hold guardrail** (default 8h) blocks AI/manual closes until satisfied; protective
  stop-loss / take-profit exits always fire. Manual close from the UI can override.
- **Max trades per asset / 24h** (default 3) and **max open positions** (default 10).
- **Auto-trade** only runs when both `CRON_AUTO_TRADE` and the user's *Auto-trade* toggle are
  on, and only for ideas with confidence ≥ 0.6. Otherwise suggestions wait for your approval.
- **Shorting** is off by default; enable it in the Configuration panel.

All of these are editable live from the dashboard's **Configuration** panel.

---

## API reference (`/api`)

| Method & path | Purpose |
| --- | --- |
| `GET /health` | Service + Gemini status. |
| `GET/PATCH /config` · `POST /config/reset` | Read/update trading config; reset paper account. |
| `GET/POST /assets` · `PATCH/DELETE /assets/:id` | Manage the watchlist + whitelist. |
| `GET /market/:assetId` | Cached OHLCV + indicators (powers charts). |
| `GET /portfolio` · `/portfolio/metrics` · `/portfolio/equity` | Positions, metrics, equity curve. |
| `GET/POST /trades` · `POST /trades/:id/close` | Ledger; open/close paper positions. |
| `POST /ai/analyze/:assetId` | Deep Gemini analysis of one asset (`{"execute":true}` to act). |
| `POST /ai/discover` | Scan the universe for trade ideas. |
| `POST /ai/run-cycle` | Run the full scheduled cycle now. |
| `GET /ai/logs` · `GET /ai/suggestions` | AI history + discovered ideas. |
| `POST /ai/suggestions/:id/approve` · `/reject` | Execute or dismiss a suggestion. |

---

## Project layout

```
src/
  shared/types.ts          # API contract shared by worker + client
  worker/
    index.ts               # Hono app (fetch) + scheduled (cron) handler
    db.ts                  # D1 repositories
    routes/                # config, assets, market, portfolio, trades, ai
    services/
      indicators.ts        # SMA/EMA/RSI/MACD/Bollinger/ATR (+ smoke test)
      marketData.ts        # Binance + Yahoo (+ Finnhub) ingestion
      gemini.ts            # Gemini REST client + prompts + JSON parsing
      paperTrading.ts      # sizing, guardrails, fills, stops
      metrics.ts           # ROI, win-rate, Sharpe, drawdown
      analysisEngine.ts    # orchestration + cron cycle
  client/                  # Vite + React dashboard
migrations/                # D1 schema + seed
wrangler.jsonc             # Worker config (assets, D1, cron, vars)
```

## Tests

```bash
npm run test:indicators    # validates the indicator math (Node 23+)
npm run typecheck          # type-check worker + client
```

## License

MIT — for educational/research use. Not investment advice.
