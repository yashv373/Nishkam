// Compact static timing + power estimate for small gate-level designs (Yosys netlist.json + vendored gf180mcu timing model).
// Pre-layout: no wires, ideal clock. This is an ESTIMATE; use the runner's OpenSTA for signoff numbers.
import { serve, text } from "./_rpc.js";
import { loadModel, lookup } from "./liberty.js";

const MODEL_URL = new URL("../../vendor/gf180mcu/7b70722-timing/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.timing.json.gz", import.meta.url);
let modelP;
const getModel = (o) => o.model || globalThis.__staModel || (modelP ||= loadModel(MODEL_URL));

const R = 0, F = 1, TR = ["rise", "fall"], ARROW = ["^", "v"];
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : "n/a");

// ---------- netlist ----------
function buildDesign(nlJson, model, o) {
  const nl = typeof nlJson === "string" ? JSON.parse(nlJson) : nlJson;
  const mods = nl.modules, topName = o.top || Object.keys(mods).find((m) => mods[m].attributes?.top) || Object.keys(mods)[0];
  const mod = mods[topName];
  if (!mod) throw new Error("no top module in netlist.json");
  const isBit = (b) => typeof b === "number";
  const nets = new Map(); // bit -> net object
  const net = (b) => { let n = nets.get(b); if (!n) nets.set(b, (n = { bit: b, cap: 0, sinks: [], driver: null, po: false, pi: false, clock: false })); return n; };
  const names = new Map(); // bit -> best name
  for (const [nm, nn] of Object.entries(mod.netnames || {}))
    nn.bits.forEach((b, k) => {
      if (!isBit(b)) return;
      const full = nn.bits.length > 1 ? `${nm}[${k}]` : nm, cur = names.get(b);
      if (!cur || (cur.startsWith("$") && !full.startsWith("$")) || (cur.startsWith("$") === full.startsWith("$") && full.length < cur.length)) names.set(b, full);
    });
  const ports = [];
  for (const [pn, p] of Object.entries(mod.ports || {})) p.bits.forEach((b, k) => {
    if (!isBit(b)) return;
    const n = net(b), nm = p.bits.length > 1 ? `${pn}[${k}]` : pn;
    names.set(b, nm); ports.push({ name: nm, port: pn, dir: p.direction, net: n });
    if (p.direction === "input") n.pi = true; else n.po = true;
  });
  const insts = [], missing = new Set();
  for (const [iname, c] of Object.entries(mod.cells || {})) {
    const cell = model.cells[c.type];
    if (!cell) { missing.add(c.type); continue; }
    const inst = { name: iname, type: c.type, cell, pins: {} };
    for (const [pin, bits] of Object.entries(c.connections)) {
      const b = bits[0], def = cell.pins[pin];
      if (!def || !isBit(b)) continue;
      const n = net(b);
      inst.pins[pin] = n;
      if (def.dir === "output") n.driver = { inst, pin };
      else { n.sinks.push({ inst, pin }); n.cap += def.cap || 0; }
    }
    insts.push(inst);
  }
  if (missing.size) throw new Error("netlist has cells that are not in the library (is it a mapped netlist?): " + [...missing].slice(0, 6).join(", "));
  const clk = ports.find((p) => p.port === o.clockPort && p.dir === "input");
  for (const p of ports) if (p.dir === "output") p.net.cap += o.outputLoadPf;
  return { topName, nets, names, ports, insts, clkNet: clk?.net, name: (n) => names.get(n.bit) || `n${n.bit}` };
}

