// Magic (upstream headless Emscripten build, no Tcl) with the gf180mcuD tech file: routed DEF -> GDS, DRC, optional SPICE extraction.
// GPL-2.0-style licence (see web/vendor/magic/bed8d4f/LICENSE); own worker, talks only through messages.
import { serve, text } from "./_rpc.js";
import { V, PDK, pdk, readBin } from "./place.worker.js";
import { toSpef } from "./spef.js";

const MAGIC = new URL("../../vendor/magic/bed8d4f/magic.js", import.meta.url);

// options: {top, drc: true, extract: false, rc: false}. rc:true also returns <top>.spef (Magic flatten + extract + extresist, see spef.js). files: "<top>.def" (routed). Returns <top>.gds, DRC counts/rules, optional <top>.spice.
export async function handle({ files, options = {} }, { log, progress, raw }) {
  const defName = Object.keys(files).find((p) => /\.def$/.test(p));
  if (!defName) throw new Error("no routed .def given");
  const top = options.top || defName.replace(/^.*\//, "").replace(/(_route)?\.def$/, "");
  const [tech, tlef, lef, gds] = await Promise.all(["tech", "tlef", "lef", "gds"].map(pdk));
  const out = [];
  const say = (s) => { out.push(s); raw?.("magic", s + "\n", "stdout"); }; // raw: verbatim channel (guarded; _rpc may not provide it yet)
  const mod = await (await import(MAGIC.href)).default({ print: say, printErr: (s) => { out.push(s); raw?.("magic", s + "\n", "stderr"); } });
  const run = mod.cwrap("magic_wasm_run_command", "number", ["string"]);
  mod.FS.mkdirTree("/w");
  const W = (n, d) => mod.FS.writeFile("/w/" + n, d);
  W(PDK.tech, tech); W(PDK.tlef, tlef); W(PDK.lef, lef); W(PDK.gds, gds); W(`${top}.def`, files[defName]);
  const t0 = Date.now();
  const cmd = (c) => { const rc = run(c); if (rc) log(`magic: "${c}" returned ${rc}\n`); return rc; };
  for (const c of ["tech load /w/" + PDK.tech, "scalegrid 1 10", "snap lambda", "drc off", "gds readonly true", "gds read /w/" + PDK.gds,
    "lef read /w/" + PDK.tlef, "lef read /w/" + PDK.lef, `def read /w/${top}.def`]) cmd(c);
  progress(0.4);
  cmd(`gds write /w/${top}.gds`);
  const res = { [`${top}.gds`]: mod.FS.readFile(`/w/${top}.gds`) };
  const summary = { top, gdsBytes: res[`${top}.gds`].length };
  if (options.drc !== false) {
    const mark = out.length;
    for (const c of ["select top cell", "drc euclidean on", "drc style drc(full)", "drc on", "drc check", "drc catchup", "drc count total", "echo end-of-drc", "drc listall why"]) cmd(c);
    const o = out.slice(mark);
    if (options.debug) log("RAW:" + JSON.stringify(o).slice(0, 900) + "\n");
    const n = o.join("\n").match(/Total DRC errors found: (\d+)/);
    summary.drcErrors = n ? +n[1] : -1;
    summary.drcRules = [...new Set(o.slice(o.indexOf("end-of-drc") + 1).filter((l) => l))];
    // Library cells with errors of their own (Magic flags dffrnq_1 etc. even on the PDK GDS alone): count them per placed instance.
    const mark2 = out.length;
    cmd("drc listall count");
    const own = {};
    for (const l of out.slice(mark2)) { const m = l.match(/^Cell (\S+) has (\d+) error tiles/); if (m && m[1] !== top) own[m[1]] = +m[2]; }
    const defText = new TextDecoder().decode(files[defName]);
    let intrinsic = 0;
    for (const [c, k] of Object.entries(own)) intrinsic += k * (defText.match(new RegExp(`^- \\S+ ${c} `, "gm")) || []).length;
    summary.drcInCells = intrinsic; // inherent to the library cells
    summary.drcFromLayout = summary.drcErrors - intrinsic; // power stripes, fill and signal routing
    log(`DRC: ${summary.drcErrors} error tiles (${summary.drcInCells} inside library cells, ${summary.drcFromLayout} from the layout)\n` + summary.drcRules.join("\n") + "\n");
  }
  if (options.extract) {
    for (const c of ["extract do local", "extract no capacitance", "extract no coupling", "extract no resistance", "extract no adjust", "extract all", "ext2spice lvs", `ext2spice -o /${top}.spice ${top}`]) cmd(c);
    res[`${top}.spice`] = mod.FS.readFile(`/${top}.spice`);
    if (options.keepExt) for (const d of ["/w/", "/"]) if (mod.FS.analyzePath(`${d}${top}.ext`).exists) res[`${top}.ext`] = mod.FS.readFile(`${d}${top}.ext`);   // validation only
  }
  if (options.rc) {
    // Flatten so every net is driven by devices (extresist skips nets that only touch sub-cell pins), then Magic's own R/C extraction.
    const mark = out.length;
    for (const c of ["extract do local", "extract do capacitance", "extract do coupling", "extract no resistance", "extract do adjust",
      `flatten ${top}f`, `load ${top}f`, "select top cell", "extract all", "extresist threshold 0", "extresist mindelay 0"]) cmd(c);
    // power nets fail in this build's extresist and are not in SPEF: ignore them (one name per call, the command takes one)
    const rdx = (n) => new TextDecoder().decode(mod.FS.readFile(mod.FS.analyzePath(`/w/${n}`).exists ? `/w/${n}` : `/${n}`));
    for (const m of rdx(`${top}f.ext`).matchAll(/^node "([^"]*\.)?(VDD|VSS|VNW|VPW)"/gm)) cmd(`extresist ignore ${m[0].slice(6, -1)}`);
    cmd("extresist all");
    if (options.debug) log("RC:" + JSON.stringify(out.slice(mark)).slice(0, options.debug === 2 ? 99999 : 900) + "\n");
    const rd = (n) => new TextDecoder().decode(mod.FS.readFile(mod.FS.analyzePath(`/w/${n}`).exists ? `/w/${n}` : `/${n}`));
    if (options.debug) log(`RES: ${rd(`${top}f.res.ext`).length} chars\n`);
    const r = toSpef({ top, def: new TextDecoder().decode(files[defName]), ext: rd(`${top}f.ext`), res: rd(`${top}f.res.ext`), lef: new TextDecoder().decode(lef), date: new Date().toISOString() });
    res[`${top}.spef`] = new TextEncoder().encode(r.spef);
    if (options.keepRc) { // reference output of Magic's own ext2spice (validation only): lumped and with the extresist network
      for (const [tag, on] of [["lump", "off"], ["rc", "on"]]) for (const c of ["ext2spice cthresh 0", "ext2spice rthresh 0", `ext2spice extresist ${on}`, `ext2spice -o /${top}f_${tag}.spice ${top}f`]) cmd(c);
      for (const n of [`${top}f.ext`, `${top}f.res.ext`, `${top}f_lump.spice`, `${top}f_rc.spice`]) res[n] = new TextEncoder().encode(rd(n));
    }
    summary.rcNets = Object.keys(r.nets).length;
  }
  progress(1);
  summary.ms = Date.now() - t0;
  return { ok: true, files: res, summary };
}

serve(handle);
