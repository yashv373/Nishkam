// RTL grading by formal equivalence: the user's design and the reference are joined
// in a miter and Yosys' SAT solver searches every input sequence up to DEPTH cycles
// for one where the outputs differ. No testbench, no missed corner cases within the
// bound, and a failing run hands back the exact counterexample as a VCD.
// Runs anywhere @yowasp/yosys runs (browser worker or Node).

import { gradeCdc } from "./cdc.js";

export const DEPTH = 40; // fallback bounded check, used only when the induction proof is inconclusive

// induct=true: unbounded proof by temporal induction (up to 40 steps). Otherwise a plain DEPTH-cycle search.
export function gradeScript(p, induct = false) {
  const rst = p.reset ? `-set-at 1 in_${p.reset.port} ${p.reset.active}` : "";
  return `
read_verilog -sv ref.v
hierarchy -top ${p.top}
proc; flatten; async2sync
rename ${p.top} gold
design -stash gold
read_verilog -sv user.v
hierarchy -check -top ${p.top}
proc; flatten; async2sync
rename ${p.top} gate
design -stash gate
design -copy-from gold -as gold gold
design -copy-from gate -as gate gate
miter -equiv -flatten -make_outputs -ignore_gold_x gold gate miter
hierarchy -top miter

sat -verify ${induct ? "-tempinduct -maxsteps 40" : ""} -seq ${DEPTH} ${rst} -set-init-undef -enable_undef -set-def-inputs -prove trigger 0 -show-ports -dump_vcd cex.vcd miter
`;
}

export const SYNTH_SCRIPT = (top) => `
read_verilog -sv user.v
synth -top ${top} -flatten
tee -o stat.txt stat
`;

// Minimal VCD reader for Yosys' sat dumps: one timestep per cycle.
export function parseVcd(text) {
  const ids = {}, sigs = [];
  let t = -1;
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    let m;
    if ((m = s.match(/^\$var \S+ (\d+) (\S+) \\?(\S+) \$end/))) {
      const sig = { name: m[3], width: +m[1], values: [] };
      ids[m[2]] = sig; sigs.push(sig);
    } else if ((m = s.match(/^#(\d+)/))) {
      t = +m[1]; rows.push(t);
    } else if ((m = s.match(/^b([01xz]+) (\S+)/)) && ids[m[2]] && t >= 0) {
      ids[m[2]].values[rows.length - 1] = m[1];
    } else if ((m = s.match(/^([01xz])(\S+)$/)) && ids[m[2]] && t >= 0) {
      ids[m[2]].values[rows.length - 1] = m[1];
    }
  }
  return { cycles: rows.length, sigs };
}

// Turn a counterexample into: inputs per cycle, and expected vs actual per output.
export function counterexample(vcdText) {
  const { cycles, sigs } = parseVcd(vcdText);
  const by = Object.fromEntries(sigs.map((s) => [s.name, s]));
  const fmt = (v, w) => (v === undefined ? "" : /[xz]/.test(v) ? "x" : w === 1 ? v : String(parseInt(v, 2)));
  const inputs = sigs.filter((s) => s.name.startsWith("in_") && s.name !== "in_clk")
    .map((s) => ({ name: s.name.slice(3), values: s.values.map((v) => fmt(v, s.width)) }));
  const outputs = sigs.filter((s) => s.name.startsWith("gold_")).map((g) => {
    const name = g.name.slice(5), u = by["gate_" + name];
    return { name, expected: g.values.map((v) => fmt(v, g.width)), got: (u ? u.values : []).map((v) => fmt(v, g.width)) };
  });
  // first cycle where any output differs (gold x = don't care)
  let first = -1;
  for (let c = 0; c < cycles && first < 0; c++)
    if (outputs.some((o) => o.expected[c] !== "x" && o.expected[c] !== "" && o.expected[c] !== o.got[c])) first = c;
  return { cycles, inputs, outputs, first };
}

// Yosys 0.5x prints "Number of cells: N", newer versions print "N cells".
export function parseStat(text) {
  const m = text.match(/^\s*(\d+) cells$/m) || text.match(/Number of cells:\s+(\d+)/);
  const kinds = [...text.matchAll(/^\s+(\d+)\s+\$_(\w+?)_?\s*$/gm)].map((k) => [k[2], +k[1]]);
  return { cells: m ? +m[1] : null, kinds };
}

// Run one grade. runYosys/Exit come from @yowasp/yosys.
export async function grade(runYosys, Exit, problem, userCode, log = () => {}) {
  if (problem.cdc) return gradeCdc(runYosys, Exit, problem, userCode, log);
  const out = [];
  const sink = (b) => { if (b) { const s = new TextDecoder().decode(b); out.push(s); log(s); } };
  const run = async (induct) => {
    try {
      await runYosys(["-q", "-s", "grade.ys"], { "ref.v": problem.reference, "user.v": userCode, "grade.ys": gradeScript(problem, induct) }, { stdout: sink, stderr: sink });
      return { passed: true };
    } catch (e) {
      if (!(e instanceof Exit)) throw e;
      return { passed: false, fsOut: e.files };
    }
  };
  // Try the unbounded proof first. If it fails it may only be an unreachable-state difference,
  // so the bounded search decides: a counterexample there is real, a pass is only "first DEPTH cycles".
  let r = await run(true), proved = r.passed;
  if (!proved) { out.length = 0; r = await run(false); }
  const { passed, fsOut } = r;
  const logText = out.join("");
  const res = { passed, proved, log: logText };
  if (!passed) {
    if (fsOut && fsOut["cex.vcd"]) res.cex = counterexample(fsOut["cex.vcd"]);
    else if (/Can't find gate module/.test(logText))
      // Yosys skips a module with no logic at all (the untouched starter), so the miter finds nothing to compare.
      res.error = `Your module "${problem.top}" has no logic yet. Drive every output (assign or always block), keep the module name and the port names from the starter, then submit again.`;
    else res.error = (logText.match(/ERROR:.*$/m) || ["Yosys failed: check your code compiles"])[0];
  }
  if (passed) {
    try {
      const s = await runYosys(["-q", "-s", "synth.ys"], { "user.v": userCode, "synth.ys": SYNTH_SCRIPT(problem.top) },
        { stdout: null, stderr: null });
      res.stat = parseStat(s["stat.txt"] || "");
    } catch { /* stats are a bonus */ }
  }
  return res;
}
