// Tiny Tapeout Explorer (Apache-2.0, A. Mordvintsev) in a same-origin iframe, fed a blob: URL of the GDS.
// mount(el, { getBuffer: async()=>ArrayBuffer }) -> { destroy() }. Nothing is uploaded.
const VIEWER = new URL("../../vendor/tt-explorer/59a43fb/viewer.html", import.meta.url);

export function mount(el, opts) {
  const fr = document.createElement("iframe");
  fr.style.cssText = "width:100%;height:100%;border:0;display:block";
  el.appendChild(fr);
  let url, dead = false;
  opts.getBuffer().then((buf) => {
    if (dead) return;
    url = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
    const u = new URL(VIEWER); u.searchParams.set("file", url); u.searchParams.set("pdk", "gf180mcuD");
    fr.src = u;
  });
  return { destroy() { dead = true; fr.remove(); url && URL.revokeObjectURL(url); } };
}
