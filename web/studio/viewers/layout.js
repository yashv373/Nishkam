// DEF layout viewer (Canvas2D). mount(el, ctx) -> { update(ctx), destroy() }
import { parseDef } from "./def-parser.js";
import { flatten } from "./layout-data.js";

const METAL = ["#5b8cff", "#3ddc97", "#ffb020", "#c77dff", "#ff7a59", "#2ec4d6", "#e0e0e0"];
const BUCKET = 8; // um per picking-grid cell
let cellSizes = null;
const sizes = () => (cellSizes ||= fetch(new URL("gf180-cells.json", import.meta.url)).then((r) => r.json()).catch(() => ({})));

function stageLabel(p) {
  if (p.startsWith("final/")) return "Final";
  const m = /\d+-\w+-(\w+)\//.exec(p);
  if (!m) return p;
  const s = m[1];
  return /floorplan$/.test(s) ? "Floorplan" : /detailedplacement/.test(s) ? "Placement" : /^cts$/.test(s) ? "Clock tree"
    : /detailedrouting/.test(s) ? "Routing" : s;
}
const stageRank = (p) => (p.startsWith("final/") ? 1e6 : parseInt(p, 10) || 0);

function parseInWorker(text) {
  return new Promise((res, rej) => {
    let w;
    try { w = new Worker(new URL("./layout.worker.js", import.meta.url), { type: "module" }); }
    catch { return res(flatten(parseDef(text)).d); }
    w.onmessage = (e) => { w.terminate(); e.data.error ? rej(new Error(e.data.error)) : res(e.data.d); };
    w.onerror = () => { w.terminate(); res(flatten(parseDef(text)).d); }; // e.g. file:// pages
    w.postMessage(text);
  });
}

