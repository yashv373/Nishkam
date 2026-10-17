-- Run once: npx wrangler d1 execute nishkam --remote --file=migrations/003_bio.sql
ALTER TABLE users ADD COLUMN bio TEXT;
