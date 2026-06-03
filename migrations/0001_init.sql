-- TRADE-AUTO · Cloudflare D1 schema
-- Lean SQLite schema for a Gemini-powered paper-trading platform.

-- ---------------------------------------------------------------------------
-- users: global trading configuration + paper balance. Single-user by default.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL DEFAULT 'Default Trader',
  starting_balance    REAL    NOT NULL DEFAULT 100000,
  cash_balance        REAL    NOT NULL DEFAULT 100000,
  risk_level          TEXT    NOT NULL DEFAULT 'medium',   -- low | medium | high
  min_hold_hours      REAL    NOT NULL DEFAULT 8,          -- guardrail: min holding period
  max_trades_per_day  INTEGER NOT NULL DEFAULT 3,          -- guardrail: per asset / 24h
  max_open_positions  INTEGER NOT NULL DEFAULT 10,
  auto_trade_enabled  INTEGER NOT NULL DEFAULT 0,          -- 0/1: AI auto-executes on cron
  allow_shorting      INTEGER NOT NULL DEFAULT 0,          -- 0/1: permit short positions
  gemini_model        TEXT,                                -- optional per-user model override
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- assets: monitored instruments across all categories.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol          TEXT    NOT NULL,                  -- provider symbol: AAPL, BTCUSDT, ES=F
  display_symbol  TEXT,                              -- human label: BTC/USDT
  name            TEXT,
  category        TEXT    NOT NULL,                  -- stock | etf | future | option | crypto
  data_source     TEXT    NOT NULL DEFAULT 'yahoo',  -- yahoo | binance | finnhub | ...
  quote_currency  TEXT    NOT NULL DEFAULT 'USD',
  whitelisted     INTEGER NOT NULL DEFAULT 1,        -- 0/1: AI permitted to trade this
  active          INTEGER NOT NULL DEFAULT 1,        -- 0/1: actively monitored
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, category)
);

-- ---------------------------------------------------------------------------
-- market_snapshots: cached OHLCV + computed indicators (respects API limits).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id         INTEGER NOT NULL,
  symbol           TEXT    NOT NULL,
  interval         TEXT    NOT NULL DEFAULT '1h',     -- 1h | 1d | ...
  price            REAL    NOT NULL,                  -- latest close
  ohlcv_json       TEXT    NOT NULL,                  -- JSON array of {t,o,h,l,c,v}
  indicators_json  TEXT,                              -- JSON of computed indicators
  fetched_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snapshots_asset ON market_snapshots(asset_id, interval, fetched_at);

-- ---------------------------------------------------------------------------
-- trades: paper-trading ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  asset_id        INTEGER NOT NULL,
  symbol          TEXT    NOT NULL,
  category        TEXT    NOT NULL,
  side            TEXT    NOT NULL DEFAULT 'long',   -- long | short
  status          TEXT    NOT NULL DEFAULT 'open',   -- open | closed
  quantity        REAL    NOT NULL,
  entry_price     REAL    NOT NULL,
  entry_time      TEXT    NOT NULL DEFAULT (datetime('now')),
  exit_price      REAL,
  exit_time       TEXT,
  stop_loss       REAL,
  take_profit     REAL,
  position_value  REAL    NOT NULL,                  -- notional at entry
  risk_amount     REAL,                              -- $ risked (entry..stop)
  pnl             REAL,                              -- realized PnL (closed)
  pnl_pct         REAL,
  fees            REAL    NOT NULL DEFAULT 0,
  exit_reason     TEXT,                              -- take_profit | stop_loss | ai_signal | manual | guardrail
  ai_rationale    TEXT,
  ai_log_id       INTEGER,
  confidence      REAL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_asset_time  ON trades(asset_id, entry_time);

-- ---------------------------------------------------------------------------
-- ai_logs: complete record of every Gemini analysis / decision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER,
  asset_id         INTEGER,
  symbol           TEXT,
  model            TEXT    NOT NULL,
  kind             TEXT    NOT NULL,                  -- decision | discovery | commentary
  decision         TEXT,                              -- BUY | SELL | HOLD | CLOSE
  confidence       REAL,
  sentiment        TEXT,                              -- bullish | bearish | neutral
  rationale        TEXT,
  stop_loss        REAL,
  take_profit      REAL,
  risk_reward      REAL,
  indicators_json  TEXT,
  prompt           TEXT,
  raw_response     TEXT,
  grounded         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_logs_asset   ON ai_logs(asset_id, created_at);

-- ---------------------------------------------------------------------------
-- suggestions: AI-discovered "Suggested Assets to Trade".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suggestions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  asset_id        INTEGER,
  symbol          TEXT    NOT NULL,
  category        TEXT,
  direction       TEXT,                               -- long | short
  strategy        TEXT,                               -- short strategy label
  rationale       TEXT,
  indicators_hit  TEXT,                               -- JSON list
  risk_reward     REAL,
  entry           REAL,
  stop_loss       REAL,
  take_profit     REAL,
  confidence      REAL,
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending | approved | rejected | executed | expired
  ai_log_id       INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(user_id, status, created_at);

-- ---------------------------------------------------------------------------
-- equity_history: time series for ROI / drawdown / Sharpe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equity_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  equity           REAL    NOT NULL,                  -- cash + open market value
  cash             REAL    NOT NULL,
  open_positions   INTEGER NOT NULL DEFAULT 0,
  realized_pnl     REAL    NOT NULL DEFAULT 0,
  unrealized_pnl   REAL    NOT NULL DEFAULT 0,
  recorded_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_equity_user_time ON equity_history(user_id, recorded_at);
