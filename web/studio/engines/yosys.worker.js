// Yosys (YoWASP, same pinned URL as web/worker.js so the browser cache is shared) for lint + synthesis.
import { serve, readText, text } from "./_rpc.js";

export const YOSYS_URL = "https://cdn.jsdelivr.net/npm/@yowasp/yosys@0.68.1207/gen/bundle.js";
const LIB_URL = new URL("../../vendor/gf180mcu/7b70722/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.trimmed.lib", import.meta.url);
// Cells LibreLane's gf180mcuD config refuses to synthesize (scan flops): libs.tech/librelane/.../no_synth.cells
const DONT_USE = ["sdffq", "sdffrnq", "sdffrsnq", "sdffsnq"].flatMap((n) => [1, 2, 4].map((d) => `gf180mcu_fd_sc_mcu7t5v0__${n}_${d}`));

let mod; // tests set globalThis.__yosysModule to a Node-installed @yowasp/yosys
const load = () => (mod ||= globalThis.__yosysModule || import(YOSYS_URL));

const readAll = (files) => Object.keys(files).filter((p) => /\.(v|sv|vh|svh)$/.test(p)).map((p) => `read_verilog -sv ${p}`);

async function yosys(script, files, { log, progress }) {
  const { runYosys, Exit } = await load();
  const out = [];
  const sink = (b) => { if (b) { const s = text(b); out.push(s); log(s); } };
  let fs, ok = true;
  try {
    fs = await runYosys(["-q", "-s", "run.ys"], { ...files, "run.ys": script }, {
      stdout: sink, stderr: sink,
      fetchProgress: ({ doneLength, totalLength }) => progress(totalLength ? doneLength / totalLength : 0),
    });
  } catch (e) { if (!(e instanceof Exit)) throw e; ok = false; fs = e.files; }
  return { ok, fs: fs || {}, log: out.join("") };
}

// "file.v:3: ERROR: ..." / "Warning: ..." -> messages
export function parseMessages(logText) {
  const msgs = [];
  for (const l of logText.split("\n")) {
    const m = l.match(/^(?:(.+?):(\d+)(?:\.\d+-\d+\.\d+)?: )?(ERROR|Warning|WARNING): (.*)$/);
    if (m) msgs.push({ severity: m[3] === "ERROR" ? "error" : "warning", file: m[1] || "", line: m[2] ? +m[2] : 0, text: m[4] });
  }
  return msgs;
}

export function parseStat(s) {
  const n = (re) => { const m = s.match(re); return m ? +m[1] : null; };
  const kinds = [...s.matchAll(/^\s+(\d+)\s+(?:[\d.]+\s+)?(?:gf180mcu_fd_sc_mcu7t5v0__)?(\$?\w+)\s*$/gm)]
    .filter((k) => k[2] !== "cells").map((k) => [k[2], +k[1]]);
  return { cells: n(/^\s*(\d+)\s+(?:[\d.]+\s+)?cells$/m) ?? n(/Number of cells:\s+(\d+)/), area: n(/Chip area for (?:top )?module.*?:\s*([\d.]+)/), kinds };
}

export async function handle({ mode, files, options = {} }, cb) {
  const top = options.top;
  const topArg = top ? `-top ${top}` : "-auto-top";
  const hier = `hierarchy -check ${topArg}`;
  const src = readAll(files);
  if (!src.length) throw new Error("no .v/.sv files given");
  if (mode === "lint") {
    const r = await yosys([...src, hier].join("\n"), files, cb);
    const messages = parseMessages(r.log);
    return { ok: r.ok, files: {}, summary: { errors: messages.filter((m) => m.severity === "error").length, warnings: messages.filter((m) => m.severity === "warning").length, messages } };
  }
  const lib = await readText(LIB_URL);
  const du = DONT_USE.map((c) => `-dont_use ${c}`).join(" ");
  const script = [
    ...src, hier,
    `prep ${topArg}`, "write_json rtl.json", // word-level view for the schematic
    `synth ${topArg} -flatten`,
    `dfflibmap -liberty cells.lib ${du}`,
    `abc -liberty cells.lib ${du}`,
    "opt_clean -purge",
    "tee -o stat.txt stat -liberty cells.lib",
    "write_verilog -noattr netlist.v", "write_json netlist.json",
  ].join("\n");
  const r = await yosys(script, { ...files, "cells.lib": lib }, cb);
  const messages = parseMessages(r.log);
  if (!r.ok) return { ok: false, files: {}, summary: { errors: messages.filter((m) => m.severity === "error").length, messages } };
  const stat = r.fs["stat.txt"] ? parseStat(text(r.fs["stat.txt"])) : {};
  const outFiles = {};
  for (const f of ["netlist.v", "netlist.json", "rtl.json", "stat.txt"]) if (r.fs[f] != null) outFiles[f] = text(r.fs[f]);
  return { ok: true, files: outFiles, summary: { ...stat, library: "gf180mcu_fd_sc_mcu7t5v0 tt_025C_5v00", messages } };
}

serve(handle);
