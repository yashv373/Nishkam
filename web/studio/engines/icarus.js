import { call } from "./_rpc.js";
export const meta = { id: "icarus", label: "Icarus Verilog", stage: "sim", where: "browser", license: "GPL-2.0 (Icarus; wasm build by VeriSim)", sourceUrl: "https://github.com/senolgulgonul/verisim" };
const url = new URL("./icarus.worker.js", import.meta.url);
// Files must include a testbench that calls $dumpfile/$dumpvars to get a VCD back. options.generation: 2005|2009|2012
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal });
