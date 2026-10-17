import { PROBLEMS, HARDEN_KNOBS } from "./problems.js";
window.__nkBoot = 1;
import { DEPTH } from "./grader.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- local runner connection (token arrives in the URL fragment, never sent to a server) ----------
let runner = null;
(() => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("runner") && h.get("token")) {
    try { sessionStorage.setItem("runner", JSON.stringify({ url: h.get("runner"), token: h.get("token") })); } catch {}
    history.replaceState(null, "", location.pathname + location.search);
  }
  try { runner = JSON.parse(sessionStorage.getItem("runner")); } catch {}
})();
let runnerInfo = null;

async function rfetch(path, opts = {}) {
  const r = await fetch(runner.url + path, { ...opts, headers: { ...(opts.headers || {}), "X-Nishkam-Token": runner.token } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `runner: HTTP ${r.status}`);
  return r;
}
async function checkRunner() {
  if (!runner) return setRunner(null);
  try { setRunner(await (await rfetch("/health")).json()); } catch { setRunner(null); }
}
function setRunner(info) {
  runnerInfo = info;
  $("runnerBtn").classList.toggle("on", !!info);
  $("runnerText").textContent = info ? `Local runner: ${info.container}` : "Local runner: off";
  renderButtons();
}
$("runnerBtn").onclick = () => runnerInfo ? checkRunner() : $("runnerDlg").showModal();
setInterval(checkRunner, 10000);

// ---------- Yosys worker ----------
const worker = new Worker("worker.js", { type: "module" });
let reqId = 0; const pending = {};
worker.onmessage = ({ data }) => {
  const p = pending[data.id]; if (!p) return;
  if (data.progress !== undefined) return p.onProgress(data.progress);
  delete pending[data.id]; p.resolve(data.result);
};
const gradeInWorker = (problem, code, onProgress) => new Promise((resolve) => {
  const id = ++reqId; pending[id] = { resolve, onProgress };
  worker.postMessage({ id, problem, code });
});

// ---------- editor ----------
let editor, current, busy = false;
const codeKey = (p) => `code:${p.id}`;
const solved = new Set(store.get("solved", []));

window.require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs" } });
window.require(["vs/editor/editor.main"], () => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  editor = monaco.editor.create($("editor"), {
    language: "systemverilog", theme: dark ? "vs-dark" : "vs", fontFamily: "JetBrains Mono", fontSize: 13,
    minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, tabSize: 2,
  });
  editor.onDidChangeModelContent(() => current && store.set(codeKey(current), editor.getValue()));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => $("submit").click());
  openProblem(PROBLEMS.find((p) => p.id === location.search.slice(1)) || PROBLEMS[0]);
});

// ---------- problem list + statement ----------
function renderList() {
  const groups = { rtl: "RTL · runs in your browser", flow: "Physical design · runs on your machine" };
  $("list").innerHTML = `<div class="solvedcount">${[...solved].filter((id) => PROBLEMS.some((p) => p.id === id)).length} of ${PROBLEMS.length} solved</div>` + Object.entries(groups).map(([kind, label]) =>
    `<h3>${label}</h3>` + PROBLEMS.filter((p) => p.kind === kind).map((p) =>
      `<button class="prob ${p === current ? "active" : ""}" data-id="${p.id}">
         <span class="check">${solved.has(p.id) ? "✓" : ""}</span>${esc(p.title)}
         <span class="diff ${p.difficulty}">${p.difficulty}</span></button>`).join("")).join("");
  $("list").querySelectorAll(".prob").forEach((b) => b.onclick = () => openProblem(PROBLEMS.find((p) => p.id === b.dataset.id)));
}

