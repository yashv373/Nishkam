import { CONFIG } from "./config.js";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const main = $("main");
const say = (h) => (main.innerHTML = h);
const NONE = (t) => `<tr><td class="muted">${t}</td></tr>`;
if (!CONFIG.api || !CONFIG.firebase.apiKey) say(`<p class="muted">Not set up.</p>`);
else {
  const V = "https://www.gstatic.com/firebasejs/11.0.2/";
  const [{ initializeApp }, mod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js")]);
  const auth = mod.getAuth(initializeApp(CONFIG.firebase)), API = CONFIG.api.replace(/\/$/, "");
  const call = async (path, body) => {
    const r = await fetch(API + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + await auth.currentUser.getIdToken(), "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Error " + r.status);
    return r.json();
  };
  async function show() {
    try {
      const s = await call("/admin/stats"), f = s.flags;
      const card = (n, l) => `<div class="card"><b>${esc(n)}</b><span>${esc(l)}</span></div>`;
      const tog = (k, l) => `<div class="row"><button class="${f[k] === "on" ? "on" : ""}" data-k="${k}" data-v="${f[k] === "on" ? "off" : "on"}">${l}: ${f[k]}</button><span class="muted">Click to switch.</span></div>`;
      const pp = Object.entries(s.solves.perProblem).sort((a, b) => b[1] - a[1]).map(([id, n]) => `<tr><td>${esc(id)}</td><td>${n}</td></tr>`).join("");
      say(`<h2>People</h2><div class="cards">${card(s.users, "accounts")}${card(s.signups.today, "new today")}${card(s.signups.d7, "new, 7 days")}${card(s.signups.d30, "new, 30 days")}${card(s.active7, "active, 7 days")}</div>
        <h2>Work</h2><div class="cards">${card(s.solves.total, "solves")}${card(s.reviews.total, "AI explanations used")}${card(s.reviews.today, "AI explanations today")}</div>
        <table>${pp || NONE("No solves yet.")}</table>
        <h2>Switches</h2>${tog("ai_review", "AI explanations")}${tog("signups", "New sign-ups")}${tog("studio", "Practice and Studio")}
        <div class="row"><input type="text" id="banner" maxlength="300" placeholder="Banner text for the top of the pages (empty = none)" value="${esc(f.banner)}"><button id="saveBanner">Save banner</button></div>
        <h2>Website visits</h2><p><a href="https://dash.cloudflare.com/?to=/:account/web-analytics" target="_blank" rel="noopener">Open Cloudflare Web Analytics</a></p>
        <h2>Last 50 admin actions</h2><table>${s.log.map((l) => `<tr><td>${esc(new Date(l.at).toLocaleString())}</td><td>${esc(l.who)}</td><td>${esc(l.what)}</td></tr>`).join("") || NONE("None yet.")}</table>
        <p id="msg" class="err"></p>`);
      const set = async (key, value) => { try { await call("/admin/flags", { key, value }); show(); } catch (e) { $("msg").textContent = e.message; } };
      main.querySelectorAll("button[data-k]").forEach((b) => (b.onclick = () => set(b.dataset.k, b.dataset.v)));
      $("saveBanner").onclick = () => set("banner", $("banner").value.trim());
    } catch (e) { say(`<p class="err">${esc(e.message)}</p>`); }
  }
  mod.onAuthStateChanged(auth, (u) => (u ? show() : say(`<p>Sign in on the <a href="app.html">practice page</a> first, then come back.</p>`)));
}
