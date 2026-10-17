-- Run once: npx wrangler d1 execute nishkam --remote --file=migrations/002_profile.sql
-- Existing users get their handle on their next request (the Worker fills it in).
ALTER TABLE users ADD COLUMN handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_handle ON users(handle);
