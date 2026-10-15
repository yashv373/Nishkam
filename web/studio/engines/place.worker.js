// Placement: gate netlist -> qflow-style chain as WebAssembly (GPL tools, own worker, mere aggregation).
//   qrouter -i (layer info) -> vlog2Cel -> syntax/Mincut/TimberWolfMC(+genrows)/TimberWolfSC (graywolf) -> place2def (JS port) -> addspacers
// Replaces qflow's csh scripts graywolf.sh / place2def.tcl. Output: <top>.def (placed + filled, unrouted), <top>.obs, <top>.info, logs.
import { serve, text } from "./_rpc.js";

// Asyncify programs end with exit(), which rejects an internal promise with ExitStatus after we already have the result.
// Swallow only that, so it neither kills the worker nor shows as an error. Same guard for Node (selftest).
const isExit = (r) => r && (r.status !== undefined || /ExitStatus/.test(String(r)));
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope)
  self.addEventListener("unhandledrejection", (e) => { if (isExit(e.reason)) e.preventDefault(); });
else if (typeof process !== "undefined" && process.on) process.on("unhandledRejection", (r) => { if (!isExit(r)) throw r; });

export const V = {
  gw: new URL("../../vendor/graywolf/33fbcaa/", import.meta.url),
  qf: new URL("../../vendor/qrouter/c8f1111/", import.meta.url),
  pd: new URL("../../vendor/gf180mcu/pd-7b70722/", import.meta.url),
};
export const PDK = { lef: "gf180mcu_fd_sc_mcu7t5v0.lef", tlef: "gf180mcu_fd_sc_mcu7t5v0__nom.tlef", par: "gf180mcu_fd_sc_mcu7t5v0.par",
  gds: "gf180mcu_fd_sc_mcu7t5v0.gds", spice: "gf180mcu_fd_sc_mcu7t5v0.spice", tech: "gf180mcuD.tech" };

