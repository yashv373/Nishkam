// Runs the worker under `wrangler dev --local` with a throwaway DB and fake login. Usage: node test.mjs
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const PORT = 8799, B = `http://127.0.0.1:${PORT}`, sh = process.platform === "win32";
const hadVars = existsSync(".dev.vars");
if (!hadVars) writeFileSync(".dev.vars", "SESSION_SECRET=test-secret\nFRONTEND_URL=http://localhost:8000/app.html\nDEV_FAKE_LOGIN=1\n");
const persist = "--persist-to=.wrangler/test-state";
rmSync(".wrangler/test-state", { recursive: true, force: true });
const r = spawnSync("npx", ["wrangler", "d1", "execute", "nishkam", "--local", persist, "--file=schema.sql"], { shell: sh, encoding: "utf8" });
assert.equal(r.status, 0, r.stdout + r.stderr);
const srv = spawn("npx", ["wrangler", "dev", "--local", persist, "--port", String(PORT)], { shell: sh, stdio: "ignore" });
const stop = () => { if (sh) spawnSync("taskkill", ["/pid", srv.pid, "/t", "/f"]); else srv.kill(); if (!hadVars) rmSync(".dev.vars"); };

try {
  for (let i = 0; ; i++) {
    try { await fetch(B + "/me"); break; } catch { if (i > 120) throw new Error("server did not start"); await new Promise((r) => setTimeout(r, 500)); }
  }
  const ok = "http://localhost:8000";
  const post = (cookie, body, origin = ok) => fetch(B + "/solve", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body });

  assert.equal((await fetch(B + "/me")).status, 401, "/me without cookie");

  const login = await fetch(B + "/dev/login?name=alice", { redirect: "manual" });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("nk_session="));
  assert.ok(cookie, "session cookie");
  assert.match(login.headers.getSetCookie().join("\n"), /HttpOnly; Secure; SameSite=Lax/);

  assert.equal((await fetch(B + "/me", { headers: { Cookie: cookie + "x" } })).status, 401, "tampered cookie");

  const s = JSON.stringify({ problem: "shreg4", files: { "a.v": "module a; endmodule" } });
  assert.equal((await post(cookie, s)).status, 200);
  assert.equal((await post(cookie, s)).status, 200);
  const me = await (await fetch(B + "/me", { headers: { Cookie: cookie } })).json();
  assert.equal(me.points, 1, "solve twice = 1 point");
  assert.deepEqual(me.solved, ["shreg4"]);

  assert.equal((await post(cookie, JSON.stringify({ problem: "Bad_ID", files: {} }))).status, 400, "bad id");
  assert.equal((await post(cookie, JSON.stringify({ problem: "x", files: { a: "y".repeat(51 * 1024) } }))).status, 413, "too big");

  const evil = await fetch(B + "/me", { headers: { Cookie: cookie, Origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get("access-control-allow-origin"), null, "evil origin gets no CORS");
  const good = await fetch(B + "/me", { headers: { Cookie: cookie, Origin: "https://nishkam.world" } });
  assert.equal(good.headers.get("access-control-allow-origin"), "https://nishkam.world");
  assert.equal(good.headers.get("access-control-allow-credentials"), "true");
  assert.equal((await fetch(B + "/solve", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status, 403);
  console.log("backend: all tests passed");
} catch (e) { console.error(e); process.exitCode = 1; } finally { stop(); }
