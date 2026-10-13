import { call } from "./_rpc.js";
export const meta = { id: "netlistsvg", label: "Schematic", stage: "schematic", where: "browser", license: "MIT (netlistsvg), EPL-2.0 (elkjs)", sourceUrl: "https://github.com/nturley/netlistsvg" };
const url = new URL("./netlistsvg.worker.js", import.meta.url);
// Feed it rtl.json from the yosys engine (word-level, readable). netlist.json (gate level) also renders but is big.
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal });
