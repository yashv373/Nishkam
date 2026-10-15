// Nishkam Studio: wires the shell together. Heavy things (Monaco, engines, viewers) load on demand.
import { STAGES, byId, plan, runStages, downstream, engineId, stageOf, parseLoose, countCells, MAX_SCHEMATIC_CELLS } from "./stages.js";
import { renderNavigator, HINT } from "./navigator.js";
import { createConsole, createRawConsole } from "./console.js";
import { setRawSink } from "./engines/_rpc.js";
import { createProject } from "./files.js";
import * as R from "./runner-client.js";
import { PROBLEMS } from "../problems.js";
import { createTour } from "./tour.js";
import { sdc } from "./engines/opensta.js";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const TABS = ["Editor", "Schematic", "Waveform", "Layout", "GDS", "Timing", "Reports"];
const project = createProject();
let selected = "files", running = false, abort = null, jobId = null, runnerInfo = null;
const state = {};            // stage id -> {st, info, t}
const outputs = {};          // browser engine output files (path -> string|Uint8Array)
let artifacts = [];          // [{name, get()}]

// ---------- theme + effects ----------
root.dataset.theme = store.get("studio:theme", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
let userFx = store.get("studio:fx", "on");
const applyFx = () => { root.dataset.fx = userFx === "off" || running ? "off" : "on"; $("fx").setAttribute("aria-pressed", userFx === "off"); };
applyFx();
$("fx").onclick = () => { userFx = userFx === "off" ? "on" : "off"; store.set("studio:fx", userFx); applyFx(); };
$("theme").onclick = () => { root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark"; store.set("studio:theme", root.dataset.theme);
  window.monaco?.editor.setTheme(root.dataset.theme === "dark" ? "vs-dark" : "vs"); };

// ---------- options (Properties panel) ----------
const DEF = { lintEngine: "yosys", simEngine: "icarus", top: "shreg4", tb: "tb_shreg4.v", schematic: "rtl", strategy: "AREA 0", clockPort: "clk",
  clockPeriod: 40, inDelay: "", outDelay: "", loadPf: 0.05, pdEngine: "auto", pdTimeout: 120, dieW: 170, dieH: 170, density: 50, congestion: false };
const opts = { ...DEF, ...store.get("studio:opts", {}) };
// studio.html#demo=squeeze-tiny8 : the Practice page's "try it in the browser" link
if (location.hash === "#demo=squeeze-tiny8") {
  const t8 = PROBLEMS.find((x) => x.id === "squeeze-tiny8");
  if (!project.get("tiny8.v")) project.add("tiny8.v", t8.files["tiny8.v"]);
  Object.assign(opts, { top: "tiny8", tb: "", clockPeriod: 24, dieW: 250, dieH: 250, density: 50, pdEngine: "browser" });   // the problem's starting knobs, not the answer
  store.set("studio:opts", opts);
  history.replaceState(null, "", location.pathname + location.search);   // apply once: a reload must not reset the user's knobs
}
const FIELDS = [
  { k: "lintEngine", label: "Lint engine", t: "select", o: [["yosys", "Yosys"], ["verilator-wasm", "Verilator (wasm)"]], st: ["lint"] },
  { k: "simEngine", label: "Simulation engine", t: "select", o: [["icarus", "Icarus Verilog"], ["verilator", "Verilator (coming soon)", true]], st: ["sim"] },
  { k: "top", label: "Top module", t: "text", st: ["lint", "sim", "synth", "schematic", "floorplan", "place", "cts", "route", "sta", "signoff"] },
  { k: "tb", label: "Testbench file", t: "file", st: ["sim"] },
  { k: "strategy", label: "Synthesis strategy", t: "select", o: ["AREA 0", "AREA 1", "AREA 2", "AREA 3", "AREA 4", "DELAY 0", "DELAY 1", "DELAY 2", "DELAY 3", "DELAY 4"], st: ["synth", "floorplan"], rn: true },
  { k: "clockPort", label: "Clock port", t: "text", st: ["synth", "floorplan", "place", "cts", "sta"] },
  { k: "clockPeriod", label: "Clock period (ns)", t: "number", st: ["synth", "floorplan", "cts", "sta"], rn: true },
  { k: "inDelay", label: "Input delay (ns)", t: "number", ph: "empty = 20% of period", st: ["sta", "signoff"] },
  { k: "outDelay", label: "Output delay (ns)", t: "number", ph: "empty = 20% of period", st: ["sta", "signoff"] },
  { k: "loadPf", label: "Output load (pF)", t: "number", st: ["sta", "signoff"] },
  { k: "pdEngine", label: "Physical engine", t: "select", o: [["auto", "Automatic (runner if connected)"], ["runner", "Runner (LibreLane)"], ["browser", "In browser: experimental (qflow tools on gf180)"]], st: ["floorplan", "place", "cts", "route", "sta", "signoff"] },
  { k: "pdTimeout", label: "Browser step time limit (s)", t: "number", st: ["place", "route", "signoff"] },
  { k: "dieW", label: "Die width (um)", t: "number", st: ["floorplan", "place"], rn: true },
  { k: "dieH", label: "Die height (um)", t: "number", st: ["floorplan", "place"], rn: true },
  { k: "density", label: "Target density (%)", t: "number", st: ["place"], rn: true },
  { k: "congestion", label: "Allow routing congestion", t: "check", st: ["route"], rn: true },
];
function buildProps() {
  const b = $("propsBody"); b.replaceChildren();
  for (const f of FIELDS) {
    const d = document.createElement("div"); d.className = "fld" + (f.t === "check" ? " chk" : ""); d.dataset.k = f.k;
    const l = document.createElement("label"); l.textContent = f.label; l.htmlFor = "o_" + f.k;
    let inp;
    if (f.t === "select" || f.t === "file") {
      inp = document.createElement("select");
      const items = f.t === "file" ? project.list().map((n) => [n, n]) : f.o.map((x) => (Array.isArray(x) ? x : [x, x]));
      for (const [v, t, dis] of items) { const o = new Option(t, v); o.disabled = !!dis; inp.add(o); }
      inp.value = opts[f.k];
      if (f.t === "file" && !project.list().includes(opts[f.k])) inp.value = project.list().find(project.isTb) || "";
    } else {
      inp = document.createElement("input"); if (f.ph) inp.placeholder = f.ph; inp.type = f.t === "check" ? "checkbox" : f.t === "number" ? "number" : "text";
      if (f.t === "check") inp.checked = opts[f.k]; else inp.value = opts[f.k];
    }
    inp.id = "o_" + f.k;
    inp.onchange = () => { opts[f.k] = f.t === "check" ? inp.checked : f.t === "number" ? (inp.value === "" ? "" : +inp.value) : inp.value; store.set("studio:opts", opts);
      if (f.rn) markStale(); };
    if (f.t === "check") d.append(Object.assign(l, {}), inp), l.prepend(inp); else d.append(l, inp);
    if (f.rn) { const s = document.createElement("small"); s.textContent = "runner setting"; d.append(s); }
    b.append(d);
  }
  filterProps();
}
function filterProps() {
  const all = selected === "files" || selected === "reports";
  document.querySelectorAll("#propsBody .fld").forEach((d) => { d.hidden = !all && !FIELDS.find((f) => f.k === d.dataset.k).st.includes(selected); });
}
$("propsToggle").onclick = () => $("props").classList.toggle("closed");
// Runner knobs: ONLY the runner allowlist (CLOCK_PERIOD, DIE_AREA, PL_TARGET_DENSITY_PCT, SYNTH_STRATEGY, GRT_ALLOW_CONGESTION).
const pdLocal = () => opts.pdEngine === "browser" || (opts.pdEngine !== "runner" && !runnerInfo);
const knobs = () => ({ CLOCK_PERIOD: opts.clockPeriod, DIE_AREA: [0, 0, opts.dieW, opts.dieH], PL_TARGET_DENSITY_PCT: opts.density,
  SYNTH_STRATEGY: opts.strategy, GRT_ALLOW_CONGESTION: !!opts.congestion });
const markStale = () => { for (const s of STAGES) if (state[s.id]?.st === "passed" || state[s.id]?.st === "warn") state[s.id].st = "stale"; drawNav(); };

// ---------- console ----------
const cons = createConsole({ logEl: $("log"), msgEl: $("msgs"), msgCount: $("msgCount"), filterEl: $("filterTxt"), timerEl: $("timer"),
  shellRow: $("shellRow"), onShell: (cmd, out) => R.shell(cmd, out).catch((e) => out("ERROR: " + e.message)) });
const raw = createRawConsole({ el: $("rawlog"), selectEl: $("rawTool"), noteEl: $("rawNote") });
setRawSink((tool, chunk, stream, callId, begin) => raw.add(tool, chunk, stream, callId, begin));
$("rawDl").onclick = () => { const t = raw.tool, u = URL.createObjectURL(new Blob([raw.text(t)], { type: "text/plain" }));
  const l = Object.assign(document.createElement("a"), { href: u, download: (t || "all-tools") + ".raw.log.txt" }); l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); };
