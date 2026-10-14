// Tiny Tapeout Explorer (Apache-2.0, A. Mordvintsev) in a same-origin iframe, fed a blob: URL of the GDS.
// mount(el, { getBuffer: async()=>ArrayBuffer }) -> { destroy() }. Nothing is uploaded.
const VIEWER = new URL("../../vendor/tt-explorer/59a43fb/viewer.html", import.meta.url);

// The explorer's wasm refuses to draw anything when the top cell has no VDD/VSS text labels (Magic's in-browser
// GDS has none). If they are missing, add them to the top cell at the spot of the first placed standard cell's own
// VDD/VSS pin labels (same layer, position moved by that cell's placement), so the power rails are traced as usual.
// Returns { buf, patched }.
export function ensurePowerLabels(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  const cells = new Map(); let cur = null, el = null, top = null;
  const refd = new Set();
  for (let i = 0; i + 4 <= u8.length;) {
    const n = dv.getUint16(i); if (n < 4) break;
    const t = u8[i + 2], b = i + 4, str = () => dec.decode(u8.subarray(b, i + n)).replace(/\0+$/, "");
    if (t === 0x06) { cur = { name: str(), labels: [], refs: [], rects: [], end: -1 }; cells.set(cur.name, cur); }
    else if (t === 0x07 && cur) cur.end = i;
    else if (t === 0x0C) el = { k: "text" };
    else if (t === 0x0A) el = { k: "sref" };
    else if (t === 0x08) el = { k: "bnd" };
    else if (t === 0x11) { if (el && cur) (el.k === "text" ? (el.s && cur.labels.push(el)) : el.k === "bnd" ? (el.xy && cur.rects.push(el)) : (el.s && cur.refs.push(el))); el = null; }
    else if (el) {
      if (t === 0x0D) el.l = dv.getInt16(b);
      else if (t === 0x16) el.tt = dv.getInt16(b);
      else if (t === 0x10) { el.x = dv.getInt32(b); el.y = dv.getInt32(b + 4); el.xy = []; for (let k = b; k + 8 <= i + n; k += 8) el.xy.push([dv.getInt32(k), dv.getInt32(k + 4)]); }
      else if (t === 0x19) el.s = str();
      else if (t === 0x12) { el.s = str(); refd.add(el.s); }
      else if (t === 0x1A) el.flip = !!(dv.getUint16(b) & 0x8000);
      else if (t === 0x1C) el.ang = dv.getFloat64 ? (() => { let m = 0, e = u8[b] & 0x7f; for (let k = 1; k < 8; k++) m = m * 256 + u8[b + k]; return (u8[b] & 0x80 ? -1 : 1) * m / 2 ** 56 * 16 ** (e - 64); })() : 0;
    }
    i += n;
  }
  const tops = [...cells.values()].filter((c) => !refd.has(c.name) && c.end > 0); top = tops[tops.length - 1];
  if (!top) return { buf, patched: false };
  if (top.labels.some((l) => l.s === "VDD") && top.labels.some((l) => l.s === "VSS")) return { buf, patched: false };
  const want = {};
  for (const r of top.refs) {
    const c = cells.get(r.s); if (!c || want.VDD && want.VSS) continue;
    const pick = (nm) => c.labels.find((l) => l.s === nm);
    const d = pick("VDD"), v = pick("VSS"); if (!d || !v) continue;
    const a = ((r.ang || 0) % 360 + 360) % 360 * Math.PI / 180, co = Math.round(Math.cos(a)), si = Math.round(Math.sin(a));
    for (const [nm, l] of [["VDD", d], ["VSS", v]]) {
      const tf = (x, y) => { const y0 = r.flip ? -y : y; return [r.x + co * x - si * y0, r.y + si * x + co * y0]; };
      const [x, y] = tf(l.x, l.y);
      const rc = c.rects.find((q) => q.l === l.l && q.xy.length === 5 && Math.min(...q.xy.map((a) => a[0])) <= l.x && Math.max(...q.xy.map((a) => a[0])) >= l.x && Math.min(...q.xy.map((a) => a[1])) <= l.y && Math.max(...q.xy.map((a) => a[1])) >= l.y);
      want[nm] = { l: l.l, tt: l.tt ?? 10, x, y, poly: rc && rc.xy.map((a) => tf(a[0], a[1])) };
    }
  }
  if (!want.VDD || !want.VSS) return { buf, patched: false };
  const label = (s, w) => {
    const sb = new TextEncoder().encode(s), sl = (sb.length + 1) & ~1, o = new Uint8Array(4 + 6 + 6 + 12 + 4 + sl + 4), v = new DataView(o.buffer);
    let p = 0; const rec = (len, t, d) => { v.setUint16(p, len); v.setUint8(p + 2, t); v.setUint8(p + 3, d); p += 4; };
    rec(4, 0x0C, 0); rec(6, 0x0D, 2); v.setInt16(p, w.l); p += 2; rec(6, 0x16, 2); v.setInt16(p, w.tt); p += 2;
    rec(12, 0x10, 3); v.setInt32(p, w.x); v.setInt32(p + 4, w.y); p += 8; rec(4 + sl, 0x19, 6); o.set(sb, p); p += sl; rec(4, 0x11, 0);
    return o;
  };
  // The explorer only finds a label when a shape of the top cell lies under it, so repeat the cell rail as a top-level shape (same footprint, nothing new is drawn).
  const poly = (w) => { if (!w.poly) return new Uint8Array(0); const o = new Uint8Array(4 + 6 + 6 + 4 + 5 * 8 + 4), v = new DataView(o.buffer); let p = 0; const rec = (len, t, d) => { v.setUint16(p, len); v.setUint8(p + 2, t); v.setUint8(p + 3, d); p += 4; };
    rec(4, 0x08, 0); rec(6, 0x0D, 2); v.setInt16(p, w.l); p += 2; rec(6, 0x0E, 2); v.setInt16(p, 0); p += 2; rec(44, 0x10, 3); for (const [x, y] of w.poly) { v.setInt32(p, x); v.setInt32(p + 4, y); p += 8; } rec(4, 0x11, 0); return o; };
  const add = [poly(want.VDD), poly(want.VSS), label("VDD", want.VDD), label("VSS", want.VSS)], extra = add.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(u8.length + extra);
  out.set(u8.subarray(0, top.end), 0); let p = top.end; for (const a of add) { out.set(a, p); p += a.length; }
  out.set(u8.subarray(top.end), p);
  return { buf: out.buffer, patched: true };
}
export function mount(el, opts) {
  const fr = document.createElement("iframe");
  fr.style.cssText = "width:100%;height:100%;border:0;display:block";
  el.appendChild(fr);
  const css = "position:absolute;z-index:6;font:11px system-ui;background:rgba(7,8,12,.8);padding:3px 8px;border-radius:6px;";
  const hint = document.createElement("div"); hint.textContent = "Drag: rotate  |  Shift+drag: pan  |  Wheel: zoom";
  hint.style.cssText = css + "right:10px;bottom:10px;color:#9aa4b2;pointer-events:none";
  const fs = document.createElement("button"); fs.textContent = "Full screen"; fs.title = "Esc exits";
  fs.style.cssText = css + "right:10px;top:10px;color:#e8eaf2;border:1px solid rgba(255,255,255,.2);cursor:pointer";
  fs.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.());
  const note = document.createElement("div"); note.style.cssText = css + "left:10px;bottom:10px;color:#ffb020;pointer-events:none;display:none";
  note.textContent = "This GDS has no VDD/VSS labels in the top cell: labels were added from the first placed cell's power pins";
  el.append(hint, fs, note);
  let url, dead = false;
  opts.getBuffer().then((buf) => {
    if (dead) return;
    let r = { buf, patched: false };
    try { r = ensurePowerLabels(buf); } catch (e) { console.warn("power label patch failed", e); }
    note.style.display = r.patched ? "" : "none";
    url = URL.createObjectURL(new Blob([r.buf], { type: "application/octet-stream" }));
    const u = new URL(VIEWER); u.searchParams.set("file", url); u.searchParams.set("pdk", "gf180mcuD");
    fr.src = u;
  });
  return { destroy() { dead = true; fr.remove(); hint.remove(); fs.remove(); note.remove(); url && URL.revokeObjectURL(url); } };
}