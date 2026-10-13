// Zero-skew clock tree, implemented as published. No tuning, no buffers, no routing changes.
//  [CHAO] Chao, Hsu, Ho, Boese, Kahng, "Zero skew clock routing with minimum wirelength", IEEE TCAS-II 39(11):799-814, 1992
//         (topology: sec 3.4 BB; merging segments / TRR: sec 3.1; bottom-up Fig 5; top-down Fig 7; Elmore merge: eq (1),(2), sec 3.3.1)
//  [TSAY] Tsay, "An exact zero-skew clock routing algorithm", IEEE TCAD 12(2):242-249, 1993 (tap point x and elongation l', sec IV)
// Delay model: Elmore, internal-node capacitance 0, pi wire model (C/2 each end) [CHAO 2.1.2, TSAY III-A].
// Units: ohm, pF, um -> delay in ps (ohm*pF). Rotated coordinates u=x+y, v=x-y turn Manhattan distance into Chebyshev distance,
// so a TRR is a rectangle grown by its radius and a Manhattan arc is a degenerate rectangle (OPEN DETAIL 1, labelled below).
//
// Per-unit R and C (OPEN DETAIL 3: one routing layer, no layer search). Defaults = gf180mcu Metal3, from
//  web/vendor/gf180mcu/pd-7b70722/gf180mcu_fd_sc_mcu7t5v0__nom.tlef: Metal3 (LAYER at line 183) CAPACITANCE CPERSQDIST 0.00028 pF/um^2
//  (line 204), RESISTANCE RPERSQ 0.090 (line 205), WIDTH 0.280. alpha = RPERSQ/WIDTH, beta = CPERSQDIST*WIDTH (area term only: the
//  tech LEF has no edge/fringe cap, so none is added). Sink cap: liberty web/vendor/gf180mcu/lib-tt5v0-full/*.lib.gz, cell dffrnq_1,
//  pin(CLK) capacitance 0.003408 pF (line 88542 of the unzipped file).
import { serve } from "./_rpc.js";

export const layerRC = (rpersq, width, cpersqdist) => ({ alpha: rpersq / width, beta: cpersqdist * width });
export const M3 = layerRC(0.090, 0.280, 0.00028);

// ---- Tsay/Chao merge (steps 3-6, 8 of the note). Returns edge lengths to child a and b and the merged t, C. ----
export function merge(t1, C1, t2, C2, kappa, alpha, beta) {
  const xnum = t2 - t1 + alpha * kappa * (C2 + beta * kappa / 2); // [CHAO eq 2] numerator
  const den = alpha * kappa * (C1 + C2 + beta * kappa);           // [TSAY IV] denominator, x = xnum/den
  let ea, eb;
  if (xnum < 0) { // x < 0: a is slower; tap at a, snake toward b [CHAO 3.3.1 case 2]
    ea = 0; eb = (Math.sqrt((alpha * C2) ** 2 + 2 * alpha * beta * (t1 - t2)) - alpha * C2) / (alpha * beta);
  } else if (xnum > den) { // x > 1: mirror case
    eb = 0; ea = (Math.sqrt((alpha * C1) ** 2 + 2 * alpha * beta * (t2 - t1)) - alpha * C1) / (alpha * beta);
  } else { ea = den > 0 ? xnum / den * kappa : 0; eb = kappa - ea; } // den==0 here means kappa==0 and xnum==0: both 0
  return { ea, eb, t: t1 + alpha * ea * (beta * ea / 2 + C1), C: C1 + C2 + beta * (ea + eb) };
}

