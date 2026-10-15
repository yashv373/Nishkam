// OpenSTA (GPL-3.0, upstream build with static Tcl 8.6). Recipe: web/vendor/opensta/defec0b/SOURCE.md
// Same Tcl commands as native `sta`, so timing.rpt / power.rpt are OpenSTA's own text. No estimates here.
import { serve } from "./_rpc.js";

const STA = new URL("../../vendor/opensta/defec0b/", import.meta.url);
const LIB = new URL("../../vendor/gf180mcu/lib-tt5v0-full/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.lib.gz", import.meta.url);

async function gunzip(buf) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")));
  return new Uint8Array(await ds.arrayBuffer());
}
async function load(url) {
  if (url.protocol === "file:") return new Uint8Array(await (await import("node:fs/promises")).readFile(url));
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// The exact SDC (also shown in the Timing tab). Delays default to 0 here; the page passes 20% of the period like LibreLane.
export function sdc({ clockPort = "clk", periodNs = 10, inputDelayNs = 0, outputDelayNs = 0, loadPf = 0, propagated = false }) {
  return `create_clock -name clk -period ${periodNs} [get_ports ${clockPort}]
set_input_delay ${inputDelayNs} -clock clk [lsearch -all -inline -not -exact [all_inputs] [get_ports ${clockPort}]]
set_output_delay ${outputDelayNs} -clock clk [all_outputs]
set_load ${loadPf} [all_outputs]
${propagated ? "set_propagated_clock [all_clocks]\n" : ""}`;
}

export function script(o, lib = "/w/lib.lib", v = "/w/design.v", spef = null) {
  const m = (x) => `puts "@@${x}"`;
  const fields = "-format full_clock_expanded -fields {slew cap input_pins} -digits 4";
  return `read_liberty ${lib}
read_verilog ${v}
link_design ${o.top}
${spef ? `${m("SPEF")}
read_spef ${spef}
report_parasitic_annotation
${m("SPEFEND")}
` : ""}${sdc(o)}${m("TIMING")}
${m("MAX")}
report_checks -path_delay max ${fields} -group_path_count 50
${m("MIN")}
report_checks -path_delay min ${fields} -group_path_count 50
${m("SUMMARY")}
report_wns -digits 4
report_tns -digits 4
report_wns -min -digits 4
report_tns -min -digits 4
report_worst_slack -max -digits 4
report_worst_slack -min -digits 4
${m("POWER")}
report_power
`;
}

export function parse(out, periodNs) {
  const n = (re) => { const m = out.match(re); return m ? +m[1] : null; };
  const seg = (a, b) => out.slice(out.indexOf(a) + a.length + 1, b ? out.indexOf(b) : undefined);
  const mx = seg("@@MAX", "@@MIN"), mn = seg("@@MIN", "@@SUMMARY"), t = mx + mn + seg("@@SUMMARY", "@@POWER");
  const spef = out.includes("@@SPEFEND") ? seg("@@SPEF", "@@SPEFEND") : null;
  const p = out.slice(out.indexOf("@@POWER")).replace("@@POWER\n", "");
  const setup_ws_ns = n(/worst slack max (-?[\d.]+)/), hold_ws_ns = n(/worst slack min (-?[\d.]+)/);
  const tot = p.match(/^Total\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/m);
  const uW = (s) => (s ? +(+s * 1e6).toPrecision(6) : null);
  return { timing: t, max: mx, min: mn, spef, power: p, summary: {
    setup_ws_ns, setup_tns_ns: n(/tns max (-?[\d.]+)/), hold_ws_ns, hold_tns_ns: n(/tns min (-?[\d.]+)/) ?? Math.min(0, hold_ws_ns ?? 0),
    wns_ns: n(/wns max (-?[\d.]+)/),
    fmax_mhz: setup_ws_ns === null ? null : +(1000 / (periodNs - setup_ws_ns)).toFixed(2), // ideal clock, no skew
    internal_uW: uW(tot?.[1]), switching_uW: uW(tot?.[2]), leakage_uW: uW(tot?.[3]), total_uW: uW(tot?.[4]),
  } };
}

export async function handle({ files, options = {} }, { log, progress, raw }) {
  const vf = Object.keys(files).find((p) => /\.v$/.test(p));
  if (!vf) throw new Error("need the gate-level netlist (.v) from synthesis");
  const sf = Object.keys(files).find((p) => /\.spef$/.test(p));
  const lf = Object.keys(files).find((p) => /\.lib(\.gz)?$/.test(p));
  const top = options.top || vf.replace(/^.*\//, "").replace(/(\.gate)?\.v$/, "");
  const o = { ...options, top, clockPort: options.clockPort || "clk", periodNs: options.periodNs ?? 10 };
  let lib = lf ? files[lf] : await load(LIB);
  if (lf ? lf.endsWith(".gz") : true) lib = await gunzip(lib);
  progress(0.1);
  const out = [];
  const say = (s) => { out.push(s); raw?.("opensta", s + "\n", "out"); };
  const mod = await (await import(new URL("sta.js", STA).href)).default({ print: say, printErr: say, locateFile: (f) => new URL(f, STA).href });
  mod.FS.mkdirTree("/w");
  mod.FS.writeFile("/w/lib.lib", lib); mod.FS.writeFile("/w/design.v", typeof files[vf] === "string" ? files[vf] : files[vf]);
  if (sf) mod.FS.writeFile("/w/design.spef", files[sf]);
  mod.FS.writeFile("/w/run.tcl", script(o, "/w/lib.lib", "/w/design.v", sf ? "/w/design.spef" : null));
  progress(0.3);
  const t0 = Date.now();
  try { mod.callMain(["/w/run.tcl"]); } catch (e) {
    if (e?.status === undefined) throw new Error(`OpenSTA crashed while reading ${sf ? "the netlist and SPEF" : "the netlist"} (${typeof e === "number" ? "wasm exception " + e : e?.message || e}). Last output:\n` + out.slice(-8).join("\n"));
  }
  const all = out.join("\n") + "\n";
  if (!all.includes("@@POWER")) throw new Error("OpenSTA failed:\n" + all.slice(-1500));
  const r = parse(all, o.periodNs);
  r.summary.ms = Date.now() - t0;
  if (sf) { r.summary.spefReport = r.spef.trim(); if (/warning|error/i.test(r.spef)) log("OpenSTA read_spef messages:\n" + r.spef); }
  log(`OpenSTA: setup WS ${r.summary.setup_ws_ns} ns, hold WS ${r.summary.hold_ws_ns} ns, Fmax ${r.summary.fmax_mhz} MHz, power ${r.summary.total_uW?.toFixed(1)} uW (${r.summary.ms} ms)\n`);
  progress(1);
  return { ok: true, files: { "timing.rpt": r.timing, "max.rpt": r.max, "min.rpt": r.min, "power.rpt": r.power, "constraints.sdc": sdc(o) }, summary: r.summary };
}

serve(handle);
