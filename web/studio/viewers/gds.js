// GDSII layout viewer (Canvas2D). mount(el, ctx) -> { update(ctx), destroy() }
import { parseGds, topCells, hierDepth, flatten } from "./gds-parser.js";

const BOX_COLOR = "#9aa0b4";
const HIDE_RE = /Label|Dummy|BLK|Slot|XTOR/i;
let layerDb = null;
const layerInfo = () => (layerDb ||= fetch(new URL("gf180-layers.json", import.meta.url)).then((r) => r.json()).then((j) => {
  const m = new Map(); for (const l of j.layers) m.set(l.layer + "/" + l.datatype, l); return m;
}).catch(() => new Map()));

// worker with in-thread fallback (file:// pages); same {load, flat} API
function makeEngine() {
  let w, lib = null;
  try { w = new Worker(new URL("./gds.worker.js", import.meta.url), { type: "module" }); } catch { w = null; }
  if (!w) return {
    load: async (buf) => { lib = parseGds(buf); const cells = [...lib.structs.keys()]; return { tops: topCells(lib), cells, depths: Object.fromEntries(cells.map((c) => [c, hierDepth(lib, c)])) }; },
    flat: async (top, depth) => flatten(lib, top, depth), destroy() {},
  };
  let n = 0; const pend = new Map();
  w.onmessage = (e) => { const p = pend.get(e.data.id); pend.delete(e.data.id); if (p) e.data.error ? p[1](new Error(e.data.error)) : p[0](e.data); };
  w.onerror = (e) => { for (const p of pend.values()) p[1](new Error(e.message || "worker failed")); pend.clear(); };
  const call = (msg, tr) => new Promise((res, rej) => { const id = ++n; pend.set(id, [res, rej]); w.postMessage({ id, ...msg }, tr || []); });
  return { load: (buf) => call({ type: "load", buf }, [buf]), flat: async (top, depth) => (await call({ type: "flat", top, depth })).r, destroy: () => w.terminate() };
}

