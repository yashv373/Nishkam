// Timing viewer: OpenSTA report_checks text from the post-PnR STA step. mount(el, ctx) -> { update, destroy }
import { parseSta } from "./sta-parser.js";

const RPT = /stapostpnr\/([^/]+)\/(max|min)\.rpt$/;
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "-");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function histogramSvg(slacks, w = 520, h = 110) {
  if (!slacks.length) return "";
  const lo = Math.min(...slacks), hi = Math.max(...slacks), N = 24, span = hi - lo || 1;
  const bins = new Array(N).fill(0);
  for (const s of slacks) bins[Math.min(N - 1, Math.floor(((s - lo) / span) * N))]++;
  const mx = Math.max(...bins), bw = (w - 40) / N;
  let bars = "";
  bins.forEach((c, i) => {
    const mid = lo + ((i + 0.5) / N) * span, bh = (c / mx) * (h - 30);
    bars += `<rect x="${30 + i * bw}" y="${h - 20 - bh}" width="${bw - 1}" height="${bh}" rx="1.5" fill="${mid < 0 ? "var(--err,#ff5c6c)" : "var(--glow,#4a63ff)"}"><title>${c} paths near ${mid.toFixed(2)} ns</title></rect>`;
  });
  const zero = lo < 0 && hi > 0 ? `<line x1="${30 + ((0 - lo) / span) * (w - 40)}" x2="${30 + ((0 - lo) / span) * (w - 40)}" y1="4" y2="${h - 20}" stroke="var(--text-2,#9aa0b4)" stroke-dasharray="3 3"/>` : "";
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Slack histogram">${bars}${zero}
    <text x="30" y="${h - 5}" fill="var(--text-3,#6b7185)" font-size="11">${lo.toFixed(2)} ns</text>
    <text x="${w - 10}" y="${h - 5}" text-anchor="end" fill="var(--text-3,#6b7185)" font-size="11">${hi.toFixed(2)} ns</text>
    <text x="4" y="12" fill="var(--text-3,#6b7185)" font-size="11">${mx}</text></svg>`;
}

export function mount(el, ctx) {
  el.classList.add("vw-root", "vw-timing");
  el.innerHTML = `<div class="vw-bar"><select class="vw-corner" title="Corner"></select>
    <div class="vw-tabs"><button data-t="max" class="on">Setup</button><button data-t="min">Hold</button></div>
    <span class="vw-note"></span></div>
    <div class="vw-chips"></div>
    <div class="vw-tscroll"><div class="vw-hist"></div><div class="vw-ptable"></div><div class="vw-detail"></div></div>`;
  const $ = (s) => el.querySelector(s);
  const cornerSel = $(".vw-corner"), note = $(".vw-note"), chips = $(".vw-chips");
  let kind = "max", corner = "", cache = new Map(), reports = {}, sig = "", cur = null, pathSel = 0;

  const cornerMetric = (c, k) => ctx.metrics?.[`timing__${k}__ws__corner:${c}`];

  function scan(list) {
    reports = {};
    for (const p of list) { const m = RPT.exec(p); if (m) (reports[m[1]] ||= {})[m[2]] = p; }
  }
  async function refresh() {
    const list = await ctx.listFiles().catch(() => []);
    const s = list.filter((p) => RPT.test(p)).join("|") + JSON.stringify(ctx.metrics && Object.keys(ctx.metrics).length) + JSON.stringify(ctx.staInfo || null);
    if (s === sig) return;
    if (sig) cache = new Map();
    sig = s;
    scan(list);
    const corners = [...new Set([...Object.keys(reports), ...Object.keys(ctx.staInfo || {})])];
    cornerSel.innerHTML = corners.map((c) => `<option>${esc(c)}</option>`).join("");
    if (!corners.length) { $(".vw-tscroll").innerHTML = `<div class="vw-msg" style="display:block">No timing reports yet. Run the Timing (STA) stage.</div>`; chips.innerHTML = ""; return; }
    if (!$(".vw-hist")) $(".vw-tscroll").innerHTML = `<div class="vw-hist"></div><div class="vw-ptable"></div><div class="vw-detail"></div>`;
    if (!corners.includes(corner)) {
      // start on the corner with the worst setup slack
      corner = corners.slice().sort((a, b) => (cornerMetric(a, "setup") ?? 1e9) - (cornerMetric(b, "setup") ?? 1e9))[0];
    }
    cornerSel.value = corner;
    chips.innerHTML = corners.map((c) => {
      const su = cornerMetric(c, "setup"), ho = cornerMetric(c, "hold"), bad = (su ?? 0) < 0 || (ho ?? 0) < 0;
      return `<span class="vw-chip ${bad ? "bad" : "ok"}"><i></i>${esc(c)}<b>setup ${su == null ? "n/a" : f3(su)}</b><b>hold ${ho == null ? "n/a" : f3(ho)}</b></span>`;
    }).join("");
    await show();
  }

  // Browser OpenSTA runs (ctx.staInfo): what was run, the exact SDC, OpenSTA's own error if it failed.
  function info() {
    const i = ctx.staInfo?.[corner]; if (!i) return "";
    return `<div class="vw-h">${esc(i.label)}</div>` + (i.error ? `<pre class="vw-err" style="white-space:pre-wrap;color:var(--err,#ff5c6c)">OpenSTA error:
${esc(i.error)}</pre>` : "") +
      `<details open><summary>SDC used (from Properties)</summary><pre style="white-space:pre-wrap">${esc(i.sdc)}</pre></details>`;
  }
  async function show() {
    if (ctx.staInfo?.[corner]?.error) { $(".vw-tscroll").innerHTML = `<div class="vw-info">${info()}</div>`; note.textContent = ""; return; }
    if (!$(".vw-hist")) $(".vw-tscroll").innerHTML = `<div class="vw-hist"></div><div class="vw-ptable"></div><div class="vw-detail"></div>`;
    $(".vw-info")?.remove();
    const p = reports[corner]?.[kind];
    if (!p) { note.textContent = "report missing"; return; }
    note.textContent = "loading...";
    if (!cache.has(p)) {
      const raw = await ctx.getFile(p);
      cache.set(p, parseSta(typeof raw === "string" ? raw : new TextDecoder().decode(raw)));
    }
    cur = cache.get(p); pathSel = 0;
    const viol = cur.filter((x) => x.slack < 0).length;
    note.textContent = `${cur.length} paths, ${viol} violating`;
    $(".vw-hist").innerHTML = `<div class="vw-h">Slack distribution (ns)</div>` + histogramSvg(cur.map((x) => x.slack));
    $(".vw-ptable").innerHTML = `<table><thead><tr><th>#</th><th>Endpoint</th><th>Startpoint</th><th>Clock</th><th class="r">Slack</th><th class="r">Required</th><th class="r">Arrival</th></tr></thead><tbody>` +
      cur.slice(0, 300).map((x, i) => `<tr data-i="${i}" class="${x.slack < 0 ? "neg" : ""}"><td>${i + 1}</td><td>${esc(x.end)}</td><td>${esc(x.start)}</td><td>${esc(x.clock)}</td><td class="r">${f3(x.slack)}</td><td class="r">${f3(x.required)}</td><td class="r">${f3(x.arrival)}</td></tr>`).join("") + `</tbody></table>`;
    detail();
    $(".vw-hist").insertAdjacentHTML("beforebegin", `<div class="vw-info">${info()}</div>`);
  }
  function detail() {
    const x = cur?.[pathSel];
    el.querySelectorAll(".vw-ptable tr[data-i]").forEach((r) => r.classList.toggle("sel", +r.dataset.i === pathSel));
    if (!x) { $(".vw-detail").innerHTML = ""; return; }
    const rows = (sec) => x.rows.filter((r) => r.section === sec).map((r) =>
      `<tr><td>${esc(r.pin)}</td><td>${esc(r.cell)}</td><td class="r">${r.fanout ?? ""}</td><td class="r">${r.cap == null ? "" : r.cap.toFixed(4)}</td><td class="r">${r.slew == null ? "" : r.slew.toFixed(3)}</td><td class="r">${f3(r.delay)}</td><td class="r">${f3(r.time)}</td></tr>`).join("");
    $(".vw-detail").innerHTML = `<div class="vw-h">Path ${pathSel + 1}: ${esc(x.start)} to ${esc(x.end)} &middot; slack ${f3(x.slack)} ns (${x.met ? "met" : "VIOLATED"})</div>
      <table><thead><tr><th>Pin</th><th>Cell</th><th class="r">Fanout</th><th class="r">Cap (pF)</th><th class="r">Slew</th><th class="r">Delay</th><th class="r">Arrival</th></tr></thead>
      <tbody><tr class="sec"><td colspan="7">Launch clock and data path</td></tr>${rows("data")}
      <tr class="sec"><td colspan="7">Capture clock path</td></tr>${rows("capture")}</tbody></table>`;
  }

  el.addEventListener("click", (e) => {
    const tab = e.target.closest(".vw-tabs button"), tr = e.target.closest("tr[data-i]");
    if (tab) { kind = tab.dataset.t; el.querySelectorAll(".vw-tabs button").forEach((b) => b.classList.toggle("on", b === tab)); show(); }
    if (tr) { pathSel = +tr.dataset.i; detail(); }
  });
  cornerSel.onchange = () => { corner = cornerSel.value; show(); };
  refresh();
  return { update(c) { ctx = c; refresh(); }, destroy() { el.innerHTML = ""; } };
}
