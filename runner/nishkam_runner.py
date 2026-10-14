"""Nishkam local runner: lets the Nishkam web page run LibreLane on this machine.

Same idea as Colab's "connect to a local runtime": the page stays in the browser,
the heavy tools run here, inside the iic-osic-tools Docker container.

    python nishkam_runner.py                # prints the link to open
    python nishkam_runner.py --allow-shell  # also lets the page run shell commands (off by default)
    python nishkam_runner.py --selftest     # checks the input validation

Security model (this server runs tools on your machine for a web page):
- binds 127.0.0.1 only; every request needs the random token printed at startup
- only origins in --origin may call it (CORS)
- user input only ever becomes files in a fresh job folder; commands are fixed
- LibreLane config is built here from an allowlist of knobs, never taken verbatim
- /shell is the one exception: it runs what the page sends, so it is off unless --allow-shell
"""
import argparse, json, os, re, secrets, subprocess, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

VERSION = "0.2"
FILE_RE = re.compile(r"^[A-Za-z0-9_]{1,40}\.(v|sv|vh)$")
TOP_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
ID_RE = re.compile(r"^[\w-]{1,64}$")
MAX_FILE = 200_000
FLOW_TIMEOUT_S = 20 * 60
SHELL_TIMEOUT_S = 120
MAX_DOWNLOAD = 50 * 1024 * 1024
MAX_LOG_CHUNK = 1024 * 1024

# Studio stage -> (first, last) LibreLane 3.0 Classic step ids, used as `librelane -F first -T last`.
# Ids come from Flow.factory.get('Classic').Steps in the gf180 container. Classic is one chain, so a
# stage range is: from = first step of the first stage, to = last step of the last stage.
# Starting after floorplan needs the earlier steps' output, so it must resume a finished job's run
# folder (POST /jobs {"resume": <id>}): with the same --run-tag, LibreLane reuses the folder and
# takes the state of the step before -F.
STAGES = {
    "floorplan": ("Verilator.Lint", "Odb.RemovePDNObstructions"),     # lint, synth, floorplan, tap, PDN
    "place": ("Odb.AddRoutingObstructions", "OpenROAD.DetailedPlacement"),
    "cts": ("OpenROAD.CTS", "OpenROAD.STAMidPNR-2"),
    "route": ("OpenROAD.GlobalRouting", "Checker.WireLength"),
    "sta": ("OpenROAD.FillInsertion", "OpenROAD.IRDropReport"),       # fill, RCX, post-route STA, IR drop
    "signoff": ("Magic.StreamOut", "Misc.ReportManufacturability"),   # GDS, DRC, XOR, LVS
}
STAGE_ORDER = list(STAGES)

# artifact types the page may download (no .odb: big and useless in a browser)
FILE_TYPES = {".def": "text/plain", ".gds": "application/octet-stream", ".png": "image/png",
              ".rpt": "text/plain", ".log": "text/plain", ".spef": "text/plain", ".v": "text/plain",
              ".json": "application/json", ".sdc": "text/plain", ".lef": "text/plain", ".lib": "text/plain",
              ".csv": "text/csv", ".txt": "text/plain", ".sdf": "text/plain", ".lyrdb": "application/xml",
              ".svg": "image/svg+xml", ".spice": "text/plain"}

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


def stage_range(req):
    """Validate optional 'from'/'to' stage ids. Returns (first_step, last_step); each may be None."""
    a, b = req.get("from"), req.get("to")
    for v in (a, b):
        if v is not None and v not in STAGES:
            raise ValueError(f"unknown stage: {v!r} (use {', '.join(STAGES)})")
    if a and b and STAGE_ORDER.index(a) > STAGE_ORDER.index(b):
        raise ValueError("'from' is after 'to'")
    if a and a != "floorplan" and req.get("resume") is None:
        raise ValueError("starting after floorplan needs 'resume' (a finished job id)")
    return (STAGES[a][0] if a else None, STAGES[b][1] if b else None)


def build_job(req):
    """Validate a POST /jobs body. Returns (files, config, step_range) or raises ValueError."""
    if not isinstance(req, dict) or req.get("kind") != "flow":
        raise ValueError("kind must be 'flow'")
    rng = stage_range(req)
    if req.get("resume") is not None:  # continue a finished job: files and knobs stay as they were
        if not isinstance(req["resume"], str) or not ID_RE.match(req["resume"]):
            raise ValueError("bad resume id")
        if req.get("from") is None:
            raise ValueError("resume needs 'from'")
        return {}, {}, rng
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
    return files, config, rng


