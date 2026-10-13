// Yosys (YoWASP, same pinned URL as web/worker.js so the browser cache is shared) for lint + synthesis.
import { serve, readText, text } from "./_rpc.js";
import { synthScript, abcScript, sdcText, DEFAULTS } from "./yosys-flow.js";

export const YOSYS_URL = "https://cdn.jsdelivr.net/npm/@yowasp/yosys@0.68.1207/gen/bundle.js";
const LIB_URL = new URL("../../vendor/gf180mcu/7b70722/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.trimmed.lib", import.meta.url);
const LATCH_URL = new URL("../../vendor/gf180mcu/synth/latch_map.v", import.meta.url);
// Cells LibreLane's gf180mcuD config refuses to synthesize (scan flops): libs.tech/librelane/.../no_synth.cells
const DONT_USE = ["sdffq", "sdffrnq", "sdffrsnq", "sdffsnq"].flatMap((n) => [1, 2, 4].map((d) => `gf180mcu_fd_sc_mcu7t5v0__${n}_${d}`));

let mod; // tests set globalThis.__yosysModule to a Node-installed @yowasp/yosys
const load = () => (mod ||= globalThis.__yosysModule || import(YOSYS_URL));

async function yosys(script, files, { log, progress }) {
  const { runYosys, Exit } = await load();
  const out = [];
  const sink = (b) => { if (b) { const s = text(b); out.push(s); log(s); } };
  let fs, ok = true;
  try {
    fs = await runYosys(["-q", "-s", "run.ys"], { ...files, "run.ys": script }, {
      stdout: sink, stderr: sink,
      fetchProgress: ({ doneLength, totalLength }) => progress(totalLength ? doneLength / totalLength : 0),
    });
  } catch (e) { if (!(e instanceof Exit)) throw e; ok = false; fs = e.files; }
  return { ok, fs: fs || {}, log: out.join("") };
}

// "file.v:3: ERROR: ..." / "Warning: ..." -> messages
export function parseMessages(logText) {
  const msgs = [];
  for (const l of logText.split("\n")) {
    const m = l.match(/^(?:(.+?):(\d+)(?:\.\d+-\d+\.\d+)?: )?(ERROR|Warning|WARNING): (.*)$/);
    if (m) msgs.push({ severity: m[3] === "ERROR" ? "error" : "warning", file: m[1] || "", line: m[2] ? +m[2] : 0, text: m[4] });
  }
  return msgs;
}

// stat.json (yosys `stat -json`) first; the text report is the fallback. Returns {cells, area, kinds:[[type,count]]}.
export function parseStat(jsonText, txt = "") {
  try {
    const j = JSON.parse(jsonText), d = j.design || Object.values(j.modules || {})[0] || {};
    const cells = d.num_cells_by_type || d.cells || {}, strip = (k) => k.replace(/^gf180mcu_fd_sc_mcu7t5v0__/, "");
    return { cells: d.num_cells ?? Object.values(cells).reduce((a, b) => a + b, 0), area: d.area ?? null,
      kinds: Object.entries(cells).map(([k, n]) => [strip(k), n]).sort((a, b) => b[1] - a[1]) };
  } catch { /* fall through to the text report */ }
  const n = (re) => { const m = txt.match(re); return m ? +m[1] : null; };
  const kinds = [...txt.matchAll(/^\s+(\d+)\s+(?:[\d.]+\s+)?(?:gf180mcu_fd_sc_mcu7t5v0__)?(\$?\w+)\s*$/gm)].filter((k) => k[2] !== "cells").map((k) => [k[2], +k[1]]);
  return { cells: n(/^\s*(\d+)\s+(?:[\d.]+\s+)?cells$/m) ?? n(/Number of cells:\s+(\d+)/), area: n(/Chip area for (?:top )?module.*?:\s*([\d.]+)/), kinds };
}

const modulesIn = (files) => [...new Set(Object.entries(files).filter(([p]) => /\.s?vh?$/.test(p)).flatMap(([, t]) => [...text(t).matchAll(/^\s*module\s+(\w+)/gm)].map((m) => m[1])))];
// Clear message when the chosen top is not in the sources (null when fine / no top chosen)
export function missingTop(files, top) {
  const mods = modulesIn(files);
  return top && !mods.includes(top) ? `Top module '${top}' not found in the sources. Modules found: ${mods.join(", ") || "none"}.` : null;
}

