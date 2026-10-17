import fs from "node:fs";
import * as P from "./place.worker.js";
import * as R from "./route.worker.js";
import * as M from "./magic.worker.js";
import * as L from "./lvs.worker.js";
import * as C from "./cts.worker.js";
process.on("unhandledRejection", () => {});
const io = { log() {}, progress() {} }, top = "shreg4";
const net = fs.readFileSync(process.env.S + "/shreg4_net.v", "utf8");
const sdc = "create_clock -name clk -period 40 [get_ports clk]\n";
for (const [name, h, cts] of [["plain", undefined, false], ["headroom", [0.1, 600], false], ["headroom+cts", [0.1, 600], true]]) {
  const pl = await P.handle({ files: { "shreg4.v": net }, options: { top, headroom: h } }, io);
  let files = pl.files, nl = net;
  if (cts) { const c = await C.handle({ files: { "shreg4.def": pl.files["shreg4.def"], "shreg4.v": net, "shreg4.info": pl.files["shreg4.info"], "shreg4.obs": pl.files["shreg4.obs"], "constraints.sdc": sdc }, options: { top } }, io); files = { ...pl.files, "shreg4.def": c.files["shreg4.def"], "shreg4.obs": c.files["shreg4.obs"] }; fs.writeFileSync(process.env.S + "/qin.def", c.files["shreg4.def"]); fs.writeFileSync(process.env.S + "/pin.def", pl.files["shreg4.def"]); nl = c.files["shreg4_cts.v"]; if (process.env.D) fs.writeFileSync(process.env.S + "/cts.v", nl); }
  const rt = await R.handle({ files, options: { top } }, name !== "x" ? { log() {}, progress() {}, raw: (t, c) => fs.appendFileSync(process.env.S + "/qr_" + name.replace("+", "_") + ".log", c) } : io); fs.writeFileSync(process.env.S + "/rt_" + name.replace("+", "_") + ".def", rt.files["shreg4_route.def"]);
  let mg; try { mg = await M.handle({ files: rt.files, options: { top, extract: true, drc: true } }, io); } catch (e) { console.log("MAGIC CRASH", name, e.message); continue; }
  if (cts) fs.writeFileSync(process.env.S + "/lay.spice", mg.files["shreg4.spice"]);
  if (cts) { try { const l2 = await L.handle({ files: { "shreg4.spice": mg.files["shreg4.spice"], "shreg4.v": net }, options: { top } }, io); console.log("vs yosys netlist", l2.summary.match, JSON.stringify(l2.summary.nets)); } catch (e) { console.log("vs yosys CRASH", e.message); } }
  if (cts) fs.writeFileSync(process.env.S + "/lay.spice", mg.files["shreg4.spice"]);
  let lv; try { lv = await L.handle({ files: { "shreg4.spice": mg.files["shreg4.spice"], "shreg4.v": nl }, options: { top } }, io); } catch (e) { console.log("LVS CRASH", name, e.message); continue; }
  if (cts) { console.log(Object.keys(lv.files)); fs.writeFileSync(process.env.S + "/lvs.out", String(lv.files[Object.keys(lv.files)[0]])); fs.writeFileSync(process.env.S + "/lay.spice", mg.files["shreg4.spice"]); }
  console.log(name, "route", rt.summary.failedNets, "drc", mg.summary.drcErrors, "lvs", lv.summary.match, JSON.stringify(lv.summary.devices), JSON.stringify(lv.summary.nets), lv.summary.result);
}
