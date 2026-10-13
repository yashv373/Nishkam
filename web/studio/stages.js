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
  { id: "sta", label: "Timing (STA)", group: 4, where: "runner", tab: "Timing" },
  { id: "signoff", label: "Signoff (DRC/LVS)", group: 4, where: "runner" },
  { id: "reports", label: "Final Reports", group: 5, where: "browser", virtual: true, tab: "Reports" },
];
// Adding a browser engine = one table line above (engine id = file in ./engines/, opts merged into options,
// src: which project files it reads, in: output files of earlier stages it reads instead).
// Engine ids a Properties dropdown may pick that differ from the file name:
const ENGINE_FILE = { "verilator-wasm": "verilator-lint" };
export const engineId = (s, o = {}) => { const e = (s.pick && o[s.pick]) || s.engine; return ENGINE_FILE[e] || e; };
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
export function batches(ids) {
  const out = [];
  for (const id of ids) {
    const w = byId(id).where, last = out[out.length - 1];
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
  for (const b of batches(ids)) {
    if (deps.signal?.aborted) { mark(b.ids, "idle"); continue; }
    if (!ok) { mark(b.ids, "idle"); continue; }
    if (b.where === "runner") {
      if (!deps.hasRunner()) { mark(b.ids, "unavailable", "needs local runner"); continue; }
      mark(b.ids, "running");
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
    const st = byId(id), files = st.in ? Object.fromEntries(st.in.filter((f) => f in outputs).map((f) => [f, outputs[f]])) : deps.files(id);
    if (st.in && !Object.keys(files).length) { ok = false; deps.onLog(id, "ERROR: nothing to draw yet. Run Synthesis first."); mark([id], "failed", "run Synthesis first"); continue; }
    try {
      const r = await eng.run({ files, options: { ...deps.options(), ...st.opts, stage: id },
        onLog: (l) => deps.onLog(id, l), onProgress: (f) => deps.onProgress?.(id, f), signal: deps.signal });
      Object.assign(outputs, r.files || {});
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
