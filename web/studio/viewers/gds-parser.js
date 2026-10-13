// GDSII stream parser + hierarchy flattener. Pure JS, no DOM: used by gds.worker.js, gds.js (fallback) and gds.test.mjs.
const T = { UNITS: 3, BGNSTR: 5, STRNAME: 6, ENDSTR: 7, BOUNDARY: 8, PATH: 9, SREF: 10, AREF: 11, TEXT: 12, LAYER: 13, DATATYPE: 14, WIDTH: 15,
  XY: 16, ENDEL: 17, SNAME: 18, COLROW: 19, PATHTYPE: 33, STRANS: 26, MAG: 27, ANGLE: 28, BOX: 45, BOXTYPE: 46 };

function real8(v, o) { // excess-64 base-16 float
  const hi = v.getUint32(o), lo = v.getUint32(o + 4);
  if (!hi && !lo) return 0;
  return (hi >>> 31 ? -1 : 1) * ((hi & 0xffffff) * 4294967296 + lo) / 2 ** 56 * 16 ** (((hi >>> 24) & 0x7f) - 64);
}

// -> { dbuPerUm, structs: Map<name, {name, polys:[{l,d,xy:number[]}], refs:[...], texts}> }
export function parseGds(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const structs = new Map();
  let dbuPerUm = 1000, cur = null, el = null, p = 0;
  const str = (d, n) => { let s = ""; for (let i = 0; i < n && u8[d + i]; i++) s += String.fromCharCode(u8[d + i]); return s; };
  while (p + 4 <= u8.length) {
    const len = v.getUint16(p), type = u8[p + 2], d = p + 4, n = len - 4;
    if (len < 4) break; // corrupt stream
    switch (type) {
      case T.UNITS: { const m = real8(v, d + 8); if (m > 0) dbuPerUm = 1e-6 / m; break; } // metres per database unit
      case T.BGNSTR: cur = { name: "", polys: [], refs: [], texts: 0 }; break;
      case T.STRNAME: cur.name = str(d, n); structs.set(cur.name, cur); break;
      case T.ENDSTR: cur = null; break;
      case T.BOUNDARY: case T.BOX: el = { k: "b", l: 0, d: 0 }; break;
      case T.PATH: el = { k: "p", l: 0, d: 0, w: 0, pt: 0 }; break;
      case T.SREF: el = { k: "s", refl: false, mag: 1, ang: 0 }; break;
      case T.AREF: el = { k: "a", refl: false, mag: 1, ang: 0, cols: 1, rows: 1 }; break;
      case T.TEXT: el = { k: "t" }; break;
      case T.LAYER: if (el) el.l = v.getInt16(d); break;
      case T.DATATYPE: case T.BOXTYPE: if (el) el.d = v.getInt16(d); break;
      case T.WIDTH: if (el) el.w = v.getInt32(d); break;
      case T.PATHTYPE: if (el) el.pt = v.getInt16(d); break;
      case T.SNAME: if (el) el.name = str(d, n); break;
      case T.COLROW: if (el) { el.cols = v.getInt16(d); el.rows = v.getInt16(d + 2); } break;
      case T.STRANS: if (el) el.refl = !!(v.getUint16(d) & 0x8000); break;
      case T.MAG: if (el) el.mag = real8(v, d); break;
      case T.ANGLE: if (el) el.ang = real8(v, d); break;
      case T.XY: if (el) { const xy = new Array(n >> 2); for (let i = 0; i < xy.length; i++) xy[i] = v.getInt32(d + 4 * i); el.xy = xy; } break;
      case T.ENDEL:
        if (el && cur && el.xy) {
          if (el.k === "b") cur.polys.push({ l: el.l, d: el.d, xy: el.xy });
          else if (el.k === "p") for (const q of pathQuads(el)) cur.polys.push({ l: el.l, d: el.d, xy: q });
          else if (el.k === "s") cur.refs.push({ name: el.name, x: el.xy[0], y: el.xy[1], refl: el.refl, mag: el.mag, ang: el.ang, cols: 1, rows: 1 });
          else if (el.k === "a" && el.xy.length >= 6) {
            const [x, y, cx, cy, rx, ry] = el.xy, c = el.cols || 1, r = el.rows || 1;
            cur.refs.push({ name: el.name, x, y, refl: el.refl, mag: el.mag, ang: el.ang, cols: c, rows: r, ax: (cx - x) / c, ay: (cy - y) / c, bx: (rx - x) / r, by: (ry - y) / r });
          }
        } else if (el && el.k === "t" && cur) cur.texts++;
        el = null; break;
    }
    p += len;
  }
  return { dbuPerUm, structs };
}

// Path -> one quad per segment. pathtype 0 flat, 1 round (drawn flat), 2 half-width extension; inner joints get a w/2 overlap so corners fill.
// ponytail: no true mitre/round joins or custom (type 4) extensions; add if a PDK uses wide bent paths.
function pathQuads(e) {
  const xy = e.xy, w = Math.abs(e.w) / 2, out = [];
  if (!w) return out;
  const nseg = xy.length / 2 - 1;
  for (let i = 0; i < nseg; i++) {
    let x0 = xy[2 * i], y0 = xy[2 * i + 1], x1 = xy[2 * i + 2], y1 = xy[2 * i + 3];
    const L = Math.hypot(x1 - x0, y1 - y0); if (!L) continue;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L, ext = e.pt === 2 ? w : 0, jn = e.pt === 1 ? 0 : w;
    const a = i === 0 ? ext : jn, b = i === nseg - 1 ? ext : jn;
    x0 -= ux * a; y0 -= uy * a; x1 += ux * b; y1 += uy * b;
    const nx = -uy * w, ny = ux * w;
    out.push([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny].map(Math.round));
  }
  return out;
}

