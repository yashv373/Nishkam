import { call } from "./_rpc.js";
export const meta = { id: "verilator-lint", label: "Verilator lint", stage: "lint", where: "browser", license: "LGPL-3.0 or Artistic-2.0 (Verilator), MIT (verilator-wasm)", sourceUrl: "https://github.com/wavedrom/verilator-wasm" };
const url = new URL("./verilator-lint.worker.js", import.meta.url);
// ok is false only for real errors; -Wall warnings come back in summary.messages. options.top optional.
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal });
