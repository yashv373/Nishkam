// Headless check: node web/studio/engines/selftest.node.mjs  (needs `npm i @yowasp/yosys@0.68.1207 verilator-wasm` in cwd)
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { files, rtl, checks } from "./selftest-fixtures.js";

const noop = { log() {}, progress() {} };
const req = createRequire(process.cwd() + "/");
const yw = await import(pathToFileURL(req.resolve("@yowasp/yosys")).href);
globalThis.__yosysModule = yw;
globalThis.__verilatorModule = await import(pathToFileURL(req.resolve("verilator-wasm")).href);
const Y = await import("./yosys.worker.js"), V = await import("./verilator-lint.worker.js");
const I = await import("./icarus.worker.js"), N = await import("./netlistsvg.worker.js");

let fail = 0;
const t = async (name, check, f) => {
  try { const r = await f(); const ok = check(r); if (!ok) console.log(JSON.stringify(r.summary).slice(0, 400)); console.log(ok ? "PASS" : "FAIL", name); fail += !ok; return r; }
  catch (e) { console.log("FAIL", name, e.message); fail++; }
};
await t("yosys lint", checks.lint, () => Y.handle({ mode: "lint", files: rtl }, noop));
await t("verilator lint", checks.verilator, () => V.handle({ files: rtl }, noop));
const sim = await t("icarus sim", checks.sim, () => I.handle({ files }, noop));
const s = await t("yosys synth", checks.synth, () => Y.handle({ mode: "synth", files: rtl, options: { top: "counter" } }, noop));
if (s) await t("netlistsvg", checks.schematic, () => N.handle({ files: { "rtl.json": s.files["rtl.json"] } }, noop));
await t("yosys lint catches error", (r) => !r.ok && r.summary.errors > 0, () => Y.handle({ mode: "lint", files: { "bad.v": "module m(; endmodule" } }, noop));

// --- LibreLane-flow synthesis checks, lint top check, sim limits ---
await t("synth maps latch to gf180 latq", (r) => r.ok && r.summary.kinds.some(([k]) => k.startsWith("latq")), () => Y.handle({ mode: "synth", files: { "l.v": "module l(input en, d, output reg q); always @* if (en) q = d; endmodule" }, options: { top: "l" } }, noop));
await t("synth fails on undeclared net with file:line", (r) => !r.ok && r.summary.messages.some((m) => m.file === "ty.v" && m.line === 1), () => Y.handle({ mode: "synth", files: { "ty.v": "module ty(input clk, d, output reg q); always @(posedge clk) q <= dd; endmodule" }, options: { top: "ty" } }, noop));
await t("synth fails on undriven net", (r) => !r.ok && r.summary.messages.some((m) => /no driver/.test(m.text)), () => Y.handle({ mode: "synth", files: { "u.v": "module u(input a, output y); wire w; assign y = a & w; endmodule" }, options: { top: "u" } }, noop));
await t("stat parsed (cells + kinds)", (r) => r.summary.cells > 0 && r.summary.kinds.length > 0, () => Y.handle({ mode: "synth", files: rtl, options: { top: "counter" } }, noop));
await t("synth dontUse is honoured", (r) => r.ok && !r.summary.kinds.some(([k]) => k === "xor2_1"), () => Y.handle({ mode: "synth", files: rtl, options: { top: "counter", dontUse: ["gf180mcu_fd_sc_mcu7t5v0__xor2_1"] } }, noop));
await t("lint: missing top is reported", (r) => !r.ok && /not found/.test(r.summary.messages[0].text), () => Y.handle({ mode: "lint", files: rtl, options: { top: "nope" } }, noop));
await t("sim: free-running clock stops with a clear message", (r) => !r.ok && /did not finish/.test(r.summary.error), () => I.handle({ files: { "t.v": "module t; reg c=0; always #5 c=~c; endmodule" }, options: { maxSimTime: 1000 } }, noop));
await t("sim: errors show the real file name", (r) => !r.ok && /bad_tb\.v/.test(r.summary.error) && !/\/f\d/.test(r.summary.error), () => I.handle({ files: { "bad_tb.v": "module t; initial begin x = ; end endmodule" } }, noop));

if (s) console.log(JSON.stringify(s.summary).slice(0, 300));

// --- names: every instance OpenSTA reports in max.rpt must be a cell key in netlist.json (worst-path highlighting relies on it) ---
{
  const O = await import("./opensta.worker.js"), { parseSta } = await import("../viewers/sta-parser.js"), { PROBLEMS } = await import("../../problems.js");
  const shreg4 = "module shreg4(input clk, rst_n, din, output dout); reg [3:0] s; always @(posedge clk or negedge rst_n) if (!rst_n) s <= 0; else s <= {s[2:0], din}; assign dout = s[3]; endmodule";
  const designs = [["shreg4", { "shreg4.v": shreg4 }], ["tiny8", PROBLEMS.find((p) => p.id === "squeeze-tiny8").files]];
  for (const [top, fs] of designs) await t("names: STA instances are netlist.json cells, " + top, (r) => r === true, async () => {
    const y = await Y.handle({ mode: "synth", files: fs, options: { top } }, noop);
    const nl = JSON.parse(y.files["netlist.json"]), ms = Object.values(nl.modules), cells = (ms.find((m) => Number(m.attributes?.top) === 1) || ms[0]).cells;
    const st = await O.handle({ files: { [top + ".v"]: y.files["netlist.v"] }, options: { top, clockPort: "clk", periodNs: 10, inputDelayNs: 2, outputDelayNs: 2, loadPf: 0.05 } }, noop);
    const insts = new Set(parseSta(st.files["max.rpt"]).flatMap((p) => p.rows.filter((r) => r.pin.includes("/")).map((r) => r.pin.slice(0, r.pin.lastIndexOf("/")).replace(/\\/g, ""))));
    const bad = [...insts].filter((i) => !(i in cells)); if (bad.length) console.log("missing", bad.slice(0, 5));
    const { pathModel, pathToRtl, cellSrcMap, segsOverlap } = await import("../stages.js"), ps = parseSta(st.files["max.rpt"]), wp = ps.find((p) => p.kind === "data");
    const pm = pathModel(wp, y.files["netlist.json"]), { segs } = pathToRtl(pm, cellSrcMap(y.files["netlist.json"])), rtlHit = [...cellSrcMap(y.files["rtl.json"])].filter(([, c]) => segsOverlap(c.segs, segs)).length;
    console.log("  ", top, "worst data path", wp.start, "->", wp.end, pm.insts.length, "cells,", rtlHit, "RTL cells lit");
    return insts.size > 0 && !bad.length && wp && pm.insts.length > 0 && rtlHit > 0;
  });
}
process.exit(fail ? 1 : 0);
