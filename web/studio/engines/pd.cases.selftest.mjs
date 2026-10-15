// node web/studio/engines/pd.cases.selftest.mjs [name]  (run from a folder with @yowasp/yosys in node_modules)
// Each case runs the browser flow (pd.flow.mjs) and must route with 0 failed nets. Big ones (mult10 .. rmult20) only run when named.
import { createHash } from "node:crypto";
import { flow, DESIGNS } from "./pd.flow.mjs";
const names = process.argv[2] ? [process.argv[2]] : ["twoclk", "twoclk2", "twoclk3", "adder", "adder2", "pins40", "tiny8", "mult8"];
let fail = 0;
for (const n of names) {
  const r = await flow(...DESIGNS[n]);
  const ok = r.failed === 0; fail += !ok;
  if (!ok) console.log(r.out.split("\n").filter((l) => /^Error|Tap geometry|^Grid/.test(l)).slice(0, 12).join("\n"));
  console.log(ok ? "PASS" : "FAIL", n, `def ${createHash('md5').update(r.pl.files[DESIGNS[n][0] + '.def']).digest('hex').slice(0, 6)}, ${r.cells} cells, failed nets ${r.failed} ${r.names.join(" ")}, ${JSON.stringify(r.T)}`);
}
process.exit(fail ? 1 : 0);
