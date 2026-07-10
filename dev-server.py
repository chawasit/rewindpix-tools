#!/usr/bin/env python3
"""RewindPix Tools — local dev server.

Default (proxy): serves the app from this folder AND forwards camera requests
(`/?custom=1...`, `/DCIM/...`, `/OTA/...`) to the camera at http://192.168.1.254, so the app runs
*same-origin* locally exactly as it does when served from the camera's SD card. Join the camera WiFi.

`--mock`: no camera needed — a small **stateful** mock camera (canned reads + writes that persist:
set roll/slots/params/clock, delete a file, upload adds one) + placeholder photos, to develop/verify
the UI. State lives in memory for the life of the process.

DEV ONLY. In production the camera serves the files itself — no server needed.

Usage:  python dev-server.py [port] [--mock]     (default port 8200)
"""
import http.server, socketserver, urllib.request, urllib.parse, sys, re

CAMERA = "http://192.168.1.254"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 8200
MOCK = "--mock" in sys.argv

# ---- stateful mock camera (only with --mock) --------------------------------------------------
FIELDS = ["LUM", "CONTRAST", "RGAIN", "GGAIN", "BGAIN", "HUE", "SAT"]
STATE = {
    "roll": 99,
    "slots": ["GLVIVID", "GLEXP", "BWHC"],
    "film": {1: [0, 75, 0, 0, 0, 0, 0], 2: [10, 80, 0, 0, 0, 0, 20], 3: [0, 100, 0, 0, 0, 0, -100]},
    "incam": {1: [-255] * 7, 2: [-255] * 7, 3: [-255] * 7},
    "date": "2026/07/10", "time": "06:00:00",
    # [folder, name, size, timecode]
    "files": [
        ["Original_Film", "DCIM07102026GLVIVID_0003.JPG", 528992, 1600],
        ["Original_Film", "DCIM07102026GLEXP_0002.JPG", 246281, 1500],
        ["Original_Film", "DCIM07102026BWHC_0001.JPG", 284601, 1400],
        ["In_Camera_Mode", "DCIM07102026SUNNY-WARM_0005.JPG", 1578000, 1550],
        ["In_Camera_Mode", "DCIM07102026SIMPLY-MONO_0004.JPG", 1336000, 1450],
        # ._FILM working copies: one with an Original_Film twin (GLVIVID, LUT match), one orphan RAW
        ["._FILM", "DCIM07102026GLVIVID_0003.JPG", 528992, 1600],
        ["._FILM", "DCIM07102026ZZUNKNOWN_0006.JPG", 512000, 1650],
    ],
}
_FILM_SLOT_SET = {"8012": 1, "8014": 2, "8016": 3}
_INCAM_SLOT_SET = {"8006": 1, "8008": 2, "8010": 3}
_FILM_SLOT_GET = {"8013": 1, "8015": 2, "8017": 3}
_INCAM_SLOT_GET = {"8007": 1, "8009": 2, "8011": 3}


def _q(path):
    qs = path.split("?", 1)[1] if "?" in path else ""
    return {k: v[0] for k, v in urllib.parse.parse_qs(qs, keep_blank_values=True).items()}


def _xml(s):
    return "text/xml", ('<?xml version="1.0" encoding="UTF-8" ?>\n' + s).encode()


def _fn(cmd, extra=""):
    return "<Function><Cmd>%s</Cmd><Status>0</Status>%s</Function>" % (cmd, extra)


def _parse7(s):
    try:
        v = [int(x) for x in str(s).split(":")]
        return (v + [0] * 7)[:7]
    except Exception:
        return [0] * 7


def _params_list(vals):
    return "<LIST>" + "".join("<%s>%d</%s>" % (FIELDS[i], vals[i], FIELDS[i]) for i in range(7)) + "</LIST>"


def _file_list():
    body = "<LIST>\n"
    for folder, name, size, tc in STATE["files"]:
        body += ("<ALLFile><File><NAME>%s</NAME><FPATH>A:\\DCIM\\%s\\%s</FPATH>"
                 "<SIZE>%d</SIZE><TIMECODE>%d</TIMECODE><TIME>%s 06:%02d:00</TIME>"
                 "</File></ALLFile>\n") % (name, folder, name, size, tc, STATE["date"], tc % 60)
    return body + "</LIST>"


def _jpeg(name):
    try:
        from PIL import Image, ImageDraw
        import io, colorsys
        r, g, b = [int(c * 255) for c in colorsys.hsv_to_rgb((hash(name) % 360) / 360.0, 0.5, 0.6)]
        im = Image.new("RGB", (600, 400), (r, g, b))
        ImageDraw.Draw(im).text((20, 190), name, fill=(255, 255, 255))
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=75)
        return "image/jpeg", buf.getvalue()
    except Exception:
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">'
               '<rect width="600" height="400" fill="hsl(%d,45%%,35%%)"/></svg>' % (hash(name) % 360))
        return "image/svg+xml", svg.encode()


