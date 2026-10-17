# Nishkam backend (v0)

A Cloudflare Worker plus a D1 database. People sign in on the page with Firebase (Google or GitHub). The page sends the Firebase ID token with each call, and the Worker checks it itself against Google's public keys. It keeps each person's solved problems and gives 2 free "explain this failure" hints per account, for life.

Calls: `GET /me`, `POST /me/solved {problemId}`, `POST /review {problemId, problemText, userRtl, cycleTable}` (20 KB max). Only https://nishkam.world and http://localhost:8000 may call it.

Test (no install needed): `node test.mjs`.

## Going live (all free plans)

1. Firebase console: create a project, then Authentication > Sign-in method: turn on Google and GitHub. For GitHub, create an OAuth app on GitHub and paste its Client ID and secret into Firebase; set GitHub's callback URL to the one Firebase shows. Authentication > Settings > Authorized domains: add `nishkam.world` (localhost is already there). Project settings > Your apps: add a web app and copy its config.
2. `npm install`, then `npx wrangler login`.
3. `npx wrangler d1 create nishkam`, paste the printed `database_id` into `wrangler.toml`.
4. Set `FIREBASE_PROJECT_ID` in `wrangler.toml` to the Firebase project id.
5. `npx wrangler d1 execute nishkam --remote --file=schema.sql`
6. `npx wrangler deploy`. Workers AI needs no key; it uses the `AI` binding.
7. Fill `web/config.js` with the Firebase config and the Worker URL. Until you do, the page shows nothing new.
