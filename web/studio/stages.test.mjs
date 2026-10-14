import assert from "node:assert/strict";
import { plan, batches, runStages } from "./stages.js";
assert.deepEqual(plan("to", "synth"), ["lint", "sim", "synth"]);
assert.deepEqual(plan("one", "cts"), ["cts"]);
assert.deepEqual(plan("one", "files"), []);
assert.equal(plan("all").length, 10);
assert.deepEqual(plan("from", "route"), ["route", "sta", "signoff"]);
assert.deepEqual(batches(["lint", "floorplan", "place", "sta"]).map((b) => b.ids.join("+")), ["lint", "floorplan+place+sta"]);
const mk = (hasRunner, failId) => {
  const st = {}, jobs = [];
  return { st, jobs, deps: { hasRunner: () => hasRunner, files: () => ({}), options: () => ({}), onLog() {},
    setState: (id, s) => (st[id] = s),
    engine: async (s) => { if (s.engine === "netlistsvg") throw new Error("missing"); return { run: async () => ({ ok: s.id !== failId, files: { [s.id]: 1, ...(s.id === "synth" ? { "netlist.json": 1 } : {}) } }) }; },
    runnerJob: async (j) => (jobs.push(j), { ok: true }) } };
};
let t = mk(false); await runStages(plan("all"), t.deps);
assert.equal(t.st.schematic, "unavailable"); assert.equal(t.st.floorplan, "unavailable"); assert.equal(t.st.synth, "passed");
t = mk(true); await runStages(plan("all"), t.deps);
assert.deepEqual(t.jobs.map((j) => [j.from, j.to]), [["floorplan", "signoff"]]); assert.equal(t.st.sta, "passed");
t = mk(true, "lint"); await runStages(plan("all"), t.deps);
assert.equal(t.st.lint, "failed"); assert.equal(t.st.synth, "idle"); assert.equal(t.jobs.length, 0);
console.log("stages ok");
import { stageOf, parseLoose, countCells, engineId } from "./stages.js";
assert.deepEqual(["10-openroad-floorplan", "34-openroad-detailedplacement", "35-openroad-cts", "44-openroad-detailedrouting", "55-openroad-stapostpnr", "63-magic-drc", "16-odb-addroutingobstructions", "15-odb-removepdnobstructions"].map(stageOf),
  ["floorplan", "place", "cts", "route", "sta", "signoff", "place", "floorplan"]);
assert.deepEqual(parseLoose('{"a":NaN,"b":-Infinity,"c":"NaN Infinity","d":[Infinity,1]}'), { a: null, b: null, c: "NaN Infinity", d: [null, 1] });
assert.equal(countCells('{"modules":{"a":{"cells":{"x":1,"y":2}},"b":{}}}'), 2);
assert.equal(engineId({ engine: "yosys", pick: "lintEngine" }, { lintEngine: "verilator-wasm" }), "verilator-lint");
{ const t = mk(true); t.deps.runnerJob = async () => ({ ok: false, failed: "cts" }); await runStages(["floorplan", "place", "cts", "route"], t.deps);
  assert.deepEqual([t.st.floorplan, t.st.place, t.st.cts, t.st.route], ["passed", "passed", "failed", "idle"]); }
{ const t = mk(false); t.deps.engine = async () => ({ run: async () => ({ ok: true }) });
  await runStages(["schematic"], t.deps); assert.equal(t.st.schematic, "failed"); }
console.log("stages2 ok");
{ const t = mk(false); const seen = [];
  t.deps.local = () => true;
  t.deps.localStage = async (id) => (seen.push(id), id === "cts" ? { ok: true, state: "unavailable", info: "skipped" } : { ok: id !== "route", files: { ["browser/" + id]: 1 } });
  await runStages(["floorplan", "place", "cts", "route", "sta", "signoff"], t.deps);
  assert.deepEqual(seen, ["floorplan", "place", "cts", "route"]);
  assert.deepEqual([t.st.place, t.st.cts, t.st.route, t.st.sta, t.st.signoff], ["passed", "unavailable", "failed", "idle", "idle"]); }
{ const t = mk(false); t.deps.local = () => true; // sta in browser: unavailable (not failed), later stages still run
  t.deps.localStage = async (id) => (id === "sta" ? { ok: true, state: "unavailable", info: "needs OpenSTA" } : { ok: true, files: {} });
  await runStages(["route", "sta", "signoff"], t.deps);
  assert.deepEqual([t.st.route, t.st.sta, t.st.signoff], ["passed", "unavailable", "passed"]); }
{ const t = mk(false); t.deps.local = () => true; // sta in browser runs OpenSTA: passed, and a failed run stops the later stages
  t.deps.localStage = async (id) => ({ ok: id !== "sta", files: {}, staRuns: [{ key: "pre-layout" }] });
  await runStages(["route", "sta", "signoff"], t.deps);
  assert.deepEqual([t.st.route, t.st.sta, t.st.signoff], ["passed", "failed", "idle"]); }
assert.ok(!plan("all").includes("presta"));
console.log("stages local ok");
