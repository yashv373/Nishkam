# Tiny Tapeout Explorer (one label edit)

- Author: Alexander Mordvintsev. Source: https://github.com/znah/tiny_explorer, commit 59a43fb08067d5a36ef1653fff42ad74359b83b4. Licence: Apache-2.0 (see LICENSE).
- Copied as-is: `viewer.html`, `web/*.js`, `web/style.css`, `web/explorer.wasm` (prebuilt, committed upstream), `vendor/brotli_dec_wasm*`, `vendor/browser_wasi_shim.js`.
- Left out: `index.html`, `web/app.js`, `web/monitor.html`, `web/preview.jpg`, C++ sources.
- To rebuild the wasm: `git submodule update --init --recursive && ./build_wasm.sh` (needs zig). We use the upstream binary.
- Used via `web/studio/viewers/ttexplorer.js`: an iframe opened at `viewer.html?file=<blob: url>&pdk=gf180mcuD`. The file stays in the browser. Upstream's gf180mcuD layer map is built into the wasm; the 3D heights are its own generic display values (not from the PDK).
- Edit: `web/circuit_viewer.js` LAYER_CONFIG names only (slots 7-16 renamed CONTACT, METAL1..METAL5, VIA1..VIA4). The wasm's gf180 map is one slot lower than the sky130 names (checked by rect counts, see THIRD_PARTY.md).
