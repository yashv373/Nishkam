# Magic VLSI, headless WebAssembly build

- Upstream: https://github.com/RTimothyEdwards/magic commit bed8d4f, `npm/build.sh --variant=notcl --release` (emscripten/emsdk:3.1.74), source unmodified.
- Relinked with `TOP_EXTRA_LIBS_WASM="-sEMULATE_FUNCTION_POINTER_CASTS=1 -sSTACK_SIZE=10485760"` (`emmake make mains` in the build dir):
  without the first, `def read` traps with a call_indirect signature mismatch (dbwBBoxFunc); without the second, DRC overflows the 64 KB default stack.
- Size: magic.wasm 2.36 MB, magic.js 87 KB. Uses the gf180mcuD.tech file from web/vendor/gf180mcu/pd-7b70722/ (loaded at run time).
- Check: sr8 routed DEF -> GDS (61 KB) and 35 DRC error tiles, the same count as native Magic 8.3 in the iic-osic-tools container.