function openProblem(p) {
  current = p;
  history.replaceState(null, "", "?" + p.id);
  const how = p.cdc
    ? `Graded by rules, not by matching a reference. Yosys reads your netlist and checks that every crossing goes through at least two flops of the other clock, then runs your design with two independent clocks where the first flop of each crossing bit may catch the old or the new value, and checks the result. Ctrl+Enter submits.`
    : p.kind === "rtl"
    ? `Graded by formal equivalence: Yosys' SAT solver compares your design with a reference for <b>every</b> input sequence: it tries to prove they match for all cycles, and otherwise checks the first ${DEPTH} cycles after reset. If they ever differ, you get the exact cycle where they differ. Ctrl+Enter submits.`
    : `You edit the knobs (JSON). The RTL is fixed. Allowed: <code>DIE_AREA</code> [x0, y0, x1, y1] in µm, <code>PL_TARGET_DENSITY_PCT</code>, <code>SYNTH_STRATEGY</code> (e.g. "AREA 0"), <code>GRT_ALLOW_CONGESTION</code>.`;
  $("statement").innerHTML = `<h1>${esc(p.title)}</h1>
    <div class="tags"><span class="tag diff ${p.difficulty}">${p.difficulty}</span>${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    ${p.statement}<div class="how">${how}</div><div id="aid"></div>`;
  monaco.editor.setModelLanguage(editor.getModel(), p.kind === "rtl" ? "systemverilog" : "json");
  editor.setValue(store.get(codeKey(p), p.starter));
  $("result").innerHTML = `<p class="muted">${p.kind === "rtl" ? "Write your design, then Submit." : "Pick your knobs, then Run flow."}</p>`;
  renderList(); renderButtons(); renderAid();
}
const hintsShown = {};
function renderAid() {
  const p = current, el = $("aid");
  if (!el || !p || !p.hints) return;
  const n = hintsShown[p.id] || 0;
  const hs = p.hints.slice(0, n).map((h, i) => `<p class="hintline"><b>Hint ${i + 1}.</b> ${esc(h)}</p>`).join("");
  const more = n < p.hints.length ? `<button id="hintBtn">${n ? "Another hint" : "Hint"} (${n} of ${p.hints.length} shown)</button>` : "";
  const wu = solved.has(p.id) && p.writeup ? `<div class="writeup"><h2>Write-up</h2>${p.writeup}</div>` : "";
  el.innerHTML = hs + more + wu + `<p class="muted note">The answer and write-up are already in your browser, so this lock is only for your own practice.</p>`;
  if ($("hintBtn")) $("hintBtn").onclick = () => { hintsShown[p.id] = n + 1; renderAid(); };
}

const solvedN = () => PROBLEMS.filter((p) => solved.has(p.id)).length;
// next unsolved problem in list order (RTL group first, as shown), after the current one, wrapping around
function nextUnsolved() {
  const order = [...PROBLEMS.filter((p) => p.kind === "rtl"), ...PROBLEMS.filter((p) => p.kind === "flow")];
  const i = order.indexOf(current);
  return [...order.slice(i + 1), ...order.slice(0, i)].find((p) => !solved.has(p.id));
}
function nextStep() {
  const n = nextUnsolved();
  return n ? `<button class="primary next" id="nextBtn">Next problem: ${esc(n.title)} →</button>` : `<span class="muted">That is every problem. Well done.</span>`;
}
function wireNext() { const n = nextUnsolved(); if ($("nextBtn")) $("nextBtn").onclick = () => { openProblem(n); $("statement").scrollIntoView({ block: "start" }); }; }

// Plain-words reading of a Yosys compile error. Keeps file:line, adds one line of explanation.
function explainError(log, fallback) {
  const m = log.match(/(?:^|\n)\s*(?:ERROR:\s*)?(\S+\.v):(\d+)(?:\.\d+-\d+(?:\.\d+)?)?:?\s*(?:ERROR:)?\s*(.*)/);
  const raw = (m && m[3]) || fallback || "";
  const where = m ? `${m[1]} line ${m[2]}` : "";
  let why = "The checker could not read your code.";
  if (/syntax error/i.test(raw)) why = "There is a typing mistake here. Look for a missing semicolon, a missing end, or an extra bracket on or just above this line.";
  else if (/Module `?.*is not part of the design|Module `.*' referenced.*not found|Can't find/i.test(raw)) why = "A module name is missing or misspelled. Keep the module name from the starter.";
  else if (/not declared|Identifier .* is implicitly declared|Unknown identifier|Reference to undeclared/i.test(raw)) why = "A name is used but never declared. Check for a spelling mistake.";
  else if (/Re-definition|redeclar/i.test(raw)) why = "The same name is declared twice.";
  else if (/port/i.test(raw)) why = "The ports do not match the starter. Keep the port names and widths the same.";
  return `<div class="banner bad">Your code has an error${where ? ` at <code>${esc(where)}</code>` : ""}
      <small>${why}</small></div>
    <details><summary class="muted">Details (raw checker text)</summary><pre class="log">${esc(fallback && !log.includes(fallback) ? fallback + "\n" + log : log || fallback)}</pre></details>`;
}

