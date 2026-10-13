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

// --- timing + power (sta.worker.js); golden numbers are OpenSTA 3.x on the same netlist + full liberty (period 10, slew 0.1, load 0.01) ---
const St = await import("./sta.worker.js");
const near = (a, b, tol) => Math.abs(a - b) <= tol;
if (s) {
  const nl = { "netlist.json": s.files["netlist.json"] }, so = { top: "counter", clockPort: "clk", periodNs: 10 };
  await t("sta counter setup slack = OpenSTA 7.7787", (r) => near(r.summary.setup.worst_slack_ns, 7.7787, 0.05) && r.files["timing.rpt"].includes("SETUP") && !!r.files["timing.json"], () => St.handle({ mode: "sta", files: nl, options: so }, noop));
  const vcd = sim && Object.entries(sim.files).find(([k]) => k.endsWith(".vcd"));
  await t("power counter (+VCD)", (r) => r.summary.power.total_uW > 0 && /^VCD/.test(r.summary.power.activitySource) && r.files["power.rpt"].includes("ESTIMATE"), () => St.handle({ mode: "power", files: { ...nl, ...(vcd ? { "dump.vcd": vcd[1] } : {}) }, options: { ...so, periodNs: 10 } }, noop));
}
const sh = await Y.handle({ mode: "synth", files: { "shreg4.v": "module shreg4(input clk, rst_n, d, output [3:0] q); reg [3:0] r; always @(posedge clk or negedge rst_n) if (!rst_n) r <= 0; else r <= {r[2:0], d}; assign q = r; endmodule" }, options: { top: "shreg4" } }, noop);
await t("sta shreg4 hold (removal) = OpenSTA -0.3186", (r) => near(r.summary.hold.worst_slack_ns, -0.3186, 0.01) && near(r.summary.setup.worst_slack_ns, 8.7054, 0.05), () => St.handle({ mode: "sta", files: { "netlist.json": sh.files["netlist.json"] }, options: { top: "shreg4", clockPort: "clk", periodNs: 10 } }, noop));
if (s) console.log(JSON.stringify(s.summary).slice(0, 300));
process.exit(fail ? 1 : 0);