// ---------- STA ----------
export function analyze(nlJson, model, opt = {}) {
  const o = { clockPort: "clk", periodNs: 10, inputDelayNs: 0, outputDelayNs: 0, inputSlewNs: 0.1, outputLoadPf: 0.01, clockSlewNs: 0, paths: 10, ...opt };
  const D = buildDesign(nlJson, model, o);
  const { insts, nets } = D;
  // flops: cells with a clock->Q launch arc. Clock nets = nets on those clock pins (+ the clock port)
  const clockNets = new Set(D.clkNet ? [D.clkNet] : []);
  const flops = [], warnings = [];
  for (const i of insts) {
    const l = i.cell.arcs.filter((a) => a.type === "rising_edge" || a.type === "falling_edge");
    if (!l.length) continue;
    i.launch = l; i.flop = true;
    for (const a of l) if (i.pins[a.from]) clockNets.add(i.pins[a.from]);
    if (l.some((a) => a.type === "falling_edge")) warnings.push(`${i.name}: falling-edge flop timed as if rising-edge`);
    flops.push(i);
  }
  if (!clockNets.size) warnings.push(`clock port '${o.clockPort}' not found; ideal clock assumed on flop clock pins`);
  // per-net state
  const mk = () => [[-Infinity, -Infinity], [Infinity, Infinity]]; // [max[r,f], min[r,f]]
  for (const n of nets.values()) { n.at = mk(); n.sl = [[0, 0], [1e9, 1e9]]; n.from = [[null, null], [null, null]]; n.clock = clockNets.has(n); }
  const K = 0, KMIN = 1; // 0 = late/max, 1 = early/min
  const relax = (n, k, tr, at, sl, from) => {
    if (k === K ? at > n.at[K][tr] : at < n.at[KMIN][tr]) { n.at[k][tr] = at; n.from[k][tr] = from; }
    n.sl[k][tr] = k === K ? Math.max(n.sl[K][tr], sl) : Math.min(n.sl[KMIN][tr], sl);
  };
  // sources
  for (const n of nets.values()) if (n.pi && !n.clock) for (const k of [K, KMIN]) for (const tr of [R, F]) { n.at[k][tr] = o.inputDelayNs; n.sl[k][tr] = o.inputSlewNs; }
  for (const i of flops) for (const a of i.launch) {
    const q = i.pins[a.to]; if (!q) continue;
    for (const k of [K, KMIN]) {
      const t = k === K ? a.hi : a.lo || a.hi;
      for (const tr of [R, F]) {
        const dt = t["cell_" + TR[tr]], st = t[TR[tr] + "_transition"]; if (!dt) continue;
        const d = lookup(dt, o.clockSlewNs, q.cap), s = st ? lookup(st, o.clockSlewNs, q.cap) : 0.1;
        relax(q, k, tr, d, s, { start: true, inst: i, arc: a, delay: d, inTr: R, load: q.cap, clockPin: i.pins[a.from] });
      }
    }
  }
  // combinational + async arcs, Kahn order
  const isProp = (a) => /^(combinational|clear|preset)/.test(a.type);
  const nodes = insts.filter((i) => i.cell.arcs.some(isProp));
  const nodeSet = new Set(nodes), pend = new Map(), sinkNodes = new Map();
  for (const i of nodes) {
    const ins = new Set(i.cell.arcs.filter(isProp).map((a) => i.pins[a.from]).filter(Boolean));
    let p = 0;
    for (const n of ins) if (n.driver && nodeSet.has(n.driver.inst) && n.driver.inst !== i) { p++; (sinkNodes.get(n) || sinkNodes.set(n, []).get(n)).push(i); }
    pend.set(i, p);
  }
  const queue = nodes.filter((i) => pend.get(i) === 0);
  let done = 0;
  while (queue.length) {
    const i = queue.pop(); done++;
    for (const a of i.cell.arcs) {
      if (!isProp(a)) continue;
      const src = i.pins[a.from], dst = i.pins[a.to];
      if (!src || !dst || src.clock) continue;
      for (const k of [K, KMIN]) {
        const t = k === K ? a.hi : a.lo || a.hi;
        for (const tin of [R, F]) {
          const at = src.at[k][tin]; if (!Number.isFinite(at)) continue;
          const outs = a.sense === "positive_unate" ? [tin] : a.sense === "negative_unate" ? [1 - tin] : [R, F];
          for (const tout of outs) {
            const dt = t["cell_" + TR[tout]], st = t[TR[tout] + "_transition"]; if (!dt) continue;
            const s = src.sl[k][tin], d = lookup(dt, s, dst.cap);
            relax(dst, k, tout, at + d, st ? lookup(st, s, dst.cap) : s, { net: src, tr: tin, inst: i, arc: a, delay: d, load: dst.cap, inSlew: s });
          }
        }
      }
    }
    for (const out of Object.values(i.pins)) for (const s of sinkNodes.get(out) || []) if (out.driver?.inst === i) { pend.set(s, pend.get(s) - 1); if (pend.get(s) === 0) queue.push(s); }
  }
  if (done < nodes.length) throw new Error("combinational loop in netlist (STA lite cannot break loops)");

  // checks
  const T = o.periodNs, ends = [];
  const clkSlew = o.clockSlewNs;
  for (const i of flops) for (const a of i.cell.arcs) {
    if (!/^(setup|hold|recovery|removal)_(rising|falling)$/.test(a.type)) continue;
    const d = i.pins[a.to]; if (!d || d.clock) continue;
    const isSetup = /^(setup|recovery)/.test(a.type);
    for (const tr of [R, F]) {
      const tb = a.hi[TR[tr] + "_constraint"]; if (!tb) continue;
      const k = isSetup ? K : KMIN, at = d.at[k][tr]; if (!Number.isFinite(at)) continue;
      const c = lookup(tb, d.sl[k][tr], clkSlew);
      ends.push({ kind: isSetup ? "setup" : "hold", net: d, tr, at, req: isSetup ? T - c : c, check: c, slack: isSetup ? T - c - at : at - c, end: `${i.name}/${a.to} (${i.type.replace(/^gf180mcu_fd_sc_mcu7t5v0__/, "")})`, endInst: i, pin: a.to });
    }
  }
  for (const p of D.ports) if (p.dir === "output" && !p.net.clock) for (const tr of [R, F]) {
    for (const k of [K, KMIN]) {
      const at = p.net.at[k][tr]; if (!Number.isFinite(at)) continue;
      const setup = k === K;
      ends.push({ kind: setup ? "setup" : "hold", net: p.net, tr, at, req: setup ? T - o.outputDelayNs : -o.outputDelayNs, check: o.outputDelayNs, slack: setup ? T - o.outputDelayNs - at : at + o.outputDelayNs, end: `${p.name} (output port)`, port: true });
    }
  }
  // paths
  const pathOf = (e) => {
    const k = e.kind === "setup" ? K : KMIN, rows = [];
    let n = e.net, tr = e.tr;
    for (let guard = 0; guard < 10000; guard++) {
      const f = n.from[k][tr];
      const row = { pin: n.driver ? `${n.driver.inst.name}/${n.driver.pin}` : D.name(n), cell: n.driver ? n.driver.inst.type.replace(/^gf180mcu_fd_sc_mcu7t5v0__/, "") : "(input port)", net: D.name(n), tr: ARROW[tr], load: n.cap, slew: n.sl[k][tr], delay: f ? f.delay : 0, arrival: n.at[k][tr] };
      rows.push(row);
      if (!f || f.start) { if (f?.start) rows.push({ pin: `${f.inst.name}/${f.arc.from}`, cell: "clock (ideal)", net: D.name(f.clockPin), tr: "^", load: 0, slew: clkSlew, delay: 0, arrival: 0 }); break; }
      n = f.net; tr = f.tr;
    }
    return rows.reverse();
  };
  const summarize = (kind) => {
    const l = ends.filter((e) => e.kind === kind).sort((a, b) => a.slack - b.slack);
    return { list: l, worst: l.length ? l[0].slack : null, wns: l.length ? Math.min(0, l[0].slack) : 0, tns: l.reduce((s, e) => s + Math.min(0, e.slack), 0), violations: l.filter((e) => e.slack < 0).length };
  };
  const su = summarize("setup"), ho = summarize("hold");
  const pick = (S) => { const seen = new Set(), out = []; for (const e of S.list) { const key = e.end + e.tr; if (seen.has(key)) continue; seen.add(key); out.push(e); if (out.length >= o.paths) break; } return out; };
  const topS = pick(su), topH = pick(ho);
  const mkPath = (e) => ({ kind: e.kind, endpoint: e.end, startpoint: null, edge: ARROW[e.tr], arrival: e.at, required: e.req, check: e.check, slack: e.slack, stages: pathOf(e) });
  const paths = { setup: topS.map(mkPath), hold: topH.map(mkPath) };
  for (const p of [...paths.setup, ...paths.hold]) p.startpoint = p.stages[0].pin;
  const fmax = su.worst === null ? null : 1000 / (T - su.worst); // MHz
  return {
    D, o, warnings, paths,
    setup: { worst_slack_ns: su.worst, wns_ns: su.wns, tns_ns: su.tns, violating_endpoints: su.violations, endpoints: su.list.length },
    hold: { worst_slack_ns: ho.worst, wns_ns: ho.wns, tns_ns: ho.tns, violating_endpoints: ho.violations, endpoints: ho.list.length },
    fmax_mhz: fmax, critical_path_ns: su.list.length ? T - su.worst - 0 : null, clockNets,
  };
}

