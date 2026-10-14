// Clock-domain-crossing problems. Graded by cdc.js (structure check + worst-case bit timing), not by matching a reference.
// `harness` is the Verilog checker around the student's module; {{TOP}} is the module name and {{N}} the number
// of crossing bits (one free "old or new" choice each, added by cdc.js). `fail` going high is a failed check.

const SYNC2 = {
  id: "cdc-sync2",
  title: "Two-flop synchronizer",
  difficulty: "Easy",
  tags: ["RTL", "CDC", "two clocks"],
  kind: "rtl",
  top: "sync2",
  statement: `
<p><code>d</code> is a level that changes in the <code>clk_a</code> domain (it comes straight from a <code>clk_a</code> flop). Bring it into the <code>clk_b</code> domain as <code>q</code>.</p>
<ul>
  <li>Ports are fixed: <code>clk_a</code>, <code>clk_b</code>, <code>rst_b</code> (synchronous, active-high, to <code>clk_b</code>), <code>d</code>, <code>q</code>. <code>q</code> is 0 after reset.</li>
  <li>Rule 1: <code>d</code> must feed exactly one <code>clk_b</code> flop, straight into its D pin, with no logic.</li>
  <li>Rule 2: that flop's output may feed only other <code>clk_b</code> flops, with no logic between them. So the chain is at least two flops before any logic or output. Three flops is fine.</li>
  <li>Rule 3: <code>q</code> may only show values that <code>d</code> had. Once <code>d</code> has been steady for 5 <code>clk_b</code> edges, <code>q</code> must equal it.</li>
</ul>
<p><b>What this grader can and cannot see.</b> Simulators and Studio treat flops as ideal and cannot show metastability, so this grader checks the structure and the worst-case bit timing instead. A failure of rule 1 or 2 is shown as a message naming the net. A failure of rule 3 is shown as a table of steps.</p>`,
  starter: `module sync2 (
  input  wire clk_a,
  input  wire clk_b,
  input  wire rst_b,
  input  wire d,
  output wire q
);
  // your code here
endmodule
`,
  hints: [
    "A signal from another clock can arrive just as the receiving flop samples it. The first flop may go unstable for a moment, so its output is not safe to use yet.",
    "Give it a whole clock cycle to settle: put a second flop right behind the first one, both on clk_b, with nothing between them. Only the second flop's output is safe to use.",
    "Two flops in a row clocked by clk_b, d into the first, q from the second. Reset both to 0 with rst_b. Do not use d anywhere else in the clk_b domain.",
  ],
  writeup: "<p><b>Why it is written this way.</b> When <code>d</code> changes close to a <code>clk_b</code> edge, the first flop can end up between 0 and 1 for a short time. Given a full cycle it almost always settles, so the second flop sees a clean value. That is all a two-flop synchronizer is: two flops in the new clock, nothing in between.</p><p><b>What goes wrong.</b> With one flop, the unsettled value goes straight into your logic. With logic between the flops, the glitch can spread before it has settled. If <code>d</code> also feeds a second place in the <code>clk_b</code> domain, the two copies can settle to different values.</p><p><b>Limits.</b> A level only passes safely if it stays steady for a few <code>clk_b</code> edges. A pulse shorter than that can be missed, which is why the pulse problem uses a toggle. This grader does not model the settling itself; it checks the structure and the old-or-new timing.</p>",
  reference: `module sync2(input clk_a, input clk_b, input rst_b, input d, output q);
  reg s1, s2;
  always @(posedge clk_b) if (rst_b) begin s1 <= 0; s2 <= 0; end else begin s1 <= d; s2 <= s1; end
  assign q = s2;
endmodule
`,
  cdc: {
    clocks: ["clk_a", "clk_b"], ports: { rst_b: 1, d: 0 }, data: [], resets: ["rst_b"],
    show: ["d", "q", "seen1", "stuck"],
    reasons: [["seen1", "q was 1 but d never was 1"], ["stuck", "d was steady for 5 clk_b edges but q did not follow"]],
    harness: `module cdc_tb(input gclk, input ena, input enb, input rst_b, input d_f, input [{{N}}-1:0] skew,
  output d, output q, output seen1, output stuck, output proto, output fail);
  reg dq = 0, s1 = 0, armed = 0, dprev = 0, bad1 = 0, bad2 = 0; reg [2:0] stab = 0;
  assign d = dq, seen1 = bad1, stuck = bad2, proto = 0, fail = bad1 | bad2;
  {{TOP}} u(.clk_a(1'b0), .clk_b(1'b0), .gclk(gclk), .ena(ena), .enb(enb), .rst_b(rst_b), .d(d), .q(q), .skew(skew));
  always @(posedge gclk) if (ena) begin dq <= d_f; if (d_f) s1 <= 1; end
  always @(posedge gclk) if (enb) begin
    if (rst_b) armed <= 1;
    if (d == dprev) begin if (stab != 7) stab <= stab + 1; end else stab <= 0;
    dprev <= d;
    if (armed && !rst_b) begin
      if (q && !s1) bad1 <= 1;
      if (stab >= 5 && d == dprev && q != d) bad2 <= 1;
    end
  end
endmodule
`,
  },
};

