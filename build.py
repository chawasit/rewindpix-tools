#!/usr/bin/env python3
"""Bundle the multi-file RewindPix app into ONE self-contained `rewindpix.html`.

The 4 pages (gallery/develop/presets/roll-size) become a single hash-routed SPA: each page's
<main> is a view template, mounted one at a time (so per-page element IDs never collide), and its
per-page script runs on mount. Shared libs (camera.js/RP, zip.js/RPZip, develop.js/RPDev) load once.
CSS + icons + a curated LUT subset (data URIs) are inlined. The full 36-LUT set still loads if a
`luts/` folder sits beside the file (or it's on the camera SD).

Usage:  python build.py            -> writes rewindpix.html
"""
import base64, datetime, json, os, re
from pathlib import Path

D = Path(__file__).parent
SRC = D / "src"                   # multi-file app source lives here
OUT = D / "rewindpix.html"
VERSION = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")   # build stamp shown next to ⟳ Update


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
idx, dev, pre, lib = read("index.html"), read("develop.html"), read("presets.html"), read("library.html")

TPL = {
    "gallery": main_inner(idx),
    "develop": main_inner(dev),
    "presets": main_inner(pre),
    "library": main_inner(lib),
}
JS = {
    "gallery": read("app.js"),
    "develop": inline_script(dev),
    "presets": read("presets-ui.js"),
    "library": read("library.js"),
}

# shared, loaded once (union of the pages' <script src=...> libs)
SHARED = "\n".join(read(f) for f in ("camera.js", "zip.js", "develop.js", "nav.js"))
CSS = "\n".join([read("style.css"), head_style(dev), head_style(pre), head_style(lib)])

# ---- a few representative LUTs inlined as a fallback so a lone rewindpix.html still has looks;
# the full 36-set loads from the luts/ folder (camera SD / beside the file) or via Library → Sync LUTs.
FALLBACK = ["GLVIVID", "BWHC", "C41"]
picked, total, RP_LUTS = [], 0, {}
for name in FALLBACK:
    p = SRC / "luts" / (name + ".png")
    if not p.exists():
        continue
    RP_LUTS[name] = "data:image/png;base64," + b64(p)
    picked.append(name); total += p.stat().st_size

# ---- sample photos for the Presets "Example" (small JPEGs downscaled from the src/samples RAW originals) ----
RP_SAMPLES, samp_total = {}, 0
_sj = SRC / "samples" / "samples.json"
if _sj.exists():
    for s in json.loads(_sj.read_text(encoding="utf-8")).get("samples", []):
        sp = SRC / "samples" / s["file"]
        if sp.exists():
            RP_SAMPLES[s["name"]] = "data:image/jpeg;base64," + b64(sp); samp_total += sp.stat().st_size

# ---- official LUT preview thumbnails inlined so the Library shows them in the single-file build too ----
RP_PREVIEWS, prev_total = {}, 0
_pd = SRC / "previews"
if _pd.is_dir():
    for pp in sorted(_pd.glob("*.jpg")):
        RP_PREVIEWS[pp.stem] = "data:image/jpeg;base64," + b64(pp); prev_total += pp.stat().st_size

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
  <span title="build version — updates on ⟳ Update" style="font-size:.7rem;color:#7b848f;font-family:ui-monospace,Menlo,monospace;margin-right:8px">v{VERSION}</span>
  <button id="rp-update" title="Update in 2 steps: 1) download the latest from GitHub (needs internet), 2) reconnect to the camera's WiFi and upload" style="margin-left:12px">⟳ Update</button>
</header>
<main id="app"></main>

<script>window.RP_SPA = true; window.RP_LUTS = {json.dumps(RP_LUTS)}; window.RP_SAMPLES = {json.dumps(RP_SAMPLES)}; window.RP_PREVIEWS = {json.dumps(RP_PREVIEWS)};</script>
<script>
{SHARED}
</script>
<script>
const TPL = {{ gallery: {js_str(TPL["gallery"])}, develop: {js_str(TPL["develop"])}, presets: {js_str(TPL["presets"])}, library: {js_str(TPL["library"])} }};
const JS  = {{ gallery: {js_str(JS["gallery"])}, develop: {js_str(JS["develop"])}, presets: {js_str(JS["presets"])}, library: {js_str(JS["library"])} }};
const VIEWS = ["gallery", "develop", "presets", "library"];
const appEl = document.getElementById("app");
function show(v) {{
  appEl.innerHTML = TPL[v];
  document.getElementById("status").textContent = "";
  const s = document.createElement("script"); s.textContent = JS[v]; appEl.appendChild(s);
  if (window.RPNav) window.RPNav(v);
}}
function route() {{ let v = (location.hash.replace(/^#/, "").split("?")[0]) || "gallery"; if (!VIEWS.includes(v)) v = "gallery"; show(v); }}
let rpPending = null;   // downloaded copy held in memory across a WiFi switch (the page isn't reloaded)
async function rpUpdate() {{
  const st = document.getElementById("status");
  const btn = document.getElementById("rp-update");
  const path = decodeURIComponent(location.pathname);
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const file = path.slice(path.lastIndexOf("/") + 1) || "rewindpix.html";
  if (location.hostname === "192.168.1.254" && dir === "/") {{ st.textContent = "Update needs the app in a SUBFOLDER (e.g. /RewindPix/) \\u2014 the camera drops root uploads."; return; }}
  if (!rpPending) {{
    // ---- step 1: download the latest from GitHub (needs internet) ----
    const RAW = "https://raw.githubusercontent.com/chawasit/rewindpix-tools/main/rewindpix.html";
    try {{
      st.textContent = "Update 1/2: downloading the latest from GitHub\\u2026 (needs internet)";
      const res = await fetch(RAW + "?t=" + Date.now(), {{ cache: "no-store" }});
      if (!res.ok) throw new Error("GitHub HTTP " + res.status);
      const blob = await res.blob();
      if (blob.size < 200000) throw new Error("file too small (" + blob.size + " B)");
      rpPending = {{ blob, file }};
      btn.textContent = "\\u2912 Finish update";
      st.textContent = "Downloaded " + (blob.size / 1048576).toFixed(1) + " MB \\u2713 \\u2014 now reconnect to the CAMERA's WiFi, then tap \\u2912 Finish update.";
    }} catch (e) {{ st.textContent = "Download failed: " + e.message + " \\u2014 get on the internet first (cellular / home WiFi), then tap \\u21bb Update."; }}
  }} else {{
    // ---- step 2: upload the downloaded copy to the camera (needs the camera's WiFi) ----
    try {{
      st.textContent = "Update 2/2: uploading " + (rpPending.blob.size / 1048576).toFixed(1) + " MB to the camera\\u2026";
      const form = new FormData(); form.append("fileupload1", rpPending.blob, rpPending.file); form.append("upbtn", "Upload files");
      await fetch(dir, {{ method: "POST", body: form, cache: "no-store" }});
      st.textContent = "Updated \\u2713 (" + rpPending.file + ") \\u2014 reloading\\u2026";
      rpPending = null;
      setTimeout(() => location.reload(), 1200);
    }} catch (e) {{ st.textContent = "Upload failed: " + e.message + " \\u2014 make sure you're back on the CAMERA's WiFi, then tap \\u2912 Finish update again."; }}
  }}
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
print("inlined %d sample photos (%.0f KB)" % (len(RP_SAMPLES), samp_total / 1024))
print("inlined %d LUT previews (%.0f KB)" % (len(RP_PREVIEWS), prev_total / 1024))
