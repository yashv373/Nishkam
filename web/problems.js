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
    hints: [
      "The state is just four flip-flops. Think about which condition should win when both rst and en are 1.",
      "Check rst first, then en. When en is 0 you do not need to write anything: a clocked block that does not assign keeps its value.",
      "Use a non-blocking assignment, q <= q + 1. A 4-bit q wraps from 15 to 0 by itself, so no compare is needed."
    ],
    writeup: "<p><b>Why it is written this way.</b> The reference is one clocked block with a priority chain: reset first, then enable, otherwise hold. Reset is inside the block, so it is synchronous, as the statement asks. The wrap from 15 to 0 comes free because <code>q</code> is only 4 bits wide.</p>\n<p><b>Common mistakes.</b> Putting <code>posedge rst</code> in the sensitivity list makes the reset asynchronous. Checking <code>en</code> before <code>rst</code> means reset is ignored while enable is 1. Mixing blocking (<code>=</code>) and non-blocking (<code>&lt;=</code>) assignments in a clocked block.</p>\n<p><b>In hardware.</b> Four flip-flops hold <code>q</code>. In front of them sits a 4-bit incrementer (a chain of XOR and AND gates), and reset and enable decide what reaches each D input: 0, the incremented value, or the old value fed back. Synthesis turns the \"else do nothing\" into that feedback path.</p>",
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
    hints: [
      "You need to remember what d was at the last clock edge. That needs exactly one flip-flop.",
      "The pulse is combinational: it looks at the current d and the stored value together. Do not put the pulse itself through a flip-flop.",
      "Store d in a register that clears on rst, then pulse is d AND NOT stored."
    ],
    writeup: "<p><b>Why it is written this way.</b> One register <code>p</code> holds <code>d</code> from the previous rising edge, and <code>pulse = d &amp; ~p</code> compares it with the current <code>d</code>. The pulse is high only while <code>d</code> is 1 and the old value was 0, which lasts one cycle.</p>\n<p><b>Common mistakes.</b> Registering <code>pulse</code> too, which delays it by one cycle and fails the check. Resetting the stored value to 1, which would hide an edge right after reset. Forgetting that the output depends on <code>d</code> directly, so it can change in the middle of a cycle when <code>d</code> changes.</p>\n<p><b>In hardware.</b> One flip-flop (with reset logic at its D input) and one AND gate with an inverted input. There is a path straight from input <code>d</code> to output <code>pulse</code> through that gate, which matters when you later read timing reports.</p>",
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
    hints: [
      "Think about what the last four bits you saw look like when the pattern has just ended.",
      "A 4-bit shift register that takes in din each cycle remembers exactly those last four bits. Overlapping matches then need no extra work.",
      "hit must be 1 in the cycle after the last 1 was sampled, so compare the register, not din itself. Clear the register on reset."
    ],
    writeup: "<p><b>Why it is written this way.</b> The reference keeps the last four input bits in <code>sh</code> and sets <code>hit</code> when they equal 1011. Every new bit just pushes the others along, so overlaps such as <code>1011011</code> are found with no special handling. It is reset to 0000, so bits from before reset cannot form a match.</p>\n<p><b>Common mistakes.</b> Comparing <code>{sh[2:0], din}</code> to 1011 gives the output one cycle early. This problem asks for an output that comes from stored state. In a state-machine version, the usual error is a wrong fall-back state after a mismatch, which breaks overlaps. Forgetting to clear the state on reset.</p>\n<p><b>In hardware.</b> Four flip-flops in a chain, and a 4-input compare on their outputs (an AND of the four bits, with the one that must be 0 inverted). A hand-written state machine can use fewer flip-flops, but the shift register is simpler to get right. The grader checks behaviour only, so either passes.</p>",
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
    hints: [
      "Counting in Gray code directly is awkward. Is there a simple way to count normally and change the code only at the output?",
      "Keep an ordinary 4-bit binary counter inside, with the same reset and enable behaviour as the up-counter.",
      "Binary to Gray: the top bit stays the same, and every other bit is the XOR of its own bit and the bit above it. That is b ^ (b >> 1)."
    ],
    writeup: "<p><b>Why it is written this way.</b> The counter itself is plain binary, like the up-counter problem. The Gray code is made at the output with <code>g = b ^ (b &gt;&gt; 1)</code>. You can check the wrap: when <code>b</code> goes from 15 to 0, <code>g</code> goes from 1000 to 0000, so that step also changes only one bit.</p>\n<p><b>Common mistakes.</b> Writing the Gray sequence as a hand-made case table with a typo in one row. Shifting the wrong way (<code>&lt;&lt;</code> instead of <code>&gt;&gt;</code>). Resetting to anything other than 0000.</p>\n<p><b>In hardware.</b> Four flip-flops, an incrementer and three XOR gates (the top bit passes straight through). Note that <code>g</code> comes out of the XOR gates, not directly from flip-flops. For a pointer that really crosses a clock domain, designers usually register the Gray value as well so the output is clean. This problem only asks for the behaviour.</p>",
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
    hints: [
      "You need to remember who was granted last. Two bits are enough for four requesters.",
      "Look at the requesters in the order last+1, last+2, last+3, last+4, and grant the first one whose req is 1. A 2-bit index wraps around by itself.",
      "Update last only on a cycle where something was granted. Reset sets it to 3. Keep gnt combinational, and give it a default value of 0 so no latch is made."
    ],
    writeup: "<p><b>Why it is written this way.</b> <code>last</code> is the only state. The loop tries <code>last+1</code>, then <code>last+2</code>, and so on. Because <code>idx</code> is 2 bits wide, the addition wraps from 3 to 0 on its own. The first requester found wins, and <code>found</code> stops later ones from overriding it. <code>gnt</code> is set to zero first, so every path through the block assigns it.</p>\n<p><b>Common mistakes.</b> Updating <code>last</code> when nobody was granted. Resetting <code>last</code> to 0, which gives requester 1 the top priority after reset instead of requester 0. Using a fixed priority order. Making <code>gnt</code> registered, which delays it a cycle. Leaving a path where <code>gnt</code> is not assigned, which makes a latch.</p>\n<p><b>In hardware.</b> Two flip-flops for <code>last</code>. The loop does not run as a loop; synthesis unrolls it into four checks in a rotating order, followed by a decoder from the winning index to the one-hot <code>gnt</code>. The result is a small block of gates between <code>req</code>, <code>last</code> and <code>gnt</code>.</p>",
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
  <li>die area ≤ <b>19,000 µm²</b> (baseline: 62,500)</li>
  <li>0 routing DRC errors, 0 Magic DRC errors, 0 LVS errors</li>
  <li>setup and hold slack ≥ 0 at a <b>24 ns</b> clock (fixed, you cannot change it)</li>
