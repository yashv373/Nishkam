#!/bin/bash
# qrouter (non-Tcl main.c), vlog2Cel, addspacers -> WASM. Run in emsdk container.
set -e; O=/work/wasm/qflow; mkdir -p $O; cd $O
LD="-O2 -lm -sMODULARIZE=1 -sEXPORT_ES6=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sINVOKE_RUN=0 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=0 -sENVIRONMENT=web,worker,node"
W="-w -std=gnu89 -fno-common -Wno-implicit-function-declaration -Wno-int-conversion -Wno-incompatible-pointer-types -Wno-implicit-int"
cd /work/qrouter
W="$W -include /work/stubs/compar.h"
D='-DVERSION="1.4" -DREVISION="90" -DLINUX=1 -DSYSV=1 -DHAVE_SETENV=1 -DHAVE_PUTENV=1 -DHAVE_VA_COPY=1 -DX_DISPLAY_MISSING=1 -DSTDC_HEADERS=1'
emcc $W -O2 -I/work/stubs $D qrouter.c point.c maze.c mask.c node.c output.c qconfig.c lef.c def.c main.c $LD -sEXPORT_NAME=create_qrouter -o $O/qrouter.js
cd /work/qflow/src
emcc $W -I. vlog2Cel.c hash.c readlef.c readverilog.c readdef.c $LD -sEXPORT_NAME=create_vlog2Cel -o $O/vlog2Cel.js
emcc $W -I. addspacers.c hash.c readlef.c readdef.c $LD -sEXPORT_NAME=create_addspacers -o $O/addspacers.js
ls -la $O/*.wasm
