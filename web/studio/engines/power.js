import { call } from "./_rpc.js";
export const meta = { id: "power", label: "Power (estimate)", stage: "sta", where: "browser", license: "Nishkam (MIT); gf180mcu power data Apache-2.0", sourceUrl: "https://github.com/google/gf180mcu-pdk" };
const url = new URL("./sta.worker.js", import.meta.url);
// files: {"netlist.json", optional "*.vcd"}; options as sta.js plus defaultActivity=0.1 (toggles per clock cycle).
// outputs: power.rpt; summary.power {leakage_uW, internal_uW, switching_uW, total_uW, activitySource, estimate:true}
export const run = ({ files, options = {}, onLog, onProgress, signal }) =>
  call(url, { mode: "power", files, options }, { onLog, onProgress, signal });
