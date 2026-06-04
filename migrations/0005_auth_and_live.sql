-- Multi-user authentication + a short-lived live-quote cache for real-time P&L.
--
-- Auth model: each user owns their own paper portfolio (trades/equity/suggestions
-- are already scoped by user_id). Credentials live on the users row; opaque session
-- tokens live in `sessions` (we store only the SHA-256 hash of each cookie token, so
-- a database leak never exposes a usable session). The legacy seeded id=1 row keeps
-- NULL credentials and simply becomes inaccessible — its assets are shared globally.

-- --- credentials on users ---------------------------------------------------
-- (SQLite can't add a UNIQUE column via ALTER, so email uniqueness is an index.)
ALTER TABLE users ADD COLUMN email          TEXT;
ALTER TABLE users ADD COLUMN password_hash  TEXT;
ALTER TABLE users ADD COLUMN password_salt  TEXT;

-- Case-insensitive uniqueness is enforced by storing emails pre-lowercased.
-- NULLs are allowed multiple times in a SQLite UNIQUE index (legacy rows are fine).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- --- sessions ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT    NOT NULL UNIQUE,   -- SHA-256(hex) of the cookie token
  user_id     INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT    NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- --- live_quotes ------------------------------------------------------------
-- Latest spot price per asset, refreshed on demand. A few-second freshness window
-- lets the dashboard poll every ~5s without hammering Binance/Yahoo (many tabs and
-- both deployables share one cached value).
CREATE TABLE IF NOT EXISTS live_quotes (
  asset_id    INTEGER PRIMARY KEY,
  symbol      TEXT    NOT NULL,
  price       REAL    NOT NULL,
  source      TEXT    NOT NULL,
  fetched_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
