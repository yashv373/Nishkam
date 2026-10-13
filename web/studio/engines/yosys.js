import { call } from "./_rpc.js";
export const meta = { id: "yosys", label: "Yosys", stage: "lint+synth", where: "browser", license: "ISC (Yosys), Apache-2.0 (YoWASP, gf180mcu lib)", sourceUrl: "https://github.com/YoWASP/yosys" };
const url = new URL("./yosys.worker.js", import.meta.url);
// options.mode: "lint" | "synth" (default "synth"); options.top: top module (default: auto)
// synth outputs: netlist.v, netlist.json (mapped), rtl.json (for the schematic), stat.txt; summary {cells, area, kinds}
export const run = ({ files, options = {}, onLog, onProgress, signal }) =>
  call(url, { mode: options.mode || "synth", files, options }, { onLog, onProgress, signal });
