// Router shorts: Magic's top-cell .ext lists which cell pins it found on one electrical node ("merge" lines).
// A node holding pins of more than one net in the routed DEF is a short. Returns [{nets: [...], pins: ["inst/pin", ...]}].
export function findShorts(extText, defText) {
  const par = {}, find = (x) => { par[x] ??= x; while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (const m of extText.matchAll(/^merge "([^"]+)" "([^"]+)"/gm)) par[find(m[1])] = find(m[2]);
  const owner = {};
  for (const blk of defText.slice(defText.indexOf("\nNETS"), defText.indexOf("END NETS")).split("\n- ").slice(1)) {
    const name = blk.split(/\s/)[0];
    for (const p of blk.split("+ ROUTED")[0].matchAll(/\( (\S+) (\S+) \)/g)) owner[p[1] === "PIN" ? p[2] : p[1] + "/" + p[2]] = name;
  }
  const groups = {};
  for (const k of Object.keys(par)) (groups[find(k)] ??= []).push(k);
  const out = [];
  for (const mem of Object.values(groups)) {
    const pins = mem.filter((x) => owner[x] && !/^(VDD|VSS|VNW|VPW)$/.test(owner[x]));
    const nets = [...new Set(pins.map((x) => owner[x]))];
    if (nets.length > 1) out.push({ nets, pins });
  }
  return out;
}

export const shortsMessage = (shorts) => !shorts.length ? "" :
  "The in-browser router (qrouter) can short tight input pins on some gf180 cells. This is a known limit of the browser flow, not of your design.\n" +
  shorts.slice(0, 10).map((s) => `Router short: ${s.pins.slice(0, 4).join(" <-> ")}${s.pins.length > 4 ? " ..." : ""} (nets ${s.nets.slice(0, 4).join(", ")}${s.nets.length > 4 ? ", ..." : ""})`).join("\n") +
  (shorts.length > 10 ? `\n... and ${shorts.length - 10} more` : "");
