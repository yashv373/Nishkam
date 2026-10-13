// Netgen LVS (GPL, upstream build with static Tcl 8.6), gf180mcuD setup. Layout SPICE from Magic vs gate-level Verilog.
// Own worker, talks only through messages. Build recipe: web/vendor/netgen/3cb047b/SOURCE.md
import { serve } from "./_rpc.js";
import { pdk, readBin } from "./place.worker.js";

const NG = new URL("../../vendor/netgen/3cb047b/", import.meta.url);
const dec = (b) => (typeof b === "string" ? b : new TextDecoder().decode(b));

// The flow has no well-tap cells, so Magic leaves each cell's well as its own net and exports a few internal nodes as ports.
// assumeWellTaps (default): wells joined to VDD/VSS, filler cells dropped. Honest limit: an ideal-tap assumption, not a tap check.
export function prepare(spiceText, verilogText, cellSpice, { assumeWellTaps = true } = {}) {
  let lay = spiceText;
  if (assumeWellTaps) lay = lay.split("\n").filter((l) => !/^XS?FILL/.test(l)).join("\n").replace(/[^\s]*\/VNW(?=\s|$)/g, "VDD").replace(/[^\s]*\/VPW(?=\s|$)/g, "VSS").replace(/[^\s]*\/VDD(?=\s|$)/g, "VDD").replace(/[^\s]*\/VSS(?=\s|$)/g, "VSS").replace(/\$SUB(?=\s|$)/g, "VSS")
    .replace(/^(\.subckt\s+(?!gf180mcu_)\S+.*)$/gm, "$1 VDD VSS"); // power pins are not top-level ports in this flow: add them
  const pg = (v) => v
    .replace(/(module\s+\S+?\s*\()/, "$1VDD, VSS, ").replace(/(module[^;]*;)/, "$1\n  inout VDD; inout VSS;")
    .replace(/(\bgf180mcu_\w+\s+\S+\s*\([^;]*?)\)\s*;/g, "$1, .VDD(VDD), .VSS(VSS), .VNW(VDD), .VPW(VSS));");
  const cells = [...new Set(verilogText.match(/\bgf180mcu_\w+(?=\s+\S+\s*\()/g) || [])];
  return { lay, v: pg(verilogText), cells, cellSpice };
}

export function parse(out) {
  const d = [...out.matchAll(/Circuit 1 contains (\d+) devices, Circuit 2 contains (\d+) devices/g)].pop();
  const n = [...out.matchAll(/Circuit 1 contains (\d+) nets,\s+Circuit 2 contains (\d+) nets/g)].pop();
  const f = out.match(/Final result:\s*\n?(.*)/g)?.pop().replace(/Final result:\s*/, "").trim();
  const match = /Circuits match uniquely|Circuits match correctly/.test(out) && !/MISMATCH/.test(out.slice(out.lastIndexOf("Contents of circuit 1")));
  return { match, devices: d ? [+d[1], +d[2]] : null, nets: n ? [+n[1], +n[2]] : null, result: f || (match ? "Circuits match uniquely." : "no result") };
}

export async function handle({ files, options = {} }, { log, progress }) {
  const sp = Object.keys(files).find((p) => /\.spice$/.test(p)), vf = Object.keys(files).find((p) => /\.v$/.test(p));
  if (!sp || !vf) throw new Error("need the extracted .spice (Magic) and the gate netlist .v");
  const top = options.top || sp.replace(/^.*\//, "").replace(/\.spice$/, "");
  const [cellBin, setup] = await Promise.all([pdk("spice"), readBin(new URL("gf180mcuD_setup.tcl", NG))]);
  const p = prepare(dec(files[sp]), dec(files[vf]), cellBin, options);
  const out = [];
  const say = (s) => { out.push(s); };
  const mod = await (await import(new URL("netgen.js", NG).href)).default({ print: say, printErr: say });
  const W = (n, d) => mod.FS.writeFile("/w/" + n, d);
  mod.FS.mkdirTree("/w");
  W("lay.spice", p.lay); W("cells.spice", p.cellSpice); W("pg.v", p.v); W("setup.tcl", setup);
  const flat = options.flatten === false ? [] : p.cells;
  // ponytail: flatten used cells so Magic's stray cell-port nodes cannot cause false pin mismatches; hierarchical compare = flatten:false
  const tcl = ["netgen::readnet spice /w/lay.spice 1", "netgen::readnet spice /w/cells.spice 2", "netgen::readnet verilog /w/pg.v 2",
    ...flat.flatMap((c) => [1, 2].map((i) => `catch {netgen::flatten class {${c} ${i}}}`)),
    `netgen::lvs {${top} 1} {${top} 2} /w/setup.tcl /w/out.txt`, "quit"].join("\n");
  W("run.tcl", tcl);
  progress(0.3);
  const t0 = Date.now();
  try { mod.callMain(["-batch", "source", "/w/run.tcl"]); } catch (e) { if (e?.status === undefined) throw e; }
  if (options.debug) log(out.join("\n").slice(-1500) + "\n");
  const report = mod.FS.readFile("/w/out.txt", { encoding: "utf8" });
  const summary = { top, ...parse(out.join("\n") + "\n" + report), ms: Date.now() - t0 };
  log(`LVS: ${summary.match ? "MATCH" : "MISMATCH"}; devices ${summary.devices}, nets ${summary.nets}; ${summary.result}\n`);
  progress(1);
  return { ok: true, files: { [`${top}.lvs.txt`]: report }, summary };
}

serve(handle);