const countOf = (ms, sev) => ms.filter((m) => m.severity === sev).length;
const fail = (messages, extra = {}) => ({ ok: false, files: {}, summary: { errors: countOf(messages, "error"), warnings: countOf(messages, "warning"), messages, ...extra } });
const err = (text, file = "", line = 0) => ({ severity: "error", file, line, text });

export async function handle({ mode, files, options = {} }, cb) {
  let top = options.top;
  const src = Object.keys(files).filter((p) => /\.(v|sv|vh|svh)$/.test(p));
  if (!src.length) throw new Error("no .v/.sv files given");
  const noTop = missingTop(files, top);
  if (noTop) return fail([err(noTop)]);
  if (mode === "lint") {
    const t = top ? `-top ${top}` : "-auto-top";
    const r = await yosys([...src.map((p) => `read_verilog -sv ${p}`), `hierarchy -check ${t}`].join("\n"), files, cb);
    const messages = parseMessages(r.log);
    return { ok: r.ok, files: {}, summary: { errors: countOf(messages, "error"), warnings: countOf(messages, "warning"), messages } };
  }
  const rd = src.map((p) => `read_verilog -sv ${p}`);
  if (!top) { // LibreLane needs a design name: let Yosys pick the top (-auto-top) and read it back from the json
    const r = await yosys([...rd, "hierarchy -auto-top", "write_json top.json"].join("\n"), files, cb);
    const mods = r.fs["top.json"] ? JSON.parse(text(r.fs["top.json"])).modules : {};
    top = Object.keys(mods).find((k) => mods[k].attributes?.top);
    if (!top) { const m = parseMessages(r.log); return fail(m.length ? m : [err("Could not find a top module. Pick one in the Top field.")]); }
  }
  const [lib, latch] = await Promise.all([readText(LIB_URL), readText(LATCH_URL)]);
  const du = [...DONT_USE, ...(options.dontUse || [])].map((c) => `-dont_use ${c}`).join(" ");
  const o = { ...DEFAULTS, ...(options.periodNs ? { periodNs: options.periodNs } : {}), ...(options.strategy ? { strategy: options.strategy } : {}) };
  const script = synthScript({ srcs: src, top, dontUse: du, flatten: options.hierarchy !== "keep", opts: o });
  const r = await yosys(script, { ...files, "cells.lib": lib, "latch_map.v": latch, "abc.script": abcScript(o.strategy, o), "synthesis.abc.sdc": sdcText(o) }, cb);
  const messages = parseMessages(r.log);
  const rd2 = (f) => (r.fs[f] != null ? text(r.fs[f]) : "");
  if (!r.ok) return fail(messages);
  const stat = parseStat(rd2("stat.json"), rd2("stat.txt"));
  // LibreLane's two checkers: Checker.YosysSynthChecks (problems in `check`) and Checker.YosysUnmappedCells (cells still named $...)
  const nProb = (f) => +(rd2(f).match(/Found and reported (\d+) problem/)?.[1] ?? 0);
  const problems = nProb("chk.rpt") + nProb("pre_synth_chk.rpt"); // pre-synth check sees undriven nets before setundef ties them low
  const unmapped = stat.kinds.filter(([k]) => k.startsWith("$")).map(([k, n]) => `${n} x ${k}`);
  const errs = [];
  if (problems) {
    const pre = rd2("pre_synth_chk.rpt") + "\n" + rd2("chk.rpt");
    const lines = [...new Set(pre.split("\n").filter((l) => /Warning:|ERROR:/.test(l)).map((l) => l.replace(/^.*?(Warning|ERROR): /, "")))];
    for (const l of lines) errs.push(err(`Synthesis check: ${l}`));
    if (!errs.length) errs.push(err(`Synthesis check found ${problems} problem(s) (undriven nets or combinational loops).`));
  }
  if (unmapped.length) errs.push(err(`Cells left unmapped after synthesis: ${unmapped.join(", ")}`));
  if (!stat.cells) errs.push(err(`Top module '${top}' has no cells after synthesis: its outputs are constant or undriven.`));
  if (errs.length) return fail([...messages, ...errs], { ...stat, top });
  const outFiles = {};
  for (const f of ["netlist.v", "netlist.json", "rtl.json", "stat.txt", "stat.json", "latch.rpt", "chk.rpt"]) if (r.fs[f] != null) outFiles[f] = text(r.fs[f]);
  return { ok: true, files: outFiles, summary: { ...stat, top, strategy: o.strategy, library: "gf180mcu_fd_sc_mcu7t5v0 tt_025C_5v00", messages } };
}

serve(handle);
