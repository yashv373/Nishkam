import { STAGES, GROUPS } from "./stages.js";
const ICON = { idle: "○", queued: "◔", running: "", passed: "✓", warn: "!", failed: "✕", unavailable: "–", stale: "●" };
const LABEL = { idle: "not run", queued: "queued", running: "running", passed: "passed", warn: "warnings", failed: "failed", unavailable: "unavailable", stale: "stale" };
export const HINT = { sim: "Usually a few seconds. The first run downloads the simulator.", synth: "Usually 5 to 15 seconds. The first run downloads Yosys (about 70 MB).",
  place: "Can take a few seconds to a minute.", route: "Can take a few seconds to a minute.", sta: "Usually a few seconds.", signoff: "Usually 5 to 15 seconds. The first run downloads Magic and Netgen." };
// state: {id: {st, info, t}}  cb: {select, run, runTo, runFrom}
export function renderNavigator(el, state, selected, cb, runnerOn) {
  el.replaceChildren();
  GROUPS.forEach((g, gi) => {
    const h = document.createElement("div"); h.className = "navgroup"; h.textContent = g; el.append(h);
    for (const s of STAGES.filter((x) => x.group === gi)) {
      const v = state[s.id] || { st: "idle" };
      const row = document.createElement("div");
      row.className = `stage st-${v.st}` + (selected === s.id ? " sel" : ""); row.tabIndex = 0; row.dataset.id = s.id;
      const why = v.st === "unavailable" ? (v.info || "needs local runner")
        : s.where === "runner" && !runnerOn ? "needs local runner" : "";
      row.title = why || (v.st === "running" && HINT[s.id]) || LABEL[v.st];
      const ico = document.createElement("span"); ico.className = "sico"; ico.textContent = ICON[v.st];
      const name = document.createElement("span"); name.className = "sname"; name.textContent = s.label;
      const chip = document.createElement("span"); chip.className = "chip st-" + v.st;
      chip.append(Object.assign(document.createElement("i"), { className: "dot" }),
        document.createTextNode(v.st === "running" && v.t ? v.t + "s" : v.st === "warn" && v.info ? v.info : (why && v.st === "idle" ? "runner" : LABEL[v.st])));
      row.append(ico, name, chip);
      if (!s.virtual) {
        const b = document.createElement("button"); b.className = "play"; b.title = "Run this stage"; b.setAttribute("aria-label", "Run " + s.label); b.textContent = "▶";
        b.onclick = (e) => { e.stopPropagation(); cb.run(s.id); }; row.append(b);
      }
      row.onclick = () => cb.select(s.id);
      row.onkeydown = (e) => { if (e.key === "Enter") cb.select(s.id); };
      row.oncontextmenu = (e) => { e.preventDefault(); cb.menu(s.id, e.clientX, e.clientY); };
      el.append(row);
    }
  });
}
