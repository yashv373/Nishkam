import { CONFIG } from "./config.js";
import { PROBLEMS } from "./problems.js";
import { avatar } from "./avatar.js";
const main = document.getElementById("main");
// tiny DOM builder: text always goes through textContent / text nodes
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const show = (...n) => main.replaceChildren(...n);
const Q = new URLSearchParams(location.search);
// Test-only, localhost only: ?mock=1 | admin | out | err, plus &delay=ms. No network.
const MOCK = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && Q.has("mock") ? Q.get("mock") : null;
const byId = Object.fromEntries(PROBLEMS.map((p) => [p.id, p]));
const BADGES = [
  ["First solve", "Solve any problem.", (s) => s.length >= 1],
  ["5 solved", "Solve 5 problems.", (s) => s.length >= 5],
  ["All problems", "Solve every problem.", (s) => PROBLEMS.every((p) => s.includes(p.id))],
  ["All Easy", "Solve every Easy problem.", (s) => PROBLEMS.filter((p) => p.difficulty === "Easy").every((p) => s.includes(p.id))],
  ["First Hard", "Solve any Hard problem.", (s) => PROBLEMS.some((p) => p.difficulty === "Hard" && s.includes(p.id))],
  ["Clock crossing", "Solve a CDC problem.", (s) => s.some((id) => id.startsWith("cdc-"))],
  ["Physical design", "Solve squeeze-tiny8.", (s) => s.includes("squeeze-tiny8")],
  ["Top 10", "Reach the top 10 on the leaderboard.", (s, me) => me.points > 0 && me.rank <= 10],
];
const fmt = (t) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const card = (title, ...kids) => h("section", { className: "card" }, h("h2", {}, title), ...kids);
const stat = (n, l) => h("div", {}, h("b", {}, String(n)), h("span", {}, l));

// ---- account menu (same pattern as the practice page: WAI-ARIA menu button) ----
let menuOpen = false;
function menu(items, label, avatar) {
  const wrap = h("div", { className: "dd" }), pnl = h("div", { className: "ddpanel", role: "menu" });
  const trg = h("button", { className: "pill ddtrg" }, ...avatar, label);
  trg.setAttribute("aria-haspopup", "menu"); trg.setAttribute("aria-expanded", "false");
  trg.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
  pnl.append(...items);
  const mis = () => [...pnl.querySelectorAll('[role="menuitem"]')];
  const close = (back) => { wrap.classList.remove("open"); trg.setAttribute("aria-expanded", "false"); menuOpen = false; if (back) trg.focus(); };
  const open = () => { wrap.classList.add("open"); trg.setAttribute("aria-expanded", "true"); menuOpen = true; mis()[0]?.focus(); };
  trg.onclick = () => (menuOpen ? close(true) : open());
  trg.onkeydown = (e) => { if (e.key === "ArrowDown" && !menuOpen) { e.preventDefault(); open(); } };
  pnl.onkeydown = (e) => {
    const l = mis(), i = l.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); l[(i + 1) % l.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); l[(i - 1 + l.length) % l.length].focus(); }
    else if (e.key === "Tab") close();
  };
  wrap.append(trg, pnl);
  return wrap;
}
document.addEventListener("click", (e) => { const w = document.querySelector(".dd.open"); if (w && !w.contains(e.target)) { w.classList.remove("open"); w.firstChild.setAttribute("aria-expanded", "false"); menuOpen = false; } });
const mi = (t, o = {}) => h(o.href ? "a" : "button", { className: "mi", role: "menuitem", tabIndex: -1, textContent: t, ...(o.href && { href: o.href }), ...(o.on && { onclick: o.on }) });
function drawBar(u, me, signOut, signIn) {
  const box = document.getElementById("auth"), pts = document.getElementById("pts");
  menuOpen = false;
  if (!u) { pts.hidden = true; return box.replaceChildren(menu([mi("Continue with Google", { on: signIn })], "Sign in", [])); }
  const full = me?.name || u.displayName || u.email || "Signed in";
  const av = avatar(full, me?.avatar_url, 22);
  const head = h("div", { className: "mh" }, h("b", {}, full), ...(me?.handle ? [h("span", {}, "@" + me.handle)] : []));
  box.replaceChildren(menu([head, mi("My profile", { href: "profile.html" }), ...(me?.is_admin ? [mi("Admin panel", { href: "admin.html" })] : []), h("hr"), mi("Sign out", { on: signOut })], full.split(/\s+/)[0], [av]));
  if (me) { pts.hidden = false; pts.textContent = `${me.points} pt${me.points === 1 ? "" : "s"}`; }
}

