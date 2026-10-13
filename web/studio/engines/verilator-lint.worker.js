import { serve } from "./_rpc.js";
// The wasm is found relative to this module, so jsdelivr serves both with CORS.
const VERILATOR_URL = "https://cdn.jsdelivr.net/npm/verilator-wasm@1.0.0/dist/index.mjs";
let v;

export function parseMessages(stderr) {
  const out = [];
  for (const l of stderr.split("\n")) {
    const m = l.match(/^%(Error|Warning)(?:-(\w+))?: (?:(.+?):(\d+):(\d+): )?(.*)$/);
    if (m && !/^Exiting due to/.test(m[6])) out.push({ severity: m[1].toLowerCase(), code: m[2] || "", file: m[3] || "", line: m[4] ? +m[4] : 0, col: m[5] ? +m[5] : 0, text: m[6] });
  }
  return out;
}

export async function handle({ files, options = {} }, { log, progress }) {
  v ||= await Promise.resolve(globalThis.__verilatorModule || import(VERILATOR_URL)).then((m) => m.createVerilator());
  progress(0.5);
  const srcs = Object.keys(files).filter((p) => /\.s?vh?$/.test(p));
  const args = ["--lint-only", "-Wall", ...(options.top ? ["--top-module", options.top] : []), ...srcs];
  const r = await v.run({ args, files: { ...files, "/dev/null": "" } }); // --lint-only needs /dev/null in the in-memory fs
  log(r.stderr);
  const messages = parseMessages(r.stderr);
  const errors = messages.filter((m) => m.severity === "error").length;
  return { ok: errors === 0, files: {}, summary: { errors, warnings: messages.length - errors, messages } };
}
serve(handle);
