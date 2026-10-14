# OpenROAD clock tree synthesis (TritonCTS), WebAssembly build

- Upstream: https://github.com/The-OpenROAD-Project/OpenROAD commit 61932e897ed1171d85734f2a54064965f691d758 (61932e8), BSD-3-Clause (LICENSE.OpenROAD).
  This is the commit the iic-osic-tools `openroad` (26Q2-254-g61932e897) is built from, so CTS output matches LibreLane's.
  Fetched with `git fetch --depth 1 origin <sha>`. Its `src/sta` is the same OpenSTA defec0b as ../../opensta/defec0b (GPL-3.0), linked in statically,
  so this whole binary is distributed under GPL-3.0 terms. Source for it is the commit above plus the patches below.
- Container: emscripten/emsdk 3.1.74 (`pdb`), work dir /work/openroad-cts. Single thread, no pthreads, no LTO.
- Included OpenROAD modules: odb, sta, dbSta, rsz, stt, dpl, cts, est, utl, plus a stub gui. Not included: grt, ifp, gpl, drt, pdn, ord extras.
- Dependencies (built with emcmake, -O2, prefix deps/inst):
  - abseil-cpp 20240722.0 (4447c75), Apache-2.0: `-DCMAKE_CXX_STANDARD=20 -DABSL_PROPAGATE_CXX_STD=ON -DBUILD_TESTING=OFF`
  - spdlog v1.14.1 (27cb4c7, bundled fmt), MIT: `-DSPDLOG_BUILD_EXAMPLE=OFF -DSPDLOG_BUILD_TESTS=OFF`
  - LEMON (The-OpenROAD-Project/lemon-graph 31d79d6, C++20 patched), Boost-1.0: `-DLEMON_ENABLE_{GLPK,COIN,ILOG,SOPLEX}=OFF`
  - Boost 1.83 headers (emscripten port: `embuilder build boost_headers`), BSL-1.0; iostreams `zlib.cpp` + `gzip.cpp` compiled from boostorg/iostreams boost-1.83.0; zlib from `embuilder build zlib`
  - CUDD (The-OpenROAD-Project/cudd d47718f), BSD-style: same recipe as ../../opensta/defec0b/SOURCE.md
  - Tcl 8.6.14 static (from the Netgen build), BSD-style
- Patches to the OpenROAD tree (the full list, in order):
  1. Root `CMakeLists.txt` and `src/CMakeLists.txt` replaced by trimmed versions (modules above only); compile defs `FMT_CONSTEVAL= FMT_DEPRECATED_OSTREAM=1`.
  2. `odb/CMakeLists.txt`: dropped `src/3dblox` (needs yaml-cpp, only used by ord).
  3. `src/OpenRoad.cc`: initialises only utl/odb/sta/dbSta/stt/dpl/rsz/cts/est and a stub gui; `global_router_ = nullptr`; 3dblox methods stubbed.
  4. grt not built (headers only).
  5. `utl/src/prometheus/metrics_server.cpp` replaced with an empty stub (boost asio has no emscripten support).
  6. Build type RelWithDebInfo with explicit `-O2 -DNDEBUG`.
  7. `odb/src/db/{dbITerm,dbModITerm,dbBTerm}.h`: `class alignas(8)` (pointer-tagging static_assert fails on wasm32).
  8. `-DTcl_Size=int`, and `typedef int Tcl_Size;` in the dpl/cts/stt/rsz `.i` files (SWIG 4.0.2 vs the 4.3 typemaps OpenROAD expects).
  9. `sta/include/sta/TclTypeHelpers.hh`: guard the `Tcl_Size` typedef with `!defined(Tcl_Size)`.
  10. `odb dbCore.h` `dbObjectPage` and `dbTable.h` `dbTablePage::objects_`: `alignas(8)` (wasm32 page header is 12 bytes, objects were 4-aligned, breaking pointer tagging).
  11. `src/grt_stub.cc` (this folder): minimal `grt::GlobalRouter` stand-in (est dereferences it unconditionally); `OpenRoad.cc` passes it to est and rsz.
  12. `-fexceptions` on all C/C++ flags and at link time.
  13. Link flag `-sBINARYEN_EXTRA_PASSES=--pass-arg=max-func-params@32` (fpcast-emu default of 16 is below the 22 parameters some functions have).
- Entry point `main_wasm.cc` (this folder): runs `argv[1]` as a Tcl script. Compile: `em++ -O2 -std=c++20 -fexceptions @includes_CXX.rsp main_wasm.cc -c -o main_wasm.o`
- Link line (`link_line.sh`, run from the build directory; `$A` = all `.a` under `src` except lodepng, `$ABSL` = all libabsl_*.a):
  `em++ -O2 -fexceptions -sBINARYEN_EXTRA_PASSES=--pass-arg=max-func-params@32 main_wasm.o -Wl,--start-group $A $ABSL libspdlog.a -Wl,--end-group libcudd.a libtcl8.6.a -sUSE_ZLIB=1 -sINITIAL_MEMORY=100mb -sERROR_ON_UNDEFINED_SYMBOLS=0 -Wl,--unresolved-symbols=ignore-all -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createOpenroad -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2gb -sSTACK_SIZE=5242880 -sEMULATE_FUNCTION_POINTER_CASTS=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sENVIRONMENT=node,web,worker --embed-file rt/tcl8.6@/tcl8.6 -o openroad.js`
- Size: openroad.wasm 36.8 MB (8.9 MB gzipped), openroad.js 200 KB. GitHub Pages serves it gzipped.
- Check: `web/studio/engines/cts.selftest.mjs`. The CTS script mirrors LibreLane 3.0.2 `cts.tcl`; on tiny8 the resulting DEF COMPONENTS and NETS are byte-identical to native OpenROAD (9 clkbuf_8).
