-- Chat with Gemini + a user-defined trading-style note that conditions every
-- open/close decision, plus an AI rationale captured when the engine CLOSES a trade.

-- --- user's personal trading style / standing instructions for the AI ---------
-- Free-text. Injected verbatim into the per-asset analysis, discovery and chat
-- prompts so the model trades the way the user described.
ALTER TABLE users ADD COLUMN strategy_notes TEXT;

-- --- why the AI closed a position -------------------------------------------
-- exit_reason already labels the trigger (stop_loss | take_profit | ai_signal |
-- manual); this stores the model's natural-language reasoning when it CLOSEs.
ALTER TABLE trades ADD COLUMN exit_rationale TEXT;

-- --- chat history ------------------------------------------------------------
-- Per-user conversation with Gemini (asset analysis requests, strategy chats).
CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  role          TEXT    NOT NULL,                 -- user | assistant
  content       TEXT    NOT NULL,
  asset_symbol  TEXT,                             -- optional asset the turn was about
  model         TEXT,                             -- model that produced an assistant turn
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_user_time ON chat_messages(user_id, created_at);
