// D1 data-access layer. Thin typed repositories over prepared statements.

import type {
  AILog,
  Asset,
  EquityPoint,
  Suggestion,
  Trade,
  User,
} from "../shared/types";
import type { Env, UserRow } from "./types";

export function defaultUserId(env: Env): number {
  const id = parseInt(env.DEFAULT_USER_ID || "1", 10);
  return Number.isFinite(id) ? id : 1;
}

// Build an `UPDATE` from a partial patch, ignoring undefined + non-allowed keys.
function buildUpdate(
  table: string,
  patch: Record<string, unknown>,
  allowed: string[],
): { sql: string; values: unknown[] } | null {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k) && patch[k] !== undefined);
  if (!keys.length) return null;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  return {
    sql: `UPDATE ${table} SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
    values: keys.map((k) => patch[k]),
  };
}

// --------------------------- users ---------------------------
export async function getUser(env: Env, id: number): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.trim().toLowerCase())
    .first<UserRow>();
}

// All real (credentialed) accounts — used by the cron Worker to run each user's
// cycle. The legacy seeded id=1 row (NULL password) is intentionally excluded.
export async function listUserIds(env: Env): Promise<number[]> {
  const r = await env.DB.prepare(
    "SELECT id FROM users WHERE password_hash IS NOT NULL ORDER BY id",
  ).all<{ id: number }>();
  return (r.results ?? []).map((x) => x.id);
}

// Create a new credentialed account starting from the standard $100k paper balance.
export async function createUser(
  env: Env,
  u: { name: string; email: string; password_hash: string; password_salt: string },
): Promise<UserRow> {
  const r = await env.DB.prepare(
    `INSERT INTO users (name, email, password_hash, password_salt, starting_balance, cash_balance)
     VALUES (?, ?, ?, ?, 100000, 100000)
     RETURNING *`,
  )
    .bind(u.name, u.email.trim().toLowerCase(), u.password_hash, u.password_salt)
    .first<UserRow>();
  if (!r) throw new Error("Failed to create user");
  return r;
}

export async function ensureUser(env: Env, id: number): Promise<UserRow> {
  let user = await getUser(env, id);
  if (!user) {
    await env.DB.prepare(
      "INSERT INTO users (id, name, starting_balance, cash_balance) VALUES (?, 'Default Trader', 100000, 100000) ON CONFLICT(id) DO NOTHING",
    )
      .bind(id)
      .run();
    user = await getUser(env, id);
  }
  if (!user) throw new Error("Failed to create default user");
  return user;
}

// --------------------------- sessions ---------------------------
// Expiry is computed in SQL so it shares datetime('now')'s "YYYY-MM-DD HH:MM:SS"
// format — required for the lexical `expires_at > datetime('now')` comparison.
export async function createSession(
  env: Env,
  tokenHash: string,
  userId: number,
  ttlDays: number,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
  )
    .bind(tokenHash, userId, `+${Math.max(1, Math.round(ttlDays))} days`)
    .run();
}

// Resolve an unexpired session to its user id (null if missing/expired).
export async function getSessionUserId(env: Env, tokenHash: string): Promise<number | null> {
  const r = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')",
  )
    .bind(tokenHash)
    .first<{ user_id: number }>();
  return r?.user_id ?? null;
}

export async function deleteSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function pruneExpiredSessions(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// --------------------------- live_quotes ---------------------------
// Latest spot price if cached within maxAgeSeconds, else null (caller refetches).
export async function getFreshLiveQuote(
  env: Env,
  assetId: number,
  maxAgeSeconds: number,
): Promise<number | null> {
  const r = await env.DB.prepare(
    `SELECT price FROM live_quotes
     WHERE asset_id = ? AND fetched_at >= datetime('now', ?)`,
  )
    .bind(assetId, `-${Math.max(1, Math.round(maxAgeSeconds))} seconds`)
    .first<{ price: number }>();
  return r?.price ?? null;
}

export async function saveLiveQuote(
  env: Env,
  q: { asset_id: number; symbol: string; price: number; source: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO live_quotes (asset_id, symbol, price, source, fetched_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(asset_id) DO UPDATE SET
       symbol = excluded.symbol,
       price = excluded.price,
       source = excluded.source,
       fetched_at = excluded.fetched_at`,
  )
    .bind(q.asset_id, q.symbol, q.price, q.source)
    .run();
}

const USER_FIELDS = [
  "name",
  "starting_balance",
  "cash_balance",
  "risk_level",
  "min_hold_hours",
  "max_trades_per_day",
  "max_open_positions",
  "auto_trade_enabled",
  "allow_shorting",
  "gemini_model",
  "analysis_timeframe",
];

