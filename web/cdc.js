// Clock-domain-crossing (CDC) grading. Simulators and formal tools treat flops as ideal, so metastability
// cannot be shown. This grader checks the two things that can be checked instead:
//   1. Structure: read the Yosys netlist, find every signal that crosses from one clock to the other, and
//      require it to go straight into a flop of the other clock and through at least two such flops.
//   2. Worst-case bit timing: the first flop after a crossing may catch the old or the new value of each bit
//      on its own (a free choice per bit). Both clocks are free (clk2fflogic) and a scoreboard in the problem's
//      harness checks the behaviour. Only safety is checked (a clock may stop), to a bounded number of steps.
// Runs anywhere @yowasp/yosys runs (browser worker or Node).
import { parseVcd } from "./grader.js";

export const CDC_STEPS = 34; // steps checked after the start; each step lets any clock tick or not
const RESET_STEPS = 2;       // steps 1..2: reset high, both clocks tick

// ---------- 1. structure, from `write_json` of the flattened gate-level design ----------
export function analyze(json, top, cfg) {
  const m = json.modules[top];
  const names = {};
  for (const [n, v] of Object.entries(m.netnames)) // nicest name per bit: visible names win, shorter wins
    v.bits.forEach((b, i) => {
      if (typeof b !== "number") return;
      const full = v.bits.length > 1 ? `${n}[${i}]` : n, hidden = n.startsWith("$");
      const old = names[b];
      if (!old || (old.hidden && !hidden) || (old.hidden === hidden && full.length < old.s.length)) names[b] = { s: full, hidden };
    });
  const nm = (b) => (names[b] ? names[b].s : "an internal net");
  const errors = [];
  const portBits = {}; // input port bit -> {name, dom}
  for (const [pn, p] of Object.entries(m.ports)) {
    if (p.direction !== "input" || cfg.clocks.includes(pn)) continue;
    const dom = cfg.ports[pn];
    if (dom === undefined) { errors.push(`The module has a port "${pn}" that is not in the problem's port list. Keep the ports from the starter.`); continue; }
    p.bits.forEach((b) => (portBits[b] = { name: pn, dom }));
  }
  const clkDom = {}; // clock bit -> 0/1
  cfg.clocks.forEach((c, i) => { if (!m.ports[c]) errors.push(`The module has no clock port "${c}". Keep the ports from the starter.`); else clkDom[m.ports[c].bits[0]] = i; });
  const outPorts = new Set();
  for (const p of Object.values(m.ports)) if (p.direction === "output") p.bits.forEach((b) => outPorts.add(b));
  if (errors.length) return { errors };

  const drv = {}, flops = [], uses = {}; // drv: bit -> {cell, flop}; uses: bit -> [{cell, pin}]
  for (const [cn, c] of Object.entries(m.cells)) {
    const isFlop = /^\$_(S?DFF|DFFE|SDFFE|SDFFCE|ALDFF|ALDFFE|DFFSR|DFFSRE|DLATCH|DLATCHSR|SR)/.test(c.type);
    if (isFlop && c.connections.C === undefined) { errors.push(`Latches are not allowed here. Use flip-flops.`); continue; }
    const f = isFlop ? { cn, c, q: c.connections.Q, clk: c.connections.C[0] } : null;
    if (f) flops.push(f);
    for (const [pin, bits] of Object.entries(c.connections)) {
      const out = c.port_directions[pin] === "output";
      bits.forEach((b) => {
        if (typeof b !== "number") return;
        if (out) drv[b] = { cn, c, f };
        else (uses[b] ||= []).push({ cn, c, pin, f });
      });
    }
  }
  if (errors.length) return { errors };
  for (const f of flops) {
    f.dom = clkDom[f.clk];
    if (f.dom === undefined) errors.push(`The flop that drives "${nm(f.q[0])}" is not clocked straight from ${cfg.clocks.join(" or ")}. Do not gate, divide or invert a clock here.`);
  }
  if (errors.length) return { errors };

  // leaves reachable backwards from a net, through logic only: [{bit, dom, flop}]
  const memo = {};
  const leaves = (b) => {
    if (typeof b !== "number") return [];
    if (memo[b]) return memo[b];
    memo[b] = []; // loop guard
    const d = drv[b], out = [];
    if (portBits[b]) out.push({ bit: b, dom: portBits[b].dom });
    else if (d && d.f) out.push({ bit: b, dom: d.f.dom, flop: d.f });
    else if (d) for (const [pin, bits] of Object.entries(d.c.connections)) if (d.c.port_directions[pin] === "input") for (const x of bits) out.push(...leaves(x));
    return (memo[b] = out);
  };
  const isData = (flop) => { // memory/data-path flops: their D comes from a data input port; the pointers guard them
    if (!flop) return false;
    const seen = new Set(), walk = (b) => { if (seen.has(b)) return false; seen.add(b); const l = portBits[b]; if (l && cfg.data.includes(l.name)) return true;
      const d = drv[b]; return !!d && !d.f && Object.entries(d.c.connections).some(([p, bs]) => d.c.port_directions[p] === "input" && bs.some(walk)); };
    return flop.c.connections.D.some(walk);
  };

  const cross = {}; // source bit -> [{flop}]
  for (const f of flops)
    for (const [pin, bits] of Object.entries(f.c.connections)) {
      if (f.c.port_directions[pin] !== "input" || pin === "C") continue;
      for (const b of bits) for (const l of leaves(b)) {
        if (l.dom === f.dom || (l.flop && isData(l.flop))) continue;
        const clkA = cfg.clocks[l.dom], clkB = cfg.clocks[f.dom];
        if (b === l.bit && pin === "D") (cross[l.bit] ||= []).push(f);
        else errors.push(`"${nm(l.bit)}" (${clkA}) reaches a ${clkB} flop through ${b === l.bit ? "its " + pin + " pin" : "logic"}. A crossing signal must go straight into the D pin of a flop in the other clock.`);
      }
    }
  const crossings = [];
  for (const [sb, dst] of Object.entries(cross)) {
    const s = +sb, from = cfg.clocks[(portBits[s] || drv[s].f).dom], to = cfg.clocks[dst[0].dom];
    const uniq = [...new Set(dst)];
    if (uniq.length > 1) { errors.push(`"${nm(s)}" crosses from ${from} to ${to} into ${uniq.length} flops. It must feed exactly one flop, then a chain.`); continue; }
    const f1 = uniq[0], q = f1.q[0];
    const u = uses[q] || [];
    if (outPorts.has(q) || !u.length || u.some((x) => !x.f || x.pin !== "D" || x.f.dom !== f1.dom))
      errors.push(`"${nm(s)}" crosses from ${from} to ${to}, but the first ${to} flop ("${nm(q)}") feeds ${outPorts.has(q) ? "an output" : !u.length ? "nothing" : "logic or a different clock"} instead of a second ${to} flop. Use at least two flops in a row with nothing between them.`);
    else crossings.push({ src: s, f1 });
  }
  if (!errors.length && !crossings.length) errors.push(`No signal crosses from one clock to the other. The design must carry its signal from ${cfg.clocks[0]} to ${cfg.clocks[1]}.`);
  return { errors, crossings, nm, clkBit: cfg.clocks.map((c) => m.ports[c].bits[0]), srcDom: (s) => (portBits[s] || drv[s].f).dom };
}

