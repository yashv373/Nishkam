// Nishkam problem bank.
// ponytail: references ship to the browser, so anyone can read them in devtools.
// Fine for an MVP; move grading server-side before using this for hiring or paid data.

const TINY8 = `// tiny8: a minimal 8-bit CPU.
// Program memory is outside (instr/pc ports) so synthesis can't fold the program away.
// State = pc (8) + 4 regs (32) + out (8) = 48 flip-flops.
//
// instr[15:0] = op[15:12] rd[11:10] rs[9:8] imm[7:0]
//   1 LDI rd = imm      2 ADD rd += rs     3 SUB rd -= rs
//   4 JNZ if rd!=0 pc = imm               5 OUT out = rd     others: NOP
module tiny8 (
    input  wire        clk,
    input  wire        rst_n,
    input  wire [15:0] instr,
    output reg  [7:0]  pc,
    output reg  [7:0]  out
);
    reg  [7:0] r0, r1, r2, r3;
    wire [7:0] rf [0:3];
    assign rf[0] = r0;
    assign rf[1] = r1;
    assign rf[2] = r2;
    assign rf[3] = r3;

    wire [3:0] op  = instr[15:12];
    wire [1:0] rd  = instr[11:10];
    wire [1:0] rs  = instr[9:8];
    wire [7:0] imm = instr[7:0];
    wire [7:0] a   = rf[rd];
    wire [7:0] b   = rf[rs];

    // register-file write: data + enable
    reg [7:0] wdata;
    reg       we;
    always @(*) begin
        we = 1'b1;
        case (op)
            4'd1:    wdata = imm;
            4'd2:    wdata = a + b;
            4'd3:    wdata = a - b;
            default: begin wdata = 8'd0; we = 1'b0; end
        endcase
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            pc  <= 8'd0;
            out <= 8'd0;
            r0  <= 8'd0;
            r1  <= 8'd0;
            r2  <= 8'd0;
            r3  <= 8'd0;
        end else begin
            pc <= (op == 4'd4 && a != 8'd0) ? imm : pc + 8'd1;
            if (op == 4'd5) out <= a;
            if (we) case (rd)
                2'd0: r0 <= wdata;
                2'd1: r1 <= wdata;
                2'd2: r2 <= wdata;
                2'd3: r3 <= wdata;
            endcase
        end
    end
endmodule
`;

