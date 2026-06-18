-- 008_users.sql — application users mirror for Ory-based identity (spec 019, Phase B).
-- Kratos owns the identity (email + name) in its own Postgres; this table is danni's
-- app-side view keyed by the Kratos identity id, plus the access tier (`role`). A row is
-- found-or-created on the first authenticated request. RBAC is enforced in-app off `role`.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  kratos_identity_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX users_email_idx ON users(email);
