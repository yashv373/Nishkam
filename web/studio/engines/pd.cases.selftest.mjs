// node web/studio/engines/pd.cases.selftest.mjs [name]  (run from a folder with @yowasp/yosys in node_modules)
// Each case runs the browser flow (pd.flow.mjs) and must route with 0 failed nets. Big ones (mult10 .. rmult20) only run when named.
import { createHash } from "node:crypto";
import { flow, DESIGNS } from "./pd.flow.mjs";
import * as M from "./magic.worker.js";
import * as L from "./lvs.worker.js";
// These must also match Netgen (no router shorts). pins40 is left out: its 40 pads still fail LVS on pin matching.
const LVS = new Set(["twoclk", "adder", "adder2", "tiny8", "mult8"]);
const names = process.argv[2] ? [process.argv[2]] : ["twoclk", "twoclk2", "twoclk3", "adder", "adder2", "pins40", "tiny8", "mult8"];
let fail = 0;
for (const n of names) {
  const r = await flow(...DESIGNS[n]);
  let ok = r.failed === 0, lvs = "";
  if (ok && LVS.has(n)) {
    const top = DESIGNS[n][0], io = { log() {}, progress() {} };
    const mg = await M.handle({ files: r.rt.files, options: { top, extract: true, drc: false } }, io);
    const lv = await L.handle({ files: { [top + ".spice"]: mg.files[top + ".spice"], [top + ".v"]: r.ct ? r.ct.files[top + "_cts.v"] : r.nl }, options: { top } }, io);
    ok = lv.summary.match === true; lvs = `, lvs ${lv.summary.match} devices ${lv.summary.devices} nets ${lv.summary.nets}`;
  }
  fail += !ok;
  if (!ok) console.log(r.out.split("\n").filter((l) => /^Error|Tap geometry|^Grid/.test(l)).slice(0, 12).join("\n"));
  console.log(ok ? "PASS" : "FAIL", n, `def ${createHash('md5').update(r.pl.files[DESIGNS[n][0] + '.def']).digest('hex').slice(0, 6)}, ${r.cells} cells, failed nets ${r.failed} ${r.names.join(" ")}, ${JSON.stringify(r.T)}${lvs}`);
}
process.exit(fail ? 1 : 0);
