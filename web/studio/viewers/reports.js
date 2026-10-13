// Final Reports dashboard from LibreLane metrics.json. mount(el, ctx) -> { update, destroy }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// [key, label, op, limit, unit, opens]
export const CHECKS = [
  ["timing__setup__ws", "Setup slack", ">=", 0, "ns", "Timing"],
  ["timing__hold__ws", "Hold slack", ">=", 0, "ns", "Timing"],
  ["timing__setup_vio__count", "Setup violations", "==", 0, "", "Timing"],
  ["timing__hold_vio__count", "Hold violations", "==", 0, "", "Timing"],
  ["design__max_slew_violation__count", "Max slew violations", "==", 0, "", "Timing"],
  ["design__max_cap_violation__count", "Max cap violations", "==", 0, "", "Timing"],
  ["design__max_fanout_violation__count", "Max fanout violations", "==", 0, "", "Timing"],
  ["route__drc_errors", "Routing DRC", "==", 0, "", "Layout"],
  ["magic__drc_error__count", "Magic DRC", "==", 0, "", "Layout"],
  ["design__lvs_error__count", "LVS errors", "==", 0, "", null],
  ["design__xor_difference__count", "GDS XOR differences", "==", 0, "", null],
  ["antenna__violating__nets", "Antenna nets", "==", 0, "", "Layout"],
  ["route__antenna_violation__count", "Antenna violations (route)", "==", 0, "", "Layout"],
  ["design__power_grid_violation__count", "Power grid violations", "==", 0, "", null],
];

export function evalChecks(m) {
  return CHECKS.map(([key, label, op, limit, unit, opens]) => {
    const v = num(m?.[key]);
    const status = v == null ? "na" : (op === ">=" ? v >= limit : v === limit) ? "pass" : "fail";
    return { key, label, op, limit, unit, opens, value: v, status };
  });
}

const fmt = {
  ns: (v) => v.toFixed(3) + " ns",
  count: (v) => String(v),
  power: (v) => (v >= 1 ? v.toFixed(2) + " W" : v >= 1e-3 ? (v * 1e3).toFixed(2) + " mW" : v >= 1e-6 ? (v * 1e6).toFixed(2) + " µW" : (v * 1e9).toFixed(1) + " nW"),
  area: (v) => Math.round(v).toLocaleString("en-US") + " µm²",
  um: (v) => Math.round(v).toLocaleString("en-US") + " µm",
  pct: (v) => (v * 100).toFixed(1) + " %",
  mv: (v) => (v * 1e3).toFixed(2) + " mV",
};
const INFO = [
  ["power__total", "Total power", fmt.power, "Timing"], ["power__internal__total", "Internal", fmt.power], ["power__switching__total", "Switching", fmt.power],
  ["power__leakage__total", "Leakage", fmt.power],
  ["design__instance__area__stdcell", "Cell area", fmt.area], ["design__instance__utilization", "Utilization", fmt.pct],
  ["design__die__area", "Die area", fmt.area], ["design__core__area", "Core area", fmt.area],
  ["route__wirelength", "Wirelength", fmt.um], ["ir__drop__worst", "IR drop (worst)", fmt.mv], ["clock__skew__worst_setup", "Clock skew (setup)", fmt.ns],
  ["clock__skew__worst_hold", "Clock skew (hold)", fmt.ns], ["design__instance__count", "Instances", (v) => v.toLocaleString("en-US")],
];