const FIFO = {
  id: "cdc-async-fifo",
  title: "Asynchronous FIFO (depth 4)",
  difficulty: "Hard",
  tags: ["RTL", "CDC", "two clocks", "FIFO"],
  kind: "rtl",
  top: "async_fifo",
  statement: `
<p>Build a FIFO with 4 entries of 8 bits. The write side runs on <code>wclk</code>, the read side on <code>rclk</code>, and the two clocks are unrelated.</p>
<ul>
  <li>Ports are fixed: <code>wclk</code>, <code>rclk</code>, <code>wrst</code> (synchronous to <code>wclk</code>), <code>rrst</code> (synchronous to <code>rclk</code>), <code>winc</code>, <code>wdata[7:0]</code>, <code>wfull</code>, <code>rinc</code>, <code>rdata[7:0]</code>, <code>rempty</code>. Resets are active-high; after reset the FIFO is empty (<code>rempty</code>=1, <code>wfull</code>=0).</li>
  <li>A write happens on a <code>wclk</code> edge with <code>winc</code>=1. A read happens on an <code>rclk</code> edge with <code>rinc</code>=1. Whenever <code>rempty</code>=0, <code>rdata</code> shows the oldest entry, and a read removes it. The test producer sets <code>winc</code> whenever <code>wfull</code>=0 and the test consumer sets <code>rinc</code> whenever <code>rempty</code>=0, so both go as fast as your flags allow.</li>
  <li>Flags may be late (they may stay up a cycle or two longer than needed), but never early: <code>wfull</code> must be 1 whenever the FIFO is really full, and <code>rempty</code> must be 1 whenever it is really empty.</li>
  <li>Structure: every pointer bit that crosses must go straight into a flop of the other clock and through at least two such flops. The data memory itself needs no synchronizer: the pointers guard it.</li>
  <li>Bus rule: a multi-bit pointer that crosses clocks must change <b>one bit at a time</b> (Gray code). If one clock event can change two or more bits of it, the design fails, and the step table shows the bus before and after (for example 011 to 100 flips three bits).</li>
  <li>Bit timing: the first flop of each crossing bit may catch the old or the new value of that bit, on its own. Data must come out in order, with nothing lost or repeated, no write accepted when really full and no read when really empty. Only safety is checked (a clock may stop), for 16 steps. Each step is one clock event: <code>wclk</code> ticks, <code>rclk</code> ticks, both, or neither.</li>
</ul>
<p><b>What this grader can and cannot see.</b> Simulators and Studio treat flops as ideal and cannot show metastability, so this grader checks the structure and the worst-case bit timing instead. Structure failures are shown as a message naming the net. A timing failure is shown as a table of steps.</p>`,
  starter: `module async_fifo (
  input  wire       wclk,
  input  wire       rclk,
  input  wire       wrst,
  input  wire       rrst,
  input  wire       winc,
  input  wire [7:0] wdata,
  output wire       wfull,
  input  wire       rinc,
  output wire [7:0] rdata,
  output wire       rempty
);
  // your code here
endmodule
`,
  hints: [
    "The two sides must know how full the FIFO is, so each side's pointer has to cross to the other clock. If several bits change at once, the other side can catch some old and some new bits and see a pointer that never existed.",
    "Make only one bit change per step: send the pointers in Gray code. Use pointers one bit wider than the address (3 bits for 4 entries) so full and empty can be told apart.",
    "Keep a binary counter to address the memory, and register its Gray code (b ^ (b >> 1)). Cross each Gray bit through two flops. Empty: read Gray equals the synchronized write Gray. Full: write Gray equals the synchronized read Gray with its top two bits inverted.",
  ],
  writeup: "<p><b>Why it is written this way.</b> Each side counts in binary to address the memory, and sends a Gray-coded copy of its pointer to the other side. In Gray code exactly one bit changes per step, so a flop that catches a mix of old and new bits still sees either the old pointer or the new one, never a made-up one. A pointer that is a little old only makes the flags late, which is safe.</p><p><b>What goes wrong.</b> If you send the binary pointer, going from 3 to 4 changes three bits at once. A mix of old and new bits can read as 7 or 0, the FIFO thinks it holds data it does not, and a read returns garbage. A flop that samples the bus while it is changing can catch any mix of old and new bits, so the rule forbids a bus that flips more than one bit per step. It does not rely on the read and write logic happening to tolerate the torn value: a design that happens to survive the bit-timing run still fails this rule.</p><p><b>Two checks.</b> The bus rule is a design rule, checked on every step: no pointer may change more than one bit per clock event. Separately, the bit-timing run lets the first flop of each crossing bit catch the old or new value on its own, and a scoreboard checks order, loss, overflow and underflow. The scoreboard alone would not fail a binary FIFO of this style, which is why the rule exists.</p><p><b>Limits.</b> The pointers have one extra bit so a full FIFO and an empty FIFO do not look the same. The checks are bounded: they search a limited number of clock events, they do not prove the design for all time.</p>",
  reference: `module async_fifo(input wclk, input rclk, input wrst, input rrst, input winc, input [7:0] wdata, output wfull,
                  input rinc, output [7:0] rdata, output rempty);
  reg [7:0] mem0, mem1, mem2, mem3;
  reg [2:0] wbin, rbin, wgray, rgray;   // 2 address bits + 1 wrap bit
  reg [2:0] rq1, rq2;                   // rgray into wclk
  reg [2:0] wq1, wq2;                   // wgray into rclk
  reg wfull_r, rempty_r;
  wire [2:0] wbin_n = wbin + {2'b0, winc & ~wfull_r}, wgray_n = wbin_n ^ (wbin_n >> 1);
  wire [2:0] rbin_n = rbin + {2'b0, rinc & ~rempty_r}, rgray_n = rbin_n ^ (rbin_n >> 1);
  always @(posedge wclk) begin
    if (wrst) begin wbin <= 0; wgray <= 0; rq1 <= 0; rq2 <= 0; wfull_r <= 0; end
    else begin
      wbin <= wbin_n; wgray <= wgray_n; rq1 <= rgray; rq2 <= rq1;
      wfull_r <= (wgray_n == {~rq2[2:1], rq2[0]});
    end
    if (winc & ~wfull_r) case (wbin[1:0]) 0: mem0 <= wdata; 1: mem1 <= wdata; 2: mem2 <= wdata; default: mem3 <= wdata; endcase
  end
  always @(posedge rclk) begin
    if (rrst) begin rbin <= 0; rgray <= 0; wq1 <= 0; wq2 <= 0; rempty_r <= 1; end
    else begin
      rbin <= rbin_n; rgray <= rgray_n; wq1 <= wgray; wq2 <= wq1;
      rempty_r <= (rgray_n == wq2);
    end
  end
  assign wfull = wfull_r, rempty = rempty_r;
  assign rdata = rbin[1:0] == 0 ? mem0 : rbin[1:0] == 1 ? mem1 : rbin[1:0] == 2 ? mem2 : mem3;
endmodule
`,
  cdc: {
    clocks: ["wclk", "rclk"], ports: { wrst: 0, winc: 0, wdata: 0, rrst: 1, rinc: 1 }, data: ["wdata"], resets: ["wrst", "rrst"], steps: 16,
    show: ["wrst", "rrst", "winc", "wdata", "wfull", "rinc", "rdata", "rempty", "over", "under", "bad_data"],
    reasons: [["over", "a write was accepted while the FIFO was really full (wfull was 0)"],
      ["under", "a read was accepted while the FIFO was really empty (rempty was 0)"],
      ["bad_data", "the data read was not the oldest entry written"]],
    harness: `module cdc_tb(input gclk, input ena, input enb, input wrst, input rrst, input winc, input rinc, input [{{N}}-1:0] skew,
  output wfull, output rempty, output [7:0] rdata, output [7:0] wdata, output over, output under, output bad_data, output proto, output fail);
  {{TOP}} u(.wclk(1'b0), .rclk(1'b0), .gclk(gclk), .ena(ena), .enb(enb), .wrst(wrst), .rrst(rrst), .winc(winc), .wdata(wdata), .wfull(wfull),
            .rinc(rinc), .rdata(rdata), .rempty(rempty), .skew(skew));
  assign proto = (winc != ~wfull) | (rinc != ~rempty);   // the producer and consumer always go as fast as the flags allow
  reg [4:0] wcnt = 0, rcnt = 0; reg o = 0, un = 0, bd = 0;
  assign wdata = {3'b101, wcnt};   // data = a running count, so order, loss and repeats show up in rdata
  assign over = o, under = un, bad_data = bd, fail = o | un | bd;
  always @(posedge gclk) if (ena) if (wrst) wcnt <= 0; else if (winc) begin
    if (wcnt - rcnt >= 4) o <= 1;
    wcnt <= wcnt + 1;
  end
  always @(posedge gclk) if (enb) if (rrst) rcnt <= 0; else if (rinc) begin
    if (wcnt == rcnt) un <= 1; else if (rdata != {3'b101, rcnt}) bd <= 1;
    rcnt <= rcnt + 1;
  end
endmodule
`,
  },
};

