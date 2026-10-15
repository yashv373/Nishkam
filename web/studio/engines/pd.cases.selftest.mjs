// node web/studio/engines/pd.cases.selftest.mjs [name]  (run from a folder with @yowasp/yosys in node_modules)
// Each case runs the browser flow (pd.flow.mjs) and must route with 0 failed nets. Big ones (mult10 .. rmult20) only run when named.
import { createHash } from "node:crypto";
import { flow, DESIGNS } from "./pd.flow.mjs";
import * as M from "./magic.worker.js";
import * as L from "./lvs.worker.js";
import * as S from "./opensta.worker.js";
import { retriedNets } from "./route.worker.js";
import { findShorts, shortsMessage } from "./shorts.js";
// the short finder on a made-up node: two nets on one Magic node
const fake = findShorts('merge "u1/A1" "u1/A2"\nmerge "u1/A2" "u2/ZN"', "\nNETS 2 ;\n- n1\n ( u1 A1 ) ( u3 Z ) ;\n- n2\n ( u1 A2 ) ( u2 ZN ) ;\nEND NETS");
if (fake.length !== 1 || !/Router short: u1\/A1/.test(shortsMessage(fake))) { console.log("FAIL short finder", JSON.stringify(fake)); process.exit(1); }
console.log("PASS short finder");
const rn = retriedNets("Error:  Failure to find route start node/route on net a!\nError:  Failure to find route end node/route on net b!\nError:  Failure to find route start node/route on net a!");
if (rn.join() !== "a,b") { console.log("FAIL retried nets", rn); process.exit(1); }
console.log("PASS retried nets");
// These must also match Netgen, with no router short found. pins40 is left out: an unused input's pad can sit under another net's wire
// (qrouter does not treat single-node nets as obstacles), which merges two ports in Magic.
const LVS = new Set(["twoclk", "adder", "adder2", "tiny8", "mult8"]);
const names = process.argv[2] ? [process.argv[2]] : ["twoclk", "twoclk2", "twoclk3", "adder", "adder2", "pins40", "tiny8", "mult8"];
let fail = 0;
for (const n of names) {
  const r = await flow(...DESIGNS[n]);
  let ok = r.failed === 0, lvs = "";
  if (ok && LVS.has(n)) {
    const top = DESIGNS[n][0], io = { log() {}, progress() {} };
    const mg = await M.handle({ files: r.rt.files, options: { top, extract: true, drc: false, keepExt: true, rc: n === "tiny8" } }, io);
    const lv = await L.handle({ files: { [top + ".spice"]: mg.files[top + ".spice"], [top + ".v"]: r.ct ? r.ct.files[top + "_cts.v"] : r.nl }, options: { top } }, io);
    const sh = findShorts(new TextDecoder().decode(mg.files[top + ".ext"]), new TextDecoder().decode(r.rt.files[top + "_route.def"]));
    ok = lv.summary.match === true && sh.length === 0; lvs = `, lvs ${lv.summary.match} devices ${lv.summary.devices} nets ${lv.summary.nets}`;
    if (n === "tiny8") {   // post-route STA on Magic's SPEF (escaped net names once crashed OpenSTA)
      const st = await S.handle({ files: { [top + ".v"]: r.ct.files[top + "_cts.v"], [top + ".spef"]: mg.files[top + ".spef"] }, options: { top, periodNs: 24, inputDelayNs: 4.8, outputDelayNs: 4.8, loadPf: 0.05, propagated: true } }, { ...io, log() {} });
      ok = ok && Number.isFinite(st.summary.setup_ws_ns) && Number.isFinite(st.summary.hold_ws_ns); lvs += `, post-route setup ${st.summary.setup_ws_ns} hold ${st.summary.hold_ws_ns}`;
    }
  }
  fail += !ok;
  if (!ok) console.log(r.out.split("\n").filter((l) => /^Error|Tap geometry|^Grid/.test(l)).slice(0, 12).join("\n"));
  console.log(ok ? "PASS" : "FAIL", n, `def ${createHash('md5').update(r.pl.files[DESIGNS[n][0] + '.def']).digest('hex').slice(0, 6)}, ${r.cells} cells, failed nets ${r.failed} ${r.names.join(" ")}, ${JSON.stringify(r.T)}${lvs}`);
}
process.exit(fail ? 1 : 0);