// ---------- 2. worst-case bit timing: patch the netlist so each crossing bit has a free old/new choice ----------
export function injectSkew(json, top, an) {
  const m = json.modules[top];
  let next = Math.max(...Object.values(m.netnames).flatMap((n) => n.bits.filter((b) => typeof b === "number")), ...Object.values(m.cells).flatMap((c) => Object.values(c.connections).flat().filter((b) => typeof b === "number"))) + 1;
  const skew = an.crossings.map(() => next++);
  an.crossings.forEach(({ src, f1 }, i) => {
    const old = next++, sb = next++, same = next++, sel = next++, mux = next++;
    const cell = (name, type, conn, dirs) => (m.cells[`$skew_${name}${i}`] = { type, parameters: {}, attributes: {}, port_directions: Object.fromEntries(Object.keys(conn).map((k) => [k, k === dirs ? "output" : "input"])), connections: Object.fromEntries(Object.entries(conn).map(([k, v]) => [k, [v]])) });
    // old = the source bit as it was before its latest edge. sb = the bit as the first flop saw it last time.
    // Old may only be caught if the bit changed since the first flop's last edge, and then it is a free choice.
    cell("old", "$_DFF_P_", { C: an.clkBit[an.srcDom(src)], D: src, Q: old }, "Q");
    cell("sb", "$_DFF_P_", { C: f1.clk, D: src, Q: sb }, "Q");
    cell("same", "$_XNOR_", { A: src, B: sb, Y: same }, "Y");
    cell("sel", "$_OR_", { A: skew[i], B: same, Y: sel }, "Y");
    cell("mux", "$_MUX_", { A: old, B: src, S: sel, Y: mux }, "Y");
    f1.c.connections.D = f1.c.connections.D.map((b) => (b === src ? mux : b));
  });
  m.ports.skew = { direction: "input", bits: skew };
  // Bus rule: a multi-bit bus that crosses may change at most one bit per source-clock event (Gray style).
  // `old` above is the bus before its latest source edge, so the bits that differ are the bits that just changed.
  const groups = {};
  an.crossings.forEach(({ src }, i) => { const n = an.nm(src).replace(/\[\d+\]$/, ""); (groups[n] ||= []).push({ src, i }); });
  const buses = [], hbus = [], hamm = [];
  const gate = (name, type, A, B, Y) => { m.cells[`$bus_${name}`] = { type, parameters: {}, attributes: {}, port_directions: { A: "input", B: "input", Y: "output" }, connections: { A: [A], B: [B], Y: [Y] } }; return Y; };
  let gi = 0;
  for (const [name, bits] of Object.entries(groups)) {
    if (bits.length < 2) continue;
    const diff = bits.map(({ src, i }) => gate(`x${gi++}`, "$_XOR_", src, m.cells[`$skew_old${i}`].connections.Q[0], next++));
    let bad = null;
    for (let a = 0; a < diff.length; a++) for (let b = a + 1; b < diff.length; b++) {
      const both = gate(`a${gi++}`, "$_AND_", diff[a], diff[b], next++);
      bad = bad === null ? both : gate(`o${gi++}`, "$_OR_", bad, both, next++);
    }
    buses.push({ name, off: hbus.length, w: bits.length });
    hbus.push(...bits.map((x) => x.src)); hamm.push(bad);
  }
  m.ports.hamm = { direction: "output", bits: hamm.length ? hamm : ["0"] };
  m.ports.hbus = { direction: "output", bits: hbus.length ? hbus : ["0"] };
  return { n: skew.length, buses };
}

