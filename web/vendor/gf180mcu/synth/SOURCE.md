# Synthesis helpers for the in-browser Yosys step

- `latch_map.v`: Yosys techmap from `$_DLATCH_*_` to gf180mcu_fd_sc_mcu7t5v0 `latq_1` / `latrnq_1` / `latsnq_1`.
  Written for Nishkam (Apache-2.0, same as the PDK) because the gf180mcuD PDK in iic-osic-tools sets no
  `SYNTH_LATCH_MAP`; the pattern is the one LibreLane's sky130 platforms use. Pins checked against the liberty.
- The synthesis script itself (`web/studio/engines/yosys-flow.js`) is a port of LibreLane's
  `scripts/pyosys/synthesize.py` and `construct_abc_script.py` (Apache-2.0, Efabless Corporation;
  parts adapted from Yosys synth.cc/opt.cc, ISC). Flow variables are LibreLane's gf180mcuD defaults.