export async function updateUser(
  env: Env,
  id: number,
  patch: Partial<User>,
): Promise<UserRow> {
  const upd = buildUpdate("users", patch as Record<string, unknown>, USER_FIELDS);
  if (upd) await env.DB.prepare(upd.sql).bind(...upd.values, id).run();
  const user = await getUser(env, id);
  if (!user) throw new Error("User not found");
  return user;
}

export async function adjustCash(env: Env, id: number, delta: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(delta, id)
    .run();
}

// Atomically debit cash only if the balance covers it. Returns false (no debit)
// when funds are insufficient. Guards against TOCTOU double-spend because D1 has
// no row locks and the Pages app + cron Worker share the same database.
export async function tryDebitCash(env: Env, id: number, amount: number): Promise<boolean> {
  const r = await env.DB.prepare(
    "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
  )
    .bind(amount, id, amount)
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

// --------------------------- assets ---------------------------
export async function listAssets(
  env: Env,
  opts: { activeOnly?: boolean; whitelistedOnly?: boolean } = {},
): Promise<Asset[]> {
  const where: string[] = [];
  if (opts.activeOnly) where.push("active = 1");
  if (opts.whitelistedOnly) where.push("whitelisted = 1");
  const sql =
    "SELECT * FROM assets" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY category, symbol";
  const r = await env.DB.prepare(sql).all<Asset>();
  return r.results ?? [];
}

export async function getAsset(env: Env, id: number): Promise<Asset | null> {
  return env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(id).first<Asset>();
}

export async function insertAsset(
  env: Env,
  a: {
    symbol: string;
    display_symbol?: string | null;
    name?: string | null;
    category: string;
    data_source?: string;
    quote_currency?: string;
  },
): Promise<Asset> {
  const r = await env.DB.prepare(
    `INSERT INTO assets (symbol, display_symbol, name, category, data_source, quote_currency)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, category) DO UPDATE SET active = 1
     RETURNING *`,
  )
    .bind(
      a.symbol,
      a.display_symbol ?? a.symbol,
      a.name ?? a.symbol,
      a.category,
      a.data_source ?? (a.category === "crypto" ? "binance" : "yahoo"),
      a.quote_currency ?? "USD",
    )
    .first<Asset>();
  if (!r) throw new Error("Failed to insert asset");
  return r;
}

const ASSET_FIELDS = [
  "symbol",
  "display_symbol",
  "name",
  "category",
  "data_source",
  "quote_currency",
  "whitelisted",
  "active",
];

export async function updateAsset(
  env: Env,
  id: number,
  patch: Partial<Asset>,
): Promise<Asset | null> {
  const keys = Object.keys(patch).filter(
    (k) => ASSET_FIELDS.includes(k) && (patch as any)[k] !== undefined,
  );
  if (keys.length) {
    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    await env.DB.prepare(`UPDATE assets SET ${setClause} WHERE id = ?`)
      .bind(...keys.map((k) => (patch as any)[k]), id)
      .run();
  }
  return getAsset(env, id);
}

export async function deleteAsset(env: Env, id: number): Promise<void> {
  await env.DB.prepare("DELETE FROM assets WHERE id = ?").bind(id).run();
}

// --------------------------- market_snapshots ---------------------------
export async function saveSnapshot(
  env: Env,
  s: {
    asset_id: number;
    symbol: string;
    interval: string;
    price: number;
    ohlcv_json: string;
    indicators_json: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO market_snapshots (asset_id, symbol, interval, price, ohlcv_json, indicators_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(s.asset_id, s.symbol, s.interval, s.price, s.ohlcv_json, s.indicators_json)
    .run();
}

export interface SnapshotRow {
  id: number;
  asset_id: number;
  symbol: string;
  interval: string;
  price: number;
  ohlcv_json: string;
  indicators_json: string | null;
  fetched_at: string;
}

// Most recent snapshot for an asset that is younger than maxAgeMinutes (cache hit).
export async function getFreshSnapshot(
  env: Env,
  assetId: number,
  interval: string,
  maxAgeMinutes: number,
): Promise<SnapshotRow | null> {
  return env.DB.prepare(
    `SELECT * FROM market_snapshots
     WHERE asset_id = ? AND interval = ?
       AND fetched_at >= datetime('now', ?)
     ORDER BY fetched_at DESC LIMIT 1`,
  )
    .bind(assetId, interval, `-${Math.max(1, Math.round(maxAgeMinutes))} minutes`)
    .first<SnapshotRow>();
}

export async function pruneSnapshots(env: Env, keepDays = 7): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM market_snapshots WHERE fetched_at < datetime('now', ?)`,
  )
    .bind(`-${keepDays} days`)
    .run();
}

// --------------------------- trades ---------------------------
export async function listOpenTrades(env: Env, userId: number): Promise<Trade[]> {
  const r = await env.DB.prepare(
    "SELECT * FROM trades WHERE user_id = ? AND status = 'open' ORDER BY entry_time DESC",
  )
    .bind(userId)
    .all<Trade>();
  return r.results ?? [];
}

export async function listTrades(
  env: Env,
  userId: number,
  opts: { status?: "open" | "closed"; limit?: number } = {},
): Promise<Trade[]> {
  const where = ["user_id = ?"];
  const binds: unknown[] = [userId];
  if (opts.status) {
    where.push("status = ?");
    binds.push(opts.status);
  }
  const limit = Math.min(opts.limit ?? 200, 1000);
  const r = await env.DB.prepare(
    `SELECT * FROM trades WHERE ${where.join(" AND ")} ORDER BY entry_time DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<Trade>();
  return r.results ?? [];
}

export async function getTrade(env: Env, id: number): Promise<Trade | null> {
  return env.DB.prepare("SELECT * FROM trades WHERE id = ?").bind(id).first<Trade>();
}

export async function getOpenTradeForAsset(
  env: Env,
  userId: number,
  assetId: number,
): Promise<Trade | null> {
  return env.DB.prepare(
    "SELECT * FROM trades WHERE user_id = ? AND asset_id = ? AND status = 'open' ORDER BY entry_time DESC LIMIT 1",
  )
    .bind(userId, assetId)
    .first<Trade>();
}

export async function countRecentTradesForAsset(
  env: Env,
  userId: number,
  assetId: number,
  hours: number,
): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM trades
     WHERE user_id = ? AND asset_id = ? AND entry_time >= datetime('now', ?)`,
  )
    .bind(userId, assetId, `-${Math.round(hours)} hours`)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function insertTrade(
  env: Env,
  t: {
    user_id: number;
    asset_id: number;
    symbol: string;
    category: string;
    side: string;
    quantity: number;
    entry_price: number;
    stop_loss: number | null;
    take_profit: number | null;
    position_value: number;
    risk_amount: number | null;
    ai_rationale: string | null;
    ai_log_id: number | null;
    confidence: number | null;
  },
): Promise<Trade> {
  const r = await env.DB.prepare(
    `INSERT INTO trades
       (user_id, asset_id, symbol, category, side, status, quantity, entry_price,
        stop_loss, take_profit, position_value, risk_amount, ai_rationale, ai_log_id, confidence)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      t.user_id,
      t.asset_id,
      t.symbol,
      t.category,
      t.side,
      t.quantity,
      t.entry_price,
      t.stop_loss,
      t.take_profit,
      t.position_value,
      t.risk_amount,
      t.ai_rationale,
      t.ai_log_id,
      t.confidence,
    )
    .first<Trade>();
  if (!r) throw new Error("Failed to insert trade");
  return r;
}

