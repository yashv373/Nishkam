// Compact Liberty reader for the browser STA/power engine. Plain ES module, no dependencies.
// parse(text)  -> generic group tree {name,args,attrs,groups}
// toModel(tree)-> small timing/power model (what we vendor, gzipped JSON); lookup() does NLDM interpolation.
// Units are whatever the library says (gf180: ns, pF, uW, pJ); STA/power assume that and read them from the model.

export function parse(src) {
  const re = /\/\*[\s\S]*?\*\/|\\\r?\n|"((?:[^"\\]|\\[\s\S])*)"|([A-Za-z_][\w.$]*|[-+]?[\d.][\w.+-]*)|([(){};:,])/g;
  const tok = [];
  for (let m; (m = re.exec(src)); ) {
    if (m[1] !== undefined) tok.push({ s: m[1].replace(/\\\r?\n/g, "") }); // line continuations sit inside strings
    else if (m[2] !== undefined) tok.push(m[2]);
    else if (m[3]) tok.push(m[3]);
  }
  let i = 0;
  const val = () => { const t = tok[i++]; return typeof t === "object" ? t.s : t; };
  function body(g) {
    while (i < tok.length && tok[i] !== "}") {
      const name = val();
      if (tok[i] === ":") { // simple attribute
        i++; const vs = [val()];
        while (tok[i] !== ";" && i < tok.length) vs.push(val());
        i++; g.attrs[name] = vs.join(" ");
      } else if (tok[i] === "(") { // group or complex attribute
        i++; const args = [];
        while (tok[i] !== ")") { if (tok[i] === ",") i++; else args.push(val()); }
        i++;
        if (tok[i] === "{") { i++; const c = { name, args, attrs: {}, groups: [] }; body(c); i++; g.groups.push(c); }
        else { if (tok[i] === ";") i++; g.attrs[name] = args; }
      } else i++; // stray token
    }
  }
  const root = { name: "", args: [], attrs: {}, groups: [] };
  body(root);
  return root.groups[0];
}

const nums = (s) => String(s).split(/[\s,]+/).filter(Boolean).map(Number);
const r4 = (x) => +x.toPrecision(5);

// A table group (cell_rise, rise_power, ...) -> {i1, i2?, v:[flat row-major]}
function table(g, tpl) {
  const t = tpl[g.args[0]] || {};
  const i1 = g.attrs.index_1 ? nums(g.attrs.index_1[0]) : t.i1;
  const i2 = g.attrs.index_2 ? nums(g.attrs.index_2[0]) : t.i2;
  const v = [].concat(...[].concat(g.attrs.values).map(nums)).map(r4);
  return i1 && i1.length > 1 ? { i1: i1.map(r4), ...(i2 && i2.length > 1 ? { i2: i2.map(r4) } : {}), v } : { v };
}

const merge = (a, b, f) => (a ? { ...a, v: a.v.map((x, k) => f(x, b.v[k])) } : b);
const MAXF = Math.max, MINF = Math.min;

