// LibreLane's Yosys synthesis flow (scripts/pyosys/synthesize.py + construct_abc_script.py, Apache-2.0, Efabless)
// written out as a plain Yosys script for YoWASP. Same passes, same order, gf180mcuD defaults.
// ponytail: LibreLane loops `opt` until nothing changes; a .ys script has no loops, so each loop body is repeated
// OPT_REPS times (extra repeats do nothing once converged). Raise it if a big design stops short of the fixpoint.
const OPT_REPS = 3;
const LIB = "gf180mcu_fd_sc_mcu7t5v0";
export const DEFAULTS = { // gf180mcuD PDK config + LibreLane step defaults (resolved.json of a real run)
  strategy: "AREA 0", periodNs: 10, maxFanout: 10, maxTransitionNs: 3, outputCapLoad: "72.91",
  drivingCell: `${LIB}__inv_1/ZN`, tieHi: `${LIB}__tieh/Z`, tieLo: `${LIB}__tiel/ZN`, buffer: `${LIB}__buf_1/I/Z`,
};
export const DEFINES = ["PDK_gf180mcuD", `SCL_${LIB}`, "__librelane__", "__pnr__"];

export function abcScript(strategy, { maxFanout, maxTransitionNs }) {
  const rf = "drf -l", rfz = "drf -l -z", rw = "drw -l", rwz = "drw -l -z", b = "balance";
  const resyn2 = `${b}; ${rw}; ${rf}; ${b}; ${rw}; ${rwz}; ${b}; ${rfz}; ${rwz}; ${b}`;
  const choice = `fraig_store; ${resyn2}; fraig_store; ${resyn2}; fraig_store; fraig_restore`;
  const choice2 = `fraig_store; ${b}; fraig_store; ${resyn2}; fraig_store; ${resyn2}; fraig_store; ${resyn2}; fraig_store; fraig_restore`;
  const mapNewArea = "amap -m -Q 0.1 -F 20 -A 20 -C 5000", mapOldDly = "map -p -B 0.2 -A 0.9 -M 0";
  const L = [];
  // ponytail: the vendored liberty has no timing tables, so ABC stime/upsize/dnsize crash; these two strategies need them
  if (strategy === "AREA 3" || strategy === "DELAY 4") throw new Error(`Strategy "${strategy}" needs the full timing liberty; use AREA 0-2, AREA 4 or DELAY 0-3.`);
  if (strategy === "AREA 3") L.push("strash", "dch", "map -B 0.9", "topo", "stime -c", `buffer -c -N ${maxFanout}`, "upsize -c", "dnsize -c");
  else if (strategy === "DELAY 4") {
    L.push("&get -n", "&st", "&dch", "&nf");
    for (let i = 0; i < 5; i++) L.push("&st", "&syn2", "&if -g -K 6", "&synch2", "&nf");
    L.push("&put", `buffer -c -N ${maxFanout}`, "topo", "stime -c", "upsize -c", "dnsize -c");
  } else {
    const area = strategy.startsWith("AREA ") || strategy === "DELAY 3";
    L.push("fx", "mfs", "strash", rf, strategy === "AREA 2" ? choice2 : resyn2, area ? "retime -M 5" : "retime -M 6", "scleanup");
    if (["AREA 4", "DELAY 2"].includes(strategy)) L.push(choice);
    else if (strategy !== "DELAY 0") L.push(choice2);
    L.push(area ? mapNewArea : mapOldDly);
    if (["AREA 1", "AREA 2"].includes(strategy)) L.push(choice2, mapNewArea);
    else if (strategy === "DELAY 1") L.push(choice2, "map");
    else if (strategy === "DELAY 2") L.push(choice, "map");
    else if (strategy === "DELAY 3") L.push(choice2, mapOldDly);
    L.push("", "retime", "&get -n", "&st", "&dch", "&nf", "&put", "");
  }
  // LibreLane ends with "stime -p; print_stats -m": report only, and both crash ABC without timing tables
  return L.join("\n") + "\n";
}

