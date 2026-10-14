// Checks the landing page "Runs in" column against the code. Run: node web/landing.check.mjs
import { readFileSync, existsSync } from "node:fs";
const dir = new URL(".", import.meta.url), rd = (f) => readFileSync(new URL(f, dir), "utf8");
const html = rd("index.html"), stages = rd("studio/stages.js"), app = rd("studio/app.js");
const rows = Object.fromEntries([...html.matchAll(/<tr><td>([^<]+)<\/td><td>[^<]*<\/td><td class="w">([^<]+)<\/td><\/tr>/g)].map((m) => [m[1], m[2]]));
const lsBody = app.slice(app.indexOf("async function localStage"), app.indexOf("// Which project files"));
const hasLocal = (id) => new RegExp(`id === "${id}"`).test(lsBody) && !new RegExp(`id === "${id}"\\) return \\{[^}]*unavailable`).test(lsBody);
const hasRunner = (id) => new RegExp(`id: "${id}"[^}]*where: "runner"`).test(stages);
const f = (n) => existsSync(new URL("studio/engines/" + n, dir));
// row -> [stage id, extra files that must exist if the row says Browser]
const want = { "Placement": ["place", "place.js"], "Clock tree": ["cts", "cts.js"], "Routing": ["route", "route.js"], "Timing": ["sta", "opensta.js"], "DRC · GDS": ["signoff", "magic.js"], "RC extraction": [null, "spef.js"], "LVS": [null, "lvs.js"] };
const bad = [];
for (const [row, [id, file]] of Object.entries(want)) {
  const txt = rows[row]; if (!txt) { bad.push(`row "${row}" missing from the tools table`); continue; }
  const browser = /Browser/.test(txt), runner = /Runner/.test(txt);
  const trueBrowser = id ? hasLocal(id) : f(file);
  if (browser !== (trueBrowser && (!file || f(file)))) bad.push(`${row}: table says "${txt}" but code says browser=${trueBrowser && (!file || f(file))}`);
  if (id && runner !== hasRunner(id)) bad.push(`${row}: table says "${txt}" but stages.js runner=${hasRunner(id)}`);
}
if (!/ttexplorer/.test(rd("studio/viewers/gds.js")) && !f("../viewers/ttexplorer.js") ) bad.push("ttexplorer.js missing");
else if (!/Tiny Tapeout/.test(rows["Layout view"] ? html : "")) bad.push("Tiny Tapeout Explorer missing from the page");
if (bad.length) { console.error("landing.check FAILED:\n- " + bad.join("\n- ")); process.exit(1); }
console.log("landing.check ok: " + Object.keys(want).length + " rows match the code");
