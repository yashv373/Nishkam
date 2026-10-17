// Deploy-time only: node .github/stamp.mjs <dir> <version>
// Adds ?v=<version> to every same-origin .js/.mjs specifier ("./x.js", "../x.js", `./engines/${n}.js`, "worker.js", src="app.js")
// in <dir>'s js/mjs/html files (not vendor/), so one deploy = one consistent module and worker graph. Source files stay untouched.
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
const [dir, v] = process.argv.slice(2);
if (!dir || !v) throw new Error("usage: stamp.mjs <dir> <version>");
// closing quote right after .js, no existing query; or a `./...${expr}.js` template
const re = /(["'`])((?:\.{1,2}\/)?[^"'`\s?]*?\.m?js)\1|`(\.\/[^`]*\$\{[^`]*\}\.js)`/g;
let n = 0;
// only our own files: a name with no matching file next to it (e.g. firebase-app.js on the CDN) is left alone
const skip = (spec) => /^(https?:|\/\/|node:)/.test(spec) || spec.includes("vendor/") || (!spec.startsWith(".") && spec.includes("/"));
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (f === "vendor" || f === "node_modules") continue;
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(m?js|html)$/.test(f)) continue;
    const s = readFileSync(p, "utf8");
    const t = s.replace(re, (m, q, spec, tpl) => (tpl ? (n++, `\`${tpl}?v=${v}\``) : skip(spec) || !existsSync(join(d, spec)) ? m : (n++, `${q}${spec}?v=${v}${q}`)));
    if (t !== s) writeFileSync(p, t);
  }
};
walk(dir);
console.log(`stamped ${n} specifiers with ?v=${v}`);