$("filterTxt").onclick = () => cons.setFilter("");
$("clearLog").onclick = () => { cons.clear(); raw.clear(); };
$("shellRow").onsubmit = (e) => { e.preventDefault(); const v = $("shellIn").value.trim(); if (v) { $("shellIn").value = ""; cons.shellSubmit(v); } };
document.querySelectorAll("#dockTabs [data-d]").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#dockTabs [data-d]").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".dockv").forEach((v) => v.hidden = v.dataset.d !== b.dataset.d);
  if (b.dataset.d === "Files") drawArts();
});
(() => { const dr = $("dragger"), dock = $("dock");   // resizable dock
  dr.onpointerdown = (e) => { dr.setPointerCapture(e.pointerId);
    const move = (m) => { dock.style.height = Math.max(80, Math.min(innerHeight - 250, innerHeight - m.clientY)) + "px"; };
    dr.addEventListener("pointermove", move); dr.addEventListener("pointerup", () => dr.removeEventListener("pointermove", move), { once: true }); }; })();
function drawArts() {
  const el = $("arts"); el.replaceChildren();
  if (!artifacts.length) return void (el.textContent = "No artifacts yet. Run a stage, or load the demo run.");
  for (const a of artifacts) { const d = document.createElement("div"); d.className = "art"; d.textContent = a.name; d.onclick = async () => {
    const data = await a.get(); const u = URL.createObjectURL(new Blob([data])); const l = Object.assign(document.createElement("a"), { href: u, download: a.name.split("/").pop() });
    l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }; el.append(d); }
}

// ---------- navigator ----------
const menu = (id, x, y) => {
  document.getElementById("ctx")?.remove();
  const m = Object.assign(document.createElement("div"), { id: "ctx" }); m.style.left = x + "px"; m.style.top = y + "px";
  for (const [t, mode] of [["Run this stage", "one"], ["Run up to here", "to"], ["Re-run from here", "from"]]) {
    const b = document.createElement("button"); b.textContent = t; b.onclick = () => { m.remove(); start(plan(mode, id)); }; m.append(b); }
  document.body.append(m); setTimeout(() => addEventListener("click", () => m.remove(), { once: true }));
};
function drawNav() {
  renderNavigator($("nav"), state, selected, { select, run: (id) => start(plan("one", id)), menu }, (R.hasConn() && !!runnerInfo) || pdLocal());
}
function select(id) {
  selected = id; cons.setFilter(id === "files" || id === "reports" ? "" : id); filterProps(); drawNav();
  const t = byId(id).tab || (id === "files" || id === "lint" || id === "synth" ? "Editor" : null); if (t) showTab(t);
}
function setState(id, st, info) {
  const prev = state[id]?.st;
  state[id] = { st, info: typeof info === "string" ? info : undefined, t: 0, t0: st === "running" ? Date.now() : 0 };
  if (st === "running") for (const d of downstream(id)) if (["passed", "warn"].includes(state[d]?.st)) state[d].st = "stale";
  if (st === "passed" || st === "warn") cons.settle(id);
  if (st === "running" && HINT[id]) cons.log(id, `${byId(id).label}: ${HINT[id]}`);
  if (st === "passed" && prev === "running") { cons.log(id, `${byId(id).label} passed.`); }
  if (st === "unavailable") cons.log(id, `${byId(id).label}: ${info || "needs local runner"}`);
  drawNav(); setProgress();
}
let planned = [], frac = 0;
function setProgress() {
  const done = planned.filter((i) => ["passed", "warn", "failed", "unavailable"].includes(state[i]?.st)).length;
  $("progress").firstElementChild.style.transform = `scaleX(${planned.length ? Math.min(1, (done + frac) / planned.length) : 0})`;
}
setInterval(() => { if (!running) return; let ch = false;
  for (const v of Object.values(state)) if (v.st === "running") { v.t = Math.round((Date.now() - v.t0) / 1000); ch = true; }
  if (ch) drawNav(); }, 1000);

