// node web/studio/engines/cts.selftest.mjs [--no-place]
// (1) Tsay 1993 Fig. 7 example, (2) the paper's own formulas on a Chao-style case, (3) sr8/sr16 placements from the in-browser flow.
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";
import { merge, buildTree, msDist, clockSinks, libPinCap, defFragment, M3 } from "./cts.js";
process.on("unhandledRejection", () => {}); // Asyncify rethrows ExitStatus after exit(); harmless
let fail = 0;
const t = (name, ok, extra = "") => { console.log(ok ? "PASS" : "FAIL", name, extra); fail += !ok; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// (1) Tsay example [TSAY IV, Fig 7]: alpha=0.1 beta=0.2; A(8,0) 16, B(22,6) 10, C(0,10) 1, D(5,15) 2; pairs (A,B), (C,D).
{
  const al = 0.1, be = 0.2, S = [{ x: 8, y: 0, c: 16 }, { x: 22, y: 6, c: 10 }, { x: 0, y: 10, c: 1 }, { x: 5, y: 15, c: 2 }];
  const ab = merge(0, 16, 0, 10, 20, al, be), cd = merge(0, 1, 0, 2, 10, al, be);
  t("Tsay: x(A-B)=0.4 -> tap 8 from A", near(ab.ea, 8, 1e-12) && near(ab.eb, 12, 1e-12), `ea=${ab.ea}`);
  t("Tsay: delay at E = 13.44, C = 30", near(ab.t, 13.44, 1e-9) && near(ab.C, 30, 1e-9), `t=${ab.t} C=${ab.C}`);
  t("Tsay: C-D tap 6 from C", near(cd.ea, 6, 1e-12), `ea=${cd.ea}`);
  const tree = buildTree(S, { alpha: al, beta: be, topology: [[0, 1], [2, 3]] });
  const [E, F] = [tree.nodes[2], tree.nodes[5]];
  const onMs = (n, p) => near(n.ms[0] <= p.x + p.y && p.x + p.y <= n.ms[1] ? 0 : 1, 0, 0) && n.ms[2] <= p.x - p.y && p.x - p.y <= n.ms[3];
  t("Tsay: paper taps E(10,6), F(5,11) lie on our merging segments", onMs(E, { x: 10, y: 6 }) && onMs(F, { x: 5, y: 11 }));
  // The paper merges the TAP POINTS E,F (distance 10), not the segments; use that distance in the same merge formula.
  const ef = merge(ab.t, ab.C, cd.t, cd.C, 10, al, be);
  const len = ef.ea + ef.eb;
  t("Tsay: E-F merge elongates to 18.28 (x<0, snake 8.28)", near(len, 18.28, 0.005) && ef.ea === 0 && near(len - 10, 8.28, 0.005), `length ${len.toFixed(4)}`);
  t("Tsay: full tree (segment-to-segment) has zero skew", tree.skew < 1e-9, `skew ${tree.skew.toExponential(2)}, wirelength ${tree.wirelength.toFixed(3)}, merge distance of ms(AB),ms(CD) = ${msDist(E.ms, F.ms)}`);
}
// (2) Chao Table I is NOT reproducible: the note records only the delay values of trees T and T' (50, 64.0, ...), not their sinks
// or topology. Instead check the paper's closed forms against brute force: for random cases the merge makes both sides equal [CHAO eq 1].
{
  let worst = 0, snake = 0, n = 2000;
  for (let i = 0; i < n; i++) {
    const r = Math.random, a = 1, b = 1, t1 = r() * 50, t2 = r() * 50, C1 = r() * 20, C2 = r() * 20, k = r() * 30, m = merge(t1, C1, t2, C2, k, a, b);
    const l = (e, C) => a * e * (b * e / 2 + C);
    worst = Math.max(worst, Math.abs(t1 + l(m.ea, C1) - (t2 + l(m.eb, C2))));
    snake += m.ea + m.eb > k + 1e-12;
    if (m.ea + m.eb < k - 1e-9) worst = Infinity;
  }
  t("Chao eq (1): both sides equal for random merges (Table I not in note: skipped)", worst < 1e-9, `max error ${worst.toExponential(1)}, ${snake}/${n} snaked`);
}
// (3) sr8 / sr16 placements
if (!process.argv.includes("--no-place")) {
  const P = await import("./place.worker.js");
  const root = new URL("../../vendor/gf180mcu/", import.meta.url);
  const lef = fs.readFileSync(new URL("pd-7b70722/gf180mcu_fd_sc_mcu7t5v0.lef", root), "utf8");
  const lib = zlib.gunzipSync(fs.readFileSync(new URL("lib-tt5v0-full/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.lib.gz", root))).toString();
  for (const bits of [8, 16]) {
    const top = `sr${bits}`, q = (i) => (i === bits - 1 ? "dout" : `q${i}`);
    const nl = `module ${top}(clk, rst_n, din, dout);\n  input clk; input rst_n; input din; output dout;\n` +
      Array.from({ length: bits - 1 }, (_, i) => `  wire q${i};`).join("\n") + "\n" +
      Array.from({ length: bits }, (_, i) => `  gf180mcu_fd_sc_mcu7t5v0__dffrnq_1 f${i} (.CLK(clk), .D(${i ? q(i - 1) : "din"}), .Q(${q(i)}), .RN(rst_n));`).join("\n") + "\nendmodule\n";
    const pl = await P.handle({ files: { [`${top}.v`]: nl }, options: { top } }, { log() {}, progress() {} });
    const def = new TextDecoder().decode(pl.files[`${top}.def`]);
    fs.writeFileSync(`${os.tmpdir()}/${top}.def`, def);
    const { sinks, dbu } = clockSinks(def, lef, "clk", (cell, pin) => libPinCap(lib, `${cell}`, pin));
    const tree = buildTree(sinks);
    t(`${top}: ${sinks.length} sinks, zero skew (Elmore)`, sinks.length === bits && tree.skew < 1e-9 * Math.max(1, tree.maxDelay),
      `skew ${tree.skew.toExponential(2)} ps, max delay ${tree.maxDelay.toFixed(4)} ps, wirelength ${tree.wirelength.toFixed(2)} um (snaking ${tree.snakeLength.toFixed(2)}), sink cap ${sinks[0].c} pF`);
    const bad = tree.nodes.filter(n => n.snake < -1e-6).length;
    t(`${top}: every edge length >= Manhattan distance of its endpoints`, bad === 0, `${bad} violations`);
    fs.writeFileSync(`${os.tmpdir()}/${top}.cts.def`, defFragment(tree, "clk", "Metal3", dbu));
  }
}
process.exit(fail ? 1 : 0);
