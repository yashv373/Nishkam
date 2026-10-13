export const files = {
  "counter.v": `module counter(input clk, input rst, output reg [3:0] q);
  always @(posedge clk) if (rst) q <= 4'd0; else q <= q + 4'd1;
endmodule
`,
  "tb.v": `module tb;
  reg clk = 0, rst = 1; wire [3:0] q;
  counter dut(.clk(clk), .rst(rst), .q(q));
  always #5 clk = ~clk;
  initial begin
    $dumpfile("dump.vcd"); $dumpvars(0, tb);
    #12 rst = 0;
    #100 $display("q=%d", q);
    $finish;
  end
endmodule
`,
};
export const rtl = { "counter.v": files["counter.v"] };

// Each check returns true/false; engines: {lint, verilator, sim, synth, schematic} are functions (files, options) -> result
export const checks = {
  lint: (r) => r.ok,
  verilator: (r) => r.ok,
  sim: (r) => r.ok && /q=\s*\d+/.test(r.summary.stdout) && Object.values(r.files).some((v) => v.includes("$enddefinitions")),
  synth: (r) => r.ok && r.summary.cells > 0 && r.summary.area > 0 && !!r.files["netlist.v"] && !!r.files["rtl.json"],
  schematic: (r) => r.ok && r.files["schematic.svg"].startsWith("<svg"),
};
