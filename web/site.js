// Shared by landing, practice and Studio. Does nothing until config.js is filled in.
let cfg = null;
try { cfg = (await import("./config.js")).CONFIG; } catch { /* no config */ }
if (cfg?.cfBeacon) {
  const s = document.createElement("script");
  s.defer = true; s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.cfBeacon }));
  document.head.appendChild(s);
}
if (cfg?.api) {
  try {
    const f = await (await fetch(cfg.api.replace(/\/$/, "") + "/flags")).json();
    const box = (css, text) => { const d = document.createElement("div"); d.style.cssText = css; d.textContent = text; return d; };
    const page = location.pathname.split("/").pop() || "index.html";
    if (f.studio === "off" && (page === "app.html" || page === "studio.html"))
      document.body.appendChild(box("position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#000;color:#fff;font:18px/1.5 sans-serif;text-align:center;padding:24px", "Nishkam is paused for maintenance. Please come back soon."));
    if (f.banner)
      document.body.prepend(box("padding:10px 16px;background:#1430ff;color:#fff;font:14px/1.4 sans-serif;text-align:center", f.banner));
  } catch { /* backend unreachable: page is unchanged */ }
}
