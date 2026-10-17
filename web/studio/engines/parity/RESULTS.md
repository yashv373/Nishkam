# Parity check: Studio in-browser flow vs real LibreLane (2026-10-17)

Same RTL, gf180mcuD, 24 ns clock, CTS buffers clkbuf_8/4/2. Browser side: `parity/browser.mjs` (node). LibreLane side: `parity/librelane.mjs` (container `gf180`, one job at a time).
LibreLane inserts input/output buffers, repair buffers, tap and endcap cells; our flow does not. So LibreLane needs a bigger die for the same RTL. Dies below are therefore NOT the same (the same die fails in LibreLane, see Stress tests).

## Results

| | tiny8 browser | tiny8 LibreLane | mult8 browser | mult8 LibreLane | adder2 browser | adder2 LibreLane |
|---|---|---|---|---|---|---|
| Die (um) | 103.6x101.9 | 150x150 | 96.9x90.2 | 150x150 | 47x39 | 100x100 |
| Std cells | 263 | 510 (incl. 56 repair bufs, 98 taps, 9 clk bufs) | 317 | 515 | 43 | 150 |
| Cell area um2 | 8605 | 11294 | 6744 | 8528 | 812 | 2301 |
| Utilisation | 81% | 71% | 77% | 53% | 44% | 40% |
| Setup WNS / TNS ns | 13.0 / 0 | 9.8 / 0 | n/a (no clock) | 7.1 / 0 | n/a | n/a |
| Hold WNS / TNS ns | 0.96 / 0 | 0.66 / 0 | n/a | 10.0 / 0 | n/a | n/a |
| Clock skew ns | 0.01 | 0.26 | n/a | n/a | n/a | n/a |
| CTS buffers | 6 | 9 | 0 | 0 | 0 | 0 |
| Wirelength um | 11572 | 13475 | 7448 | 8676 | 834 | 1822 |
| Vias | 2412 | 2346 | 2335 | 2059 | 345 | 372 |
| DRC | 197 tiles | 0 | 118 tiles | 0 | 18 tiles | 0 |
| LVS | match | 0 errors | match | 0 errors | match | 0 errors |
| Power uW | 4070 | 6787 | n/a | 4557 | n/a | 486 |

Verdicts
- tiny8: close on timing sign (both meet, hold ok), vias (-3%). Differs: cell count/area (+78%/+31% in LibreLane, different flow: buffers, taps), skew (0.01 vs 0.26: different CTS settings/tool model), CTS buffers (6 vs 9), power (+67%, different flow: extra cells and different activity assumptions), wirelength (+16%, bigger die, different router), DRC (our bug, below).
- mult8: logic cells close; LibreLane adds 52 repair buffers. Wirelength +16%, vias -12% (different router). DRC differs (our bug).
- adder2: same story: 43 logic cells in ours vs 43 multi-input cells in LibreLane (match); extra 33 repair buffers + taps are the flow difference.
- Setup/hold: LibreLane's numbers include repair buffers and a different parasitic estimate, so they differ by up to 30%; both pass. Not a bug.

## DRC (our bug)
Our Magic DRC on the qrouter result reports Metal1/2/3 spacing errors (M1.2a, M2.2a, M3.2a) on every design; none are inside library cells. LibreLane (TritonRoute + Magic) reports 0. So the browser router output is not DRC clean. See issue.

## Stress tests
- Determinism: tiny8, 5 runs: identical placement and route hash every time (`7366f5d3` / `f82a3cb3`). PASS.
- Tiny die: adder2 at the browser die (47x39) fails in LibreLane (PDN strap does not fit); the browser flow routes it. LibreLane at 60x60/50% failed detailed placement (DPL-0036). Different tool limits, not a browser bug.
- High utilisation: LibreLane at the browser's tiny8 and mult8 dies stops with GPL-0301 (utilisation 145%). Our 81%/77% is only possible because we leave out buffers and taps. Studio users may see a design "fit" that would not fit in LibreLane.
- Larger design: rmult20 (2595 cells, 244x243 um): browser flow 443 s, setup WNS 0.12 ns, 0 failed nets, DRC 1272 tiles, LVS reports MISMATCH even though device and net counts match (17885/17885, 9067/9067). Not run in LibreLane (time).

## Issues
- #12 (LVS missing devices on tiny8): does NOT reproduce. tiny8 LVS matches (3100/3100 devices). DRC tiles remain (separate issue).
- #15 (route failure, many pins): not reproduced; pins40 and rmult20 report 0 failed nets.
- #18 (unused input pad takes another net): REPRODUCES. pins40 LVS = false (20/20 devices and nets, pin mismatch).

---

# Design verification stage: plan (research only)

"xezim": I found nothing under that spelling (searches return no project). Owner to give the right spelling or link. Not covered below.

Where it fits: add a stage in `web/studio/stages.js` (group 1, next to `sim`), engine file `engines/<tool>.js` + `*.worker.js` writing a VCD/FST file the existing Surfer tab already reads (same as Icarus).

| Tool | Licence | WASM? | Size | Where | Notes |
|---|---|---|---|---|---|
| Verilator + UVM | LGPL-3 / Artistic-2; UVM Apache-2 | Lint already built (verilator-wasm). A full run needs C++ compile + link in the browser (clang in WASM) | big (tens of MB, clang) | Browser possible but heavy; runner is easy | Upstream UVM 2017-1.0 elaborates without patches (Oct 2025 report); UVM 2020 compiles; runtime gaps remain on real code, and 4-state logic is still being added. Antmicro reports a client-side playground with UVM; I found no technical write-up (unconfirmed). |
| cocotb | BSD-3 | Pyodide runs cocotb itself, but it needs a simulator VPI. Icarus VPI in WASM is hard; Yosys/Verilator-less path: write a small Python-callable bridge to our Icarus WASM | Pyodide ~10 MB + libs | Runner: easy. Browser: hard | Learners like Python tests. |
| SymbiYosys formal | ISC (SBY), Yosys ISC; solvers (boolector, z3, yices) MIT/BSD | Yosys already in browser (we use `sat`). SBY is Python + solvers; Z3 has a WASM build, yices/boolector would need porting | ~10 MB with z3-wasm | Browser medium; runner easy | Reuses our grader approach; good for assert/assume/cover. |
| SVA assertions | n/a | Yosys reads basic immediate/concurrent asserts (with slang plugin more); Verilator supports many concurrent assertions | 0 extra | Browser | Best delivered through SymbiYosys and through Icarus-compatible immediate asserts. |
| Functional testbench + waveform | n/a | Already done (Icarus + Surfer) | 0 | Browser | Gaps: no self-checking template/pass-fail panel, no FST. |

Ranking (learner value / effort):
1. Formal with SymbiYosys + SVA asserts: highest value (assertion thinking, counterexample waveform), lowest new engineering because Yosys is already in the page and the grader shows a counterexample VCD. Start with Yosys `sat`/bounded-check wrapper (no SBY), then add z3-wasm if needed.
2. Self-checking testbench stage on Icarus (pass/fail panel, assertion-style `$error`, FST/VCD to Surfer): zero new binaries, quick.
3. cocotb on the runner (browser later).
4. Verilator + UVM on the runner (browser later when the upstream work and clang-wasm mature).

First two to build: (1) formal/assertion stage on Yosys, (2) self-checking testbench stage on Icarus.
