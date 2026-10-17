// One shared avatar: the user's picture, or name initials on a blue glass circle.
// avatar(name, url, size) -> element. Styles are injected once, so any page can import this alone.
export const initials = (name) => {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean).map((x) => Array.from(x)[0]);
  return (w.length > 1 ? w[0] + w[w.length - 1] : w[0] || "?").toUpperCase();
};
if (!document.getElementById("nk-av-css")) {
  const s = document.createElement("style"); s.id = "nk-av-css";
  s.textContent = ".nk-av{display:inline-grid;place-items:center;flex:none;border-radius:50%;object-fit:cover;vertical-align:middle;color:#fff;font:600 12px/1 'Helvetica Neue',Helvetica,Inter,Arial,sans-serif;letter-spacing:.02em;background:linear-gradient(145deg,#6b7fff 0%,#1430ff 55%,#0a1a99 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),inset 0 0 0 1px rgba(255,255,255,.18)}";
  document.head.append(s);
}
export function avatar(name, url, size = 22) {
  const px = size + "px";
  const init = () => { const e = document.createElement("span"); e.className = "nk-av"; e.setAttribute("aria-hidden", "true"); e.textContent = initials(name); e.style.cssText = `width:${px};height:${px};font-size:${Math.round(size * 0.42)}px`; return e; };
  if (!url) return init();
  const i = new Image(size, size); i.className = "nk-av"; i.alt = ""; i.src = url; i.style.cssText = `width:${px};height:${px}`;
  i.onerror = () => i.replaceWith(init());
  return i;
}