// ---- states ----
const sk = (w, hgt, extra = "") => h("div", { className: "sk", style: `width:${w};height:${hgt}px;${extra}` });
const skeleton = () => { main.setAttribute("aria-busy", "true"); show(
  h("div", { className: "card", style: "padding:24px" }, sk("100%", 64, "margin-bottom:16px"), sk("96px", 96, "border-radius:50%;margin-bottom:16px"), sk("60%", 24, "margin-bottom:8px"), sk("40%", 16, "margin-bottom:16px"), sk("100%", 48)),
  h("div", {}, sk("50%", 32, "margin-bottom:16px"), sk("100%", 140, "margin-bottom:16px"), sk("100%", 140, "margin-bottom:16px"), sk("100%", 200))); };
const errorCard = (what, retry) => { show(h("div", { className: "card center" }, h("h1", {}, "Could not load your profile"), h("p", { className: "muted" }, what), h("button", { className: "btn blue", textContent: "Retry", onclick: retry }))); };
const signedOutCard = (go, msg) => { drawBar(null, null, null, go); show(h("div", { className: "card center" }, h("h1", {}, "Sign in to Nishkam"),
  h("p", { className: "muted" }, "Save your progress, earn points, and get 2 free AI hints."), h("button", { className: "btn blue", textContent: "Continue with Google", onclick: go }), msg)); };

