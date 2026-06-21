-- Per-message token usage + reply duration, kept with each assistant turn so the chat shows
-- "tokens consumed" and "how long it took" after the reply, and on reload/resume (spec 020/021).
ALTER TABLE chat_messages ADD COLUMN usage_json TEXT;
ALTER TABLE chat_messages ADD COLUMN duration_ms INTEGER;