// ---------- center tabs + viewers ----------
const viewers = {};   // tab -> {inst}
let curTab = "Editor";
const ctx = { metrics: null, source: null, files: [], getFile: async () => { throw new Error("no data"); }, listFiles: async () => ctx.files,
  openTab: (n) => showTab(n), log: (l) => cons.log("viewer", l) };
function buildTabs() {
  $("tabs").replaceChildren(...TABS.map((t) => { const b = document.createElement("button"); b.textContent = t; b.setAttribute("role", "tab");
    b.onclick = () => showTab(t); b.dataset.t = t; return b; }));
}
function emptyCard(el, title, text, demo, act) {
  el.replaceChildren(); const c = document.createElement("div"); c.className = "empty";
  c.innerHTML = "<h3></h3><p></p>"; c.firstChild.textContent = title; c.children[1].textContent = text;
  if (demo) { const b = document.createElement("button"); b.textContent = "Load demo run"; b.onclick = loadDemo; c.append(b); }
  if (act) { const b = document.createElement("button"); b.className = "primary"; b.textContent = act[0]; b.onclick = act[1]; c.append(b); }
  el.append(c);
}
const BNOTE = { Timing: "Browser timing: one corner (typical, 25 °C, 5 V) and an ideal clock before layout and a real clock tree (OpenROAD TritonCTS) after routing. Wire delays come from Magic's extraction.",
  Layout: "Browser place and route (graywolf, qrouter) does not optimise for timing; results will differ from an OpenROAD run." };
BNOTE.GDS = BNOTE.Layout;
function bnote(t) {   // short grey note on browser-made results; runner / demo results stay unlabelled
  const el = view(t), old = el?.querySelector(":scope > .bnote"); old?.remove();
  if (el && BNOTE[t] && ctx.source === "browser") el.prepend(h("div", "bnote", BNOTE[t]));
}
async function showTab(t) { await showTab0(t); bnote(t); }
async function showTab0(t) {
  curTab = t;
  document.querySelectorAll("#tabs button").forEach((b) => { b.classList.toggle("on", b.dataset.t === t); b.setAttribute("aria-selected", b.dataset.t === t); });
  document.querySelectorAll(".view").forEach((v) => v.hidden = v.dataset.v !== t);
  const el = document.querySelector(`.view[data-v="${t}"]`);
  if (t === "Reports") repWrap(el), repCard();
  if (t === "Timing" && !ctx.source) { emptyCard(el, "No timing yet", NO_STA, false, ["Run Timing (STA)", () => start(plan("to", "sta"))]); return; }
  if (["Layout", "GDS", "Timing", "Reports"].includes(t)) {
    if (viewers[t]) return viewers[t].inst.update?.(ctx);
    const host = t === "Reports" ? $("repHost") : el;
    try {
      const m = await import(`./viewers/${t.toLowerCase()}.js`);
      host.replaceChildren(); viewers[t] = { inst: await m.mount(host, ctx) };
    } catch (e) { emptyCard(el, t + " viewer not available yet", "The viewer module is not in this build. " + (ctx.source ? "" : "You can still load the demo data once it ships."), true); }
  } else if (t === "Schematic" && !el.firstChild) emptyCard(el, "No schematic yet", "Run Synthesis and then Schematic.", false);
  else if (t === "Waveform" && !el.firstChild) emptyCard(el, "No waveform yet", "Run Simulation. The testbench must write a VCD with $dumpfile.", false);
  if (t === "Editor") editor?.layout();
}
async function loadDemo() {
  try {
    const base = "./studio/demo/";
    ctx.metrics = parseLoose(await (await fetch(base + "final/metrics.json")).text());
    const fl = await (await fetch(base + "files.json")).json(); ctx.files = Array.isArray(fl) ? fl : fl.files || [];
    ctx.source = "demo"; ctx.staInfo = null;
    ctx.getFile = async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error("missing " + p);
      return /\.(gds|png|odb|oas|zip)$/i.test(p) ? r.arrayBuffer() : r.text(); };
    artifacts = ctx.files.map((n) => ({ name: n, get: () => ctx.getFile(n) }));
    cons.log("viewer", "Loaded demo run (" + ctx.files.length + " files).");
    for (const v of Object.values(viewers)) v.inst.update?.(ctx);
    await showTab(["Layout", "GDS", "Timing", "Reports"].includes(curTab) ? curTab : "Reports");
    if (viewers[curTab]) viewers[curTab].inst.update?.(ctx);
  } catch (e) { cons.log("viewer", "WARNING: demo data not available: " + e.message); }
}

// ---------- browser-engine outputs shown in tabs ----------
const view = (n) => document.querySelector(`.view[data-v="${n}"]`);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const sum = { phys: {}, sta: {} };   // browser results for the Reports card: synth / timing / power
// Timing needs a real STA tool. Nothing in the browser computes timing today (no home-made estimator).
const NO_STA = "Run the Timing (STA) stage. OpenSTA runs here in your browser.";
const STA_LABEL = { "pre-layout": "pre-layout (ideal clock, no wires)", "post-route": "post-route (wires from Magic extraction; real clock tree from CTS)" };
let wave = null;

