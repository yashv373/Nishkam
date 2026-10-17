// node web/studio/engines/verify.selftest.mjs  (needs `npm i @yowasp/yosys@0.68.1207` reachable from cwd, like selftest.node.mjs)
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const req = createRequire(process.cwd() + "/");
globalThis.__yosysModule = await import(pathToFileURL(req.resolve("@yowasp/yosys")).href);
const V = await import("./verify.worker.js"), I = await import("./icarus.worker.js"), C = await import("./verify-core.js");
const { EXAMPLES } = await import("../files.js");
const noop = { log() {}, progress() {}, raw() {} };
let fail = 0;
const t = async (name, check, f) => { try { const r = await f(); const ok = check(r); if (!ok) console.log(JSON.stringify(r.summary ?? r).slice(0, 600)); console.log(ok ? "PASS" : "FAIL", name); fail += !ok; return r; } catch (e) { console.log("FAIL", name, e.message); fail++; } };
const fv = (id) => EXAMPLES.find((e) => e.id === id).files;
const find = (r, n) => r.summary.results.find((x) => x.name === n);

const good = await t("formal: proven (3 FIFO properties) + cover hit", (r) => r.ok && ["a_count_max", "a_not_both", "a_pointers"].every((n) => find(r, n)?.status === "proven") && find(r, "c_full")?.status === "covered" && find(r, "c_full").cycle >= 6 && !!r.files[find(r, "c_full").vcd], () => V.handle({ files: { "fifo4.sv": fv("fifo-verify")["fifo4.sv"] }, options: { top: "fifo4", vDepth: 20 } }, noop));
await t("formal: failing assertion gives a cycle and a VCD", (r) => !r.ok && find(r, "a_count_max")?.status === "failed" && find(r, "a_count_max").cycle >= 6 && /\$enddefinitions/.test(r.files[find(r, "a_count_max").vcd] || ""), () => V.handle({ files: { "fifo4.sv": fv("fifo-bug")["fifo4.sv"] }, options: { top: "fifo4" } }, noop));
await t("formal: depth too small -> unknown (not proven)", (r) => r.ok && r.summary.results.some((x) => x.kind === "assert" && x.status === "unknown") && r.summary.warnings > 0,
  () => V.handle({ files: { "c.sv": "module c(input clk, rst, output reg [4:0] q); always @(posedge clk) if (rst) q <= 0; else if (q != 5'd20) q <= q + 1;\nreg init = 1; always @(posedge clk) init <= 0;\nalways @(*) if (!init) a_lim: assert (q != 5'd25); endmodule" }, options: { top: "c", vDepth: 2, vInit: "zero" } }, noop));
await t("formal: no assertions -> skipped", (r) => r.ok && !!r.summary.skipped, () => V.handle({ files: { "m.v": "module m(input a, output y); assign y = a; endmodule" }, options: { top: "m" } }, noop));
await t("formal: syntax error is reported", (r) => !r.ok && !!r.summary.error, () => V.handle({ files: { "b.sv": "module b(; endmodule" }, options: { top: "b" } }, noop));

// testbench mode: the page runs Icarus, then judgeTb decides (same code the engine uses)
const tb = async (id) => { const f = C.injectDump(fv(id), "tb_fifo.v"), r = await I.handle({ files: f }, noop); return { ...r, j: C.judgeTb(r) }; };
await t("testbench: PASS", (r) => r.j.pass && !r.j.errors.length && Object.keys(r.files).some((p) => /\.vcd$/.test(p)), () => tb("fifo-verify"));
await t("testbench: FAIL counts $error lines", (r) => !r.j.pass && r.j.errors.length === 3, () => tb("fifo-bug"));
await t("testbench: VCD injected when the testbench has no $dumpfile", (r) => r.j.pass && Object.keys(r.files).some((p) => /\.vcd$/.test(p)),
  async () => { const files = { "d.v": "module d(output y); assign y = 1; endmodule", "tb_d.v": "module tb_d; wire y; d u(.y(y)); initial begin #5; if (y !== 1) $fatal(1, \"bad\"); $display(\"PASS\"); $finish; end endmodule" };
    const r = await I.handle({ files: C.injectDump(files, "tb_d.v") }, noop); return { ...r, j: C.judgeTb(r) }; });
process.exit(fail ? 1 : 0);
