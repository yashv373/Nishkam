"""Nishkam local runner: lets the Nishkam web page run LibreLane on this machine.

Same idea as Colab's "connect to a local runtime": the page stays in the browser,
the heavy tools run here, inside the iic-osic-tools Docker container.

    python nishkam_runner.py            # prints the link to open
    python nishkam_runner.py --selftest # checks the input validation

Security model (this server runs tools on your machine for a web page):
- binds 127.0.0.1 only; every request needs the random token printed at startup
- only origins in --origin may call it (CORS)
- user input only ever becomes files in a fresh job folder; commands are fixed
- LibreLane config is built here from an allowlist of knobs, never taken verbatim
"""
import argparse, json, os, re, secrets, subprocess, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "0.1"
FILE_RE = re.compile(r"^[A-Za-z0-9_]{1,40}\.(v|sv|vh)$")
TOP_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
MAX_FILE = 200_000
FLOW_TIMEOUT_S = 20 * 60

# knob -> validator. Anything not listed is rejected.
def _num(lo, hi):
    return lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi
KNOBS = {
    "CLOCK_PERIOD": _num(1, 1000),
    "DIE_AREA": lambda v: isinstance(v, list) and len(v) == 4 and all(_num(0, 2000)(x) for x in v)
                and v[2] > v[0] and v[3] > v[1],
    "PL_TARGET_DENSITY_PCT": _num(10, 95),
    "SYNTH_STRATEGY": lambda v: isinstance(v, str) and re.fullmatch(r"(AREA|DELAY) [0-4]", v) is not None,
    "GRT_ALLOW_CONGESTION": lambda v: isinstance(v, bool),
}

BASE_CONFIG = {
    "meta": {"version": 3, "flow": "Classic"},
    "PDK": "gf180mcuD",
    "FP_SIZING": "absolute",
    "DIE_AREA": [0, 0, 200, 200],
    "CLOCK_PERIOD": 40,
    # clkbuf_16 can be unreachable for the router on gf180 (DRT-1231); small designs don't need it
    "CTS_CLK_BUFFERS": ["gf180mcu_fd_sc_mcu7t5v0__clkbuf_8", "gf180mcu_fd_sc_mcu7t5v0__clkbuf_4",
                        "gf180mcu_fd_sc_mcu7t5v0__clkbuf_2"],
    "CTS_ROOT_BUFFER": "gf180mcu_fd_sc_mcu7t5v0__clkbuf_8",
}

METRICS = [
    "timing__setup__ws", "timing__hold__ws", "design__instance__area__stdcell", "design__die__area",
    "design__core__area", "power__total", "route__drc_errors", "magic__drc_error__count",
    "design__lvs_error__count", "route__wirelength", "design__max_slew_violation__count",
    "design__max_cap_violation__count", "route__antenna_violation__count", "design__instance__count",
]


def build_job(req):
    """Validate a POST /jobs body. Returns (files, config) or raises ValueError."""
    if not isinstance(req, dict) or req.get("kind") != "flow":
        raise ValueError("kind must be 'flow'")
    files, top, knobs = req.get("files"), req.get("top"), req.get("knobs", {})
    if not isinstance(files, dict) or not 1 <= len(files) <= 8:
        raise ValueError("files: 1-8 Verilog files")
    for name, text in files.items():
        if not FILE_RE.match(name):
            raise ValueError(f"bad file name: {name!r}")
        if not isinstance(text, str) or len(text) > MAX_FILE:
            raise ValueError(f"{name}: too large or not text")
    if not isinstance(top, str) or not TOP_RE.match(top):
        raise ValueError("bad top module name")
    if not isinstance(knobs, dict):
        raise ValueError("knobs must be an object")
    for k, v in knobs.items():
        if k not in KNOBS or not KNOBS[k](v):
            raise ValueError(f"knob not allowed or out of range: {k}")
    clock = req.get("clock_port", "clk")
    if not isinstance(clock, str) or not TOP_RE.match(clock):
        raise ValueError("bad clock port")
    config = {**BASE_CONFIG, **knobs, "DESIGN_NAME": top, "CLOCK_PORT": clock,
              "VERILOG_FILES": [f"dir::{n}" for n in files if not n.endswith(".vh")]}
    return files, config


class Runner:
    def __init__(self, container, host_dir, ctr_dir):
        self.container, self.host_dir, self.ctr_dir = container, Path(host_dir), ctr_dir
        self.jobs, self.lock = {}, threading.Lock()  # ponytail: one job at a time, the container has ~4 GB RAM

    def busy(self):
        return any(j["state"] in ("queued", "running") for j in self.jobs.values())

    def submit(self, files, config):
        with self.lock:
            if self.busy():
                raise RuntimeError("a job is already running")
            jid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
            d = self.host_dir / jid
            d.mkdir(parents=True)
            for name, text in files.items():
                (d / name).write_text(text, encoding="utf-8", newline="\n")
            (d / "config.json").write_text(json.dumps(config, indent=2))
            self.jobs[jid] = {"state": "queued", "dir": d, "started": time.time(), "top": config["DESIGN_NAME"]}
        threading.Thread(target=self._run, args=(jid,), daemon=True).start()
        return jid

    def _run(self, jid):
        job = self.jobs[jid]
        job["state"] = "running"
        cmd = ["docker", "exec", "-w", f"{self.ctr_dir}/{jid}", self.container,
               "bash", "-lc", "librelane config.json --run-tag run > flow.log 2>&1"]
        try:
            rc = subprocess.run(cmd, timeout=FLOW_TIMEOUT_S, capture_output=True).returncode
        except subprocess.TimeoutExpired:
            rc = "timeout"
        job["rc"] = rc
        job["state"] = "done" if rc == 0 else "failed"
        job["ended"] = time.time()

    def status(self, jid):
        job = self.jobs.get(jid)
        if not job:
            return None
        d = job["dir"]
        log = d / "flow.log"
        tail = log.read_text(errors="replace")[-6000:] if log.exists() else ""
        out = {"id": jid, "state": job["state"], "rc": job.get("rc"), "log_tail": tail,
               "elapsed_s": round((job.get("ended") or time.time()) - job["started"])}
        mfile = d / "runs" / "run" / "final" / "metrics.json"
        if mfile.exists():
            m = json.loads(mfile.read_text())
            out["metrics"] = {k: m.get(k) for k in METRICS}
        out["has_layout"] = (d / "runs" / "run" / "final" / "render" / f"{job['top']}.png").exists()
        return out

    def layout(self, jid):
        job = self.jobs.get(jid)
        p = job and job["dir"] / "runs" / "run" / "final" / "render" / f"{job['top']}.png"
        return p.read_bytes() if p and p.exists() else None


