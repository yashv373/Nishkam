// OpenROAD TritonCTS built to WebAssembly (BSD-3-Clause, OpenSTA GPL-3.0 inside). Recipe: web/vendor/openroad-cts/61932e8/SOURCE.md
// The Tcl is LibreLane 3.0.2's cts.tcl (+ dpl.tcl) started from a placed DEF. No estimates here.
import { serve, text } from "./_rpc.js";
import { fillDef } from "./place.worker.js";

const OR = new URL("../../vendor/openroad-cts/61932e8/", import.meta.url);
const PD = new URL("../../vendor/gf180mcu/pd-7b70722/", import.meta.url);
const LIB = new URL("../../vendor/gf180mcu/lib-tt5v0-full/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.lib.gz", import.meta.url);
const CELL = "gf180mcu_fd_sc_mcu7t5v0__";

async function load(url) {
  if (url.protocol === "file:") return new Uint8Array(await (await import("node:fs/promises")).readFile(url));
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
const gunzip = async (buf) => new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());

// The graywolf DEF has no pin directions (OpenROAD would call every port an input, and OpenSTA then sees no outputs). Directions come from the Yosys netlist
// and are written into the DEF before OpenROAD reads it (setting them afterwards does not reach OpenSTA).
export function portDirs(netlist) {
  const t = netlist == null ? "" : typeof netlist === "string" ? netlist : new TextDecoder().decode(netlist), d = {};
  for (const m of t.matchAll(/^\s*(input|output|inout)\s+(?:\[(\d+):(\d+)\]\s*)?(\w+)\s*;/gm)) {
    if (m[2] === undefined) d[m[4]] = m[1];
    else for (let i = Math.min(m[2], m[3]); i <= Math.max(m[2], m[3]); i++) d[`${m[4]}[${i}]`] = m[1];
  }
  return d;
}
export const withDirs = (def, dirs) => def.replace(/^- (\S+) \+ NET \S+/gm, (m, p) => (dirs[p] ? `${m} + DIRECTION ${dirs[p].toUpperCase()}` : m));
export const script = (top) => `set_thread_count 1
read_lef /w/tech.lef
read_lef /w/cells.lef
read_liberty /w/lib.lib
read_def /w/placed.def
read_sdc /w/constraints.sdc
set f [open /w/drc_exclude.cells]
set_dont_use [string trim [read $f]]; close $f
set layers [list]
foreach l [[ord::get_db_tech] getLayers] { if {[$l getType] == "ROUTING"} { lappend layers [$l getName] } }
set_wire_rc -clock -layers $layers
set_wire_rc -signal -layers $layers
estimate_parasitics -placement
repair_clock_inverters
configure_cts_characterization
clock_tree_synthesis -buf_list {${CELL}clkbuf_8 ${CELL}clkbuf_4 ${CELL}clkbuf_2} -root_buf ${CELL}clkbuf_8 -sink_clustering_enable -apply_ndr half
set_propagated_clock [all_clocks]
estimate_parasitics -placement
repair_clock_nets -max_wire_length 0
estimate_parasitics -placement
remove_fillers
detailed_placement -max_displacement {500 100}
optimize_mirroring
check_placement -verbose
estimate_parasitics -placement
puts "@@REPORT"
report_cts
report_clock_skew
report_clock_latency
set n 0; foreach i [[ord::get_db_block] getInsts] { if {[string match *clkbuf* [[$i getMaster] getName]]} {incr n} }
puts "CLKBUF_COUNT $n"
write_def /w/${top}_cts.def
write_verilog /w/${top}_cts.v
puts "@@DONE"
`;

// The graywolf/addspacers DEF has no ROW lines (qflow keeps rows internally); OpenROAD's placer needs them. Rows are rebuilt from the die and the cell
// positions: sites sit on a 0.56 x 3.92 um grid from the lowest-left cell, row 0 is flipped (FS) and rows alternate like the LibreLane DEFs.
const SITE = { name: "GF018hv5v_mcu_sc7", w: 0.56, h: 3.92 };
export function addRows(def) {
  if (/^ROW /m.test(def)) return def;
  const dbu = +def.match(/UNITS DISTANCE MICRONS (\d+)/)[1], die = def.match(/DIEAREA \( (-?\d+) (-?\d+) \) \( (-?\d+) (-?\d+) \)/).slice(1).map(Number);
  const sw = Math.round(SITE.w * dbu), sh = Math.round(SITE.h * dbu);
  const at = [...def.slice(def.indexOf("COMPONENTS"), def.indexOf("END COMPONENTS")).matchAll(/\+ (?:PLACED|FIXED) \( (-?\d+) (-?\d+) \)/g)].map((m) => [+m[1], +m[2]]);
  const x0 = Math.min(...at.map((c) => c[0])), y0 = Math.min(...at.map((c) => c[1]));
  const nx = Math.floor((die[2] - x0) / sw), ny = Math.floor((die[3] - y0) / sh);
  const rows = Array.from({ length: ny }, (_, i) => `ROW ROW_${i} ${SITE.name} ${x0} ${y0 + i * sh} ${i % 2 ? "N" : "FS"} DO ${nx} BY 1 STEP ${sw} 0 ;`);
  return def.replace(/^(DIEAREA [^\n]*\n)/m, `$1\n${rows.join("\n")}\n`);
}

