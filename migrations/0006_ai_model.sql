-- Make the per-user model-override column provider-agnostic: rename gemini_model
-- to ai_model. SQLite (D1) supports RENAME COLUMN, which keeps any existing
-- per-user override values intact.
ALTER TABLE users RENAME COLUMN gemini_model TO ai_model;
