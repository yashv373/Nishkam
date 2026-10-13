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
    const e = msgs.filter((m) => m.sev === "err").length, w = msgs.length - e;
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
    clear() { lines.length = 0; msgs.length = 0; paint(); renderMsgs(); },
    setFilter(s) { filter = s || ""; filterEl.textContent = filter ? "stage: " + filter + "  (click to clear)" : "all stages"; paint(); },
    startTimer() { t0 = Date.now(); clearInterval(tick); tick = setInterval(() => { timerEl.textContent = ((Date.now() - t0) / 1000).toFixed(0) + " s"; }, 1000); },
    stopTimer() { clearInterval(tick); },
    enableShell(on) { shellRow.hidden = !on; },
    shellSubmit(cmd) { this.log("shell", "$ " + cmd); return onShell(cmd, (t) => this.log("shell", t)); },
  };
}