export function toModel(lib) {
  const tpl = {};
  for (const g of lib.groups) if (g.name === "lu_table_template" || g.name === "power_lut_template")
    tpl[g.args[0]] = { i1: g.attrs.index_1 && nums(g.attrs.index_1[0]), i2: g.attrs.index_2 && nums(g.attrs.index_2[0]) };
  const unit = (k, d) => { const a = lib.attrs[k]; return a ? (Array.isArray(a) ? a.join(" ") : a) : d; };
  const model = {
    library: lib.args[0], time_unit: unit("time_unit", "1ns"), cap_unit: unit("capacitive_load_unit", "1,pf").replace(/\s/g, ""),
    leakage_unit: unit("leakage_power_unit", "1uW"), voltage: +lib.attrs.nom_voltage || 1, cells: {},
  };
  for (const c of lib.groups.filter((g) => g.name === "cell")) {
    const cell = { area: +c.attrs.area || 0, pins: {}, arcs: [] };
    const lk = c.groups.filter((g) => g.name === "leakage_power");
    const w = lk.filter((g) => g.attrs.when !== undefined);
    const pick = w.length ? w : lk;
    cell.leak = pick.length ? r4(pick.reduce((s, g) => s + +g.attrs.value, 0) / pick.length) : +c.attrs.cell_leakage_power || 0;
    const arcs = new Map();
    for (const p of c.groups.filter((g) => g.name === "pin")) {
      const pin = { dir: p.attrs.direction };
      if (p.attrs.capacitance) pin.cap = +p.attrs.capacitance;
      if (p.attrs.function) pin.fn = p.attrs.function;
      if (p.attrs.clock === "true") pin.clock = 1;
      // internal power: average the "when" variants per related pin
      const pw = new Map();
      for (const ip of p.groups.filter((g) => g.name === "internal_power")) {
        const rel = ip.attrs.related_pin || "";
        const e = pw.get(rel) || { rel, n: 0 };
        for (const kind of ["rise_power", "fall_power"]) {
          const t = ip.groups.find((g) => g.name === kind);
          if (t) { const tb = table(t, tpl); e[kind] = e[kind] ? { ...tb, v: e[kind].v.map((x, k) => x + tb.v[k]) } : tb; }
        }
        e.n++; pw.set(rel, e);
      }
      if (pw.size) pin.pw = [...pw.values()].map((e) => ({
        rel: e.rel, rise: e.rise_power && { ...e.rise_power, v: e.rise_power.v.map((x) => r4(x / e.n)) },
        fall: e.fall_power && { ...e.fall_power, v: e.fall_power.v.map((x) => r4(x / e.n)) } }));
      cell.pins[p.args[0]] = pin;
      for (const t of p.groups.filter((g) => g.name === "timing")) {
        const type = t.attrs.timing_type || "combinational";
        if (/pulse|period|non_seq|three_state/.test(type)) continue;
        const key = [t.attrs.related_pin, p.args[0], type, t.attrs.timing_sense || "non_unate"].join("|");
        const a = arcs.get(key) || { from: t.attrs.related_pin, to: p.args[0], type, sense: t.attrs.timing_sense || "non_unate", hi: {}, lo: {} };
        const isCheck = /^(setup|hold|recovery|removal)/.test(type);
        for (const tg of t.groups) {
          if (!/_(rise|fall|transition|constraint)$/.test(tg.name) || !tg.groups && 0) continue;
          const tb = table(tg, tpl);
          if (!tb.v.length) continue;
          a.hi[tg.name] = merge(a.hi[tg.name], tb, MAXF);
          if (!isCheck) a.lo[tg.name] = merge(a.lo[tg.name], tb, MINF);
        }
        arcs.set(key, a);
      }
    }
    cell.arcs = [...arcs.values()].map((a) => (JSON.stringify(a.lo) === JSON.stringify(a.hi) || !Object.keys(a.lo).length ? { ...a, lo: undefined } : a));
    model.cells[c.args[0]] = cell;
  }
  return model;
}

// Bilinear interpolation, linear extrapolation outside the index range. x -> index_1, y -> index_2.
function seg(ix, x) {
  let i = ix.length - 2;
  for (let k = 1; k < ix.length - 1; k++) if (x < ix[k]) { i = k - 1; break; }
  return [i, (x - ix[i]) / (ix[i + 1] - ix[i])];
}
export function lookup(t, x, y = 0) {
  if (!t.i1) return t.v[0];
  const [i, u] = seg(t.i1, x);
  if (!t.i2) return t.v[i] + u * (t.v[i + 1] - t.v[i]);
  const [j, w] = seg(t.i2, y), n = t.i2.length, v = t.v;
  const a = v[i * n + j] + w * (v[i * n + j + 1] - v[i * n + j]);
  const b = v[(i + 1) * n + j] + w * (v[(i + 1) * n + j + 1] - v[(i + 1) * n + j]);
  return a + u * (b - a);
}

// Load a vendored model: gzipped JSON via DecompressionStream (browser and Node 18+; file: URLs read from disk).
export async function loadModel(url) {
  const buf = url.protocol === "file:" ? await (await import("node:fs/promises")).readFile(url) : await (await fetch(url)).arrayBuffer();
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(s).text());
}
