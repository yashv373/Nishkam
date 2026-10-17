// Project files in localStorage (try/catch: private mode just means no persistence).
import { PROBLEMS } from "../problems.js";
const KEY = "studio:project:v1";
const COUNTER = `module counter (input clk, input rst, input en, output reg [3:0] q);
  always @(posedge clk) if (rst) q <= 4'd0; else if (en) q <= q + 4'd1;
endmodule
`;
const TB = `\`timescale 1ns/1ps
module tb;
  reg clk = 0, rst = 1, en = 0; wire [3:0] q;
  counter dut (.clk(clk), .rst(rst), .en(en), .q(q));
  always #5 clk = ~clk;
  initial begin
    $dumpfile("dump.vcd"); $dumpvars(0, tb);
    #22 rst = 0; en = 1;
    #200 if (q !== 4'd4 && q !== 4'd5) $display("FAIL q=%d", q); else $display("PASS q=%d", q);
    $finish;
  end
endmodule
`;
const SHREG = `module shreg4 (input clk, input rst_n, input d, output [3:0] q);
  reg [3:0] r;
  always @(posedge clk or negedge rst_n) if (!rst_n) r <= 4'b0; else r <= {r[2:0], d};
  assign q = r;
endmodule
`;
const TB_SHREG = `\`timescale 1ns/1ps
module tb_shreg4;
  reg clk = 0, rst_n = 0, d = 0; wire [3:0] q;
  shreg4 dut (.clk(clk), .rst_n(rst_n), .d(d), .q(q));
  always #5 clk = ~clk;
  initial begin
    $dumpfile("dump.vcd"); $dumpvars(0, tb_shreg4);
    #22 rst_n = 1;
    d = 1; #10 d = 0; #10 d = 1; #10 d = 1; #10 d = 0; #8;
    if (q === 4'b0110) $display("PASS q=%b", q); else $display("FAIL q=%b", q);
    $finish;
  end
endmodule
`;
const fifo = (bug) => `// 4-entry FIFO. The checks at the bottom are for the Verify stage (Formal mode).
module fifo4 (input clk, input rst, input push, input pop, input [7:0] din, output [7:0] dout, output full, output empty);
  reg [7:0] mem [0:3];
  reg [1:0] wp, rp;
  reg [2:0] count;
  assign full = (count == 3'd4);
  assign empty = (count == 3'd0);
  assign dout = mem[rp];
  wire do_push = push${bug ? "" : " && !full"};   ${bug ? "// BUG: a push is accepted even when the FIFO is full" : "// a push is ignored when full"}
  wire do_pop = pop && !empty;
  always @(posedge clk)
    if (rst) begin wp <= 0; rp <= 0; count <= 0; end
    else begin
      if (do_push) begin mem[wp] <= din; wp <= wp + 1; end
      if (do_pop) rp <= rp + 1;
      count <= count + do_push - do_pop;
    end

\`ifdef FORMAL
  // "init" is 1 only in the very first cycle; we assume the reset is applied then.
  reg init = 1;
  always @(posedge clk) init <= 0;
  always @(*) if (init) assume (rst);
  always @(*) if (!init) begin
    a_count_max: assert (count <= 3'd4);               // never holds more than 4 items
    a_not_both:  assert (!(full && empty));            // never full and empty together
    a_pointers:  assert ((wp - rp) == count[1:0]);     // pointers and count agree
  end
  always @(*) c_full: cover (!init && full);            // can the FIFO ever become full?
\`endif
endmodule
`;
const TB_FIFO = (name) => `\`timescale 1ns/1ps
// Self-checking testbench: prints PASS or FAIL, and uses $error for every wrong value.
module tb_fifo;
  reg clk = 0, rst = 1, push = 0, pop = 0; reg [7:0] din = 0; wire [7:0] dout; wire full, empty;
  fifo4 dut (.clk(clk), .rst(rst), .push(push), .pop(pop), .din(din), .dout(dout), .full(full), .empty(empty));
  always #5 clk = ~clk;
  integer i, bad = 0;
  initial begin
    $dumpfile("dump.vcd"); $dumpvars(0, tb_fifo);
    #22 rst = 0;
    for (i = 0; i < 6; i = i + 1) begin push = 1; din = 8'd10 + i; #10; end   // 6 pushes into a 4-entry FIFO
    push = 0;
    for (i = 0; i < 4; i = i + 1) begin
      if (dout !== 8'd10 + i) begin $error("pop %0d: expected %0d, got %0d", i, 10 + i, dout); bad = bad + 1; end
      pop = 1; #10;
    end
    pop = 0; #10;
    if (!empty) begin $error("FIFO should be empty now"); bad = bad + 1; end
    if (bad == 0) $display("PASS"); else $display("FAIL %0d errors", bad);
    $finish;
  end
endmodule
`;
// Built-in designs for the Examples tab. top/tb/opts are what Load sets in Properties.
const t8 = PROBLEMS.find((x) => x.id === "squeeze-tiny8");
export const EXAMPLES = [
  { id: "shreg4", name: "shreg4", desc: "A 4-bit shift register with an active-low reset. Smallest design, good for a first run.", top: "shreg4", tb: "tb_shreg4.v", files: { "shreg4.v": SHREG, "tb_shreg4.v": TB_SHREG } },
  { id: "counter", name: "counter", desc: "A 4-bit counter with enable and reset.", top: "counter", tb: "tb_counter.v", files: { "counter.v": COUNTER, "tb_counter.v": TB } },
  { id: "fifo-verify", name: "fifo (verify)", desc: "A 4-entry FIFO with checks. Open Verify: Formal proves 3 properties and covers one; Testbench passes.", top: "fifo4", tb: "tb_fifo.v", opts: { vMode: "formal" }, files: { "fifo4.sv": fifo(false), "tb_fifo.v": TB_FIFO() } },
  { id: "fifo-bug", name: "fifo (bug)", desc: "The same FIFO with a bug (pushes accepted when full). Verify finds it: Formal shows the failing cycle, Testbench fails.", top: "fifo4", tb: "tb_fifo.v", opts: { vMode: "formal" }, files: { "fifo4.sv": fifo(true), "tb_fifo.v": TB_FIFO() } },
  { id: "squeeze-tiny8", name: "tiny8", desc: "A tiny 8-bit processor, the starting point of the Squeeze tiny8 problem. No testbench.", top: "tiny8", tb: "", files: { "tiny8.v": t8?.files["tiny8.v"] || "// tiny8 missing\n" },
    opts: { clockPeriod: 24, dieW: 250, dieH: 250, density: 50, pdEngine: "browser" } },
];
const ok = (p) => /\.(v|sv|vh|svh)$/i.test(p);
export function createProject() {
  let p;
  try { p = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!p || !p.files) p = { name: "untitled", files: {} };   // first visit: no files; the Examples button loads one
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };
  return {
    get name() { return p.name; }, set name(v) { p.name = v; save(); },
    list: () => Object.keys(p.files).sort(),
    get: (n) => p.files[n],
    set(n, text) { p.files[n] = text; save(); },
    add(n, text = "") { if (!ok(n)) throw new Error("use .v .sv .vh or .svh"); if (n in p.files) throw new Error("already exists"); p.files[n] = text; save(); },
    rename(a, b) { if (!ok(b)) throw new Error("use .v .sv .vh or .svh"); if (b in p.files) throw new Error("already exists"); p.files[b] = p.files[a]; delete p.files[a]; save(); },
    replace(files, name) { p = { name, files: { ...files } }; save(); },
    remove(n) { delete p.files[n]; save(); },
    all: () => ({ ...p.files }),
    isTb: (n) => /(^|\/)(tb_|test)|_tb\.|_tb$/i.test(n),
  };
}
