// One-off: real tiny8 layout (studio/demo/final/gds/tiny8.gds) -> media/tiny8-stack.json, a few rectangles per layer for the landing 3D stack.
// Run: node make-layer-stack.mjs [--survey]
import { parseGds, topCells, flatten } from "../studio/viewers/gds-parser.js";
import fs from "fs";
const lib = parseGds(fs.readFileSync(new URL("../studio/demo/final/gds/tiny8.gds", import.meta.url)));
const f = flatten(lib, topCells(lib)[0], 99);
if (process.argv[2] === "--survey") { for (const [k, o] of f.layers) console.log(k, o.n); console.log(f.bbox); process.exit(); }
// gf180mcuD GDS layers (layer/datatype): active 22/0, poly 30/0, metal1..5 34,36,42,46,81 /0
const WANT = [["Cells (active area)", "22/0"], ["Metal1", "34/0"], ["Metal2", "36/0"], ["Metal3", "42/0"], ["Metal4", "46/0"], ["Metal5", "81/0"]];
const [x0, y0, x1, y1] = f.bbox, S = 1000 / Math.max(x1 - x0, y1 - y0), cell = 2; // output grid: longest side = 1000 units
const out = { w: Math.round((x1 - x0) * S), h: Math.round((y1 - y0) * S), layers: [] };
for (const [name, key] of WANT) {
  const o = f.layers.get(key); if (!o) continue;
  const grid = new Set(), rects = [];
  for (let i = 0; i < o.n; i++) { // snap each shape's bounding box to the grid, drop duplicates; every shape here is a rectangle or close to one
    const a = Math.floor((o.bb[4 * i] - x0) * S / cell), b = Math.floor((o.bb[4 * i + 1] - y0) * S / cell), c = Math.max(a + 1, Math.ceil((o.bb[4 * i + 2] - x0) * S / cell)), d = Math.max(b + 1, Math.ceil((o.bb[4 * i + 3] - y0) * S / cell));
    const k = a + "," + b + "," + c + "," + d; if (grid.has(k)) continue; grid.add(k); rects.push([a, b, c - a, d - b]);
  }
  out.layers.push({ name, key, total: o.n, rects: rects.flat() });
}
out.cell = cell;
fs.writeFileSync(new URL("media/tiny8-stack.json", import.meta.url), JSON.stringify(out));
for (const l of out.layers) console.log(l.name, l.total, "->", l.rects.length / 4);
