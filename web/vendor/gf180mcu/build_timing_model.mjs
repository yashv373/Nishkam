// Usage: node build_timing_model.mjs full.lib out.json.gz
// Builds the compact timing+power model used by web/studio/engines/sta.worker.js (see liberty.js toModel).
import fs from "node:fs"; import zlib from "node:zlib";
import { parse, toModel } from "../../studio/engines/liberty.js";
const [, , src, dst] = process.argv;
const m = toModel(parse(fs.readFileSync(src, "utf8")));
fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(m), { level: 9 }));
console.log(Object.keys(m.cells).length, "cells ->", fs.statSync(dst).size, "bytes");
