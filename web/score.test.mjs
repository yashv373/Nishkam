// node web/score.test.mjs  (run from a folder where @yowasp/yosys@0.68.1207 is installed, like grader.test.mjs)
// Synthesizes every RTL problem's reference onto gf180 and prints area + fmax (the numbers `stretch` is based on).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PROBLEMS } from "./problems.js";
import { scoreDesign, stretchResults } from "./score.js";

globalThis.__yosysModule = await import(pathToFileURL(createRequire(process.cwd() + "/").resolve("@yowasp/yosys")).href);
const Y = await import("./studio/engines/yosys.worker.js"), S = await import("./studio/engines/opensta.worker.js");
const cb = { log() {}, progress() {} };
const deps = { synth: (r) => Y.handle(r, cb), sta: (r) => S.handle(r, cb) };

for (const p of PROBLEMS.filter((p) => p.kind === "rtl")) {
  const r = await scoreDesign(p.top, p.reference, deps);
  assert.ok(!r.error, `${p.id}: ${r.error}`);
  assert.ok(r.areaUm2 > 0 && r.fmaxMhz > 0, p.id);
  console.log(p.id.padEnd(14), "area", r.areaUm2.toFixed(1), "um2  fmax", r.fmaxMhz, "MHz  slack", r.slackNs, p.stretch ? JSON.stringify(stretchResults(p.stretch, r)) : "");
}
// nothing to time (constant output): must say "no path", not invent a number
const none = await scoreDesign("c", "module c(input clk, output y); assign y = 1'b1; endmodule", deps);
console.log("no-path", JSON.stringify(none)); assert.equal(none.fmaxMhz, null);
console.log("PASS");
