-- 017_multi_tenancy.sql — organizations (tenants) as the top-level owner of users, API keys, usage,
-- chat sessions, and per-portal config (spec 029, control plane). Turns the flat single-tenant store
-- into a "one deployment, many portals/customers" model: every tenant-owned row carries a tenant_id
-- and every gated request resolves an active tenant. Existing data migrates into a `default` tenant
-- with NO behavior change (FR-133 / SC-C2). The egov `organizations` table (dataset publishers,
-- migration 001) is a different concept — tenants live here as `tenants` to avoid the name clash.

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL
);

-- user ↔ tenant with an org-level role. A user belongs to ≥1 tenant; a request resolves one active.
CREATE TABLE tenant_members (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')) DEFAULT 'member',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX idx_tenant_members_user ON tenant_members (user_id);

-- Tenant-owned rows carry tenant_id (FR-129/130). Added nullable, then backfilled below.
ALTER TABLE api_keys ADD COLUMN tenant_id TEXT;
ALTER TABLE chat_sessions ADD COLUMN tenant_id TEXT;
ALTER TABLE token_usage ADD COLUMN tenant_id TEXT;
ALTER TABLE api_usage ADD COLUMN tenant_id TEXT;
CREATE INDEX idx_api_usage_tenant ON api_usage (tenant_id, created_at);

-- platform_settings becomes tenant-scoped (FR-131): the same key can hold a per-tenant value, with a
-- `global` row as the deployment-wide default/fallback (the current LLM/toggles config). SQLite can't
-- repivot a PRIMARY KEY in place, so recreate the table with a composite (tenant_id, key) key and copy
-- every existing row into the `global` tenant — preserving today's admin settings unchanged.
ALTER TABLE platform_settings RENAME TO platform_settings_old;
CREATE TABLE platform_settings (
  tenant_id TEXT NOT NULL DEFAULT 'global',
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (tenant_id, key)
);
INSERT INTO platform_settings (tenant_id, key, value_json, updated_at, updated_by)
  SELECT 'global', key, value_json, updated_at, updated_by FROM platform_settings_old;
DROP TABLE platform_settings_old;

-- Backfill: one default tenant; every existing user joins it (app admins become tenant owners); all
-- existing tenant-owned rows are attributed to it. Single-tenant deployments keep working identically.
INSERT INTO tenants (id, name, slug, plan, created_at)
  VALUES ('default', 'Default', 'default', 'default', '2026-06-22T00:00:00.000Z');
INSERT INTO tenant_members (tenant_id, user_id, role, created_at)
  SELECT 'default', id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END, '2026-06-22T00:00:00.000Z'
  FROM users;
UPDATE api_keys SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE chat_sessions SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE token_usage SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE api_usage SET tenant_id = 'default' WHERE tenant_id IS NULL;
