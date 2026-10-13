// node web/studio/viewers/gds.test.mjs  -- parses the demo GDS, checks basic invariants
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert";
import { parseGds, topCells, hierDepth, flatten, cellBox } from "./gds-parser.js";
const dir = new URL("../demo/final/gds/", import.meta.url);
for (const f of readdirSync(dir).filter((n) => n.endsWith(".gds"))) {
  const t0 = performance.now(), lib = parseGds(readFileSync(new URL(f, dir)));
  const t1 = performance.now(), tops = topCells(lib), top = tops[0], depth = hierDepth(lib, top);
  const full = flatten(lib, top, depth), t2 = performance.now(), shallow = flatten(lib, top, 0);
  const nb = [...lib.structs.values()].reduce((a, s) => a + s.polys.length, 0);
  console.log(f, { structs: lib.structs.size, tops, depth, dbuPerUm: lib.dbuPerUm, boundariesRaw: nb, flatPolys: full.nPoly, bbox: full.bbox.map((x) => +x.toFixed(2)),
    layers: full.layers.size, shallowBoxes: shallow.boxes.length / 4, parseMs: +(t1 - t0).toFixed(1), flattenMs: +(t2 - t1).toFixed(1) });
  assert(lib.structs.size > 1 && tops.length >= 1 && full.nPoly > 100 && lib.dbuPerUm > 0);
  const cb = cellBox(lib, top).map((x) => x / lib.dbuPerUm); // flat bbox == cell bbox
  full.bbox.forEach((x, i) => assert(Math.abs(x - cb[i]) < 0.01, "bbox mismatch " + i));
  assert(shallow.boxes.length > 0);
}
console.log("ok");
