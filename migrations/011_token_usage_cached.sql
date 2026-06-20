-- 011_token_usage_cached.sql — track cache-hit input tokens alongside input/output (token metering).
-- `cached_input_tokens` is the portion of `input_tokens` the provider served from its prompt cache;
-- surfaced in the usage breakdown. input/output/total columns already exist from migration 010.

ALTER TABLE token_usage ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