export function timingReport(r) {
  const o = r.o, L = [];
  L.push("Nishkam timing (pre-layout estimate, no wire load, ideal clock) -- NOT signoff");
  L.push(`Library: gf180mcu_fd_sc_mcu7t5v0 tt_025C_5v00   clock: ${o.clockPort}  period ${o.periodNs} ns`);
  L.push(`input delay ${o.inputDelayNs} ns, output delay ${o.outputDelayNs} ns, input slew ${o.inputSlewNs} ns, output load ${o.outputLoadPf} pF`, "");
  for (const w of r.warnings) L.push("Warning: " + w);
  for (const kind of ["setup", "hold"]) {
    const s = r[kind];
    L.push(`==== ${kind.toUpperCase()}: worst slack ${f3(s.worst_slack_ns)} ns   WNS ${f3(s.wns_ns)}   TNS ${f3(s.tns_ns)}   violating ${s.violating_endpoints}/${s.endpoints} ====`, "");
    r.paths[kind].forEach((p, idx) => {
      L.push(`Path ${idx + 1} (${kind})`, `Startpoint: ${p.startpoint}`, `Endpoint:   ${p.endpoint}`, "");
      L.push("  Pin".padEnd(46) + "Cell".padEnd(14) + "Load(pF)".padStart(9) + "Slew".padStart(8) + "Delay".padStart(8) + "Arrival".padStart(9));
      for (const s2 of p.stages) L.push(("  " + s2.pin + " " + s2.tr).padEnd(46).slice(0, 46) + s2.cell.slice(0, 13).padEnd(14) + f4(s2.load).padStart(9) + f3(s2.slew).padStart(8) + f3(s2.delay).padStart(8) + f3(s2.arrival).padStart(9));
      L.push("  data arrival time".padEnd(86) + f3(p.arrival).padStart(9));
      L.push((kind === "setup" ? "  required time (period - setup)" : "  required time (hold/removal)").padEnd(86) + f3(p.required).padStart(9));
      L.push(`  slack (${p.slack < 0 ? "VIOLATED" : "MET"})`.padEnd(86) + f3(p.slack).padStart(9), "");
    });
  }
  L.push(r.fmax_mhz ? `Max frequency estimate: ${r.fmax_mhz.toFixed(1)} MHz (period ${(1000 / r.fmax_mhz).toFixed(3)} ns)` : "Max frequency: no timed setup paths");
  return L.join("\n") + "\n";
}

