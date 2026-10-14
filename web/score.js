// Area + max clock speed for a passed design. Only proven tools: Studio's Yosys flow (abc -liberty, stat -liberty
// on the trimmed gf180 7-track liberty) and Studio's OpenSTA (WebAssembly). Nothing is estimated here.
// One constraint set for every problem: 10 ns clock on `clk`, input/output delay 0, 0.05 pF on every output.
export const SCORE_NOTE = "Scored on gf180 7-track cells (typical corner, 5 V). Same timing setup for every problem: 10 ns clock, input and output delay 0, 0.05 pF output load. Speed = 1 / (10 ns - worst setup slack).";
export const REF_PERIOD_NS = 10;

// synth / sta: functions taking a request and returning the Studio engine result
// (browser: run() of engines/yosys.js and opensta.js; node: handle() of the *.worker.js files).
export async function scoreDesign(top, code, { synth, sta }) {
  const s = await synth({ mode: "synth", files: { [`${top}.v`]: code }, options: { top } });
  if (!s.ok) return { error: s.summary.messages?.find((m) => m.severity === "error")?.text || "synthesis failed" };
  const t = await sta({ files: { [`${top}.gate.v`]: s.files["netlist.v"] },
    options: { top, clockPort: "clk", periodNs: REF_PERIOD_NS, inputDelayNs: 0, outputDelayNs: 0, loadPf: 0.05 } });
  const slack = t.summary.setup_ws_ns; // null when OpenSTA finds no constrained path
  return { areaUm2: s.summary.area, cells: s.summary.cells, slackNs: slack, fmaxMhz: slack === null ? null : t.summary.fmax_mhz };
}

// stretch = { areaUm2?, mhz? } -> [{label, met}] for the targets that exist
export function stretchResults(stretch = {}, sc) {
  const r = [];
  if (stretch.areaUm2 != null) r.push({ label: `under ${stretch.areaUm2} µm²`, met: sc.areaUm2 <= stretch.areaUm2 });
  if (stretch.mhz != null) r.push({ label: `at ${stretch.mhz} MHz`, met: sc.fmaxMhz !== null && sc.fmaxMhz >= stretch.mhz });
  return r;
}
