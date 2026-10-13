// GDS worker: load(buffer) once, then flat(top, depth) on demand. Parsed library stays here.
import { parseGds, topCells, hierDepth, flatten } from "./gds-parser.js";
let lib = null;
onmessage = (e) => {
  const { id, type } = e.data;
  try {
    if (type === "load") {
      lib = parseGds(e.data.buf);
      const tops = topCells(lib), cells = [...lib.structs.keys()];
      postMessage({ id, tops, cells, depths: Object.fromEntries(cells.map((c) => [c, hierDepth(lib, c)])), dbuPerUm: lib.dbuPerUm });
    } else {
      const r = flatten(lib, e.data.top, e.data.depth), tr = [r.boxes.buffer];
      for (const l of r.layers.values()) tr.push(l.off.buffer, l.xy.buffer, l.bb.buffer);
      postMessage({ id, r }, tr);
    }
  } catch (err) { postMessage({ id, error: String(err.message || err) }); }
};
