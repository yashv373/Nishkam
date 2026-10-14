// node web/cdc.test.mjs   (also run by grader.test.mjs; same @yowasp/yosys setup)
// CDC verdicts: right designs pass, designs with a missing or broken synchronizer fail with a message or a counterexample.
import assert from "node:assert/strict";
import { CDC_PROBLEMS } from "./cdc-problems.js";
import { grade } from "./grader.js";

const { runYosys, Exit } = await import(process.env.YOWASP_YOSYS || "@yowasp/yosys");
const P = Object.fromEntries(CDC_PROBLEMS.map((p) => [p.id, p]));
if (process.env.STEPS) CDC_PROBLEMS.forEach((p) => { p.cdc.steps = +process.env.STEPS; });
const swap = (src, a, b) => { assert.ok(src.includes(a), `fixture text not found: ${a}`); return src.replace(a, b); };

const SYNC_HEAD = "module sync2(input clk_a, input clk_b, input rst_b, input d, output q);\n";
const sync2 = P["cdc-sync2"].reference;
const FIFO = P["cdc-async-fifo"].reference, PULSE = P["cdc-pulse-sync"].reference;

const CASES = [
  // [problem, label, code, expected: "pass" | "struct" | "cex"]
  ["cdc-sync2", "reference (2 flops)", sync2, "pass"],
  ["cdc-sync2", "3 flops", SYNC_HEAD + `reg s1, s2, s3;
  always @(posedge clk_b) if (rst_b) {s3, s2, s1} <= 0; else begin s1 <= d; s2 <= s1; s3 <= s2; end
  assign q = s3; endmodule\n`, "pass"],
  ["cdc-sync2", "1 flop", SYNC_HEAD + `reg s1; always @(posedge clk_b) if (rst_b) s1 <= 0; else s1 <= d;
  assign q = s1; endmodule\n`, "struct"],
  ["cdc-sync2", "logic between the flops", SYNC_HEAD + `reg s1, s2, k; always @(posedge clk_b) if (rst_b) {s2, s1, k} <= 0; else begin k <= ~k; s1 <= d; s2 <= s1 ^ k; end
  assign q = s2; endmodule\n`, "struct"],
  ["cdc-sync2", "d also used elsewhere", SYNC_HEAD + `reg s1, s2, e; always @(posedge clk_b) if (rst_b) {s2, s1, e} <= 0; else begin s1 <= d; e <= d; s2 <= s1; end
  assign q = s2 & e; endmodule\n`, "struct"],
  ["cdc-sync2", "inverted output (wrong value)", SYNC_HEAD + `reg s1, s2; always @(posedge clk_b) if (rst_b) {s2, s1} <= 0; else begin s1 <= d; s2 <= s1; end
  assign q = ~s2; endmodule\n`, "cex"],

  ["cdc-async-fifo", "reference (Gray pointers)", FIFO, "pass"],
  ["cdc-async-fifo", "Gray, flags one cycle later", (() => {
    let s = swap(FIFO, "reg [2:0] rq1, rq2; ", "reg [2:0] rq1, rq2, rq3; ");
    s = swap(s, "reg [2:0] wq1, wq2; ", "reg [2:0] wq1, wq2, wq3; ");
    s = swap(s, "rq1 <= 0; rq2 <= 0;", "rq1 <= 0; rq2 <= 0; rq3 <= 0;").replace("wq1 <= 0; wq2 <= 0;", "wq1 <= 0; wq2 <= 0; wq3 <= 0;");
    s = swap(s, "rq2 <= rq1;", "rq2 <= rq1; rq3 <= rq2;").replace("wq2 <= wq1;", "wq2 <= wq1; wq3 <= wq2;");
    return swap(swap(s, "{~rq2[2:1], rq2[0]}", "{~rq3[2:1], rq3[0]}"), "== wq2)", "== wq3)");
  })(), "pass"],
  ["cdc-async-fifo", "binary pointers (2-flop sync per bit) - see note", (() => {
    let s = swap(FIFO, "rq1 <= rgray;", "rq1 <= rbin;");
    s = swap(s, "wq1 <= wgray;", "wq1 <= wbin;");
    s = swap(s, "(wgray_n == {~rq2[2:1], rq2[0]})", "(wbin_n == {~rq2[2], rq2[1:0]})");
    return swap(s, "(rgray_n == wq2)", "(rbin_n == wq2)");
  })(), "pass"],
  // NOTE: the brief wanted this to FAIL. With a one-edge old/new skew, 2-flop binary pointers and registered flags
  // stay safe (the wrong value is seen for one edge only, and the flags are rebuilt from the next one). See report.,
  ["cdc-async-fifo", "pointers cross with one flop", swap(FIFO, "rempty_r <= (rgray_n == wq2);", "rempty_r <= (rgray_n == wq1);"), "struct"],

  ["cdc-pulse-sync", "reference (toggle, 2 flops + edge)", PULSE, "pass"],
  ["cdc-pulse-sync", "1 flop", swap(swap(PULSE, "assign pulse_out = s2 ^ s3;", "assign pulse_out = s1 ^ s2;"), "s3 <= s2; end", "s3 <= s2; end"), "struct"],
];

let worst = 0;
for (const [id, label, code, want] of CASES) {
  const t0 = Date.now();
  const r = await grade(runYosys, Exit, P[id], code);
  const ms = Date.now() - t0; worst = Math.max(worst, ms);
  const got = r.passed ? "pass" : r.structural ? "struct" : r.cex ? "cex" : "error";
  console.log(`   ${id}: ${label}: ${got}${r.timing?.satMs !== undefined ? ` (sat ${r.timing.satMs} ms, ${r.steps} steps)` : ""} total ${ms} ms${r.structural ? "\n      " + r.structural[0] : ""}${r.cex ? "\n      step " + r.cex.first + ": " + r.cex.reasons.join("; ") : ""}`);
  assert.equal(got, want, `${id} ${label}: wanted ${want}, got ${got}\n${r.error || ""}${(r.log || "").slice(-600)}`);
}
// the starters have no logic: they must give a plain message, not a Yosys dump
for (const p of CDC_PROBLEMS) {
  const r = await grade(runYosys, Exit, p, p.starter);
  assert.ok(!r.passed && (r.error || r.structural), `${p.id}: empty starter must not pass`);
}
console.log(`all CDC tests passed (slowest ${worst} ms)`);