export const PROBLEMS = [
  {
    id: "counter-en",
    title: "Up-counter with enable",
    difficulty: "Easy",
    tags: ["RTL", "sequential"],
    kind: "rtl",
    top: "counter",
    stretch: { areaUm2: 460 }, // reference measures 450 µm² on gf180 (score.test.mjs), plus 2%
    reset: { port: "rst", active: 1 },
    statement: `
<p>Build a 4-bit up-counter.</p>
<ul>
  <li><code>rst</code> is <b>synchronous</b>, active-high: on a rising <code>clk</code> edge with <code>rst=1</code>, <code>q</code> becomes 0.</li>
  <li>Otherwise, when <code>en=1</code>, <code>q</code> increments by 1 on each rising edge and wraps from 15 to 0.</li>
  <li>When <code>en=0</code>, <code>q</code> holds.</li>
</ul>`,
    starter: `module counter (
  input  wire       clk,
  input  wire       rst,
  input  wire       en,
  output reg  [3:0] q
);
  // your code here
endmodule
`,
    reference: `module counter(input clk, input rst, input en, output reg [3:0] q);
  always @(posedge clk) if (rst) q <= 0; else if (en) q <= q + 1;
endmodule
`,
  },
  {
    id: "rise-edge",
    title: "Rising-edge detector",
    difficulty: "Easy",
    tags: ["RTL", "sequential"],
    kind: "rtl",
    top: "edge_detect",
    stretch: { mhz: 600 }, // reference reaches 634 MHz (score.test.mjs), minus about 5%
    reset: { port: "rst", active: 1 },
    statement: `
<p>Output a one-cycle pulse when input <code>d</code> goes from 0 to 1.</p>
<ul>
  <li><code>pulse</code> is <b>combinational</b> from the current <code>d</code> and the value of <code>d</code> sampled at the previous rising edge: <code>pulse = d &amp; ~d_prev</code>.</li>
  <li><code>rst</code> is synchronous, active-high, and clears the stored previous value to 0.</li>
</ul>`,
    starter: `module edge_detect (
  input  wire clk,
  input  wire rst,
  input  wire d,
  output wire pulse
);
  // your code here
endmodule
`,
    reference: `module edge_detect(input clk, input rst, input d, output pulse);
  reg p;
  always @(posedge clk) if (rst) p <= 0; else p <= d;
  assign pulse = d & ~p;
endmodule
`,
  },
  {
    id: "seq-1011",
    title: "Sequence detector: 1011 (overlapping)",
    difficulty: "Medium",
    tags: ["RTL", "FSM"],
    kind: "rtl",
    top: "seq_det",
    reset: { port: "rst", active: 1 },
    statement: `
<p>Detect the serial pattern <code>1011</code> on <code>din</code>, one bit per rising edge, oldest bit first. Overlaps count: <code>1011011</code> contains two matches.</p>
<ul>
  <li><code>hit</code> is a <b>registered-state (Moore)</b> output: it is 1 during the cycle right after the edge that sampled the final <code>1</code> of a match, and 0 otherwise.</li>
  <li><code>rst</code> is synchronous, active-high. Bits sampled before reset don't count.</li>
</ul>
<p>Any implementation is fine: FSM, shift register, anything. The grader checks behaviour, not structure.</p>`,
    starter: `module seq_det (
  input  wire clk,
  input  wire rst,
  input  wire din,
  output wire hit
);
  // your code here
endmodule
`,
    reference: `module seq_det(input clk, input rst, input din, output hit);
  reg [3:0] sh;  // last 4 bits; reset to 0000 so pre-reset bits can't match
  always @(posedge clk) if (rst) sh <= 0; else sh <= {sh[2:0], din};
  assign hit = (sh == 4'b1011);
endmodule
`,
  },
  {
    id: "gray-counter",
    title: "4-bit Gray-code counter",
    difficulty: "Medium",
    tags: ["RTL", "counters", "encoding"],
    kind: "rtl",
    top: "gray_cnt",
    reset: { port: "rst", active: 1 },
    statement: `
<p>Count in 4-bit reflected Gray code: 0000, 0001, 0011, 0010, 0110, … , 1000, then back to 0000. Exactly one bit of <code>g</code> changes per step, which is why Gray counters are used for FIFO pointers across clock domains.</p>
<ul>
  <li>Advance one step per rising edge when <code>en=1</code>; hold when <code>en=0</code>.</li>
  <li><code>rst</code> is synchronous, active-high, and sets <code>g</code> to 0000.</li>
</ul>`,
    starter: `module gray_cnt (
  input  wire       clk,
  input  wire       rst,
  input  wire       en,
  output wire [3:0] g
);
  // your code here
endmodule
`,
    reference: `module gray_cnt(input clk, input rst, input en, output [3:0] g);
  reg [3:0] b;
  always @(posedge clk) if (rst) b <= 0; else if (en) b <= b + 1;
  assign g = b ^ (b >> 1);
endmodule
`,
  },
  {
    id: "rr-arbiter",
    title: "4-way round-robin arbiter",
    difficulty: "Hard",
    tags: ["RTL", "arbitration"],
    kind: "rtl",
    top: "rr_arb",
    reset: { port: "rst", active: 1 },
    statement: `
<p>Grant one of four requesters, rotating priority fairly.</p>
<ul>
  <li><code>gnt</code> is <b>combinational</b> and one-hot (or all zero when <code>req == 0</code>).</li>
  <li>The arbiter remembers the index of the last granted requester, <code>last</code>. Priority starts at <code>last+1</code> and wraps: if <code>last=2</code>, the order is 3, 0, 1, 2.</li>
  <li>On each rising edge where some grant is given, <code>last</code> becomes the granted index. With no grant, <code>last</code> holds.</li>
  <li><code>rst</code> is synchronous, active-high, and sets <code>last</code> to 3, so requester 0 has top priority after reset.</li>
</ul>`,
    starter: `module rr_arb (
  input  wire       clk,
  input  wire       rst,
  input  wire [3:0] req,
  output reg  [3:0] gnt
);
  // your code here
endmodule
`,
    reference: `module rr_arb(input clk, input rst, input [3:0] req, output reg [3:0] gnt);
  reg [1:0] last; reg [1:0] idx; reg [1:0] gi; reg found; integer i;
  always @* begin
    gnt = 0; found = 0; gi = 0;
    for (i = 1; i <= 4; i = i + 1) begin
      idx = last + i;
      if (!found && req[idx]) begin found = 1; gi = idx; end
    end
    if (found) gnt = 4'b0001 << gi;
  end
  always @(posedge clk) if (rst) last <= 2'd3; else if (found) last <= gi;
endmodule
`,
  },
  {
    id: "squeeze-tiny8",
    title: "Squeeze tiny8 onto a smaller die",
    difficulty: "Hard",
    tags: ["Physical design", "gf180", "LibreLane"],
    kind: "flow",
    top: "tiny8",
    statement: `
<p><code>tiny8</code> is a small 8-bit CPU with 48 flip-flops. It passes signoff on a 250 × 250 µm die in gf180mcuD, but most of that die is empty space.</p>
<p>Shrink it. Choose the die size and placement density so that the design still passes signoff:</p>
<ul>
  <li>die area ≤ <b>30,000 µm²</b> (baseline: 62,500)</li>
  <li>0 routing DRC errors, 0 Magic DRC errors, 0 LVS errors</li>
  <li>setup and hold slack ≥ 0 at a 40 ns clock</li>
</ul>
<p>The RTL is fixed. You only edit the knobs. Runs on your machine through the local runner (about 2–3 minutes per try).</p>`,
    files: { "tiny8.v": TINY8 },
    clock_port: "clk",
    fixed_knobs: { CLOCK_PERIOD: 40 },
    starter: JSON.stringify({ DIE_AREA: [0, 0, 250, 250], PL_TARGET_DENSITY_PCT: 50 }, null, 2),
    checks: [
      ["design__die__area", "<=", 30000, "die area µm²"],
      ["route__drc_errors", "==", 0, "routing DRC"],
      ["magic__drc_error__count", "==", 0, "Magic DRC"],
      ["design__lvs_error__count", "==", 0, "LVS errors"],
      ["timing__setup__ws", ">=", 0, "setup slack ns"],
      ["timing__hold__ws", ">=", 0, "hold slack ns"],
    ],
  },
];

// Every passed RTL problem can be taken to silicon with these default knobs.
export const HARDEN_KNOBS = { DIE_AREA: [0, 0, 120, 120], CLOCK_PERIOD: 40 };
