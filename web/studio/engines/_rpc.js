// Shared by every engine: run a request in a lazy-started module Web Worker.
// Worker protocol: post {id, ...req}; worker replies {id, log}, {id, progress}, {id, result} or {id, error}.
const workers = new Map();

export function call(workerUrl, req, { onLog, onProgress, signal } = {}) {
  let w = workers.get(workerUrl.href);
  if (!w) { w = new Worker(workerUrl, { type: "module" }); workers.set(workerUrl.href, w); }
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const done = () => { w.removeEventListener("message", on); signal?.removeEventListener("abort", abort); };
    const abort = () => { // ponytail: abort kills the worker (and its loaded wasm); next call restarts it
      done(); w.terminate(); workers.delete(workerUrl.href); reject(new DOMException("aborted", "AbortError"));
    };
    const on = ({ data }) => {
      if (data.id !== id) return;
      if (data.log !== undefined) onLog?.(data.log);
      else if (data.progress !== undefined) onProgress?.(data.progress);
      else { done(); data.error ? reject(new Error(data.error)) : resolve(data.result); }
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort);
    w.addEventListener("message", on);
    w.postMessage({ id, ...req });
  });
}

// Worker side: wire a pure handler(req, {log, progress}) to messages. Inactive under Node.
export function serve(handler) {
  if (typeof WorkerGlobalScope === "undefined" || !(self instanceof WorkerGlobalScope)) return;
  self.onmessage = async ({ data: { id, ...req } }) => {
    try {
      const result = await handler(req, {
        log: (log) => self.postMessage({ id, log }),
        progress: (progress) => self.postMessage({ id, progress }),
      });
      self.postMessage({ id, result });
    } catch (e) { self.postMessage({ id, error: String((e && e.message) || e) }); }
  };
}

// Read a URL as text in the browser or in Node (file: URLs).
export async function readText(url) {
  if (url.protocol === "file:") return (await import("node:fs/promises")).readFile(url, "utf8");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
  return r.text();
}

export const text = (v) => (typeof v === "string" ? v : new TextDecoder().decode(v));
