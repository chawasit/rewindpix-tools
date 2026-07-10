#!/usr/bin/env python3
"""Bundle the multi-file RewindPix app into ONE self-contained `rewindpix.html`.

The 4 pages (gallery/develop/presets/roll-size) become a single hash-routed SPA: each page's
<main> is a view template, mounted one at a time (so per-page element IDs never collide), and its
per-page script runs on mount. Shared libs (camera.js/RP, zip.js/RPZip, develop.js/RPDev) load once.
CSS + icons + a curated LUT subset (data URIs) are inlined. The full 36-LUT set still loads if a
`luts/` folder sits beside the file (or it's on the camera SD).

Usage:  python build.py            -> writes rewindpix.html
"""
import base64, json, os, re
from pathlib import Path

D = Path(__file__).parent
SRC = D / "src"                   # multi-file app source lives here
OUT = D / "rewindpix.html"
LUT_BUDGET = 3_600_000            # ~3.6 MB of PNG -> ~4.8 MB base64 inlined


def read(name):
    return (SRC / name).read_text(encoding="utf-8")


def main_inner(html):
    m = re.search(r"<main[^>]*>(.*?)</main>", html, re.S)
    if not m:
        raise SystemExit("no <main> found")
    return m.group(1).strip()


def head_style(html):
    m = re.search(r"<style>(.*?)</style>", html, re.S)
    return m.group(1).strip() if m else ""


def inline_script(html):
    """The one <script> block without a src (a page's own logic)."""
    for attrs, body in re.findall(r"<script([^>]*)>(.*?)</script>", html, re.S):
        if "src" not in attrs and body.strip():
            return body.strip()
    raise SystemExit("no inline <script> found")


def b64(path):
    return base64.b64encode(path.read_bytes()).decode()


def js_str(s):
    """JSON-encode a string for safe embedding inside a <script> (escapes quotes/backticks/newlines,
    and neutralizes any </script> so it can't close the host block)."""
    return json.dumps(s).replace("</script", "<\\/script")


# ---- pages ----
idx, dev, pre, roll = read("index.html"), read("develop.html"), read("presets.html"), read("set-roll-size.html")

TPL = {
    "gallery": main_inner(idx),
    "develop": main_inner(dev),
    "presets": main_inner(pre),
    "roll": main_inner(roll),
}
JS = {
    "gallery": read("app.js"),
    "develop": inline_script(dev),
    "presets": read("presets-ui.js"),
    "roll": read("roll-size.js"),
}

# shared, loaded once (union of the pages' <script src=...> libs)
SHARED = "\n".join(read(f) for f in ("camera.js", "zip.js", "develop.js"))
CSS = "\n".join([read("style.css"), head_style(dev), head_style(pre)])

# ---- curated LUT subset (smallest first, up to the budget) ----
luts = sorted((SRC / "luts").glob("*.png"), key=lambda p: p.stat().st_size)
picked, total, RP_LUTS = [], 0, {}
for p in luts:
    sz = p.stat().st_size
    if total + sz > LUT_BUDGET:
        continue
    RP_LUTS[p.stem] = "data:image/png;base64," + b64(p)
    picked.append(p.stem); total += sz

ICON = b64(SRC / "icon-192.png")
MANIFEST = base64.b64encode(json.dumps({
    "name": "RewindPix", "short_name": "RewindPix", "start_url": ".", "display": "standalone",
    "background_color": "#0d0f12", "theme_color": "#12161b",
    "icons": [{"src": "data:image/png;base64," + ICON, "sizes": "192x192", "type": "image/png", "purpose": "any maskable"}],
}).encode()).decode()

doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RewindPix</title>
<meta name="theme-color" content="#12161b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="RewindPix">
<link rel="apple-touch-icon" href="data:image/png;base64,{ICON}">
<link rel="icon" href="data:image/png;base64,{ICON}">
<link rel="manifest" href="data:application/manifest+json;base64,{MANIFEST}">
<style>
{CSS}
#nav a.active {{ color:#fff; font-weight:600; }}
</style>
</head>
<body>
<header>
  <h1>RewindPix</h1>
  <div class="status-bar" id="status"></div>
  <span class="spacer"></span>
  <nav id="nav"><a href="#gallery">Gallery</a> · <a href="#develop">Develop</a> · <a href="#presets">Presets</a> · <a href="#roll">Roll size</a></nav>
  <button id="rp-update" title="Update the app from the GitHub repo (needs internet + camera WiFi)" style="margin-left:12px">⟳ Update</button>
</header>
<main id="app"></main>

<script>window.RP_SPA = true; window.RP_LUTS = {json.dumps(RP_LUTS)};</script>
<script>
{SHARED}
</script>
<script>
const TPL = {{ gallery: {js_str(TPL["gallery"])}, develop: {js_str(TPL["develop"])}, presets: {js_str(TPL["presets"])}, roll: {js_str(TPL["roll"])} }};
const JS  = {{ gallery: {js_str(JS["gallery"])}, develop: {js_str(JS["develop"])}, presets: {js_str(JS["presets"])}, roll: {js_str(JS["roll"])} }};
const VIEWS = ["gallery", "develop", "presets", "roll"];
const appEl = document.getElementById("app");
function show(v) {{
  appEl.innerHTML = TPL[v];
  document.getElementById("status").textContent = "";
  const s = document.createElement("script"); s.textContent = JS[v]; appEl.appendChild(s);
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + v));
}}
function route() {{ let v = (location.hash.replace(/^#/, "").split("?")[0]) || "gallery"; if (!VIEWS.includes(v)) v = "gallery"; show(v); }}
async function rpUpdate() {{
  const st = document.getElementById("status");
  const RAW = "https://raw.githubusercontent.com/chawasit/rewindpix-tools/main/rewindpix.html";
  const path = decodeURIComponent(location.pathname);
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const file = path.slice(path.lastIndexOf("/") + 1) || "rewindpix.html";
  if (dir === "/" && location.hostname === "192.168.1.254") {{ st.textContent = "Update needs the app in a SUBFOLDER (e.g. /RewindPix/) — the camera drops root uploads."; return; }}
  try {{
    st.textContent = "Update: fetching latest from GitHub…";
    const res = await fetch(RAW + "?t=" + Date.now(), {{ cache: "no-store" }});
    if (!res.ok) throw new Error("GitHub HTTP " + res.status);
    const blob = await res.blob();
    if (blob.size < 200000) throw new Error("downloaded file too small (" + blob.size + " B)");
    st.textContent = "Update: uploading " + (blob.size / 1048576).toFixed(1) + " MB to the camera…";
    const form = new FormData(); form.append("fileupload1", blob, file); form.append("upbtn", "Upload files");
    await fetch(dir, {{ method: "POST", body: form, cache: "no-store" }});
    st.textContent = "Updated \\u2713 (" + file + ") — reloading…"; setTimeout(() => location.reload(), 1200);
  }} catch (e) {{ st.textContent = "Update failed: " + e.message + " — need internet + the camera's WiFi at the same time."; }}
}}
document.getElementById("rp-update").onclick = rpUpdate;
addEventListener("hashchange", route); route();
</script>
</body>
</html>
"""

OUT.write_text(doc, encoding="utf-8", newline="\n")
print("wrote %s  (%.2f MB)" % (OUT.name, OUT.stat().st_size / 1048576))
print("inlined %d LUTs (%.2f MB PNG): %s" % (len(picked), total / 1048576, ", ".join(sorted(picked))))
