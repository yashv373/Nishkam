// Surfer waveform viewer (EUPL-1.2), self-hosted prebuilt WASM, shown in an iframe. Not a Worker engine.
export const meta = { id: "surfer", label: "Waveform", stage: "sim", where: "browser", license: "EUPL-1.2", sourceUrl: "https://gitlab.com/surfer-project/surfer" };
const SRC = new URL("../../vendor/surfer/20261009/index.html", import.meta.url).href;

// First `$scope module <name>` in the VCD: the testbench top we add to the view.
const topScope = (vcd) => (/\$scope\s+module\s+(\S+)/.exec(vcd) || [])[1];

// Mount a Surfer iframe in `container`. Returns {frame, load(vcdText), destroy()}.
// Surfer fetches the file by URL, so the VCD goes in as a same-origin blob: URL.
export function mount(container) {
  const frame = document.createElement("iframe");
  frame.src = SRC;
  frame.style.cssText = "width:100%;height:100%;border:0";
  frame.title = "Waveform";
  let blob, lastVcd;
  const ready = new Promise((res) => frame.addEventListener("load", res, { once: true }));
  container.append(frame);
  const send = (msg) => frame.contentWindow.inject_message?.(JSON.stringify(msg));
  return {
    frame,
    // Callers may retry while Surfer's wasm boots; the same VCD keeps the same blob URL, so a retry
    // never revokes a URL Surfer is still fetching.
    async load(vcd) {
      await ready;
      if (vcd !== lastVcd) {
        if (blob) URL.revokeObjectURL(blob);
        blob = URL.createObjectURL(new Blob([vcd], { type: "text/plain" }));
        lastVcd = vcd;
      }
      frame.contentWindow.postMessage({ command: "LoadUrl", url: blob }, "*");
      // Unstable Surfer API (Message::AddScope(ScopeRef, recursive)); harmless if it changes, the user can
      // still add signals by hand. Sent after a beat so the file has loaded.
      const top = topScope(vcd);
      if (top) setTimeout(() => { send({ AddScope: [{ strs: [top], id: "None" }, true] }); send("ZoomToFit"); }, 800);
    },
    destroy() { if (blob) URL.revokeObjectURL(blob); frame.remove(); },
  };
}
