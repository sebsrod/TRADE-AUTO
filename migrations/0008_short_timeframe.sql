-- Short-timeframe operation: a per-user toggle for short swing & momentum trading
-- (minutes-to-hours holds). When on, the UI offers 5m–8h minimum-hold options and
-- the AI prompts steer toward fast, decisive intraday setups.
ALTER TABLE users ADD COLUMN short_timeframe INTEGER NOT NULL DEFAULT 0;