const PULSE = {
  id: "cdc-pulse-sync",
  title: "Pulse synchronizer (toggle)",
  difficulty: "Medium",
  tags: ["RTL", "CDC", "two clocks"],
  kind: "rtl",
  top: "pulse_sync",
  statement: `
<p>A one-cycle pulse on <code>pulse_in</code> in the <code>clk_a</code> domain must become exactly one pulse on <code>pulse_out</code> in the <code>clk_b</code> domain. The two clocks are unrelated, so <code>clk_b</code> may be slower than the pulse. Use the toggle method.</p>
<ul>
  <li>Ports are fixed: <code>clk_a</code>, <code>clk_b</code>, <code>rst_a</code> (synchronous to <code>clk_a</code>), <code>rst_b</code> (synchronous to <code>clk_b</code>), <code>pulse_in</code>, <code>pulse_out</code>. Resets are active-high.</li>
  <li><code>pulse_in</code> is high for one <code>clk_a</code> edge per pulse, straight from a <code>clk_a</code> flop. <b>Spacing rule:</b> two pulses are always at least 6 <code>clk_b</code> edges apart, so the design does not need to handle faster ones.</li>
  <li>Structure: the signal that crosses must go straight into a <code>clk_b</code> flop and through at least two <code>clk_b</code> flops before any logic.</li>
  <li>Count: <code>pulse_out</code> is sampled at each <code>clk_b</code> edge. The number of sampled 1s must never be more than the number of input pulses (no extra or doubled pulse), and 6 <code>clk_b</code> edges after a pulse, every pulse must have come out. Only safety is checked (a clock may stop), for 24 steps.</li>
</ul>
<p><b>What this grader can and cannot see.</b> Simulators and Studio treat flops as ideal and cannot show metastability, so this grader checks the structure and the worst-case bit timing instead. A structure failure is shown as a message naming the net. A count failure is shown as a table of steps.</p>`,
  starter: `module pulse_sync (
  input  wire clk_a,
  input  wire clk_b,
  input  wire rst_a,
  input  wire rst_b,
  input  wire pulse_in,
  output wire pulse_out
);
  // your code here
endmodule
`,
  hints: [
    "A one-cycle pulse in a fast clock can fall between two edges of a slow clock, so sending the pulse itself across can lose it. Send something that stays.",
    "Turn each pulse into a change of level: a flop in clk_a that flips every time pulse_in is 1. A level stays until the other side sees it. Cross that level with a two-flop synchronizer.",
    "In clk_b, add one more flop after the two synchronizer flops, and make pulse_out the XOR of the last two. It is 1 for exactly one clk_b cycle after every flip.",
  ],
  writeup: "<p><b>Why it is written this way.</b> A pulse is too short to cross safely, but a level can wait. So the <code>clk_a</code> side flips a toggle flop on every pulse. The <code>clk_b</code> side brings the toggle across with two flops, keeps one more copy, and the XOR of the last two copies is high for one cycle exactly when the toggle changed.</p><p><b>What goes wrong.</b> With one flop, the toggle goes into logic before it settles. If the pulse itself is sent across instead of a toggle, a slow <code>clk_b</code> can miss it entirely.</p><p><b>Limits.</b> The toggle needs a few <code>clk_b</code> edges to get across, so pulses must be spaced out, here by 6 <code>clk_b</code> edges. Closer pulses can merge. The grader does not model settling; it checks the structure and the old-or-new timing, to a bounded number of steps.</p>",
  reference: `module pulse_sync(input clk_a, input clk_b, input rst_a, input rst_b, input pulse_in, output pulse_out);
  reg tog, s1, s2, s3;
  always @(posedge clk_a) if (rst_a) tog <= 0; else if (pulse_in) tog <= ~tog;
  always @(posedge clk_b) if (rst_b) begin s1 <= 0; s2 <= 0; s3 <= 0; end else begin s1 <= tog; s2 <= s1; s3 <= s2; end
  assign pulse_out = s2 ^ s3;
endmodule
`,
  cdc: {
    clocks: ["clk_a", "clk_b"], ports: { rst_a: 0, rst_b: 1, pulse_in: 0 }, data: [], resets: ["rst_a", "rst_b"], steps: 24,
    show: ["rst_a", "rst_b", "pulse_in", "pulse_out", "extra", "lost"],
    reasons: [["extra", "more pulses came out than went in"], ["lost", "a pulse went in and did not come out within 6 clk_b edges"]],
    harness: `module cdc_tb(input gclk, input ena, input enb, input rst_a, input rst_b, input p_f, input [{{N}}-1:0] skew,
  output pulse_in, output pulse_out, output extra, output lost, output proto, output fail);
  {{TOP}} u(.clk_a(1'b0), .clk_b(1'b0), .gclk(gclk), .ena(ena), .enb(enb), .rst_a(rst_a), .rst_b(rst_b), .pulse_in(pulse_in), .pulse_out(pulse_out), .skew(skew));
  reg pin = 0, lo = 0; reg [3:0] incnt = 0, outcnt = 0; reg [7:0] bcnt = 0, last = 0;
  wire go = p_f & ~pin & (incnt == 0 | bcnt - last >= 6);
  assign pulse_in = pin, extra = outcnt > incnt, lost = lo, proto = 0, fail = extra | lo;
  always @(posedge gclk) if (ena) if (rst_a) pin <= 0; else begin pin <= go; if (pin) begin incnt <= incnt + 1; last <= bcnt; end end // counted when the DUT samples it
  always @(posedge gclk) if (enb) begin
    bcnt <= bcnt + 1;
    if (!rst_b) begin
      if (pulse_out) outcnt <= outcnt + 1;
      if (incnt != 0 && bcnt - last >= 6 && outcnt != incnt) lo <= 1;
    end
  end
endmodule
`,
  },
};

export const CDC_PROBLEMS = [SYNC2, PULSE, FIFO];
