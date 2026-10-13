# OpenSTA (timing + power), WebAssembly build

- Upstream: https://github.com/parallaxsw/OpenSTA commit defec0b (3.1.0, 2026-04-09), GPL-3.0 (see LICENSE), source unmodified.
  This is the exact commit the iic-osic-tools `openroad` (26Q2-254-g61932e897) bundles as src/sta, so `report_checks` and
  `report_power` text is byte-identical to its `/foss/tools/openroad/bin/sta`. (Upstream HEAD 574500d gives a slightly different
  power number on an 8-bit counter, 1.69 vs 1.71 mW, timing identical: power activity code changed between commits.)
- Container: emscripten/emsdk:3.1.74 (`pdb`), work dir /work/opensta. Host tools: flex 2.6.4, bison 3.8.2, swig 4.0.2, cmake, tclsh, Eigen (apt libeigen3-dev). Single-threaded: no pthreads.
- Tcl 8.6.14 static, reused from the Netgen build (see ../../netgen/3cb047b/SOURCE.md); its init scripts are embedded at /tcl8.6.
- CUDD (required by OpenSTA Bdd/Power): https://github.com/The-OpenROAD-Project/cudd d47718f:
  `touch aclocal.m4 configure Makefile.in config.h.in` then `emconfigure ../cudd/configure --prefix=/work/cudd-i --disable-shared --disable-dddmp --disable-obj CFLAGS=-O2 && emmake make && emmake make install`
- OpenSTA configure (note: no LTO, thin-LTO objects gave "function signature mismatch" at run time; BUILD_TESTS=OFF because GTest is not available):
  `mkdir /work/flexinc; cp /usr/include/FlexLexer.h /work/flexinc` (do not pass -I/usr/include to emcc)
  `emcmake cmake .. -DBUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_CXX_FLAGS_RELWITHDEBINFO="-O2 -DNDEBUG" -DCMAKE_C_FLAGS_RELWITHDEBINFO="-O2 -DNDEBUG" -DUSE_TCL_READLINE=OFF -DCUDD_DIR=/work/cudd-i -DTCL_LIBRARY=<tcl>/lib/libtcl8.6.a -DTCL_INCLUDE_PATH=<tcl>/include -DTCL_HEADER=<tcl>/include/tcl.h -DFLEX_INCLUDE_DIR=/work/flexinc -DCMAKE_FIND_ROOT_PATH_MODE_{PACKAGE,LIBRARY,INCLUDE}=BOTH`
  `emmake make -j4 OpenSTA sta_swig`
- Own entry point main_wasm.cc (this folder, ~25 lines, replaces app/Main.cc: no readline, no splash, runs `argv[1]` as a Tcl script).
  `em++ -O2 -std=c++20 @CMakeFiles/OpenSTA.dir/includes_CXX.rsp ../main_wasm.cc -c -o main_wasm.o`
  `em++ -O2 main_wasm.o sta_swig.a libOpenSTA.a libtcl8.6.a libcudd.a -sUSE_ZLIB=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createSta -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5242880 -sEMULATE_FUNCTION_POINTER_CASTS=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sENVIRONMENT=node,web,worker --embed-file rt/tcl8.6@/tcl8.6 -o sta.js`
- Size: sta.wasm 5.6 MB, sta.js 120 KB.
- Liberty: ../../gf180mcu/lib-tt5v0-full/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.lib.gz (2.8 MB, 20 MB unpacked) is the unmodified merged file from the
  container `$PDK_ROOT/gf180mcuD/libs.ref/gf180mcu_fd_sc_mcu7t5v0/lib/` (gf180mcu-pdk, Apache-2.0); the worker gunzips it with DecompressionStream.
- Check: web/studio/engines/opensta.selftest.mjs (shreg4 + 8-bit counter vs native `sta` numbers). Full report text was diffed against native: identical.
