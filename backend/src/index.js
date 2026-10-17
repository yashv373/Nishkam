const ORIGINS = ["https://nishkam.world", "http://localhost:8000"];
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
const QUOTA = 2, MAX_BODY = 20 * 1024, KEEP = 2;
const DEFAULTS = { ai_review: "on", signups: "on", studio: "on", banner: "" };
const TOGGLES = ["ai_review", "signups", "studio"];
const DAY = 86400000;
const MAX_AVATAR = 16 * 1024, AVATARS_PER_DAY = 5;
const HANDLE = /^[a-z0-9_]{3,20}$/;
const enc = new TextEncoder(), dec = new TextDecoder();

const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(dec.decode(unb64(s)));

// Cached until the response's max-age runs out. A forced refetch (unknown kid) is allowed at most once a minute,
// so random kids cannot make every request hit Google.
let cache = null, expires = 0, fetched = 0;
export async function fetchKeys(force) {
  const t = Date.now();
  if (!cache || t >= expires || (force && t - fetched > 60000)) {
    const r = await fetch(JWKS_URL);
    cache = (await r.json()).keys; fetched = t;
    expires = t + 1000 * (+/max-age=(\d+)/.exec(r.headers.get("Cache-Control") || "")?.[1] || 3600);
  }
  return cache;
}

// Returns the token's claims, or throws. keys = JWK list, now = seconds.
export async function verify(token, projectId, keys, now = Math.floor(Date.now() / 1000)) {
  const p = String(token).split(".");
  if (p.length !== 3) throw new Error("malformed");
  const h = part(p[0]), c = part(p[1]);
  if (h.alg !== "RS256") throw new Error("alg");
  const jwk = keys.find((k) => k.kid === h.kid);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64(p[2]), enc.encode(p[0] + "." + p[1])))) throw new Error("signature");
  if (c.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("iss");
  if (c.aud !== projectId) throw new Error("aud");
  if (!(c.exp > now) || !(c.iat <= now + 300) || (c.auth_time !== undefined && !(c.auth_time <= now + 300))) throw new Error("time");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("sub");
  return c;
}

const SYSTEM = `You are a teaching assistant for a digital hardware design practice site. A student's Verilog failed an equivalence check against a hidden reference. You get the problem, the student's code and a table of the first failing cycles.
Explain in plain words what goes wrong and on which signal and cycle, and give one direction to look. Keep it under 120 words.
Hard rules: NEVER write Verilog or any corrected code, not even one line. Do not guess at the reference design. Words only.`;

