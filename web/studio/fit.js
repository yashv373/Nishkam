// "Will this design fit in LibreLane?" The browser flow sizes its own die from the synthesised cells only. LibreLane adds more cells
// (tap and endcap cells, a buffer on every port, repair buffers, clock buffers) and keeps a margin around the core, so a die that is
// 80% full here can be over 100% there. Every number below is measured from real LibreLane runs (gf180mcuD, tiny8 / mult8 / adder2 at
// dies 100, 120, 150, 170 um; parity/RESULTS.md and the run logs), not guessed. Pure functions, no browser APIs.
export const K = {
  siteH: 3.92, rowBottom: 15.68, rowsLost: 4,   // core rows: floor((dieH - 15.68) / 3.92) - 4 (measured: die 100 -> 17 rows, 120 -> 22, 150 -> 30, 170 -> ~35)
  coreXLoss: 13.8,                              // core width = die width - 13.8 um (measured 13.6 to 13.9)
  tapDist: 20, tapArea: 4.3904,                 // FP_TAPCELL_DIST 20: one tap per 2 x 20 um per row (checkerboard); tap and endcap are both 4.3904 um2
  pinAdjust: 0.11,                              // global placement pads the cells by this share for pin density (measured 9.8%, 9.9%, 12.4%)
  ioBufArea: 35.12,                             // one buffer per port (adder2: 33 ports, 33 buffers, 1159.07 um2)
  repair: 0.09,                                 // extra repair buffers as a share of the logic area (measured 0%, 4.9%, 9.0%; worst case used)
  clock: 0.063,                                 // clock tree buffers as a share of the logic area (tiny8: 513.7 of 8155; designs with flip-flops only)
};
export const coreOf = (dieW, dieH) => {
  const rows = Math.max(0, Math.floor((dieH - K.rowBottom) / K.siteH) - K.rowsLost), w = Math.max(0, dieW - K.coreXLoss);
  return { rows, w, area: w * rows * K.siteH };
};
// logic = synthesised cell area (um2), ports = number of port bits, clocked = design has flip-flops
export function estimate({ logic, ports, clocked, dieW, dieH }) {
  const c = coreOf(dieW, dieH), taps = Math.round((c.rows * c.w) / (2 * K.tapDist)), endcaps = 2 * c.rows;
  const tapA = taps * K.tapArea, endA = endcaps * K.tapArea, pinA = logic * K.pinAdjust;
  const io = ports * K.ioBufArea, rep = logic * K.repair, clk = clocked ? logic * K.clock : 0;
  const gpl = c.area - tapA > 0 ? (logic + pinA) / (c.area - tapA) : Infinity;   // what GPL-0301 checks (OpenROAD global placement)
  const total = logic + tapA + endA + io + rep + clk, util = c.area > 0 ? total / c.area : Infinity;
  return { core: c, taps, endcaps, parts: { logic, taps: tapA, endcaps: endA, io, rep, clk }, total, util, gpl, fail: gpl > 1 };
}
export const cellAreas = (lef) => Object.fromEntries([...lef.matchAll(/MACRO (\S+)[\s\S]*?SIZE ([\d.]+) BY ([\d.]+)/g)].map((m) => [m[1], m[2] * m[3]]));
export function netlistFacts(netlist, lef) {
  const size = cellAreas(lef); let logic = 0, clocked = false;
  for (const m of netlist.matchAll(/^\s*(gf180mcu_\w+)\s+\S+\s*\(/gm)) { logic += size[m[1]] || 0; if (/__(dff|sdff|latq|latrnq|latsnq|latrsnq)/.test(m[1])) clocked = true; }
  let ports = 0;
  for (const m of netlist.matchAll(/^\s*(?:input|output|inout)\s*(?:\[\s*(\d+)\s*:\s*(\d+)\s*\])?\s*[^;]+;/gm)) ports += (m[1] == null ? 1 : Math.abs(m[1] - m[2]) + 1) * m[0].replace(/\[[^\]]*\]/, "").replace(/^\s*\w+/, "").split(",").length;
  return { logic, ports, clocked };
}
const f0 = (v) => Math.round(v).toLocaleString("en-US"), pc = (v) => Math.round(v * 100) + "%";
export function describe(e, dieW, dieH) {
  const p = e.parts, lines = [
    `LibreLane fit check for a ${(+dieW).toFixed(1)} x ${(+dieH).toFixed(1)} µm die (core ${e.core.w.toFixed(1)} x ${(e.core.rows * K.siteH).toFixed(1)} µm = ${f0(e.core.area)} µm²):`,
    `  cells ${f0(p.logic)} µm² + taps and endcaps ${f0(p.taps + p.endcaps)} + port buffers ${f0(p.io)} + repair buffers ${f0(p.rep)}` + (p.clk ? ` + clock buffers ${f0(p.clk)}` : "") + ` = ${f0(e.total)} µm² = ${pc(e.util)} of the core.`,
    `  Global placement (where GPL-0301 is raised) sees ${pc(e.gpl)}: cells plus pin-density padding ${f0(p.logic * K.pinAdjust)} µm² over the core minus the taps.`,
  ];
  if (e.fail) lines.push(`WARNING: this die is too small for LibreLane. It would stop at placement with error GPL-0301 (over 100% full), even though the browser flow can place it. Try a die of (about ${f0(Math.sqrt(e.total / 0.7))} x ${f0(Math.sqrt(e.total / 0.7))} µm for about 70% fill).`);
  else if (e.util > 1) lines.push(`WARNING: the final cell count (${pc(e.util)} of the core) cannot fit in LibreLane on this die.`);
  return lines;
}
export const check = (netlist, lef, dieW, dieH) => { const e = estimate({ ...netlistFacts(netlist, lef), dieW, dieH }); return { ...e, lines: describe(e, dieW, dieH) }; };
