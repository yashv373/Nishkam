// Log pane (5000-line cap, autoscroll pauses when you scroll up), Messages list, optional shell line.
const CAP = 5000;
export function createConsole({ logEl, msgEl, msgCount, filterEl, timerEl, shellRow, onShell }) {
  const lines = []; let filter = "", auto = true, t0 = 0, tick = 0, dirty = false;
  const msgs = [];
  logEl.addEventListener("scroll", () => { auto = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8; });
  const sev = (l) => /\bERROR\b|\bfatal\b|\bFAIL\b/i.test(l) ? "err" : /\bWARNING\b/i.test(l) ? "warn" : "";
  function paint() {
    dirty = false;
    const view = filter ? lines.filter((l) => l.stage === filter) : lines;
    logEl.textContent = view.map((l) => l.text).join("\n");
    if (auto) logEl.scrollTop = logEl.scrollHeight;
  }
  const schedule = () => { if (!dirty) { dirty = true; setTimeout(paint, 50); } };   // not rAF: it never fires in a background tab, so the log froze };
  function renderMsgs() {
    const e = msgs.filter((m) => m.sev === "err").length, w = msgs.filter((m) => m.sev === "warn").length;
    msgCount.textContent = msgs.length ? `${e ? e + "E " : ""}${w ? w + "W" : ""}`.trim() : "0";
    msgCount.className = "count " + (e ? "err" : w ? "warn" : "");
    msgEl.replaceChildren(...msgs.slice(-500).map((m) => { const d = document.createElement("div"); d.className = "msg " + m.sev;
      d.textContent = `[${m.stage}] ${m.text}`; return d; }));
  }
  return {
    log(stage, text) {
      for (const t of String(text).split("\n")) {
        if (t === "") continue;
        lines.push({ stage, text: t }); const s = sev(t);
        if (s) msgs.push({ stage, sev: s, text: t });
      }
      if (lines.length > CAP) lines.splice(0, lines.length - CAP);
      schedule(); renderMsgs();
    },
    // a stage that passed recovered from its own tool errors (retries): keep them visible, stop counting them
    settle(stage) { for (const m of msgs) if (m.stage === stage && m.sev === "err") m.sev = "info"; renderMsgs(); },
    clear() { lines.length = 0; msgs.length = 0; paint(); renderMsgs(); },
    setFilter(s) { filter = s || ""; filterEl.textContent = filter ? "stage: " + filter + "  (click to clear)" : "all stages"; paint(); },
    startTimer() { t0 = Date.now(); clearInterval(tick); tick = setInterval(() => { timerEl.textContent = ((Date.now() - t0) / 1000).toFixed(0) + " s"; }, 1000); },
    stopTimer() { clearInterval(tick); },
    enableShell(on) { shellRow.hidden = !on; },
    // the container login banner prints "[INFO] Final PATH/PYTHONPATH" lines; drop them (chunks may split a line, so buffer the tail)
    async shellSubmit(cmd) {
      this.log("shell", "$ " + cmd); let buf = "";
      const bad = (l) => /^\[INFO\] Final (PATH|PYTHONPATH)/.test(l);
      const put = (t) => { const ls = (buf + t).split("\n"); buf = ls.pop(); const keep = ls.filter((l) => !bad(l)); if (keep.length) this.log("shell", keep.join("\n")); };
      await onShell(cmd, put);
      if (buf && !bad(buf)) this.log("shell", buf);
    },
  };
}

// Raw logs: tool stdout/stderr exactly as the tool printed it. Headers are UI chrome (CSS ::before, not selectable/copyable).
// Display keeps the last RAW_CAP lines; downloads keep everything.
const RAW_CAP = 20000;
const nl = (s) => { let n = 0; for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++; return n; };
export function createRawConsole({ el, selectEl, noteEl, onDownload }) {
  const invs = []; let sel = "", auto = true, dirty = false, lastCall = null;
  const group = (t) => t.split("/")[0];
  el.addEventListener("scroll", () => { auto = el.scrollTop + el.clientHeight >= el.scrollHeight - 8; });
  function options() {
    const groups = [...new Set(invs.map((i) => group(i.tool)))];
    if (selectEl.options.length - 1 === groups.length) return;
    selectEl.replaceChildren(new Option("All tools", ""), ...groups.map((g) => new Option(g, g)));
    selectEl.value = sel;
  }
  function paint() {
    dirty = false; options();
    const view = invs.filter((i) => !sel || group(i.tool) === sel);
    let total = view.reduce((a, i) => a + i.lines, 0), drop = total - RAW_CAP, dropped = 0;
    const nodes = [];
    for (const i of view) {
      let t = i.text;
      if (drop > 0) { // cut whole lines from the oldest output first
        if (i.lines <= drop) { drop -= i.lines; dropped += i.lines; continue; }
        let at = 0; for (let k = 0; k < drop; k++) at = t.indexOf("\n", at) + 1;
        t = t.slice(at); dropped += drop; drop = 0;
      }
      const h = document.createElement("div"); h.className = "rawhdr"; h.dataset.t = `── ${i.tool} (stdout+stderr) ──`;
      const p = document.createElement("span"); p.textContent = t; nodes.push(h, p);
    }
    noteEl.hidden = !dropped; noteEl.textContent = dropped ? `older lines dropped (${dropped}): download for the full log` : "";
    el.replaceChildren(...nodes);
    if (auto) el.scrollTop = el.scrollHeight;
  }
  const schedule = () => { if (!dirty) { dirty = true; setTimeout(paint, 100); } };
  selectEl.onchange = () => { sel = selectEl.value; paint(); };
  return {
    add(tool, chunk, stream, callId, begin) {
      let i = invs[invs.length - 1];
      if (!i || i.tool !== tool || i.call !== callId || begin) { i = { tool, call: callId, text: "", lines: 0 }; invs.push(i); }
      i.text += chunk; i.lines += nl(chunk); schedule();
    },
    clear() { invs.length = 0; sel = ""; selectEl.value = ""; paint(); },
    // all=true joins every tool with a plain separator line; a single tool is its text byte-for-byte
    text(tool) { const v = invs.filter((i) => !tool || group(i.tool) === tool); return tool ? v.map((i) => i.text).join("") : v.map((i) => `===== ${i.tool} =====
${i.text}`).join(""); },
    get tool() { return sel; },
    refresh: paint,
  };
}
