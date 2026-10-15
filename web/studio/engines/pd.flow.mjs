// Studio's in-browser physical flow, driven from node exactly as app.js localStage does it (same options, same don't-use list, same SDC):
// RTL -> yosys synth -> place (headroom) -> cts (if clocked) -> route. Used by pd.cases.selftest.mjs.
// [name]  (run from a folder with @yowasp/yosys in node_modules)
// RTL -> synth -> place (headroom) -> cts -> route, as Studio does in the browser. Each case must route with 0 failed nets.
// Regressions covered: port pads on neighbouring tracks or past the die edge, and cells whose pins qrouter cannot reach (QROUTER_DONT_USE).
// Big ones (mult10 .. rmult20, up to ~5000 cells, minutes) only run when named.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const req = createRequire(process.cwd() + "/");
globalThis.__yosysModule = await import(pathToFileURL(req.resolve("@yowasp/yosys")).href);
const Y = await import("./yosys.worker.js"), P = await import("./place.worker.js"), C = await import("./cts.worker.js"), R = await import("./route.worker.js");
process.on("unhandledRejection", () => {});
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// the same don't-use list Studio passes to synthesis for the browser physical path
const DONT = [...readFileSync(new URL("../app.js", import.meta.url), "utf8").match(/QROUTER_DONT_USE = \[([^\]]*)\]/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
const { sdc } = await import("./opensta.js"); // the same SDC Studio hands to the clock tree stage
export const _x = 0;
const { PROBLEMS } = await import("../../problems.js");
const T8 = PROBLEMS.find((x) => x.id === "squeeze-tiny8").files["tiny8.v"];
export const DESIGNS = {
  tiny8: ["tiny8", T8],
  twoclk: ["tc", "module tc(input c1, c2, d, r, output reg q); reg m; always @(posedge c1 or negedge r) if (!r) m <= 0; else m <= d; always @(posedge c2 or negedge r) if (!r) q <= 0; else q <= m; endmodule"],
  twoclk2: ["tc", "module tc(input c1, c2, d, r, output reg q); reg m; always @(posedge c1) if (r) m <= 0; else m <= d; always @(posedge c2) if (r) q <= 0; else q <= m; endmodule"],
  twoclk3: ["tc", "module tc(input c1, c2, d, r, output q); reg m, q1; always @(posedge c1 or posedge r) if (r) m <= 0; else m <= d; always @(posedge c2 or posedge r) if (r) q1 <= 0; else q1 <= m; assign q = q1; endmodule"],
  mult6: ["m6", "module m6(input [5:0] a, b, output [11:0] p); assign p = a * b; endmodule"],
  mult8: ["m8", "module m8(input [7:0] a, b, output [15:0] p); assign p = a * b; endmodule"],
  mult10: ["m10", "module m10(input [9:0] a, b, output [19:0] p); assign p = a * b; endmodule"],
  rmult20: ["rm", "module rm(input clk, input [19:0] a, b, output reg [39:0] p); reg [19:0] ra, rb; always @(posedge clk) begin ra <= a; rb <= b; p <= ra * rb; end endmodule"],
  pins40: ["pn", "module pn(input [39:0] a, output y, z); assign y = &a[3:0]; assign z = |a[39:36]; endmodule"],
  adder2: ["add", "module add(input [7:0] a, b, output [8:0] y, output [7:0] x); assign y = a + b; assign x = a ^ b; endmodule"],
  adder3: ["add", "module add(input [7:0] a, b, output [7:0] y, output [7:0] x); assign y = a + b; assign x = a ^ b; endmodule"],
  adder: ["ad", "module ad(input [7:0] a, b, output [8:0] s, output [7:0] x); assign s = a + b; assign x = a ^ b; endmodule"],
};
export async function flow(top, src, log = () => {}) {
  const io = { log, progress: () => {} }, T = {}; let t0 = Date.now();
  const sy = await Y.handle({ mode: "synth", files: { [top + ".v"]: src }, options: { top, dontUse: DONT.map((c) => "gf180mcu_fd_sc_mcu7t5v0__" + c) } }, io);
  if (!sy.ok) throw new Error("synth failed " + JSON.stringify(sy.summary).slice(0, 300));
  const nl = sy.files["netlist.v"]; T.synth = Date.now() - t0; t0 = Date.now();
  const pl = await P.handle({ files: { [top + ".v"]: nl }, options: { top, headroom: [0.1, 600] } }, io);
  T.place = Date.now() - t0; t0 = Date.now();
  const hasClk = /posedge|negedge/.test(src) ;
  let files = pl.files, ct = null;
  if (hasClk) {
    ct = await C.handle({ files: { [top + ".def"]: pl.files[top + ".def"], [top + ".v"]: nl, "constraints.sdc": sdc({ top, clockPort: top === "tc" ? "c1" : "clk", periodNs: 24, inputDelayNs: 4.8, outputDelayNs: 4.8, loadPf: 0.05 }) }, options: { top } }, io);
    files = { ...pl.files, [top + ".def"]: ct.files[top + ".def"] };
  }
  T.cts = Date.now() - t0; t0 = Date.now();
  let out = ""; const rt = await R.handle({ files, options: { top, cfgExtra: process.env.QCFG ? process.env.QCFG + "\n" : "" } }, { ...io, raw: (t, s) => { if (s) out += s; } });
  T.route = Date.now() - t0;
  return { cells: pl.summary.components, die: pl.summary.die, failed: rt.summary.failedNets, names: rt.summary.failedNames, T, out, pl, rt, nl, ct };
}
