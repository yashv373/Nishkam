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
const avs = new Map(), alog = [], rows = new Map(), flags = {}, log = [], reviews = [];
const ok = { meta: { changes: 1 } };
const db = { prepare: (sql) => ({ bind: (...a) => ({
  run: async () => {
    if (sql.startsWith("INSERT INTO users")) { rows.set(a[0], { uid: a[0], email: a[1], name: a[2], created: a[3], last_seen: a[4], handle: a[5], solved: "[]", code: "{}", reviews_used: 0 }); return ok; }
    if (sql.startsWith("UPDATE users SET email")) { Object.assign(rows.get(a[3]), { email: a[0], name: a[1], last_seen: a[2] }); return ok; }
    if (sql.includes("reviews_used+1")) { const u = rows.get(a[0]); if (u && u.reviews_used < a[1]) { u.reviews_used++; return ok; } return { meta: { changes: 0 } }; }
    if (sql.includes("reviews_used-1")) { const u = rows.get(a[0]); if (u.reviews_used > 0) u.reviews_used--; return ok; }
    if (sql.startsWith("UPDATE users SET solved")) { Object.assign(rows.get(a[2]), { solved: a[0], code: a[1] }); return ok; }
    if (sql.startsWith("UPDATE users SET bio")) { rows.get(a[1]).bio = a[0]; return ok; }
    if (sql.startsWith("UPDATE users SET handle")) { if ([...rows.values()].some((r) => r.handle === a[0] && r.uid !== a[1])) throw new Error("UNIQUE"); rows.get(a[1]).handle = a[0]; return ok; }
    if (sql.startsWith("UPDATE users SET display_name")) { rows.get(a[1]).display_name = a[0]; return ok; }
    if (sql.startsWith("INSERT INTO avatars")) { avs.set(a[0], { img: Array.from(new Uint8Array(a[1])), type: a[2], v: a[3] }); return ok; }
    if (sql.startsWith("UPDATE users SET avatar_v=NULL")) { rows.get(a[0]).avatar_v = null; return ok; }
    if (sql.startsWith("UPDATE users SET avatar_v")) { rows.get(a[1]).avatar_v = a[0]; return ok; }
    if (sql.startsWith("DELETE FROM avatars")) { avs.delete(a[0]); return ok; }
    if (sql.startsWith("INSERT INTO avatar_log")) { alog.push({ uid: a[0], at: a[1] }); return ok; }
    if (sql.startsWith("DELETE FROM avatar_log")) { return ok; }
    if (sql.startsWith("INSERT INTO flags")) { flags[a[0]] = a[1]; return ok; }
    if (sql.startsWith("INSERT INTO admin_log")) { log.push({ who: a[0], what: a[1], at: a[2] }); return ok; }
    if (sql.startsWith("INSERT INTO reviews")) { reviews.push(a[1]); return ok; }
    throw new Error("fake D1: unknown statement " + sql);
  },
  first: async () => {
    if (sql.includes("COUNT(*) total, SUM(created")) { const r = [...rows.values()]; return { total: r.length, d1: r.length, d7: r.length, d30: r.length, active7: r.length }; }
    if (sql.includes("FROM avatars")) return avs.get(a[0]) || null;
    if (sql.includes("FROM avatar_log")) return { n: alog.filter((l) => l.uid === a[0] && l.at > a[1]).length };
    if (sql.includes("FROM reviews")) return { total: reviews.length, today: reviews.length };
    if (sql.includes("WHERE handle=")) return [...rows.values()].find((r) => r.handle === a[0]);
    return rows.get(a[0]);
  },
  all: async () => ({ results: sql.includes("FROM flags") ? Object.entries(flags).map(([key, value]) => ({ key, value })) : sql.includes("FROM admin_log") ? log : [...rows.values()] }),
}) }) };
let aiFail = false;
const aiText = "Your q is wrong on cycle 3.\n```verilog\nassign q = d;\n```\nassign y = a;\nLook at reset.";
const env = { DB: db, FIREBASE_PROJECT_ID: PID, ADMIN_EMAILS: "Boss@x.io, other@x.io", AI: { run: async () => { if (aiFail) throw new Error("down"); return { response: aiText }; } } };
const call = async (path, body, tok, origin = "http://localhost:8000") => handle(new Request("https://x" + path, {
  method: body ? "POST" : "GET", headers: { Origin: origin, Authorization: "Bearer " + (tok ?? await mint()) }, body: body && JSON.stringify(body) }), env, async () => keys);
