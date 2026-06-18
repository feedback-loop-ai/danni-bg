-- 009_platform_settings.sql — runtime, admin-editable platform settings (spec 019, Phase C).
-- An extensible key/value store so new toggles don't need schema changes. Values are JSON, validated
-- per-key on load (Constitution VII). The chat's default LLM provider lives under `llm.default`
-- (seeded from EXPLORER_DEFAULT_* on first run); other toggles under their own keys.

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
