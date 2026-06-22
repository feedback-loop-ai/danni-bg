-- API keys for machine clients (spec 027). A second auth path alongside Kratos sessions: a program
-- presents `Authorization: Bearer <key>`. Keys are stored HASHED (SHA-256) — the plaintext is shown
-- once at creation and never retrievable; `prefix` is kept for identification. `scopes` is a JSON
-- array (`read`, `chat`). Owned by a `users` row (becomes org-scoped under spec 029).
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["read","chat"]',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE INDEX idx_api_keys_user ON api_keys (user_id, created_at);
