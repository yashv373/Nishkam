import { parseLoose } from "./stages.js";
// Talks to the local runner. Same sessionStorage key as app.html, so one connection serves both pages.
let conn = null;
export function loadConn() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("runner") && h.get("token")) {
    try { sessionStorage.setItem("runner", JSON.stringify({ url: h.get("runner"), token: h.get("token") })); } catch {}
    history.replaceState(null, "", location.pathname + location.search);
  }
  try { conn = JSON.parse(sessionStorage.getItem("runner")); } catch { conn = null; }
  return conn;
}
// Accepts a pasted link like http://localhost:8000/app.html#runner=...&token=...
export function connectFromLink(text) {
  const frag = text.includes("#") ? text.split("#").slice(1).join("#") : text.trim();
  const h = new URLSearchParams(frag);
  if (!h.get("runner") || !h.get("token")) return false;
  conn = { url: h.get("runner"), token: h.get("token") };
  try { sessionStorage.setItem("runner", JSON.stringify(conn)); } catch {}
  return true;
}
export const hasConn = () => !!conn;
async function rfetch(path, opts = {}) {
  if (!conn) throw new Error("no runner connected");
  const r = await fetch(conn.url + path, { ...opts, headers: { ...(opts.headers || {}), "X-Nishkam-Token": conn.token } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `runner: HTTP ${r.status}`);
  return r;
}
export const health = async () => (await rfetch("/health")).json();
export const startJob = async (body) => (await rfetch("/jobs", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ kind: "flow", ...body }) })).json();
export const jobStatus = async (id) => (await rfetch(`/jobs/${id}`)).json();
export const jobMetrics = async (id) => parseLoose(await (await rfetch(`/jobs/${id}/metrics`)).text());
export const jobFiles = async (id) => { const j = await (await rfetch(`/jobs/${id}/files`)).json(); return (Array.isArray(j) ? j : j.files || []).map((f) => f.path || f); };
export const jobFile = async (id, path, binary) => {
  const r = await rfetch(`/jobs/${id}/file?path=${encodeURIComponent(path)}`);
  return binary ? r.arrayBuffer() : r.text();
};
export async function logChunk(id, offset) {
  const r = await rfetch(`/jobs/${id}/log?offset=${offset}`);
  return { text: await r.text(), next: +(r.headers.get("X-Next-Offset") ?? offset) };
}
// Stream /shell output line by line.
export async function shell(cmd, onText) {
  const r = await rfetch("/shell", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd }) });
  const rd = r.body.getReader(), dec = new TextDecoder();
  for (;;) { const { done, value } = await rd.read(); if (done) break; onText(dec.decode(value, { stream: true })); }
}
