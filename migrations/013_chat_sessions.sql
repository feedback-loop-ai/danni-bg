-- 013_chat_sessions.sql — persistent, per-user chat history (resumable conversations).
-- Reverses the original in-memory-only design (FR-019): a user's questions + replies are now stored
-- so a conversation survives reloads/restarts and can be reopened and continued. Each session belongs
-- to one app user; messages keep their citations/anchors as JSON for faithful re-render.

CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  context_dataset_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_chat_sessions_user ON chat_sessions (user_id, updated_at DESC);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations_json TEXT,
  anchors_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_chat_messages_session ON chat_messages (session_id, created_at);
