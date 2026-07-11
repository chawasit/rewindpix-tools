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
  /* Queue a complete camera transaction. The thunk MUST consume any response body before returning
   * a plain result; returning a live Response releases the slot while its body may still be reading. */
  RP.enqueue = (task) => enqueue(async () => await task());

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

  // A genuine write-ack is a well-formed <Function>…</Function> doc with exactly one <Status>0</Status>.
  // Requiring the matching root + terminal tag (no trailing content) and a single Status rejects an empty/
  // HTML/garbage or truncated body that merely embeds a <Status>0</Status> (spoof / MITM / partial read).
  RP.ackOk = (xml) => {
    if (typeof xml !== "string") return false;
    const s = xml.trim().replace(/^<\?xml[^>]*\?>\s*/i, "");
    if (!/^<Function[\s>][\s\S]*<\/Function>$/i.test(s)) return false;   // fast reject: non-Function root / trailing content
    if (typeof DOMParser !== "undefined") {                             // real parse in the browser (rejects mismatched/malformed nesting)
      try {
        const doc = new DOMParser().parseFromString(s, "application/xml");
        if (doc.getElementsByTagName("parsererror").length) return false;
        const st = doc.getElementsByTagName("Status");
        return !!doc.documentElement && doc.documentElement.nodeName === "Function" && st.length === 1 && st[0].textContent.trim() === "0";
      } catch (e) { return false; }
    }
    const statuses = s.match(/<Status>\s*[^<]*\s*<\/Status>/gi) || [];  // Node/VM fallback (no DOMParser)
    return statuses.length === 1 && /<Status>\s*0\s*<\/Status>/i.test(statuses[0]);
  };

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

  RP.urlFor = (fpath) => {
    if (typeof fpath !== "string" || !/^A:\\/i.test(fpath)) throw new TypeError("invalid camera path");
    const segments = fpath.slice(3).split(/[\\/]/);
    if (!segments.length || segments.some((part) => !part || part === "." || part === "..")) throw new TypeError("invalid camera path");
    return base + "/" + segments.map(encodeURIComponent).join("/");
  };
  RP.imageBlob = (fpath, isCurrent) => enqueue(async () => {
    if (isCurrent && !isCurrent()) throw new Error("image request cancelled");
    const res = await fetch(RP.urlFor(fpath), { cache: "no-store" });
    if (!res.ok) throw new Error("download → HTTP " + res.status);
    return res.blob();
  });
  RP.downloadBlob = RP.imageBlob;

  // ---- writes ----
  RP.setMaxPhotos = (n) => RP.cmd(8004, { par: n });
  RP.deleteFile = (fpath) => RP.cmd(4003, { str: fpath });   // NVTIPC DELETE_FILE; str = full A:\ path

  /* Set the camera RTC over WiFi (the official app never does this; the camera has no clock menu).
   * cmd=3005 sets the DATE and zeroes time-of-day, so cmd=3006 (time) MUST follow. Confirmed live. */
  RP.setDate = (ymd) => RP.cmd(3005, { str: ymd });   // "YYYY-MM-DD"
  RP.setTime = (hms) => RP.cmd(3006, { str: hms });   // "HH:MM:SS"
  RP.setClock = async (d = new Date()) => {
    const p = (n) => String(n).padStart(2, "0");
    const date = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    const time = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    const dr = await RP.setDate(date); const tr = await RP.setTime(time);   // order matters (3005 then 3006)
    return { date, time, ok: RP.ackOk(dr) && RP.ackOk(tr) };
  };

  /* Write a developed JPEG back to the camera under DCIM/Developed_Photos, via the camera's HFS
   * multipart form (field `fileupload1`, file part FIRST — matches the on-device form; the folder
   * auto-creates). Verified live: the file lands with the correct size in the cmd=3015 catalog.
   * A just-uploaded file's HTTP GET serves 0 bytes until the camera re-indexes (power-cycle), so we
   * verify via the CATALOG, never an HTTP readback. Root-level uploads are dropped — only DCIM persists. */
  RP.uploadDeveloped = async (name, blob) => {
    const dir = "DCIM/Developed_Photos";
    await enqueue(async () => {
      const form = new FormData();
      form.append("fileupload1", blob, name);   // file part must come first
      form.append("upbtn", "Upload files");
      try { await fetch(base + "/" + dir + "/", { method: "POST", body: form, cache: "no-store" }); } catch (e) { /* catalog check is the real test */ }
    });
    try {
      const hit = (await RP.listFiles()).find((f) => f.folder === "Developed_Photos" && f.name === name);
      return { ok: !!hit && hit.size > 0, url: dir + "/" + name, size: hit ? hit.size : 0 };
    } catch (e) { return { ok: false, url: dir + "/" + name }; }
  };

  // ---- slots (for the preset editor, phase 3) ----
  RP.PARAM_FIELDS = ["LUM", "CONTRAST", "RGAIN", "GGAIN", "BGAIN", "HUE", "SAT"];
  RP.getSlotNames = async () => { const x = await RP.cmd(8003); return [tag(x, "FILM_FILTER_C1"), tag(x, "FILM_FILTER_C2"), tag(x, "FILM_FILTER_C3")]; };
  RP.getParams = async (getCmd) => { const x = await RP.cmd(getCmd); return RP.PARAM_FIELDS.map((f) => +(tag(x, f) || 0)); };
  RP.FILM = { names: 8002, get: [8013, 8015, 8017], set: [8012, 8014, 8016] };
  RP.INCAM = { get: [8007, 8009, 8011], set: [8006, 8008, 8010] };

  RP.paramStr = (p) => p.join(":");                        // [7 ints] → "a:b:c:d:e:f:g"
  /* Push the 3 FILM slots (each {name, params:[7]}), optional frame budget. 3001-bracketed. */
  RP.applyFilm = async (slots, budget) => {
    await RP.cmd(3001, { par: 2 }); await RP.cmd(3001, { par: 0 });
    if (budget != null) await RP.cmd(8004, { par: budget });
    await RP.cmd(RP.FILM.names, { str: slots.map((s) => s.name).join(":") });
    for (let i = 0; i < 3; i++) await RP.cmd(RP.FILM.set[i], { str: RP.paramStr(slots[i].params) });
    await RP.cmd(3001, { par: 0 });
  };
  /* Push the 3 IN-CAMERA slots (params only; names are fixed firmware). `-255` reverts a slot. */
  RP.applyIncam = async (paramsList) => {
    await RP.cmd(3001, { par: 2 }); await RP.cmd(3001, { par: 0 });
    for (let i = 0; i < 3; i++) await RP.cmd(RP.INCAM.set[i], { str: RP.paramStr(paramsList[i]) });
    await RP.cmd(3001, { par: 0 });
  };

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
