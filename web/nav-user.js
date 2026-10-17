// Fills <a id="navUser"> with the signed-in user's avatar + first name. Loads Firebase only if config is set.
import { CONFIG } from "./config.js";
const a = document.getElementById("navUser");
const signedOutHTML = a?.innerHTML, signedOutHidden = a?.hidden;
if (a && CONFIG.api && CONFIG.firebase?.apiKey) {
  try {
    const V = "https://www.gstatic.com/firebasejs/11.0.2/";
    const [{ initializeApp }, mod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js")]);
    mod.onAuthStateChanged(mod.getAuth(initializeApp(CONFIG.firebase)), (u) => {
      if (!u) { a.innerHTML = signedOutHTML; a.hidden = signedOutHidden; return; }
      a.textContent = "";
      if (u.photoURL) { const i = document.createElement("img"); i.src = u.photoURL; i.alt = ""; i.width = i.height = 20; i.referrerPolicy = "no-referrer"; i.style.cssText = "border-radius:50%;vertical-align:-5px;margin-right:6px"; a.append(i); }
      a.append((u.displayName || u.email || "Profile").split(" ")[0]);
      a.hidden = false;
    });
  } catch { /* offline: leave the link as is */ }
}
