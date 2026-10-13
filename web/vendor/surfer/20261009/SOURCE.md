# Surfer waveform viewer (prebuilt WASM web build)

- Upstream: https://gitlab.com/surfer-project/surfer (EUPL-1.2, see LICENSE). main HEAD at fetch time: 1cdbaa9514ea15b06a186d23979dbb38ab774ad1
- Artifact: https://gitlab.com/surfer-project/surfer/-/jobs/artifacts/main/download?job=pages_build (pipeline of 2026-10-09; folder name = that date).
- Files kept: index.html, integration.js, surfer.js, surfer_bg.wasm (14.9 MB, ~4.9 MB gzipped), manifest.json.
  Dropped: sample .vcd files, favicon, sw.js. index.html edited by one sed: service-worker registration disabled
  (`if (false)`) so a stale cached copy can never survive an update.
- Loaded in an iframe only (see web/studio/engines/surfer.js). New builds go in a new dated folder.
