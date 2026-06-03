-- Add a configurable analysis timeframe (intraday support).
ALTER TABLE users ADD COLUMN analysis_timeframe TEXT NOT NULL DEFAULT '1d'; -- 1h | 4h | 1d
