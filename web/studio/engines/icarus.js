import { call } from "./_rpc.js";
export const meta = { id: "icarus", label: "Icarus Verilog", stage: "sim", where: "browser", license: "GPL-2.0 (Icarus; wasm build by VeriSim)", sourceUrl: "https://github.com/senolgulgonul/verisim" };
const url = new URL("./icarus.worker.js", import.meta.url);
// Files must include a testbench that calls $dumpfile/$dumpvars to get a VCD back. options.generation: 2005|2009|2012
// options.timeoutMs (default 20000): wall-clock limit, the worker is killed after it. options.maxSimTime: sim-time cap (default 1e6 units).
export const run = async ({ files, options = {}, onLog, onProgress, signal }) => {
  const secs = (options.timeoutMs ?? 20000) / 1000, ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, secs * 1000);
  signal?.addEventListener("abort", () => ac.abort());
  try { return await call(url, { files, options }, { onLog, onProgress, signal: ac.signal }); }
  catch (e) {
    if (!timedOut) throw e;
    return { ok: false, files: {}, summary: { stage: "sim", error: `simulation did not finish in ${secs} s — add $finish to your testbench` } };
  } finally { clearTimeout(timer); }
};
