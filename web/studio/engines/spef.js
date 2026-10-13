// Magic RC extraction -> SPEF (IEEE 1481). Pure format translation: every number comes from Magic, none is modelled here.
// Inputs (text): the FLATTENED cell's <top>f.ext and <top>f.res.ext (Magic `flatten`, `extract all`, `extresist all`), the routed DEF
// (net names and pins: Magic does not keep DEF net names) and, optionally, the cell LEF (pin directions).
// Magic's own rule (read from ext2spice's RC netlist, checked in rc.selftest.mjs): the ground capacitance of a net is its .ext
// node C plus all of its coupling caps (negative ones too, as in ext2spice's extresist network) (coupling is folded to ground, which is also how OpenSTA treats SPEF coupling caps).
// The .res.ext rnode caps carry part of it; the remainder sits on the net's main node. Resistors are copied as they are.
// Limits: instance names containing "." are not handled (Magic's flatten uses "." as its divider).

const q = (s) => s.replace(/"/g, "");

export function parseDef(text) {
  const inst = {}, nets = {}, ports = {};
  let sec = "", net = null, stop = false;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    const m = l.match(/^(COMPONENTS|NETS|PINS|SPECIALNETS)\b/);
    if (m) { sec = m[1]; continue; }
    if (/^END (COMPONENTS|NETS|PINS|SPECIALNETS)/.test(l)) { sec = ""; net = null; continue; }
    if (sec === "COMPONENTS") { const c = l.match(/^- (\S+) (\S+)/); if (c) inst[c[1]] = c[2]; }
    else if (sec === "PINS") { const c = l.match(/^- (\S+) \+ NET (\S+)/); if (c) ports[c[1]] = { net: c[2], dir: (l.match(/\+ DIRECTION (\w+)/) || [])[1] }; }
    else if (sec === "NETS") {
      const c = l.match(/^- (\S+)/);
      if (c) { net = c[1]; nets[net] = []; stop = false; }
      if (/^(\+|NEW)/.test(l)) stop = true; // routing geometry follows: its (x y) pairs are not pins
      if (net && !stop) for (const p of l.matchAll(/\(\s*(\S+)\s+(\S+)\s*\)/g)) nets[net].push(p[1] === "PIN" ? { port: p[2] } : { inst: p[1], pin: p[2] });
    }
  }
  return { inst, nets, ports };
}

export function parseLefDirs(text) {
  const d = {};
  let cell = null, pin = null;
  for (const l of text.split("\n")) {
    let m;
    if ((m = l.match(/^\s*MACRO (\S+)/))) { cell = m[1]; d[cell] = {}; }
    else if ((m = l.match(/^\s*PIN (\S+)/))) pin = m[1];
    else if (cell && pin && (m = l.match(/^\s*DIRECTION (\w+)/))) { d[cell][pin] = m[1]; pin = null; }
  }
  return d;
}

export function parseExt(text) {
  const node = {}, coupling = [], parent = {};
  const find = (a) => { while (parent[a] && parent[a] !== a) a = parent[a]; return a; };
  for (const l of text.split("\n")) {
    const f = q(l).split(/\s+/);
    if (f[0] === "node") { node[f[1]] = +f[3]; parent[f[1]] ??= f[1]; }
    else if (f[0] === "equiv") { parent[f[2]] = find(f[1]); parent[f[1]] ??= f[1]; }
    else if (f[0] === "cap") coupling.push([f[1], f[2], +f[3]]);
  }
  return { node, coupling, find };
}

export function parseRes(text) {
  const rnode = {}, resist = [];
  for (const l of text.split("\n")) {
    const f = q(l).split(/\s+/);
    if (f[0] === "rnode") rnode[f[1]] = +f[3];
    else if (f[0] === "resist") resist.push([f[1], f[2], +f[3]]);
  }
  return { rnode, resist };
}

// aF -> fF without float noise
const fF = (aF) => String(+(aF / 1000).toPrecision(9));

