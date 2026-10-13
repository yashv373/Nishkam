// node web/studio/engines/lvs.selftest.mjs [bits]  : place -> route -> Magic extract -> Netgen LVS, all WebAssembly.
import * as P from "./place.worker.js";
import * as R from "./route.worker.js";
import * as M from "./magic.worker.js";
import * as L from "./lvs.worker.js";
process.on("unhandledRejection", () => {});
const bits = +(process.argv[2] || 8), top = `sr${bits}`, q = (i) => (i === bits - 1 ? "dout" : `q${i}`);
const netlist = `module ${top}(clk, rst_n, din, dout);\n  input clk; input rst_n; input din; output dout;\n` +
  Array.from({ length: bits - 1 }, (_, i) => `  wire q${i};`).join("\n") + "\n" +
  Array.from({ length: bits }, (_, i) => `  gf180mcu_fd_sc_mcu7t5v0__dffrnq_1 f${i} (.CLK(clk), .D(${i ? q(i - 1) : "din"}), .Q(${q(i)}), .RN(rst_n));`).join("\n") + "\nendmodule\n";
const io = { log: (s) => process.env.V && console.log(s), progress: () => {} };
let fail = 0;
const t = (name, ok, extra = "") => { console.log(ok ? "PASS" : "FAIL", name, extra); fail += !ok; };
const pl = await P.handle({ files: { [`${top}.v`]: netlist }, options: { top } }, io);
const rt = await R.handle({ files: pl.files, options: { top } }, io);
const mg = await M.handle({ files: rt.files, options: { top, extract: true } }, io);
const files = { [`${top}.spice`]: mg.files[`${top}.spice`], [`${top}.v`]: netlist };
// 1. real layout vs gate netlist; result is reported, not asserted (the generated layout still has net differences)
const lv = await L.handle({ files, options: { top } }, io);
console.log(`LVS layout vs netlist: match=${lv.summary.match} devices=${lv.summary.devices} nets=${lv.summary.nets} (${lv.summary.ms} ms) ${lv.summary.result}`);
t("lvs ran", lv.summary.devices !== null);
t("layout matches netlist", lv.summary.match === true);
// 2. detection: a deliberately broken layout (one transistor removed) must be reported as a mismatch
const bad = new TextDecoder().decode(mg.files[`${top}.spice`]).replace(/^X2 Q a_2665_112# VDD VNW pfet.*$/m, "");
const lb = await L.handle({ files: { ...files, [`${top}.spice`]: bad }, options: { top } }, io);
t("broken layout caught", lb.summary.match === false && lb.summary.devices[0] < lv.summary.devices[0], `devices ${lb.summary.devices} vs ${lv.summary.devices}`);
process.exit(fail ? 1 : 0);