function renderButtons() {
  if (!current) return;
  const flow = current.kind === "flow";
  $("submit").textContent = flow ? "Run flow" : "Submit";
  $("submit").disabled = busy || (flow && !runnerInfo);
  $("hint").textContent = flow && !runnerInfo ? "Needs the local runner (top right)." : "";
}
$("reset").onclick = () => editor.setValue(current.starter);

// ---------- RTL submit ----------
$("submit").onclick = () => {
  if (current.kind === "rtl") return submitRtl();
  let knobs;
  try { knobs = JSON.parse(editor.getValue()); }
  catch (e) { return $("result").innerHTML = `<div class="banner bad">Knobs aren't valid JSON<small>${esc(e.message)}</small></div>`; }
  runFlow(current, current.files, knobs);
};

async function submitRtl() {
  const p = current, code = editor.getValue();
  busy = true; renderButtons();
  $("result").innerHTML = `<p class="muted" id="status">Checking your design… (the very first check also downloads the checker, about 70 MB, once)</p><div class="progress"><div id="bar"></div></div>`;
  const res = await gradeInWorker(p, code, (f) => {
    if ($("bar")) $("bar").style.width = (f * 100).toFixed(0) + "%";
    if ($("status") && f < 1) $("status").textContent = `First check downloads the checker (about 70 MB, once): ${(f * 100).toFixed(0)}%. Later checks take a few seconds.`;
  });
  busy = false; renderButtons();
  if (p !== current) return;
  if (res.passed && res.cdc) {
    solved.add(p.id); store.set("solved", [...solved]); recordSolve(p.id, typeof code === "string" ? { [`${p.top || p.id}.v`]: code } : {}); renderList(); renderAid();
    $("result").innerHTML = `<div class="banner ok big">✓ Accepted
        <small>The crossing is built correctly, and no check failed in the first ${res.steps} clock events. This is a bounded check, not a proof. ${solvedN()} of ${PROBLEMS.length} solved.</small></div>
      <p class="actions">${nextStep()}</p>`;
    wireNext();
  } else if (res.structural) {
    $("result").innerHTML = `<div class="banner bad">Not a safe crossing<small>${res.structural.map(esc).join("<br>")}</small></div>
      <p class="muted">This is a structure rule, so there is no step table. Fix the net named above and submit again.</p>`;
  } else if (res.passed) {
    solved.add(p.id); store.set("solved", [...solved]); recordSolve(p.id, typeof code === "string" ? { [`${p.top || p.id}.v`]: code } : {}); renderList(); renderAid();
    const kinds = res.stat?.kinds?.map(([k, n]) => `${n}× ${k}`).join(", ") || "";
    $("result").innerHTML = `<div class="banner ok big">✓ Accepted
        <small>${res.proved ? "Proved equal to the reference for all cycles after reset." : `Matches the reference for the first ${DEPTH} cycles after reset (a full proof was not possible).`} ${solvedN()} of ${PROBLEMS.length} solved.</small></div>
      <p class="actions">${nextStep()}</p>
      ${res.stat?.cells ? `<p><b>${res.stat.cells}</b> generic cells after synthesis <span class="muted">(${esc(kinds)})</span></p>` : ""}
      <p><button id="score">Score area and speed</button> <span class="muted">Downloads the synthesis and timing tools (cached after the first time).</span></p>
      <div id="scoreOut"></div>
      <p><button id="harden" ${runnerInfo ? "" : "disabled"}>Take it to silicon (gf180)</button>
      <span class="muted">${runnerInfo ? "Runs LibreLane on your machine, about 2 minutes." : "Connect the local runner to place and route this design."}</span></p>
      <div id="flow"></div>`;
    wireNext();
    $("score").onclick = () => runScore(p, code);
    $("harden").onclick = () => runFlow({ ...p, checks: null }, { [`${p.top}.v`]: code }, HARDEN_KNOBS, $("flow"));
  } else if (res.cex && res.cex.kind === "cdc") {
    const c = res.cex;
    $("result").innerHTML = `<div class="banner bad">Failed the clock-crossing check<small>At step ${c.first}: ${c.reasons.length ? esc(c.reasons.join("; ")) : "a check failed"}. Each step is one clock event: <code>ena</code> or <code>enb</code> = 1 means that clock ticked.</small></div>
      ${cexTable(c)}
      <p class="actions"><button class="primary" id="again">Fix it and submit again</button></p>`;
    $("again").onclick = () => editor.focus();
  } else if (res.cex) {
    const c = res.cex, o = c.outputs.find((o) => o.expected[c.first] !== "x" && o.expected[c.first] !== o.got[c.first]);
    const what = o ? `Your design differs from the reference at cycle ${c.first} on output <code>${esc(o.name)}</code>: expected ${esc(o.expected[c.first])}, yours gave ${esc(o.got[c.first] || "nothing")}.`
      : `Your design differs from the reference at cycle ${c.first}.`;
    $("result").innerHTML = `<div class="banner bad">Wrong answer<small>${what}</small></div>
      ${cexTable(c)}
      <div id="explain"></div>
      <p class="actions"><button class="primary" id="again">Fix it and submit again</button>
      <button id="spec">Show the spec</button></p>`;
    $("again").onclick = () => editor.focus();
    offerExplain(p, code, c);
    $("spec").onclick = () => $("statement").scrollIntoView({ block: "start", behavior: "smooth" });
  } else {
    $("result").innerHTML = explainError(res.log || "", res.error);
  }
}

