# graywolf (syntax, Mincut, genrows, TimberWolfMC, TimberWolfSC) as WebAssembly

- Upstream: https://github.com/RTimothyEdwards/graywolf commit 33fbcaa (fork of https://github.com/rubund/graywolf, which holds the LICENSE and COPYING copied here: Yale relicensed TimberWolf as GPL-2.0-or-later with conditions, text received 2015-06-03). Shallow clone 2026-10-13.
- Built with Emscripten (emscripten/emsdk:3.1.74) by `build.sh` (here). Source changes are in `wasm.patch`:
  `VOID` forced to `int` (old K&R callers assume int), `Yprint_stats` returns int, prototypes for `HPO`/`calc_*_factor` in savewolf.c,
  and `system()` replaced by an in-process emulation of `mv`/`cp`/`rm`/`awk splt_file.a`. TimberWolfMC calls `genrows`
  through Asyncify + a JS hook (`Module.nishkamSystem`), see `web/studio/engines/place.worker.js`.
- Link notes: `-fno-common` + `--allow-multiple-definition` (old tentative definitions), `-sEMULATE_FUNCTION_POINTER_CASTS=1`, link at `-O1`
  (binaryen `-O2` broke syntax/main).
- Output check: for an 8-flop shift register `.pl1`, `.pl2` and `.pin` are byte-identical to the native build.
- Sizes: Mincut 82 KB, syntax 81 KB, genrows 84 KB, TimberWolfMC 819 KB (Asyncify), TimberWolfSC 366 KB.
- Known: a design with fewer than 5-6 cells makes TimberWolfSC loop forever, natively too.
