import { call } from "./_rpc.js";
export const meta = { id: "place", label: "Placement (graywolf)", stage: "place", where: "browser", license: "GPL-2.0 (graywolf, qrouter/qflow utilities; WASM build by Nishkam)", sourceUrl: "https://github.com/RTimothyEdwards/graywolf" };
const url = new URL("./place.worker.js", import.meta.url);
// files: one gate-level netlist "<top>.v" using gf180mcu_fd_sc_mcu7t5v0 cells. options: {top, layers}
// -> {"<top>.def" placed+filled, "<top>.obs", "<top>.info", ...}. Tested on small designs only (tens of cells).
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal });
