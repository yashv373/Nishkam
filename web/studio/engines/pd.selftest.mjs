// Headless check of the browser physical-design chain: node web/studio/engines/pd.selftest.mjs [bits]
//   gate netlist (shift register) -> place (graywolf) -> route (qrouter) -> GDS + DRC + SPICE extract (Magic), all WebAssembly.
// Known issues printed, not hidden: a 4-cell design hangs graywolf (also natively), so the default is 8 flops.
import * as P from "./place.worker.js";
import * as R from "./route.worker.js";
import * as M from "./magic.worker.js";
process.on("unhandledRejection", () => {}); // Asyncify rethrows ExitStatus after exit(); harmless

const bits = +(process.argv[2] || 8), top = `sr${bits}`;
const q = (i) => (i === bits - 1 ? "dout" : `q${i}`);
const netlist = `module ${top}(clk, rst_n, din, dout);\n  input clk; input rst_n; input din; output dout;\n` +
  Array.from({ length: bits - 1 }, (_, i) => `  wire q${i};`).join("\n") + "\n" +
  Array.from({ length: bits }, (_, i) => `  gf180mcu_fd_sc_mcu7t5v0__dffrnq_1 f${i} (.CLK(clk), .D(${i ? q(i - 1) : "din"}), .Q(${q(i)}), .RN(rst_n));`).join("\n") + "\nendmodule\n";
const io = { log: () => {}, progress: () => {} };
let fail = 0;
const t = (name, ok, extra = "") => { console.log(ok ? "PASS" : "FAIL", name, extra); fail += !ok; };

let t0 = Date.now();
const pl = await P.handle({ files: { [`${top}.v`]: netlist }, options: { top } }, io);
t("place", pl.ok && pl.summary.components >= bits, `${pl.summary.components} components, ${pl.summary.die}, ${Date.now() - t0} ms`);
t0 = Date.now();
const rt = await R.handle({ files: pl.files, options: { top } }, io);
t("route", rt.ok && rt.summary.failedNets === 0, `failed nets ${rt.summary.failedNets}, ${Date.now() - t0} ms`);
t0 = Date.now();
const mg = await M.handle({ files: rt.files, options: { top, extract: true } }, io);
t("gds", mg.files[`${top}.gds`]?.length > 10000, `${mg.files[`${top}.gds`]?.length} bytes`);
t("drc ran", mg.summary.drcErrors >= 0, `${mg.summary.drcErrors} error tiles (${mg.summary.drcInCells} inside library cells, ${mg.summary.drcFromLayout} from layout); rules: ${mg.summary.drcRules.join(" | ")}`);
t("extract", /\.subckt|\.SUBCKT/.test(new TextDecoder().decode(mg.files[`${top}.spice`] || "")), `${Date.now() - t0} ms total for magic`);
process.exit(fail ? 1 : 0);
