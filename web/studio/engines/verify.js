import { call } from "./_rpc.js";
import { injectDump, judgeTb } from "./verify-core.js";
export const meta = { id: "verify", label: "Verify", stage: "verify", where: "browser", license: "ISC (Yosys), GPL-2.0 (Icarus)", sourceUrl: "https://github.com/YoWASP/yosys" };
const url = new URL("./verify.worker.js", import.meta.url);
// options.vMode: "formal" (Yosys sat, k-induction) | "tb" (self-checking testbench in Icarus; options.tb names it)
export async function run({ files, options = {}, onLog, onProgress, signal }) {
  if (options.vMode !== "tb") return call(url, { files, options }, { onLog, onProgress, signal });
  const icarus = await import("./icarus.js");
  const r = await icarus.run({ files: injectDump(files, options.tb), options, onLog, onProgress, signal });
  const j = judgeTb(r), vcd = Object.keys(r.files || {}).find((p) => /\.vcd$/i.test(p));
  const results = j.pass ? [{ name: "testbench " + (options.tb || ""), kind: "tb", status: "proven", detail: "PASS" + (j.note ? ": " + j.note : ""), vcd }]
    : j.errors.map((e) => ({ name: e.text, kind: "tb", status: "failed", detail: e.time != null ? `at time ${e.time}` : "", vcd }));
  return { ok: j.pass, files: r.files || {}, summary: { mode: "tb", results, errors: j.errors.length, stdout: r.summary?.stdout || "", error: r.summary?.error, warnings: j.note ? 1 : 0 } };
}
