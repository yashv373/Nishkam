import { call } from "./_rpc.js";
export const meta = { id: "netgen", label: "Netgen (LVS)", stage: "signoff", where: "browser", license: "GPL (Netgen, upstream Emscripten build with Tcl 8.6)", sourceUrl: "https://github.com/RTimothyEdwards/netgen" };
const url = new URL("./lvs.worker.js", import.meta.url);
// files: {"<top>.spice": Magic extraction, "<top>.v": gate netlist}. options: {top, assumeWellTaps: true, flatten: true}
// -> {"<top>.lvs.txt"}, summary {match, devices:[layout,schematic], nets:[layout,schematic], result}
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal, timeoutMs: (options.timeoutS ?? 120) * 1000 });
