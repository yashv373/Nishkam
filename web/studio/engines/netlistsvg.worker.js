// netlistsvg (MIT) + elkjs (EPL-2.0) bundles, self-hosted. They are UMD scripts, so we eval them as globals.
import { serve, readText, text } from "./_rpc.js";

const DIR = new URL("../../vendor/netlistsvg/a275a9a/", import.meta.url);
let ready;
const load = () => (ready ||= (async () => {
  const g = globalThis;
  // With no `document`, ELK thinks it IS the layout worker and hijacks self.onmessage instead of
  // exporting its in-thread fake Worker. A placeholder while it loads makes it take the export path.
  // netlistsvg runs `new ELK()` at load time, and that is when ELK picks its mode, so keep it for both.
  const [elk, nl] = await Promise.all(["elk.bundled.js", "netlistsvg.bundle.js"].map((f) => readText(new URL(f, DIR))));
  g.document = {};
  try { (0, eval)(elk); (0, eval)(nl); } // ELK must come first
  finally { delete g.document; }
  return g.netlistsvg;
})());

// files: {"x.json": yosys json}; options.file picks one (default: first .json)
export async function handle({ files, options = {} }, { progress }) {
  const nl = await load();
  progress(0.3);
  const name = options.file || Object.keys(files).find((p) => p.endsWith(".json"));
  if (!name) throw new Error("no yosys .json given");
  const svg = await nl.render(nl.digitalSkin, JSON.parse(text(files[name])));
  return { ok: true, files: { "schematic.svg": svg }, summary: { bytes: svg.length } };
}
serve(handle);