// ---------- 3. run ----------
const txt = (x) => (typeof x === "string" ? x : new TextDecoder().decode(x));
const sink = (out, log) => (b) => { if (b) { const s = new TextDecoder().decode(b); out.push(s); log(s); } };

// After this, every flop runs on one global clock `gclk` and only moves when its domain's enable (ena / enb) is 1.
// So a step is one clock event: clk_a ticks, clk_b ticks, both or neither. `json` must come from dffunmap.
export function toEvents(json, top, an) {
  const m = json.modules[top];
  let next = Math.max(...Object.values(m.cells).flatMap((c) => Object.values(c.connections).flat().filter((b) => typeof b === "number")), ...Object.values(m.ports).flatMap((p) => p.bits.filter((b) => typeof b === "number"))) + 1;
  const g = next++, en = [next++, next++];
  m.ports.gclk = { direction: "input", bits: [g] }; m.ports.ena = { direction: "input", bits: [en[0]] }; m.ports.enb = { direction: "input", bits: [en[1]] };
  const dom = Object.fromEntries(an.clkBit.map((b, i) => [b, i]));
  for (const [cn, c] of Object.entries(m.cells)) {
    if (!/^\$_(S?DFF|DFFE|ALDFF|DLATCH|SR)/.test(c.type)) continue;
    if (c.type !== "$_DFF_P_") return `A flop uses ${/_N_/.test(c.type) ? "the falling clock edge" : "an asynchronous set or reset"}. Use rising-edge flops with synchronous resets here.`;
    const y = next++, q = c.connections.Q[0];
    m.cells[`$ev_${cn}`] = { type: "$_MUX_", parameters: {}, attributes: {}, port_directions: { A: "input", B: "input", S: "input", Y: "output" }, connections: { A: [q], B: c.connections.D, S: [en[dom[c.connections.C[0]]]], Y: [y] } };
    c.connections.D = [y]; c.connections.C = [g];
  }
  return null;
}

export function satScript(p, n) {
  const sets = [];
  for (let t = 1; t <= n; t++) {
    const rst = t <= RESET_STEPS ? 1 : 0;
    for (const r of p.cdc.resets) sets.push(`-set-at ${t} ${r} ${rst}`);
    if (t <= RESET_STEPS) sets.push(`-set-at ${t} ena 1 -set-at ${t} enb 1`);
  }
  return `read_json dut.json
read_verilog -sv -formal tb.v
hierarchy -top cdc_tb
proc; flatten; opt_clean
sat -verify -seq ${n} ${sets.join(" ")} -set proto 0 ${p.cdc.extra || ""} -prove fail 0 -show-ports -dump_vcd cex.vcd cdc_tb
`;
}

