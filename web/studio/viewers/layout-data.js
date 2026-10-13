// Turns the parseDef object into typed arrays (cheap to transfer, cheap to draw).
export function flatten(p) {
  const segs = new Float32Array(p.segs.length * 8);
  p.segs.forEach((s, i) => segs.set(s, i * 8)); // layer,x0,y0,x1,y1,w,net,special
  const vias = new Float32Array(p.vias.length * 3);
  p.vias.forEach((v, i) => vias.set(v.slice(0, 3), i * 3));
  const d = {
    die: p.die, rows: p.rows, layers: p.layers, segs, vias,
    comps: p.comps, pins: p.pins,
    nets: p.nets.map((n) => ({ n: n.n, clock: n.clock, special: n.special, conns: n.conns })),
  };
  return { d, transfer: [segs.buffer, vias.buffer] };
}
