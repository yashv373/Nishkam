// Detailed routing with qrouter (non-Tcl build, WebAssembly, GPL-2.0, own worker). Replaces qflow's qrouter.sh.
// Input: <top>.def + <top>.obs from the placement engine. Output: <top>_route.def and failed-net count.
import { serve, text } from "./_rpc.js";
import { V, PDK, pdk, runTool, setRaw } from "./place.worker.js";

export const retriedNets = (out) => [...new Set([...out.matchAll(/Failure to find route (?:start|end) node\/route on net (\S+?)!/g)].map((m) => m[1]))];
export async function handle({ files, options = {} }, { log, progress, raw = () => {} }) {
  setRaw(raw);
  const defName = Object.keys(files).find((p) => /\.def$/.test(p));
  if (!defName) throw new Error("no .def given (run placement first)");
  const top = options.top || defName.replace(/^.*\//, "").replace(/\.def$/, "");
  const layers = options.layers || 5;
  const [lef, tlef] = await Promise.all([pdk("lef"), pdk("tlef")]);
  const obs = files[`${top}.obs`] ? text(files[`${top}.obs`]) : "";
  const cfg = `lef ${PDK.tlef}\nlef ${PDK.lef}\nnum_layers ${layers}\nstack ${layers}\n${obs}${options.cfgExtra || ""}`;
  // qrouter ignores a net that has no cell pin (an unused input has only its pad), so another net's wire can cross that pad and short it in the layout
  // (config "obstruction" lines are ignored for these pads). Give each such pad a FIXED wire stub in the DEF qrouter reads: fixed wires are obstacles.
  let def = text(files[defName]);
  const used = new Set((def.match(/^NETS[\s\S]*?^END NETS/m) || [""])[0].split(/^- /m).slice(1).filter((b) => (b.match(/\(/g) || []).length > 1).map((b) => b.split(/\s/)[0]));
  const stubs = [...((def.match(/^PINS[\s\S]*?^END PINS/m) || [""])[0]).matchAll(/^- (\S+) \+ NET[\s\S]*?\+ LAYER (\S+)[\s\S]*?\+ PLACED \( (-?\d+) (-?\d+) \)/gm)]
    .filter((m) => !used.has(m[1])).map((m) => ["- " + m[1], "  ( PIN " + m[1] + " )", "  + FIXED " + m[2] + " ( " + m[3] + " " + m[4] + " ) ( * " + m[4] + " )", ";"].join("\n"));
  if (stubs.length) def = def.replace(/^NETS (\d+) ;/m, (_, n) => "NETS " + (+n + stubs.length) + " ;").replace(/^END NETS/m, stubs.join("\n") + "\nEND NETS");
  const t0 = Date.now();
  const r = await runTool(V.qf, "qrouter", ["-c", `${top}.cfg`, "-p", "VDD,VNW", "-g", "VSS,VPW", "-d", `${top}_route.rc`, "-nog", top],
    { [PDK.tlef]: tlef, [PDK.lef]: lef, [`${top}.def`]: def.replace(/^VIAS 0 ;\s*END VIAS\s*$/m, ""), [`${top}.cfg`]: cfg }, (s) => log(s.split("\n").filter((l) => /Final|Failed|fail|remaining.*00$|tap|obstruct/i.test(l)).join("\n") + "\n"), {});
  progress(1);
  const routed = r.files[`${top}_route.def`];
  const failed = /No failed routes/.test(r.out) ? 0 : +((r.out.match(/Final: Failed net routes: (\d+)/) || [])[1] ?? -1);
  const names = failed > 0 ? (r.out.split("List of failed nets follows:")[1] || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("-")) : [];
  // qrouter logs "Failure to find route start|end node/route on net X" for a segment it later redoes; its final verdict is the count above.
  // Measured: with those messages present or absent (pad layer changed) the Netgen result is identical, so they do not fail the stage; list them.
  const retried = retriedNets(r.out);
  return { ok: !!routed && failed === 0, files: routed ? { [`${top}_route.def`]: routed } : {},
    summary: { top, failedNets: failed, failedNames: names, retriedNets: retried, ms: Date.now() - t0, error: routed ? undefined : "qrouter wrote no DEF" } };
}

serve(handle);
