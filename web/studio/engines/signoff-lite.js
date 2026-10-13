import { call } from "./_rpc.js";
export const meta = { id: "signoff-lite", label: "Timing & Power (pre-layout)", stage: "presta", where: "browser", license: "Nishkam (MIT); gf180mcu timing data Apache-2.0", sourceUrl: "https://github.com/google/gf180mcu-pdk" };
const url = new URL("./sta.worker.js", import.meta.url);
// Studio options -> STA options. Reads netlist.json (+ the sim VCD for activity). Pre-layout ESTIMATE.
export const run = ({ files, options = {}, onLog, onProgress, signal }) =>
  call(url, { mode: "both", files, options: { clockPort: options.clockPort, periodNs: options.clockPeriod, top: options.top } }, { onLog, onProgress, signal });
