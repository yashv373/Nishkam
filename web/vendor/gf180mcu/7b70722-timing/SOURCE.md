# gf180mcu 7-track 5V timing + power model (compact)

- Cells: gf180mcu_fd_sc_mcu7t5v0, corner tt 025C 5v00 (GlobalFoundries / Google, Apache-2.0, see LICENSE). Same source as ../7b70722/.
- Built with `node ../build_timing_model.mjs full.lib out.json.gz` (parser: web/studio/engines/liberty.js).
- Kept: cell area, mean leakage, pin direction/capacitance/function, NLDM delay + slew + setup/hold/recovery/removal tables,
  internal-power tables. State-dependent (`when`) variants are merged: worst case (max) for delay and checks, best case (min)
  for early delay, mean for power and leakage. Dropped: pg_pin, pulse-width/period checks, ccsn/waveform data.
- Format: gzipped JSON, ~1.1 MB (full liberty is 20 MB). Not a liberty file: only sta.worker.js reads it.