</ul>
<p>The RTL is fixed. You only edit the knobs. Runs on your machine through the local runner (about 2–3 minutes per try).</p>
<p><b>What changed:</b> the clock used to be 40 ns, where timing never mattered and only the cell area set the limit. At 24 ns the setup slack gets tight as the die shrinks, and the placement density now decides whether a small die passes. Die size and density pull against each other, so you have to tune both.</p>
<p class="muted">Results come from your own machine and are not verified. This problem is for practice, not for ranking.</p>
<p><a href="studio.html#demo=squeeze-tiny8" target="_blank" rel="noopener">Try it in the browser (approximate)</a>: opens Nishkam Studio with tiny8 loaded and the physical engine set to In browser. Browser place-and-route (graywolf, qrouter, Magic) is not timing-driven and is not LibreLane, so the numbers will differ and do not count for this problem. Studio needs a screen wider than 700 px.</p>`,
    files: { "tiny8.v": TINY8 },
    clock_port: "clk",
    fixed_knobs: { CLOCK_PERIOD: 24 },
    starter: JSON.stringify({ DIE_AREA: [0, 0, 250, 250], PL_TARGET_DENSITY_PCT: 50 }, null, 2),
    checks: [
      ["design__die__area", "<=", 19000, "die area µm²"],
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