// Area + speed with Studio's own Yosys and OpenSTA, loaded only when the button is pressed (keeps pass/fail and phones light).
async function runScore(p, code) {
  const out = $("scoreOut"), btn = $("score");
  btn.disabled = true; out.innerHTML = `<p class="muted">Scoring… (synthesis, then timing)</p>`;
  try {
    const [{ scoreDesign, stretchResults, SCORE_NOTE }, Y, S] = await Promise.all([import("./score.js"), import("./studio/engines/yosys.js"), import("./studio/engines/opensta.js")]);
    const sc = await scoreDesign(p.top, code, { synth: (r) => Y.run(r), sta: (r) => S.run(r) });
    if (sc.error) throw new Error(sc.error);
    const st = stretchResults(p.stretch, sc);
    const mark = (label) => { const r = st.find((x) => x.label.startsWith(label)); return r ? ` <span class="${r.met ? "pass" : "fail"}">${r.met ? "stretch met" : "stretch not met"}: ${esc(r.label)}</span>` : ""; };
    out.innerHTML = `<table class="metrics">
      <tr><td>Area (gf180, ${sc.cells} cells)</td><td>${sc.areaUm2.toFixed(1)} µm²${mark("under")}</td></tr>
      <tr><td>Max clock speed</td><td>${sc.fmaxMhz === null ? "no timing path" : `${sc.fmaxMhz} MHz (worst setup slack ${sc.slackNs} ns at 10 ns)`}${mark("at")}</td></tr></table>
      <p class="muted">${esc(SCORE_NOTE)}</p>`;
  } catch (e) { out.innerHTML = `<div class="banner bad">Could not score<small>${esc(e.message)}</small></div>`; }
  btn.disabled = false;
}

