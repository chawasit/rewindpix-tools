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
import email.parser, email.policy, http.server, socketserver, urllib.request, urllib.parse, sys, re
from xml.sax.saxutils import escape

CAMERA = "http://192.168.1.254"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 8200
MOCK = "--mock" in sys.argv
MAX_POST_BYTES = 256 * 1024 * 1024

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


def _xml_text(value):
    text = str(value)
    if any(not (c in "\t\n\r" or "\x20" <= c <= "\ud7ff" or "\ue000" <= c <= "\ufffd" or "\U00010000" <= c <= "\U0010ffff") for c in text):
        raise ValueError("invalid XML text")
    return escape(text)


def _fn(cmd, extra=""):
    return "<Function><Cmd>%s</Cmd><Status>0</Status>%s</Function>" % (_xml_text(cmd), extra)


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
        safe_folder = _xml_text(folder)
        safe_name = _xml_text(name)
        safe_date = _xml_text(STATE["date"])
        body += ("<ALLFile><File><NAME>%s</NAME><FPATH>A:\\DCIM\\%s\\%s</FPATH>"
                 "<SIZE>%d</SIZE><TIMECODE>%d</TIMECODE><TIME>%s 06:%02d:00</TIME>"
                 "</File></ALLFile>\n") % (safe_name, safe_folder, safe_name, size, tc, safe_date, tc % 60)
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
        slots = ((q.get("str", "") or "").split(":") + ["", "", ""])[:3]
        for name in slots:
            _xml_text(name)
        STATE["slots"] = slots; return _xml(_fn(cmd))
    if cmd in _FILM_SLOT_SET:
        STATE["film"][_FILM_SLOT_SET[cmd]] = _parse7(q.get("str", "")); return _xml(_fn(cmd))
    if cmd in _INCAM_SLOT_SET:
        STATE["incam"][_INCAM_SLOT_SET[cmd]] = _parse7(q.get("str", "")); return _xml(_fn(cmd))
    if cmd == "3005":                                   # set date (YYYY-MM-DD); zeroes time-of-day
        d = q.get("str", "").replace("-", "/")
        if d:
            _xml_text(d)
            STATE["date"] = d; STATE["time"] = "00:00:00"
        return _xml(_fn(cmd))
    if cmd == "3006":                                   # set time (HH:MM:SS)
        value = q.get("str", STATE["time"])
        _xml_text(value)
        STATE["time"] = value; return _xml(_fn(cmd))
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
        return _xml("<LIST><FILM_FILTER_C1>%s</FILM_FILTER_C1><FILM_FILTER_C2>%s</FILM_FILTER_C2><FILM_FILTER_C3>%s</FILM_FILTER_C3></LIST>" % tuple(_xml_text(name) for name in s))
    if cmd in _FILM_SLOT_GET: return _xml(_params_list(STATE["film"][_FILM_SLOT_GET[cmd]]))
    if cmd in _INCAM_SLOT_GET: return _xml(_params_list(STATE["incam"][_INCAM_SLOT_GET[cmd]]))
    if cmd == "3015": return _xml(_file_list())
    if path.split("?", 1)[0].endswith(".JPG"): return _jpeg(path.split("/")[-1])
    return _xml("<Function><Status>0</Status></Function>")     # generic ack (e.g. 3001 preview)


def _multipart_file(body, content_type=None):
    if not content_type:
        first_line = body.split(b"\r\n", 1)[0]
        if not first_line.startswith(b"--") or len(first_line) <= 2:
            raise ValueError("missing multipart boundary")
        try:
            boundary = first_line[2:].decode("ascii")
        except UnicodeDecodeError as e:
            raise ValueError("invalid multipart boundary") from e
        boundary = boundary.replace("\\", "\\\\").replace('"', '\\"')
        content_type = 'multipart/form-data; boundary="%s"' % boundary

    try:
        header = content_type.encode("latin1")
    except UnicodeEncodeError as e:
        raise ValueError("invalid multipart content type") from e
    message = email.parser.BytesParser(policy=email.policy.default).parsebytes(
        b"Content-Type: " + header + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    if message.get_content_type() != "multipart/form-data" or not message.get_boundary() or not message.is_multipart():
        raise ValueError("invalid multipart form data")
    if any(part.defects for part in message.walk()):
        raise ValueError("invalid multipart form data")
    for part in message.iter_parts():
        filename = part.get_filename()
        if part.get_content_disposition() == "form-data" and filename:
            payload = part.get_payload(decode=True)
            if payload is None:
                raise ValueError("invalid multipart file payload")
            return filename, payload
    raise ValueError("multipart form has no file")


def mock_upload(path, body, content_type=None):
    """Mock the camera's HFS multipart upload: a DCIM upload adds/updates a file in the listing."""
    safe_path = _safe_camera_path(path)
    p = safe_path.strip("/") if safe_path else ""        # e.g. DCIM/Developed_Photos
    if p.startswith("DCIM/"):
        filename, payload = _multipart_file(body, content_type)
        folder = urllib.parse.unquote(p.split("/")[-1])
        name = filename.replace("\\", "/").split("/")[-1]
        if not folder or not name:
            raise ValueError("invalid upload path or filename")
        _xml_text(folder)
        _xml_text(name)
        tc = max([f[3] for f in STATE["files"]], default=1600) + 1
        STATE["files"] = [f for f in STATE["files"] if not (f[0] == folder and f[1] == name)]
        STATE["files"].append([folder, name, len(payload), tc])
    return b"ok"


def _safe_camera_path(path):
    decoded = path.split("?", 1)[0]
    for _ in range(4):
        if "\x00" in decoded or "\\" in decoded or any(part in (".", "..") for part in decoded.split("/")):
            return None
        unquoted = urllib.parse.unquote(decoded)
        if unquoted == decoded:
            return decoded
        decoded = unquoted
    return None


def is_camera_request(path):
    p = _safe_camera_path(path)
    if p is None:
        return False
    command = p == "/" and _q(path).get("custom") == "1"
    file_route = any(p == root or p.startswith(root + "/") for root in ("/DCIM", "/OTA", "/System"))
    return command or file_route


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
        if not is_camera_request(self.path):
            self.send_error(404, "unknown POST route")
            return

        if self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            self.send_error(400, "Transfer-Encoding unsupported")
            return

        content_length = self.headers.get("Content-Length")
        digits = content_length.strip() if content_length is not None else ""
        if not digits or not re.fullmatch(r"\d+", digits):
            self.close_connection = True
            self.send_error(411, "valid Content-Length required")
            return
        normalized_length = digits.lstrip("0") or "0"
        if len(normalized_length) > len(str(MAX_POST_BYTES)):
            self.close_connection = True
            self.send_error(413, "POST body too large")
            return
        length = int(normalized_length)
        if length > MAX_POST_BYTES:
            self.close_connection = True
            self.send_error(413, "POST body too large")
            return
        body = self.rfile.read(length)
        if len(body) != length:
            self.close_connection = True
            self.send_error(400, "incomplete POST body")
            return

        if not MOCK:
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

        try:
            out = mock_upload(self.path, body, self.headers.get("Content-Type"))
        except ValueError as e:
            self.send_error(400, str(e))
            return
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
