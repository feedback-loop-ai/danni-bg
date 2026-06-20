-- 010_token_usage.sql — per-user LLM token metering + quotas (token metering feature).
-- Every grounded chat turn records the model's token usage against the signed-in user. The chat gate
-- enforces an effective per-user limit (per-user override, else the platform default); admins can set
-- a user's limit and reset their counter. Usage is counted since `users.usage_reset_at` (null = all
-- time), so a reset just bumps that timestamp rather than deleting history.

CREATE TABLE token_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_token_usage_user ON token_usage (user_id, created_at);

-- Per-user quota override (NULL = fall back to the platform default) + the start of the current usage
-- window (NULL = count from the beginning of time).
ALTER TABLE users ADD COLUMN token_limit INTEGER;
ALTER TABLE users ADD COLUMN usage_reset_at TEXT;
