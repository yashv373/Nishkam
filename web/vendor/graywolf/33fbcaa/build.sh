#!/bin/bash
# Build graywolf programs (syntax, Mincut, TimberWolfMC, TimberWolfSC) to WASM. Run in emscripten/emsdk container, /work mounted.
set -e
S=/work/graywolf; O=/work/wasm/graywolf; mkdir -p $O/obj/ylib; cd $O
mkdir -p inc; echo '#define TWFLOWDIR "/"' > inc/config-build.h
CF="-std=gnu89 -fno-common -w -O2 -Dcfree=free -DNOGRAPHICS -fno-strict-return -Dlinux=1 -include fcntl.h -Wno-return-mismatch -Wno-implicit-function-declaration -Wno-int-conversion -Wno-incompatible-pointer-types -Wno-implicit-int -Wno-deprecated-non-prototype -I$S/include -I$O/inc"
YSRC=$(sed -n '/add_library/p' $S/src/Ylib/CMakeLists.txt | sed 's/.*SHARED//; s/)//')
for f in $YSRC; do emcc $CF -c $S/src/Ylib/$f -o obj/ylib/${f%.c}.o; done
emar rcs libylib.a obj/ylib/*.o
for t in syntax:syntax mincut:Mincut genrows:genrows twmc:TimberWolfMC twsc:TimberWolfSC; do
  d=${t%%:*}; n=${t##*:}
  SRC=$(sed -n '/add_executable/p' $S/src/$d/CMakeLists.txt | sed 's/add_executable([A-Za-z]*//; s/)//; s#\${CMAKE_SOURCE_DIR}/src/date/date.c#../date/date.c#')
  mkdir -p obj/$d; OBJS=""
  for f in $SRC; do b=$(basename ${f%.c}); emcc $CF -I$S/src/$d -c $S/src/$d/$f -o obj/$d/$b.o; OBJS="$OBJS obj/$d/$b.o"; done
  EXTRA=""; [ $d = twmc ] && { emcc $CF -DNISHKAM_ASYNC -c $S/src/Ylib/system.c -o obj/$d/asys.o; OBJS="$OBJS obj/$d/asys.o"; EXTRA="-sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536"; }
  EXTRA=""; [ $d = twmc ] && { emcc $CF -DNISHKAM_ASYNC -c $S/src/Ylib/system.c -o obj/$d/asys.o; OBJS="$OBJS obj/$d/asys.o"; EXTRA="-sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536"; }
  [ $d = twsc ] && { emcc $CF -c /work/wasm/graywolf_stub.c -o obj/$d/stub.o; OBJS="$OBJS obj/$d/stub.o"; }
  emcc -O1 $EXTRA -sEMULATE_FUNCTION_POINTER_CASTS=1 -Wl,--allow-multiple-definition $OBJS libylib.a -lm -o $n.js -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=create_$n -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sINVOKE_RUN=0 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=0 -sENVIRONMENT=web,worker,node
done
ls -la $O/*.wasm
