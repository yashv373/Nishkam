// node web/studio/engines/cts.selftest.mjs: CTS on the LibreLane tiny8 placed DEF must give the golden numbers of native OpenROAD (9 clkbuf_8).
import fs from "node:fs";
import { handle } from "./cts.worker.js";
const def = fs.readFileSync(new URL("../demo/34-openroad-detailedplacement/tiny8.def", import.meta.url));
const sdc = fs.readFileSync(new URL("./cts.tiny8.sdc", import.meta.url), "utf8"); // the SDC LibreLane wrote for the golden run
const r = await handle({ files: { "tiny8.def": def, "constraints.sdc": sdc }, options: { top: "tiny8" } }, { log: (s) => console.log(s.trim()), progress() {} });
const s = r.summary; console.log(s);
let bad = 0; const chk = (ok, m) => { if (!ok) { bad++; console.log("FAIL", m); } };
chk(s.clkbufs === 9, "9 clock buffers"); chk(s.sinks === 48, "48 sinks");
chk(s.latency_ns === 0.67, "latency 0.67 ns"); chk(s.skew_ns === 0, "skew 0.00 ns");
chk(/clkbuf_8/.test(r.files["tiny8_cts.v"]), "netlist has clock buffers");
chk(/COMPONENTS/.test(Buffer.from(r.files["tiny8.def"]).toString()), "DEF written");
console.log(bad ? "cts selftest FAILED" : "cts selftest ok"); process.exit(bad ? 1 : 0);
