-- Enforce at most one OPEN position per (user, asset). This makes the
-- "one open position per asset" guardrail race-proof: a concurrent open
-- (e.g. manual UI + cron Worker on the shared D1) fails the INSERT instead of
-- silently creating a duplicate and double-debiting cash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_per_asset
  ON trades(user_id, asset_id)
  WHERE status = 'open';
