// Usage: node trim_liberty.mjs full.lib out.lib
// Keeps cells, areas, pins, functions and flop/latch groups; drops timing, power and leakage tables.
// Enough for Yosys abc/dfflibmap mapping and area reports. NOT for timing: use the full liberty for STA.
import fs from "node:fs";
const [, , src, dst] = process.argv;
const DROP = /^\s*(timing|internal_power|leakage_power|pg_pin|ccsn_\w+|receiver_capacitance\w*)\s*\(.*\{\s*$/;
let depth = 0, skip = 0;
const out = [];
for (const line of fs.readFileSync(src, "utf8").split("\n")) {
  const o = (line.match(/\{/g) || []).length, c = (line.match(/\}/g) || []).length;
  if (skip) { skip += o - c; continue; }
  if (DROP.test(line)) { skip = 1; continue; }
  out.push(line);
}
fs.writeFileSync(dst, out.join("\n"));
