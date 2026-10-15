# Nishkam backend (v0)

A Cloudflare Worker plus a D1 database. It signs people in with GitHub and keeps their solved problems. Points = number of solved problems.

Run locally: `npm install`, copy `.dev.vars.example` to `.dev.vars`, then `npm run db` and `npm run dev` (port 8787). Test: `npm test`.

Going live later (free plan): `npx wrangler login`; `npx wrangler d1 create nishkam` and paste the id into `wrangler.toml`; `npx wrangler d1 execute nishkam --remote --file=schema.sql`;
create a GitHub OAuth app with callback `https://<api host>/auth/github/callback`; `npx wrangler secret put GITHUB_CLIENT_ID`, `npx wrangler secret put GITHUB_CLIENT_SECRET`, `npx wrangler secret put SESSION_SECRET` (one name per command); `npx wrangler deploy`.
Put the API on a subdomain of nishkam.world (for example api.nishkam.world, as a Worker custom domain), not workers.dev, or browsers will drop the sign-in cookie. Then set `API` in `web/app.js`.