const cache = new Map();
export async function readBin(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let b;
  if (url.protocol === "file:") b = new Uint8Array(await (await import("node:fs/promises")).readFile(url));
  else { const r = await fetch(url); if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`); b = new Uint8Array(await r.arrayBuffer()); }
  cache.set(url.href, b);
  return b;
}
export const pdk = (k) => readBin(new URL(PDK[k], V.pd));

// Run one Emscripten program on a scratch filesystem. Returns {files, status}. opts.hook = async (cmd, mod) => exit code for subprocess calls.
// opts.async: program uses Asyncify (exit() does not return from callMain), so wait for its "terminated" line.
let RAW = () => {};   // handle() functions point this at the request's raw(); route.worker.js shares runTool
export const setRaw = (f) => { RAW = f || (() => {}); };
const GW = /^(syntax|Mincut|TimberWolf(MC|SC)|genrows)$/;
export async function runTool(base, name, args, inFiles, log, opts = {}) {
  let mod, done;
  const finished = new Promise((r) => (done = r));
  const out = [];
  const tag = (GW.test(name) ? "graywolf/" : name === "qrouter" ? "" : "qflow/") + name;
  RAW(tag, "", "out", true);
  const say = (s) => { out.push(s); if (opts.async && /terminated (normally|abnormally)/.test(s)) done(); };
  const create = (await import(new URL(name + ".js", base).href)).default;
  mod = await create({ print: (s) => { RAW(tag, s + "\n", "out"); say(s); }, printErr: (s) => { RAW(tag, s + "\n", "err"); say(s); }, nishkamSystem: opts.hook && ((c) => opts.hook(c, mod)) });
  for (const [k, v] of Object.entries(inFiles)) mod.FS.writeFile("/" + k, v);
  let status = 0;
  try { mod.callMain(args); } catch (e) { if (e?.status !== undefined) status = e.status; else throw e; }
  if (opts.async) await finished;
  const text_ = out.join("\n");
  log(`$ ${name} ${args.join(" ")}\n` + (opts.quiet ? "" : text_ + "\n"));
  const files = {};
  for (const f of mod.FS.readdir("/")) {
    const st = mod.FS.stat("/" + f);
    if (mod.FS.isFile(st.mode) && !(f in inFiles && opts.onlyNew)) files[f] = mod.FS.readFile("/" + f);
  }
  return { files, status, out: text_ };
}

// graywolf sub-program hook: only genrows is run by TimberWolfMC.
const genrowsHook = (log) => async (cmd, mod) => {
  const a = cmd.trim().split(/\s+/);
  if (!/genrows$/.test(a[0])) return 1;
  const have = {};
  for (const f of mod.FS.readdir("/")) if (mod.FS.isFile(mod.FS.stat("/" + f).mode)) have[f] = mod.FS.readFile("/" + f);
  const r = await runTool(V.gw, "genrows", a.slice(1), have, log, { quiet: true });
  for (const [k, v] of Object.entries(r.files)) mod.FS.writeFile("/" + k, v);
  return r.status;
};

// ---- place2def.tcl, ported. Integer division in Tcl floors; all inputs here are integers or doubles from the .info file.
const idiv = (a, b) => Math.floor(a / b);
export function parseInfo(info) {
  let scale = null; const m = [];
  for (const line of info.split("\n")) {
    if (/^qrouter /.test(line)) continue;
    const u = line.match(/^\s*units\s+scale\s+(\S+)/);
    if (u) { scale = Number(u[1]); continue; }
    const t = line.trim().split(/\s+/);
    if (t.length >= 5) m.push({ name: t[0], pitch: +t[1], offset: +t[2], width: +t[3], orient: t[4], skip: t[5] ? +t[5] : 1 });
  }
  return { scale: scale ?? 100, metal: m.filter((x) => x.pitch > 0 && x.width > 0) };
}

export function place2def(top, files, fillCell, numLayersReq) {
  const { scale, metal } = parseInfo(files[".info"]);
  const numlayers = numLayersReq && numLayersReq <= metal.length ? numLayersReq : metal.length;
  const m1 = metal[0], m2 = metal[1];
  const oscale = [100, 200, 1000, 2000, 10000, 20000].find((o) => o % scale === 0);
  const mult = oscale / scale;
  const r = Math.round;
  const h1 = m1.orient === "horizontal";
  const pitchx = r(scale * (h1 ? m2 : m1).pitch), pitchy = r(scale * (h1 ? m1 : m2).pitch);
  const offsetx = r(scale * (h1 ? m2 : m1).offset), offsety = r(scale * (h1 ? m1 : m2).offset);
  const widthx = r(scale * (h1 ? m2 : m1).width), widthy = r(scale * (h1 ? m1 : m2).width);
  const hpx = idiv(pitchx, 2), hpy = idiv(pitchy, 2), hwx = idiv(widthx, 2), hwy = idiv(widthy, 2);
  const lines = (s) => s.split("\n").filter((l) => l.trim());
  let xbot = 1000, ybot = 1000, cellxbot = 1000, cellybot = 1000, xtop = 0, ytop = 0, corexbot, corextop, coreybot, coreytop;
  for (const line of lines(text(files[".pl2"]))) {
    const t = line.trim().split(/\s+/);
    let [, llx, lly, urx, ury] = t.map((v, i) => (i === 0 ? v : +v));
    if (t[0].startsWith("twpin")) {
      let cx = idiv(llx + urx, 2) - hpx - offsetx, cy = idiv(lly + ury, 2) - hpy - offsety;
      cx = (1 + Math.floor(cx / pitchx)) * pitchx + offsetx; cy = (1 + Math.floor(cy / pitchy)) * pitchy + offsety;
      llx = cx - hwx; lly = cy - hwy; urx = cx + hwx; ury = cy + hwy;
    } else if (llx < cellxbot || lly < cellybot) { if (llx < cellxbot) cellxbot = llx; if (lly < cellybot) cellybot = lly; }
    if (llx < xbot) xbot = llx; if (lly < ybot) ybot = lly; if (urx > xtop) xtop = urx; if (ury > ytop) ytop = ury;
    if (!t[0].startsWith("twpin")) { corexbot = xbot; corextop = xtop; coreybot = ybot; coreytop = ytop; }
  }
  cellxbot -= offsetx; cellybot -= offsety;
  corextop = offsetx + corextop - corexbot; coreytop = offsety + coreytop - coreybot; corexbot = offsetx; coreybot = offsety;
  let diexbot = Math.floor((xbot - cellxbot - hpx) / pitchx) * pitchx;
  let dieybot = Math.floor((ybot - cellybot - hpy) / pitchy) * pitchy;
  let diextop = Math.floor((xtop - cellxbot + hpx) / pitchx) * pitchx;
  let dieytop = Math.floor((ytop - cellybot + hpy) / pitchy) * pitchy;
  const O = (v) => r(v * mult);
  // Routing grid shifted by 0.14 um (a quarter track) in x and y, pads with it. On the library's own grid several cells (oai21_2, mux2, aoi22, ...)
  // have inputs whose stubs land on a neighbouring pin: Magic then finds shorted nets. Measured: adder, tiny8, mult8, two-clock all LVS-clean with this shift.
  const shx = r(scale * 0.14), shy = r(scale * 0.14);
  const def = [`VERSION 5.6 ;`, `DIVIDERCHAR "/" ;`, `BUSBITCHARS "[]" ;`, `DESIGN ${top} ;`, `UNITS DISTANCE MICRONS ${oscale} ;`, ``,
    `DIEAREA ( ${O(diexbot)} ${O(dieybot)} ) ( ${O(diextop)} ${O(dieytop)} ) ;`, ``];
  const width = diextop - diexbot, height = dieytop - dieybot;
  for (let i = 0; i < numlayers; i++) {
    const L = metal[i], mp = scale * L.pitch, omp = r(mp * mult);
    def.push(L.orient === "vertical" ? `TRACKS X ${O(diexbot + shx)} DO ${1 + Math.trunc(width / mp)} STEP ${omp} LAYER ${L.name} ;`
      : `TRACKS Y ${O(dieybot + shy)} DO ${1 + Math.trunc(height / mp)} STEP ${omp} LAYER ${L.name} ;`);
  }
  def.push(``);
  // obstructions along the die edge (appended to .obs; addspacers later rewrites it as .obsx)
  const um = (v) => v / scale, ox = (v) => +v.toFixed(6);
  const dxb = um(diexbot - pitchx), dxt = um(diextop + pitchx), dyb = um(dieybot - pitchy), dyt = um(dieytop + pitchy);
  const cxb = um(corexbot), cxt = um(corextop + pitchx), cyb = um(coreybot), cyt = um(coreytop + pitchy);
  const obs = [];
  const ob = (a, b, c, d, n) => obs.push(`obstruction ${ox(a)} ${ox(b)} ${ox(c)} ${ox(d)} ${n}`);
  if (numlayers > 2) { ob(dxb, cyt, dxt, dyt, m1.name); ob(dxb, dyb, dxt, cyb, m1.name); ob(dxb, dyb, cxb, dyt, m1.name); ob(cxt, dyb, dxt, dyt, m1.name); }
  const vert2 = m2.orient === "vertical";
  for (let i = 3; i <= numlayers; i += 2) { const n = metal[i - 1].name; if (vert2) { ob(cxb, cyt, cxt, dyt, n); ob(cxb, dyb, cxt, cyb, n); } else { ob(dxb, cyb, cxb, cyt, n); ob(cxt, cyb, dxt, cyt, n); } }
  for (let i = 2; i <= numlayers; i += 2) { const n = metal[i - 1].name; if (vert2) { ob(dxb, cyb, cxb, cyt, n); ob(cxt, cyb, dxt, cyt, n); } else { ob(cxb, cyt, cxt, dyt, n); ob(cxb, dyb, cxt, cyb, n); } }
  // components
  const pl1 = lines(text(files[".pl1"])).map((l) => l.trim().split(/\s+/));
  const pins = pl1.filter((t) => t[0].startsWith("twpin_"));
  const comps = [];
  const ostr = ["N", "FS", "FN", "S", "FE", "FW", "W", "E"];
  const vlayer = vert2 ? m2.name : numlayers < 3 ? m1.name : metal[2].name, hlayer = vert2 ? (numlayers < 3 ? m1.name : metal[2].name) : m2.name;
  const hskip = vert2 ? m2.skip : numlayers < 3 ? m1.skip : metal[2].skip, vskip = vert2 ? (numlayers < 3 ? m1.skip : metal[2].skip) : m2.skip;
  const pinLines = [], pads = [], fill = [];
  for (const t of pl1) {
    const inst = t[0]; let [llx, lly, urx, ury, orient, row] = t.slice(1).map(Number);
    if (inst.startsWith("twpin_")) {
      const lab = inst.slice(6), horiz = row === -1 || row === -2;
      const ppx = horiz ? pitchx : hskip * pitchx, ppy = horiz ? vskip * pitchy : pitchy;
      let cx = idiv(llx + urx, 2) - cellxbot - hpx, cy = idiv(lly + ury, 2) - cellybot - hpy;
      let gx = (1 + Math.floor(cx / ppx)) * ppx, gy = (1 + Math.floor(cy / ppy)) * ppy;
      // Pads are 0.39 um square and M2/M3 spacing is 0.28 um, so pads on neighbouring tracks block each other (qrouter: "no taps"):
      // keep a free track between pads on one edge, and keep every pad inside the die (graywolf's rounding can put it on or past the edge).
      const st = horiz ? ppy : ppx;   // pad grid: multiples of st (graywolf rounding above), so snap the limits onto it
      const lo = Math.ceil(((horiz ? dieybot : diexbot) + (horiz ? pitchy : pitchx)) / st) * st, hi = Math.floor(((horiz ? dieytop : diextop) - (horiz ? pitchy : pitchx)) / st) * st;
      const pos = horiz ? gy : gx, n = Math.floor((hi - lo) / st) + 1;
      // gap = 2 tracks apart (or the same edge position) on both axes; relaxed = just not on the same or an adjacent grid point
      const clash = (x, y, g) => pads.some(([ux, uy]) => Math.abs(x - ux) < g * pitchx && Math.abs(y - uy) < g * pitchy);
      const at = (v) => (horiz ? [gx, v] : [v, gy]);
      let v0 = Math.min(Math.max(Math.round((pos - lo) / st), 0), n - 1), found = null;
      for (const g of [2, 1]) { for (let i = 0; i < n && found === null; i++) { const v = lo + ((v0 + i) % n) * st; if (!clash(...at(v), g)) found = v; } if (found !== null) break; }
      if (found === null) throw new Error(`Too many ports (${pins.length}) for the die edge: no free pad position left for ${lab}.`);
      // across the edge too: a pad on or past the die edge (graywolf puts top/right pads there) is not reachable (qrouter: "Failure to find route start node")
      if (horiz) { gy = found; gx = Math.min(Math.max(gx, diexbot + pitchx), diextop - pitchx); } else { gx = found; gy = Math.min(Math.max(gy, dieybot + pitchy), dieytop - pitchy); }
      pads.push([gx, gy]);
      pinLines.push(`- ${lab} + NET ${lab}`, `  + LAYER ${horiz ? hlayer : vlayer} ( 0 0 ) ( 1 1 )`, `  + PLACED ( ${O(gx + shx)} ${O(gy + shy)} ) N ;`);
    } else if (inst.startsWith("twfeed")) { fill.push([inst, fillCell]); }
    else {
      const mm = inst.match(/([^\s:]+):(.+)$/); // cellname:instance
      let rest = inst, cell = mm ? mm[1] : inst, name = mm ? mm[2] : inst;
      comps.push(`- ${name} ${cell} + PLACED ( ${O(llx - cellxbot)} ${O(lly - cellybot)} ) ${ostr[orient]} ;`);
    }
  }
  def.push(`COMPONENTS ${comps.length} ;`, ...comps, `END COMPONENTS`, ``, `PINS ${pins.length} ;`, ...pinLines, `END PINS`, ``);
  // nets from .pin
  const nets = new Map();
  let last = "";
  for (const line of lines(text(files[".pin"]))) {
    const t = line.trim().split(/\s+/);
    const net = t[0]; let cellinst = t[2], pinname = t[3];
    if (!nets.has(net)) nets.set(net, []);
    cellinst = cellinst.replace(/^([^\s.]+\.[0-9X]+\.)+/, "");
    if (cellinst.includes("twfeed") || pinname.startsWith("twfeed")) continue;
    if (cellinst.startsWith("twpin_")) nets.get(net).push(`( PIN ${pinname} )`);
    else if (cellinst !== "PSEUDO_CELL") {
      const mm = cellinst.match(/(.+):(.+)$/); const sh = pinname.match(/.+bF\$pin\/(.*)$/); if (sh) pinname = sh[1];
      const key = `( ${mm[2]} ${pinname} )`;
      if (last !== key) nets.get(net).push(key);
      last = key;
    }
  }
  def.push(`NETS ${nets.size} ;`);
  for (const [n, c] of nets) def.push(`- ${n}`, ...c.map((x) => "  " + x), ";");
  def.push(`END NETS`, ``, `END DESIGN`);
  const body = def.join("\n").replace(/\nNETS (\d+)\n/, "\nNETS $1 ");
  return { def: body + "\n", obs: obs.join("\n") + "\n", info: { scale, numlayers, oscale, pitchx, pitchy } };
}

// qflow addspacers: fill the gaps in the rows (rail and well continuity) and write the pin pads. Also used by the clock tree stage on its DEF.
export async function fillDef({ top, def, obs, info, oscale, log, stripes }) {
  const [lef, tlef] = await Promise.all([pdk("lef"), pdk("tlef")]);
  const sp = await runTool(V.qf, "addspacers", [...(stripes !== true ? [] : ["-stripe", "2.5", "50.0", "PG"]), "-p", "VDD,VNW", "-g", "VSS,VPW", "-f", "gf180mcu_fd_sc_mcu7t5v0__fill", "-O",
    "-l", PDK.tlef, "-l", PDK.lef, "-o", `${top}_filled.def`, top],
    { [PDK.tlef]: tlef, [PDK.lef]: lef, [`${top}.def`]: def, [`${top}.obs`]: obs, [`${top}.info`]: info }, log, { quiet: true });
  if (!sp.files[`${top}_filled.def`]) throw new Error("addspacers failed:\n" + sp.out);
  // Pin pads: addspacers writes 0.28 x 0.28 um squares, below the 0.1444 um^2 minimum metal area (M2.3/M3.3). Make them 0.39 x 0.39 um.
  const half = Math.round(oscale * 0.195);
  return { def: text(sp.files[`${top}_filled.def`]).replace(/(\+ LAYER \S+ )\( -?\d+ -?\d+ \) \( \d+ \d+ \)/g, `$1( -${half} -${half} ) ( ${half} ${half} )`), obs: sp.files[`${top}.obsx`] || obs };
}

export async function handle({ files, options = {} }, { log, progress, raw }) {
  setRaw(raw);
  const nl = Object.keys(files).find((p) => /\.v$/.test(p));
  if (!nl) throw new Error("no gate-level netlist (.v) given");
  const top = options.top || nl.replace(/^.*\//, "").replace(/(_net)?\.v$/, "");
  const layers = options.layers || 5;
  // TimberWolfSC loops forever on fewer than 6 cells (also natively): pad with unconnected fill cells.
  let netText = text(files[nl]);
  const ncells = (netText.match(/^\s*gf180mcu_\w+\s+\S+\s*\(/gm) || []).length;
  if (ncells < 2) throw new Error(`Placement needs at least 2 cells (this netlist has ${ncells}); graywolf hangs on a single cell. Add logic, or use the local runner (LibreLane).`);
  const pad = options.headroom ? 0 : Math.max(0, 6 - ncells);
  if (pad) {
    const i = netText.lastIndexOf("endmodule");
    netText = netText.slice(0, i) + Array.from({ length: pad }, (_, k) => `  gf180mcu_fd_sc_mcu7t5v0__fill_1 _nk_pad${k}_ ();`).join("\n") + "\n" + netText.slice(i);
    log(`padded with ${pad} fill cells (graywolf needs at least 6 cells)\n`);
  }
  const [lef, tlef, par] = await Promise.all([pdk("lef"), pdk("tlef"), pdk("par")]);
  const L = (s) => log(s);
  const t0 = Date.now();
  if (options.headroom) {   // spare room for the clock tree: unconnected fill_1 cells make the die bigger; Clock Tree removes them again
    const size = Object.fromEntries([...text(lef).matchAll(/MACRO (\S+)[\s\S]*?SIZE ([\d.]+) BY ([\d.]+)/g)].map((m) => [m[1], m[2] * m[3]]));
    const area = [...netText.matchAll(/^\s*(gf180mcu_\w+)\s+\S+\s*\(/gm)].reduce((a, m) => a + (size[m[1]] || 0), 0);
    const n = Math.ceil((options.headroom[0] * area + options.headroom[1]) / size.gf180mcu_fd_sc_mcu7t5v0__fill_1);
    const i = netText.lastIndexOf("endmodule");
    netText = netText.slice(0, i) + Array.from({ length: n }, (_, k) => `  gf180mcu_fd_sc_mcu7t5v0__fill_1 _nk_room${k}_ ();`).join("\n") + "\n" + netText.slice(i);
    log(`added ${n} unconnected fill cells as room for the clock tree\n`);
  }

  let r = await runTool(V.qf, "qrouter", ["-i", `${top}.info`, "-c", "boot.cfg"], { "boot.cfg": `lef ${PDK.tlef}\n`, [PDK.tlef]: tlef }, L, { quiet: true });
  const info = text(r.files[`${top}.info`] || "");
  if (!info) throw new Error("qrouter -i produced no layer info");
  progress(0.1);

  r = await runTool(V.qf, "vlog2Cel", ["-l", PDK.tlef, "-l", PDK.lef, "-u", String(parseInfo(info).scale), "-o", `${top}.cel`, "net.v"],
    { [PDK.tlef]: tlef, [PDK.lef]: lef, "net.v": netText }, L, { quiet: true });
  if (!r.files[`${top}.cel`]) throw new Error("vlog2Cel failed:\n" + r.out);
  let g = { [`${top}.cel`]: r.files[`${top}.cel`], [`${top}.par`]: par };
  progress(0.2);

  for (const [n, a, async] of [["syntax", [top]], ["Mincut", [top]], ["TimberWolfMC", ["-n", top], true], ["TimberWolfSC", ["-n", top]]]) {
    const o = await runTool(V.gw, n, a, g, L, { async, hook: genrowsHook(L), quiet: !/SC/.test(n) });
    g = { ...g, ...o.files };
    if (o.status && !g[`${top}.pl1`]) throw new Error(`${n} failed (exit ${o.status}):\n${o.out}`);
    progress(n === "syntax" ? 0.3 : n === "Mincut" ? 0.4 : n === "TimberWolfMC" ? 0.5 : 0.8);
  }
  if (!g[`${top}.pl1`]) throw new Error("graywolf produced no placement");

  const p = place2def(top, { ".info": info, ".pl1": g[`${top}.pl1`], ".pl2": g[`${top}.pl2`], ".pin": g[`${top}.pin`] }, "gf180mcu_fd_sc_mcu7t5v0__fill_1", layers);
  const f = await fillDef({ top, def: p.def, obs: p.obs, info, oscale: p.info.oscale, log: L, stripes: options.stripes });
  const filled = f.def;
  progress(1);
  const out = { [`${top}.def`]: new TextEncoder().encode(filled), [`${top}.obs`]: f.obs, [`${top}.info`]: info,
    [`${top}.pl1`]: g[`${top}.pl1`], [`${top}.cel`]: g[`${top}.cel`] };
  const comps = (text(out[`${top}.def`]).match(/^COMPONENTS (\d+)/m) || [])[1];
  return { ok: true, files: out, summary: { top, components: +comps, ms: Date.now() - t0, die: (text(out[`${top}.def`]).match(/DIEAREA.*/) || [""])[0] } };
}

serve(handle);
