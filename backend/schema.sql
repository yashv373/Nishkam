CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL, provider_id TEXT NOT NULL,
  name TEXT, avatar TEXT, created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_id));
CREATE TABLE IF NOT EXISTS solves (
  user_id INTEGER NOT NULL, problem_id TEXT NOT NULL,
  solved_at INTEGER NOT NULL, code TEXT,
  PRIMARY KEY (user_id, problem_id));
