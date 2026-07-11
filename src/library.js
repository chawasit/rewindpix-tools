/* RewindPix Library — manage LUTs (list / upload / delete / sync from GitHub) + preset backup. */
(function () {
  const $ = (id) => document.getElementById(id);
  const msg = (t, k) => { const m = $("msg"); m.textContent = t; m.className = "msg show " + (k || "wait"); };
  const GH_LUTS = "https://raw.githubusercontent.com/chawasit/rewindpix-tools/main/src/luts/";

  // ---- LUT list ----
  function bundledNames() {
    return new Promise((res) => {
      const names = new Set(Object.keys(window.RP_LUTS || {}));   // inlined fallbacks
      fetch("luts/luts.json").then((r) => (r.ok ? r.json() : { luts: [] }))
        .then((d) => { const arr = (d && Array.isArray(d.luts)) ? d.luts : []; arr.forEach((l) => { if (l && typeof l.name === "string") names.add(l.name); }); res(names); }).catch(() => res(names));
    });
  }
  async function renderLuts() {
    const box = $("lutList"); box.innerHTML = "<div style='color:#7b848f;font-size:.85rem'>Loading…</div>";
    const bundled = await bundledNames();
    const custom = RPDev.customLuts.list();
    box.innerHTML = "";
    const row = (name, kind, onDel, prevSrc) => {
      const it = document.createElement("div"); it.className = "coll-item";
      const info = document.createElement("div"); info.className = "lutinfo";
      if (prevSrc) { const img = document.createElement("img"); img.className = "lutthumb"; img.loading = "lazy"; img.alt = name; img.onerror = () => img.remove(); img.src = prevSrc; info.appendChild(img); }
      const meta = document.createElement("div"); const nameEl = document.createElement("b"); nameEl.textContent = name; const kindEl = document.createElement("span"); kindEl.className = "p"; kindEl.textContent = kind; meta.append(nameEl, document.createTextNode(" "), kindEl); info.appendChild(meta);
      it.appendChild(info);
      if (onDel) { const d = document.createElement("button"); d.textContent = "✕"; d.style.cssText = "padding:5px 9px;font-size:.8rem"; d.onclick = onDel; it.appendChild(d); }
      box.appendChild(it);
    };
    [...bundled].sort().forEach((n) => row(n, "bundled", null, (window.RP_PREVIEWS && window.RP_PREVIEWS[n]) || ("previews/" + n + ".jpg")));
    custom.forEach((l) => row(l.name, "custom", () => { RPDev.customLuts.remove(l.name); renderLuts(); msg("Removed custom LUT: " + l.name, "ok"); }));
    if (!bundled.size && !custom.length) box.innerHTML = "<div style='color:#7b848f;font-size:.85rem'>No LUTs. Upload one, or Sync from GitHub.</div>";
    $("lutCount").textContent = "(" + (bundled.size + custom.length) + ")";
  }
  $("lutUp").onclick = () => $("lutFile").click();
  let _valEng = null;   // reused engine to validate an uploaded LUT before persisting (hardened setLut throws on bad geometry/GPU)
  $("lutFile").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = async () => {
      const name = (f.name.replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9_. -]/g, "").slice(0, 16)) || "CUSTOM";
      try {
        const img = await RPDev.load(r.result);                       // decode the PNG
        if (!_valEng) _valEng = RPDev.createEngine();
        _valEng.setLut(img);                                          // hardened: throws on non-HALD geometry / GPU limit
        RPDev.customLuts.add(name, r.result); msg("Added custom LUT: " + name, "ok"); renderLuts();
      } catch (err) { msg("Not a valid HALD LUT: " + err.message, "err"); }
    };
    r.readAsDataURL(f); e.target.value = "";
  };

  // ---- LUT sync from GitHub → camera luts/ (incremental) ----
  const LUT_FILE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,126}\.png$/i;
  const LUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,63}$/;
  function validatedManifest(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.luts)) throw new Error("invalid LUT manifest");
    const files = new Set();
    const luts = value.luts.map((entry) => {
      if (!entry || typeof entry !== "object" || !LUT_NAME.test(entry.name) || !LUT_FILE.test(entry.file)) throw new Error("invalid LUT manifest entry");
      if (files.has(entry.file)) throw new Error("duplicate LUT manifest file: " + entry.file);
      if (entry.size != null && (!Number.isSafeInteger(entry.size) || entry.size < 0)) throw new Error("invalid LUT size: " + entry.file);
      if (entry.hash != null && (typeof entry.hash !== "string" || !/^fnv1a32:[0-9a-f]{8}$/.test(entry.hash))) throw new Error("invalid LUT hash: " + entry.file);
      files.add(entry.file);
      return { name: entry.name, file: entry.file, size: entry.size, hash: entry.hash };
    });
    return { luts };
  }
  async function lutRecord(entry) {
    const url = GH_LUTS + encodeURIComponent(entry.file) + "?t=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(entry.file + " HTTP " + res.status);
    const blob = await res.blob();
    let hash = 0x811c9dc5;
    for (const byte of new Uint8Array(await blob.arrayBuffer())) { hash ^= byte; hash = Math.imul(hash, 0x01000193); }
    return { entry: { name: entry.name, file: entry.file, size: blob.size, hash: "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") }, blob };
  }
  async function uploadToCamera(dst, name, blob) {
    const form = new FormData(); form.append("fileupload1", blob, name); form.append("upbtn", "Upload files");
    const result = await RP.enqueue(async () => {
      const res = await fetch(dst, { method: "POST", body: form, cache: "no-store" });
      return { ok: res.ok, status: res.status, body: await res.text() };
    });
    if (!result.ok || !(result.body.trim().toLowerCase() === "ok" || RP.ackOk(result.body))) throw new Error(name + " upload rejected" + (result.ok ? "" : " (HTTP " + result.status + ")"));
  }
  $("lutSync").onclick = async () => {
    const appDir = location.pathname.slice(0, location.pathname.lastIndexOf("/") + 1);
    const dst = appDir + "luts/";
    $("lutSync").disabled = true;
    try {
      msg("Sync: fetching manifest from GitHub…", "wait");
      const manifestRes = await fetch(GH_LUTS + "luts.json?t=" + Date.now(), { cache: "no-store" });
      if (!manifestRes.ok) throw new Error("manifest HTTP " + manifestRes.status);
      const gh = validatedManifest(await manifestRes.json());
      let local = { luts: [] };
      try {
        const localResult = await RP.enqueue(async () => {
          const res = await fetch(dst + "luts.json?t=" + Date.now(), { cache: "no-store" });
          return { ok: res.ok, body: await res.text() };
        });
        if (localResult.ok) local = validatedManifest(JSON.parse(localResult.body));
      } catch (e) { local = { luts: [] }; }
      const localByFile = new Map(local.luts.map((entry) => [entry.file, entry]));
      const records = [];
      for (let i = 0; i < gh.luts.length; i++) {
        msg("Sync: checking " + (i + 1) + "/" + gh.luts.length + ": " + gh.luts[i].file + " …", "wait");
        records.push(await lutRecord(gh.luts[i]));
      }
      const updates = records.filter(({ entry }) => {
        const current = localByFile.get(entry.file);
        return !current || current.size !== entry.size || current.hash !== entry.hash;
      });
      const manifestChanged = local.luts.length !== records.length || records.some(({ entry }) => {
        const current = localByFile.get(entry.file);
        return !current || current.name !== entry.name || current.size !== entry.size || current.hash !== entry.hash;
      });
      if (!updates.length && !manifestChanged) { msg("LUTs already up to date (" + records.length + " on the card).", "ok"); return; }
      const failures = [];
      let synced = 0;
      for (let i = 0; i < updates.length; i++) {
        const record = updates[i]; msg("Sync " + (i + 1) + "/" + updates.length + ": " + record.entry.file + " …", "wait");
        try { await uploadToCamera(dst, record.entry.file, record.blob); synced++; }
        catch (e) { failures.push(record.entry.file + ": " + e.message); }
      }
      if (failures.length) {
        msg("LUT sync incomplete: " + synced + "/" + updates.length + " uploaded; manifest not published. Failed: " + failures.join(", "), "err");
        return;
      }
      const published = { luts: records.map((record) => record.entry) };
      await uploadToCamera(dst, "luts.json", new Blob([JSON.stringify(published, null, 2)], { type: "application/json" }));
      msg("Synced " + synced + " LUT(s) and published the verified manifest. Power-cycle the camera so its file server re-serves them.", "ok");
      renderLuts();
    } catch (e) { msg("LUT sync failed: " + e.message + " — manifest was not published.", "err"); }
    finally { $("lutSync").disabled = false; }
  };

  // ---- preset backup (shared 'rp_presets' with the Presets tab) ----
  const CKEY = "rp_presets";
  const PARAM_RANGES = [[-100, 100], [0, 100], [0, 255], [0, 255], [0, 255], [-100, 100], [-100, 100]];
  const decodePreset = (value) => {
    if (!value || typeof value !== "object" || typeof value.name !== "string" || !/^[A-Za-z0-9 _.-]{1,20}$/.test(value.name) || !Array.isArray(value.params) || value.params.length !== 7) return null;
    if (value.params.some((param) => !(typeof param === "number" && Number.isInteger(param)) && !(typeof param === "string" && /^-?\d+$/.test(param)))) return null;
    const params = value.params.map(Number);
    if (params.some((n, i) => !Number.isSafeInteger(n) || n < PARAM_RANGES[i][0] || n > PARAM_RANGES[i][1])) return null;
    return { name: value.name, params };
  };
  const loadP = () => JSON.parse(localStorage.getItem(CKEY) || "[]");
  const saveP = (a) => localStorage.setItem(CKEY, JSON.stringify(a));
  const token = (p) => "RWP1|" + p.name + "|" + p.params.join(":");
  const parseToken = (line) => { const m = line.trim().match(/^RWP1\|([^|]+)\|([^|]+)$/); return m ? decodePreset({ name: m[1], params: m[2].split(":") }) : null; };
  const renderCount = () => { $("presetCount").textContent = "(" + loadP().length + ")"; };
  $("pExport").onclick = () => { const io = $("pio"); io.style.display = "block"; io.value = loadP().map(token).join("\n"); io.select(); msg("Exported " + loadP().length + " presets (copy the tokens).", "ok"); };
  $("pImport").onclick = () => {
    const io = $("pio"); if (io.style.display === "none") { io.style.display = "block"; io.focus(); return; }
    const raw = io.value.trim(); let decoded;
    try { const value = JSON.parse(raw); decoded = Array.isArray(value) ? value.map(decodePreset) : null; }
    catch (e) { decoded = raw ? raw.split("\n").map(parseToken) : null; }
    if (!decoded || !decoded.length || decoded.some((preset) => !preset)) { msg("Nothing imported: every preset must have a safe name and 7 in-range integers.", "err"); return; }
    const a = loadP();
    decoded.forEach((preset) => { const i = a.findIndex((q) => q.name === preset.name); if (i >= 0) a[i] = preset; else a.push(preset); });
    saveP(a); renderCount(); msg("Imported " + decoded.length + " preset(s).", "ok");
  };
  $("pClear").onclick = () => { if (!loadP().length) return; if (confirm("Delete ALL saved presets?")) { saveP([]); renderCount(); msg("Cleared all presets.", "ok"); } };

  renderLuts(); renderCount();
})();