function download(name, data, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function mount(el, ctx) {
  el.classList.add("vw-root", "vw-reports");
  let shot = null;

  async function render() {
    const m = ctx.metrics;
    if (!m) { el.innerHTML = `<div class="vw-scroll"><div class="vw-msg" style="display:block">No results yet. Run the flow to the end (or load the demo) to see the signoff summary.</div></div>`; return; }
    const checks = evalChecks(m);
    const fail = checks.filter((c) => c.status === "fail").length, na = checks.filter((c) => c.status === "na").length;
    const banner = fail ? ["bad", `${fail} check${fail > 1 ? "s" : ""} failed`] : na ? ["warn", `No failures, ${na} check${na > 1 ? "s" : ""} not reported`] : ["ok", "SIGNOFF CLEAN"];
    const tile = (c) => {
      const val = c.value == null ? "n/a" : c.unit === "ns" ? fmt.ns(c.value) : String(c.value);
      const lim = `${c.op === ">=" ? "need ≥" : "need ="} ${c.limit}${c.unit ? " " + c.unit : ""}`;
      return `<${c.opens ? "button" : "div"} class="vw-tile ${c.status}" ${c.opens ? `data-open="${c.opens}"` : ""} title="${esc(c.key)}">
        <span class="vw-dot"></span><span class="vw-tl">${esc(c.label)}</span><span class="vw-tv">${val}</span><span class="vw-tm">${c.status === "na" ? "not reported" : lim}</span></${c.opens ? "button" : "div"}>`;
    };
    const info = INFO.map(([k, l, f, opens]) => {
      const v = num(m[k]);
      return `<div class="vw-info-i"><span>${l}</span><b>${v == null ? "n/a" : f(v)}</b></div>`;
    }).join("");
    // per-corner matrix
    const corners = [...new Set(Object.keys(m).filter((k) => k.includes("__corner:")).map((k) => k.split("__corner:")[1]))];
    const baseKeys = [...new Set(Object.keys(m).filter((k) => k.includes("__corner:")).map((k) => k.split("__corner:")[0]))];
    const interesting = baseKeys.filter((k) => /^(timing__|design__max_|clock__skew|power__total|ir__drop__worst)/.test(k));
    const matrix = corners.length ? `<details class="vw-corner-box"><summary>All corners (${corners.length})</summary><div class="vw-tscroll"><table><thead><tr><th>Metric</th>${corners.map((c) => `<th class="r">${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
      interesting.map((k) => `<tr><td>${esc(k)}</td>${corners.map((c) => { const v = num(m[`${k}__corner:${c}`]); return `<td class="r">${v == null ? "n/a" : +v.toPrecision(5)}</td>`; }).join("")}</tr>`).join("") + `</tbody></table></div></details>` : "";
    const files = await ctx.listFiles().catch(() => []);
    const gds = files.find((p) => /^final\/gds\/[^/]+\.gds$/.test(p)), png = files.find((p) => /^final\/render\/[^/]+\.png$/.test(p));
    if (png && !shot) { try { const b = await ctx.getFile(png); shot = URL.createObjectURL(new Blob([b], { type: "image/png" })); } catch { /* optional */ } }
    el.innerHTML = `<div class="vw-scroll">
      <div class="vw-banner ${banner[0]}"><span class="vw-dot"></span>${banner[1]}<small>${checks.length - fail - na} of ${checks.length} checks pass</small></div>
      <div class="vw-tiles">${checks.map(tile).join("")}</div>
      <div class="vw-h">Design</div><div class="vw-infos">${info}</div>
      ${shot ? `<img class="vw-shot" src="${shot}" alt="Rendered layout">` : ""}
      ${matrix}
      <div class="vw-actions">
        <button class="vw-btn" data-open="Layout">Open layout</button><button class="vw-btn" data-open="Timing">Open timing</button>
        <button class="vw-btn" data-dl="gds" ${gds ? "" : "disabled"}>Download GDS</button><button class="vw-btn" data-dl="json">Download metrics.json</button>
      </div></div>`;
    el._gds = gds;
  }

  el.addEventListener("click", async (e) => {
    const o = e.target.closest("[data-open]"), dl = e.target.closest("[data-dl]");
    if (o) ctx.openTab?.(o.dataset.open);
    if (dl?.dataset.dl === "json") download("metrics.json", JSON.stringify(ctx.metrics, null, 2), "application/json");
    if (dl?.dataset.dl === "gds" && el._gds) download(el._gds.split("/").pop(), await ctx.getFile(el._gds), "application/octet-stream");
  });
  render();
  return { update(c) { ctx = c; render(); }, destroy() { if (shot) URL.revokeObjectURL(shot); el.innerHTML = ""; } };
}
