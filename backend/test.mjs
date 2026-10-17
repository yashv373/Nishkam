// Usage: node test.mjs  (no wrangler needed)
import assert from "node:assert/strict";
import { verify, handle, clean } from "./src/index.js";

const PID = "nishkam-test", NOW = Math.floor(Date.now() / 1000);
const b64u = (b) => Buffer.from(b).toString("base64url");
const gen = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pair = await gen(), other = await gen();
const keys = [{ ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "RS256" }];
async function mint(over = {}, key = pair.privateKey) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const c = b64u(JSON.stringify({ iss: `https://securetoken.google.com/${PID}`, aud: PID, sub: "u1", email: "a@b.c", name: "Al", iat: NOW - 10, exp: NOW + 3600, ...over }));
  const s = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${c}`));
  return `${h}.${c}.${b64u(s)}`;
}
const rejects = async (t, why) => assert.rejects(verify(t, PID, keys), undefined, why);

// (a) token verification
assert.equal((await verify(await mint(), PID, keys)).sub, "u1");
await rejects(await mint({ aud: "x" }), "aud");
await rejects(await mint({ iss: "https://securetoken.google.com/x" }), "iss");
await rejects(await mint({ exp: NOW - 1 }), "exp");
await rejects(await mint({ sub: "" }), "sub");
await rejects(await mint({ auth_time: NOW + 9999 }), "auth_time in future");
await rejects(await mint({}, other.privateKey), "signature");

// (b) quota, flags, admin against a tiny fake D1 (only the statements the worker uses)
const rows = new Map(), flags = {}, log = [], reviews = [];
const ok = { meta: { changes: 1 } };
const db = { prepare: (sql) => ({ bind: (...a) => ({
  run: async () => {
    if (sql.startsWith("INSERT INTO users")) { rows.set(a[0], { uid: a[0], email: a[1], name: a[2], created: a[3], last_seen: a[4], solved: "[]", code: "{}", reviews_used: 0 }); return ok; }
    if (sql.startsWith("UPDATE users SET email")) { Object.assign(rows.get(a[3]), { email: a[0], name: a[1], last_seen: a[2] }); return ok; }
    if (sql.includes("reviews_used+1")) { const u = rows.get(a[0]); if (u && u.reviews_used < a[1]) { u.reviews_used++; return ok; } return { meta: { changes: 0 } }; }
    if (sql.includes("reviews_used-1")) { const u = rows.get(a[0]); if (u.reviews_used > 0) u.reviews_used--; return ok; }
    if (sql.startsWith("UPDATE users SET solved")) { Object.assign(rows.get(a[2]), { solved: a[0], code: a[1] }); return ok; }
    if (sql.startsWith("INSERT INTO flags")) { flags[a[0]] = a[1]; return ok; }
    if (sql.startsWith("INSERT INTO admin_log")) { log.push({ who: a[0], what: a[1], at: a[2] }); return ok; }
    if (sql.startsWith("INSERT INTO reviews")) { reviews.push(a[1]); return ok; }
    throw new Error("fake D1: unknown statement " + sql);
  },
  first: async () => {
    if (sql.includes("COUNT(*) total, SUM(created")) { const r = [...rows.values()]; return { total: r.length, d1: r.length, d7: r.length, d30: r.length, active7: r.length }; }
    if (sql.includes("FROM reviews")) return { total: reviews.length, today: reviews.length };
    return rows.get(a[0]);
  },
  all: async () => ({ results: sql.includes("FROM flags") ? Object.entries(flags).map(([key, value]) => ({ key, value })) : sql.includes("FROM admin_log") ? log : [...rows.values()] }),
}) }) };
let aiFail = false;
const aiText = "Your q is wrong on cycle 3.\n```verilog\nassign q = d;\n```\nassign y = a;\nLook at reset.";
const env = { DB: db, FIREBASE_PROJECT_ID: PID, ADMIN_EMAILS: "Boss@x.io, other@x.io", AI: { run: async () => { if (aiFail) throw new Error("down"); return { response: aiText }; } } };
const call = async (path, body, tok, origin = "http://localhost:8000") => handle(new Request("https://x" + path, {
  method: body ? "POST" : "GET", headers: { Origin: origin, Authorization: "Bearer " + (tok ?? await mint()) }, body: body && JSON.stringify(body) }), env, async () => keys);
const rev = { problemId: "shreg4", problemText: "p", userRtl: "r", cycleTable: "c" };

assert.equal((await call("/me", null, "garbage")).status, 401);
assert.equal((await call("/me", null, undefined, "https://evil.example")).status, 403);
assert.equal((await call("/me")).status, 200);
// old solve/points path: points = distinct solves, last 2 code versions kept
for (const v of ["a", "b", "c"]) await call("/solve", { problem: "shreg4", files: { "t.v": v } });
await call("/solve", { problem: "adder2", files: {} });
const me = await (await call("/me")).json();
assert.deepEqual(me.solved, ["shreg4", "adder2"]); assert.equal(me.points, 2); assert.equal(me.is_admin, false);
assert.deepEqual(JSON.parse(rows.get("u1").code).shreg4.map((x) => x.files["t.v"]), ["c", "b"]);
assert.equal((await call("/solve", { problem: "Bad_ID", files: {} })).status, 400);
assert.equal((await call("/solve", { problem: "x", files: { a: "y".repeat(21 * 1024) } })).status, 413);

const r1 = await call("/review", rev);
assert.equal(r1.status, 200);
const j1 = await r1.json();
assert.equal(j1.reviews_left, 1);
assert.ok(!/```|assign/.test(j1.hint) && /cycle 3/.test(j1.hint) && /reset/.test(j1.hint), "post-filter: " + j1.hint);
aiFail = true;
assert.equal((await call("/review", rev)).status, 502);
assert.equal(rows.get("u1").reviews_used, 1, "refunded after AI failure");
aiFail = false;
assert.equal((await call("/review", rev)).status, 200);
assert.equal((await call("/review", rev)).status, 429, "3rd review refused");
assert.equal((await call("/review", { ...rev, userRtl: "x".repeat(21 * 1024) })).status, 413);
assert.equal(clean("a\n```\nb"), "a");
// admin and flags
assert.equal((await call("/admin/stats")).status, 403, "non-admin");
assert.equal((await call("/admin/flags", { key: "ai_review", value: "off" })).status, 403);
const unver = await mint({ sub: "adm", email: "boss@x.io", email_verified: false });
assert.equal((await call("/admin/stats", null, unver)).status, 403, "unverified email");
const adm = await mint({ sub: "adm", email: "boss@x.io", email_verified: true });
assert.equal((await (await call("/me", null, adm)).json()).is_admin, true);
const st = await (await call("/admin/stats", null, adm)).json();
assert.equal(st.users, 2); assert.equal(st.solves.perProblem.shreg4, 1); assert.equal(st.reviews.total, 2);
assert.equal((await call("/admin/flags", { key: "nope", value: "on" }, adm)).status, 400);
assert.equal((await call("/admin/flags", { key: "ai_review", value: "off" }, adm)).status, 200);
assert.equal((await call("/admin/flags", { key: "banner", value: "Hello" }, adm)).status, 200);
assert.equal(log.length, 2);
const fl = await handle(new Request("https://x/flags", { headers: { Origin: "https://nishkam.world" } }), env, async () => keys);
assert.deepEqual(await fl.json(), { ai_review: "off", signups: "on", studio: "on", banner: "Hello" });
assert.match(fl.headers.get("cache-control"), /max-age=60/);
rows.get("u1").reviews_used = 0;
assert.equal((await call("/review", rev)).status, 503, "ai_review off refuses");
assert.equal(rows.get("u1").reviews_used, 0, "no quota spent while off");
await call("/admin/flags", { key: "signups", value: "off" }, adm);
assert.equal((await call("/me", null, await mint({ sub: "newbie" }))).status, 403, "signups off blocks new uid");
assert.equal((await call("/me")).status, 200, "existing uid still fine");
// (c) private deck from a fake R2
let deck = "<h1>deck</h1>";
env.PRIVATE = { get: async (k) => (k === "pitch.html" && deck != null ? deck : null) };
const user = await mint({ sub: "u1" });
assert.equal((await call("/admin/deck", null, user)).status, 403, "non-admin deck");
const dr = await call("/admin/deck", null, adm);
assert.equal(dr.status, 200); assert.equal(await dr.text(), deck);
assert.match(dr.headers.get("content-type"), /text\/html/);
assert.equal(dr.headers.get("cache-control"), "no-store");
assert.equal(dr.headers.get("x-robots-tag"), "noindex");
assert.match(dr.headers.get("content-security-policy"), /frame-ancestors 'none'/);
deck = null;
assert.equal((await call("/admin/deck", null, adm)).status, 404, "missing deck");
console.log("backend: all tests passed");