// Close a trade only if it is still open. Returns null when the guarded UPDATE
// matched no row (already closed by a concurrent caller), so the caller must not
// credit cash twice.
export async function closeTradeRow(
  env: Env,
  id: number,
  c: { exit_price: number; pnl: number; pnl_pct: number; exit_reason: string },
): Promise<Trade | null> {
  const r = await env.DB.prepare(
    `UPDATE trades
       SET status = 'closed', exit_price = ?, exit_time = datetime('now'),
           pnl = ?, pnl_pct = ?, exit_reason = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'open'`,
  )
    .bind(c.exit_price, c.pnl, c.pnl_pct, c.exit_reason, id)
    .run();
  if ((r.meta?.changes ?? 0) !== 1) return null;
  return getTrade(env, id);
}

// --------------------------- ai_logs ---------------------------
export async function insertAILog(
  env: Env,
  log: {
    user_id: number | null;
    asset_id: number | null;
    symbol: string | null;
    model: string;
    kind: string;
    decision?: string | null;
    confidence?: number | null;
    sentiment?: string | null;
    rationale?: string | null;
    stop_loss?: number | null;
    take_profit?: number | null;
    risk_reward?: number | null;
    indicators_json?: string | null;
    prompt?: string | null;
    raw_response?: string | null;
    grounded?: number;
  },
): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO ai_logs
       (user_id, asset_id, symbol, model, kind, decision, confidence, sentiment, rationale,
        stop_loss, take_profit, risk_reward, indicators_json, prompt, raw_response, grounded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      log.user_id,
      log.asset_id,
      log.symbol,
      log.model,
      log.kind,
      log.decision ?? null,
      log.confidence ?? null,
      log.sentiment ?? null,
      log.rationale ?? null,
      log.stop_loss ?? null,
      log.take_profit ?? null,
      log.risk_reward ?? null,
      log.indicators_json ?? null,
      log.prompt ?? null,
      log.raw_response ?? null,
      log.grounded ?? 0,
    )
    .first<{ id: number }>();
  return r?.id ?? 0;
}