const raw = (path, method, bytes, tok) => handle(new Request("https://x" + path, { method, headers: { Origin: "http://localhost:8000", Authorization: "Bearer " + (tok ?? "") }, body: bytes }), env, async () => keys);
const rev = { problemId: "shreg4", problemText: "p", userRtl: "r", cycleTable: "c" };

assert.equal((await call("/me", null, "garbage")).status, 401);
assert.equal((await call("/me", null, undefined, "https://evil.example")).status, 403);
const me0 = await (await call("/me")).json();
assert.equal(me0.handle, "a_usr", "default handle from email local part, padded to 3+");
assert.equal((await (await call("/me", null, await mint({ sub: "d1", email: "A.B@x.io" }))).json()).handle, "a_b");
assert.equal((await (await call("/me", null, await mint({ sub: "d2", email: "a.b@y.io" }))).json()).handle, "a_b2", "digit added when taken");
assert.equal((await call("/me/handle", { handle: "Bad Name" })).status, 400);
assert.equal((await call("/me/handle", { handle: "a_b" })).status, 409, "taken");
assert.equal((await call("/me/handle", { handle: "al_1" })).status, 200);
assert.equal((await call("/me/handle", { handle: "al_1" })).status, 200, "own handle is fine");
assert.equal((await (await call("/me")).json()).handle, "al_1");
// bio: cap 160, control chars stripped, saved, returned by /me
assert.equal((await (await call("/me")).json()).bio, "", "empty bio by default");
assert.equal((await call("/me/bio", { bio: "x".repeat(161) })).status, 400, "bio cap");
assert.equal((await call("/me/bio", { bio: 5 })).status, 400);
assert.equal((await call("/me/bio", { bio: "x".repeat(160) })).status, 200, "160 is fine");
assert.equal((await (await call("/me/bio", { bio: "  RTL\u0000 and\nSTA \u0007 " })).json()).bio, "RTL  and STA", "control chars stripped");
assert.equal((await (await call("/me")).json()).bio, "RTL  and STA", "bio returned by /me");
// display name: 1-40 chars, trimmed, control chars stripped; overrides the Google name
assert.equal((await call("/me/name", { name: "   " })).status, 400, "blank name");
assert.equal((await call("/me/name", { name: "\u0001\u0002" })).status, 400, "only control chars");
assert.equal((await call("/me/name", { name: "n".repeat(41) })).status, 400, "41 chars");
assert.equal((await call("/me/name", { name: 5 })).status, 400);
assert.equal((await call("/me/name", { name: "n".repeat(40) })).status, 200, "40 is fine");
assert.equal((await (await call("/me/name", { name: "  Zed\u0001 Q \n" })).json()).name, "Zed Q");
const meN = await (await call("/me")).json();
assert.deepEqual([meN.name, meN.display_name, meN.avatar_url], ["Zed Q", "Zed Q", null], "/me uses display name; no avatar yet");
// avatar: WebP or JPEG, <= 16 KB, 5 changes a day, public GET with cache headers
const pic = (head, n) => { const b = new Uint8Array(n); b.set(head); return b; };
const RW = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")];
const webp = pic(RW, 3000), jpeg = pic([0xff, 0xd8, 0xff, 0xe0], 2000);
const mint1 = await mint();
const postT = (b) => raw("/me/avatar", "POST", b, mint1);
assert.equal((await postT(webp)).status, 200, "webp accepted");
const up = await postT(jpeg); assert.equal(up.status, 200, "jpeg accepted");
const av1 = (await up.json()).avatar_url; assert.match(av1, /^https:\/\/x\/avatar\/u1\.webp\?v=\d+$/);
assert.equal((await postT(pic(RW, 16 * 1024))).status, 200, "exactly 16 KB ok");
assert.equal((await postT(pic(RW, 16 * 1024 + 1))).status, 413, ">16 KB");
assert.equal((await postT(pic([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], 500))).status, 415, "PNG");
assert.equal((await postT(crypto.getRandomValues(new Uint8Array(500)).fill(7, 0, 4))).status, 415, "random bytes");
assert.equal((await postT(new Uint8Array(0))).status, 415, "empty");
assert.equal((await raw("/me/avatar", "POST", webp, "garbage")).status, 401, "needs sign-in");
assert.equal((await postT(webp)).status, 200); assert.equal((await postT(jpeg)).status, 200, "5th is fine"); assert.equal((await postT(webp)).status, 429, "6th change in a day");
const g = await raw("/avatar/u1.webp", "GET", undefined, "");
assert.equal(g.status, 200, "public: no sign-in needed");
assert.equal(g.headers.get("content-type"), "image/jpeg", "type follows the magic bytes of the last upload");
assert.match(g.headers.get("cache-control"), /max-age=86400/);
assert.deepEqual([...new Uint8Array(await g.arrayBuffer())].slice(0, 4), [0xff, 0xd8, 0xff, 0xe0], "bytes round trip");
const etag = g.headers.get("etag"); assert.ok(etag);
assert.equal((await handle(new Request("https://x/avatar/u1.webp", { headers: { "If-None-Match": etag } }), env, async () => keys)).status, 304, "etag");
assert.equal((await raw("/avatar/nobody.webp", "GET", undefined, "")).status, 404);
assert.match((await (await call("/me")).json()).avatar_url, /avatar\/u1\.webp\?v=/);
const lbA = await (await call("/leaderboard")).json();
assert.deepEqual([lbA.rows[0].display_name, lbA.rows[0].first_name], ["Zed Q", "Zed"], "leaderboard uses display name");
assert.match(lbA.rows[0].avatar_url, /avatar\/u1\.webp/);
assert.ok(!/@|email/.test(JSON.stringify(lbA)), "no emails");
assert.equal((await raw("/me/avatar", "DELETE", undefined, mint1)).status, 200);
assert.equal((await raw("/avatar/u1.webp", "GET", undefined, "")).status, 404, "deleted");
assert.equal((await (await call("/me")).json()).avatar_url, null);
// old solve/points path: points = distinct solves, last 2 code versions kept
for (const v of ["a", "b", "c"]) await call("/solve", { problem: "shreg4", files: { "t.v": v } });
await call("/solve", { problem: "adder2", files: {} });
const me = await (await call("/me")).json();
assert.deepEqual(me.solved, ["shreg4", "adder2"]); assert.equal(me.points, 2); assert.equal(me.is_admin, false);
assert.deepEqual(JSON.parse(rows.get("u1").code).shreg4.map((x) => x.files["t.v"]), ["c", "b"]);
// rank with ties: u1 has 2; d1 solves 2 (tie), d2 none
await call("/solve", { problem: "p1" }, await mint({ sub: "d1", email: "A.B@x.io" })); await call("/solve", { problem: "p2" }, await mint({ sub: "d1", email: "A.B@x.io" }));
const meR = await (await call("/me")).json(), meD1 = await (await call("/me", null, await mint({ sub: "d1", email: "A.B@x.io" }))).json(), meD2 = await (await call("/me", null, await mint({ sub: "d2", email: "a.b@y.io" }))).json();
assert.deepEqual([meR.rank, meD1.rank, meD2.rank, meR.total_users], [1, 1, 3, 3], "ties share a rank");
const lb = await (await call("/leaderboard")).json();
assert.deepEqual(lb.rows.map((r) => [r.rank, r.points]), [[1, 2], [1, 2], [3, 0]]);
assert.equal(lb.rows[0].handle, "al_1", "earlier created wins tie-break");
assert.ok(!/@|email/.test(JSON.stringify(lb)), "no emails in leaderboard");
assert.equal((await call("/leaderboard", null, "garbage")).status, 401);
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
assert.equal(st.users, 4); assert.equal(st.solves.perProblem.shreg4, 1); assert.equal(st.reviews.total, 2);
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
