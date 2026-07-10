#!/usr/bin/env python3
"""RewindPix Tools — local dev server.

Default (proxy): serves the app from this folder AND forwards camera requests
(`/?custom=1...`, `/DCIM/...`, `/OTA/...`) to the camera at http://192.168.1.254, so the app runs
*same-origin* locally exactly as it does when served from the camera's SD card. Join the camera WiFi.

`--mock`: no camera needed — canned API responses + placeholder photos, to develop/verify the UI.

DEV ONLY. In production the camera serves the files itself — no server needed.

Usage:  python dev-server.py [port] [--mock]     (default port 8200)
"""
import http.server, socketserver, urllib.request, sys

CAMERA = "http://192.168.1.254"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 8200
MOCK = "--mock" in sys.argv


def is_camera_request(path):
    p = path.split("?", 1)[0]
    return ("custom=1" in path) or p.startswith(("/DCIM", "/OTA", "/System"))


def mock_response(path):
    """Return (content_type, bytes) for a camera request in mock mode."""
    def xml(s):
        return "text/xml", ('<?xml version="1.0" encoding="UTF-8" ?>\n' + s).encode()
    if "cmd=3012" in path:
        return xml("<Function><Cmd>3012</Cmd><Status>0</Status><String>V1.1.3</String></Function>")
    if "cmd=8018" in path:
        return xml("<Function><Cmd>8018</Cmd><Status>0</Status><String>PS135</String></Function>")
    if "cmd=1003" in path:
        return xml("<Function><Cmd>1003</Cmd><Status>0</Status><Value>1229</Value></Function>")
    if "cmd=3014" in path:
        return xml("<Function><Cmd>8004</Cmd><Status>99</Status><Cmd>8005</Cmd><Status>2</Status></Function>")
    if "cmd=8003" in path:
        return xml("<LIST><FILM_FILTER_C1>GLVIVID</FILM_FILTER_C1><FILM_FILTER_C2>GLEXP</FILM_FILTER_C2><FILM_FILTER_C3>BWHC</FILM_FILTER_C3></LIST>")
    _PARAMS = {"8013": (0, 75, 0, 0, 0, 0, 0), "8015": (10, 80, 0, 0, 0, 0, 20), "8017": (0, 100, 0, 0, 0, 0, -100),
               "8007": (-255,) * 7, "8009": (-255,) * 7, "8011": (-255,) * 7}
    for _c, _v in _PARAMS.items():
        if ("cmd=" + _c) in path:
            _f = ["LUM", "CONTRAST", "RGAIN", "GGAIN", "BGAIN", "HUE", "SAT"]
            return xml("<LIST>" + "".join("<%s>%d</%s>" % (_f[i], _v[i], _f[i]) for i in range(7)) + "</LIST>")
    if "cmd=3015" in path:
        files = [
            ("Original_Film", "DCIM07102026GLVIVID_0003.JPG", 528992, 1600),
            ("Original_Film", "DCIM07102026GLEXP_0002.JPG", 246281, 1500),
            ("Original_Film", "DCIM07102026BWHC_0001.JPG", 284601, 1400),
            ("In_Camera_Mode", "DCIM07102026SUNNY-WARM_0005.JPG", 1578000, 1550),
            ("In_Camera_Mode", "DCIM07102026SIMPLY-MONO_0004.JPG", 1336000, 1450),
            ("._FILM", "DCIM07102026GLVIVID_0003.JPG", 528992, 1600),  # dup of Original_Film — must be skipped
        ]
        body = "<LIST>\n"
        for folder, name, size, tc in files:
            body += ("<ALLFile><File><NAME>%s</NAME><FPATH>A:\\DCIM\\%s\\%s</FPATH>"
                     "<SIZE>%d</SIZE><TIMECODE>%d</TIMECODE><TIME>2026/07/10 06:%02d:00</TIME>"
                     "</File></ALLFile>\n") % (name, folder, name, size, tc, tc % 60)
        body += "</LIST>"
        return xml(body)
    if path.split("?", 1)[0].endswith(".JPG"):
        name = path.split("/")[-1]
        hue = (hash(name) % 360)
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">'
               '<rect width="600" height="400" fill="hsl(%d,45%%,35%%)"/>'
               '<text x="20" y="210" fill="white" font-family="monospace" font-size="22">%s</text></svg>' % (hue, name))
        return "image/svg+xml", svg.encode()
    return xml("<Function><Status>0</Status></Function>")


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if is_camera_request(self.path):
            try:
                if MOCK:
                    ct, body = mock_response(self.path)
                else:
                    with urllib.request.urlopen(CAMERA + self.path, timeout=20) as r:
                        body = r.read()
                        ct = r.headers.get("Content-Type", "application/octet-stream")
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

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as s:
        print("RewindPix dev server → http://localhost:%d  [%s]" % (PORT, "MOCK" if MOCK else ("proxy → " + CAMERA)))
        s.serve_forever()