function physRows() {
  const { place: p, route: r, signoff: g } = sum.phys; if (!p && !r && !g) return null;
  const ms = (x) => (x?.ms == null ? "n/a" : (x.ms / 1000).toFixed(1) + " s");
  const rows = [];
  if (p) {
    const dbu = +(((() => { const x = outputs[`browser/place/${p.top}.def`] || ""; return typeof x === "string" ? x : new TextDecoder().decode(x); })().match(/UNITS DISTANCE MICRONS (\d+)/) || [])[1] || 0);
    const d = (p.die.match(/-?\d+/g) || []).map(Number), um = (v) => (dbu ? (v / dbu).toFixed(1) : v);
    rows.push(["Components (cells + fill)", p.components], ["Die", d.length === 4 ? `${um(d[2] - d[0])} x ${um(d[3] - d[1])} ${dbu ? "µm" : "DEF units"}` : "n/a"], ["Placement time", ms(p)]);
  }
  if (r) rows.push(["Failed nets", r.failedNets], ["Routing time", ms(r)]);
  if (g) rows.push(["DRC error tiles", g.drcErrors], ["  inside library cells", g.drcInCells], ["  from the layout", g.drcFromLayout], ["GDS size", (g.gdsBytes / 1024).toFixed(1) + " KB"], ["Magic time", ms(g)]);
  if (g?.lvs) rows.push(["LVS", g.lvs.error ? "not run: " + g.lvs.error : g.lvs.match ? "match" : "MISMATCH: " + g.lvs.result], ...(g.lvs.devices ? [["  devices (layout / netlist)", g.lvs.devices.join(" / ")], ["  nets (layout / netlist)", g.lvs.nets.join(" / ")]] : []));
  return rows;
}
// Reports tab = our summary card on top, the metrics viewer below it.
function repWrap(el) { if (!$("repHost")) { el.replaceChildren(h("div", "repcard"), Object.assign(h("div", "rephost"), { id: "repHost" })); el.firstChild.id = "repCard"; } }
function repCard() {
  const c = $("repCard"); if (!c) return;
  const card = (title, rows, note) => { const d = h("div", "rcard"); d.append(h("h4", "", title));
    if (!rows) d.append(h("p", "muted", note));
    else { const t = h("div", "kv"); for (const [k, v] of rows) t.append(h("span", "", k), h("b", "", v)); d.append(t); }
    return d; };
  const f = (v, u = "", n = 2) => (v == null ? "n/a" : (+v).toFixed(n).replace(/\.?0+$/, "") + u);
  const M = ctx.source === "runner" || ctx.source === "demo" ? ctx.metrics : null;   // only real LibreLane numbers
  const runnerTiming = () => M && M["timing__setup__ws"] != null && [["Setup worst slack", f(M["timing__setup__ws"], " ns", 3)], ["Setup TNS", f(M["timing__setup__tns"], " ns", 3)], ["Hold worst slack", f(M["timing__hold__ws"], " ns", 3)], ["Hold TNS", f(M["timing__hold__tns"], " ns", 3)]];
  const runnerPower = () => M && M["power__total"] != null && [["Total", f(M["power__total"] * 1e3, " mW", 4)], ["Leakage", f(M["power__leakage__total"] * 1e6, " µW", 4)], ["Internal", f(M["power__internal__total"] * 1e3, " mW", 4)], ["Switching", f(M["power__switching__total"] * 1e3, " mW", 4)]];
  const staRows = (fn) => { const e = Object.entries(sum.sta); return e.length ? e.flatMap(([k, x]) => x.error ? [[k, "OpenSTA error, see the Timing tab"]] : fn(x.summary).map(([a, b]) => [k + " " + a, b])) : null; };
  const sy = sum.synth;
  c.replaceChildren(
    card("Synthesis report", sy && [["Cells", sy.cells ?? "n/a"], ["Area", f(sy.area, " µm²")], ...(sy.kinds || []).slice(0, 12).map(([k, n]) => [k, n])], "Run Synthesis to see cell count, area and cell kinds."),
    card(M ? "Timing (OpenSTA via LibreLane)" : "Timing (OpenSTA in browser)", runnerTiming() || staRows((x) => [["setup worst slack", f(x.setup_ws_ns, " ns", 3)], ["setup TNS", f(x.setup_tns_ns, " ns", 3)], ["hold worst slack", f(x.hold_ws_ns, " ns", 3)], ["hold TNS", f(x.hold_tns_ns, " ns", 3)]]), NO_STA),
    card("Physical (in browser, experimental). " + NOT_LL, physRows(), "Run Placement, Routing and Signoff with no runner connected (or pick Physical engine: In browser)."),
    card(M ? "Power (via LibreLane)" : "Power (OpenSTA, default switching activity)", runnerPower() || staRows((x) => [["total", f(x.total_uW, " µW", 4)], ["internal", f(x.internal_uW, " µW", 4)], ["switching", f(x.switching_uW, " µW", 4)], ["leakage", f(x.leakage_uW, " µW", 4)]]), NO_STA));
  if (!M && Object.keys(sum.sta).length) c.children[1].append(h("p", "muted", BNOTE.Timing));
}

// Schematic: SVG in an <img>, wheel zoom + drag pan by CSS transform.
function showSchematic(svg) {
  const el = view("Schematic"); el.replaceChildren();
  const bar = h("div", "sbar");
  for (const [k, t] of [["rtl", "RTL (readable)"], ["gate", "Gate level"]]) { const b = h("button", opts.schematic === k ? "on" : "", t);
    b.onclick = () => { if (running) return; opts.schematic = k; store.set("studio:opts", opts); start(["schematic"]); }; bar.append(b); }
  const vp = h("div", "svp"), inner = h("div", "sin");
  inner.append(Object.assign(new Image(), { src: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })), alt: "Schematic", draggable: false }));
  vp.append(inner); el.append(bar, vp);
  let k = 1, x = 0, y = 0; const put = () => { inner.style.transform = `translate(${x}px,${y}px) scale(${k})`; };
  vp.onwheel = (e) => { e.preventDefault(); const r = vp.getBoundingClientRect(), f = e.deltaY < 0 ? 1.15 : 1 / 1.15, px = e.clientX - r.left, py = e.clientY - r.top;
    x = px - (px - x) * f; y = py - (py - y) * f; k *= f; put(); };
  vp.onpointerdown = (e) => { vp.setPointerCapture(e.pointerId); const sx = e.clientX - x, sy = e.clientY - y;
    const mv = (m) => { x = m.clientX - sx; y = m.clientY - sy; put(); }; vp.addEventListener("pointermove", mv);
    vp.addEventListener("pointerup", () => vp.removeEventListener("pointermove", mv), { once: true }); };
}