// ---- the profile ----
function view(me, board, u, api, signOut) {
  main.removeAttribute("aria-busy");
  const solved = (me.solved || []).filter((id) => byId[id]);
  const idCard = () => {
    const last = byId[solved[solved.length - 1]];
    const status = last ? "Just solved " + last.title : "Just joined Nishkam";
    const nm = me.name || u.displayName || "You";
    return h("aside", { className: "card id", "aria-label": "Your profile" }, h("div", { className: "gh", ariaHidden: "true" }, h("i", { className: "l1" }), h("i", { className: "l2" }), h("div", { className: "gl" })), h("div", { className: "body" },
      h("div", { className: "avrow" }, Object.assign(avatar(nm, me.avatar_url, 96), { className: "nk-av ring" }), h("div", { className: "bubble" }, status)),
      h("h1", { className: "name" }, nm), h("p", { className: "hd" }, "@" + (me.handle || "")),
      me.bio ? h("p", { className: "bio" }, me.bio) : h("p", { className: "bio empty" }, "Add a short bio in Edit profile."),
      h("p", { className: "lab" }, "Member since"), h("p", { style: "margin:0" }, me.created ? fmt(me.created) : "-"),
      h("p", { className: "lab" }, "Rank"), h("div", { className: "rank" }, h("b", {}, me.rank ? `#${me.rank} of ${me.total_users}` : "-"), h("span", {}, `${me.points ?? solved.length} points`))));
  };
  let idEl = idCard();
  const repaint = () => { idEl.replaceWith((idEl = idCard())); drawBar(u, me, signOut); };

  // Board
  const lvls = ["Easy", "Medium", "Hard"].map((d) => { const all = PROBLEMS.filter((p) => p.difficulty === d); return [d, all.filter((p) => solved.includes(p.id)).length, all.length]; });
  const board_ = [];
  if (me.is_admin) board_.push(h("div", { className: "welcome" }, h("p", {}, "Welcome back to Project Nishkam, sir."), h("a", { className: "btn blue", href: "admin.html" }, "Open admin panel")));
  board_.push(card("Badges", h("div", { className: "badges" }, ...BADGES.map(([name, how, test]) => { const on = test(solved, me); return h("div", { className: "badge" + (on ? " on" : "") }, h("b", {}, (on ? "Earned: " : "Locked: ") + name), h("span", {}, how)); }))));
  board_.push(card("Stats", h("div", { className: "stats" }, stat(`${solved.length} of ${PROBLEMS.length}`, "solved"), stat(me.points ?? solved.length, "points"), stat(me.rank ? "#" + me.rank : "-", "rank"), stat(`${me.reviews_left ?? 0} of 2`, "AI hints left")),
    h("div", { className: "bars" }, ...lvls.map(([d, n, t]) => h("div", { className: "bar" }, h("span", {}, d), h("i", {}, h("s", { style: `width:${t ? (100 * n) / t : 0}%` })), h("em", {}, `${n}/${t}`))))));
  board_.push(card("Problems solved", solved.length ? h("ul", { className: "chips" }, ...solved.map((id) => h("li", {}, h("a", { href: "app.html?" + encodeURIComponent(id) }, byId[id].title + " · " + byId[id].difficulty)))) : h("p", { className: "muted", style: "margin:0" }, "Nothing solved yet. Pick a problem on the practice page.")));
  if (board) {
    const row = (r, own) => h("tr", { className: own ? "me" : "" }, h("td", {}, "#" + r.rank), h("td", {}, h("span", { className: "lbn" }, avatar(r.display_name || r.first_name || r.handle, r.avatar_url, 20), "@" + r.handle + (r.first_name ? " · " + r.first_name : ""))), h("td", {}, String(r.points)));
    const top = board.rows.slice(0, 10).map((r) => row(r, r.handle === me.handle));
    if (!board.rows.slice(0, 10).some((r) => r.handle === me.handle)) top.push(row({ rank: me.rank, handle: me.handle, first_name: (me.name || "").split(" ")[0], display_name: me.name, avatar_url: me.avatar_url, points: me.points }, true));
    board_.push(card("Leaderboard", h("table", {}, h("tbody", {}, ...top))));
  }

  // Edit profile
  const hIn = h("input", { id: "f-handle", value: me.handle || "", maxLength: 20, autocapitalize: "none", spellcheck: false, autocomplete: "off" });
  const nIn = h("input", { id: "f-name", value: me.name || "", maxLength: 40, autocomplete: "off" }), nMsg = h("p", { className: "msg", id: "f-name-msg" });
  nIn.setAttribute("aria-describedby", "f-name-msg");
  const hMsg = h("p", { className: "msg", id: "f-handle-msg" }), bMsg = h("p", { className: "msg", id: "f-bio-msg" }), sMsg = h("p", { className: "msg", role: "status" });
  hIn.setAttribute("aria-describedby", "f-handle-msg");
  const bIn = h("textarea", { id: "f-bio", value: me.bio || "", maxLength: 160 }); bIn.setAttribute("aria-describedby", "f-bio-msg f-bio-n");
  const cnt = h("p", { className: "count", id: "f-bio-n" });
  const upd = () => { cnt.textContent = `${[...bIn.value].length} / 160`; };
  bIn.oninput = upd; upd();
  const flag = (el, t, cls = "bad") => { el.textContent = t; el.className = "msg " + cls; };
  const save = h("button", { className: "btn blue", textContent: "Save", type: "button", id: "f-save" });
  save.onclick = async () => {
    flag(nMsg, ""); flag(hMsg, ""); flag(bMsg, ""); flag(sMsg, "");
    const nv = nIn.value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (![...nv].length || [...nv].length > 40) return flag(nMsg, "Name must be 1-40 characters.");
    const hv = hIn.value.trim().toLowerCase(), bv = bIn.value.trim();
    if (!/^[a-z0-9_]{3,20}$/.test(hv)) return flag(hMsg, "Handles are 3-20 characters: a-z, 0-9 and _.");
    if ([...bv].length > 160) return flag(bMsg, "Bio is 160 characters at most.");
    const doH = hv !== me.handle, doB = bv !== (me.bio || ""), doN = nv !== (me.name || "");
    if (!doH && !doB && !doN) return flag(sMsg, "Nothing to change.", "");
    save.disabled = true; save.textContent = "Saving…";
    let bad = false;
    if (doN) { const r = await api("/me/name", { name: nv }); if (r.error) { flag(nMsg, r.error); bad = true; } else { me.name = r.name; nIn.value = r.name; } }
    if (doH) { const r = await api("/me/handle", { handle: hv }); if (r.error) { flag(hMsg, r.error); bad = true; } else { me.handle = r.handle; hIn.value = r.handle; } }
    if (doB) { const r = await api("/me/bio", { bio: bv }); if (r.error) { flag(bMsg, r.error); bad = true; } else { me.bio = r.bio; bIn.value = r.bio; upd(); } }
    save.disabled = false; save.textContent = "Save";
    repaint();
    flag(sMsg, bad ? "Some changes were not saved." : "Saved.", bad ? "bad" : "good");
  };
  // Picture: pick -> centred square crop (drag / arrows / zoom) -> 128x128 WebP (JPEG fallback) <= 16 KB -> upload
  const OUT = 128, BOX = 192, MAX = 16 * 1024;
  const pMsg = h("p", { className: "msg", role: "status" }), prev = h("span", {});
  const showPrev = () => prev.replaceChildren(avatar(me.name, me.avatar_url, 64));
  showPrev();
  const file = h("input", { type: "file", accept: "image/*", hidden: true, id: "f-pic" });
  const pickBtn = h("button", { className: "btn ghost", type: "button", textContent: "Choose picture", onclick: () => file.click() });
  const rmBtn = h("button", { className: "btn ghost", type: "button", textContent: "Remove picture", hidden: !me.avatar_url });
  const cropBox = h("div", { className: "crop", hidden: true });
  let img, zoom = 1, cx = 0, cy = 0;
  const cv = h("canvas", { width: BOX, height: BOX, tabIndex: 0 }); cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "Crop preview. Drag, or use the arrow keys, to move the picture.");
  const zm = h("input", { type: "range", min: 1, max: 3, step: 0.05, value: 1 }); zm.setAttribute("aria-label", "Zoom");
  const useBtn = h("button", { className: "btn blue", type: "button", textContent: "Use this picture" }), noBtn = h("button", { className: "btn ghost", type: "button", textContent: "Cancel" });
  const base = (size) => size / Math.min(img.width, img.height);
  const draw = (ctx, size) => { // cover the square, centred on (cx, cy)
    const k = base(size) * zoom;
    cx = Math.min(Math.max(cx, size / 2 / k), img.width - size / 2 / k); cy = Math.min(Math.max(cy, size / 2 / k), img.height - size / 2 / k);
    ctx.clearRect(0, 0, size, size); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, size / 2 - cx * k, size / 2 - cy * k, img.width * k, img.height * k);
  };
  const paint = () => {
    const c = cv.getContext("2d"); draw(c, BOX);
    c.save(); c.fillStyle = "rgba(0,0,0,.6)"; c.beginPath(); c.rect(0, 0, BOX, BOX); c.arc(BOX / 2, BOX / 2, BOX / 2 - 2, 0, 7); c.fill("evenodd"); c.restore();
    c.strokeStyle = "#4a63ff"; c.lineWidth = 2; c.beginPath(); c.arc(BOX / 2, BOX / 2, BOX / 2 - 2, 0, 7); c.stroke();
  };
  const openCrop = (bmp) => { img = bmp; zoom = 1; zm.value = 1; cx = bmp.width / 2; cy = bmp.height / 2; cropBox.hidden = false; flag(pMsg, ""); paint(); };
  if (MOCK) window.__nk = { crop: openCrop };
  zm.oninput = () => { zoom = +zm.value; paint(); };
  let drag = null;
  cv.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => { if (!drag) return; const k = base(BOX) * zoom * (cv.clientWidth / BOX); cx -= (e.clientX - drag[0]) / k; cy -= (e.clientY - drag[1]) / k; drag = [e.clientX, e.clientY]; paint(); };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; };
  cv.onkeydown = (e) => { const d = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key]; if (!d) return; e.preventDefault(); const k = base(BOX) * zoom; cx += d[0] / k; cy += d[1] / k; paint(); };
  file.onchange = async () => {
    const f = file.files[0]; file.value = ""; if (!f) return;
    try { openCrop(await createImageBitmap(f)); } catch { flag(pMsg, "That file is not a picture the browser can open."); }
  };
  noBtn.onclick = () => { cropBox.hidden = true; pickBtn.focus(); };
  const encode = async () => { // exactly 128x128; WebP first, JPEG if the browser cannot make WebP; lower quality until <= 16 KB
    const o = Object.assign(document.createElement("canvas"), { width: OUT, height: OUT }); draw(o.getContext("2d"), OUT);
    const blob = (t, q) => new Promise((r) => o.toBlob(r, t, q));
    for (const t of ["image/webp", "image/jpeg"]) for (let q = 0.8; q >= 0.2; q -= 0.1) { const b = await blob(t, q); if (!b || b.type !== t) break; if (b.size <= MAX) return b; }
    return null;
  };
  useBtn.onclick = async () => {
    useBtn.disabled = true; flag(pMsg, "Uploading…", "");
    const b = await encode();
    if (!b) { useBtn.disabled = false; return flag(pMsg, "Could not make this picture small enough. Try a simpler one."); }
    const r = await api("/me/avatar", b);
    useBtn.disabled = false;
    if (r.error) return flag(pMsg, r.error);
    me.avatar_url = r.avatar_url; cropBox.hidden = true; rmBtn.hidden = false; showPrev(); repaint(); flag(pMsg, "Picture saved.", "good");
  };
  rmBtn.onclick = async () => {
    const r = await api("/me/avatar", undefined, "DELETE");
    if (r.error) return flag(pMsg, r.error);
    me.avatar_url = null; rmBtn.hidden = true; showPrev(); repaint(); flag(pMsg, "Picture removed.", "good");
  };
  cropBox.append(cv, zm, h("div", { className: "actions", style: "margin:0" }, useBtn, noBtn));
  const edit = h("section", { className: "card" }, h("h2", {}, "Edit profile"),
    h("label", {}, "Picture"), h("div", { className: "pickrow" }, prev, pickBtn, rmBtn, file), cropBox, pMsg,
    h("label", { htmlFor: "f-name" }, "Display name"), nIn, nMsg,
    h("label", { htmlFor: "f-handle" }, "Handle"), hIn, hMsg,
    h("label", { htmlFor: "f-bio" }, "Bio"), bIn, cnt, bMsg,
    h("div", { className: "actions" }, save, sMsg));

  // Tabs
  const names = ["Board", "Edit profile"], panels = [h("div", { id: "p-0", role: "tabpanel" }, ...board_), h("div", { id: "p-1", role: "tabpanel", hidden: true }, edit)];
  const tabs = names.map((n, i) => { const t = h("button", { className: "tab", id: "t-" + i, role: "tab", textContent: n, type: "button" }); t.setAttribute("aria-controls", "p-" + i); panels[i].setAttribute("aria-labelledby", "t-" + i); return t; });
  const pick = (i, focus) => { tabs.forEach((t, j) => { t.setAttribute("aria-selected", String(i === j)); t.tabIndex = i === j ? 0 : -1; panels[j].hidden = i !== j; }); if (focus) tabs[i].focus(); };
  tabs.forEach((t, i) => { t.onclick = () => pick(i); t.onkeydown = (e) => { const k = { ArrowRight: (i + 1) % 2, ArrowLeft: (i + 1) % 2, Home: 0, End: 1 }[e.key]; if (k !== undefined) { e.preventDefault(); pick(k, true); } }; });
  pick(0);
  drawBar(u, me, signOut);
  show(idEl, h("div", {}, h("div", { className: "tabs", role: "tablist", ariaLabel: "Profile sections" }, ...tabs), ...panels));
}