function cexTable(cex) {
  const n = Math.min(cex.cycles - 1, cex.first + 2);
  const cols = [...Array(n + 1).keys()];
  const head = `<tr><th></th>${cols.map((c) => `<th class="${c === cex.first ? "firstcol" : ""}">${c}</th>`).join("")}</tr>`;
  const row = (name, vals, cls = () => "") => `<tr><td class="name">${esc(name)}</td>${cols.map((c) =>
    `<td class="${cls(c)}${cls(c) && c === cex.first ? " first" : ""}">${esc(vals[c] ?? "")}</td>`).join("")}</tr>`;
  const rows = [
    ...cex.inputs.map((i) => row(i.name, i.values)),
    ...cex.outputs.flatMap((o) => {
      const miss = (c) => o.expected[c] !== "x" && o.expected[c] !== o.got[c] ? "miss" : "";
      return [row(`${o.name} expected`, o.expected), row(`${o.name} yours`, o.got, miss)];
    }),
  ];
  return `<div class="cex"><table>${head}${rows.join("")}</table></div>
    <p class="muted">Cycle 0 is the reset cycle. Values are decimal; <code>x</code> means not yet defined.</p>`;
}

// ---------- physical design through the local runner ----------
const LABELS = {
  design__die__area: "die area µm²", design__core__area: "core area µm²", design__instance__area__stdcell: "std-cell area µm²",
  design__instance__count: "instances", timing__setup__ws: "setup slack ns", timing__hold__ws: "hold slack ns",
  power__total: "power W", route__wirelength: "wirelength µm", route__drc_errors: "routing DRC",
  magic__drc_error__count: "Magic DRC", design__lvs_error__count: "LVS errors",
  design__max_slew_violation__count: "max slew violations", design__max_cap_violation__count: "max cap violations",
  route__antenna_violation__count: "antenna violations",
};
const OPS = { "<=": (a, b) => a <= b, ">=": (a, b) => a >= b, "==": (a, b) => a === b };
const fmt = (v) => typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString() : v.toPrecision(4)) : String(v ?? "–");

async function runFlow(p, files, knobs, target = $("result")) {
  if (!runnerInfo) return $("runnerDlg").showModal();
  busy = true; renderButtons();
  knobs = { ...knobs, ...(p.fixed_knobs || {}) };
  target.innerHTML = `<p class="muted" id="fstat">Starting LibreLane…</p><pre class="log" id="flog"></pre>`;
  let id;
  try {
    id = (await (await rfetch("/jobs", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "flow", top: p.top, clock_port: p.clock_port || "clk", files, knobs }) })).json()).id;
  } catch (e) {
    busy = false; renderButtons();
    return target.innerHTML = `<div class="banner bad">Couldn't start the flow<small>${esc(e.message)}</small></div>`;
  }
  let s, misses = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    try { s = await (await rfetch(`/jobs/${id}`)).json(); misses = 0; }
    catch {
      if (++misses < 5) continue;
      busy = false; renderButtons();
      return target.innerHTML = `<div class="banner bad">Runner disconnected<small>Check the runner window. If it restarted, open the new link it printed.</small></div>`;
    }
    if ($("fstat")) $("fstat").textContent = `LibreLane running on ${runnerInfo?.container}… ${s.elapsed_s}s`;
    if ($("flog")) { $("flog").textContent = s.log_tail.split("\n").slice(-12).join("\n"); }
    if (s.state === "done" || s.state === "failed") break;
  }
  busy = false; renderButtons();
  const m = s.metrics || {};
  const checks = (p.checks || []).map(([k, op, want, label]) => ({ label, v: m[k], ok: m[k] != null && OPS[op](m[k], want), rule: `${op} ${fmt(want)}` }));
  const allOk = s.state === "done" && checks.every((c) => c.ok);
  if (p.checks && allOk) { solved.add(p.id); store.set("solved", [...solved]); recordSolve(p.id, files); renderList(); }
  setTimeout(() => { if (target.id === "result" && allOk) { target.insertAdjacentHTML("afterbegin", `<p class="actions">${nextStep()} <span class="muted">${solvedN()} of ${PROBLEMS.length} solved</span></p>`); wireNext(); } }, 0);
  const banner = s.state !== "done"
    ? `<div class="banner bad">Flow failed<small>LibreLane stopped early. The end of the log usually says why.</small></div>`
    : p.checks ? `<div class="banner ${allOk ? "ok" : "bad"}">${allOk ? "Accepted" : "Not yet"}<small>${allOk ? "Signs off within every limit." : "The flow finished, but some limits aren't met."}</small></div>`
    : `<div class="banner ok">Placed and routed<small>Your design on gf180mcuD, through the full open-source flow.</small></div>`;
  const checkRows = checks.map((c) => `<tr><td>${esc(c.label)} <span class="muted">${esc(c.rule)}</span></td><td class="${c.ok ? "pass" : "fail"}">${fmt(c.v)}</td></tr>`).join("");
  const otherRows = Object.entries(m).filter(([k]) => !(p.checks || []).some((c) => c[0] === k))
    .map(([k, v]) => `<tr><td>${esc(LABELS[k] || k)}</td><td>${fmt(v)}</td></tr>`).join("");
  target.innerHTML = `${banner}<table class="metrics">${checkRows}${otherRows}</table>
    <div class="layout" id="lay"></div>
    <details><summary class="muted">Log (last lines)</summary><pre class="log">${esc(s.log_tail)}</pre></details>`;
  if (s.has_layout) {
    const blob = await (await rfetch(`/jobs/${id}/layout.png`)).blob();
    $("lay").innerHTML = `<img alt="Layout of ${esc(p.top)}" src="${URL.createObjectURL(blob)}">`;
  }
}

