# gf180mcu 7-track 5V standard-cell liberty (trimmed)

- Cells: gf180mcu_fd_sc_mcu7t5v0, corner tt 025C 5v00 (GlobalFoundries / Google, Apache-2.0, see LICENSE).
- Upstream: https://github.com/google/gf180mcu-pdk (also shipped in open_pdks 7b70722e33c0).
  The upstream repo ships only per-cell .lib files and raw.githubusercontent / jsdelivr have no merged file, so this
  copy is taken from the merged 20 MB file in the iic-osic-tools container:
  /foss/pdks/gf180mcuD/libs.ref/gf180mcu_fd_sc_mcu7t5v0/lib/gf180mcu_fd_sc_mcu7t5v0__tt_025C_5v00.lib
- Trimmed with `node trim_liberty.mjs full.lib out.lib`: timing, power and leakage groups removed (20 MB -> 327 KB).
  Good for Yosys abc / dfflibmap mapping and area. Not for timing analysis.
