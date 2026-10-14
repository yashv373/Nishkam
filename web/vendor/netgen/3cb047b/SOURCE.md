# Netgen (LVS), WebAssembly build

- Upstream: https://github.com/RTimothyEdwards/netgen commit 3cb047b (v1.5.324), GPL (see LICENSE), with one fix in base/netcmp.c PropertyOptimize(): `plink = ptop; FREE(ptop); ptop = plink->next;` read `next` after free. glibc leaves it intact, emscripten's malloc does not, so LVS crashed ("memory access out of bounds") on designs with merged parallel devices, e.g. after CTS. The fix is `plink = ptop->next; FREE(ptop); ptop = plink;`.
- Tcl 8.6.14 (tag core-8-6-14 of tcltk/tcl, BSD-style, see TCL_LICENSE) is linked in statically. Built with Magic's
  `toolchains/emscripten/build-tcl-wasm.sh --src=<tcl clone> --out=<dir>` with `--disable-threads` added to its configure line (the threaded notifier aborts under wasm) inside emscripten/emsdk:3.1.74.
  (Tcl 9 was not tried: netgen is written against the Tcl 8 API.)
- Netgen files compiled with emcc -O2: base/{actel,ccode,greedy,ntk,print,actellib,embed,hash,netfile,objlist,query,anneal,ext,netcmp,netgen,pdutils,random,timing,bottomup,flatten,place,spice,verilog,wombat,xilinx,xillib}.c
  and tcltk/tclnetgen.c, with -DTCL_NETGEN=1 -DDBUG_OFF=1 -DNETGEN_VERSION="1.5" -DNETGEN_REVISION="324" -DCAD_DIR="/" -DTCL_DIR="/" (no stubs).
- Own entry point main.c (about 15 lines): Tcl_CreateInterp, Tcl_Init, Tclnetgen_Init, set `argv`, Tcl_EvalFile("/netgen.tcl").
  /netgen.tcl is tcltk/netgen.tcl.in with the `load` line removed (embedded), so `-batch <command>` works as in the netgen shell script.
  Embedded Tcl scripts: init.tcl auto.tcl package.tcl tm.tcl word.tcl tclIndex (at /tcl8.6).
- Link: `emcc -O2 *.o libtcl8.6.a -sUSE_ZLIB=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createNetgen -sINVOKE_RUN=0 -sEXIT_RUNTIME=1
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5242880 -sEMULATE_FUNCTION_POINTER_CASTS=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain
  -sENVIRONMENT=node,web,worker --embed-file rt/tcl8.6@/tcl8.6 --embed-file rt/netgen.tcl@/netgen.tcl`
- Size: netgen.wasm 1.93 MB, netgen.js 114 KB. Includes gf180mcuD_setup.tcl (from the gf180mcu PDK, Apache-2.0), read at run time.
- Check: web/studio/engines/lvs.selftest.mjs (output compared with native netgen 1.5.324 on the same inputs).
