import { call } from "./_rpc.js";
export const meta = { id: "sta", label: "Timing (STA lite)", stage: "sta", where: "browser", license: "Nishkam (MIT); gf180mcu timing data Apache-2.0", sourceUrl: "https://github.com/google/gf180mcu-pdk" };
const url = new URL("./sta.worker.js", import.meta.url);
// files: {"netlist.json"} from the yosys synth engine.
// options: {clockPort="clk", periodNs=10, inputDelayNs=0, outputDelayNs=0, inputSlewNs=0.1, outputLoadPf=0.01, clockSlewNs=0, paths=10, top}
// outputs: timing.rpt, timing.json; summary {setup:{worst_slack_ns,wns_ns,tns_ns,...}, hold:{...}, fmax_mhz, area_um2}
// Pre-layout ESTIMATE: no wire load, ideal clock. Real signoff = OpenSTA via the runner.
export const run = ({ files, options = {}, onLog, onProgress, signal }) =>
  call(url, { mode: "sta", files, options }, { onLog, onProgress, signal });