const FENCE = /```[\s\S]*?(```|$)/g;
const VLOG = /^\s*(assign\s|always(_ff|_comb|_latch)?\s*(@|\()|module\s+\w+\s*[#(]|endmodule|endcase|begin\s*$|end\s*$|(input|output|inout|wire|reg|logic)\s*(\[|\w+\s*[,;)])|(if|else if|for|case)\s*\(.*\)\s*(begin)?\s*$)|;\s*$/;
export const clean = (t) => String(t).replace(FENCE, "").split("\n").filter((l) => !VLOG.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();

export async function handle(req, env, getKeys = fetchKeys) {
  const origin = req.headers.get("Origin"), ok = ORIGINS.includes(origin);
  const cors = ok ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS")
    return ok ? new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET,POST,DELETE", "Access-Control-Allow-Headers": "Authorization,Content-Type", "Access-Control-Max-Age": "86400" } }) : new Response(null, { status: 403 });
  if (origin && !ok) return json({ error: "origin not allowed" }, 403);

  const path = new URL(req.url).pathname;
  const flagRows = async () => ({ ...DEFAULTS, ...Object.fromEntries(((await env.DB.prepare("SELECT key,value FROM flags").bind().all()).results || []).map((r) => [r.key, r.value])) });
  if (path === "/flags" && req.method === "GET")
    return new Response(JSON.stringify(await flagRows()), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", ...cors } });
  const av = /^\/avatar\/([A-Za-z0-9_-]{1,128})\.webp$/.exec(path);
  if (av && req.method === "GET") { // public: plain <img> tags load this, no sign-in
    const r = await env.DB.prepare("SELECT img,type,v FROM avatars WHERE uid=?").bind(av[1]).first();
    if (!r) return new Response("not found", { status: 404, headers: cors });
    const h = { "Content-Type": r.type, "Cache-Control": "public, max-age=86400", ETag: `"${r.v}"`, "Cross-Origin-Resource-Policy": "cross-origin", ...cors };
    if (req.headers.get("If-None-Match") === h.ETag) return new Response(null, { status: 304, headers: h });
    return new Response(new Uint8Array(r.img), { headers: h });
  }
  if (!["/me", "/me/handle", "/me/bio", "/me/name", "/me/avatar", "/leaderboard", "/solve", "/me/solved", "/review", "/admin/stats", "/admin/flags", "/admin/deck"].includes(path)) return json({ error: "not found" }, 404);
  if (path === "/me/avatar" ? !["POST", "DELETE"].includes(req.method) : req.method !== (path === "/me" || path === "/leaderboard" || path === "/admin/stats" || path === "/admin/deck" ? "GET" : "POST")) return json({ error: "method not allowed" }, 405);

  const tok = /^Bearer (.+)$/.exec(req.headers.get("Authorization") || "")?.[1];
  let claims;
  try {
    try { claims = await verify(tok, env.FIREBASE_PROJECT_ID, await getKeys()); }
    catch (e) { if (e.message !== "kid") throw e; claims = await verify(tok, env.FIREBASE_PROJECT_ID, await getKeys(true)); } // key rotated
  } catch { return json({ error: "not signed in" }, 401); }
  const uid = claims.sub;
  const now = Date.now();
  const isAdmin = claims.email_verified === true && !!claims.email &&
    String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((e) => e.trim()).includes(claims.email.toLowerCase());
  if (path.startsWith("/admin/") && !isAdmin) return json({ error: "admins only" }, 403);
  if (path === "/admin/deck") {
    const o = await env.PRIVATE.get("pitch.html");
    if (!o) return json({ error: "no deck uploaded" }, 404);
    return new Response(o, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; script-src 'unsafe-inline'; frame-ancestors 'none'", ...cors } });
  }
  // Default handle = email local part made safe; digits added until free.
  const freeHandle = async () => {
    let base = String(claims.email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20);
    if (base.length < 3) base = (base + "_usr").slice(0, 20);
    for (let n = 1, h = base; ; h = base.slice(0, 20 - String(++n).length) + n)
      if (!(await env.DB.prepare("SELECT uid FROM users WHERE handle=?").bind(h).first())) return h;
  };
  const known = await env.DB.prepare("SELECT uid, handle FROM users WHERE uid=?").bind(uid).first();
  if (known) {
    await env.DB.prepare("UPDATE users SET email=?, name=?, last_seen=? WHERE uid=?").bind(claims.email || "", claims.name || "", now, uid).run();
    if (!known.handle) await env.DB.prepare("UPDATE users SET handle=? WHERE uid=?").bind(await freeHandle(), uid).run(); // users from before the handle column
  } else {
    if ((await flagRows()).signups === "off") return json({ error: "New sign-ups are paused." }, 403);
    await env.DB.prepare("INSERT INTO users (uid,email,name,created,last_seen,handle) VALUES (?,?,?,?,?,?)").bind(uid, claims.email || "", claims.name || "", now, now, await freeHandle()).run();
  }

  // ponytail: scans all users per call, fine to ~10k (same as /admin/stats). Rows: best first, ties by created.
  const avUrl = (id, v) => (v ? `${new URL(req.url).origin}/avatar/${id}.webp?v=${v}` : null);
  const board = async () => ((await env.DB.prepare("SELECT uid,handle,name,display_name,avatar_v,created,solved FROM users").bind().all()).results || [])
    .map((r) => ({ uid: r.uid, handle: r.handle, name: r.display_name || r.name, avatar_url: avUrl(r.uid, r.avatar_v), created: r.created, solved: JSON.parse(r.solved || "[]").length }))
    .sort((a, b) => b.solved - a.solved || a.created - b.created);
  const rankOf = (rows, pts) => 1 + rows.filter((r) => r.solved > pts).length;
  if (path === "/leaderboard") {
    const rows = await board();
    return json({ total_users: rows.length, rows: rows.slice(0, 50).map((r) => ({ rank: rankOf(rows, r.solved), handle: r.handle, first_name: String(r.name || "").split(" ")[0], display_name: r.name || "", avatar_url: r.avatar_url, points: r.solved, solved: r.solved })) });
  }
  if (path === "/me/handle") {
    let b; try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad json" }, 400); }
    const h = b?.handle;
    if (typeof h !== "string" || !HANDLE.test(h)) return json({ error: "Handles are 3-20 characters: a-z, 0-9 and _." }, 400);
    const own = await env.DB.prepare("SELECT uid FROM users WHERE handle=?").bind(h).first();
    if (own && own.uid !== uid) return json({ error: "That handle is taken." }, 409);
    try { await env.DB.prepare("UPDATE users SET handle=? WHERE uid=?").bind(h, uid).run(); }
    catch { return json({ error: "That handle is taken." }, 409); } // lost a race: the unique index refused
    return json({ ok: true, handle: h });
  }

  if (path === "/me/name") {
    let b; try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad json" }, 400); }
    if (typeof b?.name !== "string") return json({ error: "bad name" }, 400);
    const name = b.name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (![...name].length || [...name].length > 40) return json({ error: "Name must be 1-40 characters." }, 400);
    await env.DB.prepare("UPDATE users SET display_name=? WHERE uid=?").bind(name, uid).run();
    return json({ ok: true, name, display_name: name });
  }

  if (path === "/me/avatar") {
    if (req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM avatars WHERE uid=?").bind(uid).run();
      await env.DB.prepare("UPDATE users SET avatar_v=NULL WHERE uid=?").bind(uid).run();
      return json({ ok: true, avatar_url: null });
    }
    const buf = await req.arrayBuffer(), x = new Uint8Array(buf), at = (i, s) => [...s].every((c, k) => x[i + k] === c.charCodeAt(0));
    if (buf.byteLength > MAX_AVATAR) return json({ error: "Picture must be 16 KB or less." }, 413);
    const type = at(0, "RIFF") && at(8, "WEBP") ? "image/webp" : x[0] === 0xff && x[1] === 0xd8 && x[2] === 0xff ? "image/jpeg" : null;
    if (!type) return json({ error: "Picture must be WebP or JPEG." }, 415);
    // ponytail: rolling 24 h window counted in D1; one extra query per upload
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM avatar_log WHERE uid=? AND at>?").bind(uid, now - DAY).first();
    if (n.n >= AVATARS_PER_DAY) return json({ error: "You can change your picture 5 times a day. Try again tomorrow." }, 429);
    await env.DB.prepare("INSERT INTO avatars (uid,img,type,v) VALUES (?,?,?,?) ON CONFLICT(uid) DO UPDATE SET img=excluded.img, type=excluded.type, v=excluded.v").bind(uid, buf, type, now).run();
    await env.DB.prepare("UPDATE users SET avatar_v=? WHERE uid=?").bind(now, uid).run();
    await env.DB.prepare("INSERT INTO avatar_log (uid,at) VALUES (?,?)").bind(uid, now).run();
    await env.DB.prepare("DELETE FROM avatar_log WHERE uid=? AND at<=?").bind(uid, now - DAY).run();
    return json({ ok: true, avatar_url: avUrl(uid, now) });
  }

  if (path === "/me/bio") {
    let b; try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad json" }, 400); }
    if (typeof b?.bio !== "string") return json({ error: "bad bio" }, 400);
    const bio = b.bio.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if ([...bio].length > 160) return json({ error: "Bio is 160 characters at most." }, 400);
    await env.DB.prepare("UPDATE users SET bio=? WHERE uid=?").bind(bio, uid).run();
    return json({ ok: true, bio });
  }

  if (path === "/admin/stats") {
    const t = await env.DB.prepare("SELECT COUNT(*) total, SUM(created>=?) d1, SUM(created>=?) d7, SUM(created>=?) d30, SUM(last_seen>=?) active7 FROM users")
      .bind(now - (now % DAY), now - 7 * DAY, now - 30 * DAY, now - 7 * DAY).first();
    const rv = await env.DB.prepare("SELECT COUNT(*) total, SUM(at>=?) today FROM reviews").bind(now - (now % DAY)).first();
    const perProblem = {};
    for (const r of (await env.DB.prepare("SELECT solved FROM users").bind().all()).results || [])
      for (const id of JSON.parse(r.solved || "[]")) perProblem[id] = (perProblem[id] || 0) + 1; // ponytail: scans all users, fine to ~10k
    const log = (await env.DB.prepare("SELECT who,what,at FROM admin_log ORDER BY at DESC LIMIT 50").bind().all()).results || [];
    return json({ users: t.total, signups: { today: t.d1 || 0, d7: t.d7 || 0, d30: t.d30 || 0 }, active7: t.active7 || 0,
      solves: { total: Object.values(perProblem).reduce((a, b) => a + b, 0), perProblem },
      reviews: { total: rv.total, today: rv.today || 0 }, flags: await flagRows(), log });
  }
  if (path === "/admin/flags") {
    let f; try { f = JSON.parse(await req.text()); } catch { return json({ error: "bad json" }, 400); }
    const okVal = TOGGLES.includes(f?.key) ? (f.value === "on" || f.value === "off") : f?.key === "banner" && typeof f.value === "string" && f.value.length <= 300;
    if (!okVal) return json({ error: "bad flag" }, 400);
    await env.DB.prepare("INSERT INTO flags (key,value,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
      .bind(f.key, f.value, claims.email, now).run();
    await env.DB.prepare("INSERT INTO admin_log (who,what,at) VALUES (?,?,?)").bind(claims.email, `set ${f.key} = ${f.value || "(empty)"}`, now).run();
    return json({ ok: true });
  }

  if (path === "/me") {
    const u = await env.DB.prepare("SELECT uid,email,name,created,solved,reviews_used,handle,bio,display_name,avatar_v FROM users WHERE uid=?").bind(uid).first();
    const solved = JSON.parse(u.solved || "[]"), rows = await board();
    return json({ uid: u.uid, email: u.email, name: u.display_name || u.name, display_name: u.display_name || u.name || "", avatar_url: avUrl(uid, u.avatar_v), handle: u.handle, bio: u.bio || "", created: u.created, solved, points: solved.length, rank: rankOf(rows, solved.length), total_users: rows.length, reviews_left: Math.max(0, QUOTA - u.reviews_used), is_admin: isAdmin });
  }

  const text = await req.text();
  if (enc.encode(text).length > MAX_BODY) return json({ error: "too big" }, 413);
  let b; try { b = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
  const pid = b?.problem ?? b?.problemId;
  if (typeof pid !== "string" || !/^[a-z0-9-]{1,64}$/.test(pid)) return json({ error: "bad problem id" }, 400);

  if (path === "/solve" || path === "/me/solved") {
    const files = b.files && typeof b.files === "object" && !Array.isArray(b.files) ? b.files : {};
    if (Object.values(files).some((v) => typeof v !== "string")) return json({ error: "bad files" }, 400);
    // ponytail: read-modify-write; two simultaneous solves can lose one, harmless (re-solving adds it back).
    const u = await env.DB.prepare("SELECT solved, code FROM users WHERE uid=?").bind(uid).first();
    const s = new Set(JSON.parse(u.solved || "[]")); s.add(pid);
    if (s.size > 100) return json({ error: "too many problems" }, 400); // stops a row growing without bound
    const code = JSON.parse(u.code || "{}");
    if (Object.keys(files).length) code[pid] = [{ at: now, files }, ...(code[pid] || [])].slice(0, KEEP); // last 2 per problem
    await env.DB.prepare("UPDATE users SET solved=?, code=? WHERE uid=?").bind(JSON.stringify([...s]), JSON.stringify(code), uid).run();
    return json({ ok: true, solved: [...s], points: s.size });
  }

  // /review: take one use atomically first, refund if the AI call fails.
  for (const k of ["problemText", "userRtl", "cycleTable"]) if (typeof b[k] !== "string" || !b[k]) return json({ error: "missing " + k }, 400);
  if ((await flagRows()).ai_review === "off") return json({ error: "The explainer is switched off for now." }, 503);
  const take = await env.DB.prepare("UPDATE users SET reviews_used=reviews_used+1 WHERE uid=? AND reviews_used<?").bind(uid, QUOTA).run();
  if (take.meta.changes !== 1) return json({ error: "No free explanations left." }, 429);
  try {
    const r = await env.AI.run(MODEL, { max_tokens: 400, messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Problem:\n${b.problemText}\n\nStudent code:\n${b.userRtl}\n\nFirst failing cycles:\n${b.cycleTable}` }] });
    const hint = clean(r?.response || "");
    if (!hint) return json({ error: "The explainer had nothing safe to say. Try again later." }, 502); // charged: refunding empty output would allow unlimited free AI calls
    await env.DB.prepare("INSERT INTO reviews (uid,at) VALUES (?,?)").bind(uid, now).run();
    const u = await env.DB.prepare("SELECT reviews_used FROM users WHERE uid=?").bind(uid).first();
    return json({ hint, reviews_left: Math.max(0, QUOTA - u.reviews_used) });
  } catch {
    await env.DB.prepare("UPDATE users SET reviews_used=reviews_used-1 WHERE uid=? AND reviews_used>0").bind(uid).run();
    return json({ error: "The explainer failed. You were not charged. Try again." }, 502);
  }
}

export default { fetch: (req, env) => handle(req, env) };
