// DEF -> compact object (all coordinates in um). Pure function: used by layout.worker.js and by parse.test.mjs.
export function parseDef(text) {
  const dbu = +(/UNITS\s+DISTANCE\s+MICRONS\s+(\d+)/.exec(text) || [0, 1000])[1];
  const u = (v) => v / dbu;
  const out = { dbu, die: [0, 0, 0, 0], rows: [], comps: [], pins: [], nets: [], layers: [], segs: [], vias: [] };
  const die = /DIEAREA\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)/.exec(text);
  if (die) out.die = die.slice(1, 5).map((v) => u(+v));
  for (const m of text.matchAll(/^ROW\s+\S+\s+\S+\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s+DO\s+(\d+)\s+BY\s+(\d+)\s+STEP\s+(\d+)\s+(\d+)/gm))
    out.rows.push([u(+m[1]), u(+m[2]), +m[4], +m[5], u(+m[6]), u(+m[7]), m[3]]);
  const sect = (name) => {
    const a = text.indexOf("\n" + name + " ");
    if (a < 0) return [];
    const b = text.indexOf("\nEND " + name, a);
    return text.slice(text.indexOf(";", a) + 1, b < 0 ? undefined : b).split(/;\s*\n/);
  };
  for (const s of sect("COMPONENTS")) {
    const m = /-\s+(\S+)\s+(\S+)[\s\S]*?\+\s+(PLACED|FIXED|COVER)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s+(\S+)/.exec(s);
    if (m) out.comps.push({ n: m[1], m: m[2], x: u(+m[4]), y: u(+m[5]), o: m[6], fixed: m[3] !== "PLACED" });
  }
  for (const s of sect("PINS")) {
    const m = /-\s+(\S+)\s+\+\s+NET\s+(\S+)/.exec(s);
    if (!m) continue;
    const l = /\+\s+LAYER\s+(\S+)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)/.exec(s);
    const p = /\+\s+(?:PLACED|FIXED)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)/.exec(s);
    if (!l || !p) continue;
    const px = u(+p[1]), py = u(+p[2]);
    out.pins.push({ n: m[1], net: m[2], layer: l[1], r: [px + u(+l[2]), py + u(+l[3]), px + u(+l[4]), py + u(+l[5])] });
  }
  const layerIdx = new Map();
  const lay = (n) => { if (!layerIdx.has(n)) { layerIdx.set(n, out.layers.length); out.layers.push(n); } return layerIdx.get(n); };
  const nets = (name, special) => {
    for (const s of sect(name)) {
      const h = /-\s+(\S+)/.exec(s);
      if (!h) continue;
      const net = { n: h[1], clock: /\+\s+USE\s+CLOCK/.test(s) || /^clk/i.test(h[1]), special, conns: [] };
      for (const c of s.matchAll(/\(\s*(\S+)\s+(\S+)\s*\)/g)) if (c[1] !== "PIN" && c[1] !== "*") net.conns.push(c[1]);
      const ni = out.nets.push(net) - 1;
      const r = s.indexOf("+ ROUTED");
      if (r < 0) continue;
      const t = s.slice(r).replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/);
      let layer = -1, w = 0, px = 0, py = 0, pend = null;
      for (let i = 0; i < t.length; i++) {
        const k = t[i];
        if (k === "+") { const nx = t[i + 1]; if (nx === "ROUTED" || nx === "FIXED" || nx === "COVER") { i++; pend = "layer"; } else i += nx === "SHAPE" || nx === "USE" ? 2 : 1; }
        else if (k === "NEW") pend = "layer";
        else if (k === "RECT") { while (t[i] !== ")" && i < t.length) i++; } // patch rectangle, not a wire
        else if (pend === "layer") { layer = lay(k); pend = "w"; w = 0; }
        else if (k === "(") {
          let x = t[i + 1], y = t[i + 2]; i += 3; // skips optional ext value up to ")"
          while (t[i] !== ")" && i < t.length) i++;
          x = x === "*" ? px : +x; y = y === "*" ? py : +y;
          if (pend === "pt") out.segs.push([layer, u(px), u(py), u(x), u(y), u(w), ni, special ? 1 : 0]);
          px = x; py = y; pend = "pt";
        } else if (pend === "w" && /^\d+$/.test(k)) w = +k;
        else if (pend === "pt" && /^[A-Za-z]/.test(k)) out.vias.push([u(px), u(py), ni, k]);
      }
    }
  };
  nets("SPECIALNETS", 1);
  nets("NETS", 0);
  return out;
}
