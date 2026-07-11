# RewindPix Tools

Small, dependency-free **browser app + tools** for the **RewindPix** film-emulation camera
(**Novatek NT96565**, model PS135) — a community, open-source **alternative to the official RewindPix
app** that talks to the camera over its local WiFi HTTP API. From any phone or computer (no app install):
browse and **download your photos**, **develop the film look** in-browser with the camera's LUTs, and
**unlock the film roll size** past the stock 36-frame limit.

Everything here is static HTML + vanilla JS (WebGL for develop), meant to be **run locally or served by
the camera itself over plain HTTP** (not HTTPS — see below). Installable as a standalone app via **Add to
Home Screen** (manifest + icons). The repo is source only; there's no hosted site.

**One-file build:** [`rewindpix.html`](rewindpix.html) is the whole app in a **single self-contained file**
(~1 MB) — the 4 tabs + CSS/JS/icons inlined, plus **3 fallback LUTs** so it works standalone. Open it and
go, no folder needed. With a `luts/` folder beside it (or on the camera SD) Develop gets all **36 LUTs**;
custom LUTs upload from Develop or Library. Rebuild with `python build.py`. Installed in a camera
**subfolder** (`A:\RewindPix\`), the header **⟳ Update** self-updates from GitHub in **two steps** — tap it
to **download** the latest (needs internet), then **reconnect to the camera's WiFi** and tap **⤒ Finish
update** to upload it, so you never need both networks at once. **Library → Sync LUTs** tops up the `luts/`
folder (that one still needs internet + the camera's WiFi together — e.g. a phone on cellular). Root-level
installs can't self-update since the camera drops root uploads.

> ⚠️ **Unofficial — use at your own risk.** These are community, reverse-engineered tools, **not**
> affiliated with or endorsed by the RewindPix vendor. They talk to the camera's undocumented local API.
> Some camera commands are destructive. No warranty; you are responsible for what you run against your device.

## What it's for

- **Unofficial alternative / replacement for the RewindPix app** — join the camera's WiFi and browse,
  preview, and **download your photos** (one, multi-select, or the whole roll as a ZIP) from a phone or
  laptop — no Android app required.
- **Unlock the max film roll size** — the official app caps a roll at **36 frames**; the **Presets** tab
  sets the camera's frame budget (*max photos*) to **any value you enter** (`cmd=8004`; quick-set
  24/36/99, `0` clears the roll), so you can shoot **longer rolls than the app allows**.
- **Develop the film look yourself** — apply any of the **36 built-in film HALD-CLUT LUTs** (or your own)
  plus the 7 colour params in the browser (WebGL), and save back to the camera or your device.
- **Edit film slots & presets** — rename the 3 film / 3 in-camera slots, tune params, save/restore
  preset collections, and name a slot after a LUT for auto-preview.
- **Set the camera clock** — the camera has **no on-screen menu** and the official app never sets its
  date/time, so shots can be stamped with a wrong/reset clock. The **Presets** tab pushes your device's
  current date + time (or a value you enter) to the camera's RTC (`cmd=3005`/`3006`) — the only known way
  to fix it (discovered here; verified live).

## Tools

| Tool | What it does |
|------|--------------|
| **[Gallery + Sync](src/index.html)** — `src/index.html` | The app home. Connect, browse photos by folder (**All · Current film · Original_Film · In_Camera_Mode**) with timestamp filters + pagination. **Tap a photo → fullscreen viewer** (swipe / arrows, Develop or Download). The **Current film** view shows the live roll's `._FILM` working copies, each **auto-previewed with the LUT named in its filename** (RAW badge when none matches). **Select** frames to **download** (individually or as one ZIP) or **delete** them (with a confirm). **Finish roll** twin-safely deletes the current-roll working copies and resets the frame budget. |
| [Develop](src/develop.html) | Apply a **film HALD-CLUT LUT** + 7 params (luminance, contrast, RGB gains, hue, saturation) in-browser (WebGL) with a **live processing indicator**, plus post-process **denoise**, **film grain**, and a burned-in **date+time stamp** (seven-segment LCD, auto-filled from the shot's timestamp); export a full-res JPEG. Load a photo by **picking from the camera**, the gallery, or file upload; a camera photo whose filename embeds a LUT name (e.g. `…GLVIVID_0003.JPG`) **auto-selects that LUT on load**. **Upload your own LUT** (HALD `.png`). **Save to camera** writes to `DCIM/Developed_Photos` (verified via the `cmd=3015` catalog; falls back to a device download). |
| [Presets](src/presets.html) | Edit the camera's 3 **film** slots (names + 7 params) and 3 **in-camera** slots (override / keep-baked), **set the roll size** (frame budget), **set the camera clock** (push your device's date/time — `cmd=3005/3006`; the only way, since the camera has no menu and the app never does it), apply to the camera, and save presets. **Name a film slot after a LUT** (`LUT ▾` picker) so shots taken on that slot auto-preview with the matching LUT in the gallery. Every slot shows a live **Example** — pick the **Example photo**: a **colour chart** (default), a bundled sample, or **choose one from the gallery** (camera shot); LUT-named slots get a **↺ defaults** button that resets the 7 params (official LUTs are tuned for defaults). |
| [Library](src/library.html) | Manage **LUTs** — list bundled (with the official **preview thumbnail**) + custom, upload, delete, and **Sync LUTs from GitHub** into the camera's `luts/` (incremental). **Back up / restore presets** (export / import tokens, clear all). |

## Repo layout

- **`rewindpix.html`** — the built, shippable **single file** (open it, or install it on the camera SD).
- **`src/`** — multi-file source: the 4 pages (`index`/`develop`/`presets`/`library`.html) + JS (`camera.js`, `app.js`, `zip.js`, `develop.js`, `presets-ui.js`, `library.js`), `style.css`, icons, `manifest.webmanifest`, and `luts/` (36 HALD-CLUT PNGs).
- **`build.py`** — bundles `src/` → `rewindpix.html`. **`dev-server.py`** — local static server + camera proxy (`--mock` = no camera).

## How to use

*The everyday way — you just want to use your camera. The whole app is one file, `rewindpix.html`.*

1. **Put the app on your camera.** Turn the camera off, take out the SD card, and plug it into your
   computer. Make a folder called **`RewindPix`** on the card and copy **`rewindpix.html`** into it (so
   it's at `RewindPix/rewindpix.html`). For all 36 film looks, also copy the **`luts`** folder in next to
   it. Eject the card, put it back in the camera, and turn the camera on.
2. **Connect your phone to the camera's WiFi.** Turn on the camera's WiFi (the same one the official
   RewindPix app uses), then on your phone open WiFi settings and join the camera's network.
3. **Open the app.** In your phone's browser, go to
   **`http://192.168.1.254/RewindPix/rewindpix.html`**. *(Tip: use your browser's **Add to Home Screen**
   so it opens like a normal app next time.)*