// ---------- VCD toggle counts ----------
export function parseVcd(src) {
  const vars = [], scopeStack = [], byCode = new Map(), tog = new Map();
  let inDefs = true, clockToggle = 0;
  const lines = src.split(/\r?\n/);
  const state = new Map(); // code -> last value string
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue;
    if (inDefs) {
      if (l.startsWith("$scope")) scopeStack.push(l.split(/\s+/)[2]);
      else if (l.startsWith("$upscope")) scopeStack.pop();
      else if (l.startsWith("$var")) {
        const p = l.split(/\s+/), v = { code: p[3], width: +p[2], name: p[4], scope: scopeStack.join("."), depth: scopeStack.length, msb: 0 };
        const rg = p.slice(5).join("").match(/^\[(\d+)(?::(\d+))?\]/);
        if (rg) v.msb = +rg[1]; // vectors are written as [msb:lsb]; bit k is lsb+k
        if (v.width > 1 && rg && rg[2] !== undefined) v.lsb = +rg[2]; else v.lsb = 0;
        vars.push(v); (byCode.get(v.code) || byCode.set(v.code, []).get(v.code)).push(v);
      } else if (l.startsWith("$enddefinitions")) inDefs = false;
      continue;
    }
    if (l[0] === "#" || l[0] === "$") continue;
    let code, val;
    if (l[0] === "b" || l[0] === "B") { const sp = l.indexOf(" "); val = l.slice(1, sp); code = l.slice(sp + 1).trim(); }
    else { val = l[0]; code = l.slice(1).trim(); }
    const vs = byCode.get(code); if (!vs) continue;
    const w = vs[0].width;
    if (w > 1 && val.length < w) val = (/^[01]/.test(val) ? "0" : val[0]).repeat(w - val.length) + val;
    const prev = state.get(code); state.set(code, val);
    if (prev === undefined) continue; // first assignment is the initial value, not a toggle
    const t = tog.get(code) || tog.set(code, new Array(w).fill(0)).get(code);
    for (let b = 0; b < w; b++) { const x = prev[w - 1 - b], y = val[w - 1 - b]; if (x !== y && /[01]/.test(x) && /[01]/.test(y)) t[b]++; }
  }
  return { vars, toggles: tog };
}

