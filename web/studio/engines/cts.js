import { call } from "./_rpc.js";
export const meta = { id: "cts", label: "OpenROAD TritonCTS (clock tree)", stage: "cts", where: "browser", license: "BSD-3-Clause (OpenROAD; OpenSTA GPL-3.0 linked in)", sourceUrl: "https://github.com/The-OpenROAD-Project/OpenROAD" };
const url = new URL("./cts.worker.js", import.meta.url);
// files: {"<top>.def": placed DEF, "constraints.sdc": SDC}. options: {top, timeoutS}
// -> files {"<top>.def": DEF with the clock tree (same name, so routing takes it unchanged), cts.rpt, cts.log}, summary {clkbufs, sinks, latency_ns, skew_ns, ...}
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal, timeoutMs: (options.timeoutS ?? 300) * 1000 });
