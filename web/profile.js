import { CONFIG } from "./config.js";
import { PROBLEMS } from "./problems.js";
const main = document.getElementById("main");
// tiny DOM builder: text always goes through textContent / text nodes
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const show = (...n) => main.replaceChildren(...n);
// Test-only: ?mock=1 on localhost renders a fake signed-in user, no network.
const MOCK = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("mock");
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
const stat = (n, l) => h("div", {}, h("b", {}, String(n)), h("span", {}, l));
const fmt = (t) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function view(me, board, u, api, signOut) {
  const out = [];
  if (me.is_admin) out.push(h("h1", {}, "Welcome back to Project Nishkam, sir."), h("a", { className: "btn blue big", href: "admin.html" }, "Open admin panel"));
  const solved = (me.solved || []).filter((id) => byId[id]);
  const handleEl = h("span", { className: "handle" }, "@" + (me.handle || ""));
  const edit = h("button", { className: "btn ghost sm", textContent: "Edit" });
  const msg = h("p", { className: "err", style: "margin:6px 0 0" });
  const handleRow = h("p", { className: "muted" }, handleEl, " ", edit);
  edit.onclick = () => {
    const inp = h("input", { value: me.handle || "", maxLength: 20, autocapitalize: "none", spellcheck: false, ariaLabel: "Handle" });
    const save = h("button", { className: "btn blue sm", textContent: "Save" });
    save.onclick = async () => {
      msg.textContent = "";
      const r = await api("/me/handle", { handle: inp.value.trim().toLowerCase() });
      if (r.error) { msg.textContent = r.error; return; }
      me.handle = r.handle; handleEl.textContent = "@" + r.handle; handleRow.replaceChildren(handleEl, " ", edit);
    };
    handleRow.replaceChildren(h("span", {}, "@"), inp, " ", save);
    inp.focus();
  };
  const who = h("div", { className: "who" }, u.photoURL ? h("img", { src: u.photoURL, alt: "", referrerPolicy: "no-referrer" }) : h("div", { className: "ph" }),
    h("div", {}, h("h2", {}, me.name || u.displayName || "You"), handleRow, msg, h("p", { className: "muted" }, me.created ? "Joined " + fmt(me.created) : "")));
  out.push(h("div", { className: "card" }, who, h("div", { className: "stats" },
    stat(`${solved.length} of ${PROBLEMS.length}`, "problems solved"), stat(me.points ?? solved.length, "points"),
    stat(me.rank ? `#${me.rank} of ${me.total_users}` : "-", "rank"), stat(`${me.reviews_left ?? 0} of 2`, "AI hints left"))));

  out.push(h("div", { className: "card" }, h("p", { className: "lab" }, "Badges"),
    h("div", { className: "badges" }, ...BADGES.map(([name, how, test]) => {
      const on = test(solved, me);
      return h("div", { className: "badge" + (on ? " on" : "") }, h("b", {}, (on ? "✓ " : "") + name), h("span", {}, how));
    }))));

  out.push(h("div", { className: "card" }, h("p", { className: "lab" }, "Problems solved"),
    solved.length ? h("ul", {}, ...solved.map((id) => h("li", {}, h("a", { href: "app.html?" + encodeURIComponent(id) }, byId[id].title + " · " + byId[id].difficulty)))) : h("p", { className: "muted" }, "Nothing solved yet.")));

  if (board) {
    const rows = board.rows, mine = rows.find((r) => r.handle === me.handle);
    const lb = h("div", { className: "card" }), more = h("button", { className: "btn ghost sm", textContent: "See the top 50" });
    const row = (r, own) => h("tr", { className: own ? "me" : "" }, h("td", {}, "#" + r.rank), h("td", {}, "@" + r.handle + (r.first_name ? " · " + r.first_name : "")), h("td", {}, String(r.points)));
    const draw = (n) => {
      const body = rows.slice(0, n).map((r) => row(r, r.handle === me.handle));
      if (!mine || rows.indexOf(mine) >= n) body.push(row({ rank: me.rank, handle: me.handle, first_name: (me.name || "").split(" ")[0], points: me.points }, true));
      lb.replaceChildren(h("p", { className: "lab" }, n > 10 ? "Leaderboard · top 50" : "Leaderboard"), h("table", {}, h("tbody", {}, ...body)), n > 10 ? "" : more);
    };
    more.onclick = () => draw(50); draw(10); out.push(lb);
  }
  out.push(h("button", { className: "btn ghost", textContent: "Sign out", onclick: signOut }));
  show(...out);
}

const signedOutCard = (go, msg) => show(h("div", { className: "card center" }, h("h1", { style: "font-size:clamp(30px,8vw,44px)" }, "Sign in to Nishkam"),
  h("p", { className: "muted" }, "Save your progress, earn points, and get 2 free AI hints."), h("button", { className: "btn blue", textContent: "Continue with Google", onclick: go }), msg));

if (MOCK) {
  const solved = ["counter-en", "rise-edge", "cdc-sync2", "squeeze-tiny8"];
  const me = { name: "Asha Rao", handle: "asha", created: Date.now() - 40 * 864e5, solved, points: 4, rank: 12, total_users: 40, reviews_left: 1, is_admin: new URLSearchParams(location.search).get("mock") === "admin" };
  const rows = Array.from({ length: 50 }, (_, i) => ({ rank: i + 1, handle: i === 11 ? "asha" : "user" + i, first_name: i === 11 ? "Asha" : "Name", points: 9 - (i >> 3), solved: 9 - (i >> 3) }));
  view(me, { total_users: 40, rows }, { displayName: "Asha Rao" }, async (p, b) => ({ ok: true, handle: b.handle }), () => {});
} else if (!CONFIG.api || !CONFIG.firebase?.apiKey) show(h("p", { className: "muted" }, "Sign-in is not set up yet."));
else {
  const V = "https://www.gstatic.com/firebasejs/11.0.2/";
  const [{ initializeApp }, mod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js")]);
  const auth = mod.getAuth(initializeApp(CONFIG.firebase));
  const API = CONFIG.api.replace(/\/$/, "");
  const signedIn = async (u) => {
    show(h("p", { className: "muted" }, "Loading…"));
    const call = async (path, body) => {
      const r = await fetch(API + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + await u.getIdToken(), ...(body && { "Content-Type": "application/json" }) }, body: body && JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Error " + r.status);
      return j;
    };
    let me, board = null;
    try { me = await call("/me"); } catch (e) { return show(h("p", { className: "err" }, "Could not load your profile: " + e.message)); }
    try { board = await call("/leaderboard"); } catch { /* leaderboard is optional */ }
    view(me, board, u, (p, b) => call(p, b).catch((e) => ({ error: e.message })), () => mod.signOut(auth));
  };
  mod.onAuthStateChanged(auth, (u) => {
    if (u) return signedIn(u);
    const msg = h("p", { className: "err" });
    signedOutCard(() => mod.signInWithPopup(auth, new mod.GoogleAuthProvider()).catch((e) => (msg.textContent = e.code === "auth/popup-closed-by-user" ? "" : e.message)), msg);
  });
}
