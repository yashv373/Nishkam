// Fills <a id="navUser"> with the signed-in user's avatar + first name. Loads Firebase only if config is set.
import { CONFIG } from "./config.js";
import { avatar } from "./avatar.js";
const a = document.getElementById("navUser");
const signedOutHTML = a?.innerHTML, signedOutHidden = a?.hidden;
if (a && CONFIG.api && CONFIG.firebase?.apiKey) {
  try {
    const V = "https://www.gstatic.com/firebasejs/11.0.2/";
    const [{ initializeApp }, mod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js")]);
    const paint = (name, url) => { a.textContent = ""; const i = avatar(name, url, 20); i.style.marginRight = "6px"; a.append(i, name.split(" ")[0]); a.hidden = false; };
    mod.onAuthStateChanged(mod.getAuth(initializeApp(CONFIG.firebase)), async (u) => {
      if (!u) { a.innerHTML = signedOutHTML; a.hidden = signedOutHidden; return; }
      paint(u.displayName || u.email || "Profile");
      try { // the name and picture they chose on their profile win over the Google ones
        const r = await fetch(CONFIG.api.replace(/\/$/, "") + "/me", { headers: { Authorization: "Bearer " + await u.getIdToken() } });
        const me = r.ok && await r.json();
        if (me) paint(me.name || u.displayName || "Profile", me.avatar_url);
      } catch { /* keep the Google name */ }
    });
  } catch { /* offline: leave the link as is */ }
}