// OpenROAD's DEF writer -> the plainer DEF qrouter reads and rewrites (it finds nets by "- name" at the start of a line, and wants "+ LAYER" directly
// after the pin name). Rows, non-default rules and the USE / SOURCE / DIRECTION marks go. Without this qrouter routes the nets and then writes none of them.
// ponytail: the half-spacing rule of the clock nets is lost in the browser router; the runner (LibreLane) keeps it.
export const forQrouter = (def) => def.replace(/^ROW [^\n]*\n/gm, "").replace(/^NONDEFAULTRULES[\s\S]*?^END NONDEFAULTRULES\n/m, "")
  .replace(/^COMPONENTS[\s\S]*?^END COMPONENTS/m, (c) => c.replace(/^\s+- /gm, "- ").replace(/ \+ SOURCE \w+/g, ""))
  .replace(/^PINS[\s\S]*?^END PINS/m, (p) => p.replace(/ \+ (?:DIRECTION|USE) \w+/g, "").replace(/\n\s*\+ PORT/g, "").replace(/^\s+- /gm, "- ").replace(/\n\s+\+/g, "\n  +"))
  .replace(/^NETS[\s\S]*?^END NETS/m, (n) => n.replace(/^\s+- (\S+)([^;]*);/gm, (_, name, rest) => `- ${name}\n${[...rest.matchAll(/\( [^)]*\)/g)].map((m) => "  " + m[0]).join("\n")}\n;`));

export const stripFill = (def) => def.replace(/^COMPONENTS \d+ ;\n([\s\S]*?)^END COMPONENTS/m, (_, body) => {
  const keep = body.split("\n").filter((l) => l && !/^- \S+ \S+__fill/.test(l));
  return `COMPONENTS ${keep.length} ;\n${keep.join("\n")}\nEND COMPONENTS`;
});

export function parse(out) {
  const n = (re) => { const m = out.match(re); return m ? +m[1] : null; };
  const rep = out.slice(out.indexOf("@@REPORT") + 9, out.indexOf("@@DONE")).trim();
  return { report: rep, summary: { clkbufs: n(/CLKBUF_COUNT (\d+)/), sinks: n(/Clock net "[^"]+" has (\d+) sinks/), latency_ns: n(/^\s*([\d.]+)\s+[\d.]+\s+latency/m),
    skew_ns: n(/^\s+([\d.]+) skew/m), setup_skew_ns: n(/^\s+(-?[\d.]+) setup skew/m), hold_skew_ns: n(/^\s+(-?[\d.]+) hold skew/m) } };
}

export async function handle({ files, options = {} }, { log, progress, raw }) {
  const df = Object.keys(files).find((p) => /\.def$/.test(p));
  if (!df) throw new Error("need the placed DEF (run Placement first)");
  const sdc = files["constraints.sdc"] ?? options.sdc;
  if (!sdc) throw new Error("need constraints.sdc (clock definition)");
  const top = options.top || df.replace(/^.*\//, "").replace(/\.def$/, "");
  const out = [];
  const say = (s) => { out.push(s); raw?.("openroad", s + "\n", "out"); };
  progress(0.05);
  const [tlef, lef, glib, ex] = await Promise.all([load(new URL("gf180mcu_fd_sc_mcu7t5v0__nom.tlef", PD)), load(new URL("gf180mcu_fd_sc_mcu7t5v0.lef", PD)), load(LIB), load(new URL("drc_exclude.cells", PD))]);
  const lib = await gunzip(glib);
  progress(0.15);
  const mod = await (await import(new URL("openroad.js", OR).href)).default({ print: say, printErr: say, locateFile: (f) => new URL(f, OR).href });
  mod.FS.mkdirTree("/w");
  const W = (f, d) => mod.FS.writeFile("/w/" + f, d);
  W("tech.lef", tlef); W("cells.lef", lef); W("lib.lib", lib); W("drc_exclude.cells", ex); W("placed.def", withDirs(addRows(typeof files[df] === "string" ? files[df] : new TextDecoder().decode(files[df])), portDirs(files[`${top}.v`]))); W("constraints.sdc", sdc); W("run.tcl", script(top));
  progress(0.3);
  const t0 = Date.now();
  try { mod.callMain(["/w/run.tcl"]); } catch (e) { if (e?.status === undefined) throw e; }
  const all = out.join("\n") + "\n";
  if (!all.includes("@@DONE")) throw new Error("OpenROAD CTS failed:\n" + all.split("\n").filter((l) => /ERROR|Error|error/.test(l)).slice(0, 6).join("\n") + "\n" + all.slice(-800));
  const r = parse(all);
  r.summary.ms = Date.now() - t0;
  log(`CTS: ${r.summary.clkbufs} clock buffers, ${r.summary.sinks} sinks, latency ${r.summary.latency_ns} ns, skew ${r.summary.skew_ns} ns (${r.summary.ms} ms)\n`);
  let def = forQrouter(mod.FS.readFile(`/w/${top}_cts.def`, { encoding: "utf8" })), obs = files[`${top}.obs`];
  if (files[`${top}.info`]) {   // graywolf flow: fillers and well taps were removed (room for the buffers) or moved; put fresh ones in so rails and wells are continuous again
    log("adding fill cells\n");
    ({ def, obs } = await fillDef({ top, def: stripFill(def), obs: text(obs ?? ""), info: text(files[`${top}.info`]), oscale: +def.match(/UNITS DISTANCE MICRONS (\d+)/)[1], log }));
  }
  const cts = new TextEncoder().encode(def), v = mod.FS.readFile(`/w/${top}_cts.v`, { encoding: "utf8" });
  progress(1);
  return { ok: true, files: { [`${top}.def`]: cts, [`${top}_cts.v`]: v, ...(obs === undefined ? {} : { [`${top}.obs`]: obs }), "cts.rpt": r.report, "cts.log": all }, summary: r.summary };
}

serve(handle);