export async function listAILogs(
  env: Env,
  opts: { kind?: string; limit?: number } = {},
): Promise<AILog[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.kind) {
    where.push("kind = ?");
    binds.push(opts.kind);
  }
  const limit = Math.min(opts.limit ?? 50, 500);
  const r = await env.DB.prepare(
    `SELECT * FROM ai_logs ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<AILog>();
  return r.results ?? [];
}

// --------------------------- suggestions ---------------------------
export async function insertSuggestion(
  env: Env,
  s: {
    user_id: number;
    asset_id: number | null;
    symbol: string;
    category: string | null;
    direction: string | null;
    strategy: string | null;
    rationale: string | null;
    indicators_hit: string | null;
    risk_reward: number | null;
    entry: number | null;
    stop_loss: number | null;
    take_profit: number | null;
    confidence: number | null;
    ai_log_id: number | null;
  },
): Promise<Suggestion> {
  const r = await env.DB.prepare(
    `INSERT INTO suggestions
       (user_id, asset_id, symbol, category, direction, strategy, rationale, indicators_hit,
        risk_reward, entry, stop_loss, take_profit, confidence, ai_log_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     RETURNING *`,
  )
    .bind(
      s.user_id,
      s.asset_id,
      s.symbol,
      s.category,
      s.direction,
      s.strategy,
      s.rationale,
      s.indicators_hit,
      s.risk_reward,
      s.entry,
      s.stop_loss,
      s.take_profit,
      s.confidence,
      s.ai_log_id,
    )
    .first<Suggestion>();
  if (!r) throw new Error("Failed to insert suggestion");
  return r;
}

export async function expireOldSuggestions(env: Env, userId: number, hours = 24): Promise<void> {
  await env.DB.prepare(
    `UPDATE suggestions SET status = 'expired'
     WHERE user_id = ? AND status = 'pending' AND created_at < datetime('now', ?)`,
  )
    .bind(userId, `-${hours} hours`)
    .run();
}

export async function listSuggestions(
  env: Env,
  userId: number,
  opts: { status?: string; limit?: number } = {},
): Promise<Suggestion[]> {
  const where = ["user_id = ?"];
  const binds: unknown[] = [userId];
  if (opts.status) {
    where.push("status = ?");
    binds.push(opts.status);
  }
  const limit = Math.min(opts.limit ?? 50, 200);
  const r = await env.DB.prepare(
    `SELECT * FROM suggestions WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<Suggestion>();
  return r.results ?? [];
}

export async function getSuggestion(env: Env, id: number): Promise<Suggestion | null> {
  return env.DB.prepare("SELECT * FROM suggestions WHERE id = ?").bind(id).first<Suggestion>();
}

export async function setSuggestionStatus(
  env: Env,
  id: number,
  status: string,
): Promise<void> {
  await env.DB.prepare("UPDATE suggestions SET status = ? WHERE id = ?").bind(status, id).run();
}

// --------------------------- equity_history ---------------------------
export async function insertEquityPoint(
  env: Env,
  e: {
    user_id: number;
    equity: number;
    cash: number;
    open_positions: number;
    realized_pnl: number;
    unrealized_pnl: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO equity_history (user_id, equity, cash, open_positions, realized_pnl, unrealized_pnl)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(e.user_id, e.equity, e.cash, e.open_positions, e.realized_pnl, e.unrealized_pnl)
    .run();
}

export async function listEquityHistory(
  env: Env,
  userId: number,
  limit = 500,
): Promise<EquityPoint[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM (
       SELECT * FROM equity_history WHERE user_id = ? ORDER BY recorded_at DESC LIMIT ?
     ) ORDER BY recorded_at ASC`,
  )
    .bind(userId, limit)
    .all<EquityPoint>();
  return r.results ?? [];
}
