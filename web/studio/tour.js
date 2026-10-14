// Show-around tour: dims the page, cuts a hole around the real element, puts a small popover next to it.
const STEPS = [
  { el: "#runAll", t: "Run All", p: "Run All takes your design through every step to a chip layout. The example takes about 30 seconds." },
  { el: "#nav", t: "The steps", p: "These are the steps from Verilog to a chip, in order. Each one shows passed, warning or failed. Click one to see its results." },
  { el: "#filebar", t: "Your files", p: "Your Verilog and testbench live here. Edit, upload or add files." },
  { el: "#tabs", t: "Results", p: "Results open here: the schematic, waveforms, the placed layout, the final GDS in 2D or 3D, and timing." },
  { el: "#props", t: "Settings", p: "Settings for the selected step, like the clock period and die size.", open: true },
  { el: "#dock", t: "What the tools say", p: "Console, Raw logs and Messages show what the tools print. Messages lists warnings and errors." },
  { end: true, t: "That's it", p: "Press Run All to try the example." },
];
export function createTour({ onDone, onRunAll }) {
  const q = (s) => document.querySelector(s);
  let i = -1, hole, pop;
  function place() {
    const s = STEPS[i]; if (!s) return;
    if (s.open) q("#props")?.classList.remove("closed");
    let r = s.end ? null : q(s.el).getBoundingClientRect();
    if (r && s.grow) { const g = q(s.grow).getBoundingClientRect(); r = { left: r.left, top: r.top, right: r.right, bottom: g.bottom, width: r.width, height: g.bottom - r.top }; }
    const pad = 6;
    if (r) Object.assign(hole.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + 2 * pad + "px", height: r.height + 2 * pad + "px" });
    else Object.assign(hole.style, { left: "50%", top: "50%", width: "0", height: "0" });
    const pw = pop.offsetWidth, ph = pop.offsetHeight, W = innerWidth, H = innerHeight, g = 14;
    let x, y;
    if (!r) { x = (W - pw) / 2; y = (H - ph) / 2; }
    else if (r.bottom + g + ph < H && r.height < H * 0.4) { x = r.left; y = r.bottom + g + pad; }   // below (top bar, tabs)
    else if (r.right + g + pw < W) { x = r.right + g + pad; y = r.top; }                               // right of it (nav)
    else if (r.left - g - pw > 0) { x = r.left - g - pw - pad; y = r.top; }                            // left of it (props)
    else { x = r.left; y = r.top - g - ph - pad; }                                                     // above (dock)
    pop.style.left = Math.max(10, Math.min(W - pw - 10, x)) + "px"; pop.style.top = Math.max(10, Math.min(H - ph - 10, y)) + "px";
  }
  function show() {
    const s = STEPS[i], last = i === STEPS.length - 1;
    pop.replaceChildren();
    const add = (tag, txt, cls) => { const e = document.createElement(tag); e.textContent = txt; if (cls) e.className = cls; pop.append(e); };
    add("div", `${i + 1} of ${STEPS.length}`, "tcount"); add("h3", s.t); add("p", s.p);
    const row = Object.assign(document.createElement("div"), { className: "trow" });
    const b = (txt, f, cls) => { const e = document.createElement("button"); e.textContent = txt; if (cls) e.className = cls; e.onclick = f; row.append(e); };
    if (!last) b("Skip", () => end());
    if (i > 0) b("Back", () => go(i - 1));
    if (last) b("Run All", () => { end(); onRunAll(); }, "primary");
    b(last ? "Done" : "Next", () => (last ? end() : go(i + 1)), last ? "" : "primary");
    pop.append(row); place();
    row.lastElementChild.focus({ preventScroll: true });
  }
  const go = (n) => { i = n; show(); };
  function end() { if (i < 0) return; i = -1; hole.remove(); pop.remove(); removeEventListener("resize", place); removeEventListener("keydown", key, true); onDone(); }
  function key(e) {
    if (e.key === "Escape") end(); else if (e.key === "ArrowRight" && i < STEPS.length - 1) go(i + 1); else if (e.key === "ArrowLeft" && i > 0) go(i - 1); else return;
    e.preventDefault(); e.stopPropagation();
  }
  return { start() {
    if (i >= 0 || innerWidth < 700) return;   // phones get the phone gate instead
    hole = Object.assign(document.createElement("div"), { id: "tourHole" });
    pop = Object.assign(document.createElement("div"), { id: "tourPop" }); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Studio tour");
    document.body.append(hole, pop);
    addEventListener("resize", place); addEventListener("keydown", key, true); go(0);
  } };
}
