import { call } from "./_rpc.js";
export const meta = { id: "opensta", label: "OpenSTA (timing + power)", stage: "sta", where: "browser", license: "GPL-3.0 (OpenSTA, upstream Emscripten build with Tcl 8.6)", sourceUrl: "https://github.com/parallaxsw/OpenSTA" };
const url = new URL("./opensta.worker.js", import.meta.url);
// files: {"<any>.v": Yosys gate netlist, optional "<any>.lib[.gz]": liberty (default: gf180mcu 7t5v0 tt 025C 5V full)}.
// options: {top, clockPort="clk", periodNs=10, inputDelayNs=0, outputDelayNs=0, loadPf=0, propagated=false (real clock tree: use the netlist after CTS)}
// -> files {timing.rpt, power.rpt}, summary {setup_ws_ns, setup_tns_ns, hold_ws_ns, hold_tns_ns, fmax_mhz, total_uW, ...}
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal, timeoutMs: (options.timeoutS ?? 180) * 1000 });
export { sdc } from "./opensta.worker.js";
