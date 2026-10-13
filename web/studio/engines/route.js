import { call } from "./_rpc.js";
export const meta = { id: "route", label: "Routing (qrouter)", stage: "route", where: "browser", license: "GPL-2.0 (qrouter, qflow utilities; WASM build by Nishkam)", sourceUrl: "https://github.com/RTimothyEdwards/qrouter" };
const url = new URL("./route.worker.js", import.meta.url);
// files: {"<top>.def", "<top>.obs"} from place.js. options: {top, layers}
export const run = ({ files, options = {}, onLog, onProgress, signal }) => call(url, { files, options }, { onLog, onProgress, signal, timeoutMs: (options.timeoutS ?? 120) * 1000 });
