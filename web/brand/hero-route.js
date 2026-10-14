// Live draw-in of the routed tiny8 chip (gf180mcuD) on a canvas. No libraries.
// Data: brand/media/tiny8-routes.{json,bin}, built by make-hero-routes.mjs
export async function startHeroRoutes(canvas, { host = canvas.parentElement, debug = false, still: forceStill = false } = {}) {
  const base = new URL("./media/", import.meta.url);
  const [meta, bin] = await Promise.all([fetch(new URL("tiny8-routes.json", base)).then((r) => r.json()),
    fetch(new URL("tiny8-routes.bin", base)).then((r) => r.arrayBuffer())]);
  const Q = meta.Q, DIE = (meta.die[2] - meta.die[0]) * Q;
  const all = new Int16Array(bin);
  const nS = meta.nSeg, nV = meta.nVia, nC = meta.nCell;
  const S = all.subarray(0, nS * 6), V = all.subarray(nS * 6, nS * 6 + nV * 2), C = all.subarray(nS * 6 + nV * 2);
  const reduce = forceStill || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d", { alpha: false });

  // ---- timeline (seconds) ----
  const TOTAL = 7.2, DUR = 0.9, span = 1.5;
  const layerT = [0, 1.7, 2.5, 3.3, 4.1, 4.9]; // start of Metal1..5 growth
  const t0 = new Float32Array(nS); // wires are pre-sorted by distance from the die centre
  for (let i = 0; i < nS; i++) t0[i] = layerT[S[i * 6]] + (i / nS) * span;
  const cx = DIE / 2, rMax = Math.hypot(cx, cx);
  const tv = new Float32Array(nV);
  for (let i = 0; i < nV; i++) tv[i] = 2.4 + (Math.hypot(V[i * 2] - cx, V[i * 2 + 1] - cx) / rMax) * 4.4;
  const tc = new Float32Array(nC);
  for (let i = 0; i < nC; i++) tc[i] = 0.35 + (Math.hypot(C[i * 5] - cx, C[i * 5 + 1] - cx) / rMax) * 1.7;

  // ---- pulses: random walks over wires joined at endpoints ----
  const key = (x, y) => x * 40009 + y;
  const adj = new Map();
  for (let i = 0; i < nS; i++) for (const e of [key(S[i * 6 + 1], S[i * 6 + 2]), key(S[i * 6 + 3], S[i * 6 + 4])]) (adj.get(e) || adj.set(e, []).get(e)).push(i);
  const mkPath = () => {
    let s = (Math.random() * nS) | 0, a = key(S[s * 6 + 1], S[s * 6 + 2]);
    const path = [];
    for (let n = 0; n < 14; n++) {
      const fwd = key(S[s * 6 + 1], S[s * 6 + 2]) === a;
      const x1 = S[s * 6 + (fwd ? 1 : 3)], y1 = S[s * 6 + (fwd ? 2 : 4)], x2 = S[s * 6 + (fwd ? 3 : 1)], y2 = S[s * 6 + (fwd ? 4 : 2)];
      path.push([x1, y1, x2, y2, Math.hypot(x2 - x1, y2 - y1)]);
      a = key(x2, y2);
      const nx = (adj.get(a) || []).filter((j) => j !== s);
      if (!nx.length) break;
      s = nx[(Math.random() * nx.length) | 0];
    }
    return path;
  };
  const pulses = [];
  const newPulse = (at) => { const p = mkPath(); return { p, len: p.reduce((q, e) => q + e[4], 0), d: 0, speed: 1200 + Math.random() * 1200, born: at }; };

  // ---- layout ----
  let W, H, dpr, k, ox, oy, mob, cache = null;
  const layout = () => {
    mob = innerWidth < 700;
    dpr = Math.min(devicePixelRatio || 1, 3);
    W = host.clientWidth; H = host.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const side = mob ? Math.max(H * 1.15, W * 1.8) : Math.max(W * 1.4, H * 1.7); // chip a bit larger than the view
    k = (side * dpr) / DIE;
    ox = (mob ? W * 0.5 : W * 0.56) * dpr - (side * dpr) / 2;
    oy = H * 0.5 * dpr - (side * dpr) / 2;
    cache = null;
  };
  // Metal1 (deep blue) to Metal5 (bright periwinkle)
  const COL = [null, [24, 44, 200], [32, 58, 235], [20, 48, 255], [74, 99, 255], [140, 160, 255]];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3));

  // draw the whole scene at time t into g, shifted by (dx, dy) device px
  function scene(g, t, dx, dy) {
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#000"; g.fillRect(-200 * dpr, -200 * dpr, canvas.width + 400 * dpr, canvas.height + 400 * dpr);
    g.globalCompositeOperation = "lighter";
    const X = (v) => ox + dx + v * k, Y = (v) => oy + dy + (DIE - v) * k; // DEF y points up
    const hair = Math.max(1, dpr * 0.75);
    const da = ease(t / 1.1);
    g.lineWidth = hair; g.strokeStyle = rgba(COL[4], 0.5 * da);
    g.strokeRect(X(0), Y(DIE), DIE * k, DIE * k);
    g.strokeStyle = rgba(COL[5], 0.9 * da); g.lineWidth = hair * 2;
    const bl = 0.6 * DIE * k / 10; g.beginPath();
    for (const [x, y, sx, sy] of [[0, 0, 1, -1], [DIE, 0, -1, -1], [0, DIE, 1, 1], [DIE, DIE, -1, 1]]) { g.moveTo(X(x) + sx * bl, Y(y)); g.lineTo(X(x), Y(y)); g.lineTo(X(x), Y(y) + sy * bl); }
    g.stroke();
    if (t > 0.2) {
      g.strokeStyle = rgba(COL[3], ease((t - 0.2) / 1.4) * 0.12); g.lineWidth = hair; g.beginPath();
      for (const r of meta.rows) { g.moveTo(X(r[0]), Y(r[1])); g.lineTo(X(r[0] + r[2]), Y(r[1])); }
      g.stroke();
      for (let i = 0; i < nC; i++) { // cell outlines; flip-flops get a soft fill
        const a = ease((t - tc[i]) / 0.7); if (a <= 0) continue;
        const x = X(C[i * 5]), y = Y(C[i * 5 + 1] + C[i * 5 + 3]), w = C[i * 5 + 2] * k, h = C[i * 5 + 3] * k, ff = C[i * 5 + 4];
        if (ff) { g.fillStyle = rgba(COL[3], 0.09 * a); g.fillRect(x, y, w, h); }
        g.strokeStyle = rgba(COL[3], (ff ? 0.4 : 0.17) * a); g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }
    g.lineCap = "round";
    for (let L = 1; L <= 5; L++) {
      if (t < layerT[L]) break;
      for (let pass = (mob || L < 3 ? 1 : 0); pass < 2; pass++) { // pass 0: wide faint glow, pass 1: core
        g.beginPath();
        for (let i = 0; i < nS; i++) {
          if (S[i * 6] !== L) continue;
          const p = ease((t - t0[i]) / DUR); if (p <= 0) continue;
          const x1 = S[i * 6 + 1], y1 = S[i * 6 + 2], x2 = S[i * 6 + 3], y2 = S[i * 6 + 4];
          g.moveTo(X(x1), Y(y1)); g.lineTo(X(x1 + (x2 - x1) * p), Y(y1 + (y2 - y1) * p));
        }
        const wd = Math.max(hair, 0.4 * k * (0.5 + L * 0.35));
        if (pass === 0) { g.lineWidth = wd * 7; g.strokeStyle = rgba(COL[L], 0.05); }
        else { g.lineWidth = wd; g.strokeStyle = rgba(COL[L], 0.55 + L * 0.09); }
        g.stroke();
      }
    }
    g.fillStyle = "rgba(190,205,255,.85)"; const vs = Math.max(1.4, dpr * 1.1);
    g.beginPath();
    for (let i = 0; i < nV; i++) {
      const a = t - tv[i]; if (a < 0 || (mob && (i & 1))) continue;
      const s = vs * (a < 0.25 ? 1 + (1 - a / 0.25) * 1.8 : 1);
      g.rect(X(V[i * 2]) - s / 2, Y(V[i * 2 + 1]) - s / 2, s, s);
    }
    g.fill();
  }
  function drawPulses(g, t, dx, dy) {
    if (t < TOTAL - 0.5) return;
    const X = (v) => ox + dx + v * k, Y = (v) => oy + dy + (DIE - v) * k;
    while (pulses.length < (mob ? 3 : 6)) pulses.push(newPulse(t + Math.random() * 3));
    for (let n = 0; n < pulses.length; n++) {
      const q = pulses[n];
      if (t < q.born) continue;
      q.d = (t - q.born) * q.speed;
      if (q.d > q.len + 500) { pulses[n] = newPulse(t + 0.3 + Math.random() * 2.5); continue; }
      const at = (d) => { let r = d; for (const e of q.p) { if (r <= e[4]) { const f = e[4] ? r / e[4] : 0; return [e[0] + (e[2] - e[0]) * f, e[1] + (e[3] - e[1]) * f]; } r -= e[4]; } return null; };
      const fade = Math.min(1, (q.len + 500 - q.d) / 300);
      for (let j = 0; j < 8; j++) {
        const pt = at(q.d - j * 60); if (!pt) continue;
        const a = (1 - j / 8) * fade, x = X(pt[0]), y = Y(pt[1]), r = (j === 0 ? 12 : 7 * (1 - j / 9)) * dpr;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(215,225,255,${0.95 * a})`); gr.addColorStop(0.35, `rgba(100,125,255,${0.4 * a})`); gr.addColorStop(1, "rgba(74,99,255,0)");
        g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    }
  }

  // ---- loop ----
  let t = 0, last = 0, raf = 0, vis = true, onScreen = true;
  const MARGIN = 40;
  const frame = (now) => {
    raf = 0;
    t += last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
    const dx = Math.sin(t * 0.12) * 14 * dpr, dy = Math.cos(t * 0.09) * 9 * dpr; // slow drift
    if (t < TOTAL) scene(ctx, t, dx, dy);
    else {
      if (!cache) { // freeze the finished chip into a bitmap with margin for the drift
        const m = MARGIN * dpr;
        cache = document.createElement("canvas"); cache.width = canvas.width + 2 * m; cache.height = canvas.height + 2 * m;
        const cg = cache.getContext("2d"); cg.translate(m, m); scene(cg, TOTAL + 5, 0, 0);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(cache, -MARGIN * dpr + dx, -MARGIN * dpr + dy);
      ctx.globalCompositeOperation = "lighter";
      drawPulses(ctx, t, dx, dy);
    }
    if (debug) dbg(now);
    schedule();
  };
  const schedule = () => { if (!raf && vis && onScreen) raf = requestAnimationFrame(frame); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  const resume = () => { last = 0; schedule(); };
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? resume() : stop(); }).observe(host);
  document.addEventListener("visibilitychange", () => { vis = !document.hidden; vis ? resume() : stop(); });
  const still = () => { t = TOTAL; scene(ctx, TOTAL + 5, 0, 0); };
  let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { layout(); reduce ? still() : resume(); }, 120); }).observe(host);

  layout();
  if (reduce) still(); else schedule();

  let fpsN = 0, fpsT = 0, fpsEl;
  function dbg(now) {
    if (!fpsEl) { fpsEl = document.createElement("div"); fpsEl.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99;font:12px monospace;color:#8f9fff"; document.body.append(fpsEl); }
    fpsN++; if (now - fpsT > 1000) { fpsEl.textContent = `t=${t.toFixed(1)}s  ${fpsN} fps`; window.__fps = fpsN; fpsN = 0; fpsT = now; }
  }
  return { get t() { return t; }, restart() { t = 0; pulses.length = 0; cache = null; resume(); } };
}
