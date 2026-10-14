# Nishkam
निष्काम

Practice digital chip design in the browser, from RTL to layout.

*Invincible is just a word.*

## What it does

- **RTL problems** run entirely in your browser. You write Verilog and press Submit. Yosys, compiled to WebAssembly, proves your design equal to a reference for every input sequence and every cycle after reset (if a full proof cannot be completed, it checks the first 40 cycles and says so). If they differ, you see the exact cycle and inputs where your output is wrong. No install, no account.
- **Physical design problems** run on your own computer. A small helper program takes your design from the page and runs LibreLane (gf180mcuD) in the [iic-osic-tools](https://github.com/iic-jku/iic-osic-tools) Docker container. You get signoff numbers and a picture of the layout back in the page.
- Any RTL problem you solve can be sent through the full flow to see it as a chip.
- **Nishkam Studio** (`studio.html`) is a browser IDE for the whole flow, from RTL to GDS, on gf180mcuD. It lints, simulates, synthesizes, times, places, routes, draws the layout, checks it (DRC) and compares it with the netlist (LVS). It runs in your browser with no install. With the local helper connected, the physical stages can run the real LibreLane flow instead.

Live at **https://nishkam.world** (the old https://yashv373.github.io/Nishkam/ address redirects there)

## Run it locally

You need Python 3.

```
cd web
python -m http.server 8000
```

Open http://localhost:8000/app.html. RTL problems work right away. The first Submit downloads Yosys (about 70 MB), and the browser caches it after that.

Studio is at http://localhost:8000/studio.html. Its tools download on first use and the browser caches them.

### Physical design (optional)

1. Start the iic-osic-tools container, with `~/eda/designs` mounted at `/foss/designs` (its default).
2. Run `start-runner.bat` (Windows) or `python runner/nishkam_runner.py`.
3. Open the Studio or Practice link it prints.

The links point at the live site. If you are working on the pages locally, use
`python runner/nishkam_runner.py --site http://localhost:8000` instead.

In Studio, Properties → Physical engine lets you pick Automatic, Runner, or In browser. With the helper connected you can run one stage or a range of stages, watch the live log, and download metrics and files.

The helper only listens on your own machine (127.0.0.1). It only answers these pages, and only with the secret token in the link. It writes your Verilog files into a new job folder and runs LibreLane with a config it builds itself. Settings outside a short allowlist are refused. The helper runs no commands sent by the page, except that an optional shell is available if you start it with `--allow-shell` (off by default).

Jobs go to `~/eda/designs/nishkam_jobs/`. Delete old ones whenever you like.

## Deploying

Every push to `main` publishes the `web/` folder to GitHub Pages (`.github/workflows/pages.yml`).
One-time setup: in the repo, Settings → Pages → Source: **GitHub Actions**.

## Files

```
web/index.html         landing page
web/app.html           practice page layout and styles
web/app.js             practice page logic
web/problems.js        the problems and their reference answers
web/grader.js          how RTL answers are checked (shared with the test)
web/worker.js          runs Yosys without freezing the page
web/studio.html        Nishkam Studio page
web/studio/            Studio code: app.js (page logic), stages.js (flow order),
                       engines/ (one file per tool, each with a *.worker.js),
                       viewers/ (layout DEF, GDS, timing, reports)
web/vendor/            third-party tools built to WebAssembly; licences in web/vendor/THIRD_PARTY.md
web/brand/             monogram, calligraphic wordmark, favicon, sharing image
web/grader.test.mjs    checks every problem: right answers pass, wrong ones fail
runner/nishkam_runner.py   the local helper
```

## Tests

```
npm i @yowasp/yosys@0.68.1207
node web/grader.test.mjs
python runner/nishkam_runner.py --selftest
node web/studio/stages.test.mjs
node web/studio/engines/selftest.node.mjs
node web/studio/engines/pd.selftest.mjs 8
node web/studio/engines/lvs.selftest.mjs
node web/studio/viewers/parse.test.mjs
node web/studio/viewers/gds.test.mjs
node web/landing.check.mjs
node web/brand/make-hero-routes.mjs   # not a test: rebuilds the landing hero's chip data (brand/media/tiny8-routes.*)
```

Browser self-tests, open in a browser served from `web/`:
`web/studio/engines/selftest.html` and `web/studio/viewers/harness.html`.

## Adding a problem

Add an entry to `web/problems.js` with a statement, starter code and a reference answer. Then add one correct and one wrong answer for it in `web/grader.test.mjs` and run the test. If the reference and your correct answer don't both pass, the problem statement is ambiguous.

## Known limits

- Reference answers are sent to the browser, so a determined user can read them. Grading has to move to a server before results count for hiring.
- The RTL check tries a full proof (induction) first. If the proof cannot be completed, it checks the first 40 cycles after reset and the result says so; a bug that only shows up later could then be missed. All current problems are fully proved.
- The local helper runs one job at a time.
- Studio's in-browser timing is real OpenSTA. It uses one corner (tt_025C_5v00) and an ideal clock, so hold and skew numbers are not meaningful there.
- Studio's in-browser flow has no clock tree yet (a browser port of OpenROAD's TritonCTS is in progress). With the local runner, LibreLane builds a real clock tree.
- In-browser placement and routing (graywolf, qrouter) do not look at timing, so results differ from an OpenROAD run.
