// KLayout-based GDS viewer (kwasm, GPL-3.0) in a same-origin iframe. 2D and 3D both live inside it.
// mount(el, { getBuffer: async()=>ArrayBuffer, view: "2d"|"3d" }) -> { setView(v), destroy() }
const BASE = new URL("../../vendor/kwasm/0.3.1/", import.meta.url);
// Stack: layer order and GDS numbers from gf180mcu.map; metal THICKNESS from the PDK tech LEF
// (gf180mcu_fd_sc_mcu7t5v0__nom.tlef: Metal1-4 0.54, Metal5 1.19 um). The PDK gives no z positions, ILD or via
// heights (gf180mcu.lyt <d25> is empty), so every gap is one equal display value, GAP, NOT from the PDK.
const GAP = 0.54;
const T = { 34: 0.54, 36: 0.54, 42: 0.54, 46: 0.54, 81: 1.19 };
const ORDER = [[34, "metal1"], [35, "via1"], [36, "metal2"], [38, "via2"], [42, "metal3"], [40, "via3"], [46, "metal4"], [41, "via4"], [81, "metal5"]];
export const GF180_STACK = { layers: {} };
{ let z = 0, prev = 0;
  for (const [n, name] of ORDER) {
    if (T[n]) { GF180_STACK.layers[name] = { layer: { layer: [n, 0] }, zmin: z, thickness: T[n], material: "al", info: {} }; z += T[n]; prev = 0; }
    else { GF180_STACK.layers[name] = { layer: { layer: [n, 0] }, zmin: z, thickness: GAP, material: "w", info: {} }; z += GAP; }
  } }
export const NOTE = "3D not to scale: layer order from PDK, thickness from tech LEF, gaps not from PDK";
let lypText;
const lyp = () => (lypText ||= fetch(new URL("gf180mcu.lyp", BASE)).then((r) => r.text()));

export function mount(el, opts) {
  const fr = document.createElement("iframe");
  fr.src = new URL("host.html", BASE); fr.style.cssText = "width:100%;height:100%;border:0;display:block";
  el.appendChild(fr);
  const lab = document.createElement("div"); lab.textContent = NOTE;
  lab.style.cssText = "position:absolute;left:10px;bottom:56px;z-index:6;font:11px system-ui;color:#ffb020;background:rgba(7,8,12,.8);padding:3px 8px;border-radius:6px;pointer-events:none";
  el.appendChild(lab);
  const pend = new Map(); let n = 0, ready, dead = false;
  const hostReady = new Promise((r) => (ready = r));
  const onMsg = (e) => {
    if (e.source !== fr.contentWindow || !e.data) return;
    if (e.data.nk === "hostready") ready();
    else if (e.data.nk === "reply") { const p = pend.get(e.data.id); pend.delete(e.data.id); p && (e.data.error ? p[1](new Error(e.data.error)) : p[0](e.data)); }
  };
  addEventListener("message", onMsg);
  const call = async (m) => { await hostReady; return new Promise((res, rej) => { const id = ++n; pend.set(id, [res, rej]); fr.contentWindow.postMessage({ nk: m.nk, id, ...m }, "*", m.gds ? [m.gds] : []); }); };
  const loaded = (async () => {
    const [gds, lypX] = await Promise.all([opts.getBuffer(), lyp()]);
    if (dead) return;
    return call({ nk: "load", gds, lyp: lypX, layerstack: GF180_STACK, view: opts.view || "2d" });
  })();
  return { loaded, setView: (v) => loaded.then(() => call({ nk: "view", view: v })), destroy() { dead = true; removeEventListener("message", onMsg); fr.remove(); lab.remove(); } };
}
