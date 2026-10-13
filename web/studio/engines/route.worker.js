// Detailed routing with qrouter (non-Tcl build, WebAssembly, GPL-2.0, own worker). Replaces qflow's qrouter.sh.
// Input: <top>.def + <top>.obs from the placement engine. Output: <top>_route.def and failed-net count.
import { serve, text } from "./_rpc.js";
import { V, PDK, pdk, runTool, setRaw } from "./place.worker.js";

export async function handle({ files, options = {} }, { log, progress, raw = () => {} }) {
  setRaw(raw);
  const defName = Object.keys(files).find((p) => /\.def$/.test(p));
  if (!defName) throw new Error("no .def given (run placement first)");
  const top = options.top || defName.replace(/^.*\//, "").replace(/\.def$/, "");
  const layers = options.layers || 5;
  const [lef, tlef] = await Promise.all([pdk("lef"), pdk("tlef")]);
  const obs = files[`${top}.obs`] ? text(files[`${top}.obs`]) : "";
  const cfg = `lef ${PDK.tlef}\nlef ${PDK.lef}\nnum_layers ${layers}\nstack ${layers}\n${obs}${options.cfgExtra || ""}`;
  const t0 = Date.now();
  const r = await runTool(V.qf, "qrouter", ["-c", `${top}.cfg`, "-p", "VDD,VNW", "-g", "VSS,VPW", "-d", `${top}_route.rc`, "-nog", top],
    { [PDK.tlef]: tlef, [PDK.lef]: lef, [`${top}.def`]: text(files[defName]).replace(/^VIAS 0 ;\s*END VIAS\s*$/m, ""), [`${top}.cfg`]: cfg }, (s) => log(s.split("\n").filter((l) => /Final|Failed|fail|remaining.*00$|tap|obstruct/i.test(l)).join("\n") + "\n"), {});
  progress(1);
  const routed = r.files[`${top}_route.def`];
  const failed = /No failed routes/.test(r.out) ? 0 : +((r.out.match(/Final: Failed net routes: (\d+)/) || [])[1] ?? -1);
  const names = failed > 0 ? (r.out.split("List of failed nets follows:")[1] || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("-")) : [];
  return { ok: !!routed && failed === 0, files: routed ? { [`${top}_route.def`]: routed } : {},
    summary: { top, failedNets: failed, failedNames: names, ms: Date.now() - t0, error: routed ? undefined : "qrouter wrote no DEF" } };
}

serve(handle);
