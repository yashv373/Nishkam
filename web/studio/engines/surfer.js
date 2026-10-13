// Surfer waveform viewer (EUPL-1.2), self-hosted prebuilt WASM, shown in an iframe. Not a Worker engine.
export const meta = { id: "surfer", label: "Waveform", stage: "sim", where: "browser", license: "EUPL-1.2", sourceUrl: "https://gitlab.com/surfer-project/surfer" };
const SRC = new URL("../../vendor/surfer/20261009/index.html", import.meta.url).href;

// Mount a Surfer iframe in `container`. Returns {frame, load(vcdText), destroy()}.
// Surfer fetches the file by URL, so the VCD goes in as a same-origin blob: URL.
export function mount(container) {
  const frame = document.createElement("iframe");
  frame.src = SRC;
  frame.style.cssText = "width:100%;height:100%;border:0";
  frame.title = "Waveform";
  let blob;
  const ready = new Promise((res) => frame.addEventListener("load", res, { once: true }));
  container.append(frame);
  return {
    frame,
    // ponytail: waits for the iframe load event, not Surfer's own wasm init; if the first load is dropped, retry after a short delay
    async load(vcd) {
      await ready;
      if (blob) URL.revokeObjectURL(blob);
      blob = URL.createObjectURL(new Blob([vcd], { type: "text/plain" }));
      frame.contentWindow.postMessage({ command: "LoadUrl", url: blob }, "*");
    },
    destroy() { if (blob) URL.revokeObjectURL(blob); frame.remove(); },
  };
}