// Surfer may drop a message sent before its wasm is ready, so send the VCD a few times.
async function showWave(vcd) {
  const el = view("Waveform"); wave?.destroy(); el.replaceChildren();
  try {
    await showTab("Waveform"); el.replaceChildren();   // Surfer must be visible when it starts, or its canvas is 0x0
    const w = wave = (await import("./engines/surfer.js")).mount(el);
    for (const d of [0, 1500, 4000]) setTimeout(() => { if (w === wave) w.load(vcd).catch(() => {}); }, d);
  } catch (e) { emptyCard(el, "Waveform viewer not available yet", "VCD saved in Files / Artifacts."); }
}

// Make the in-memory browser job files visible to the Layout / GDS viewers next to any runner files.
function regBrowser(paths) {
  const old = ctx.getFile;
  if (!ctx.files.some((p) => p.startsWith("browser/"))) ctx.getFile = async (p) => (p.startsWith("browser/") ? (typeof outputs[p] === "string" ? outputs[p] : outputs[p].slice().buffer) : old(p));
  ctx.files = [...ctx.files.filter((p) => !paths.includes(p)), ...paths];
  const rank = (x) => (/^browser\/route\//.test(x) ? 2 : /^browser\/cts\//.test(x) ? 1 : 0);
  ctx.files.sort((x, y) => rank(x) - rank(y));   // viewer opens the last DEF: routed, else clock tree, else placed
  for (const v of Object.values(viewers)) v.inst.update?.(ctx);
}
// Browser OpenSTA results -> Timing viewer (corners "pre-layout" / "post-route" in the report-path layout it already reads) + Reports cards.
function staShow(r, id) {
  for (const x of r.staRuns) sum.sta[x.key] = x;
  const e = Object.entries(sum.sta);
  if (!ctx.source || ctx.source === "browser") {
    ctx.source = "browser";
    ctx.metrics = Object.fromEntries(e.filter(([, x]) => x.summary).flatMap(([k, x]) => [[`timing__setup__ws__corner:${k}`, x.summary.setup_ws_ns], [`timing__hold__ws__corner:${k}`, x.summary.hold_ws_ns]]));
    ctx.staInfo = Object.fromEntries(e.map(([k, x]) => [k, { label: x.label, sdc: x.sdc, error: x.error, n: x.n, power: x.summary && x.summary.total_uW }]));
  }
  const paths = Object.keys(r.files || {}).filter((p) => p.startsWith("browser/"));
  if (id === "sta") { regBrowser(paths); showTab("Timing"); }
  else { for (const v of Object.values(viewers)) v.inst.update?.(ctx); bnote(curTab); }
}
async function onResult(id, r) {
  for (const [p, d] of Object.entries(r.files || {})) { outputs[p] = d; if (!artifacts.some((a) => a.name === p)) artifacts.push({ name: p, get: async () => outputs[p] }); }
  const sm = r.summary || {};
  if (["place", "cts", "route", "signoff"].includes(id) && Object.keys(r.files || {}).some((p) => p.startsWith("browser/"))) {
    sum.phys[id] = sm; regBrowser(Object.keys(r.files).filter((p) => p.startsWith("browser/")));
    showTab(id === "signoff" ? "GDS" : "Layout");
  }
  if (id === "synth" && r.ok) sum.synth = sm;
  if (r.staRuns) staShow(r, id);
  repCard();
  if (id === "schematic") {
    const svg = Object.entries(r.files || {}).find(([p]) => p.endsWith(".svg"));
    if (svg) { showSchematic(svg[1]); showTab("Schematic"); }
    else if (sm.tooLarge) { cons.log(id, `WARNING: ${sm.tooLarge} cells is too many to draw (limit ${MAX_SCHEMATIC_CELLS}). Try the RTL view.`);
      emptyCard(view("Schematic"), "Too large to draw", `${sm.tooLarge} cells (limit ${MAX_SCHEMATIC_CELLS}). Use the RTL view or a smaller top module.`); showTab("Schematic"); }
  }
  if (id === "sim") {
    const vcd = Object.entries(r.files || {}).find(([p]) => p.endsWith(".vcd"));
    if (!vcd) return emptyCard(view("Waveform"), "No waveform", "The testbench did not write a VCD. Add $dumpfile and $dumpvars.", false);
    await showWave(vcd[1]);
  }
}

// Engine loader: one file per engine id. The schematic gets a size guard and the RTL/gate-level pick.
async function loadEngine(s) {
  const m = await import(`./engines/${engineId(s, opts)}.js`);
  if (s.id !== "schematic") return m;
  return { run: (a) => {
    const file = opts.schematic === "gate" && a.files["netlist.json"] ? "netlist.json" : a.files["rtl.json"] ? "rtl.json" : Object.keys(a.files)[0];
    const n = countCells(a.files[file]);
    if (n > MAX_SCHEMATIC_CELLS) return { ok: true, files: {}, summary: { tooLarge: n } };
    return m.run({ ...a, files: { [file]: a.files[file] }, options: { ...a.options, file } }); } };
}
// ---------- in-browser physical design (qflow-style: graywolf + qrouter + Magic), used when no runner is connected ----------
const PD = {};   // raw engine files between stages: place -> route -> magic
const NOT_LL = "Experimental: qflow tools (graywolf, qrouter, Magic) on gf180, not LibreLane signoff. The qflow setup shipped in the PDK is outdated (it names cells such as dffq_x1 that do not exist), so Nishkam drives the tools itself.";
// Cells qrouter cannot reach on gf180 7t (xor2_1 pin A1 unreachable, and4_1 stub short): kept out of synthesis for the browser physical path only.
const QROUTER_DONT_USE = ["xor2_1", "and4_1", "oai21_1", "oai22_1", "oai31_1", "oai32_1", "oai33_1", "oai211_1", "oai221_1", "oai222_1"].map((c) => "gf180mcu_fd_sc_mcu7t5v0__" + c);
const BROWSER_PD_CELLS = 5000;   // measured: a registered 20x20 multiplier (5260 cells with clock-tree room) places and routes with 0 failed nets in ~2 min
const pre = (dir, files) => Object.fromEntries(Object.entries(files).map(([n, d]) => [`browser/${dir}/${n}`, d]));
// qrouter names nets like the DEF: user names stay, yosys internals (_12_, $abc...) are called "internal net".
const routeMsg = (s) => { const nm = (s.failedNames || []).map((n) => (/^[_$]/.test(n) ? "internal net" : n)), shown = [...new Set(nm)].slice(0, 6).join(", ");
  return `qrouter could not route ${s.failedNets} nets${shown ? " (" + shown + (nm.length > 6 ? ", ..." : "") + ")" : ""}. The browser router has no die or density setting (the die is sized automatically). Try another Synthesis strategy in Properties, or use the local runner (LibreLane).`; };
// SDC from Properties: delays default to 20% of the period like LibreLane.
const staOpts = () => {
  const p = +opts.clockPeriod; if (!(p > 0)) throw new Error("Set a clock period above 0 in Properties.");
  const d = (v) => (v === "" || v == null ? +(p * 0.2).toFixed(4) : +v);
  return { top: opts.top, clockPort: opts.clockPort, periodNs: p, inputDelayNs: d(opts.inDelay), outputDelayNs: d(opts.outDelay), loadPf: opts.loadPf === "" || opts.loadPf == null ? 0 : +opts.loadPf };
};
let staN = 0;
async function staRun(key, files, io, propagated = false) {
  const o = { ...staOpts(), propagated }, x = { key, label: STA_LABEL[key], sdc: sdc(o), n: ++staN };
  try {
    const r = await (await import("./engines/opensta.js")).run({ files, options: o, onLog: io.onLog, onProgress: io.onProgress, signal: io.signal });
    x.summary = r.summary;
    const f = r.files, rd = `browser/sta/stapostpnr/${key}/`, ot = `browser/sta/${key}/`;
    return { x, files: { [rd + "max.rpt"]: f["max.rpt"], [rd + "min.rpt"]: f["min.rpt"], [ot + "timing.rpt"]: f["timing.rpt"], [ot + "power.rpt"]: f["power.rpt"], [ot + "constraints.sdc"]: f["constraints.sdc"] } };
  } catch (e) { if (e.name === "AbortError") throw e; x.error = e.message; return { x, files: {} }; }
}
async function localStage(id, io) {
  const top = opts.top, need = (v, what) => { if (!v) throw new Error(`Run ${what} first.`); return v; };
  if (id === "floorplan") { io.onLog("Floorplan is part of Placement in the browser flow (the die is sized from the cells). " + NOT_LL); return { ok: true, info: "in placement" }; }
  if (id === "sta") {
    sum.sta = {};
    const { x, files } = await staRun("pre-layout", { [top + ".v"]: need(outputs["netlist.v"], "Synthesis") }, io);
    if (x.error) io.onLog("ERROR: OpenSTA (" + x.key + "):\n" + x.error);
    return { ok: !x.error, files, staRuns: [x], summary: x.error ? { error: x.error.split("\n")[0] } : x.summary };
  }
  const eng = { place: "place", cts: "cts", route: "route", signoff: "magic" }[id];
  const m = await import(`./engines/${eng}.js`);
  const a = { onLog: io.onLog, onProgress: io.onProgress, signal: io.signal };
  let r;
  if (id === "place") {
    const nc = (need(outputs["netlist.v"], "Synthesis").match(/^\s*gf180mcu_\w+\s+\S+\s*\(/gm) || []).length;
    if (nc > BROWSER_PD_CELLS) io.onLog(`WARNING: ${nc} cells. In-browser place and route is for small designs: it was routed cleanly up to about ${BROWSER_PD_CELLS} cells (about 2 minutes) and is untested above that. For larger designs use the local runner (LibreLane).`);
  }
  if (id === "place") r = await m.run({ ...a, files: { [top + ".v"]: need(outputs["netlist.v"], "Synthesis") }, options: { top, timeoutS: opts.pdTimeout, headroom: [0.1, 600] } });
  else if (id === "cts") {   // placed DEF + the same SDC as Timing -> DEF with the clock tree and a netlist that has the clock buffers
    const pl = need(PD.place, "Placement");
    r = await m.run({ ...a, files: { [top + ".def"]: pl[top + ".def"], [top + ".v"]: need(outputs["netlist.v"], "Synthesis"), "constraints.sdc": sdc(staOpts()) }, options: { top, timeoutS: opts.pdTimeout } });
  } else if (id === "route") r = await m.run({ ...a, files: { ...need(PD.place, "Placement"), ...PD.cts }, options: { top, timeoutS: opts.pdTimeout } });
  else r = await m.run({ ...a, files: need(PD.route, "Routing"), options: { top, drc: true, extract: true, rc: true, timeoutS: opts.pdTimeout } });
  if (id === "route" && !r.ok && r.summary?.failedNets > 0) r.summary.error = routeMsg(r.summary);
  const sm = r.summary || {};
  if (id === "signoff" && r.ok) {   // LVS: Magic layout SPICE vs the Yosys gate netlist. A mismatch is a warning, not a crash.
    try {
      const l = await (await import("./engines/lvs.js")).run({ ...a, files: { [top + ".spice"]: r.files[top + ".spice"], [top + ".v"]: PD.cts?.[top + "_cts.v"] || need(outputs["netlist.v"], "Synthesis") }, options: { top, timeoutS: opts.pdTimeout } });
      sm.lvs = l.summary; Object.assign(r.files, l.files);
    } catch (e) { sm.lvs = { error: e.message }; io.onLog("WARNING: LVS did not run: " + e.message); }
  }
  if (r.ok) PD[id === "signoff" ? "magic" : id] = id === "cts" ? { [top + ".def"]: r.files[top + ".def"], [top + "_cts.v"]: r.files[top + "_cts.v"] } : r.files;
  if (id === "place") delete PD.cts;   // a new placement makes the old clock tree stale
  const out = { ...r, files: pre(id, r.files) };
  if (id === "cts") { delete out.files[`browser/cts/${top}_cts.v`]; out.files[`browser/cts/${top}.v`] = r.files[top + "_cts.v"]; }
  if (id === "signoff") {
    // post-route OpenSTA: the Yosys netlist (net names match the DEF/SPEF) + Magic's SPEF; same SDC as pre-layout. An error is shown as is, never replaced by numbers.
    const sp = r.files[top + ".spef"];
    const cn = PD.cts?.[top + "_cts.v"];   // netlist with the clock buffers: its names match the routed DEF and the SPEF
    const p = sp ? await staRun("post-route", { [top + ".v"]: cn || need(outputs["netlist.v"], "Synthesis"), [top + ".spef"]: sp }, io, !!cn)
      : { x: { key: "post-route", label: STA_LABEL["post-route"], sdc: sdc(staOpts()), error: "Magic wrote no SPEF, so there are no extracted wires to give OpenSTA." }, files: {} };
    if (p.x.error) io.onLog("ERROR: OpenSTA (post-route):\n" + p.x.error);
    Object.assign(out.files, p.files); out.staRuns = [p.x];
    const v = sm.lvs, lvs = !v || v.error ? "LVS not run" : v.match ? "LVS match" : "LVS MISMATCH";
    if (sm.drcErrors > 0 || !v || v.error || !v.match || p.x.error) { out.state = "warn"; out.info = `${sm.drcErrors} DRC tiles, ${lvs}${p.x.error ? ", post-route STA failed" : ""}`; }
  }
  return out;
}
// Which project files a stage reads: no testbenches, except the chosen one for simulation.
const filesFor = (id) => Object.fromEntries(Object.entries(project.all()).filter(([n]) => !project.isTb(n) || (byId(id).src === "sim" && n === opts.tb)));

// ---------- runner ----------
async function checkRunner() {
  if (!R.hasConn()) return setRunner(null);
  try { setRunner(await R.health()); } catch { setRunner(null); }
}
function setRunner(info) {
  runnerInfo = info;
  const chip = $("runnerChip"); chip.className = "chip " + (info ? "st-passed" : "st-idle");
  $("runnerTxt").textContent = info ? "runner: " + (info.container || "on") : "runner off";
  cons.enableShell(!!(info && (info.shell || info.allow_shell || info.shell_enabled)));
  drawNav();
}
R.loadConn(); checkRunner(); setInterval(checkRunner, 10000);
$("runnerChip").onclick = () => runnerInfo ? checkRunner() : $("runnerDlg").showModal();
$("linkCancel").onclick = () => $("runnerDlg").close();
$("linkOk").onclick = () => { if (R.connectFromLink($("linkIn").value)) { $("runnerDlg").close(); checkRunner(); } else $("linkErr").textContent = "That link has no runner and token. Copy the whole link the runner printed."; };

let lastJob = null;   // finished job id; later stages resume its run folder
async function runnerJob({ from, to, ids }) {
  const body = { top: opts.top, clock_port: opts.clockPort, knobs: knobs(), from, to };
  if (from === "floorplan") body.files = Object.fromEntries(Object.entries(project.all()).filter(([n]) => !project.isTb(n)));
  else if (lastJob) body.resume = lastJob;
  else throw new Error("Run Floorplan first: later stages continue from a finished run.");
  const j = await R.startJob(body);
  jobId = j.id; let off = 0, misses = 0, s, hi = -1;
  if (body.resume) { let c; do { c = await R.logChunk(jobId, off); off = c.next; } while (c.text); }   // skip the old log
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (abort?.signal.aborted) throw new Error("stopped (the runner keeps the job going in the container)");
    try {
      const c = await R.logChunk(jobId, off); off = c.next; if (c.text) { cons.log(ids[0], c.text); raw.add("librelane", c.text, "out", jobId); }
      s = await R.jobStatus(jobId); misses = 0;
    } catch (e) { if (++misses < 5) continue; throw new Error("runner disconnected: " + e.message); }
    // steps do not map to stages in order (resizer steps recur), so only ever move forward
    hi = Math.max(hi, ids.indexOf(stageOf(s.current_step || (s.finished_steps || []).slice(-1)[0]))); const ci = hi;
    if (ci >= 0 && s.state === "running") ids.forEach((i, k) => { const w = k < ci ? "passed" : k === ci ? "running" : null; if (w && state[i]?.st !== w) setState(i, w); });
    if (s.state === "done" || s.state === "failed") break;
  }
  lastJob = jobId;
  if (s.state === "done" || s.metrics) {
    try { ctx.metrics = await R.jobMetrics(jobId); } catch { ctx.metrics = s.metrics || null; }
    try { ctx.files = await R.jobFiles(jobId); } catch { ctx.files = []; }
    const id = jobId; ctx.source = "runner"; ctx.staInfo = null; ctx.getFile = (p) => R.jobFile(id, p, /\.(gds|png|odb|oas|zip)$/i.test(p));
    artifacts = ctx.files.map((n) => ({ name: n, get: () => ctx.getFile(n) }));
    for (const v of Object.values(viewers)) v.inst.update?.(ctx);
  }
  return { ok: s.state === "done", failed: stageOf(s.current_step) };
}

// ---------- run control ----------
async function start(ids) {
  if (running || !ids.length) return;
  hideGuide();
  running = true; abort = new AbortController(); planned = ids; frac = 0; applyFx();
  $("stop").disabled = false; ["runAll", "runTo", "runOne"].forEach((b) => $(b).disabled = true);
  syncFromEditor(); cons.startTimer();
  const res = await runStages(ids, { hasRunner: () => !!runnerInfo, signal: abort.signal, files: filesFor, seed: outputs,
    options: () => ({ ...opts, knobs: knobs(), ...(pdLocal() ? { dontUse: QROUTER_DONT_USE } : {}) }), setState, onLog: (id, l) => cons.log(id, l),
    onProgress: (id, f) => { frac = f; setProgress(); }, onResult,
    engine: loadEngine, runnerJob, local: pdLocal, localStage });
  running = false; abort = null; frac = 0; applyFx(); cons.stopTimer();
  $("stop").disabled = true; ["runAll", "runTo", "runOne"].forEach((b) => $(b).disabled = false);
  if (res.ok) { setState("files", "passed", "ready"); setState("reports", "passed", "ready"); }   // the two collecting pages have nothing to run
  setProgress(); drawNav();
  const nav = $("nav").querySelector(".stage.st-passed:last-of-type"); if (res.ok && nav) { nav.classList.add("flash"); setTimeout(() => nav.classList.remove("flash"), 1300); }
}
$("runAll").onclick = () => start(plan("all"));
$("runTo").onclick = () => start(plan("to", selected));
$("runOne").onclick = () => start(plan("one", selected));
$("stop").onclick = () => abort?.abort();
$("projName").value = project.name; $("projName").onchange = (e) => { project.name = e.target.value; };

// ---------- palette ----------
const CMDS = [["Run All", () => start(plan("all"))], ["Run to selected stage", () => start(plan("to", selected))], ["Run selected stage", () => start(plan("one", selected))],
  ["Stop", () => abort?.abort()], ["Connect local runner", () => $("runnerDlg").showModal()], ["Load demo run", loadDemo], ["Toggle theme", () => $("theme").click()],
  ["Toggle low effects", () => $("fx").click()], ["Clear console", () => cons.clear()], ...TABS.map((t) => ["Go to " + t, () => showTab(t)])];
let palSel = 0;
function palDraw() {
  const q = $("palIn").value.toLowerCase(); const list = CMDS.filter(([n]) => n.toLowerCase().includes(q)); palSel = Math.min(palSel, Math.max(0, list.length - 1));
  $("palList").replaceChildren(...list.map(([n, f], i) => { const d = document.createElement("div"); d.textContent = n; d.className = i === palSel ? "on" : "";
    d.onclick = () => { palClose(); f(); }; return d; }));
  return list;
}
const palClose = () => { $("palette").hidden = true; };
const palOpen = () => { $("palette").hidden = false; $("palIn").value = ""; palSel = 0; palDraw(); $("palIn").focus(); };
$("paletteBtn").onclick = palOpen;
$("palette").onclick = (e) => { if (e.target === $("palette")) palClose(); };
$("palIn").oninput = () => { palSel = 0; palDraw(); };
$("palIn").onkeydown = (e) => { const l = palDraw();
  if (e.key === "Escape") palClose();
  else if (e.key === "ArrowDown") { palSel = Math.min(l.length - 1, palSel + 1); palDraw(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { palSel = Math.max(0, palSel - 1); palDraw(); e.preventDefault(); }
  else if (e.key === "Enter" && l[palSel]) { palClose(); l[palSel][1](); } };
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palOpen(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); start(plan("all")); }
});