// Returns {spef, nets: {name: {totalFF, caps, res}}}
export function toSpef({ top, def, ext, res, lef = "", date = "" }) {
  const D = parseDef(def), E = parseExt(ext), R = parseRes(res), dirs = lef ? parseLefDirs(lef) : {};
  const out = [], nets = {};
  out.push(`*SPEF "IEEE 1481-1998"`, `*DESIGN "${top}"`, `*DATE "${date}"`, `*VENDOR "Nishkam"`, `*PROGRAM "Magic RC to SPEF"`,
    `*VERSION "1"`, `*DESIGN_FLOW "EXTERNAL_LOADS" "PIN_CAP NONE"`, `*DIVIDER /`, `*DELIMITER :`, `*BUS_DELIMITER [ ]`,
    `*T_UNIT 1 NS`, `*C_UNIT 1 FF`, `*R_UNIT 1 OHM`, `*L_UNIT 1 HENRY`, "");

  // Magic node name -> SPEF name; Magic net group (primary name) -> DEF net
  const toNet = {}, spefName = {}, ioDir = {};
  for (const [name, conns] of Object.entries(D.nets)) {
    for (const c of conns) {
      const magic = c.port ?? `${c.inst}.${c.pin}`;
      const id = c.port ?? `${c.inst}:${c.pin}`;
      spefName[magic] = id;
      const d = c.port ? ({ INPUT: "I", OUTPUT: "O" }[D.ports[c.port]?.dir] || "B")
        : ({ INPUT: "I", OUTPUT: "O" }[dirs[D.inst[c.inst]]?.[c.pin]] || "B");
      ioDir[id] = d;
      if (magic in E.node) toNet[E.find(magic)] = name;
    }
  }
  // total capacitance per Magic net group: node C + every coupling cap touching it
  const total = {};
  // every cap, negative ones included: this is what `ext2spice extresist on` puts in the network (the lumped ext2spice leaves negative ones out)
  for (const [n, c] of Object.entries(E.node)) total[E.find(n)] = (total[E.find(n)] || 0) + c;
  for (const [a, b, c] of E.coupling) { const A = E.find(a), B = E.find(b); if (A === B) continue; total[A] = (total[A] || 0) + c; total[B] = (total[B] || 0) + c; }

  // rnodes and resistors per net
  const owner = (n) => { let g = E.find(n); if (g in toNet) return g; g = E.find(n.replace(/\.[tn]\d+$/, "")); return g in toNet ? g : null; };
  const per = {};
  const slot = (g) => (per[g] ??= { c: {}, r: [] });
  for (const [n, c] of Object.entries(R.rnode)) { const g = owner(n); if (g) slot(g).c[n] = c; }
  for (const [a, b, r] of R.resist) { const g = owner(a); if (g) slot(g).r.push([a, b, r]); }

  for (const [g, net] of Object.entries(toNet)) {
    const p = per[g] || { c: {}, r: [] };
    const sumR = Object.values(p.c).reduce((s, v) => s + v, 0);
    p.c[g] = (p.c[g] || 0) + ((total[g] ?? 0) - sumR); // remainder of the net's total sits on the main node
    const ids = {}; let k = 0;
    const id = (n) => spefName[n] ?? (ids[n] ??= `${net}:${++k}`);
    const cl = D.nets[net].map((c) => (c.port ? `*P ${c.port} ${ioDir[c.port]}` : `*I ${c.inst}:${c.pin} ${ioDir[`${c.inst}:${c.pin}`]}`));
    let i = 0; const caps = [];
    for (const [n, c] of Object.entries(p.c)) if (c) caps.push(`${++i} ${id(n)} ${fF(c)}`);
    let j = 0; const rs = p.r.map(([a, b, r]) => `${++j} ${id(a)} ${id(b)} ${r}`);
    const tot = Object.values(p.c).reduce((s, v) => s + v, 0);
    out.push(`*D_NET ${net} ${fF(tot)}`, "*CONN", ...cl, ...(caps.length ? ["*CAP", ...caps] : []), ...(rs.length ? ["*RES", ...rs] : []), "*END", "");
    nets[net] = { totalFF: tot / 1000, caps: caps.length, res: rs.length };
  }
  return { spef: out.join("\n"), nets };
}