export function mount(el, ctx) {
  el.classList.add("vw-root");
  el.innerHTML = `
  <div class="vw-bar">
    <select class="vw-file" title="GDS file"></select>
    <input type="file" accept=".gds,.gdsii" hidden>
    <button class="vw-btn vw-open">Open .gds...</button>
    <select class="vw-top" title="Top cell"></select>
    <label class="vw-note" style="margin:0">Depth <input class="vw-depth" type="range" min="0" max="0" value="0" style="width:90px;padding:0;vertical-align:middle"> <span class="vw-dv">0</span></label>
    <span class="vw-note vw-t"></span>
    <button class="vw-btn vw-fit">Fit</button>
  </div>
  <div class="vw-body">
    <div class="vw-side" style="width:190px"></div>
    <div class="vw-canvas"><canvas tabindex="0"></canvas><div class="vw-msg">Loading...</div></div>
  </div>
  <div class="vw-status"><span class="vw-xy">x -, y - um</span><span class="vw-info"></span></div>`;
  const $ = (s) => el.querySelector(s);
  const selFile = $(".vw-file"), inFile = $("input[type=file]"), selTop = $(".vw-top"), depthIn = $(".vw-depth"), dv = $(".vw-dv"), note = $(".vw-t");
  const side = $(".vw-side"), wrap = $(".vw-canvas"), cv = $("canvas"), g = cv.getContext("2d"), msg = $(".vw-msg"), xy = $(".vw-xy"), info = $(".vw-info");

  let eng = null, meta = null, flat = null, view = { s: 1, ox: 0, oy: 0 }, W = 0, H = 0, raf = 0, dirty = false, loadId = 0, fitted = false;
  const vis = {}, color = {}, order = []; // per "layer/datatype"
  let names = new Map(), boxesOn = true, flatTimer = 0, loadMs = 0;

  const invalidate = () => { dirty = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (dirty && flat) { dirty = false; draw(); } }); };
  const setMsg = (t) => { msg.textContent = t; msg.style.display = t ? "" : "none"; };

  function buildSide() {
    side.innerHTML = `<label><input type="checkbox" class="b" ${boxesOn ? "checked" : ""}><i style="background:${BOX_COLOR}"></i>Cell boxes</label><div class="vw-sep">Layers</div>` +
      order.map((k) => `<label title="${k}"><input type="checkbox" data-k="${k}" ${vis[k] ? "checked" : ""}><input type="color" data-c="${k}" value="${color[k]}" style="width:16px;height:16px;padding:0;border:0;background:none"><span>${names.get(k)?.name || k}</span></label>`).join("");
  }
  side.addEventListener("change", (e) => {
    const t = e.target;
    if (t.classList.contains("b")) boxesOn = t.checked;
    else if (t.dataset.k) vis[t.dataset.k] = t.checked;
    else if (t.dataset.c) color[t.dataset.c] = t.value;
    invalidate();
  });

  function resize() {
    const r = wrap.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0); invalidate();
  }
  function fit() {
    if (!flat) return;
    if (W <= 1 || H <= 1) return; const [x0, y0, x1, y1] = flat.bbox, s = Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1)) * 0.94;
    view = { s, ox: (W - (x1 - x0) * s) / 2 - x0 * s, oy: (H + (y1 - y0) * s) / 2 + y0 * s }; fitted = true; invalidate();
  }

  function draw() {
    const t0 = performance.now();
    g.clearRect(0, 0, W, H);
    const { s, ox, oy } = view, X0 = -ox / s, X1 = (W - ox) / s, Y1 = oy / s, Y0 = (oy - H) / s, minD = 1 / s;
    let drawn = 0;
    g.lineWidth = 1;
    for (const k of order) {
      const L = flat.layers.get(k); if (!L || !vis[k]) continue;
      const { off, xy: P, bb } = L; let cnt = 0;
      g.fillStyle = g.strokeStyle = color[k];
      const flush = () => { g.globalAlpha = 0.5; g.fill(); if (s > 2 && L.n < 3000) { g.globalAlpha = 0.9; g.stroke(); } g.beginPath(); };
      g.beginPath();
      for (let i = 0; i < L.n; i++) {
        const a = bb[4 * i], b = bb[4 * i + 1], c = bb[4 * i + 2], d = bb[4 * i + 3];
        if (c < X0 || a > X1 || d < Y0 || b > Y1 || (c - a < minD && d - b < minD)) continue; // cull + sub-pixel LOD
        const o = off[i], e = off[i + 1];
        g.moveTo(P[2 * o] * s + ox, oy - P[2 * o + 1] * s);
        for (let j = o + 1; j < e; j++) g.lineTo(P[2 * j] * s + ox, oy - P[2 * j + 1] * s);
        g.closePath(); drawn++;
        if (++cnt % 200 === 0) flush(); // one huge path fills superlinearly slowly; chunks are ~40x faster
      }
      flush();
    }
    g.globalAlpha = 1;
    if (boxesOn && flat.boxes.length) {
      const B = flat.boxes; g.strokeStyle = BOX_COLOR; g.fillStyle = "rgba(154,160,180,.08)"; g.beginPath();
      for (let i = 0; i < B.length; i += 4) {
        if (B[i + 2] < X0 || B[i] > X1 || B[i + 3] < Y0 || B[i + 1] > Y1) continue;
        g.rect(B[i] * s + ox, oy - B[i + 3] * s, (B[i + 2] - B[i]) * s, (B[i + 3] - B[i + 1]) * s);
      }
      g.fill(); g.stroke();
    }
    info.textContent = `${drawn.toLocaleString()} of ${flat.nPoly.toLocaleString()} shapes drawn, ${(flat.boxes.length / 4).toLocaleString()} cell boxes, ${(performance.now() - t0).toFixed(0)} ms/frame`;
  }

  async function reflat() {
    if (!eng || !meta) return;
    const id = ++loadId, t = performance.now();
    const f = await eng.flat(selTop.value, +depthIn.value).catch((e) => { setMsg("Error: " + e.message); return null; });
    if (!f || id !== loadId) return;
    flat = f;
    const ks = [...flat.layers.keys()];
    for (const k of ks) if (!(k in vis)) { // first sight of a layer
      const n = names.get(k); vis[k] = n ? !HIDE_RE.test(n.name) : true;
      color[k] = n?.color || "#" + ((Math.abs(Math.sin(+k.split("/")[0] + 1)) * 0xffffff) | 0).toString(16).padStart(6, "0");
    }
    const rank = (k) => { const [l, d] = k.split("/").map(Number); return [names.has(k) ? 0 : 1, l, d]; };
    order.length = 0; order.push(...ks.sort((a, b) => { const A = rank(a), B = rank(b); return A[0] - B[0] || A[1] - B[1] || A[2] - B[2]; }));
    buildSide(); setMsg(""); if (!fitted) fit(); else invalidate();
    note.textContent = `${loadMs ? "load " + loadMs + " ms, " : ""}flatten ${(performance.now() - t).toFixed(0)} ms`;
  }

  async function load(buf, label) {
    const t = performance.now(); setMsg("Parsing " + label + "..."); flat = null; fitted = false; meta = null; loadMs = 0; invalidate();
    eng?.destroy(); eng = makeEngine(); names = await layerInfo();
    try { meta = await eng.load(buf); } catch (e) { setMsg("Not a valid GDS: " + e.message); return; }
    const tops = meta.tops.length ? meta.tops : meta.cells;
    selTop.innerHTML = tops.map((c) => `<option>${c}</option>`).join("") + (meta.tops.length ? "<option disabled>--- all cells ---</option>" + meta.cells.map((c) => `<option>${c}</option>`).join("") : "");
    setTop(); loadMs = Math.round(performance.now() - t); await reflat();
  }
  function setTop() { const m = meta.depths[selTop.value] || 0; depthIn.max = m; depthIn.value = m; dv.textContent = m; }
  selTop.onchange = () => { fitted = false; setTop(); reflat(); };
  depthIn.oninput = () => { dv.textContent = depthIn.value; clearTimeout(flatTimer); flatTimer = setTimeout(reflat, 120); };
  $(".vw-fit").onclick = fit;
  $(".vw-open").onclick = () => inFile.click();
  inFile.onchange = async () => { const f = inFile.files[0]; if (f) { selFile.value = ""; load(await f.arrayBuffer(), f.name); } };
  selFile.onchange = async () => { if (selFile.value) load(await ctx.getFile(selFile.value), selFile.value); };

  async function refreshFiles() {
    const all = ((await ctx.listFiles?.().catch(() => [])) || []).filter((p) => /\.gds$/i.test(p));
    const prev = selFile.value;
    selFile.innerHTML = `<option value="">${all.length ? "Choose GDS..." : "No GDS in project"}</option>` + all.map((p) => `<option>${p}</option>`).join("");
    if (all.includes(prev)) selFile.value = prev;
    else if (all.length && !meta) { selFile.value = all[0]; selFile.onchange(); }
    else if (!all.length && !meta) setMsg("No GDS yet. Run the flow, or use Open .gds...");
  }

  // pan / zoom / coords
  let drag = null;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; });
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    xy.textContent = `x ${((px - view.ox) / view.s).toFixed(3)}, y ${((view.oy - py) / view.s).toFixed(3)} um`;
    if (drag) { view.ox = drag.ox + e.clientX - drag.x; view.oy = drag.oy + e.clientY - drag.y; invalidate(); }
  });
  cv.addEventListener("pointerup", () => { drag = null; });
  cv.addEventListener("dblclick", fit);
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
    view.ox = px - (px - view.ox) * f; view.oy = py - (py - view.oy) * f; view.s *= f; invalidate();
  }, { passive: false });
  const ro = new ResizeObserver(() => { resize(); if (flat && !fitted) fit(); });
  ro.observe(wrap);
  refreshFiles();

  return {
    update(c) { ctx = c; refreshFiles(); },
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); clearTimeout(flatTimer); eng?.destroy(); el.innerHTML = ""; },
  };
}
