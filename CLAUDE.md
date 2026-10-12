# Notes for Claude: read this first

This is **Nishkam** (निष्काम): free digital IC design practice in the browser, from RTL to layout.
Live: https://yashv373.github.io/Nishkam/ · Repo: https://github.com/yashv373/Nishkam
README.md covers what it does, how to run it, tests and adding problems. This file covers everything else
you need to continue without asking the owner to explain again.

## Who you're working with

- Yashvardhan Singh (yashv373, yvs.373@gmail.com) is a digital IC designer, not a software developer.
  He owns the vision and the problem content; you own the software. Explain software choices in plain words.
  Assume deep RTL / STA / physical design knowledge.
- Docs and copy must be plain and simple: no buzzwords, no jargon. He asked for this explicitly.
- Commit as him, with you as co-author:
  `git -c user.name="Yashvardhan Singh" -c user.email="yvs.373@gmail.com" commit ...`
- Pushing to `main` publishes the live site within about a minute. Show him changes locally first
  (`cd web && python -m http.server 8000`), and push when he says so.

## How it works

- **RTL problems** are graded in the browser. `web/worker.js` loads YoWASP Yosys (`@yowasp/yosys@0.68.1207`,
  ~70 MB WebAssembly from jsdelivr). `web/grader.js` builds a miter of the user's design against the reference
  and runs `sat -seq 20` with undefined initial state and the reset asserted on cycle 1. A failure returns a
  counterexample VCD, which the page shows as a cycle table. There is no testbench and no in-browser simulator:
  no usable iverilog/Verilator WebAssembly build exists.
- **Physical design problems** run on the user's machine, like Colab's "connect to a local runtime".
  `runner/nishkam_runner.py` (Python standard library only) listens on 127.0.0.1:7381 and needs a token passed in
  the page URL fragment (`app.html#runner=...&token=...`). It only accepts the origins in `--origin`. It writes
  the files into a job folder and runs `docker exec <iic-osic-tools container> librelane config.json`. The config
  is built from `BASE_CONFIG` plus an allowlist of knobs; anything else is refused. Jobs live in
  `~/eda/designs/nishkam_jobs` (= `/foss/designs/nishkam_jobs` in the container). One job at a time.
- The PDK is gf180mcuD. CTS is limited to clkbuf_8/4/2 because clkbuf_16 hits DRT-1231 pin-access failures.
- **Site:** `web/index.html` is the landing page and `web/app.html` + `web/app.js` is the practice page.
  There is no build step and no framework; all libraries come from CDNs.
- **Deploy:** `.github/workflows/pages.yml` publishes `web/` on every push to `main`.

## Owner's machine

- Windows 11. The iic-osic-tools container is named `gf180` (image `hpretl/iic-osic-tools:chipathon26`), with
  `C:\Users\Asus\eda\designs` mounted at `/foss/designs`. It has 4 CPUs and ~3.9 GB RAM, so run one LibreLane job
  at a time. A tiny8 run takes about 2.5 minutes.
- In Git Bash, set `MSYS_NO_PATHCONV=1` before any `docker exec ... /foss/...` command, or the paths get mangled.
- Related research project: OmniLane (MTJ non-volatile flip-flops in LibreLane) at
  `C:\Users\Asus\eda\designs\omnilane`. The `squeeze-tiny8` problem uses its `tiny8.v`.
- Local working copy: `C:\Users\Asus\Desktop\Keller` (an old folder name; the project is Nishkam).

## Brand

- Blue `#1430ff` (glow `#4a63ff`) on black. Helvetica Neue for text (Inter as fallback on Windows),
  Bodoni Moda only for the blue "Invincible is just a word." band, Tiro Devanagari Hindi for निष्काम.
  The style is Apple-like liquid glass with Palantir/Framer-style black pages and large type.
- `web/brand/mark.svg`: the N + न monogram. It has mirrored hairline circuit traces with vias on both ends
  of the bar; the traces were added by hand as SVG at the end of the file. viewBox `-20 0 2262 1686`.
- `web/brand/wordmark.svg` (NISHKAM + निष्काम) and `wordmark-latin.svg` (NISHKAM only) are the calligraphic
  wordmark. The long left wing of the N was removed at the owner's request, and the N's left edge rebuilt
  as a straight line.
- `web/brand/mark-alt.svg` is an unused alternate monogram. `favicon.svg` is the mark on a blue rounded square.
  `og.png` is the 1200×630 sharing image.
- The site uses these files as CSS masks (`.mark`, `.logotype`, `.lockup` classes), so `background` sets their
  colour. If you change a viewBox, update the matching `aspect-ratio` in index.html and app.html.
- **Where they came from:** traced from the owner's screenshots in `C:\Users\Asus\Pictures\Screenshots`
  (`...164513.png` monogram, `...163953.png` alt, `...170118.png` wordmark). Each was cropped, upscaled ×5–6,
  thresholded to a PBM, then traced in the container:
  `potrace X.pbm -s --flat -a 1.2 -O 0.6 -t 12` (the edited PBMs are in `C:\Users\Asus\eda\designs\nishkam_brand`).
  The wordmark image carried a light-blue ✦ AI watermark; thresholding on the red channel (>160) leaves it out.
  If the owner provides original high-resolution logo files, re-trace from those.
- The logo images look AI-generated. Remind him once to have a designer redraw them before treating them as
  the company's trademark.

## State and next steps

Done:
- Five RTL problems and one PD problem (`squeeze-tiny8`, solvable at 170×170 µm).
- Grader tests pass.
- Runner self-test passes.
- Landing page and brand are live.
- The landing and practice pages render correctly at phone width (390px).

Not yet verified:
- The page → runner → LibreLane → page round trip has never been run through the UI. Each half was tested
  separately. Next time: he runs `start-runner.bat` and pastes the printed link; you test both flow buttons on
  the live site.
- Chrome's Local Network Access prompt when the https site calls 127.0.0.1. Safari may block it.

Open items:
- Grading runs in the browser, so reference answers can be read. Move grading server-side before it is
  used for hiring or data licensing.
- Make `squeeze-tiny8` harder: measure the smallest die that passes signoff and set the limit near it.
- Add more problems, especially STA / CDC / physical design ones. Those are the main difference from competitors.
- On the 20-minute timeout, the runner stops waiting but LibreLane keeps running inside the container.
- When a page looks broken in a browser screenshot, check whether it is just mid-animation (reveal on scroll,
  hero fade-in) before changing code.
