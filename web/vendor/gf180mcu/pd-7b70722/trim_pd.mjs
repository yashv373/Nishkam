// Trim the full PDK files (iic-osic-tools $PDK_ROOT/gf180mcuD) to the cells the browser flow can use.
// usage: node trim_pd.mjs <full_dir> <out_dir>      keeps: all fill/tie/endcap/antenna, drive 1/2 of everything, drive 4 of buf/clkbuf/inv/clkinv.
import fs from "node:fs";
const [src, dst] = process.argv.slice(2);
const P = "gf180mcu_fd_sc_mcu7t5v0__";
const keep = (n) => {
  const m = n.replace(P, "").match(/^([a-z0-9]+?)(?:_(\d+))?$/); if (!m) return true;
  const [, base, drv] = m;
  if (/^(fill|fillcap|filltie|endcap|antenna|tieh|tiel|hold)$/.test(base)) return true;
  if (/^(buf|clkbuf|inv|clkinv)$/.test(base)) return +drv <= 8 || false;
  return +drv <= 2;
};
const lef = fs.readFileSync(`${src}/gf180mcu_fd_sc_mcu7t5v0.lef`, "utf8");
const first = lef.indexOf("\nMACRO ") + 1, endLib = lef.lastIndexOf("END LIBRARY");
const macros = lef.slice(first, endLib).split(/(?=^MACRO )/m).filter((b) => keep(b.match(/^MACRO (\S+)/)[1]));
const names = new Set(macros.map((b) => b.match(/^MACRO (\S+)/)[1]));
fs.writeFileSync(`${dst}/gf180mcu_fd_sc_mcu7t5v0.lef`, lef.slice(0, first) + macros.join("") + "END LIBRARY\n");
const sp = fs.readFileSync(`${src}/gf180mcu_fd_sc_mcu7t5v0.spice`, "utf8");
const si = sp.search(/^\.SUBCKT/im);
const subs = sp.slice(si).split(/(?=^\.SUBCKT)/im).filter((b) => names.has(b.match(/^\.SUBCKT (\S+)/i)[1]));
fs.writeFileSync(`${dst}/gf180mcu_fd_sc_mcu7t5v0.spice`, sp.slice(0, si) + subs.join(""));
const g = fs.readFileSync(`${src}/gf180mcu_fd_sc_mcu7t5v0.gds`);
const recs = []; for (let o = 0; o < g.length;) { const l = g.readUInt16BE(o); recs.push([g.readUInt16BE(o + 2), o, l]); o += l; }
const out = []; let cur = null, hdr = true, nk = 0, nd = 0;
for (const [t, o, l] of recs) {
  const buf = g.subarray(o, o + l);
  if (t === 0x0502) { hdr = false; cur = { recs: [] }; }
  if (hdr) out.push(buf); else if (cur) {
    cur.recs.push(buf);
    if (t === 0x0606) cur.name = buf.subarray(4).toString().replace(/\0+$/, "");
    if (t === 0x0700) { if (names.has(cur.name)) { out.push(...cur.recs); nk++; } else nd++; cur = null; }
  } else out.push(buf); // ENDLIB
}
fs.writeFileSync(`${dst}/gf180mcu_fd_sc_mcu7t5v0.gds`, Buffer.concat(out));
console.log(`kept ${names.size} cells (GDS structures kept ${nk}, dropped ${nd})`);