export function mount(el, ctx) {
  el.classList.add("vw-root");
  el.innerHTML = `
  <div class="vw-bar">
    <select class="vw-stage" title="Stage"></select>
    <input class="vw-net" placeholder="Highlight net..." spellcheck="false">
    <span class="vw-note"></span>
    <button class="vw-btn vw-fit">Fit</button>
  </div>
  <div class="vw-body">
    <div class="vw-side"></div>
    <div class="vw-canvas"><canvas></canvas><div class="vw-msg"></div></div>
  </div>
  <div class="vw-status"><span class="vw-xy">x -, y - um</span><span class="vw-info"></span></div>`;
  const $ = (s) => el.querySelector(s);
  const sel = $(".vw-stage"), netIn = $(".vw-net"), note = $(".vw-note"), side = $(".vw-side");
  const wrap = $(".vw-canvas"), cv = $("canvas"), g = cv.getContext("2d"), msg = $(".vw-msg");
  const xy = $(".vw-xy"), info = $(".vw-info");

  const show = { die: true, rows: false, cells: true, pins: true, power: false, vias: true, clock: true };
  const metalOn = {}; // layer name -> bool
  let d = null, cells = null, view = { s: 1, ox: 0, oy: 0 }, W = 0, H = 0, dirty = true, raf = 0;
  let files = "", curPath = "", loadId = 0, sel1 = null, hiNet = new Set(), gridC, gridS;
  let layerSegs = [], clockSinks = new Set(), compIdx = new Map();

  const redraw = () => { if (!dirty || !d) return; dirty = false; draw(); };
  const invalidate = () => { dirty = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); };

  // ---- sidebar
  function buildSide() {
    const rows = [["die", "Die / core"], ["rows", "Rows"], ["cells", "Std cells"], ["pins", "Pins"], ["power", "Power grid"], ["vias", "Vias"], ["clock", "Clock nets"]];
    side.innerHTML = rows.map(([k, l]) => `<label><input type="checkbox" data-k="${k}" ${show[k] ? "checked" : ""}>${l}</label>`).join("") +
      `<div class="vw-sep">Metals</div>` +
      (d ? d.layers.map((l, i) => `<label><i style="background:${METAL[i % METAL.length]}"></i><input type="checkbox" data-m="${l}" ${metalOn[l] ? "checked" : ""}>${l}</label>`).join("") : "");
  }
  side.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.k) show[t.dataset.k] = t.checked; else if (t.dataset.m) metalOn[t.dataset.m] = t.checked;
    invalidate();
  });

  // ---- stage list
  async function refreshStages(first) {
    const all = (await ctx.listFiles().catch(() => [])).filter((p) => /\.def$/.test(p)).sort((a, b) => stageRank(a) - stageRank(b));
    const key = all.join("|");
    if (key === files && !first) return;
    files = key;
    sel.innerHTML = all.map((p) => `<option value="${p}">${stageLabel(p)}</option>`).join("") || `<option value="">no DEF yet</option>`;
    if (!all.length) { d = null; showMsg("No layout yet. Run Floorplan (or load the demo) to see it here."); return; }
    const want = all.includes(curPath) ? curPath : all[all.length - 1];
    sel.value = want;
    if (want !== curPath || first) load(want);
  }
  sel.onchange = () => load(sel.value);

  function showMsg(t) { msg.textContent = t; msg.style.display = t ? "" : "none"; }

  async function load(path) {
    if (!path) return;
    curPath = path;
    const id = ++loadId;
    showMsg("Loading " + path + "...");
    try {
      const [raw, cs] = await Promise.all([ctx.getFile(path), sizes()]);
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const nd = await parseInWorker(text);
      if (id !== loadId) return;
      d = nd; cells = cs;
      prepare();
      showMsg("");
      fit();
    } catch (e) { showMsg("Could not read " + path + ": " + e.message); ctx.log?.("layout: " + e.message); }
  }

  function prepare() {
    for (const l of d.layers) if (!(l in metalOn)) metalOn[l] = true;
    // per-layer segment index lists (signal and power kept apart)
    layerSegs = d.layers.map(() => ({ sig: [], pow: [] }));
    const n = d.segs.length / 8;
    for (let i = 0; i < n; i++) layerSegs[d.segs[i * 8]][d.segs[i * 8 + 7] ? "pow" : "sig"].push(i);
    // cell boxes
    compIdx = new Map();
    const nc = d.comps.length;
    cells = cells || {};
    d.box = new Float32Array(nc * 4);
    d.comps.forEach((c, i) => {
      compIdx.set(c.n, i);
      let [w, h] = cells[c.m] || [3.92, 3.92];
      if (/^F?[EW]$/.test(c.o)) [w, h] = [h, w];
      d.box.set([c.x, c.y, c.x + w, c.y + h], i * 4);
    });
    clockSinks = new Set();
    for (const net of d.nets) if (net.clock && !net.special) for (const c of net.conns) clockSinks.add(c);
    // picking grids
    gridC = new Map(); gridS = new Map();
    const put = (m, x0, y0, x1, y1, id) => {
      for (let gx = Math.floor(x0 / BUCKET); gx <= Math.floor(x1 / BUCKET); gx++)
        for (let gy = Math.floor(y0 / BUCKET); gy <= Math.floor(y1 / BUCKET); gy++) {
          const k = gx * 100003 + gy; let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(id);
        }
    };
    for (let i = 0; i < nc; i++) put(gridC, d.box[i * 4], d.box[i * 4 + 1], d.box[i * 4 + 2], d.box[i * 4 + 3], i);
    for (let i = 0; i < n; i++) {
      const s = d.segs, o = i * 8;
      put(gridS, Math.min(s[o + 1], s[o + 3]), Math.min(s[o + 2], s[o + 4]), Math.max(s[o + 1], s[o + 3]), Math.max(s[o + 2], s[o + 4]), i);
    }
    sel1 = null; hiNet = new Set(); applyNetSearch();
    buildSide();
    info.textContent = `${d.comps.length} cells, ${d.nets.length} nets, ${n} wire segments`;
  }

  // ---- view
  function resize() {
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    W = Math.max(50, r.width); H = Math.max(50, r.height);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    invalidate();
  }
  const ro = new ResizeObserver(() => { resize(); if (d && !view.fitted) fit(); });
  ro.observe(wrap);
  function fit(box) {
    if (!d) return;
    const [x0, y0, x1, y1] = box || d.die;
    const pad = 24, bw = Math.max(x1 - x0, 1e-3), bh = Math.max(y1 - y0, 1e-3);
    const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    view = { s, ox: x0 - (W / s - bw) / 2, oy: y0 - (H / s - bh) / 2, fitted: true };
    invalidate();
  }
  $(".vw-fit").onclick = () => fit();
  const toW = (px, py) => [view.ox + px / view.s, view.oy + (H - py) / view.s];

  // ---- drawing
  function draw() {
    const s = view.s, X = (x) => (x - view.ox) * s, Y = (y) => H - (y - view.oy) * s;
    const css = getComputedStyle(el);
    const col = (v, f) => css.getPropertyValue(v).trim() || f;
    g.fillStyle = col("--panel", "#0f1117"); g.fillRect(0, 0, W, H);
    const wx0 = view.ox, wy0 = view.oy, wx1 = view.ox + W / s, wy1 = view.oy + H / s;
    const vis = (x0, y0, x1, y1) => x1 >= wx0 && x0 <= wx1 && y1 >= wy0 && y0 <= wy1;
    if (show.die) {
      const [a, b, c, e] = d.die;
      g.fillStyle = "rgba(255,255,255,.03)"; g.fillRect(X(a), Y(e), (c - a) * s, (e - b) * s);
      g.strokeStyle = col("--text-3", "#6b7185"); g.lineWidth = 1.5; g.strokeRect(X(a), Y(e), (c - a) * s, (e - b) * s);
    }
    if (show.rows && d.rows.length) {
      g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 1; g.beginPath();
      for (const [x, y, nx, , dx] of d.rows) { if (!vis(x, y, x + nx * dx, y + 4)) continue; g.rect(X(x), Y(y + 3.92), nx * dx * s, 3.92 * s); }
      g.stroke();
    }
    if (show.cells) {
      const bx = d.box;
      const groups = { seq: [], clk: [], fill: [], other: [] };
      for (let i = 0; i < d.comps.length; i++) {
        const x0 = bx[i * 4], y0 = bx[i * 4 + 1], x1 = bx[i * 4 + 2], y1 = bx[i * 4 + 3];
        if (!vis(x0, y0, x1, y1) || ((x1 - x0) * s < 0.4 && (y1 - y0) * s < 0.4)) continue; // LOD: <1px skipped
        const m = d.comps[i].m;
        (/dff|lat|sdff/.test(m) ? groups.seq : /clkbuf|clkinv/.test(m) ? groups.clk : /fill|endcap|tap|decap/.test(m) ? groups.fill : groups.other).push(i);
      }
      const paint = (list, fill, stroke) => {
        if (!list.length) return;
        g.fillStyle = fill; g.beginPath();
        for (const i of list) g.rect(X(bx[i * 4]), Y(bx[i * 4 + 3]), Math.max((bx[i * 4 + 2] - bx[i * 4]) * s, 1), Math.max((bx[i * 4 + 3] - bx[i * 4 + 1]) * s, 1));
        g.fill();
        if (stroke && s > 5) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
      };
      paint(groups.fill, "rgba(255,255,255,.07)");
      paint(groups.other, "rgba(120,140,190,.38)", "rgba(160,180,230,.5)");
      paint(groups.seq, "rgba(255,176,32,.5)", "rgba(255,176,32,.8)");
      paint(groups.clk, "rgba(74,99,255,.55)", "rgba(110,130,255,.9)");
    }
    // wires
    const seg = d.segs;
    const strokeSegs = (list, color, minW) => {
      g.strokeStyle = color; g.beginPath();
      let lw = 0;
      for (const i of list) {
        const o = i * 8, x0 = seg[o + 1], y0 = seg[o + 2], x1 = seg[o + 3], y1 = seg[o + 4];
        if (!vis(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))) continue;
        if (Math.abs(x1 - x0) * s < 1 && Math.abs(y1 - y0) * s < 1) continue;
        g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1));
        lw = Math.max(lw, seg[o + 5]);
      }
      g.lineWidth = Math.max(minW, (lw || 0.28) * s); g.stroke();
    };
    for (let li = 0; li < d.layers.length; li++) {
      const name = d.layers[li], n = +(/(\d+)/.exec(name) || [0, li + 1])[1];
      if (!metalOn[name]) continue;
      if ((n === 1 && s < 2) || (n === 2 && s < 1)) continue; // LOD: low metals only when zoomed
      const c = METAL[li % METAL.length];
      g.globalAlpha = 0.85;
      strokeSegs(layerSegs[li].sig, c, 1);
      if (show.power) { g.globalAlpha = 0.45; strokeSegs(layerSegs[li].pow, c, 1); }
      g.globalAlpha = 1;
    }
    if (show.clock) {
      g.strokeStyle = "#ff4fd8"; g.lineWidth = 1.6; g.beginPath();
      const n = seg.length / 8;
      for (let i = 0; i < n; i++) {
        const o = i * 8; if (seg[o + 7] || !d.nets[seg[o + 6]].clock || !metalOn[d.layers[seg[o]]]) continue;
        g.moveTo(X(seg[o + 1]), Y(seg[o + 2])); g.lineTo(X(seg[o + 3]), Y(seg[o + 4]));
      }
      g.stroke();
      g.fillStyle = "#ff4fd8"; g.beginPath();
      for (const nm of clockSinks) {
        const i = compIdx.get(nm); if (i == null) continue;
        const cx = (d.box[i * 4] + d.box[i * 4 + 2]) / 2, cy = (d.box[i * 4 + 1] + d.box[i * 4 + 3]) / 2;
        if (!vis(cx, cy, cx, cy)) continue;
        g.moveTo(X(cx) + 3, Y(cy)); g.arc(X(cx), Y(cy), 3, 0, 6.3);
      }
      g.fill();
    }
    if (show.vias && s > 2) {
      g.fillStyle = "rgba(255,255,255,.75)"; g.beginPath();
      const v = d.vias, r = Math.max(1, 0.2 * s);
      for (let i = 0; i < v.length; i += 3) { if (v[i] < wx0 || v[i] > wx1 || v[i + 1] < wy0 || v[i + 1] > wy1) continue; g.rect(X(v[i]) - r, Y(v[i + 1]) - r, 2 * r, 2 * r); }
      g.fill();
    }
    if (show.pins) {
      g.fillStyle = "#3ddc97"; g.beginPath();
      for (const p of d.pins) g.rect(X(p.r[0]) - 1, Y(p.r[3]) - 1, Math.max((p.r[2] - p.r[0]) * s, 3) + 2, Math.max((p.r[3] - p.r[1]) * s, 3) + 2);
      g.fill();
    }
    if (hiNet.size) {
      g.strokeStyle = "#ffd60a"; g.lineWidth = Math.max(2.5, 0.5 * s); g.beginPath();
      for (let i = 0; i < seg.length; i += 8) if (hiNet.has(seg[i + 6])) { g.moveTo(X(seg[i + 1]), Y(seg[i + 2])); g.lineTo(X(seg[i + 3]), Y(seg[i + 4])); }
      g.stroke();
      g.lineWidth = 2; g.beginPath();
      for (const ni of hiNet) for (const c of d.nets[ni].conns) {
        const i = compIdx.get(c);
        if (i != null) g.rect(X(d.box[i * 4]) - 1, Y(d.box[i * 4 + 3]) - 1, (d.box[i * 4 + 2] - d.box[i * 4]) * s + 2, (d.box[i * 4 + 3] - d.box[i * 4 + 1]) * s + 2);
      }
      g.stroke();
    }
    if (sel1) {
      g.strokeStyle = "#fff"; g.lineWidth = 2; const b = sel1.bbox;
      g.strokeRect(X(b[0]) - 2, Y(b[3]) - 2, (b[2] - b[0]) * s + 4, (b[3] - b[1]) * s + 4);
    }
  }

  // ---- net search
  function applyNetSearch() {
    const q = netIn.value.trim();
    hiNet = new Set();
    if (!d || !q) { note.textContent = ""; invalidate(); return null; }
    let ids = [];
    const ex = d.nets.findIndex((n) => !n.special && n.n === q);
    if (ex >= 0) ids = [ex]; else d.nets.forEach((n, i) => { if (!n.special && n.n.toLowerCase().includes(q.toLowerCase())) ids.push(i); });
    ids = ids.slice(0, 50);
    ids.forEach((i) => hiNet.add(i));
    note.textContent = ids.length ? `${ids.length} net${ids.length > 1 ? "s" : ""}` : "no match";
    invalidate();
    return ids;
  }
  netIn.addEventListener("input", () => applyNetSearch());
  netIn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !applyNetSearch()?.length) return;
    let b = [1e9, 1e9, -1e9, -1e9];
    const grow = (x0, y0, x1, y1) => { b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)]; };
    for (let i = 0; i < d.segs.length; i += 8) if (hiNet.has(d.segs[i + 6])) grow(Math.min(d.segs[i + 1], d.segs[i + 3]), Math.min(d.segs[i + 2], d.segs[i + 4]), Math.max(d.segs[i + 1], d.segs[i + 3]), Math.max(d.segs[i + 2], d.segs[i + 4]));
    for (const ni of hiNet) for (const c of d.nets[ni].conns) { const k = compIdx.get(c); if (k != null) grow(d.box[k * 4], d.box[k * 4 + 1], d.box[k * 4 + 2], d.box[k * 4 + 3]); }
    if (b[0] < 1e8) fit([b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4]);
  });

  // ---- picking
  function pick(px, py) {
    const [wx, wy] = toW(px, py), key = Math.floor(wx / BUCKET) * 100003 + Math.floor(wy / BUCKET), tol = 4 / view.s;
    for (const p of d.pins) if (wx >= p.r[0] - tol && wx <= p.r[2] + tol && wy >= p.r[1] - tol && wy <= p.r[3] + tol)
      return { text: `Pin ${p.n}  (net ${p.net}, ${p.layer})`, bbox: p.r };
    let best = null, bd = 1e9;
    for (const i of gridS.get(key) || []) {
      const o = i * 8, S = d.segs, name = d.layers[S[o]];
      if (!metalOn[name] || (S[o + 7] && !show.power)) continue;
      const x0 = S[o + 1], y0 = S[o + 2], x1 = S[o + 3], y1 = S[o + 4], hw = Math.max(S[o + 5] / 2, 0);
      const dx = Math.max(Math.min(x0, x1) - wx, 0, wx - Math.max(x0, x1)), dy = Math.max(Math.min(y0, y1) - wy, 0, wy - Math.max(y0, y1));
      const dist = Math.hypot(dx, dy) - hw;
      if (dist < tol && dist < bd) { bd = dist; best = { text: `Wire on ${name}  (net ${d.nets[S[o + 6]].n})`, bbox: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] }; }
    }
    if (best) return best;
    let area = 1e9;
    for (const i of gridC.get(key) || []) {
      const b = d.box.subarray(i * 4, i * 4 + 4);
      if (wx >= b[0] && wx <= b[2] && wy >= b[1] && wy <= b[3] && (b[2] - b[0]) * (b[3] - b[1]) < area) {
        area = (b[2] - b[0]) * (b[3] - b[1]); const c = d.comps[i];
        best = { text: `Cell ${c.n}  (${c.m.replace(/^gf180mcu_fd_sc_mcu\w+?__/, "")}, ${c.o}${c.fixed ? ", fixed" : ""}) at ${c.x.toFixed(2)}, ${c.y.toFixed(2)} um`, bbox: [...b] };
      }
    }
    return best;
  }

  let drag = null;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false }; });
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.ox = drag.ox - dx / view.s; view.oy = drag.oy + dy / view.s; invalidate();
    }
    if (d) { const [x, y] = toW(px, py); xy.textContent = `x ${x.toFixed(2)}, y ${y.toFixed(2)} um`; }
  });
  cv.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved && d) {
      const r = cv.getBoundingClientRect();
      sel1 = pick(e.clientX - r.left, e.clientY - r.top);
      info.textContent = sel1 ? sel1.text : `${d.comps.length} cells, ${d.nets.length} nets`;
      invalidate();
    }
    drag = null;
  });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, [wx, wy] = toW(px, py);
    view.s = Math.min(Math.max(view.s * Math.exp(-e.deltaY * 0.0015), 0.05), 400);
    view.ox = wx - px / view.s; view.oy = wy - (H - py) / view.s; invalidate();
  }, { passive: false });
  cv.tabIndex = 0;
  cv.addEventListener("keydown", (e) => { if (e.key === "f") fit(); });

  buildSide();
  resize();
  refreshStages(true);
  return {
    update(c) { ctx = c; refreshStages(false); },
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); el.innerHTML = ""; },
  };
}
