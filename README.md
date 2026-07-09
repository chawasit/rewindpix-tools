# RewindPix Tools

Small, dependency-free **browser tools + scripts** for the RewindPix camera
(**Novatek NT96565**, model PS135) over its local WiFi HTTP API.

Everything here is static HTML + vanilla JS, meant to be hosted on **GitHub Pages** or opened locally.

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

## ⚠️ HTTP vs HTTPS (important)

The camera API is **cleartext HTTP** at `http://192.168.1.254`. Browsers block requests from an
**HTTPS** page (e.g. the GitHub Pages URL) to an HTTP address ("mixed content"). So to actually reach
the camera, do one of:

- **Open the tool as a local file** (download the `.html` and open it), or serve it over `http://`.
- Or on the Pages URL, allow **"Insecure content"** for the site in your browser's site settings.

The page loads fine either way; only the request to the camera is what browsers gate.

## Notes

- Tools are **fire-and-forget** where the camera returns no CORS headers — the request reaches the camera
  but the reply can't be read, so **verify the result on the camera's screen**.
- The camera is **single-client** and wedges under rapid-fire requests — one action at a time.
- Full protocol reference: **[RewindPix / NT96565 WiFi API notes](https://gist.github.com/chawasit/6b3912419dd7600c90361d8231757d79)**.