// Turn the failing run into the table the page already draws: every port per step, first = first bad step.
export function cdcCounterexample(vcdText, p, buses = []) {
  const { cycles, sigs } = parseVcd(vcdText);
  const fmt = (v) => (v === undefined ? "" : /[xz]/.test(v) ? "x" : String(parseInt(v, 2)));
  const get = (n) => sigs.find((s) => s.name === n || s.name === "in_" + n || s.name === "out_" + n);
  const rows = ["ena", "enb", ...p.cdc.show].map(get).filter(Boolean);
  const failSig = get("fail");
  let first = -1;
  for (let c = 0; c < cycles && first < 0; c++) if (failSig && failSig.values[c] === "1") first = c;
  if (first < 0) first = cycles - 1;
  const reasons = p.cdc.reasons.filter(([sig]) => { const s = get(sig); return s && s.values[first] === "1"; }).map(([, t]) => t);
  const inputs = rows.map((s) => ({ name: s.name.replace(/^(in|out)_/, ""), values: s.values.map(fmt) }));
  const hb = get("hbus"), hm = get("hamm");
  buses.forEach((b, k) => {
    // a bus is shown in binary, its bits as they leave the source flops
    inputs.push({ name: b.name, values: hb.values.map((v) => v.padStart(hb.width, "0").slice(hb.width - b.off - b.w, hb.width - b.off)) });
    if (hm && hm.values[first]?.padStart(hm.width, "0")[hm.width - 1 - k] === "1")
      reasons.unshift(`the bus "${b.name}" changed more than one bit in a single source-clock event. A bus that crosses clocks must change one bit at a time (Gray code), because a flop that catches it mid-change can see any mix of old and new bits`);
  });
  return { cycles, first, kind: "cdc", reasons, inputs, outputs: [] };
}

// Add the bus rule to the problem's harness: DUT ports `hamm` / `hbus`, checked once the reset steps are over.
function busHarness(h, buses) {
  const B = Math.max(1, buses.length), W = Math.max(1, buses.reduce((a, b) => a + b.w, 0));
  return h.replace(/output fail\);/, `output fail, output hamm_bad, output [${B - 1}:0] hamm, output [${W - 1}:0] hbus);\n  reg [1:0] rc = 0; always @(posedge gclk) if (rc != 3) rc <= rc + 1;\n  assign hamm_bad = (|hamm) & (rc >= 2);`)
    .replace(/\bfail = /, "fail = hamm_bad | ").replace(".skew(skew)", ".skew(skew), .hamm(hamm), .hbus(hbus)");
}

export async function gradeCdc(runYosys, Exit, p, userCode, log = () => {}) {
  const out = [];
  const files = { "user.v": userCode };
  const run = async (name, script, extra, opts = {}) => {
    try {
      const f = await runYosys(["-q", "-s", name], { ...files, ...extra, [name]: script }, { stdout: sink(out, log), stderr: sink(out, log), ...opts });
      return { ok: true, f };
    } catch (e) { if (!(e instanceof Exit)) throw e; return { ok: false, f: e.files }; }
  };
  const t0 = Date.now(), res = { passed: false, cdc: true, timing: {} };
  // 1. structure
  const s1 = await run("struct.ys", `read_verilog -sv user.v
hierarchy -check -top ${p.top}
proc; flatten; opt; memory; techmap; opt -fast; opt_clean -purge
write_json net.json
`);
  if (!s1.ok || !s1.f["net.json"]) {
    const logText = out.join("");
    res.log = logText;
    res.error = /Can't find|not part of the design/.test(logText) ? `Your module "${p.top}" was not found or has no logic yet. Keep the module name and the port names from the starter.` : (logText.match(/ERROR:.*$/m) || ["Yosys failed: check your code compiles"])[0];
    return res;
  }
  const json = JSON.parse(txt(s1.f["net.json"]));
  const an = analyze(json, p.top, p.cdc);
  res.timing.structureMs = Date.now() - t0;
  if (an.errors.length) { res.structural = an.errors; res.log = out.join(""); return res; }
  // 2. worst-case bit timing
  const { n, buses } = injectSkew(json, p.top, an);
  const u = await run("unmap.ys", `read_json skew.json\ndffunmap\nwrite_json dut.json\n`, { "skew.json": JSON.stringify(json) });
  const flat = JSON.parse(txt(u.f["dut.json"]));
  const bad = toEvents(flat, p.top, an);
  if (bad) { res.structural = [bad]; res.log = out.join(""); return res; }
  const t1 = Date.now();
  const r = await run("sat.ys", satScript(p, p.cdc.steps || CDC_STEPS), { "dut.json": JSON.stringify(flat), "tb.v": busHarness(p.cdc.harness, buses).replaceAll("{{N}}", n).replaceAll("{{TOP}}", p.top) });
  res.skewBits = n; res.timing.satMs = Date.now() - t1; res.steps = p.cdc.steps || CDC_STEPS; res.log = out.join("");
  if (r.ok) { res.passed = true; }
  else if (r.f && r.f["cex.vcd"]) res.cex = cdcCounterexample(txt(r.f["cex.vcd"]), p, buses);
  else res.error = (res.log.match(/ERROR:.*$/m) || ["Yosys failed to run the timing check"])[0];
  return res;
}