function testPic() { // test-only: a generated 128x128 picture
  const c = Object.assign(document.createElement("canvas"), { width: 128, height: 128 }), x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, "#ff9a3c"); g.addColorStop(1, "#7a1fa2"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); x.fillStyle = "#fff"; x.beginPath(); x.arc(64, 52, 24, 0, 7); x.fill(); x.fillRect(28, 88, 72, 40);
  return c.toDataURL("image/jpeg", 0.8);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
if (MOCK) {
  const mockSolved = ["counter-en", "rise-edge", "cdc-sync2", "squeeze-tiny8"].filter((id) => byId[id]);
  const me = { name: "Asha Rao", handle: "asha", bio: Q.has("nobio") ? "" : "RTL and STA. Learning physical design one problem at a time.", created: Date.now() - 40 * 864e5, solved: mockSolved.length ? mockSolved : PROBLEMS.slice(0, 3).map((p) => p.id), points: 4, rank: 12, total_users: 40, reviews_left: 1, is_admin: MOCK === "admin", avatar_url: Q.has("avatar") ? testPic() : null };
  const rows = Array.from({ length: 50 }, (_, i) => ({ rank: i + 1, handle: i === 11 ? "asha" : "user" + i, first_name: i === 11 ? "Asha" : "Name", points: 9 - (i >> 3), solved: 9 - (i >> 3) }));
  const go = () => {};
  const mockApi = async (p, b, m) => {
    await delay(300);
    if (p === "/me/avatar") { if (m === "DELETE") return { ok: true, avatar_url: null }; const bm = await createImageBitmap(b); window.__lastAvatar = { w: bm.width, h: bm.height, bytes: b.size, type: b.type }; console.log("avatar", JSON.stringify(window.__lastAvatar)); return { ok: true, avatar_url: URL.createObjectURL(b) }; }
    return b.handle === "taken" ? { error: "That handle is taken." } : { ok: true, ...b }; };
  skeleton();
  await delay(+Q.get("delay") || 0);
  if (MOCK === "out") signedOutCard(go, h("p"));
  else if (MOCK === "err") errorCard("The server did not answer. Check your connection and try again.", () => location.reload());
  else {
    view(me, { total_users: 40, rows }, { displayName: "Asha Rao" }, mockApi, go);
    if (Q.get("tab") === "edit") document.getElementById("t-1").click();
    if (Q.has("crop")) { const c = Object.assign(document.createElement("canvas"), { width: 400, height: 300 }), x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 400, 300); g.addColorStop(0, "#22c1c3"); g.addColorStop(1, "#fdbb2d"); x.fillStyle = g; x.fillRect(0, 0, 400, 300); x.fillStyle = "#123"; x.beginPath(); x.arc(200, 120, 60, 0, 7); x.fill(); x.fillRect(120, 190, 160, 110); window.__nk.crop(await createImageBitmap(c)); }
    if (Q.has("nameerr")) { document.getElementById("f-name").value = "  "; document.getElementById("f-save").click(); }
  }
} else if (!CONFIG.api || !CONFIG.firebase?.apiKey) show(h("div", { className: "card center" }, h("h1", {}, "Sign-in is not set up yet"), h("p", { className: "muted" }, "Come back soon.")));
else {
  skeleton();
  const V = "https://www.gstatic.com/firebasejs/11.0.2/";
  const [{ initializeApp }, mod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js")]);
  const auth = mod.getAuth(initializeApp(CONFIG.firebase));
  const API = CONFIG.api.replace(/\/$/, "");
  const signOut = () => mod.signOut(auth);
  const signedIn = async (u) => {
    skeleton();
    const call = async (path, body, method) => {
      const blob = body instanceof Blob;
      const r = await fetch(API + path, { method: method || (body ? "POST" : "GET"), headers: { Authorization: "Bearer " + await u.getIdToken(), ...(body && { "Content-Type": blob ? body.type : "application/json" }) }, body: blob ? body : body && JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Error " + r.status);
      return j;
    };
    let me, board = null;
    try { me = await call("/me"); } catch (e) { drawBar(u, null, signOut); return errorCard(e.message, () => signedIn(u)); }
    try { board = await call("/leaderboard"); } catch { /* leaderboard is optional */ }
    view(me, board, u, (p, b, m) => call(p, b, m).catch((e) => ({ error: e.message })), signOut);
  };
  mod.onAuthStateChanged(auth, (u) => {
    if (u) return signedIn(u);
    const msg = h("p", { style: "color:var(--bad)" });
    signedOutCard(() => mod.signInWithPopup(auth, new mod.GoogleAuthProvider()).catch((e) => (msg.textContent = e.code === "auth/popup-closed-by-user" ? "" : e.message)), msg);
  });
}
