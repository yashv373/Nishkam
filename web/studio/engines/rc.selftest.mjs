// node web/studio/engines/rc.selftest.mjs [bits]
// place -> route -> Magic (flatten + extract + extresist) -> SPEF, then checks the SPEF against Magic's own output from the SAME build:
//   1. each D_NET total == the lumped ext2spice total of that net (node C + all coupling caps) -- exact to ext2spice's printed precision
//   2. the *CAP lines of each net add up to its total, every *RES endpoint is a *CONN pin or a *CAP node
//   3. node by node: ground caps and resistors equal the ext2spice network (`ext2spice extresist on`)
import * as P from "./place.worker.js";
import * as R from "./route.worker.js";
import * as M from "./magic.worker.js";
import { parseExt } from "./spef.js";
process.on("unhandledRejection", () => {});
const bits = +(process.argv[2] || 8), top = `sr${bits}`;
const q = (i) => (i === bits - 1 ? "dout" : `q${i}`);
const netlist = `module ${top}(clk, rst_n, din, dout);\n  input clk; input rst_n; input din; output dout;\n` +
  Array.from({ length: bits - 1 }, (_, i) => `  wire q${i};`).join("\n") + "\n" +
  Array.from({ length: bits }, (_, i) => `  gf180mcu_fd_sc_mcu7t5v0__dffrnq_1 f${i} (.CLK(clk), .D(${i ? q(i - 1) : "din"}), .Q(${q(i)}), .RN(rst_n));`).join("\n") + "\nendmodule\n";
const io = { log: () => {}, progress: () => {} };
let fail = 0;
const t = (name, ok, extra = "") => { console.log(ok ? "PASS" : "FAIL", name, extra); fail += !ok; };
const dec = (b) => new TextDecoder().decode(b);

const pl = await P.handle({ files: { [`${top}.v`]: netlist }, options: { top } }, io);
const rt = await R.handle({ files: pl.files, options: { top } }, io);
const t0 = Date.now();
const mg = await M.handle({ files: rt.files, options: { top, drc: false, rc: true, keepRc: true } }, io);
const spef = dec(mg.files[`${top}.spef`]);
t("spef written", /^\*SPEF/.test(spef) && mg.summary.rcNets >= bits, `${mg.summary.rcNets} nets, ${Date.now() - t0} ms`);

// parse our SPEF
const nets = {};
let cur = null, sec = "";
for (const l of spef.split("\n")) {
  let m;
  if ((m = l.match(/^\*D_NET (\S+) (\S+)/))) { cur = nets[m[1]] = { total: +m[2], conn: new Set(), caps: {}, res: [] }; sec = ""; }
  else if (/^\*(CONN|CAP|RES)$/.test(l)) sec = l.slice(1);
  else if (l === "*END") cur = null;
  else if (cur && sec === "CONN") cur.conn.add(l.split(" ")[1]);
  else if (cur && sec === "CAP") { const f = l.split(" "); cur.caps[f[1]] = +f[2]; }
  else if (cur && sec === "RES") { const f = l.split(" "); cur.res.push([f[1], f[2], +f[3]]); }
}
// 2. internal consistency
let bad = 0;
for (const [n, d] of Object.entries(nets)) {
  const s = Object.values(d.caps).reduce((a, b) => a + b, 0);
  if (Math.abs(s - d.total) > 1e-6 * Math.max(1, d.total)) { bad++; console.log("  cap sum", n, s, d.total); }
  for (const [a, b] of d.res) for (const x of [a, b]) if (!d.conn.has(x) && !(x in d.caps)) { bad++; console.log("  dangling", n, x); }
}
t("*CAP sums and *RES endpoints consistent", !bad && Object.keys(nets).length >= bits + 3);