// one librelane_opt() call as script lines
function opt({ fast, muxUndef, muxBool, undriven, fine, nodffe, nosdff, optShare } = {}) {
  const ex = [muxUndef && "-mux_undef", muxBool && "-mux_bool", undriven && "-undriven", fine && "-fine"].filter(Boolean).join(" ");
  const dff = [nodffe && "-nodffe", nosdff && "-nosdff"].filter(Boolean).join(" ");
  const L = [];
  if (fast) for (let i = 0; i < OPT_REPS; i++) L.push(`opt_expr ${ex}`, "opt_merge", `opt_dff ${dff}`, "opt_clean");
  else {
    L.push(`opt_expr ${ex}`, "opt_merge -nomux");
    for (let i = 0; i < OPT_REPS; i++)
      L.push("opt_muxtree", `opt_reduce ${fine ? "-fine" : ""}`, "opt_merge", optShare ? "opt_share" : "", `opt_dff ${dff}`, "opt_clean", `opt_expr ${ex}`);
  }
  return L.filter((l) => l.trim());
}

// files: .v/.sv names; returns the script text. liberty is cells.lib, SDC synthesis.abc.sdc, ABC script abc.script in the fs.
export function synthScript({ srcs, top, noattr = true, flatten = true, dontUse = "", opts = {}, rtlJson = true }) {
  const o = { ...DEFAULTS, ...opts }, D = DEFINES.map((d) => `-D${d}`).join(" ");
  const lib = "-liberty cells.lib";
  const aggressive = { muxUndef: true, muxBool: true, undriven: true, fine: true, optShare: true };
  const tail = ["abc", "opt -fast", `hierarchy -check -top ${top} -nokeep_prints -nokeep_asserts`, "check"]; // librelane_synth tail (stat is below)
  const S = [
    "read_liberty -lib -ignore_miss_dir -setattr blackbox -setattr keep_hierarchy cells.lib", // add_blackbox_models
    ...srcs.map((f) => `read_verilog -defer -noautowire -sv ${D} ${f}`),
    `hierarchy -check -top ${top} -nokeep_prints -nokeep_asserts`, `rename -top ${top}`,
    `select -module ${top}`, "attrmap -remove single_bit_vector", "select -clear",
    // synthesize.py -> librelane_synth()
    `hierarchy -check -top ${top} -nokeep_prints -nokeep_asserts`,
    // librelane_proc
    "proc_clean", "proc_rmdead", "proc_prune", "proc_init", "proc_arst", "proc_rom", "proc_mux",
    "tee -o latch.rpt proc_dlatch", "proc_dff", "proc_memwr", "proc_clean", "tee -o pre_synth_chk.rpt check", "opt_expr",
    ...(rtlJson ? ["write_json rtl.json"] : []),
    ...(flatten ? ["flatten"] : []), "opt_expr", "opt_clean",
    ...opt({ nodffe: true, nosdff: true }), "fsm", ...opt(), "wreduce", "peepopt", "opt_clean", "alumacc", "share", ...opt(),
    "memory -nomap", "opt_clean",
    ...opt({ fast: true, ...aggressive }), "memory_map", ...opt(aggressive), "techmap",
    ...opt({ fast: true }), ...opt({ fast: true }),
    ...tail,
    "delete t:$print", "delete t:$assert", "opt", "opt_clean -purge",
    `tee -o pre_techmap.rpt stat ${lib}`,
    "techmap -map latch_map.v", "simplemap", // SYNTH_LATCH_MAP (ours: the PDK has none)
    `dfflibmap ${lib} ${dontUse}`,
    `abc -script abc.script -D ${Math.round(o.periodNs * 1000)} -constr synthesis.abc.sdc -showtmp ${lib} ${dontUse}`,
    "setundef -zero", // SYNTH_TIE_UNDEFINED = low
    `hilomap -hicell ${o.tieHi.split("/").join(" ")} -locell ${o.tieLo.split("/").join(" ")}`,
    "splitnets", "opt_clean -purge", // SYNTH_SPLITNETS
    `insbuf -buf ${o.buffer.split("/").join(" ")}`, // SYNTH_DIRECT_WIRE_BUFFERING
    "tee -o chk.rpt check",
    `tee -o stat.json stat -json ${lib}`, `tee -o stat.txt stat ${lib}`,
    "rename -enumerate",   // same cell/wire names in netlist.v (what OpenSTA reports) and netlist.json (what the schematic uses); the writer would otherwise rename $-names to _N_ in the .v only
    `write_verilog ${noattr ? "-noattr " : ""}-noexpr -nohex -nodec -defparam netlist.v`,
    "write_json netlist.json",
  ];
  return S.join("\n") + "\n";
}

export const sdcText = (o) => `set_driving_cell ${o.drivingCell}\nset_load ${o.outputCapLoad}\n`;
