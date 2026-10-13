# qrouter, vlog2Cel, addspacers as WebAssembly

- qrouter: https://github.com/RTimothyEdwards/qrouter commit c8f1111 (GPL-2.0, see LICENSE). Non-Tcl `main.c` entry. `stubs/tk.h` + `stubs/compar.h` stand in
  for headers the router does not really need without Tk. Source is unmodified.
- vlog2Cel and addspacers: https://github.com/RTimothyEdwards/qflow commit 52ecda1 (`src/`, GPL-2.0), unmodified.
- Built by `build.sh` (here) with emscripten/emsdk:3.1.74. Sizes: qrouter 188 KB, vlog2Cel 89 KB, addspacers 102 KB.
- Output check: routed DEF of the 8-flop shift register matches the native build apart from trailing spaces.