// ---- Topology: BB [CHAO 3.4]. sinks: [{x,y,c}] -> nested [left,right] of sink indices ----
const rangeOf = (ids, P, f) => { let lo = Infinity, hi = -Infinity; for (const i of ids) { const v = f(P[i]); if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };
// Manhattan diameter = max(range(x+y), range(x-y)) (the octagon fact [CHAO 3.4] relies on).
const dia = (ids, P) => ids.length < 2 ? 0 : Math.max(rangeOf(ids, P, p => p.x + p.y), rangeOf(ids, P, p => p.x - p.y));
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function bbSplit(ids, P) {
  if (ids.length === 2) return [[ids[0]], [ids[1]]];
  const tot = ids.reduce((s, i) => s + P[i].c, 0);
  // (a) Oct(S): sinks extreme in x, y, x+y, y-x (max and min)
  const fs = [p => p.x, p => p.y, p => p.x + p.y, p => p.y - p.x], oct = new Set();
  for (const f of fs) {
    let mn = ids[0], mx = ids[0];
    for (const i of ids) { if (f(P[i]) < f(P[mn])) mn = i; if (f(P[i]) > f(P[mx])) mx = i; }
    oct.add(mn); oct.add(mx);
  }
  // OPEN DETAIL 7: circular order = angle about the centroid of S; ties by index.
  const cx = ids.reduce((s, i) => s + P[i].x, 0) / ids.length, cy = ids.reduce((s, i) => s + P[i].y, 0) / ids.length;
  const O = [...oct].sort((a, b) => Math.atan2(P[a].y - cy, P[a].x - cx) - Math.atan2(P[b].y - cy, P[b].x - cx) || a - b);
  const k = Math.max(1, Math.floor(O.length / 2));
  let best = null;
  for (let s = 0; s < O.length; s++) { // (b) every REF_i of k consecutive Oct sinks
    const ref = Array.from({ length: k }, (_, j) => O[(s + j) % O.length]);
    const w = new Map(ids.map(i => { // (c) weight = min d + max d to REF
      let mn = Infinity, mx = -Infinity; for (const r of ref) { const d = dist(P[i], P[r]); if (d < mn) mn = d; if (d > mx) mx = d; }
      return [i, mn + mx]; }));
    const ord = [...ids].sort((a, b) => w.get(a) - w.get(b) || a - b); // (d) ascending weight
    // OPEN DETAIL 8: S1 = the prefix (1..n-1 sinks) whose capacitance is closest to half the total; first such prefix on ties.
    let acc = 0, bj = 1, bd = Infinity;
    for (let j = 1; j < ord.length; j++) { acc += P[ord[j - 1]].c; const d = Math.abs(acc - tot / 2); if (d < bd) { bd = d; bj = j; } }
    const S1 = ord.slice(0, bj), S2 = ord.slice(bj), cost = dia(S1, P) + dia(S2, P); // (e)
    if (!best || cost < best.cost) best = { cost, S1, S2 }; // (f) first best on ties
  }
  return [best.S1, best.S2];
}
export function bbTopology(sinks) {
  const rec = (ids) => ids.length === 1 ? ids[0] : bbSplit(ids, sinks).map(rec);
  return rec(sinks.map((_, i) => i));
}

// ---- Build the tree: bottom-up merging segments, top-down embedding [CHAO Figs 5, 7] ----
// ms = [ulo, uhi, vlo, vhi] in rotated coords. TRR = ms grown by radius (Chebyshev); distance between two ms = max(gap_u, gap_v).
const gap = (a0, a1, b0, b1) => Math.max(0, a0 - b1, b0 - a1);
export const msDist = (a, b) => Math.max(gap(a[0], a[1], b[0], b[1]), gap(a[2], a[3], b[2], b[3]));
const msNear = (m, u, v) => [Math.min(Math.max(u, m[0]), m[1]), Math.min(Math.max(v, m[2]), m[3])];
const xy = (u, v) => ({ x: (u + v) / 2, y: (u - v) / 2 });

export function buildTree(sinks, { alpha = M3.alpha, beta = M3.beta, topology, source } = {}) {
  if (!sinks.length) throw new Error("no sinks");
  const topo = topology ?? (sinks.length === 1 ? 0 : bbTopology(sinks));
  const nodes = [];
  const bu = (t) => { // bottom-up
    if (typeof t === "number") {
      const s = sinks[t], u = s.x + s.y, v = s.x - s.y;
      nodes.push({ id: nodes.length, sink: t, ms: [u, u, v, v], t: 0, C: s.c, e: 0 });
      return nodes.length - 1;
    }
    const a = bu(t[0]), b = bu(t[1]), A = nodes[a], B = nodes[b];
    const kappa = msDist(A.ms, B.ms), m = merge(A.t, A.C, B.t, B.C, kappa, alpha, beta);
    // ms(v) = trr_a ∩ trr_b with radii ea, eb. When ea+eb == kappa the result is an arc; rounding can leave a hairline
    // negative overlap, so crossed bounds are collapsed to their midpoint (relative tolerance 1e-9). In the snaking case this
    // intersection is the part of ms(a) within eb of ms(b) (the note writes ms(v)=ms(a): same when ms(a) is a point).
    const lim = (i, j) => { let lo = Math.max(A.ms[i] - m.ea, B.ms[i] - m.eb), hi = Math.min(A.ms[j] + m.ea, B.ms[j] + m.eb);
      if (lo > hi) { const tol = 1e-9 * (1 + Math.abs(lo) + Math.abs(hi)); if (lo - hi > tol) throw new Error("empty merging segment"); lo = hi = (lo + hi) / 2; } return [lo, hi]; };
    const [u0, u1] = lim(0, 1), [v0, v1] = lim(2, 3);
    A.e = m.ea; B.e = m.eb;
    nodes.push({ id: nodes.length, kids: [a, b], ms: [u0, u1, v0, v1], t: m.t, C: m.C, e: 0, kappa });
    return nodes.length - 1;
  };
  const root = bu(topo), R = nodes[root];
  // top-down. OPEN DETAIL 9: root point = centre of ms(root) (any point is allowed [CHAO 3.1.2]); with a fixed source, the
  // nearest point of ms(root) to it, plus a wire to the source [CHAO footnote 7] (the source wire is not added to wirelength).
  // Children: nearest point of ms(v) to the parent's point (valid: within |e_v|); any slack is snaking.
  const place = (n, u, v, parent) => {
    n.u = u; n.v = v; Object.assign(n, xy(u, v));
    if (parent) { n.geo = Math.max(Math.abs(u - parent.u), Math.abs(v - parent.v)); n.snake = n.e - n.geo; n.parent = parent.id; }
    if (n.kids) for (const k of n.kids) { const c = nodes[k], [cu, cv] = msNear(c.ms, n.u, n.v); place(c, cu, cv, n); }
  };
  let ru = (R.ms[0] + R.ms[1]) / 2, rv = (R.ms[2] + R.ms[3]) / 2;
  if (source) [ru, rv] = msNear(R.ms, source.x + source.y, source.x - source.y);
  place(R, ru, rv, null);
  return { nodes, root, alpha, beta, topology: topo, ...analyze(nodes, root, alpha, beta, sinks) };
}

// Independent Elmore evaluation of a finished tree: bottom-up C, top-down delay [TSAY II]; wire r_e*(c_e/2 + C_below).
export function analyze(nodes, root, alpha, beta, sinks) {
  const C = {}, D = {};
  const cap = (n) => (C[n.id] = n.kids ? n.kids.reduce((s, k) => s + beta * nodes[k].e + cap(nodes[k]), 0) : sinks[n.sink].c);
  cap(nodes[root]);
  const dl = (n, d) => { D[n.id] = d; if (n.kids) for (const k of n.kids) { const c = nodes[k]; dl(c, d + alpha * c.e * (beta * c.e / 2 + C[c.id])); } };
  dl(nodes[root], 0);
  const sinkDelay = nodes.filter(n => n.sink !== undefined).map(n => ({ sink: n.sink, delay: D[n.id] }));
  const ds = sinkDelay.map(s => s.delay);
  return { sinkDelay, skew: Math.max(...ds) - Math.min(...ds), maxDelay: Math.max(...ds), wirelength: nodes.reduce((s, n) => s + n.e, 0),
    snakeLength: nodes.reduce((s, n) => s + (n.snake || 0), 0), totalCap: C[root] };
}

// ---- DEF in, DEF fragment out ----
const stmts = (sec, def) => { const m = def.match(new RegExp(`^${sec}\\b[^;]*;([\\s\\S]*?)^END ${sec}`, "m")); return m ? m[1].split(";").map(s => s.trim()).filter(Boolean) : []; };
export function parseLef(lef) { // MACRO -> {w,h, pins:{name:{cx,cy}}} : centre of the first RECT of each pin
  const out = {};
  for (const m of lef.matchAll(/^MACRO (\S+)([\s\S]*?)^END \1\b/gm)) {
    const sz = m[2].match(/SIZE\s+([\d.]+)\s+BY\s+([\d.]+)/), pins = {};
    for (const p of m[2].matchAll(/^\s*PIN (\S+)([\s\S]*?)^\s*END \1\b/gm)) { const r = p[2].match(/RECT\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/); if (r) pins[p[1]] = { cx: (+r[1] + +r[3]) / 2, cy: (+r[2] + +r[4]) / 2 }; }
    if (sz) out[m[1]] = { w: +sz[1], h: +sz[2], pins };
  }
  return out;
}
export function libPinCap(lib, cell, pin) { // liberty text -> pin capacitance (the file's capacitive_load_unit is pF)
  const i = lib.indexOf(`cell(${cell})`); if (i < 0) throw new Error(`cell ${cell} not in liberty`);
  const j = lib.indexOf(`pin(${pin})`, i), c = j < 0 ? null : lib.slice(j).match(/capacitance\s*:\s*([\d.eE+-]+)/);
  if (!c) throw new Error(`pin ${pin} of ${cell} has no capacitance`);
  return +c[1];
}
// Sinks of one net (pin centre in um). capOf(cellName, pin) -> pF. Orientation: N, FN (mirror x), FS (mirror y), S (both).
export function clockSinks(def, lef, net, capOf) {
  const dbu = +(def.match(/UNITS DISTANCE MICRONS (\d+)/) || [, 1000])[1], macros = parseLef(lef), comp = {};
  for (const s of stmts("COMPONENTS", def)) { const m = s.match(/^- (\S+) (\S+)[\s\S]*?\(\s*(-?\d+)\s+(-?\d+)\s*\)\s+(\w+)/); if (m) comp[m[1]] = { cell: m[2], x: +m[3] / dbu, y: +m[4] / dbu, o: m[5] }; }
  const ns = stmts("NETS", def).find(s => s.match(/^- (\S+)/)?.[1] === net);
  if (!ns) throw new Error(`net ${net} not in DEF`);
  const sinks = [];
  for (const p of ns.matchAll(/\(\s*(\S+)\s+(\S+)\s*\)/g)) {
    if (p[1] === "PIN") continue; // top-level port = clock source, not a sink
    const c = comp[p[1]], mac = c && macros[c.cell], pn = mac && mac.pins[p[2]]; if (!pn) throw new Error(`no LEF pin for ${p[1]}.${p[2]}`);
    const fx = c.o === "FN" || c.o === "S", fy = c.o === "FS" || c.o === "S";
    sinks.push({ name: `${p[1]}/${p[2]}`, x: c.x + (fx ? mac.w - pn.cx : pn.cx), y: c.y + (fy ? mac.h - pn.cy : pn.cy), c: capOf(c.cell, p[2]) });
  }
  return { sinks, dbu };
}
// DEF fragment: one NETS entry; each edge is an L, plus one rectilinear bump carrying the elongation (OPEN DETAIL 10), rounded to dbu.
export function defFragment(tree, net, layer, dbu) {
  const r = (v) => Math.round(v * dbu), seg = [];
  for (const n of tree.nodes) {
    if (n.parent === undefined) continue;
    const p = tree.nodes[n.parent], s = Math.max(0, n.snake), k = n.y >= p.y ? -s / 2 : s / 2;
    const pts = s > 1e-9 ? [[p.x, p.y], [p.x, p.y + k], [n.x, p.y + k], [n.x, n.y]] : [[p.x, p.y], [n.x, p.y], [n.x, n.y]];
    seg.push("  + ROUTED " + layer + " " + pts.map(([x, y]) => `( ${r(x)} ${r(y)} )`).join(" "));
  }
  return `NETS 1 ;\n- ${net}_zst\n${seg.join("\n")}\n;\nEND NETS\n`;
}

export async function handle(req, { log } = {}) {
  const { def, lef, net = "clk", capOf, pinCap = 0.003408, layer = "Metal3", alpha = M3.alpha, beta = M3.beta } = req;
  const { sinks, dbu } = clockSinks(def, lef, net, capOf || (() => pinCap));
  const tree = buildTree(sinks, { alpha, beta });
  log?.(`cts: ${sinks.length} sinks, skew ${tree.skew.toExponential(2)} ps, wirelength ${tree.wirelength.toFixed(1)} um`);
  const { nodes, root, sinkDelay, skew, maxDelay, wirelength, snakeLength, totalCap } = tree;
  const json = { net, alpha, beta, root, sinks, sinkDelay, skew, maxDelay, wirelength, snakeLength, totalCap,
    nodes: nodes.map(({ id, sink, kids, x, y, e, geo, snake, parent, t, C }) => ({ id, sink, kids, x, y, edgeLength: e, manhattan: geo, snake, parent, t, C })) };
  return { ok: true, json, def: defFragment(tree, net, layer, dbu), summary: { sinks: sinks.length, skew, maxDelay, wirelength, snakeLength } };
}
serve(handle);