// ---------- power ----------
export function estimatePower(r, model, vcdText, opt = {}) {
  const o = r.o, D = r.D, V = model.voltage, fMHz = 1000 / o.periodNs, defAct = opt.defaultActivity ?? 0.1;
  const alpha = new Map(); // net -> transitions per clock cycle
  let source = `default activity ${defAct} toggles/cycle on every data net (no VCD)`, mapped = 0, total = 0;
  const fromVcd = new Map();
  if (vcdText) {
    const v = parseVcd(vcdText);
    // choose the scope that holds the most port names (the DUT), deepest on ties
    const portNames = new Set(D.ports.map((p) => p.port));
    const cnt = new Map();
    for (const x of v.vars) { const c = cnt.get(x.scope) || cnt.set(x.scope, { n: 0, d: x.depth, hasClk: false }).get(x.scope); if (portNames.has(x.name)) c.n++; if (x.name === o.clockPort) c.hasClk = true; }
    let best = null;
    for (const [sc, c] of cnt) if (c.hasClk && (!best || c.n > best.c.n || (c.n === best.c.n && c.d > best.c.d))) best = { sc, c };
    const clkVar = best && v.vars.find((x) => x.scope === best.sc && x.name === o.clockPort);
    const clkTog = clkVar ? (v.toggles.get(clkVar.code) || [0])[0] : 0;
    if (best && clkTog >= 2) {
      const cycles = clkTog / 2;
      const byName = new Map(); // net bit -> toggles
      for (const x of v.vars) if (x.scope === best.sc && x.name !== o.clockPort) {
        const t = v.toggles.get(x.code) || new Array(x.width).fill(0);
        const nn = [...D.nets.values()]; // small designs only
        for (let b = 0; b < x.width; b++) {
          const nm = x.width > 1 ? `${x.name}[${x.lsb + b}]` : x.name;
          const hit = nn.find((n) => D.names.get(n.bit) === nm);
          if (hit) fromVcd.set(hit, t[b] / cycles);
        }
      }
      for (const n of D.nets.values()) { if (!n.clock) { total++; if (fromVcd.has(n)) mapped++; } }
      source = `VCD (${best.sc}, ${cycles} clock cycles): ${mapped}/${total} nets matched by name, the rest use default ${defAct}`;
      if (!mapped) source = `VCD given but no net names matched; default activity ${defAct} used`;
    } else source = `VCD given but clock '${o.clockPort}' not found or never toggles; default activity ${defAct} used`;
  }
  for (const n of D.nets.values()) alpha.set(n, n.clock ? 2 : fromVcd.get(n) ?? defAct);
  let leak = 0, internal = 0, sw = 0, area = 0;
  const per = [];
  for (const i of D.insts) {
    leak += i.cell.leak; area += i.cell.area;
    let e = 0; // pJ per clock cycle
    for (const [pn, def] of Object.entries(i.cell.pins)) {
      const n = i.pins[pn]; if (!n || !def.pw) continue;
      const a = alpha.get(n) ?? 0;
      if (def.dir === "input") {
        const ent = def.pw.find((x) => !x.rel) || def.pw[0]; if (!ent) continue;
        const sr = n.clock ? o.clockSlewNs : n.sl[0][R] || o.inputSlewNs, sf = n.clock ? o.clockSlewNs : n.sl[0][F] || o.inputSlewNs;
        e += (a / 2) * ((ent.rise ? lookup(ent.rise, sr) : 0) + (ent.fall ? lookup(ent.fall, sf) : 0));
      } else {
        let sum = 0, k = 0;
        for (const ent of def.pw) {
          const rn = i.pins[ent.rel], s = rn ? (rn.clock ? o.clockSlewNs : Math.max(rn.sl[0][R], rn.sl[0][F]) || o.inputSlewNs) : o.inputSlewNs;
          sum += (ent.rise ? lookup(ent.rise, s, n.cap) : 0) + (ent.fall ? lookup(ent.fall, s, n.cap) : 0); k++;
        }
        if (k) e += (a / 2) * (sum / k);
      }
    }
    internal += e * fMHz;
    per.push({ inst: i.name, type: i.type, internal_uW: e * fMHz, leakage_uW: i.cell.leak });
  }
  let swClk = 0;
  for (const n of D.nets.values()) if (n.cap) { const x = 0.5 * n.cap * V * V * alpha.get(n) * fMHz; sw += x; if (n.clock) swClk += x; } // pF * V^2 * MHz = uW
  const summary = { leakage_uW: leak, internal_uW: internal, switching_uW: sw, clock_switching_uW: swClk, total_uW: leak + internal + sw, area_um2: area, activitySource: source, frequency_MHz: fMHz, voltage_V: V, estimate: true };
  return { summary, per };
}

