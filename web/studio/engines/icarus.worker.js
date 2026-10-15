// Icarus Verilog (ivlpp -> ivl -> vvp as WebAssembly) from github.com/senolgulgonul/verisim, GPL-2.0.
// Runs in its own Worker and is only talked to by messages (mere aggregation, see web/vendor/THIRD_PARTY.md).
import { serve, text } from "./_rpc.js";
import initIvlpp from "../../vendor/icarus/a275a9a/ivlpp.js";
import initIvl from "../../vendor/icarus/a275a9a/ivl.js";
import initVvp from "../../vendor/icarus/a275a9a/vvp.js";

const NOISE = /system\.vpi|dynamic linking not enabled/;
const conf = (gen) => `basedir:/
module:system.vpi
generation:${gen}
generation:no-specify
out:/out.vvp
iwidth:32
widthcap:65536
functor:cprop
functor:nodangle
flag:DLL=vvp.tgt
`;

// options.generation: "2005" | "2009" | "2012" (default 2012); files: every .v/.sv incl. the testbench
export async function handle({ files, options = {} }, { log, progress, raw = () => {} }) {
  const names = Object.keys(files).filter((p) => /\.s?vh?$/.test(p));
  if (!names.length) throw new Error("no .v/.sv files given");
  const real = (t) => t.replace(/\/f(\d+)\.v/g, (m, i) => names[i] ?? m); // /f1.v -> the user's file name
  const clean = (e) => real(e.filter((l) => !NOISE.test(l)).join("\n"));

  const pp = [];
  const m1 = await initIvlpp({ print: (s) => pp.push(s), printErr: (s) => raw("icarus/ivlpp", s + "\n", "err") });
  const args = ["-L"]; // -L keeps `line directives so ivl errors name the right file
  names.forEach((n, i) => {
    const s = text(files[n]);
    m1.FS.writeFile(`/f${i}.v`, s.endsWith("\n") ? s : s + "\n"); // flat names: ivlpp has no mkdir needs
    args.push(`/f${i}.v`);
  });
  m1.callMain(args);
  progress(0.3);

  // sim-time cap, appended last so it inherits the testbench's `timescale; stops testbenches that never call $finish
  const limit = options.maxSimTime ?? 1e6;
  pp.push(`module __nishkam_limit; initial begin #${limit}; $display("__NISHKAM_SIMLIMIT__"); $finish; end endmodule`);
  const err = [];
  const m2 = await initIvl({ print: (s) => raw("icarus/ivl", s + "\n", "out"), printErr: (s) => { err.push(s); raw("icarus/ivl", s + "\n", "err"); } });
  m2.FS.writeFile("/ivl.conf", conf(options.generation || "2012"));
  m2.FS.writeFile("/src.v", pp.join("\n") + "\n");
  m2.callMain(["-C/ivl.conf", "--", "/src.v"]);
  let vvp = null;
  try { vvp = m2.FS.readFile("/out.vvp"); } catch { /* compile failed */ }
  const diag = clean(err);
  if (diag.trim()) log(diag + "\n");
  if (!vvp) return { ok: false, files: {}, summary: { stage: "compile", error: diag || "compile failed" } };
  progress(0.6);

  const out = [];
  let hitLimit = false;
  const emit = (s) => { s = real(s); if (s.includes("__NISHKAM_SIMLIMIT__")) hitLimit = true; else { out.push(s); log(s + "\n"); } };
  const m3 = await initVvp({ print: (s) => { raw("icarus/vvp", s + "\n", "out"); emit(s); }, printErr: (s) => { raw("icarus/vvp", s + "\n", "err"); emit(s); } });
  m3.FS.writeFile("/sim.vvp", vvp);
  m3.callMain(["-n", "/sim.vvp"]); // -n: $stop acts like $finish (no interactive prompt)
  const outFiles = {};
  for (const f of m3.FS.readdir("/")) // whatever $dumpfile named it
    if (/\.vcd$/i.test(f)) outFiles[f] = m3.FS.readFile("/" + f, { encoding: "utf8" });
  const hasFinish = names.some((n) => /\$finish/.test(text(files[n]).replace(/\/\*[^]*?\*\/|\/\/.*/g, "")));
  if (hitLimit) return { ok: false, files: outFiles, summary: { stage: "sim", error: hasFinish ? `simulation stopped at the ${limit} time-unit limit of simulated time before the testbench called $finish` : `simulation did not finish within ${limit} time units: the testbench never calls $finish, add one`, stdout: out.join("\n"), vcd: Object.keys(outFiles)[0] || null } };
  return { ok: true, files: outFiles, summary: { stdout: out.join("\n"), vcd: Object.keys(outFiles)[0] || null, warnings: diag } };
}

serve(handle);
