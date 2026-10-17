import { CONFIG } from "./config.js";
const main = document.getElementById("main");
// tiny DOM builder: text always goes through textContent / text nodes
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const show = (...n) => main.replaceChildren(...n);
if (!CONFIG.api || !CONFIG.firebase?.apiKey) show(h("p", { className: "muted" }, "Sign-in is not set up yet."));
else {
  const V = "https://www.gstatic.com/firebasejs/11.0.2/";
  const [{ initializeApp }, mod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js")]);
  const auth = mod.getAuth(initializeApp(CONFIG.firebase));
  const signedOut = () => {
    const msg = h("p", { className: "err" });
    const b = h("button", { className: "btn blue", textContent: "Continue with Google", onclick: () => mod.signInWithPopup(auth, new mod.GoogleAuthProvider()).catch((e) => (msg.textContent = e.code === "auth/popup-closed-by-user" ? "" : e.message)) });
    show(h("div", { className: "card center" }, h("h1", { style: "font-size:clamp(30px,8vw,44px)" }, "Sign in to Nishkam"), h("p", { className: "muted" }, "Save your progress, earn points, and get 2 free AI hints."), b, msg));
  };
  const signedIn = async (u) => {
    show(h("p", { className: "muted" }, "Loading…"));
    let me;
    try {
      const r = await fetch(CONFIG.api.replace(/\/$/, "") + "/me", { headers: { Authorization: "Bearer " + await u.getIdToken() } });
      if (!r.ok) throw new Error("Error " + r.status);
      me = await r.json();
    } catch (e) { return show(h("p", { className: "err" }, "Could not load your profile: " + e.message)); }
    const out = [];
    if (me.is_admin) out.push(h("h1", {}, "Welcome back to Project Nishkam, sir."), h("a", { className: "btn blue big", href: "admin.html" }, "Open admin panel"));
    const stat = (n, l) => h("div", {}, h("b", {}, String(n)), h("span", {}, l));
    const since = me.created ? new Date(me.created).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-";
    const who = h("div", { className: "who" }, u.photoURL ? h("img", { src: u.photoURL, alt: "", referrerPolicy: "no-referrer" }) : h("div", { className: "ph" }),
      h("div", {}, h("h2", {}, me.name || u.displayName || "You"), h("p", { className: "muted" }, me.email || u.email || "")));
    const solved = me.solved || [];
    const list = solved.length ? h("ul", {}, ...solved.map((id) => h("li", {}, h("a", { href: "app.html?" + encodeURIComponent(id) }, id)))) : h("p", { className: "muted" }, "Nothing solved yet.");
    out.push(h("div", { className: "card" }, who,
      h("div", { className: "stats" }, stat(me.points ?? solved.length, "points"), stat(solved.length, "problems solved"), stat(`${me.reviews_left ?? 0} of 2`, "AI hints left"), stat(since, "member since")),
      h("p", { className: "lab", style: "margin-top:24px" }, "Problems solved"), list),
      h("button", { className: "btn ghost", textContent: "Sign out", onclick: () => mod.signOut(auth) }));
    show(...out);
  };
  mod.onAuthStateChanged(auth, (u) => (u ? signedIn(u) : signedOut()));
}
