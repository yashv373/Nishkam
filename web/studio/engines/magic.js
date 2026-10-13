import { call } from "./_rpc.js";
export const meta = { id: "magic", label: "Magic (GDS + DRC)", stage: "signoff", where: "browser", license: "GPL-2.0 (Magic VLSI, upstream Emscripten build)", sourceUrl: "https://github.com/RTimothyEdwards/magic" };
const url = new URL("./magic.worker.js", import.meta.url);
// files: {"<top>.def"} routed DEF from route.js. options: {top, drc: true, extract: false} -> {"<top>.gds"}, summary.drcErrors/drcRules
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal, timeoutMs: (options.timeoutS ?? 120) * 1000 });
