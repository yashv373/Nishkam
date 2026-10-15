// Stage table + orchestrator. No DOM here, so it can be tested in node (stages.test.mjs).
export const GROUPS = ["Sources & RTL", "Verification", "Synthesis", "Physical Design", "Signoff", "Reports"];
export const STAGES = [
  { id: "files", label: "Sources", group: 0, where: "browser", virtual: true },
  { id: "lint", label: "Lint", group: 0, where: "browser", engine: "yosys", pick: "lintEngine", opts: { mode: "lint" }, src: "rtl" },
  { id: "sim", label: "Simulation", group: 1, where: "browser", engine: "icarus", pick: "simEngine", tab: "Waveform", src: "sim" },
  { id: "synth", label: "Synthesis", group: 2, where: "browser", engine: "yosys", opts: { mode: "synth" }, src: "rtl" },
  { id: "schematic", label: "Schematic", group: 2, where: "browser", engine: "netlistsvg", tab: "Schematic", in: ["rtl.json", "netlist.json"] },
  { id: "floorplan", label: "Floorplan", group: 3, where: "runner", tab: "Layout" },
  { id: "place", label: "Placement", group: 3, where: "runner", tab: "Layout" },
  { id: "cts", label: "Clock Tree", group: 3, where: "runner", tab: "Layout" },
  { id: "route", label: "Routing", group: 3, where: "runner", tab: "Layout" },
  // Browser: OpenSTA (WASM) "pre-layout" run on the Yosys netlist here; the "post-route" run (with Magic's SPEF) happens inside the signoff stage. Runner: real LibreLane/OpenSTA.
  { id: "sta", label: "Timing (STA)", group: 4, where: "runner", tab: "Timing" },
  { id: "signoff", label: "Signoff", group: 4, where: "runner" },
  { id: "reports", label: "Final Reports", group: 5, where: "browser", virtual: true, tab: "Reports" },
];
// Adding a browser engine = one table line above (engine id = file in ./engines/, opts merged into options,
// src: which project files it reads, in: output files of earlier stages it reads instead).
// Engine ids a Properties dropdown may pick that differ from the file name:
const ENGINE_FILE = { "verilator-wasm": "verilator-lint" };
export const engineId = (s, o = {}) => { const e = (s.pick && o[s.pick]) || s.engine; return ENGINE_FILE[e] || e; };
// Yosys `src` attribute -> [{file,l1,l2}]. "a.v:12.3-14.5|b.v:3.1-3.9"; "a.v:12.3-9" (same line) too. Bad pieces are skipped.
export const parseSrc = (s) => String(s || "").split("|").flatMap((p) => {
  const m = /^(.*):(\d+)\.\d+(?:-(?:(\d+)\.)?\d+)?$/.exec(p.trim());
  return m ? [{ file: m[1], l1: +m[2], l2: +(m[3] || m[2]) }] : [];
});
// netlistsvg wire class "net_36,37,38 width_3" (comma list; "_" tolerated) -> ["36","37","38"]
export const netBits = (cls) => ((/(?:^|\s)net_([\w,]+)/.exec(cls || "") || [])[1] || "").split(/[,_]/).filter(Boolean);
// What a drawn wire is: a named yosys net (preferring non-$ names), or an unnamed one (split/join glue, constants). Never empty.
export function wireInfo(cls, nets) {
  const bits = netBits(cls), real = (v) => v.bits.map(String).filter((b) => !/^[01xz]$/.test(b));
  for (const pass of [(n) => !n.startsWith("$"), () => true]) for (const b of bits) { const e = /^[01xz]$/.test(b) ? null : [...nets].find(([n, v]) => pass(n) && real(v).includes(b)); if (e) return { name: e[0] }; }
  return { unnamed: bits.length, bits };
}
// 1-based [first,last] line of the always block that starts on `line` (begin/end and case/endcase nesting; a bare statement ends at its ';'), else null
export function alwaysRange(src, line) {
  const L = String(src).split("\n");
  if (!/\balways\b/.test(L[line - 1] || "")) return null;
  let d = 0, seen = false;
  for (let i = line - 1; i < L.length; i++) {
    const t = L[i].replace(/\/\/.*/, "");
    for (const m of t.matchAll(/\b(begin|case[xz]?|end|endcase)\b/g)) { m[1].startsWith("end") ? d-- : (d++, seen = true); }
    if (seen ? d <= 0 : /;/.test(t)) return [line, i + 1];
  }
  return [line, L.length];
}
const base = (f) => f.split(/[\\/]/).pop();
export const srcCovers = (segs, file, line) => segs.some((g) => base(g.file) === base(file) && g.l1 <= line && line <= g.l2);
// yosys JSON text -> Map(cell name -> {type, segs}) over all modules (the schematic ids are "cell_<name>")
export function cellSrcMap(json) {
  const m = new Map(), nets = new Map();
  try { const mods = Object.values(JSON.parse(json).modules || {}), mod = mods.find((x) => Number(x.attributes?.top) === 1) || mods[0];   // netlistsvg draws this one only
    const drv = new Map();   // bit -> src of the cell whose output drives it
    for (const [n, c] of Object.entries(mod.cells || {})) { const segs = parseSrc(c.attributes?.src);
      m.set(n, { type: c.type, segs, width: cellWidth(c.type, c.parameters) });
      for (const [p, bits] of Object.entries(c.connections || {})) if (c.port_directions?.[p] === "output" && segs.length) for (const b of bits) if (!drv.has(b)) drv.set(b, segs); }
    for (const [n, w] of Object.entries(mod.netnames || {})) nets.set(n, { bits: w.bits || [], segs: parseSrc(w.attributes?.src), driver: (w.bits || []).map((b) => drv.get(b)).find(Boolean) || [] }); } catch {}
  m.nets = nets;   // net name -> {bits, segs}: the wire's declaration/driver line
  return m;
}
const num = (v) => (typeof v === "string" ? parseInt(v, 2) : v);
// comparators / reduces / logic ops: show the operand width, not the 1-bit result
const cellWidth = (t, p = {}) => (/^\$(?:(?:eq|ne|lt|le|gt|ge)x?|reduce_.*|logic_.*)$/.test(t) ? Math.max(num(p.A_WIDTH) || 0, num(p.B_WIDTH) || 0) : num(p.Y_WIDTH ?? p.WIDTH ?? p.A_WIDTH)) || null;
// SVG sanitizer allowlist: exactly what netlistsvg emits (checked) plus <title>. Anything else, and every href, is dropped.
const SVG_EL = new Set("svg style g s:alias circle line path text rect title".split(" "));
const SVG_AT = new Set("xmlns xmlns:xlink xmlns:s width height s:type transform s:width s:height id val r cx cy class s:x s:y s:pid d x y x1 x2 y1 y2 s:attribute s:generic style".split(" "));
export const svgElOk = (name) => SVG_EL.has(name);
export const svgAttrOk = (name, value) => SVG_AT.has(name) && !(name === "style" && /url\(|@import|expression/i.test(value));
export const cssSafe = (css) => css.replace(/@import[^;]*;?|url\([^)]*\)/gi, "");
const WORDS = { $add: "adder", $sub: "subtractor", $mul: "multiplier", $mux: "2:1 multiplexer", $pmux: "priority multiplexer", $eq: "equality comparator", $ne: "inequality comparator", $lt: "less-than comparator", $le: "less-or-equal comparator", $gt: "greater-than comparator", $ge: "greater-or-equal comparator",
  $dff: "flip-flop", $adff: "flip-flop, async reset", $sdff: "flip-flop, sync reset", $dffe: "flip-flop with enable", $dlatch: "LATCH (usually unintended)", $and: "AND", $or: "OR", $xor: "XOR", $not: "NOT", $shl: "shift left", $shr: "shift right", $sshr: "arithmetic shift right",
  $logic_and: "logical AND", $logic_or: "logical OR", $logic_not: "logical NOT", $memrd: "memory read", $memwr: "memory write", $mem: "memory", $mem_v2: "memory" };
