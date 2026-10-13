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
const ok = (p) => /\.(v|sv|vh|svh)$/i.test(p);
export function createProject() {
  let p;
  try { p = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!p || !p.files) {
    const t8 = PROBLEMS.find((x) => x.id === "squeeze-tiny8");
    p = { name: "shreg4", files: { "shreg4.v": SHREG, "tb_shreg4.v": TB_SHREG, "tiny8.v": t8?.files["tiny8.v"] || "// tiny8 missing\n", "counter.v": COUNTER, "tb_counter.v": TB } };
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };
  return {
    get name() { return p.name; }, set name(v) { p.name = v; save(); },
    list: () => Object.keys(p.files).sort(),
    get: (n) => p.files[n],
    set(n, text) { p.files[n] = text; save(); },
    add(n, text = "") { if (!ok(n)) throw new Error("use .v .sv .vh or .svh"); if (n in p.files) throw new Error("already exists"); p.files[n] = text; save(); },
    rename(a, b) { if (!ok(b)) throw new Error("use .v .sv .vh or .svh"); if (b in p.files) throw new Error("already exists"); p.files[b] = p.files[a]; delete p.files[a]; save(); },
    remove(n) { delete p.files[n]; save(); },
    all: () => ({ ...p.files }),
    isTb: (n) => /(^|\/)(tb_|test)|_tb\.|_tb$/i.test(n),
  };
}