4. **Browse and save your photos.** **Gallery** shows your shots — tap one to see it full-screen, then
   **Download ⤓** to save it to your phone. Use **Select** to grab several at once, or **Download all**
   for the whole roll.
5. **Give a photo the film look.** Tap **Develop**, choose a film, then **Save** (back to the camera) or
   **Export** (to your phone).
6. **Shoot a longer roll than 36 frames.** Open **Presets → Roll size**, type how many frames you want,
   and tap **Set roll size** (`0` clears the roll).
7. **When you're done,** disconnect your phone from the camera's WiFi and use the camera as usual.

> **Just want to try the film looks?** Download **[`rewindpix.html`](rewindpix.html)** and open it on your
> computer — **Develop** works on its own (upload any photo). The camera features (Gallery, Save to
> camera, Presets) need the steps above.

## For developers

- **Run locally:** `python dev-server.py` serves the repo (app at `/src/index.html`, single file at
  `/rewindpix.html`) **and** proxies the camera so everything is same-origin (join the camera's WiFi
  first). `python dev-server.py --mock` runs with canned data + placeholder photos — **no camera needed**.
- **Or a plain static server:** `python -m http.server 8000`, then open `http://localhost:8000/src/index.html`
  (or `http://<your-computer-ip>:8000/…` from another device on the same WiFi).
- **No HTTPS, by design:** the camera API is cleartext `http://192.168.1.254`, and browsers block an
  HTTPS page from calling an HTTP address ("mixed content") — so the tools run over `file://` or `http://`,
  never HTTPS (that's also why there's no GitHub Pages site). Served from the camera's SD they're
  **same-origin** as the API, so `fetch` has no CORS or mixed-content limits.
- **Build the single file:** `python build.py` bundles `src/` → `rewindpix.html`.
- **Tests:** `npm test` (or `node --test`) runs a **hermetic** suite (Node's built-in runner, no deps,
  no camera/server/browser) in `test/` — it loads `camera.js`/`zip.js`/`develop.js` in a `vm` sandbox
  against an in-process mock camera and checks the command encoding, XML parsers, the confirmed
  wire-sequences (clock-set `3005`→`3006`, delete, roll, sync), ZIP structure, and the LUT catalog.
  `dev-server.py --mock` is the matching **stateful** mock for manual/browser QA.
- **Deploy onto the camera** (USB vs HFS upload, the power-cycle re-index) is detailed in
  [The camera as a host](#the-camera-as-a-host-hfs) below.

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

**Credits:** the date-stamp uses **[DSEG](https://github.com/keshikan/DSEG)** (DSEG7 Classic) by keshikan, under the **SIL Open Font License 1.1** — see [OFL-DSEG.txt](OFL-DSEG.txt).

---
_Keywords: RewindPix app alternative · RewindPix app replacement · download RewindPix photos over WiFi ·
unlock RewindPix film roll size · remove the 36-frame roll limit · Novatek NT96565 / PS135 camera API ·
in-browser film LUT develop · reverse-engineered RewindPix tools._