export const cellWords = (type, width) => { const t = String(type), w = WORDS[t] || (/^\$reduce_/.test(t) ? "reduce-" + t.slice(8) : /^\$a?dff|^\$sdff/.test(t) ? "flip-flop" : t); return w + (width ? `, ${width} bit` : ""); };
const idx = (id) => STAGES.findIndex((s) => s.id === id);
export const byId = (id) => STAGES[idx(id)];

// Which stages does a button press run? mode: all | to | one | from
export function plan(mode, sel) {
  const run = STAGES.filter((s) => !s.virtual);
  if (mode === "all") return run.map((s) => s.id);
  const i = idx(sel);
  if (i < 0) return [];
  if (mode === "one") return byId(sel).virtual ? [] : [sel];
  if (mode === "to") return run.filter((s) => idx(s.id) <= i).map((s) => s.id);
  if (mode === "from") return run.filter((s) => idx(s.id) >= i).map((s) => s.id);
  return [];
}

// LibreLane step folder ("35-openroad-cts") -> studio stage. Anything before placement is floorplan (lint, synth, PDN...).
export function stageOf(step) {
  const n = String(step || "").replace(/^\d+-/, "").toLowerCase();
  if (!n) return null;
  if (/magic|klayout|netgen|lvs|drc|xor|spice|manufactur|designrule/.test(n)) return "signoff";
  if (/fill|rcx|stapostpnr|irdrop/.test(n)) return "sta";
  if (/cts|clocktree|stamidpnr|repairtiming/.test(n)) return "cts";
  if (/placement|repairdesign|routingobstructions|resizer/.test(n)) return "place";
  if (/globalrouting|detailedrouting|antenna|wirelength/.test(n)) return "route";
  return "floorplan";
}
// metrics.json from LibreLane holds bare NaN / Infinity / -Infinity (invalid JSON). Strings are left alone.
export const parseLoose = (t) => JSON.parse(t.replace(/"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g, (m) => (m[0] === '"' ? m : "null")));
// Count cells in a yosys json (all modules); the schematic refuses big ones.
export const countCells = (j) => Object.values((typeof j === "string" ? JSON.parse(j) : j).modules || {}).reduce((n, m) => n + Object.keys(m.cells || {}).length, 0);
export const MAX_SCHEMATIC_CELLS = 500;

// Consecutive runner stages become one job {from,to}; others stay single units.
export function batches(ids, whereOf = (id) => byId(id).where) {
  const out = [];
  for (const id of ids) {
    const w = whereOf(id), last = out[out.length - 1];
    if (w === "runner" && last && last.where === "runner") last.ids.push(id);
    else out.push({ where: w, ids: [id] });
  }
  return out;
}

// deps: { hasRunner(), engine(stage)->Promise<{run}>, runnerJob({from,to,files,onStage,...}),
//         setState(id, state, info), files() , options() , onLog(id,line), onProgress(id,f), signal }
// state in: queued running passed warn failed unavailable stale
export async function runStages(ids, deps) {
  const outputs = deps.seed || {}; let ok = true;
  const mark = (list, st, info) => list.forEach((id) => deps.setState(id, st, info));
  mark(ids, "queued");
  // "local" = a runner-type stage that runs in the browser instead (deps.local(), engines in deps.localStage)
  for (const b of batches(ids, (id) => (byId(id).where === "runner" && deps.local?.() ? "local" : byId(id).where))) {
    if (deps.signal?.aborted) { mark(b.ids, "idle"); continue; }
    if (!ok) { mark(b.ids, "idle"); continue; }
    if (b.where === "local") {
      for (const id of b.ids) {
        if (deps.signal?.aborted || !ok) { mark([id], "idle"); continue; }
        mark([id], "running");
        try {
          const r = await deps.localStage(id, { onLog: (l) => deps.onLog(id, l), onProgress: (f) => deps.onProgress?.(id, f), signal: deps.signal });
          Object.assign(outputs, r.files || {}); deps.onResult?.(id, r);
          if (!r.ok) { ok = false; mark([id], "failed", r.summary?.error); } else mark([id], r.state || "passed", r.info);
        } catch (e) {
          if (deps.signal?.aborted) mark([id], "idle");
          else { ok = false; deps.onLog(id, "ERROR: " + e.message); mark([id], "failed", e.message); }
        }
      }
      continue;
    }
    if (b.where === "runner") {
      if (!deps.hasRunner()) { mark(b.ids, "unavailable", "needs local runner"); continue; }
      mark(b.ids.slice(0, 1), "running");   // the page flips the rest as the job's steps arrive
      try {
        const r = await deps.runnerJob({ from: b.ids[0], to: b.ids[b.ids.length - 1], ids: b.ids });
        ok = r.ok;
        if (r.ok) mark(b.ids, "passed");
        else { const f = Math.max(0, b.ids.indexOf(r.failed)); b.ids.forEach((i, k) => mark([i], k < f ? "passed" : k === f ? "failed" : "idle")); }
      } catch (e) { ok = false; deps.onLog(b.ids[0], "ERROR: " + e.message); mark(b.ids, "failed", e.message); }
      continue;
    }
    const id = b.ids[0]; mark([id], "running");
    let eng;
    try { eng = await deps.engine(byId(id)); }
    catch (e) { mark([id], "unavailable", "engine not available yet"); deps.onLog(id, "WARNING: engine not available yet (" + e.message + ")"); continue; }
    const st = byId(id);
    if (st.src === "sim" && !deps.options().tb) {   // no testbench: skip when part of a flow, say so plainly when run alone
      if (ids.length === 1) { ok = false; deps.onLog(id, "ERROR: No testbench selected. Pick one in Properties → Testbench."); mark([id], "failed", "no testbench"); }
      else { deps.onLog(id, "Simulation skipped: no testbench selected."); mark([id], "unavailable", "skipped: no testbench"); }
      continue;
    }
    const files = st.in ? Object.fromEntries(Object.keys(outputs).filter((f) => st.in.some((p) => (p[0] === "*" ? f.endsWith(p.slice(1)) : f === p))).map((f) => [f, outputs[f]])) : deps.files(id);
    if (st.in && !Object.keys(files).length) { ok = false; deps.onLog(id, "ERROR: nothing to draw yet. Run Synthesis first."); mark([id], "failed", "run Synthesis first"); continue; }
    try {
      let seen = "";
      const r = await eng.run({ files, options: { ...deps.options(), ...st.opts, stage: id },
        onLog: (l) => { seen += l; deps.onLog(id, l); }, onProgress: (f) => deps.onProgress?.(id, f), signal: deps.signal });
      Object.assign(outputs, r.files || {});
      for (const m of r.summary?.messages || []) if (!seen.includes(m.text))   // tool messages the engine did not print must still reach the Console
        deps.onLog(id, (m.severity === "error" ? "ERROR: " : "WARNING: ") + (m.file ? m.file + (m.line ? ":" + m.line : "") + ": " : "") + m.text);
      deps.onResult?.(id, r);
      if (!r.ok) ok = false;
      const sm = r.summary || {}, w = sm.warnings;
      if (!r.ok) mark([id], "failed", sm.error || (sm.errors ? sm.errors + " errors" : undefined));
      else if (w > 0 || /FAIL/.test(sm.stdout || "")) mark([id], "warn", w > 0 ? w + "W" : "tb FAIL");
      else mark([id], "passed");
    } catch (e) {
      if (deps.signal?.aborted) mark([id], "idle");
      else { ok = false; deps.onLog(id, "ERROR: " + e.message); mark([id], "failed", e.message); }
    }
  }
  return { ok, outputs };
}
// A stage that re-ran makes everything after it stale (caller applies this to passed stages).
export const downstream = (id) => STAGES.slice(idx(id) + 1).filter((s) => !s.virtual).map((s) => s.id);
