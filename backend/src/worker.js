const ORIGINS = ["https://nishkam.world", "http://localhost:8000"];
const MAX_BODY = 50 * 1024;
const enc = new TextEncoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(env, s) {
  const k = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
}
// Session = "<userId>.<expiry>.<hmac>" (no sessions table; logout just clears the cookie).
async function makeToken(env, uid) {
  const body = `${uid}.${Math.floor(Date.now() / 1000) + 30 * 86400}`;
  return `${body}.${await sign(env, body)}`;
}
async function userId(req, env) {
  const m = /(?:^|;\s*)nk_session=([^;]+)/.exec(req.headers.get("Cookie") || "");
  if (!m) return null;
  const [uid, exp, mac] = m[1].split(".");
  if (!mac || +exp < Date.now() / 1000 || (await sign(env, `${uid}.${exp}`)) !== mac) return null;
  return +uid;
}
const cookie = (name, val, age) => `${name}=${val}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;

async function upsertUser(env, provider, pid, name, avatar) {
  await env.DB.prepare("INSERT INTO users (provider,provider_id,name,avatar,created_at) VALUES (?,?,?,?,?) ON CONFLICT(provider,provider_id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar")
    .bind(provider, String(pid), name, avatar, Date.now()).run();
  return (await env.DB.prepare("SELECT id FROM users WHERE provider=? AND provider_id=?").bind(provider, String(pid)).first()).id;
}
async function sessionResponse(env, uid, location) {
  const h = new Headers({ Location: location });
  h.append("Set-Cookie", cookie("nk_session", await makeToken(env, uid), 30 * 86400));
  h.append("Set-Cookie", cookie("nk_state", "", 0));
  return new Response(null, { status: 302, headers: h });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    const origin = req.headers.get("Origin");
    const okOrigin = ORIGINS.includes(origin);
    const cors = okOrigin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" } : { "Vary": "Origin" };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });

    if (req.method === "OPTIONS") {
      if (!okOrigin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
    }
    // Requests carrying a foreign Origin header (set by the browser) are refused.
    if (origin && !okOrigin) return json({ error: "origin not allowed" }, 403);

    if (path === "/auth/github") {
      const state = crypto.randomUUID();
      const u = new URL("https://github.com/login/oauth/authorize");
      u.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, state, scope: "read:user" });
      return new Response(null, { status: 302, headers: { Location: u.href, "Set-Cookie": cookie("nk_state", state, 600) } });
    }
    if (path === "/auth/github/callback") {
      const state = url.searchParams.get("state"), code = url.searchParams.get("code");
      if (!code || !state || !(req.headers.get("Cookie") || "").includes(`nk_state=${state}`)) return json({ error: "bad state" }, 400);
      const t = await (await fetch("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
      })).json();
      if (!t.access_token) return json({ error: "github refused the code" }, 400);
      const g = await (await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${t.access_token}`, "User-Agent": "nishkam" } })).json();
      if (!g.id) return json({ error: "github user lookup failed" }, 400);
      return sessionResponse(env, await upsertUser(env, "github", g.id, g.name || g.login, g.avatar_url), env.FRONTEND_URL);
    }
    // Test-only login. Exists only when DEV_FAKE_LOGIN=1 (set in .dev.vars, never in wrangler.toml).
    if (path === "/dev/login" && env.DEV_FAKE_LOGIN === "1") {
      const name = url.searchParams.get("name") || "tester";
      return sessionResponse(env, await upsertUser(env, "fake", name, name, ""), "/me");
    }

    if (path === "/logout" && req.method === "POST")
      return new Response(null, { status: 204, headers: { ...cors, "Set-Cookie": cookie("nk_session", "", 0) } });

    if (path === "/me" && req.method === "GET") {
      const uid = await userId(req, env);
      if (!uid) return json({ error: "not signed in" }, 401);
      const u = await env.DB.prepare("SELECT name, avatar FROM users WHERE id=?").bind(uid).first();
      if (!u) return json({ error: "not signed in" }, 401);
      const rows = (await env.DB.prepare("SELECT problem_id FROM solves WHERE user_id=?").bind(uid).all()).results;
      return json({ name: u.name, avatar: u.avatar, points: rows.length, solved: rows.map((r) => r.problem_id) });
    }

    if (path === "/solve" && req.method === "POST") {
      const uid = await userId(req, env);
      if (!uid) return json({ error: "not signed in" }, 401);
      if (+req.headers.get("Content-Length") > MAX_BODY) return json({ error: "too big" }, 413);
      const text = await req.text();
      if (enc.encode(text).length > MAX_BODY) return json({ error: "too big" }, 413);
      let b; try { b = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
      if (typeof b?.problem !== "string" || !/^[a-z0-9-]{1,64}$/.test(b.problem)) return json({ error: "bad problem id" }, 400);
      const files = b.files && typeof b.files === "object" ? b.files : {};
      await env.DB.prepare("INSERT INTO solves (user_id,problem_id,solved_at,code) VALUES (?,?,?,?) ON CONFLICT(user_id,problem_id) DO UPDATE SET solved_at=excluded.solved_at, code=excluded.code")
        .bind(uid, b.problem, Date.now(), JSON.stringify(files)).run();
      const n = (await env.DB.prepare("SELECT COUNT(*) c FROM solves WHERE user_id=?").bind(uid).first()).c;
      return json({ ok: true, points: n });
    }
    return json({ error: "not found" }, 404);
  },
};
