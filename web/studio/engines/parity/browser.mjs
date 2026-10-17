// Browser-flow side of the parity check. Run from the repo root (needs node_modules/@yowasp/yosys):
//   node web/studio/engines/parity/browser.mjs <design> [outdir]    -> writes <outdir>/<design>.browser.json (+ netlist/DEF files)
// <design> is a key of DESIGNS in ../pd.flow.mjs (tiny8, mult8, adder2, mult10, ...).
import { flow, DESIGNS } from "../pd.flow.mjs";
import * as M from "../magic.worker.js";
import * as L from "../lvs.worker.js";
import * as S from "../opensta.worker.js";
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const name = process.argv[2] || "tiny8", out = process.argv[3] || "parity-out";
mkdirSync(out, { recursive: true });
const io = { log() {}, progress() {} };
const [top, src] = DESIGNS[name];
const t0 = Date.now();
const r = await flow(top, src);
const clocked = !!r.ct;
const nl = clocked ? r.ct.files[top + "_cts.v"] : r.nl;

// cell area from the same liberty Studio uses
const lib = gunzipSync(readFileSync(new URL("../../../vendor/gf180mcu/lib-tt5v0-full/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.lib.gz", import.meta.url))).toString();
const area = {}; for (const m of lib.matchAll(/cell\s*\(\s*"?(\w+)"?\s*\)\s*\{\s*area\s*:\s*([\d.]+)/g)) area[m[1]] = +m[2];
const cells = [...String(nl).matchAll(/^\s*(gf180mcu_fd_sc_mcu7t5v0__\w+)\s+(\S+)\s*\(/gm)].filter((m) => !/__(fill|endcap|tap)/.test(m[1]));
const cellArea = cells.reduce((s, m) => s + (area[m[1]] || 0), 0);
const clkbufs = cells.filter((m) => /__clkbuf/.test(m[1])).length;

const rdef = new TextDecoder().decode(r.rt.files[top + "_route.def"]);
const dbu = +rdef.match(/UNITS DISTANCE MICRONS (\d+)/)[1];
const die = rdef.match(/DIEAREA \( (-?\d+) (-?\d+) \) \( (-?\d+) (-?\d+) \)/).slice(1).map((x) => +x / dbu);
const dieArea = (die[2] - die[0]) * (die[3] - die[1]);
// wirelength / vias from the routed DEF: NEW/ROUTED segments "( x y ) ( x2 y2 )" with * for an unchanged coordinate, then a via name
let wl = 0, vias = 0;
const nets = rdef.slice(rdef.indexOf("\nNETS"), rdef.indexOf("END NETS"));
for (const line of nets.split("\n")) {
  if (!/ROUTED|NEW/.test(line)) continue;
  const pts = [...line.matchAll(/\(\s*(\*|-?\d+)\s+(\*|-?\d+)\s*(?:\d+\s*)?\)/g)];
  let px = null, py = null;
  for (const p of pts) {
    const x = p[1] === "*" ? px : +p[1], y = p[2] === "*" ? py : +p[2];
    if (px !== null) wl += Math.abs(x - px) + Math.abs(y - py);
    px = x; py = y;
  }
  vias += (line.match(/\sVia\w+/g) || []).length;
}
wl /= dbu;

const mg = await M.handle({ files: r.rt.files, options: { top, extract: true, drc: true, keepExt: true, rc: clocked } }, io);
const lv = await L.handle({ files: { [top + ".spice"]: mg.files[top + ".spice"], [top + ".v"]: nl }, options: { top } }, io);
let sta = null;
if (clocked) {
  const st = await S.handle({ files: { [top + ".v"]: nl, [top + ".spef"]: mg.files[top + ".spef"] }, options: { top, clockPort: "clk", periodNs: 24, inputDelayNs: 4.8, outputDelayNs: 4.8, loadPf: 0, propagated: true } }, io);
  sta = st.summary;
}
const res = {
  design: name, cells: cells.length, cellArea, dieW: die[2] - die[0], dieH: die[3] - die[1], dieArea, util: cellArea / dieArea,
  setupWs: sta?.setup_ws_ns, setupTns: sta?.setup_tns_ns, holdWs: sta?.hold_ws_ns, holdTns: sta?.hold_tns_ns,
  skew: r.ct?.summary.skew_ns ?? null, ctsBufs: clkbufs, ctsReportBufs: r.ct?.summary.clkbufs ?? null, sinks: r.ct?.summary.sinks ?? null,
  wirelength: wl, vias, failedNets: r.failed, drc: mg.summary.drcErrors, drcInCells: mg.summary.drcInCells, drcFromLayout: mg.summary.drcFromLayout,
  lvs: lv.summary.match, lvsDevices: lv.summary.devices, lvsNets: lv.summary.nets, power_uW: sta?.total_uW ?? null,
  defMd5: (await import("node:crypto")).createHash("md5").update(r.pl.files[top + ".def"]).digest("hex").slice(0, 8),
  routeMd5: (await import("node:crypto")).createHash("md5").update(rdef).digest("hex").slice(0, 8), seconds: (Date.now() - t0) / 1000,
};
writeFileSync(`${out}/${name}.browser.json`, JSON.stringify(res, null, 1));
writeFileSync(`${out}/${name}.synth.v`, r.nl);
writeFileSync(`${out}/${name}_route.def`, rdef); writeFileSync(`${out}/${name}.final.v`, nl);
console.log(JSON.stringify(res));
process.exit(0);