def make_handler(runner, token, origins):
    class H(BaseHTTPRequestHandler):
        def log_message(self, fmt, *a):
            sys.stderr.write("[runner] " + fmt % a + "\n")

        def _cors(self):
            o = self.headers.get("Origin")
            if o in origins:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Nishkam-Token")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _authed(self):
            o = self.headers.get("Origin")
            if o is not None and o not in origins:
                self._send(403, {"error": "origin not allowed"})
                return False
            if not secrets.compare_digest(self.headers.get("X-Nishkam-Token", ""), token):
                self._send(401, {"error": "bad token"})
                return False
            return True

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if not self._authed():
                return
            path = self.path.partition("?")[0]
            if path == "/health":
                return self._send(200, {"ok": True, "version": VERSION, "container": runner.container,
                                        "busy": runner.busy()})
            m = re.fullmatch(r"/jobs/([\w-]{1,64})(/layout\.png)?", path)
            if m and m.group(2):
                png = runner.layout(m.group(1))
                return self._send(200, png, "image/png") if png else self._send(404, {"error": "no layout"})
            if m:
                s = runner.status(m.group(1))
                return self._send(200, s) if s else self._send(404, {"error": "no such job"})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if not self._authed():
                return
            if self.path.partition("?")[0] != "/jobs":
                return self._send(404, {"error": "not found"})
            try:
                n = int(self.headers.get("Content-Length", 0))
                if n > 2_000_000:
                    raise ValueError("request too large")
                files, config = build_job(json.loads(self.rfile.read(n)))
                self._send(200, {"id": runner.submit(files, config)})
            except (ValueError, json.JSONDecodeError) as e:
                self._send(400, {"error": str(e)})
            except RuntimeError as e:
                self._send(409, {"error": str(e)})
    return H


def find_container():
    out = subprocess.run(["docker", "ps", "--format", "{{.Names}}\t{{.Image}}"],
                         capture_output=True, text=True).stdout
    for line in out.splitlines():
        name, _, image = line.partition("\t")
        if "iic-osic-tools" in image:
            return name
    return None


def selftest():
    ok = {"kind": "flow", "files": {"design.v": "module t(input clk); endmodule"}, "top": "t",
          "knobs": {"CLOCK_PERIOD": 20, "DIE_AREA": [0, 0, 100, 100]}}
    files, cfg = build_job(ok)
    assert cfg["DESIGN_NAME"] == "t" and cfg["CLOCK_PERIOD"] == 20 and cfg["VERILOG_FILES"] == ["dir::design.v"]
    bad = [
        {**ok, "files": {"../x.v": ""}},                       # path traversal
        {**ok, "files": {"a.tcl": ""}},                        # not Verilog
        {**ok, "top": "t; rm -rf /"},                          # injection via top
        {**ok, "knobs": {"SYNTH_SCRIPT": "evil.tcl"}},         # knob not on allowlist
        {**ok, "knobs": {"CLOCK_PERIOD": "1; echo"}},          # wrong type
        {**ok, "knobs": {"DIE_AREA": [0, 0, -5, 100]}},        # nonsense area
        {**ok, "kind": "shell"},
    ]
    for b in bad:
        try:
            build_job(b)
        except ValueError:
            continue
        raise AssertionError(f"accepted bad job: {b}")
    print("selftest OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=7381)
    ap.add_argument("--container", help="iic-osic-tools container name (auto-detected)")
    ap.add_argument("--host-dir", default=str(Path.home() / "eda" / "designs" / "nishkam_jobs"),
                    help="job folder on this machine, must be mounted in the container")
    ap.add_argument("--container-dir", default="/foss/designs/nishkam_jobs", help="same folder inside the container")
    ap.add_argument("--origin", action="append",
                    default=["https://yashv373.github.io", "http://localhost:8000", "http://127.0.0.1:8000"],
                    help="web page origin allowed to use this runner (repeatable)")
    ap.add_argument("--site", default="https://yashv373.github.io/Nishkam",
                    help="where the Nishkam page is served (http://localhost:8000 for local development)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    container = a.container or find_container()
    if not container:
        sys.exit("No running iic-osic-tools container found. Start it, or pass --container NAME.")
    Path(a.host_dir).mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(24)
    runner = Runner(container, a.host_dir, a.container_dir)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(runner, token, set(a.origin)))
    print(f"Nishkam runner {VERSION} using container '{container}', jobs in {a.host_dir}")
    print(f"\n  Open this link to connect:\n  {a.site}/app.html#runner=http://127.0.0.1:{a.port}&token={token}\n")
    print("Keep this window open. Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
