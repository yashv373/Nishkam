// No plaintext keys in the repo: pass them as NISHKAM_KEYS="k1,k2,k3" (same order as the table) to test the real keys.
import assert from "node:assert/strict";
import { check, KEYS } from "./gate.js";
const msgs = Object.values(KEYS);
assert.equal(msgs.length, 3);
assert.ok(Object.keys(KEYS).every((h) => /^[0-9a-f]{64}$/.test(h)));
assert.equal(await check("000000"), null); assert.equal(await check(""), null);
const ks = (process.env.NISHKAM_KEYS || "").split(",").filter(Boolean);
for (const [i, k] of ks.entries()) assert.equal(await check(" " + k + " "), msgs[i]);
console.log("gate ok" + (ks.length ? "" : " (set NISHKAM_KEYS to also test the real keys)"));
