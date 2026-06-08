# TRADE-AUTO — Deploy Runbook

Operational guide for deploying TRADE-AUTO to Cloudflare. Two deployables share **one
D1 database**:

| Deployable | What it is | Command |
| --- | --- | --- |
| **Pages app** | SPA (`dist/client`) + the `/api/*` Hono Function | `npm run deploy` |
| **Cron Worker** (`./cron`) | Runs the AI cycle every 30 min (`*/30 * * * *`) on the same D1 | `npm run deploy:cron` |

Both run the same service code and need their **own** copy of every secret (Cloudflare
secrets are per-Worker). The AI provider is **Claude (Anthropic)** — the only required
secret is `ANTHROPIC_API_KEY`.

---

## 0. Prerequisites

- Node 20+ and a clean install: `npm install`
- A Cloudflare account, authenticated locally: `npx wrangler login`
- An Anthropic API key: https://console.anthropic.com/settings/keys
- Green local checks (do this before every deploy):
  ```bash
  npm run typecheck
  npm test
  npm run build
  ```

> `compatibility_flags: ["nodejs_compat"]` must stay set in **both** `wrangler.jsonc` and
> `cron/wrangler.jsonc` — the Anthropic SDK requires it on the Workers/Pages runtime. It is
> already committed; don't remove it.

---

## 1. One-time setup (first deploy to a new account only)

Skip this entire section for routine releases — the D1 `database_id` and Pages project
already exist for the current environment.

```bash
# Create the D1 database, then paste the returned database_id into BOTH
# wrangler.jsonc and cron/wrangler.jsonc (both must point at the same database).
npm run db:create

# Create the *.pages.dev project (one-time).
npm run pages:create
```

---

## 2. Apply database migrations (before deploying new code)

```bash
npm run db:migrate:remote      # production D1
# local dev DB: npm run db:migrate
```

> **Migration `0006_ai_model.sql`** renames `users.gemini_model` → `users.ai_model`;
> **`0007_chat_and_strategy.sql`** adds `users.strategy_notes`, `trades.exit_rationale`, and the
> `chat_messages` table. Run them **before** deploying the new code. Reads (`SELECT *`) degrade gracefully on either
> side of the rename, but a config save that writes the model-override field will error if
> the code and schema disagree, so keep step 2 → step 4 close together. For true zero-downtime
> you'd use expand/contract; for this app a short window is acceptable.

---

## 3. Set secrets (Pages app + Cron Worker)

```bash
# Required — the Pages app:
npx wrangler pages secret put ANTHROPIC_API_KEY

# Required — the Cron Worker needs its OWN copy:
npx wrangler secret put ANTHROPIC_API_KEY --config cron/wrangler.jsonc

# Optional keyed market-data fallbacks (platform works keyless without them):
npx wrangler pages secret put FINNHUB_API_KEY
npx wrangler pages secret put ALPHAVANTAGE_API_KEY
```

Secrets take effect immediately for new requests — no redeploy needed just to set a secret.

---

## 4. Deploy

```bash
npm run deploy            # build + wrangler pages deploy  (SPA + /api Function)
npm run deploy:cron       # deploy the companion cron Worker
```

Redeploy the cron Worker (`deploy:cron`) whenever shared service code under `src/worker/`
changes — it bundles the same code as the Pages Function.

---

## 5. Verify (smoke test)

```bash
# 1. Health — expect aiConfigured:true and the configured model.
curl -s https://<project>.pages.dev/api/health
#    { "ok": true, "service": "trade-auto", "aiConfigured": true,
#      "model": "claude-opus-4-8", "time": "..." }
```

2. **UI:** log in, open the dashboard, expand the **AI Research Hub** (it starts collapsed),
   and click **Scan markets**. Expect trade-idea suggestions, **one entry per asset**
   (re-scanning the same asset updates its entry in place rather than duplicating it).
3. **Run a full cycle on demand** (instead of waiting for the 30-min cron):
   `POST /api/ai/run-cycle` from the authenticated app, or hit the cron Worker's
   `GET /__run` endpoint if it has a `workers.dev` route.
4. **Tail logs** if anything looks off:
   ```bash
   npx wrangler pages deployment tail              # the app
   npx wrangler tail --config cron/wrangler.jsonc  # the cron Worker
   ```

---

## 6. Rollback

- **Pages app:** Cloudflare dashboard → Workers & Pages → `trade-auto` → *Deployments* →
  **Rollback** to the previous deployment (instant). `npx wrangler pages deployment list`
  shows the history.
- **Cron Worker:** `npx wrangler rollback --config cron/wrangler.jsonc` (optionally pass a
  version id from `npx wrangler deployments list --config cron/wrangler.jsonc`).
- **Database:** D1 migrations are forward-only. To undo `0006` you must also roll back the
  code, then manually `ALTER TABLE users RENAME COLUMN ai_model TO gemini_model;`
  (`npx wrangler d1 execute trade-auto-db --remote --command "..."`). Only do this if you are
  reverting to a pre-Claude build.

---

## 7. Routine release checklist

1. `git pull` and `npm install`
2. `npm run typecheck && npm test && npm run build`
3. `npm run db:migrate:remote` (only if there are new migrations)
4. `npm run deploy`
5. `npm run deploy:cron` (if `src/worker/` changed)
6. Smoke test (section 5)

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `/api/health` shows `aiConfigured: false` | `ANTHROPIC_API_KEY` not set on the **Pages** project — set it (section 3). |
| Cron logs: `ANTHROPIC_API_KEY is not configured` | The **cron Worker** is missing its own secret — `wrangler secret put ANTHROPIC_API_KEY --config cron/wrangler.jsonc`. |
| Build/deploy fails on `node:` imports | `nodejs_compat` missing from a `wrangler.jsonc` — it's required by the Anthropic SDK. |
| `POST /api/ai/discover` returns 502 | Tail logs; usually an Anthropic API error (bad key, rate limit) or no market data for the universe. |
| `no such column: ai_model` / `gemini_model` | Migration `0006` not applied — run `npm run db:migrate:remote`. |
| AI calls time out | Opus 4.8 with adaptive thinking can be slow; the SDK client timeout is 120s. Lower effort/`max_tokens` in `src/worker/services/claude.ts` if needed. |

---

## Configuration reference

**Vars** (`vars` in `wrangler.jsonc` / `cron/wrangler.jsonc`):

| Var | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_MODEL` | `claude-opus-4-8` | Model for per-asset analysis. |
| `CLAUDE_DISCOVERY_MODEL` | `claude-opus-4-8` | Model for the universe discovery scan. |
| `CRON_AUTO_TRADE` | `true` | Master switch for auto-trading on the cron (also needs the per-user toggle). |
| `DEFAULT_USER_ID` | `1` | Single-user profile the dashboard operates on. |

**Secrets** (`wrangler [pages] secret put`): `ANTHROPIC_API_KEY` (required, both deployables);
`FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY`, `POLYGON_API_KEY`, `COINGECKO_API_KEY` (optional).
