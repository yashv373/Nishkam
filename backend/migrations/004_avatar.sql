-- Run once: npx wrangler d1 execute nishkam --remote --file=migrations/004_avatar.sql
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar_v INTEGER;
CREATE TABLE IF NOT EXISTS avatars (uid TEXT PRIMARY KEY, img BLOB NOT NULL, type TEXT NOT NULL, v INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS avatar_log (uid TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS avatar_log_uid ON avatar_log(uid, at);
