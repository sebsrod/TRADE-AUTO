-- Switch the AI provider from Gemini to Claude (Anthropic).
-- The per-user model override column is provider-agnostic now; rename it so the
-- name no longer implies Gemini. SQLite (D1) supports RENAME COLUMN, which keeps
-- any existing per-user override values intact.
ALTER TABLE users RENAME COLUMN gemini_model TO ai_model;
