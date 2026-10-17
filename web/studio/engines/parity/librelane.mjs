// Real-LibreLane side of the parity check (Docker container "gf180"). ONE job at a time.
//   node web/studio/engines/parity/librelane.mjs <design> <dieW> <dieH> <densityPct> [outdir] [tag]
// Uses the same RTL, PDK (gf180mcuD), clock (24 ns), CTS buffers (clkbuf_8/4/2) as the browser side (browser.mjs).
// Writes <outdir>/<design>.librelane<tag>.json. Jobs live in C:/Users/Asus/eda/designs/nishkam_jobs/parity_*.
import { DESIGNS } from "../pd.flow.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";

const [name, W, H, dens, out = "parity-out", tag = ""] = process.argv.slice(2);
const [top, src] = DESIGNS[name];
const clocked = /posedge|negedge/.test(src);
const jid = `parity_${name}${tag}`, host = `C:/Users/Asus/eda/designs/nishkam_jobs/${jid}`;
if (!process.env.REUSE) rmSync(host, { recursive: true, force: true }); mkdirSync(host, { recursive: true });
writeFileSync(`${host}/${top}.v`, src);
const P = "gf180mcu_fd_sc_mcu7t5v0__";
const cfg = {
  meta: { version: 3, flow: "Classic" }, PDK: "gf180mcuD", FP_SIZING: "absolute", DIE_AREA: [0, 0, +W, +H],
  CLOCK_PERIOD: 24, CTS_CLK_BUFFERS: [P + "clkbuf_8", P + "clkbuf_4", P + "clkbuf_2"], CTS_ROOT_BUFFER: P + "clkbuf_8",
  PL_TARGET_DENSITY_PCT: +dens, DESIGN_NAME: top, CLOCK_PORT: clocked ? "clk" : null, VERILOG_FILES: [`dir::${top}.v`],
};
writeFileSync(`${host}/config.json`, JSON.stringify(cfg, null, 1));
const t0 = Date.now();
const r = process.env.REUSE ? { status: 0 } : spawnSync("docker", ["exec", "-w", `/foss/designs/nishkam_jobs/${jid}`, "gf180", "bash", "-lc",
  "timeout -k 5 1500 librelane config.json --run-tag run > flow.log 2>&1"], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const mf = `${host}/runs/run/final/metrics.json`;
const res = { design: name, cfg, rc: r.status, seconds: (Date.now() - t0) / 1000 };
if (existsSync(mf)) {
  const m = JSON.parse(readFileSync(mf, "utf8").replace(/-?Infinity|NaN/g, "null")), c = "__corner:nom_tt_025C_5v00";
  Object.assign(res, {
    cells: m["design__instance__count__stdcell"], cellArea: m["design__instance__area__stdcell"], dieArea: m["design__die__area"], coreArea: m["design__core__area"],
    util: m["design__instance__utilization"], setupWs: m["timing__setup__ws" + c], setupTns: m["timing__setup__tns" + c], holdWs: m["timing__hold__ws" + c], holdTns: m["timing__hold__tns" + c],
    skew: m["clock__skew__worst_setup" + c], clockBufs: m["design__instance__count__class:clock_buffer"], timingRepairBufs: m["design__instance__count__class:timing_repair_buffer"],
    seqCells: m["design__instance__count__class:sequential_cell"], tapCells: m["design__instance__count__class:tap_cell"], fillCells: m["design__instance__count__class:fill_cell"],
    wirelength: m["route__wirelength"], vias: m["route__vias"], drtDrc: m["route__drc_errors"], magicDrc: m["magic__drc_error__count"],
    lvsErrors: m["design__lvs_error__count"], power_uW: m["power__total"] * 1e6,
  });
} else res.error = readFileSync(`${host}/flow.log`, "utf8").split("\n").filter((l) => /error|Error|ERROR/.test(l)).slice(-5).join("\n");
writeFileSync(`${out}/${name}.librelane${tag}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
