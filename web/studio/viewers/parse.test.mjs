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
assert(sta[0].required > sta[0].arrival && sta[0].rows.some((r) => r.fanout != null));
const hold = parseSta(demo("55-openroad-stapostpnr/max_ss_125C_4v50/min.rpt"));
assert(hold.length > 0);
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
  console.log("src parser ok");
}
