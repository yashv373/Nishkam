// Pure helpers for the Verify stage (no DOM, no workers): usable from the worker, the page and node tests.

// Yosys script that turns the design into one flat model without clock edges and writes it as JSON.
export const prepScript = (srcs, top) => [...srcs.map((p) => `read_verilog -formal -sv ${p}`),
  `prep -top ${top}`, "flatten", "memory_map", "async2sync", "dffunmap", "opt_clean", "write_json model.json"].join("\n");

const lineOf = (src) => { const m = /^(.*?):(\d+)\./.exec(String(src || "").split("|")[0]); return m ? { file: m[1], line: +m[2] } : { file: "", line: 0 }; };

// model.json text -> {top, mod, targets:[{name,kind,label,file,line}], assumes}. kind: assert | cover
export function listTargets(json) {
  const ms = JSON.parse(json).modules || {}, top = Object.keys(ms).find((k) => Number(ms[k].attributes?.top) === 1) || Object.keys(ms)[0];
  const mod = ms[top], targets = [];
  let assumes = 0;
  for (const [name, c] of Object.entries(mod?.cells || {})) {
    if (c.type === "$assume") assumes++;
    if (c.type !== "$assert" && c.type !== "$cover") continue;
    const { file, line } = lineOf(c.attributes?.src), kind = c.type === "$assert" ? "assert" : "cover";
    targets.push({ name, kind, label: name.startsWith("$") ? `${kind === "assert" ? "assertion" : "cover"} at ${file}:${line}` : name, file, line });
  }
  return { top, mod, targets, assumes };
}

// A model that keeps only `t`: an assertion is checked as it is; a cover becomes "assert it never happens", so a failure is a hit.
export function modelFor(top, mod, t) {
  const cells = {}; let max = 0;
  const scan = (b) => { for (const x of b || []) if (typeof x === "number" && x > max) max = x; };
  for (const w of Object.values(mod.netnames || {})) scan(w.bits);
  for (const c of Object.values(mod.cells || {})) for (const b of Object.values(c.connections || {})) scan(b);
  for (const [n, c] of Object.entries(mod.cells || {})) if (c.type !== "$assert" && c.type !== "$cover") cells[n] = c;
  const c = mod.cells[t.name];
  if (t.kind === "assert") cells[t.name] = c;
  else {
    const n1 = max + 1, n2 = max + 2;
    cells.$vf_and = { type: "$logic_and", parameters: { A_SIGNED: 0, A_WIDTH: 1, B_SIGNED: 0, B_WIDTH: 1, Y_WIDTH: 1 }, port_directions: { A: "input", B: "input", Y: "output" }, connections: { A: c.connections.A.slice(0, 1), B: c.connections.EN || ["1"], Y: [n1] } };
    cells.$vf_not = { type: "$logic_not", parameters: { A_SIGNED: 0, A_WIDTH: 1, Y_WIDTH: 1 }, port_directions: { A: "input", Y: "output" }, connections: { A: [n1], Y: [n2] } };
    cells[t.name] = { ...c, type: "$assert", connections: { A: [n2], EN: ["1"] }, port_directions: { A: "input", EN: "input" } };
  }
  return JSON.stringify({ modules: { [top]: { ...mod, cells } } });
}

// sat -tempinduct log -> {status: proven|failed|unknown, cycle}
export function parseSat(log) {
  const k = [...log.matchAll(/Trying induction with length (\d+)/g)].map((m) => +m[1]).pop() || 1;
  if (/Induction step proven: SUCCESS/.test(log)) return { status: "proven", cycle: k };
  if (/model found for base case: FAIL/.test(log)) return { status: "failed", cycle: k };
  return { status: "unknown", cycle: k };
}

export const satScript = (depth, init, baseOnly) =>
  `read_json t.json\nsat ${baseOnly ? "-tempinduct-baseonly" : "-tempinduct"} -maxsteps ${depth} -prove-asserts -set-assumes ${init === "zero" ? "-set-init-zero" : "-set-init-undef -set-def-inputs"} -show-ports -show-regs -dump_vcd cex.vcd`;

// ---- testbench mode ----
const nocomment = (t) => t.replace(/\/\*[^]*?\*\/|\/\/.*/g, "");
// Add a module that dumps the waveform when the testbench does not. -> files (copy)
export function injectDump(files, tbName) {
  const all = Object.values(files).map(nocomment).join("\n");
  if (/\$dumpfile/.test(all)) return files;
  const top = [...nocomment(String(files[tbName] || "")).matchAll(/^\s*module\s+(\w+)/gm)].pop()?.[1];
  if (!top) return files;
  return { ...files, [tbName]: files[tbName] + `\nmodule __nishkam_dump; initial begin $dumpfile("dump.vcd"); $dumpvars(0, ${top}); end endmodule\n` };
}
// Icarus result -> {pass, errors:[{text,time}], note}
export function judgeTb(r) {
  const s = r.summary || {}, out = String(s.stdout || "");
  if (!r.ok) return { pass: false, errors: [{ text: s.error || "simulation failed", time: null }], note: "" };
  const errors = [], L = out.split("\n");
  L.forEach((l, i) => { if (/^(ERROR|FATAL)\b/.test(l) || /\bFAIL\b/.test(l)) errors.push({ text: l.replace(/^(ERROR|FATAL):\s*/, "").trim(), time: +(/Time:\s*(\d+)/.exec(L[i + 1] || "") || [])[1] || null }); });
  if (errors.some((e) => !/^FAIL( |$)/.test(e.text))) errors.splice(0, errors.length, ...errors.filter((e) => !/^FAIL( |$)/.test(e.text)));   // a closing "FAIL n errors" line only repeats the $error lines
  const sawPass = /\bPASS\b/.test(out);
  return { pass: !errors.length, errors, note: !errors.length && !sawPass ? "no errors, but the testbench never printed PASS" : "" };
}