def mock_response(path):
    """Return (content_type, bytes) for a mock camera GET; writes mutate STATE and persist."""
    q = _q(path); cmd = q.get("cmd", "")
    # ---- writes (persist) ----
    if cmd == "8004":
        STATE["roll"] = int(q.get("par", 0) or 0); return _xml(_fn(cmd))
    if cmd == "8002":
        STATE["slots"] = ((q.get("str", "") or "").split(":") + ["", "", ""])[:3]; return _xml(_fn(cmd))
    if cmd in _FILM_SLOT_SET:
        STATE["film"][_FILM_SLOT_SET[cmd]] = _parse7(q.get("str", "")); return _xml(_fn(cmd))
    if cmd in _INCAM_SLOT_SET:
        STATE["incam"][_INCAM_SLOT_SET[cmd]] = _parse7(q.get("str", "")); return _xml(_fn(cmd))
    if cmd == "3005":                                   # set date (YYYY-MM-DD); zeroes time-of-day
        d = q.get("str", "").replace("-", "/")
        if d:
            STATE["date"] = d; STATE["time"] = "00:00:00"
        return _xml(_fn(cmd))
    if cmd == "3006":                                   # set time (HH:MM:SS)
        STATE["time"] = q.get("str", STATE["time"]); return _xml(_fn(cmd))
    if cmd == "3011":                                   # SYSRESET → clears the 3 film slots
        STATE["slots"] = ["C1", "C2", "C3"]
        for s in (1, 2, 3):
            STATE["film"][s] = [-255] * 7
        return _xml(_fn(cmd))
    if cmd == "4003":                                   # delete one file (str=FPATH)
        fp = urllib.parse.unquote(q.get("str", "")).replace("\\", "/").split("/")
        base = fp[-1] if fp else ""; folder = fp[-2] if len(fp) >= 2 else ""
        STATE["files"] = [f for f in STATE["files"] if not (f[1] == base and f[0] == folder)]
        return _xml(_fn(cmd))
    # ---- reads (reflect STATE) ----
    if cmd == "3012": return _xml(_fn(cmd, "<String>V1.1.3</String>"))
    if cmd == "8018": return _xml(_fn(cmd, "<String>PS135</String>"))
    if cmd == "1003": return _xml(_fn(cmd, "<Value>1229</Value>"))
    if cmd == "3017": return _xml(_fn(cmd, "<Value>3940000000</Value>"))
    if cmd in ("3019", "3022", "3024"): return _xml(_fn(cmd, "<Value>1</Value>"))
    if cmd == "3014":
        return _xml("<Function><Cmd>8004</Cmd><Status>%d</Status><Cmd>8005</Cmd><Status>2</Status></Function>" % STATE["roll"])
    if cmd == "8003":
        s = (STATE["slots"] + ["", "", ""])[:3]
        return _xml("<LIST><FILM_FILTER_C1>%s</FILM_FILTER_C1><FILM_FILTER_C2>%s</FILM_FILTER_C2><FILM_FILTER_C3>%s</FILM_FILTER_C3></LIST>" % (s[0], s[1], s[2]))
    if cmd in _FILM_SLOT_GET: return _xml(_params_list(STATE["film"][_FILM_SLOT_GET[cmd]]))
    if cmd in _INCAM_SLOT_GET: return _xml(_params_list(STATE["incam"][_INCAM_SLOT_GET[cmd]]))
    if cmd == "3015": return _xml(_file_list())
    if path.split("?", 1)[0].endswith(".JPG"): return _jpeg(path.split("/")[-1])
    return _xml("<Function><Status>0</Status></Function>")     # generic ack (e.g. 3001 preview)


def mock_upload(path, body):
    """Mock the camera's HFS multipart upload: a DCIM upload adds/updates a file in the listing."""
    p = path.split("?", 1)[0].strip("/")               # e.g. DCIM/Developed_Photos
    m = re.search(rb'filename="([^"]*)"', body or b"")
    if p.startswith("DCIM") and "/" in p and m and m.group(1):
        folder = p.split("/")[-1]
        name = m.group(1).decode("latin1", "replace").replace("\\", "/").split("/")[-1]
        tc = max([f[3] for f in STATE["files"]], default=1600) + 1
        STATE["files"] = [f for f in STATE["files"] if not (f[0] == folder and f[1] == name)]
        STATE["files"].append([folder, name, len(body or b""), tc])
    return b"ok"


def is_camera_request(path):
    p = path.split("?", 1)[0]
    return ("custom=1" in path) or p.startswith(("/DCIM", "/OTA", "/System"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if is_camera_request(self.path):
            try:
                if MOCK:
                    ct, body = mock_response(self.path)
                else:
                    with urllib.request.urlopen(CAMERA + self.path, timeout=20) as r:
                        body = r.read(); ct = r.headers.get("Content-Type", "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_error(502, "camera proxy error: %s" % e)
            return
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        if is_camera_request(self.path) and not MOCK:
            try:
                req = urllib.request.Request(CAMERA + self.path, data=body, method="POST")
                ct_in = self.headers.get("Content-Type")
                if ct_in:
                    req.add_header("Content-Type", ct_in)
                with urllib.request.urlopen(req, timeout=30) as r:
                    out = r.read(); ct = r.headers.get("Content-Type", "text/html")
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)
            except Exception as e:
                self.send_error(502, "camera proxy error: %s" % e)
            return
        out = mock_upload(self.path, body) if (MOCK and is_camera_request(self.path)) else b"ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as s:
        print("RewindPix dev server → http://localhost:%d  [%s]" % (PORT, "MOCK" if MOCK else ("proxy → " + CAMERA)))
        s.serve_forever()
