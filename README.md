# RewindPix Tools

Small, dependency-free **browser tools + scripts** for the RewindPix camera
(**Novatek NT96565**, model PS135) over its local WiFi HTTP API.

Everything here is static HTML + vanilla JS, meant to be **run locally or self-hosted over plain HTTP**
(not HTTPS — see below). The repo is source only; there's no hosted site.

> ⚠️ **Unofficial — use at your own risk.** These are community, reverse-engineered tools, **not**
> affiliated with or endorsed by the RewindPix vendor. They talk to the camera's undocumented local API.
> Some camera commands are destructive. No warranty; you are responsible for what you run against your device.

## Tools

| Tool | What it does |
|------|--------------|
| [Set roll size](set-roll-size.html) | Sets the frame budget (max photos) to any number (`cmd=8004`). Default 99; `0` clears the roll. |

## How to use

1. Open the tool page.
2. **Connect** your phone / PC to the camera's WiFi.
3. Enter a value and click the action button.
4. Watch for **success** (green) or **error** (red).
5. **Disconnect** from the camera WiFi and use the camera as normal.

## Running the tools (no HTTPS)

The camera API is **cleartext HTTP** at `http://192.168.1.254`. Browsers block requests from an **HTTPS**
page to an HTTP address ("mixed content") — so these tools are **not** hosted on GitHub Pages. Run them
over `file://` or `http://` instead (no HTTPS = no block). Pick one:

- **Download & open the file** — grab a tool's `.html` (there's a download link on each tool) and open it
  (`file://`). Works on desktop.
- **Serve over HTTP** — from the folder run `python -m http.server 8000`, then open
  `http://localhost:8000/set-roll-size.html` (or `http://<computer-ip>:8000/…` from another device on the WiFi).
- **Serve from the camera's SD card** — the camera's `hfs` server serves `A:\` over HTTP, so a `.html`
  copied onto the card loads at `http://192.168.1.254/…` — **same origin** as the API (no mixed content,
  no CORS; responses even readable). *Untested but promising.*

## Notes

- Tools are **fire-and-forget** where the camera returns no CORS headers — the request reaches the camera
  but the reply can't be read, so **verify the result on the camera's screen**.
- The camera is **single-client** and wedges under rapid-fire requests — one action at a time.
- Full protocol reference: **[RewindPix / NT96565 WiFi API notes](https://gist.github.com/chawasit/6b3912419dd7600c90361d8231757d79)**.
