CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT, name TEXT, handle TEXT, created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0,
  solved TEXT NOT NULL DEFAULT '[]',          -- JSON list of problem ids; points = its length
  code TEXT NOT NULL DEFAULT '{}',            -- JSON {problemId: [last 2 {at, files}]}
  reviews_used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reviews (uid TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS admin_log (who TEXT NOT NULL, what TEXT NOT NULL, at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_handle ON users(handle);
