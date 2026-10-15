// OpenSTA report_checks text -> paths. Pure function: used by timing.js and parse.test.mjs.
export function parseSta(text, maxPaths = 3000) {
  const paths = [];
  const blocks = text.split(/^Startpoint: /m).slice(1);
  for (const b of blocks) {
    if (paths.length >= maxPaths) break;
    const L = b.split("\n");
    const end = /^Endpoint: (\S+)(?:.*clocked by (\S+)\))?/m.exec(b);
    const sl = /^\s*(-?[\d.]+)\s+slack \((\w+)\)/m.exec(b);
    if (!end || !sl) continue;
    const num = (re) => { const m = re.exec(b); return m ? +m[1] : NaN; };
    const p = {
      start: L[0].split(" ")[0], end: end[1], clock: end[2] || (/clocked by (\S+)\)/.exec(L[0]) || [])[1] || "",
      slack: +sl[1], met: sl[2] === "MET", kind: /^Endpoint:.*(?:recovery|removal)/m.test(b) ? "async" : "data",   // async reset recovery/removal check vs a normal data (D) check
      arrival: num(/^\s*(-?[\d.]+)\s+data arrival time/m), required: num(/^\s*(-?[\d.]+)\s+data required time/m),
      rows: [],
    };
    let section = "data";
    for (const l of L) {
      if (/data arrival time/.test(l)) { section = "capture"; continue; }
      const m = /^\s*((?:[\d.]+\s+){0,3})(-?[\d.]+)\s+(-?[\d.]+)\s+([\^v])\s+(\S+)\s+\((\S+)\)\s*$/.exec(l);
      if (!m) continue;
      const pre = m[1].trim() ? m[1].trim().split(/\s+/).map(Number) : [];
      const [fanout, cap, slew] = pre.length === 3 ? pre : [null, null, pre[pre.length - 1] ?? null];
      p.rows.push({ section, pin: m[5], cell: m[6].replace(/^gf180mcu_fd_sc_mcu\w+?__/, ""), edge: m[4], fanout, cap, slew, delay: +m[2], time: +m[3] });
    }
    paths.push(p);
  }
  return paths;
}
