// node web/grader.test.mjs   (needs @yowasp/yosys: npm i @yowasp/yosys@0.68.1207,
// or set YOWASP_YOSYS to a file:// URL of its gen/bundle.js)
// Every RTL problem: reference passes, a different-but-correct answer passes,
// a buggy answer fails with a counterexample at the right place.
import assert from "node:assert/strict";
import { PROBLEMS } from "./problems.js";
import { grade } from "./grader.js";

const { runYosys, Exit } = await import(process.env.YOWASP_YOSYS || "@yowasp/yosys");

const ALT = {
  "counter-en": {
    good: `module counter(input wire clk, input wire rst, input wire en, output reg [3:0] q);
      always @(posedge clk) q <= rst ? 4'd0 : q + {3'd0, en}; endmodule`,
    bad: `module counter(input clk, input rst, input en, output reg [3:0] q);
      always @(posedge clk) if (rst) q <= 0; else if (en) q <= (q == 9) ? 0 : q + 1; endmodule`,
  },
  "rise-edge": {
    good2: `module edge_detect(input clk, input rst, input d, output pulse);
      reg p; always @(posedge clk) if (rst) p <= 0; else p <= d;
      assign pulse = ({p, d} == 2'b01); endmodule`,
    good: `module edge_detect(input clk, input rst, input d, output reg pulse);
      reg p; always @(posedge clk) p <= rst ? 1'b0 : d; always @* pulse = d && !p; endmodule`,
    bad: `module edge_detect(input clk, input rst, input d, output pulse);
      reg p; always @(posedge clk) if (rst) p <= 0; else p <= d; assign pulse = d ^ p; endmodule`,
  },
  "seq-1011": {
    good: `module seq_det(input clk, input rst, input din, output hit);
      localparam S0=0,S1=1,S10=2,S101=3,S1011=4; reg [2:0] s;
      always @(posedge clk) if (rst) s <= S0; else case (s)
        S0: s <= din ? S1 : S0;       S1: s <= din ? S1 : S10;
        S10: s <= din ? S101 : S0;    S101: s <= din ? S1011 : S10;
        default: s <= din ? S1 : S10; endcase
      assign hit = (s == S1011); endmodule`,
    bad: `module seq_det(input clk, input rst, input din, output hit);
      localparam S0=0,S1=1,S10=2,S101=3,S1011=4; reg [2:0] s;
      always @(posedge clk) if (rst) s <= S0; else case (s)
        S0: s <= din ? S1 : S0;       S1: s <= din ? S1 : S10;
        S10: s <= din ? S101 : S0;    S101: s <= din ? S1011 : S10;
        default: s <= din ? S1 : S0; endcase   // bug: no overlap after a match
      assign hit = (s == S1011); endmodule`,
  },
  "gray-counter": {
    good: `module gray_cnt(input clk, input rst, input en, output reg [3:0] g);
      wire [3:0] b = {g[3], g[3]^g[2], g[3]^g[2]^g[1], g[3]^g[2]^g[1]^g[0]};
      wire [3:0] n = b + 1;
      always @(posedge clk) if (rst) g <= 0; else if (en) g <= n ^ (n >> 1); endmodule`,
    bad: `module gray_cnt(input clk, input rst, input en, output [3:0] g);
      reg [3:0] b; always @(posedge clk) if (rst) b <= 0; else if (en) b <= b + 1;
      assign g = b ^ (b << 1); endmodule`,
  },
  "rr-arbiter": {
    good: `module rr_arb(input clk, input rst, input [3:0] req, output reg [3:0] gnt);
      reg [1:0] last; wire [1:0] start = last + 2'd1; wire [7:0] dbl = {req, req} >> start;
      reg [1:0] off; wire [1:0] win = start + off;
      always @* begin
        if (dbl[0]) off = 0; else if (dbl[1]) off = 1; else if (dbl[2]) off = 2; else off = 3;
        gnt = (req == 0) ? 4'b0 : 4'b1 << win;
      end
      always @(posedge clk) if (rst) last <= 3; else if (req != 0) last <= win;
      endmodule`,
    bad: `module rr_arb(input clk, input rst, input [3:0] req, output reg [3:0] gnt);
      always @* begin gnt = 0;  // bug: fixed priority
        if (req[0]) gnt = 1; else if (req[1]) gnt = 2; else if (req[2]) gnt = 4; else if (req[3]) gnt = 8; end
      endmodule`,
  },
};

for (const p of PROBLEMS.filter((p) => p.kind === "rtl")) {
  const a = ALT[p.id];
  assert.ok(a, `no test answers for ${p.id}`);
  const ref = await grade(runYosys, Exit, p, p.reference);
  assert.ok(ref.passed, `${p.id}: reference must pass itself\n${ref.log}`);
  const good = await grade(runYosys, Exit, p, a.good);
  assert.ok(good.passed, `${p.id}: alternative correct answer rejected\n${good.log}`);
  if (a.good2) {
    const g2 = await grade(runYosys, Exit, p, a.good2);
    assert.ok(g2.passed, `${p.id}: second correct answer rejected
${g2.log}`);
  }
  assert.ok(good.stat?.cells > 0, `${p.id}: no synthesis stats`);
  const bad = await grade(runYosys, Exit, p, a.bad);
  assert.ok(!bad.passed, `${p.id}: buggy answer accepted`);
  assert.ok(bad.cex && bad.cex.first >= 0, `${p.id}: no counterexample\n${bad.log}`);
  const starter = await grade(runYosys, Exit, p, p.starter);
  assert.ok(!starter.passed, `${p.id}: empty starter passed`);
  assert.match(starter.error || "", /no logic yet/, `${p.id}: starter gives a raw Yosys message: ${starter.error}`);
  console.log(`ok ${p.id}  (cells=${good.stat.cells}, bug caught at cycle ${bad.cex.first})`);
}
const broken = await grade(runYosys, Exit, PROBLEMS[0], "module counter(input clk; endmodule");
assert.ok(!broken.passed && broken.error, "syntax error must be reported");
console.log("ok syntax error ->", broken.error);
console.log("all grader tests passed");
