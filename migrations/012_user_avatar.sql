-- 012_user_avatar.sql — optional profile picture per user. Stored as a small data: URL (the client
-- resizes before upload); NULL = fall back to initials in the avatar.

ALTER TABLE users ADD COLUMN avatar_url TEXT;
