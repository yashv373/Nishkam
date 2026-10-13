// Headless check: node web/studio/engines/selftest.node.mjs  (needs `npm i @yowasp/yosys@0.68.1207 verilator-wasm` in cwd)
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { files, rtl, checks } from "./selftest-fixtures.js";

const noop = { log() {}, progress() {} };
const req = createRequire(process.cwd() + "/");
const yw = await import(pathToFileURL(req.resolve("@yowasp/yosys")).href);
globalThis.__yosysModule = yw;
globalThis.__verilatorModule = await import(pathToFileURL(req.resolve("verilator-wasm")).href);
const Y = await import("./yosys.worker.js"), V = await import("./verilator-lint.worker.js");
const I = await import("./icarus.worker.js"), N = await import("./netlistsvg.worker.js");

let fail = 0;
const t = async (name, check, f) => {
  try { const r = await f(); const ok = check(r); if (!ok) console.log(JSON.stringify(r.summary).slice(0, 400)); console.log(ok ? "PASS" : "FAIL", name); fail += !ok; return r; }
  catch (e) { console.log("FAIL", name, e.message); fail++; }
};
await t("yosys lint", checks.lint, () => Y.handle({ mode: "lint", files: rtl }, noop));
await t("verilator lint", checks.verilator, () => V.handle({ files: rtl }, noop));
await t("icarus sim", checks.sim, () => I.handle({ files }, noop));
const s = await t("yosys synth", checks.synth, () => Y.handle({ mode: "synth", files: rtl, options: { top: "counter" } }, noop));
if (s) await t("netlistsvg", checks.schematic, () => N.handle({ files: { "rtl.json": s.files["rtl.json"] } }, noop));
await t("yosys lint catches error", (r) => !r.ok && r.summary.errors > 0, () => Y.handle({ mode: "lint", files: { "bad.v": "module m(; endmodule" } }, noop));
if (s) console.log(JSON.stringify(s.summary).slice(0, 300));
process.exit(fail ? 1 : 0);
