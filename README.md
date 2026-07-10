# RewindPix Tools

Small, dependency-free **browser app + tools** for the RewindPix camera
(**Novatek NT96565**, model PS135) over its local WiFi HTTP API.

Everything here is static HTML + vanilla JS (WebGL for develop), meant to be **run locally or served by
the camera itself over plain HTTP** (not HTTPS — see below). Installable as a standalone app via **Add to
Home Screen** (manifest + icons). The repo is source only; there's no hosted site.

**One-file build:** [`rewindpix.html`](rewindpix.html) is the whole app in a **single self-contained file**
(~1 MB) — the 4 tabs + CSS/JS/icons inlined, plus **3 fallback LUTs** so it works standalone. Open it and
go, no folder needed. With a `luts/` folder beside it (or on the camera SD) Develop gets all **36 LUTs**;
custom LUTs upload from Develop or Library. Rebuild with `python build.py`. Installed in a camera
**subfolder** (`A:\RewindPix\`), the header **⟳ Update** self-updates from GitHub, and **Library → Sync
LUTs** tops up the `luts/` folder (both need internet + the camera's WiFi at once — e.g. a phone on
cellular; root-level installs can't self-update since the camera drops root uploads).

> ⚠️ **Unofficial — use at your own risk.** These are community, reverse-engineered tools, **not**
> affiliated with or endorsed by the RewindPix vendor. They talk to the camera's undocumented local API.
> Some camera commands are destructive. No warranty; you are responsible for what you run against your device.

## Tools

| Tool | What it does |
|------|--------------|
| **[Gallery + Sync](src/index.html)** — `src/index.html` | The app home. Connect, browse photos by folder (**All · Current film · Original_Film · In_Camera_Mode**) with timestamp filters + pagination. **Tap a photo → fullscreen viewer** (swipe / arrows, Develop or Download). The **Current film** view shows the live roll's `._FILM` working copies, each **auto-previewed with the LUT named in its filename** (RAW badge when none matches). **Select** frames to download individually or as one ZIP. **Finish roll** twin-safely deletes the current-roll working copies and resets the frame budget. |
| [Develop](src/develop.html) | Apply a **film HALD-CLUT LUT** + 7 params (luminance, contrast, RGB gains, hue, saturation) in-browser (WebGL) with a **live processing indicator**, and export a full-res JPEG. Load a photo by **picking from the camera**, the gallery, or file upload; **upload your own LUT** (HALD `.png`). **Save to camera** writes to `DCIM/Developed_Photos` (verified via the `cmd=3015` catalog; falls back to a device download). |
| [Presets](src/presets.html) | Edit the camera's 3 **film** slots (names + 7 params) and 3 **in-camera** slots (override / keep-baked), **set the roll size** (frame budget), apply to the camera, and save presets. **Name a film slot after a LUT** (`LUT ▾` picker) so shots taken on that slot auto-preview with the matching LUT in the gallery. |
| [Library](src/library.html) | Manage **LUTs** — list bundled + custom, upload, delete, and **Sync LUTs from GitHub** into the camera's `luts/` (incremental). **Back up / restore presets** (export / import tokens, clear all). |

## Repo layout

- **`rewindpix.html`** — the built, shippable **single file** (open it, or install it on the camera SD).
- **`src/`** — multi-file source: the 4 pages (`index`/`develop`/`presets`/`library`.html) + JS (`camera.js`, `app.js`, `zip.js`, `develop.js`, `presets-ui.js`, `library.js`), `style.css`, icons, `manifest.webmanifest`, and `luts/` (36 HALD-CLUT PNGs).
- **`build.py`** — bundles `src/` → `rewindpix.html`. **`dev-server.py`** — local static server + camera proxy (`--mock` = no camera).

## How to use

1. Open the tool page.
2. **Connect** your phone / PC to the camera's WiFi.
3. Enter a value and click the action button.
4. Watch for **success** (green) or **error** (red).
5. **Disconnect** from the camera WiFi and use the camera as normal.

**Local development:** `python dev-server.py` serves the repo (the app at `/src/index.html`, the single
file at `/rewindpix.html`) **and** proxies the camera so it runs same-origin (join the camera's WiFi first);
`python dev-server.py --mock` runs it with canned data and
placeholder photos (no camera needed). In production the camera serves the files itself — no server.

## Running the tools (no HTTPS)

The camera API is **cleartext HTTP** at `http://192.168.1.254`. Browsers block requests from an **HTTPS**
page to an HTTP address ("mixed content") — so these tools are **not** hosted on GitHub Pages. Run them
over `file://` or `http://` instead (no HTTPS = no block). Pick one:

- **Download & open** — grab **[`rewindpix.html`](rewindpix.html)** (the single file) and open it over
  `file://` (desktop). Develop works standalone; other camera features need the camera served same-origin — use an option below.
- **Serve over HTTP** — from the folder run `python -m http.server 8000`, then open
  `http://localhost:8000/src/index.html` (or `http://<computer-ip>:8000/…` from another device on the WiFi).
- **Serve from the camera's SD card** — the camera's `hfs` server serves `A:\` over HTTP, so a `.html`
  copied onto the card loads at `http://192.168.1.254/…` — **same origin** as the API (no mixed content,
  no CORS; responses even readable). *Untested but promising.*

## Notes

- Tools are **fire-and-forget** where the camera returns no CORS headers — the request reaches the camera
  but the reply can't be read, so **verify the result on the camera's screen**.
- The camera is **single-client** and wedges under rapid-fire requests — one action at a time.
- **Install as an app:** open it from the camera's WiFi, then use your browser's **Add to Home Screen** — it
  runs standalone (manifest + icons). No offline cache: the camera's LAN IP isn't a secure context, so a
  service worker can't register (and there's nothing to serve offline anyway — the camera is the backend).
- Full protocol reference: **[RewindPix / NT96565 WiFi API notes](https://gist.github.com/chawasit/6b3912419dd7600c90361d8231757d79)**.

## The camera as a host (HFS)

With an SD card inserted, **`http://192.168.1.254/`** is the camera's **HFS file browser** (`hfs/1.00.000`):
it **lists the SD**, **serves any file by path** (that's how a tool runs — e.g. `/index.html`, confirmed),
shows per-file **Remove** links (`?del=1`), and renders **file-upload forms**. A tool copied to the SD root
is served at `http://192.168.1.254/<file>.html` — **same origin** as the camera API, so `fetch` has no CORS
or mixed-content limits and can read responses.

**Deploying a tool onto the camera:**
- **USB (reliable):** mount the SD on a PC, copy the tool's files to the card **root**, safely eject, then
  **power-cycle the camera** (it re-mounts + re-indexes the card), and open the URL over the camera's WiFi.
- **HFS upload — works into `DCIM/` (corrected 2026-07-09):** a multipart POST (field `fileupload1`, file
  part first) to a `/DCIM/…` path **persists** — the file lands with the right size in the `cmd=3015`
  catalog and any missing subfolder (e.g. `Developed_Photos`) auto-creates. Two caveats: **root uploads are
  dropped** (`200` but no write), and a just-uploaded file's **HTTP GET serves 0 bytes until the camera
  re-indexes** (power-cycle) — so confirm a write via the catalog, never a readback. `?del=1` deletes (confirmed).
- **Gotcha:** right after a USB session the camera shows an empty file list / free-space error until it's
  power-cycled; that's expected, not data loss.

## License

**WTFPL** — see [LICENSE](LICENSE). Do what the fuck you want to.
