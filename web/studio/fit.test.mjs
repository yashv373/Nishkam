// node web/studio/fit.test.mjs  -- the fit check must reproduce the measured LibreLane runs (gf180mcuD, logs in nishkam_jobs).
import { estimate, coreOf, netlistFacts, check } from "./fit.js";
let bad = 0;
const near = (name, got, want, tol) => { const ok = Math.abs(got - want) <= tol; if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", name, +got.toFixed(3), "want", want, "+-", tol); };
// core area from the die (GPL-0016 "Core area"): 100 -> 5747.0, 120 -> 9175.9, 150 -> 16003.0, 170 -> 21436.1
for (const [d, a] of [[100, 5747.0], [120, 9175.9], [150, 16003.0], [170, 21436.1]]) near(`core ${d}`, coreOf(d, d).area, a, a * 0.012);
// tap cells (GPL fixed instances): 100 -> 38, 120 -> 60, 150 -> 98, 170 -> 131
for (const [d, n] of [[100, 38], [120, 60], [150, 98], [170, 131]]) near(`taps ${d}`, estimate({ logic: 1, ports: 0, dieW: d, dieH: d }).taps, n, n * 0.08);
// tiny8 (logic 8155.168, 34 ports, clocked): GPL-0301 at 120x120 was 100.44%; final utilisation at 150x150 was 70.58%
near("tiny8 120 GPL util", estimate({ logic: 8155.168, ports: 34, clocked: true, dieW: 120, dieH: 120 }).gpl, 1.0044, 0.03);
near("tiny8 150 final util", estimate({ logic: 8155.168, ports: 34, clocked: true, dieW: 150, dieH: 150 }).util, 0.7058, 0.03);
near("tiny8 150 GPL util", estimate({ logic: 8155.168, ports: 34, clocked: true, dieW: 150, dieH: 150 }).gpl, 0.57483, 0.03);
near("mult8 150 final util", estimate({ logic: 6394.95, ports: 32, dieW: 150, dieH: 150 }).util, 0.5329, 0.05);   // repair share used is the worst case, so a little high
near("adder2 100 final util", estimate({ logic: 825.395 - 0, ports: 33, dieW: 100, dieH: 100 }).util, 0.4003, 0.04);
// the issue's case: tiny8 at the browser die 103.6 x 101.9 must be flagged (LibreLane: GPL-0301, 145%)
const iss = estimate({ logic: 8155.168, ports: 34, clocked: true, dieW: 103.6, dieH: 101.92 });
near("tiny8 browser die GPL util", iss.gpl, 1.45, 0.08); if (!iss.fail) { bad++; console.log("FAIL not flagged"); }
// netlist reader
const nf = netlistFacts("module m(a, b, y);\n input [7:0] a;\n input b;\n output y;\n gf180mcu_fd_sc_mcu7t5v0__nand2_1 u1 (.A1(a[0]));\n gf180mcu_fd_sc_mcu7t5v0__dffq_1 u2 (.D(b));\nendmodule",
  "MACRO gf180mcu_fd_sc_mcu7t5v0__nand2_1\n SIZE 3.36 BY 3.92 ;\nEND x\nMACRO gf180mcu_fd_sc_mcu7t5v0__dffq_1\n SIZE 16.8 BY 3.92 ;\n");
near("netlist ports", nf.ports, 10, 0); near("netlist area", nf.logic, (3.36 + 16.8) * 3.92, 0.01); if (!nf.clocked) { bad++; console.log("FAIL clocked"); }
if (!check("module m(a);\n input a;\n gf180mcu_fd_sc_mcu7t5v0__nand2_1 u1 ();\nendmodule", "MACRO gf180mcu_fd_sc_mcu7t5v0__nand2_1\n SIZE 3.36 BY 3.92 ;", 60, 60).lines.length) bad++;
process.exit(bad ? 1 : 0);
