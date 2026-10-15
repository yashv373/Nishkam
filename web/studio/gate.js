// Access-key gate for Studio. Client-side only: it keeps casual visitors out, it is NOT security (anyone can read this file).
// Only SHA-256 hashes are stored, never the keys. To add a key, hash it and add a line below:
//   node -e "console.log(require('crypto').createHash('sha256').update('123456').digest('hex'))"
export const KEYS = {
  "b1064bfc13b0e27ef3fd29139a0ff09fb8383d8bed49a9d40dd7454fd115a562": "Key provided by Yash. Welcome!",
  "f3c77208adbf8537d69fdeec53ef3f379c1c0eeaffdb6c1c5c8b88925c4022b0": "Access granted by Sankarshan. Welcome!",
  "b876e136ec41b93a38d0693f8d26c083d20002eaf97f13c76448eedbb152305b": "Access granted by Megh. Welcome!",
};
const STORE = "studio:access";
// Keys look like ABCD-EFGH-IJKL; case is ignored and the dashes may be left out.
export const norm = (k) => { const s = String(k).trim().toUpperCase(); return s.length === 12 && !s.includes("-") ? s.match(/.{4}/g).join("-") : s; };
export const sha = async (k) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm(k))))].map((b) => b.toString(16).padStart(2, "0")).join("");
// -> welcome message for a good key, else null
export const check = async (k) => KEYS[await sha(k)] ?? null;
export const remembered = () => { try { return KEYS[localStorage.getItem(STORE)] ?? null; } catch { return null; } };
export const remember = async (k) => { try { localStorage.setItem(STORE, await sha(k)); } catch {} };
