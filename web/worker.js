// Runs Yosys (WebAssembly, ~70 MB, cached by the browser after the first load) off the UI thread.
import { runYosys, Exit } from "https://cdn.jsdelivr.net/npm/@yowasp/yosys@0.68.1207/gen/bundle.js";
import { grade } from "./grader.js";

self.onmessage = async ({ data: { id, problem, code } }) => {
  try {
    const result = await grade(
      (args, files, opts) => runYosys(args, files, {
        ...opts,
        fetchProgress: ({ doneLength, totalLength }) =>
          self.postMessage({ id, progress: totalLength ? doneLength / totalLength : 0 }),
      }),
      Exit, problem, code);
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, result: { passed: false, error: String(e && e.message || e) } });
  }
};