const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
function refM(r, i, j) { // mirror about x axis, then magnify, rotate, translate
  const t = r.ang * Math.PI / 180, c = Math.cos(t) * r.mag, s = Math.sin(t) * r.mag, f = r.refl ? -1 : 1;
  return [c, s, -s * f, c * f, r.x + (r.ax || 0) * i + (r.bx || 0) * j, r.y + (r.ay || 0) * i + (r.by || 0) * j];
}
const corners = (b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
function xbox(M, b) { // bbox of transformed box
  let a = 1e18, c = 1e18, d = -1e18, e = -1e18;
  for (const [x, y] of corners(b)) { const X = M[0] * x + M[2] * y + M[4], Y = M[1] * x + M[3] * y + M[5]; if (X < a) a = X; if (X > d) d = X; if (Y < c) c = Y; if (Y > e) e = Y; }
  return [a, c, d, e];
}

export function topCells(lib) {
  const used = new Set();
  for (const s of lib.structs.values()) for (const r of s.refs) used.add(r.name);
  return [...lib.structs.keys()].filter((n) => !used.has(n));
}

// cell bbox in its own dbu frame (memoised)
export function cellBox(lib, name, stack = new Set()) {
  const s = lib.structs.get(name); if (!s) return null;
  if (s.box !== undefined) return s.box;
  if (stack.has(name)) return null;
  stack.add(name);
  let B = null;
  const add = (b) => { B = B ? [Math.min(B[0], b[0]), Math.min(B[1], b[1]), Math.max(B[2], b[2]), Math.max(B[3], b[3])] : b; };
  for (const q of s.polys) { let a = 1e18, b = 1e18, c = -1e18, d = -1e18; for (let i = 0; i < q.xy.length; i += 2) { const x = q.xy[i], y = q.xy[i + 1]; if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; } add([a, b, c, d]); }
  for (const r of s.refs) {
    const cb = cellBox(lib, r.name, stack); if (!cb) continue;
    for (const i of new Set([0, r.cols - 1])) for (const j of new Set([0, r.rows - 1])) add(xbox(refM(r, i, j), cb)); // array extremes only
  }
  stack.delete(name);
  return (s.box = B);
}

export function hierDepth(lib, name, memo = new Map()) {
  if (memo.has(name)) return memo.get(name);
  memo.set(name, 0);
  let m = 0;
  for (const r of lib.structs.get(name)?.refs || []) m = Math.max(m, 1 + hierDepth(lib, r.name, memo));
  memo.set(name, m); return m;
}

// Flatten `top` to `depth` levels of instances; deeper instances become boxes (um).
// -> { layers: Map<"l/d", {n, off:Uint32Array, xy:Float32Array, bb:Float32Array}>, boxes:Float32Array, bbox:[x0,y0,x1,y1], nPoly }
export function flatten(lib, top, depth) {
  const k = 1 / lib.dbuPerUm, acc = new Map(), boxes = [];
  let nPoly = 0;
  const B = [1e18, 1e18, -1e18, -1e18];
  const grow = (a, b, c, d) => { if (a < B[0]) B[0] = a; if (b < B[1]) B[1] = b; if (c > B[2]) B[2] = c; if (d > B[3]) B[3] = d; };
  const place = (cell, M, dl) => {
    const s = lib.structs.get(cell); if (!s) return;
    for (const q of s.polys) {
      const key = q.l + "/" + q.d;
      let o = acc.get(key); if (!o) acc.set(key, (o = { off: [0], xy: [], bb: [] }));
      let a = 1e18, b = 1e18, c = -1e18, d = -1e18;
      for (let i = 0; i < q.xy.length; i += 2) {
        const x = (M[0] * q.xy[i] + M[2] * q.xy[i + 1] + M[4]) * k, y = (M[1] * q.xy[i] + M[3] * q.xy[i + 1] + M[5]) * k;
        o.xy.push(x, y);
        if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
      }
      o.bb.push(a, b, c, d); o.off.push(o.xy.length / 2); nPoly++; grow(a, b, c, d);
    }
    for (const r of s.refs) {
      const cb = cellBox(lib, r.name); if (!cb) continue;
      for (let i = 0; i < r.cols; i++) for (let j = 0; j < r.rows; j++) {
        const C = mul(M, refM(r, i, j));
        if (dl >= depth) { const [a, b, c, d] = xbox(C, cb).map((t) => t * k); boxes.push(a, b, c, d); grow(a, b, c, d); }
        else place(r.name, C, dl + 1);
      }
    }
  };
  place(top, [1, 0, 0, 1, 0, 0], 0);
  const layers = new Map();
  for (const [key, o] of acc) layers.set(key, { n: o.bb.length / 4, off: Uint32Array.from(o.off), xy: Float32Array.from(o.xy), bb: Float32Array.from(o.bb) });
  return { layers, boxes: Float32Array.from(boxes), bbox: B[0] > B[2] ? [0, 0, 1, 1] : B, nPoly };
}
