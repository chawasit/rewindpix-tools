/* RewindPix camera client — plain global `RP`, no build step.
 * SERIALIZED: the camera is single-client and wedges under concurrency, so every command goes
 * through one queue with spacing. Same-origin by default (works when served from the camera SD);
 * set a base for local/proxy dev. */
(function () {
  const RP = (window.RP = {});
  let base = "";                                  // "" = same-origin (camera-hosted)
  RP.setBase = (b) => { base = (b || "").replace(/\/+$/, ""); };
  RP.base = () => base;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SPACING_MS = 120;

  // one-at-a-time queue (commands AND blob downloads share it — single client)
  let chain = Promise.resolve();
  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(() => sleep(SPACING_MS), () => sleep(SPACING_MS));
    return run;
  }

  function encodeCam(v) {
    return String(v).split("").map((c) =>
      /[A-Za-z0-9\-_.~:]/.test(c) ? c : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
    ).join("");
  }
  const tag = (xml, t) => { const m = xml.match(new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">")); return m ? m[1] : null; };
  const tagsAll = (xml, t) => [...xml.matchAll(new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">", "g"))].map((m) => m[1]);
  RP.tag = tag;

  /* Raw command → response text. opts: {par} or {str}. */
  RP.cmd = (n, opts = {}) => enqueue(async () => {
    let url = base + "/?custom=1&cmd=" + n;
    if (opts.par != null) url += "&par=" + opts.par;
    if (opts.str != null) url += "&str=" + encodeCam(opts.str);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("cmd " + n + " → HTTP " + res.status);
    return res.text();
  });

  RP.ackOk = (xml) => { const s = tag(xml, "Status"); return s === "0" || s === null; };

  // ---- reads ----
  RP.firmware = async () => tag(await RP.cmd(3012), "String");
  RP.model = async () => tag(await RP.cmd(8018), "String");
  RP.freeFrames = async () => { const v = tag(await RP.cmd(1003), "Value"); return v == null ? null : +v; };
  RP.freeSpace = async () => { const v = tag(await RP.cmd(3017), "Value"); return v == null ? null : +v; };
  RP.cardStatus = async () => { const v = tag(await RP.cmd(3024), "Value"); return v == null ? null : +v; };

  RP.status = async () => {
    const xml = await RP.cmd(3014);
    const cmds = tagsAll(xml, "Cmd"), sts = tagsAll(xml, "Status");
    const map = {}; cmds.forEach((c, i) => (map[c] = sts[i]));
    return { raw: map, maxPhotos: map["8004"] != null ? +map["8004"] : null };
  };

  const FOLDER = (fp) => { const p = fp.split("\\"); return p[p.length - 2] || ""; };
  RP.listFiles = async () => tagsAll(await RP.cmd(3015), "File").map((b) => {
    const fpath = tag(b, "FPATH") || "";
    return {
      name: tag(b, "NAME") || "", fpath, folder: FOLDER(fpath),
      size: +(tag(b, "SIZE") || 0), timecode: +(tag(b, "TIMECODE") || 0), time: tag(b, "TIME") || "",
    };
  });

  RP.urlFor = (fpath) => base + "/" + fpath.replace(/^A:/i, "").replace(/\\/g, "/").replace(/^\/+/, "");
  RP.downloadBlob = (fpath) => enqueue(async () => {
    const res = await fetch(RP.urlFor(fpath), { cache: "no-store" });
    if (!res.ok) throw new Error("download → HTTP " + res.status);
    return res.blob();
  });

  // ---- writes ----
  RP.setMaxPhotos = (n) => RP.cmd(8004, { par: n });

  // ---- slots (for the preset editor, phase 3) ----
  RP.PARAM_FIELDS = ["LUM", "CONTRAST", "RGAIN", "GGAIN", "BGAIN", "HUE", "SAT"];
  RP.getSlotNames = async () => { const x = await RP.cmd(8003); return [tag(x, "FILM_FILTER_C1"), tag(x, "FILM_FILTER_C2"), tag(x, "FILM_FILTER_C3")]; };
  RP.getParams = async (getCmd) => { const x = await RP.cmd(getCmd); return RP.PARAM_FIELDS.map((f) => +(tag(x, f) || 0)); };
  RP.FILM = { names: 8002, get: [8013, 8015, 8017], set: [8012, 8014, 8016] };
  RP.INCAM = { get: [8007, 8009, 8011], set: [8006, 8008, 8010] };

  /* Sync seen-set: FPATH-keyed in localStorage. We skip `._FILM` (a byte-dup of Original_Film) so the
   * twin-dup problem is avoided without content hashing — handy since crypto.subtle isn't available on
   * the camera's plain-HTTP origin. */
  const SEEN_KEY = "rp_synced_fpaths";
  RP.seen = () => new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  RP.markSeen = (fpaths) => { const s = RP.seen(); fpaths.forEach((f) => s.add(f)); localStorage.setItem(SEEN_KEY, JSON.stringify([...s])); };
  RP.resetSeen = () => localStorage.removeItem(SEEN_KEY);

  /* Photos to sync: Original_Film + In_Camera_Mode, skipping ._FILM. */
  RP.syncableFiles = (files) => files.filter((f) => f.folder === "Original_Film" || f.folder === "In_Camera_Mode");
})();
