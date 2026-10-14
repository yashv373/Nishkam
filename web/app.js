import { PROBLEMS, HARDEN_KNOBS } from "./problems.js";
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
  const how = p.kind === "rtl"
    ? `Graded by formal equivalence: Yosys' SAT solver compares your design with a reference for <b>every</b> input sequence: it tries to prove they match for all cycles, and otherwise checks the first ${DEPTH} cycles after reset. If they ever differ, you get the exact cycle where they differ. Ctrl+Enter submits.`
    : `You edit the knobs (JSON). The RTL is fixed. Allowed: <code>DIE_AREA</code> [x0, y0, x1, y1] in µm, <code>PL_TARGET_DENSITY_PCT</code>, <code>SYNTH_STRATEGY</code> (e.g. "AREA 0"), <code>GRT_ALLOW_CONGESTION</code>.`;
  $("statement").innerHTML = `<h1>${esc(p.title)}</h1>
    <div class="tags"><span class="tag diff ${p.difficulty}">${p.difficulty}</span>${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    ${p.statement}<div class="how">${how}</div>`;
  monaco.editor.setModelLanguage(editor.getModel(), p.kind === "rtl" ? "systemverilog" : "json");
  editor.setValue(store.get(codeKey(p), p.starter));
  $("result").innerHTML = `<p class="muted">${p.kind === "rtl" ? "Write your design, then Submit." : "Pick your knobs, then Run flow."}</p>`;
  renderList(); renderButtons();
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
  if (res.passed) {
    solved.add(p.id); store.set("solved", [...solved]); renderList();
    const kinds = res.stat?.kinds?.map(([k, n]) => `${n}× ${k}`).join(", ") || "";
    $("result").innerHTML = `<div class="banner ok big">✓ Accepted
        <small>${res.proved ? "Proved equal to the reference for all cycles after reset." : `Matches the reference for the first ${DEPTH} cycles after reset (a full proof was not possible).`} ${solvedN()} of ${PROBLEMS.length} solved.</small></div>
      <p class="actions">${nextStep()}</p>
      ${res.stat?.cells ? `<p><b>${res.stat.cells}</b> generic cells after synthesis <span class="muted">(${esc(kinds)})</span></p>` : ""}
      <p><button id="harden" ${runnerInfo ? "" : "disabled"}>Take it to silicon (gf180)</button>
      <span class="muted">${runnerInfo ? "Runs LibreLane on your machine, about 2 minutes." : "Connect the local runner to place and route this design."}</span></p>
      <div id="flow"></div>`;
    wireNext();
    $("harden").onclick = () => runFlow({ ...p, checks: null }, { [`${p.top}.v`]: code }, HARDEN_KNOBS, $("flow"));
  } else if (res.cex) {
    const c = res.cex, o = c.outputs.find((o) => o.expected[c.first] !== "x" && o.expected[c.first] !== o.got[c.first]);
    const what = o ? `Your design differs from the reference at cycle ${c.first} on output <code>${esc(o.name)}</code>: expected ${esc(o.expected[c.first])}, yours gave ${esc(o.got[c.first] || "nothing")}.`
      : `Your design differs from the reference at cycle ${c.first}.`;
    $("result").innerHTML = `<div class="banner bad">Wrong answer<small>${what}</small></div>
      ${cexTable(c)}
      <p class="actions"><button class="primary" id="again">Fix it and submit again</button>
      <button id="spec">Show the spec</button></p>`;
    $("again").onclick = () => editor.focus();
    $("spec").onclick = () => $("statement").scrollIntoView({ block: "start", behavior: "smooth" });
  } else {
    $("result").innerHTML = explainError(res.log || "", res.error);
  }
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
  if (p.checks && allOk) { solved.add(p.id); store.set("solved", [...solved]); renderList(); }
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
