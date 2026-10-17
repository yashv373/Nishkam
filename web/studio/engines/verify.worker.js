// Formal checks with Yosys sat (k-induction). One run per assertion/cover so each gets its own answer and trace.
import { serve, text } from "./_rpc.js";
import { yosys, parseMessages } from "./yosys.worker.js";
import { prepScript, listTargets, modelFor, parseSat, satScript } from "./verify-core.js";

// options: top, vDepth (default 20), vInit ("undef"|"zero")
export async function handle({ files, options = {} }, cb) {
  const src = Object.keys(files).filter((p) => /\.(v|sv|vh|svh)$/.test(p));
  if (!src.length) throw new Error("no .v/.sv files given");
  const depth = Math.max(1, Math.min(200, +options.vDepth || 20)), init = options.vInit === "zero" ? "zero" : "undef";
  const top = options.top; if (!top) throw new Error("Set a top module in Properties.");
  const p = await yosys(prepScript(src, top), files, cb);
  const messages = parseMessages(p.log);
  if (!p.ok || !p.fs["model.json"]) return { ok: false, files: {}, summary: { error: messages.find((m) => m.severity === "error")?.text || "Yosys could not read the design", messages } };
  const { top: t, mod, targets, assumes } = listTargets(text(p.fs["model.json"]));
  if (!targets.length) return { ok: true, files: {}, summary: { skipped: "no assertions or covers found", mode: "formal", results: [], messages } };
  const results = [], outFiles = {};
  for (const [i, tg] of targets.entries()) {
    cb.progress((i + 0.5) / targets.length);
    const r = await yosys(satScript(depth, init, tg.kind === "cover"), { "t.json": modelFor(t, mod, tg) }, { ...cb, log: () => {}, raw: () => {} });
    const log = text(r.fs["yosys.log"] || ""), s = parseSat(log), x = { name: tg.label, kind: tg.kind, file: tg.file, line: tg.line };
    if (!/Trying induction/.test(log)) { x.status = "error"; x.detail = parseMessages(r.log)[0]?.text || "Yosys failed"; }
    else if (tg.kind === "assert") {
      x.status = s.status; x.cycle = s.cycle;
      x.detail = x.status === "proven" ? `holds for every input, proven by induction (depth ${s.cycle})` : x.status === "failed" ? `breaks at cycle ${s.cycle}` : `no failure in the first ${depth} cycles, but not proven for all time`;
    } else {
      x.status = s.status === "failed" ? "covered" : "notcovered"; x.cycle = s.cycle;
      x.detail = x.status === "covered" ? `reached at cycle ${s.cycle}` : `not reached in ${depth} cycles`;
    }
    const v = r.fs["cex.vcd"]; if (v && (x.status === "failed" || x.status === "covered")) { x.vcd = `verify_${i}.vcd`; outFiles[x.vcd] = text(v); }
    results.push(x);
  }
  const n = (st) => results.filter((x) => x.status === st).length;
  return { ok: !n("failed") && !n("error"), files: outFiles, summary: { mode: "formal", results, assumes, depth, init, warnings: n("unknown") + n("notcovered"), messages } };
}
serve(handle);
