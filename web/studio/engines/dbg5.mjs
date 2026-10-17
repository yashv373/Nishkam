import fs from "node:fs";
import zlib from "node:zlib";
import { addRows } from "./cts.worker.js";
const S = process.env.S, V = new URL("../../vendor/", import.meta.url);
const mod = await (await import(new URL("openroad-cts/61932e8/openroad.js", V).href)).default({ print: (s) => console.log(s), printErr: (s) => console.log(s), locateFile: (f) => new URL("openroad-cts/61932e8/" + f, V).href });
mod.FS.mkdirTree("/w");
const W = (f, d) => mod.FS.writeFile("/w/" + f, d);
const pd = (f) => fs.readFileSync(new URL("gf180mcu/pd-7b70722/" + f, V));
W("tech.lef", pd("gf180mcu_fd_sc_mcu7t5v0__nom.tlef")); W("cells.lef", pd("gf180mcu_fd_sc_mcu7t5v0.lef"));
W("lib.lib", zlib.gunzipSync(fs.readFileSync(new URL("gf180mcu/lib-tt5v0-full/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.lib.gz", V))));
W("placed.def", addRows(fs.readFileSync(S + "/pin.def", "utf8")));
W("constraints.sdc", "create_clock -name clk -period 40 [get_ports clk]\n");
W("run.tcl", fs.readFileSync(process.env.T, "utf8"));
try { mod.callMain(["/w/run.tcl"]); } catch (e) { console.log("EXC", e?.status); }
