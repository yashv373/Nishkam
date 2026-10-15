// node web/studio/viewers/parse.test.mjs  (checks DEF + STA parsers against the shipped demo run)
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { parseDef } from "./def-parser.js";
import { parseSta } from "./sta-parser.js";
const demo = (p) => readFileSync(new URL("../demo/" + p, import.meta.url), "utf8");
for (const f of ["13-openroad-floorplan", "34-openroad-detailedplacement", "35-openroad-cts", "44-openroad-detailedrouting"]) {
  const d = parseDef(demo(f + "/tiny8.def"));
  assert.deepStrictEqual(d.die, [0, 0, 170, 170]);
  assert(d.rows.length > 10, f);
  if (!f.includes("floorplan")) assert(d.comps.length > 50 && d.pins.length > 5, f + " placed"); // floorplan: cells not placed yet
  if (f.includes("routing")) assert(d.segs.length > 500 && d.vias.length > 100 && d.layers.length >= 3, f + " routing");
  if (f.includes("cts")) assert(d.nets.some((n) => n.clock), "clock net");
  console.log(f, d.comps.length, "cells", d.segs.length, "segs", d.vias.length, "vias");
}
const f = demo("final/metrics.json");
const sta = parseSta(demo("55-openroad-stapostpnr/max_ss_125C_4v50/max.rpt"));
assert(sta.length > 0 && sta[0].rows.length > 5 && sta[0].met, "setup path");
assert(Math.abs(sta[0].slack - JSON.parse(f)["timing__setup__ws__corner:max_ss_125C_4v50"]) < 1e-3, "slack matches metrics");
assert(sta.some((p) => p.kind === "async") && sta.some((p) => p.kind === "data"), "recovery paths tagged apart from data paths");
assert(sta[0].required > sta[0].arrival && sta[0].rows.some((r) => r.fanout != null));
const hold = parseSta(demo("55-openroad-stapostpnr/max_ss_125C_4v50/min.rpt"));
assert(hold.length > 0);
{
  const mk = (end, tail) => `Startpoint: a (input port clocked by clk)\nEndpoint: ${end}\nPath Group: clk\n\n  1.0 1.0 ^ x/Z (buf)\n  1.0 data arrival time\n${tail}  0.5 slack (MET)\n`;
  const d = parseSta(mk("err_recovery_reg (rising edge-triggered flip-flop clocked by clk)", "  9.0 data required time\n  -0.1 library setup time\n"));
  const a = parseSta(mk("r (recovery check against rising-edge clock clk)", "  -0.2 library recovery time\n"));
  assert.equal(d[0].kind, "data", "endpoint NAME containing recovery stays a data path"); assert.equal(a[0].kind, "async");
}
console.log("sta", sta.length, "setup paths,", hold.length, "hold; ok");
{
  const { parseSrc, srcCovers, cellSrcMap } = await import("../stages.js");
  assert.deepStrictEqual(parseSrc("a.v:12.3-14.5|b.v:3.1-3.9"), [{ file: "a.v", l1: 12, l2: 14 }, { file: "b.v", l1: 3, l2: 3 }]);
  assert.deepStrictEqual(parseSrc("a.v:5.1-9"), [{ file: "a.v", l1: 5, l2: 5 }]);
  assert.deepStrictEqual(parseSrc("C:\\x\\a.v:2.1-3.4"), [{ file: "C:\\x\\a.v", l1: 2, l2: 3 }]);
  for (const bad of [undefined, "", "garbage", "a.v:x.y-z"]) assert.deepStrictEqual(parseSrc(bad), []);
  assert.deepStrictEqual(parseSrc("junk|a.v:1.1-2.2"), [{ file: "a.v", l1: 1, l2: 2 }]);
  const g = parseSrc("a.v:12.3-14.5");
  assert(srcCovers(g, "a.v", 13) && !srcCovers(g, "a.v", 15) && !srcCovers(g, "b.v", 13) && !srcCovers([], "a.v", 1));
  const cm = cellSrcMap('{"modules":{"m":{"cells":{"c1":{"type":"$and","attributes":{"src":"a.v:3.1-3.5"}},"c2":{"type":"x"}}}}}');
  assert.equal(cm.get("c1").segs[0].l1, 3); assert.deepStrictEqual(cm.get("c2").segs, []); assert.equal(cellSrcMap("not json").size, 0);
  const J = { modules: {
    sub: { cells: { u0: { type: "$or", attributes: { src: "s.v:1.1-1.5" } } }, netnames: { x: { bits: [9], attributes: { src: "s.v:1.1-1.2" } } } },
    top: { attributes: { top: 1 }, cells: { u0: { type: "$and", parameters: { Y_WIDTH: "00000000000000000000000000000001" }, attributes: { src: "a.v:12.3-12.9" }, port_directions: { A: "input", Y: "output" }, connections: { A: [2], Y: [4] } } },
      netnames: { a: { bits: [2], attributes: { src: "a.v:2.1-2.9" } }, y: { bits: [4], attributes: { src: "a.v:3.1-3.9" } } } } } };
  const c2 = cellSrcMap(JSON.stringify(J));
  assert.equal(c2.get("u0").type, "$and"); assert.equal(c2.get("u0").width, 1); assert(!c2.nets.has("x"), "only the top module is indexed");
  assert.equal(cellSrcMap(JSON.stringify({ modules: { sub: J.modules.sub } })).get("u0").type, "$or", "no top attribute: first module");
  assert.deepStrictEqual(c2.nets.get("y").driver, [{ file: "a.v", l1: 12, l2: 12 }]);   // driven by the $and, not the declaration (line 3)
  assert.deepStrictEqual(c2.nets.get("y").segs[0].l1, 3); assert.deepStrictEqual(c2.nets.get("a").driver, []);   // input port: declaration only
  assert.deepStrictEqual(parseSrc("a.v:10.5"), [{ file: "a.v", l1: 10, l2: 10 }]);
  assert.deepStrictEqual(parseSrc("C:/x/a.v:4.1-5.2"), [{ file: "C:/x/a.v", l1: 4, l2: 5 }]);
  const { svgElOk, svgAttrOk, cssSafe } = await import("../stages.js");
  for (const e of ["script", "foreignObject", "a", "set", "animate", "use", "image", "iframe"]) assert(!svgElOk(e), e);
  for (const e of ["svg", "g", "path", "s:alias", "title"]) assert(svgElOk(e), e);
  for (const [a, v] of [["href", "x"], ["xlink:href", "x"], ["onclick", "x"], ["attributeName", "onclick"], ["values", "javascript:1"], ["style", "fill:url(http://e/x)"]]) assert(!svgAttrOk(a, v), a);
  assert(svgAttrOk("class", "net_1 width_1") && svgAttrOk("s:pid", "A") && svgAttrOk("style", "stroke-width: 1"));
  assert.equal(cssSafe("@import url(http://e/a.css); svg{fill:none}"), " svg{fill:none}");
  const cw = cellSrcMap('{"modules":{"m":{"cells":{"e":{"type":"$eq","parameters":{"A_WIDTH":"100","B_WIDTH":"100","Y_WIDTH":"1"}},"r":{"type":"$reduce_or","parameters":{"A_WIDTH":8,"Y_WIDTH":1}},"s":{"type":"$add","parameters":{"A_WIDTH":4,"Y_WIDTH":5}},"n":{"type":"$neg","parameters":{"A_WIDTH":4,"Y_WIDTH":4}}}}}}');
  assert.deepStrictEqual(["e", "r", "s", "n"].map((k) => cw.get(k).width), [4, 8, 5, 4]);
  const { netBits, alwaysRange } = await import("../stages.js");
  assert.deepStrictEqual(netBits("net_36,37,38 width_3"), ["36", "37", "38"]); assert.deepStrictEqual(netBits("net_3 width_1"), ["3"]);
  assert.deepStrictEqual(netBits("net_1_2"), ["1", "2"]); assert.deepStrictEqual(netBits("cell_a"), []); assert.deepStrictEqual(netBits(null), []);
  const V = "module m;\nalways @(*) begin\n  if (a) begin\n    y = 1;\n  end\n  case (s)\n  0: y = 2;\n  endcase\nend\nalways @(posedge c) q <= d;\nassign z = 1;\nendmodule";
  assert.deepStrictEqual(alwaysRange(V, 2), [2, 9]); assert.deepStrictEqual(alwaysRange(V, 10), [10, 10]);
  assert.equal(alwaysRange(V, 3), null); assert.equal(alwaysRange("", 1), null);
  const { wireInfo } = await import("../stages.js");
  const nn = new Map([["$t", { bits: [5, 6] }], ["w", { bits: [5, 6, 7] }], ["k", { bits: [9] }]]);
  assert.equal(wireInfo("net_5,6 width_2", nn).name, "w");   // prefers the non-$ name
  assert.equal(wireInfo("net_x,7 width_2", nn).name, "w"); assert.equal(wireInfo("net_6,40,41", nn).name, "w");
  assert.deepStrictEqual(wireInfo("net_226,227,228 width_3", nn), { unnamed: 3, bits: ["226", "227", "228"], constant: false });   // never empty
  assert.deepStrictEqual(wireInfo("net_x,x width_2", nn), { unnamed: 2, bits: [], constant: true }); assert.deepStrictEqual(wireInfo("net_1,0,300", nn), { unnamed: 3, bits: ["300"], constant: false });
  const { pathModel, pathToRtl, segsOverlap } = await import("../stages.js");
  const gj = JSON.stringify({ modules: { tiny8: { attributes: { top: 1 }, cells: {
    _330_: { type: "mux4", attributes: { src: "tiny8.v:40.3-44.9" }, connections: { S0: [11], Z: [12] } },
    _340_: { type: "oai31", attributes: {}, connections: { B: [12], ZN: [13] } },
    input15: { type: "dlyb", attributes: { src: "tiny8.v:5.1-5.9" }, connections: { I: [2], Z: [3] } } } } } });
  const pm = pathModel(sta[0], gj);
  assert(pm.insts.length > 5 && pm.insts.includes("_330_") && !pm.insts.includes("instr[8]"), "ports skipped, instances in path order");
  assert.equal(pm.insts[0], "input15"); assert.equal(pm.slack, sta[0].slack); assert.equal(pm.end, "_493_");
  assert.deepStrictEqual(pm.bits.sort(), ["11", "12", "13", "2", "3"], "net bits of the path pins found in the netlist");
  const pr = pathToRtl({ insts: ["_330_", "_340_", "nope"] }, cellSrcMap(gj));
  assert.equal(pr.noSrc, 2); assert.deepStrictEqual(pr.segs, [{ file: "tiny8.v", l1: 40, l2: 44 }]);
  assert(segsOverlap([{ file: "tiny8.v", l1: 43, l2: 43 }], pr.segs) && !segsOverlap([{ file: "tiny8.v", l1: 45, l2: 46 }], pr.segs) && !segsOverlap([{ file: "o.v", l1: 41, l2: 41 }], pr.segs));
  assert.deepStrictEqual(pathModel(sta[0], "bad json").bits, []);
  console.log("src parser ok");
}