// ---------- editor (Monaco, loaded on demand) ----------
// Open the file that defines the top module first (falls back to the first file).
let editor, openFile = project.list().find((n) => new RegExp(String.raw`\bmodule\s+${opts.top}\b`).test(project.get(n) || "")) || project.list()[0];
const models = {};
function drawFileBar() {
  const bar = $("filebar"); bar.replaceChildren();
  for (const n of project.list()) { const b = document.createElement("button"); b.textContent = n; b.className = n === openFile ? "on" : ""; b.onclick = () => openF(n); bar.append(b); }
  const mk = (t, f, title) => { const b = document.createElement("button"); b.textContent = t; b.title = title; b.onclick = f; bar.append(b); };
  mk("+ New", () => { const n = prompt("New file name (.v .sv .vh)"); if (n) try { project.add(n, `module ${n.replace(/\..*/, "")};\nendmodule\n`); openF(n); buildProps(); } catch (e) { alert(e.message); } }, "New file");
  const up = Object.assign(document.createElement("input"), { type: "file", multiple: true, accept: ".v,.sv,.vh,.svh", hidden: true });
  up.onchange = async () => { for (const f of up.files) try { project.add(f.name, await f.text()); } catch (e) { project.set(f.name, await f.text()); } up.value = ""; openF(openFile); buildProps(); };
  mk("Upload", () => up.click(), "Upload files");
  mk("Rename", () => { const n = prompt("Rename to", openFile); if (n && n !== openFile) try { project.rename(openFile, n); models[openFile]?.dispose(); delete models[openFile]; openF(n); buildProps(); } catch (e) { alert(e.message); } }, "Rename file");
  mk("Delete", () => { if (project.list().length > 1 && confirm("Delete " + openFile + "?")) { project.remove(openFile); models[openFile]?.dispose(); delete models[openFile]; openF(project.list()[0]); buildProps(); } }, "Delete file");
  bar.append(up);
}
function openF(n) {
  openFile = n; drawFileBar(); if (!editor) return;
  models[n] ||= monaco.editor.createModel(project.get(n), "systemverilog");
  editor.setModel(models[n]);
}
function syncFromEditor() { if (editor && models[openFile]) project.set(openFile, models[openFile].getValue()); }
drawFileBar();
window.require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs" } });
window.require(["vs/editor/editor.main"], () => {
  editor = monaco.editor.create($("editor"), { language: "systemverilog", theme: root.dataset.theme === "dark" ? "vs-dark" : "vs", fontFamily: "JetBrains Mono, monospace",
    fontSize: 13, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, tabSize: 2 });
  editor.onDidChangeModelContent(() => syncFromEditor());
  openF(openFile);
}, () => cons.log("editor", "WARNING: Monaco could not load (offline?). Files still run."));

// ---------- boot ----------
buildTabs(); buildProps(); drawNav(); showTab("Editor");
addEventListener("pagehide", syncFromEditor);
window.__studio = { start, plan, state, ctx };  // handy in devtools

// ---------- first-time guide ----------
function hideGuide() { $("guide").hidden = true; store.set("studio:guide", 1); }
const tour = createTour({ onDone: () => { store.set("studio:tour", 1); hideGuide(); }, onRunAll: () => start(plan("all")) });
if (!store.get("studio:tour", 0)) { $("guide").hidden = true; setTimeout(() => tour.start(), 600); }   // first visit: the tour leads, no second overlay
else $("guide").hidden = !!store.get("studio:guide", 0);
$("tourBtn").onclick = () => tour.start();
CMDS.push(["Take the tour", () => tour.start()]);
$("guideRun").onclick = () => start(plan("all"));
$("guideX").onclick = hideGuide;
