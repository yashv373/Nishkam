// node web/brand/make-hero-routes.mjs  -> brand/media/tiny8-routes.bin (+ .json header)
// Packs the routed tiny8 DEF into Int16 (0.01 um units, die-relative) for the landing hero.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseDef } from "../studio/viewers/def-parser.js";
const here = (p) => new URL(p, import.meta.url);
const d = parseDef(readFileSync(here("../studio/demo/44-openroad-detailedrouting/tiny8.def"), "utf8"));
const cells = JSON.parse(readFileSync(here("../studio/viewers/gf180-cells.json"), "utf8"));
const Q = 100, q = (v) => Math.round(v * Q);
const [x0, y0, x1, y1] = d.die;
const sx = 0.5 * (x0 + x1), sy = 0.5 * (y0 + y1);
const dist = (x, y) => Math.hypot(x - sx, y - sy);
// metal layers only (Metal1..5); drop wires on others
const L = (n) => { const m = /^Metal(\d)$/.exec(d.layers[n] || ""); return m ? +m[1] : 0; };
const segs = d.segs.filter((s) => L(s[0]) && !s[7]).map((s) => ({ l: L(s[0]), a: [s[1], s[2]], b: [s[3], s[4]], w: s[5], net: s[6] }));
const vias = d.vias.map((v) => ({ x: v[0], y: v[1], net: v[2] }));
const comps = d.comps.filter((c) => cells[c.m]).map((c) => ({ x: c.x, y: c.y, w: cells[c.m][0], h: cells[c.m][1], seq: /dff|lat/.test(c.m) }));
// sort wires so growth radiates from the die centre (stable draw order = time order)
segs.sort((p, r) => dist(...p.a) - dist(...r.a));
const buf = [];
const i16 = (arr) => buf.push(Int16Array.from(arr));
const out = { Q, die: [x0, y0, x1, y1], nSeg: segs.length, nVia: vias.length, nCell: comps.length };
// layout: segs [l,x1,y1,x2,y2,w]*n ; vias [x,y]*n ; cells [x,y,w,h,seq]*n
i16(segs.flatMap((s) => [s.l, q(s.a[0] - x0), q(s.a[1] - y0), q(s.b[0] - x0), q(s.b[1] - y0), q(s.w)]));
i16(vias.flatMap((v) => [q(v.x - x0), q(v.y - y0)]));
i16(comps.flatMap((c) => [q(c.x - x0), q(c.y - y0), q(c.w), q(c.h), c.seq ? 1 : 0]));
// rows (for the faint stage)
out.rows = d.rows.map((r) => [q(r[0] - x0), q(r[1] - y0), q(r[2] * r[4])]);
const all = Buffer.concat(buf.map((a) => Buffer.from(a.buffer)));
writeFileSync(here("./media/tiny8-routes.bin"), all);
writeFileSync(here("./media/tiny8-routes.json"), JSON.stringify(out));
console.log(out.nSeg, "segs", out.nVia, "vias", out.nCell, "cells; bin", all.length, "gz", gzipSync(all).length);