checkRunner();

// ---------- optional sign-in + "explain this failure" (needs web/config.js filled in; otherwise nothing shows) ----------
let auth = null, fbUser = null, reviewsLeft = null, API = "", me = null, menuOpen = false;
const authHdr = async () => ({ Authorization: "Bearer " + await fbUser.getIdToken(), "Content-Type": "application/json" });
const api = async (path, body) => fetch(API + path, { method: body ? "POST" : "GET", headers: await authHdr(), body: body && JSON.stringify(body) });
function recordSolve(problem, files) {
  if (fbUser) api("/solve", { problem, files }).then(refreshMe).catch(() => {});
}
function showAuth() {
  const box = $("auth");
  if (fbUser) {
    const img = fbUser.photoURL ? `<img src="${esc(fbUser.photoURL)}" alt="" width="22" height="22" style="border-radius:50%" referrerpolicy="no-referrer">` : `<span aria-hidden="true">●</span>`;
    box.innerHTML = `<button class="pill" id="signout" title="Click to sign out">${img}<span class="stext"> ${esc(fbUser.displayName || fbUser.email || "Signed in")}${me ? ` · ${me.points} point${me.points === 1 ? "" : "s"}` : ""}</span></button>${me?.is_admin ? '<a class="pill" href="admin.html" style="text-decoration:none;background:#1430ff;color:#fff;font-weight:600">Admin</a>' : ""}${menuOpen ? `<button class="pill" id="out">Sign out</button>` : ""}`;
    $("signout").onclick = () => { menuOpen = !menuOpen; showAuth(); };
    if ($("out")) $("out").onclick = () => auth.mod.signOut(auth.auth);
  } else {
    box.innerHTML = `<button class="pill" id="signin">Sign in</button>`;
    $("signin").onclick = () => {
      box.innerHTML = `<span class="pill">Sign in with <button id="gG" class="pill">Google</button><button id="gH" class="pill">GitHub</button></span>`;
      const go = (P) => () => auth.mod.signInWithPopup(auth.auth, new auth.mod[P]()).catch(showAuth);
      $("gG").onclick = go("GoogleAuthProvider"); $("gH").onclick = go("GithubAuthProvider");
    };
  }
  box.hidden = false;
}
async function refreshMe() {
  try {
    const r = await api("/me");
    if (!r.ok) return;
    me = await r.json();
    reviewsLeft = me.reviews_left;
    // first sign-in on this browser: upload solves kept in localStorage
    const extra = [...solved].filter((id) => !me.solved.includes(id) && /^[a-z0-9-]{1,64}$/.test(id));
    if (extra.length && !store.get("uploaded", false)) {
      store.set("uploaded", true);
      await Promise.all(extra.map((id) => api("/solve", { problem: id, files: {} }).catch(() => {})));
      return refreshMe();
    }
    showAuth();
    if (me.is_admin && !sessionStorage.getItem("adminToast")) {
      sessionStorage.setItem("adminToast", "1");
      const t = document.createElement("div");
      t.setAttribute("role", "status");
      t.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;max-width:320px;padding:14px 16px;border-radius:12px;background:#000;color:#fff;border:1px solid #1430ff;font:14px/1.4 sans-serif;display:flex;gap:12px;align-items:center";
      const m = document.createElement("span"); m.textContent = "Welcome back to Project Nishkam, sir.";
      const b = document.createElement("a"); b.href = "admin.html"; b.textContent = "Open admin";
      b.style.cssText = "background:#1430ff;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;white-space:nowrap";
      t.append(m, b); document.body.appendChild(t);
      setTimeout(() => t.remove(), 12000);
    }
  } catch { /* backend unreachable: page works as before */ }
}
async function initAuth() {
  let cfg; try { cfg = (await import("./config.js")).CONFIG; } catch { return; }
  if (!cfg?.api || !cfg.firebase?.apiKey) return;   // empty placeholders: no sign-in UI at all
  API = cfg.api.replace(/\/$/, "");
  const V = "https://www.gstatic.com/firebasejs/11.0.2/";
  const [{ initializeApp }, mod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js")]);
  auth = { mod, auth: mod.getAuth(initializeApp(cfg.firebase)) };
  mod.onAuthStateChanged(auth.auth, async (u) => { fbUser = u; showAuth(); if (u) await refreshMe(); else { reviewsLeft = null; me = null; } showExplain(); });
}
initAuth().catch(() => {});

// text version of the cycle table, same cells the page shows
function cexText(cex) {
  const n = Math.min(cex.cycles - 1, cex.first + 2), cols = [...Array(n + 1).keys()];
  const row = (name, vals) => name + ": " + cols.map((c) => vals[c] ?? "").join(" ");
  return `cycle: ${cols.join(" ")}\n` + [...cex.inputs.map((i) => row(i.name, i.values)),
    ...cex.outputs.flatMap((o) => [row(o.name + " expected", o.expected), row(o.name + " yours", o.got)])].join("\n");
}
let lastFail = null;   // set when a grade fails; the button below uses it
function offerExplain(p, code, cex) { lastFail = { p, code, cex }; showExplain(); }
function showExplain() {
  const slot = $("explain");
  if (!slot) return;
  if (!fbUser || !lastFail || lastFail.p !== current) { slot.innerHTML = ""; return; }
  const left = reviewsLeft ?? 0;
  slot.innerHTML = `<p class="actions"><button id="explainBtn" ${left ? "" : "disabled"}>Explain this failure (${left} of 2 free left)</button></p><div id="hintOut"></div>`;
  $("explainBtn").onclick = async () => {
    const { p, code, cex } = lastFail, out = $("hintOut"), btn = $("explainBtn");
    btn.disabled = true; out.innerHTML = `<p class="muted">Reading your failure…</p>`;
    const tmp = document.createElement("div"); tmp.innerHTML = p.statement;
    try {
      const r = await api("/review", { problemId: p.id, problemText: tmp.textContent.trim().slice(0, 6000), userRtl: code.slice(0, 8000), cycleTable: cexText(cex) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong.");
      reviewsLeft = j.reviews_left;
      out.innerHTML = `<div class="hintline"><b>Hint.</b> ${esc(j.hint).replace(/\n/g, "<br>")}</div>`;
    } catch (e) { out.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; await refreshMe(); }
    btn.textContent = `Explain this failure (${reviewsLeft ?? 0} of 2 free left)`; btn.disabled = !reviewsLeft;
  };
}