// SPEF node -> Magic node name, via the DEF pins ("f0:Q" -> "f0.Q"); internal "net:k" nodes are matched by value below.
const spice = (txt) => {
  const c = [], r = [];
  for (const l of txt.split("\n")) {
    const f = l.split(/\s+/);
    if (f[0][0] === "C") c.push([f[1], f[2], +f[3].replace(/f$/, "")]);
    else if (f[0][0] === "R") r.push([f[1], f[2], +f[3]]);
  }
  return { c, r };
};
const lump = spice(dec(mg.files[`${top}f_lump.spice`])), rc = spice(dec(mg.files[`${top}f_rc.spice`]));
const base = (n) => n.replace(/\.[tn]\d+$/, "");
const eq = {}; // alias -> primary, from ext2spice's `equiv` lines is not exposed; use the .ext
for (const l of dec(mg.files[`${top}f.ext`]).split("\n")) { const f = l.replace(/"/g, "").split(/\s+/); if (f[0] === "equiv") eq[f[2]] = f[1]; }
const prim = (n) => eq[n] ?? n;
// 1. totals. ext2spice (lumped) prints a cap below 1 aF as 0 and leaves negative ones out; allow exactly those losses, nothing else.
const E = parseExt(dec(mg.files[`${top}f.ext`]));
let worst = 0, checked = 0, lost = 0;
for (const [n, d] of Object.entries(nets)) {
  const p = prim([...d.conn][0].replace(":", "."));
  const tot = lump.c.filter(([a, b]) => prim(a) === p || prim(b) === p).reduce((s, [, , v]) => s + v, 0);
  const tiny = E.coupling.filter(([a, b, c]) => (prim(a) === p || prim(b) === p) && c < 1).reduce((s, x) => s + x[2], 0) / 1000; // below 1 aF, or negative
  lost += tiny; worst = Math.max(worst, Math.abs(tot + tiny - d.total)); checked++;
}
t("D_NET totals == Magic ext2spice lumped totals", worst < 2e-4 && checked >= bits + 3, `${checked} nets; worst difference ${(worst * 1000).toFixed(4)} aF after adding back the caps below 1 aF or negative that lumped ext2spice leaves out (${(lost * 1000).toFixed(1)} aF in all)`);
// 3. network vs ext2spice extresist netlist: ground caps and resistors
const sub = dec(mg.files[`${top}f_rc.spice`]).match(/^C\d+ \S+ (\S+) \S+ \*\*FLOATING/m)[1]; // substrate node name in ext2spice output
let gMax = 0, rMax = 0, nodeMiss = 0;
for (const [n, d] of Object.entries(nets)) {
  const p = prim([...d.conn][0].replace(":", "."));
  // ext2spice merges `equiv` pin labels into one node (f1.D into f0.Q) and so drops the resistor between them; do the same to ours before comparing
  const nm = (x) => prim(x.replace(":", "."));
  const capBy = {};
  for (const [k, v] of Object.entries(d.caps)) capBy[nm(k)] = (capBy[nm(k)] || 0) + v;
  const ours = Object.values(capBy).sort((a, b) => a - b);
  const theirs0 = rc.c.filter(([a, b]) => (b === sub && prim(base(a)) === p) || (a === sub && prim(base(b)) === p));
  const theirs = theirs0.map(([, , v]) => v).filter((v) => v > 0).sort((a, b) => a - b);
  if (process.env.V) console.log("  ", n, ours.length, theirs.length, ours.slice(-2), theirs.slice(-2));
  if (ours.length !== theirs.length) nodeMiss++;
  else ours.forEach((v, i) => { gMax = Math.max(gMax, Math.abs(v - theirs[i])); });
  const ro = d.res.filter(([a, b]) => nm(a) !== nm(b)).map((x) => x[2]).sort((a, b) => a - b), rt2 = rc.r.filter(([a]) => prim(base(a)) === p).map((x) => x[2]).sort((a, b) => a - b);
  if (ro.length !== rt2.length) nodeMiss++;
  else ro.forEach((v, i) => { rMax = Math.max(rMax, Math.abs(v - rt2[i])); });
}
t("ground caps and resistors == ext2spice extresist network", nodeMiss === 0 && gMax < 2e-5 && rMax < 6e-4, `count mismatches ${nodeMiss}, worst cap difference ${(gMax * 1000).toFixed(3)} aF, worst resistor difference ${rMax.toExponential(1)} ohm (ext2spice rounds up by 0.5 mohm)`);
process.exit(fail ? 1 : 0);
