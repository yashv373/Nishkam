# Nishkam
निष्काम

Practice digital chip design in the browser, from RTL to layout.

*Invincible is just a word.*

## What it does

- **RTL problems** run entirely in your browser. You write Verilog and press Submit. Yosys, compiled to WebAssembly, checks your design against a reference for every possible input sequence up to 20 cycles after reset. If they differ, you see the exact cycle and inputs where your output is wrong. No install, no account.
- **Physical design problems** run on your own computer. A small helper program takes your design from the page and runs LibreLane (gf180mcuD) in the [iic-osic-tools](https://github.com/iic-jku/iic-osic-tools) Docker container. You get signoff numbers and a picture of the layout back in the page.
- Any RTL problem you solve can be sent through the full flow to see it as a chip.

Live at **https://yashv373.github.io/Nishkam/**

## Run it locally

You need Python 3.

```
cd web
python -m http.server 8000
```

Open http://localhost:8000/app.html. RTL problems work right away. The first Submit downloads Yosys (about 70 MB), and the browser caches it after that.

### Physical design (optional)

1. Start the iic-osic-tools container, with `~/eda/designs` mounted at `/foss/designs` (its default).
2. Run `start-runner.bat` (Windows) or `python runner/nishkam_runner.py`.
3. Open the link it prints.

The link points at the live site. If you are working on the page locally, use
`python runner/nishkam_runner.py --site http://localhost:8000` instead.

The helper only listens on your own machine (127.0.0.1). It only answers this page, and only with the secret token in the link. It never runs commands from the page. It only writes your Verilog files into a new job folder and runs LibreLane with a config it builds itself. Settings outside a short allowlist are refused.

Jobs go to `~/eda/designs/nishkam_jobs/`. Delete old ones whenever you like.

## Deploying

Every push to `main` publishes the `web/` folder to GitHub Pages (`.github/workflows/pages.yml`).
One-time setup: in the repo, Settings → Pages → Source: **GitHub Actions**.

## Files

```
web/index.html         landing page
web/app.html           practice page layout and styles
web/app.js             page logic
web/problems.js        the problems and their reference answers
web/grader.js          how RTL answers are checked (shared with the test)
web/worker.js          runs Yosys without freezing the page
web/brand/             logo (traced to SVG), alternate mark, favicon
web/grader.test.mjs    checks every problem: right answers pass, wrong ones fail
runner/nishkam_runner.py   the local helper
```

## Tests

```
npm i @yowasp/yosys@0.68.1207
node web/grader.test.mjs
python runner/nishkam_runner.py --selftest
```

## Adding a problem

Add an entry to `web/problems.js` with a statement, starter code and a reference answer. Then add one correct and one wrong answer for it in `web/grader.test.mjs` and run the test. If the reference and your correct answer don't both pass, the problem statement is ambiguous.

## Known limits

- Reference answers are sent to the browser, so a determined user can read them. Grading has to move to a server before results count for hiring.
- The RTL check covers 20 cycles after reset. A bug that only shows up later will be missed.
- The local helper runs one job at a time.
