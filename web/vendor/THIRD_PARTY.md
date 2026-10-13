# Vendored third-party files

Each folder has its own LICENSE and SOURCE.md. Folder names carry the version so a cached old script is never paired with a new wasm.

| Folder | What | Licence | Upstream | Pinned |
|---|---|---|---|---|
| `icarus/a275a9a/` | Icarus Verilog ivlpp/ivl/vvp compiled to WebAssembly | GPL-2.0 | https://github.com/senolgulgonul/verisim | commit a275a9ac28c59db1130505973644c9a3754ec1d7 |
| `netlistsvg/a275a9a/` | netlistsvg bundle + elkjs bundle (as shipped in VeriSim) | MIT (netlistsvg), EPL-2.0 (elkjs) | https://github.com/nturley/netlistsvg, https://github.com/kieler/elkjs | VeriSim commit a275a9a |
| `surfer/20261009/` | Surfer waveform viewer, prebuilt WASM web build | EUPL-1.2 | https://gitlab.com/surfer-project/surfer | main 1cdbaa9514ea15b06a186d23979dbb38ab774ad1, pages_build of 2026-10-09 |
| `gf180mcu/7b70722/` | gf180mcu_fd_sc_mcu7t5v0 liberty, tt 025C 5v00, timing tables removed | Apache-2.0 | https://github.com/google/gf180mcu-pdk | open_pdks 7b70722e33c03fcb5dabcf4d479fb0822d9251c9 |
| `graywolf/33fbcaa/` | graywolf (TimberWolf placer: syntax, Mincut, genrows, TimberWolfMC, TimberWolfSC) as WebAssembly, small source patch (`wasm.patch`) | GPL-2.0-or-later with Yale conditions (see LICENSE) | https://github.com/RTimothyEdwards/graywolf (fork of rubund/graywolf) | commit 33fbcaa |
| `qrouter/c8f1111/` | qrouter (non-Tcl), vlog2Cel and addspacers (from qflow) as WebAssembly | GPL-2.0 | https://github.com/RTimothyEdwards/qrouter, https://github.com/RTimothyEdwards/qflow | qrouter c8f1111, qflow 52ecda1 |
| `magic/bed8d4f/` | Magic VLSI headless WebAssembly build (GDS, DRC, extraction) | GPL-2.0 | https://github.com/RTimothyEdwards/magic | commit bed8d4f |
| `gf180mcu/pd-7b70722/` | gf180mcu_fd_sc_mcu7t5v0 cell LEF, tech LEF, graywolf .par, GDS, SPICE and Magic tech file | Apache-2.0 | https://github.com/google/gf180mcu-pdk | open_pdks 7b70722e |
| `netgen/3cb047b/` | Netgen LVS (v1.5.324) + Tcl 8.6.14 as one WebAssembly module, gf180mcuD LVS setup file | GPL (Netgen), Tcl license (BSD-style), Apache-2.0 (setup file) | https://github.com/RTimothyEdwards/netgen | commit 3cb047b |
| `kwasm/0.3.1/` | kwasm: KLayout compiled to WebAssembly, 2D and 3D GDS viewer, one JS file (3.9 MB) + `host.html` (our postMessage glue) + `gf180mcu.lyp` | GPL-3.0 (KLayout; Three.js MIT bundled) | https://pypi.org/project/kwasm/ (doplaydo/kwasm) | wheel kwasm-0.3.1 sha256 4cbd66d7...db13a |

Not vendored, loaded from jsdelivr at pinned versions: `@yowasp/yosys@0.68.1207` (ISC / Apache-2.0), `verilator-wasm@1.0.0` (MIT; Verilator itself LGPL-3.0 or Artistic-2.0).

## How the copyleft pieces are used

- **Icarus (GPL-2.0):** mere aggregation. It runs in its own Web Worker (`web/studio/engines/icarus.worker.js`) and exchanges only text and files through messages. No Nishkam code is linked into it. The licence text and source link ship beside it, and the full source is at the VeriSim repo above.
- **Surfer (EUPL-1.2):** loaded in its own iframe and driven only through `postMessage`. Unmodified apart from one line in `index.html` that turns the service-worker registration off.
- **elkjs (EPL-2.0), Verilator (LGPL-3.0):** unmodified, used as separate scripts or wasm modules.
- **kwasm (GPL-3.0):** unmodified, runs in a same-origin iframe (`host.html`) driven only by `postMessage`; the GDS never leaves the browser. Layer colours from the PDK `gf180mcu.lyp` (Apache-2.0). 3D metal thickness comes from the PDK tech LEF; gaps are display-only (labelled in the view).
