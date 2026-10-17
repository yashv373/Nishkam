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
await rejects(await mint({}, other.privateKey), "signature");

// (b) quota against a tiny fake D1 (only the statements the worker uses)
const rows = new Map();
const db = { prepare: (sql) => ({ bind: (...a) => ({
  run: async () => {
    if (sql.startsWith("INSERT")) { if (!rows.has(a[0])) rows.set(a[0], { uid: a[0], email: a[1], name: a[2], created: a[3], solved: "[]", reviews_used: 0 }); return { meta: { changes: 1 } }; }
    if (sql.includes("reviews_used+1")) { const u = rows.get(a[0]); if (u && u.reviews_used < a[1]) { u.reviews_used++; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
    if (sql.includes("reviews_used-1")) { const u = rows.get(a[0]); if (u.reviews_used > 0) u.reviews_used--; return { meta: { changes: 1 } }; }
    if (sql.startsWith("UPDATE users SET solved")) { rows.get(a[1]).solved = a[0]; return { meta: { changes: 1 } }; }
    throw new Error("fake D1: unknown statement " + sql);
  },
  first: async () => rows.get(a[0]),
}) }) };
let aiFail = false;
const aiText = "Your q is wrong on cycle 3.\n```verilog\nassign q = d;\n```\nassign y = a;\nLook at reset.";
const env = { DB: db, FIREBASE_PROJECT_ID: PID, AI: { run: async () => { if (aiFail) throw new Error("down"); return { response: aiText }; } } };
const call = async (path, body, tok, origin = "http://localhost:8000") => handle(new Request("https://x" + path, {
  method: body ? "POST" : "GET", headers: { Origin: origin, Authorization: "Bearer " + (tok ?? await mint()) }, body: body && JSON.stringify(body) }), env, async () => keys);
const rev = { problemId: "shreg4", problemText: "p", userRtl: "r", cycleTable: "c" };

assert.equal((await call("/me", null, "garbage")).status, 401);
assert.equal((await call("/me", null, undefined, "https://evil.example")).status, 403);
assert.equal((await call("/me")).status, 200);
await call("/me/solved", { problemId: "shreg4" });
assert.deepEqual((await (await call("/me")).json()).solved, ["shreg4"]);

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
console.log("backend: all tests passed");
