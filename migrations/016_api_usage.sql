-- Per-request API usage metering (spec 028): one row per metered request, keyed by principal
-- (the owning user id, plus key_id when the caller authenticated with an API key) and route class
-- (`data` | `chat`). Drives per-key/per-user usage views + the request quota. Anonymous browser
-- traffic to the public read API is NOT metered. Plus a per-key request-quota override on api_keys.
CREATE TABLE api_usage (
  id TEXT PRIMARY KEY,
  principal_kind TEXT NOT NULL,   -- 'user' | 'apiKey'
  principal_id TEXT NOT NULL,     -- owning users.id
  key_id TEXT,                    -- api_keys.id when principal_kind = 'apiKey'
  route_class TEXT NOT NULL,      -- 'data' | 'chat'
  created_at TEXT NOT NULL
);

CREATE INDEX idx_api_usage_principal ON api_usage (principal_id, created_at);
CREATE INDEX idx_api_usage_key ON api_usage (key_id, created_at);

-- Per-key request-quota override (null = use the admin-configured plan default).
ALTER TABLE api_keys ADD COLUMN quota_limit INTEGER;