export function powerReport(s, per) {
  const u = (x) => x.toFixed(3).padStart(12);
  const L = ["Nishkam power (ESTIMATE -- pre-layout, no wires, simple toggle rates; not signoff)", "",
    `Library: gf180mcu_fd_sc_mcu7t5v0 tt_025C_5v00, ${s.voltage_V} V, clock ${s.frequency_MHz.toFixed(2)} MHz`,
    `Activity: ${s.activitySource}`, "",
    "Group                    Power (uW)", `Leakage        ${u(s.leakage_uW)}`, `Internal       ${u(s.internal_uW)}`, `Switching      ${u(s.switching_uW)}   (clock pin load: ${s.clock_switching_uW.toFixed(3)}, ideal clock, no clock tree)`, `Total          ${u(s.total_uW)}`, "",
    `Cell area: ${s.area_um2.toFixed(2)} um^2`, "", "Per cell (top 15 by internal+leakage):"];
  for (const p of [...per].sort((a, b) => b.internal_uW + b.leakage_uW - a.internal_uW - a.leakage_uW).slice(0, 15))
    L.push(`  ${p.inst.slice(0, 38).padEnd(40)} ${p.type.replace(/^gf180mcu_fd_sc_mcu7t5v0__/, "").padEnd(12)} int ${p.internal_uW.toFixed(3).padStart(9)}  leak ${p.leakage_uW.toFixed(5)}`);
  return L.join("\n") + "\n";
}

// ---------- worker entry ----------
// req: {mode: "sta"|"power"|"both", files: {"netlist.json", "*.vcd"?}, options}
export async function handle({ mode = "both", files, options = {} }, { log } = {}) {
  const nl = files["netlist.json"];
  if (!nl) throw new Error("netlist.json missing (run synthesis first)");
  const model = await getModel(options);
  const r = analyze(text(nl), model, options);
  const out = {}, summary = { area_um2: null };
  if (mode !== "power") {
    out["timing.rpt"] = timingReport(r);
    const { D, o, clockNets, ...pub } = r;
    out["timing.json"] = JSON.stringify({ top: D.topName, options: o, ...pub, clockNets: undefined }, null, 1);
    Object.assign(summary, { clock: o.clockPort, period_ns: o.periodNs, setup: r.setup, hold: r.hold, fmax_mhz: r.fmax_mhz, warnings: r.warnings });
  }
  if (mode !== "sta") {
    const vcdName = Object.keys(files).find((f) => f.endsWith(".vcd"));
    const p = estimatePower(r, model, vcdName ? text(files[vcdName]) : null, options);
    out["power.rpt"] = powerReport(p.summary, p.per);
    Object.assign(summary, { power: p.summary, area_um2: p.summary.area_um2 });
  }
  if (summary.area_um2 === null) summary.area_um2 = r.D.insts.reduce((s, i) => s + i.cell.area, 0);
  log?.(`signoff-lite: ${mode} done`);
  return { ok: true, files: out, summary };
}

serve(handle);