class Runner:
    def __init__(self, container, host_dir, ctr_dir):
        self.container, self.host_dir, self.ctr_dir = container, Path(host_dir), ctr_dir
        # ponytail: one job (or shell command) at a time, the container has ~4 GB RAM
        self.jobs, self.lock, self.shell_lock = {}, threading.Lock(), threading.Lock()

    def busy(self):
        return any(j["state"] in ("queued", "running") for j in self.jobs.values())

    def submit(self, files, config, rng=(None, None), resume=None):
        with self.lock:
            if self.busy() or self.shell_lock.locked():
                raise RuntimeError("a job is already running")
            if resume:
                old = self.jobs.get(resume)
                if not old or old["state"] not in ("done", "failed"):
                    raise RuntimeError("resume: no such finished job")
                jid = resume  # same id and folder, so the page keeps one log
                self.jobs[jid] = {k: v for k, v in old.items() if k not in ("ended", "rc")}
                self.jobs[jid].update(state="queued", started=time.time(), range=rng)
            else:
                jid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
                d = self.host_dir / jid
                d.mkdir(parents=True)
                for name, text in files.items():
                    (d / name).write_text(text, encoding="utf-8", newline="\n")
                (d / "config.json").write_text(json.dumps(config, indent=2))
                self.jobs[jid] = {"state": "queued", "dir": d, "started": time.time(),
                                  "top": config["DESIGN_NAME"], "range": rng}
        threading.Thread(target=self._run, args=(jid,), daemon=True).start()
        return jid

    def _run(self, jid):
        job = self.jobs[jid]
        job["state"] = "running"
        first, last = job["range"]  # only values from the STAGES table, never raw request text
        opts = (f" -F {first}" if first else "") + (f" -T {last}" if last else "")
        cmd = ["docker", "exec", "-w", f"{self.ctr_dir}/{jid}", self.container,
               "bash", "-lc",
               f"timeout -k 5 {FLOW_TIMEOUT_S} librelane config.json --run-tag run{opts} >> flow.log 2>&1"]
        try:
            rc = subprocess.run(cmd, timeout=FLOW_TIMEOUT_S + 30, capture_output=True).returncode
        except subprocess.TimeoutExpired:
            rc = "timeout"
        if rc == 124:  # `timeout` inside the container killed LibreLane
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
        out.update(self.steps(d))
        mfile = d / "runs" / "run" / "final" / "metrics.json"
        if mfile.exists():
            m = json.loads(mfile.read_text())
            out["metrics"] = {k: m.get(k) for k in METRICS}
        out["has_layout"] = (d / "runs" / "run" / "final" / "render" / f"{job['top']}.png").exists()
        return out

    @staticmethod
    def steps(d):
        """Step folders in the run dir: finished = has state_out.json, current = first unfinished."""
        run = d / "runs" / "run"
        dirs = sorted(p for p in run.iterdir() if p.is_dir() and re.match(r"\d+-", p.name)) if run.is_dir() else []
        done = [p.name for p in dirs if (p / "state_out.json").exists()]
        cur = next((p.name for p in dirs if p.name not in done), None)
        return {"current_step": cur, "finished_steps": done}

    def run_dir(self, jid):
        job = self.jobs.get(jid)
        return job and job["dir"] / "runs" / "run"

    def log_chunk(self, jid, offset):
        job = self.jobs.get(jid)
        if not job:
            return None
        log = job["dir"] / "flow.log"
        if not log.exists():
            return b"", offset
        with open(log, "rb") as f:
            f.seek(offset)
            data = f.read(MAX_LOG_CHUNK)
        return data, offset + len(data)

    def files(self, jid):
        run = self.run_dir(jid)
        if not run or not run.is_dir():
            return None
        out = []
        for p in run.rglob("*"):
            if p.suffix in FILE_TYPES and p.is_file() and len(out) < 5000:
                out.append({"path": p.relative_to(run).as_posix(), "size": p.stat().st_size})
        return sorted(out, key=lambda x: x["path"])

    def file(self, jid, rel):
        """Return (path, content_type) for an artifact inside the run dir, or an error string."""
        run = self.run_dir(jid)
        if not run:
            return "no such job"
        p = run / rel
        if p.is_symlink() or not p.resolve().is_relative_to(run.resolve()) or not p.is_file():
            return "not found"
        if p.suffix not in FILE_TYPES:
            return "file type not allowed"
        if p.stat().st_size > MAX_DOWNLOAD:
            return "file too large"
        return p, FILE_TYPES[p.suffix]

    def shell(self, cmd, write):
        """Run cmd in the container and pass its output to write(bytes). One at a time, 120 s."""
        with self.lock:
            if self.busy() or not self.shell_lock.acquire(blocking=False):
                raise RuntimeError("runner is busy")
        try:
            p = subprocess.Popen(["docker", "exec", "-w", self.ctr_dir, self.container, "timeout", "-k", "2", str(SHELL_TIMEOUT_S), "bash", "-lc", cmd],
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            for chunk in iter(lambda: p.stdout.read1(4096), b""):  # `timeout` inside the container enforces 120 s
                write(chunk)
            rc = p.wait()
            write(f"\n[exit {rc}]\n".encode())
        finally:
            self.shell_lock.release()

    def layout(self, jid):
        job = self.jobs.get(jid)
        p = job and job["dir"] / "runs" / "run" / "final" / "render" / f"{job['top']}.png"
        return p.read_bytes() if p and p.exists() else None


def make_handler(runner, token, origins, allow_shell=False):
    class H(BaseHTTPRequestHandler):
        def log_message(self, fmt, *a):
            sys.stderr.write("[runner] " + fmt % a + "\n")

        def _cors(self):
            o = self.headers.get("Origin")
            if o in origins:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Nishkam-Token")
                self.send_header("Access-Control-Expose-Headers", "X-Next-Offset")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _send(self, code, body, ctype="application/json", extra=None):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def _authed(self):
            host = self.headers.get("Host", "")  # blocks DNS rebinding
            if host not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
                self._send(403, {"error": "bad host"})
                return False
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
            path, _, query = self.path.partition("?")
            if path == "/health":
                return self._send(200, {"ok": True, "version": VERSION, "container": runner.container,
                                        "busy": runner.busy(), "shell": allow_shell})
            m = re.fullmatch(r"/jobs/([\w-]{1,64})(/layout\.png|/log|/metrics|/files|/file)?", path)
            if not m:
                return self._send(404, {"error": "not found"})
            jid, sub, q = m.group(1), m.group(2), parse_qs(query)
            if sub == "/layout.png":
                png = runner.layout(jid)
                return self._send(200, png, "image/png") if png else self._send(404, {"error": "no layout"})
            if sub == "/log":
                try:
                    off = max(0, int(q.get("offset", ["0"])[0]))
                except ValueError:
                    return self._send(400, {"error": "bad offset"})
                r = runner.log_chunk(jid, off)
                if r is None:
                    return self._send(404, {"error": "no such job"})
                return self._send(200, r[0], "text/plain; charset=utf-8", {"X-Next-Offset": str(r[1])})
            if sub == "/metrics":
                run = runner.run_dir(jid)
                mf = run and run / "final" / "metrics.json"
                return self._send(200, mf.read_bytes()) if mf and mf.exists() else self._send(404, {"error": "no metrics yet"})
            if sub == "/files":
                fl = runner.files(jid)
                return self._send(200, {"files": fl}) if fl is not None else self._send(404, {"error": "no run yet"})
            if sub == "/file":
                r = runner.file(jid, q.get("path", [""])[0])
                if isinstance(r, str):
                    return self._send(403 if "allowed" in r or "large" in r else 404, {"error": r})
                return self._send(200, r[0].read_bytes(), r[1])
            s = runner.status(jid)
            self._send(200, s) if s else self._send(404, {"error": "no such job"})

        def do_POST(self):
            if not self._authed():
                return
            path = self.path.partition("?")[0]
            if path == "/shell":
                return self._shell()
            if path != "/jobs":
                return self._send(404, {"error": "not found"})
            try:
                n = int(self.headers.get("Content-Length", 0))
                if n > 2_000_000:
                    raise ValueError("request too large")
                req = json.loads(self.rfile.read(n))
                files, config, rng = build_job(req)
                self._send(200, {"id": runner.submit(files, config, rng, req.get("resume"))})
            except (ValueError, json.JSONDecodeError) as e:
                self._send(400, {"error": str(e)})
            except RuntimeError as e:
                self._send(409, {"error": str(e)})

        def _shell(self):
            if not allow_shell:
                return self._send(403, {"error": "shell is off; start the runner with --allow-shell"})
            try:
                cmd = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 10_000)))["cmd"]
                if not isinstance(cmd, str) or not 0 < len(cmd) <= 2000:
                    raise ValueError
            except (ValueError, KeyError, TypeError):
                return self._send(400, {"error": 'need {"cmd": string}'})
            if runner.busy() or runner.shell_lock.locked():
                return self._send(409, {"error": "runner is busy"})
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Connection", "close")  # HTTP/1.0: body ends when the socket closes
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

            def write(b):
                self.wfile.write(b)
                self.wfile.flush()
            try:
                runner.shell(cmd, write)
            except (RuntimeError, OSError) as e:
                try:
                    write(f"[error: {e}]\n".encode())
                except OSError:
                    return
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
    files, cfg, rng = build_job(ok)
    assert cfg["DESIGN_NAME"] == "t" and cfg["CLOCK_PERIOD"] == 20 and cfg["VERILOG_FILES"] == ["dir::design.v"]
    assert rng == (None, None)
    bad = [
        {**ok, "files": {"../x.v": ""}},                       # path traversal
        {**ok, "files": {"a.tcl": ""}},                        # not Verilog
        {**ok, "top": "t; rm -rf /"},                          # injection via top
        {**ok, "knobs": {"SYNTH_SCRIPT": "evil.tcl"}},         # knob not on allowlist
        {**ok, "knobs": {"CLOCK_PERIOD": "1; echo"}},          # wrong type
        {**ok, "knobs": {"DIE_AREA": [0, 0, -5, 100]}},        # nonsense area
        {**ok, "kind": "shell"},
        {**ok, "from": "route"},                               # later start needs resume
        {**ok, "to": "Magic.DRC"},                             # raw step id, not a stage
        {**ok, "from": "cts", "to": "place", "resume": "x"},   # backwards
        {"kind": "flow", "resume": "../x", "from": "cts"},     # bad resume id
        {"kind": "flow", "resume": "x"},                       # resume without from
    ]
    for b in bad:
        try:
            build_job(b)
        except ValueError:
            continue
        raise AssertionError(f"accepted bad job: {b}")
    assert build_job({**ok, "to": "cts"})[2] == (None, "OpenROAD.STAMidPNR-2")
    assert build_job({"kind": "flow", "resume": "j1", "from": "route", "to": "sta"})[2] == (
        "OpenROAD.GlobalRouting", "OpenROAD.IRDropReport")
    # artifact access: traversal refused, type allowlist, step list, log offsets
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        r = Runner("c", t, "/x")
        j = Path(t) / "j"
        run = j / "runs" / "run"
        (run / "final").mkdir(parents=True)
        (run / "final" / "a.def").write_text("d")
        (run / "final" / "b.odb").write_text("o")
        (j / "secret.json").write_text("s")
        r.jobs["j"] = {"dir": j, "state": "done", "top": "t"}
        assert r.file("j", "final/a.def")[1] == "text/plain"
        for evil in ("../../secret.json", "final/b.odb", "/etc/passwd", "final"):
            assert isinstance(r.file("j", evil), str), evil
        assert [f["path"] for f in r.files("j")] == ["final/a.def"]
        (run / "05-x").mkdir(); (run / "05-x" / "state_out.json").write_text("{}"); (run / "06-y").mkdir()
        assert r.steps(j) == {"current_step": "06-y", "finished_steps": ["05-x"]}
        (j / "flow.log").write_text("hello")
        assert r.log_chunk("j", 2) == (b"llo", 5)
    print("selftest OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=7381)
    ap.add_argument("--container", help="iic-osic-tools container name (auto-detected)")
    ap.add_argument("--host-dir", default=str(Path.home() / "eda" / "designs" / "nishkam_jobs"),
                    help="job folder on this machine, must be mounted in the container")
    ap.add_argument("--container-dir", default="/foss/designs/nishkam_jobs", help="same folder inside the container")
    ap.add_argument("--origin", action="append",
                    default=["https://nishkam.world", "https://www.nishkam.world", "https://yashv373.github.io",
                             "http://localhost:8000", "http://127.0.0.1:8000"],
                    help="web page origin allowed to use this runner (repeatable)")
    ap.add_argument("--site", default="https://nishkam.world",
                    help="where the Nishkam page is served (http://localhost:8000 for local development)")
    ap.add_argument("--allow-shell", action="store_true",
                    help="let the page run shell commands in the container (off by default)")
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
    # Windows SO_REUSEADDR lets a second process bind the same port silently (a stale runner, or another
    # local program, would then get the page's requests). Fail loudly instead.
    ThreadingHTTPServer.allow_reuse_address = os.name != "nt"
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(runner, token, set(a.origin), a.allow_shell))
    print(f"Nishkam runner {VERSION} using container '{container}', jobs in {a.host_dir}")
    if a.allow_shell:
        print("!" * 70)
        print("!! SHELL IS ON: whoever has the link below can run ANY command in the container.")
        print("!! Do not share the link. Restart without --allow-shell to turn it off.")
        print("!" * 70)
    frag = f"#runner=http://127.0.0.1:{a.port}&token={token}"
    print(f"\n  Open one of these links to connect:\n  Studio:   {a.site}/studio.html{frag}\n  Practice: {a.site}/app.html{frag}\n")
    print("Keep this window open. Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
