# Icarus Verilog as WebAssembly
- From https://github.com/senolgulgonul/verisim commit a275a9ac28c59db1130505973644c9a3754ec1d7 (files ivlpp/ivl/vvp .js + .wasm, copied unchanged into a275a9a/).
- Licence: GPL-2.0 (a275a9a/LICENSE). Icarus Verilog itself: https://github.com/steveicarus/iverilog
- Chain used: ivlpp (preprocess) -> ivl (compile to .vvp) -> vvp (run). See web/studio/engines/icarus.worker.js.
