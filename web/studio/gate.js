// Access-key gate for Studio. Client-side only: it keeps casual visitors out, it is NOT security (anyone can read this file).
// Only SHA-256 hashes are stored, never the keys. To add a key, hash it and add a line below:
//   node -e "console.log(require('crypto').createHash('sha256').update('123456').digest('hex'))"
export const KEYS = {
  "d11166efbc6e055a591d985ea445f5f1aec05b336446ba2fed83b1a08ebd4e43": "Key provided by Yash. Welcome!",
  "ea363b8aa4ea03f519e7cf9d0e464244d33ff17cb39cc473710a72a4a3955a91": "Access granted by Sankarshan. Welcome!",
  "a69e0a69bfbb821b73da0be2262bca31111aa261bec274211891c37705f0c10c": "Access granted by Megh. Welcome!",
};
const STORE = "studio:access";
export const sha = async (k) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(k).trim())))].map((b) => b.toString(16).padStart(2, "0")).join("");
// -> welcome message for a good key, else null
export const check = async (k) => KEYS[await sha(k)] ?? null;
export const remembered = () => { try { return KEYS[localStorage.getItem(STORE)] ?? null; } catch { return null; } };
export const remember = async (k) => { try { localStorage.setItem(STORE, await sha(k)); } catch {} };
