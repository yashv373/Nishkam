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
process.exit(fail ? 1 : 0);
