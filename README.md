# RewindPix Tools

Small, dependency-free **browser app + tools** for the RewindPix camera
(**Novatek NT96565**, model PS135) over its local WiFi HTTP API.

Everything here is static HTML + vanilla JS (WebGL for develop), meant to be **run locally or served by
the camera itself over plain HTTP** (not HTTPS — see below). Installable as a standalone app via **Add to
Home Screen** (manifest + icons). The repo is source only; there's no hosted site.

**One-file build:** [`rewindpix.html`](rewindpix.html) is the whole app in a **single self-contained file**
(all 4 views + CSS/JS/icons + a curated ~3.4 MB LUT subset inlined) — download it and open it, no folder
needed. Develop works standalone (inlined LUTs + upload); with a `luts/` folder beside it (or on the camera
SD) it loads all 36 LUTs and every camera feature. Rebuild it with `python build.py`. Installed in a camera
**subfolder** (`A:\RewindPix\`), the header **⟳ Update** fetches the latest `rewindpix.html` from GitHub and
rewrites itself on the SD (needs internet + the camera's WiFi at once — e.g. a phone on cellular; root-level
installs can't self-update since the camera drops root uploads).

> ⚠️ **Unofficial — use at your own risk.** These are community, reverse-engineered tools, **not**
> affiliated with or endorsed by the RewindPix vendor. They talk to the camera's undocumented local API.
> Some camera commands are destructive. No warranty; you are responsible for what you run against your device.

## Tools

| Tool | What it does |
|------|--------------|
| **[Gallery + Sync](index.html)** — `index.html` | The app home. Connect to the camera, browse photos by folder, see what's new since last sync, download shots individually, **download the whole roll as one ZIP** (fetched serialized, packaged in-browser), or send a photo to **Develop**. Serialized single-client client; skips the `._FILM` duplicate. |
| [Develop](develop.html) | Apply any of the **36 bundled film HALD-CLUT LUTs** + 7 params (luminance, contrast, RGB gains, hue, saturation) to a photo in-browser (WebGL), preview live, and export a full-resolution JPEG. Load a photo by **picking one from the camera**, from the gallery (`?photo=`), or a file upload. **Save to camera** writes the result to `DCIM/Developed_Photos` (folder auto-created; verified live via the `cmd=3015` catalog); the camera re-serves it over WiFi only after a re-index / power-cycle, and it falls back to a device download if the write can't be confirmed. |
| [Presets](presets.html) | Edit the camera's 3 **film** slots (names + 7 params) and 3 **in-camera** slots (params only, with an override / keep-baked toggle), apply them to the camera, and save / import / export a preset collection. |
| [Set roll size](set-roll-size.html) | Sets the frame budget (max photos) to any number (`cmd=8004`). Default 99; `0` clears the roll. |

## How to use

1. Open the tool page.
2. **Connect** your phone / PC to the camera's WiFi.
3. Enter a value and click the action button.
4. Watch for **success** (green) or **error** (red).
5. **Disconnect** from the camera WiFi and use the camera as normal.

**Local development:** `python dev-server.py` serves the app **and** proxies the camera so it runs
same-origin (join the camera's WiFi first); `python dev-server.py --mock` runs it with canned data and
placeholder photos (no camera needed). In production the camera serves the files itself — no server.

## Running the tools (no HTTPS)

The camera API is **cleartext HTTP** at `http://192.168.1.254`. Browsers block requests from an **HTTPS**
page to an HTTP address ("mixed content") — so these tools are **not** hosted on GitHub Pages. Run them
over `file://` or `http://` instead (no HTTPS = no block). Pick one:

- **Download & open** — download the repo (**Code → Download ZIP**), unzip, and open `index.html` over
  `file://` (desktop). Camera features need the camera served same-origin — use an option below.
- **Serve over HTTP** — from the folder run `python -m http.server 8000`, then open
  `http://localhost:8000/set-roll-size.html` (or `http://<computer-ip>:8000/…` from another device on the WiFi).
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
