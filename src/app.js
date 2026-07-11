/* RewindPix gallery + sync — uses the RP client (camera.js). No build step. */
(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), msgEl = $("msg"), galleryEl = $("gallery");

  function msg(text, kind) { msgEl.textContent = text; msgEl.className = "msg show " + (kind || "wait"); }
  function clearMsg() { msgEl.className = "msg"; }


  // ---- localStorage thumbnail cache (downscaled data URLs; raw "thumb:" + developed "dev:" keys) ----
  function cacheGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function cachePut(key, url) {
    try { localStorage.setItem(key, url); }
    catch (e) { try { Object.keys(localStorage).filter((k) => /^(thumb|dev):/.test(k)).forEach((k) => localStorage.removeItem(k)); localStorage.setItem(key, url); } catch (e2) {} }
  }
  async function downscaleURL(blob) {
    let bmp; try { bmp = await createImageBitmap(blob); } catch (e) { return null; }
    const S = 300, k = Math.min(1, S / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(bmp, 0, 0, w, h); if (bmp.close) bmp.close();
    try { return c.toDataURL("image/jpeg", 0.7); } catch (e) { return null; }
  }

  // ---- gallery state: folders + timestamp filter + pagination ----
  const PAGE = 12;
  let allFiles = [], curFolder = "*", curFilter = "all", shown = PAGE;
  function parseTime(f) { const m = (f.time || "").match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : (f.timecode || 0); }
  let selectMode = false; const selected = new Set();
  let _catP = null; const lutCat = () => (_catP || (_catP = (window.RPDev ? RPDev.lutCatalog() : Promise.resolve({}))));
  const isFilm = (fp) => /[\\/]\._FILM[\\/]/.test(fp);
  const exPickReq = () => { try { return sessionStorage.getItem("rp_expick_req") === "1"; } catch (e) { return false; } };
  function pickExample(f) { try { sessionStorage.setItem("rp_expick", f.fpath); sessionStorage.setItem("rp_expick_name", f.name); sessionStorage.removeItem("rp_expick_req"); } catch (e) {} if (window.RP_SPA) location.hash = "#presets"; else location.href = "presets.html"; }
  let _devEng = null;
  async function developURL(blob, lutSrc) {
    let photo; try { photo = await createImageBitmap(blob); } catch (e) { return null; }
    let lut; try { lut = await RPDev.load(lutSrc); } catch (e) { if (photo.close) photo.close(); return null; }
    try {
      if (!_devEng) _devEng = RPDev.createEngine();
      _devEng.setPhoto(photo); _devEng.setLut(lut);
      const S = 300, k = Math.min(1, S / Math.max(photo.width, photo.height));
      _devEng.render(RPDev.DEFAULT_PARAMS, Math.max(1, Math.round(photo.width * k)), Math.max(1, Math.round(photo.height * k)));
      return _devEng.canvas.toDataURL("image/jpeg", 0.7);
    } catch (e) { return null; } finally { if (photo.close) photo.close(); }
  }
  // full-res: bake a ._FILM frame's filename LUT into its download (matches the gallery preview). Everything
  // else — Original_Film, In_Camera_Mode, or a name with no catalog LUT — returns the raw camera JPEG.
  let _dlEng = null;
  async function filmBlob(f) {
    const raw = await RP.downloadBlob(f.fpath);
    const fn = RPDev.filmLutName(f.fpath, f.name);
    if (!fn) return raw;
    const cat = await lutCat(); if (!cat[fn]) return raw;                 // no catalog LUT for this film name -> raw
    // a catalog LUT exists for this film name -> we MUST bake it; a failure here is a real error,
    // never a silent raw fallback (that would deliver an unprocessed file under a film filename)
    const photo = await createImageBitmap(raw);
    try {
      const lut = await RPDev.load(cat[fn]);
      if (!_dlEng) _dlEng = RPDev.createEngine();                          // separate engine — thumb renders never race its canvas
      _dlEng.setPhoto(photo); _dlEng.setLut(lut);
      _dlEng.render(RPDev.DEFAULT_PARAMS, photo.width, photo.height);
      const out = await _dlEng.toBlob("image/jpeg", 0.92);
      if (!out) throw new Error("JPEG encode failed");
      return out;
    } finally { if (photo.close) photo.close(); }
  }
  // ---- lazy loader → localStorage cache (downscaled data URLs). ONE image at a time; skeleton until ready ----
  let active = 0; const q = [];
  function pump() { while (active < 1 && q.length) { const img = q.shift(); active++; loadThumb(img).finally(() => { active--; pump(); }); } }
  async function loadThumb(img) {
    const cell = img.parentElement, fp = img.dataset.fp, film = isFilm(fp);
    const fn = RPDev.filmLutName(fp, fp.split(/[\\/]/).pop());
    try {
      let developed = false, url = fn ? cacheGet("dev:" + fp) : null;
      if (url) developed = true; else url = cacheGet("thumb:" + fp);
      if (!url) {
        const res = await fetch(RP.urlFor(fp), { cache: "force-cache" }); if (!res.ok) throw 0;
        const blob = await res.blob();
        if (fn) { const cat = await lutCat(); if (cat[fn]) { url = await developURL(blob, cat[fn]); if (url) { developed = true; cachePut("dev:" + fp, url); } } }
        if (!url) { url = await downscaleURL(blob); if (url) cachePut("thumb:" + fp, url); }
        if (!url) throw 0;
      }
      if (film && !developed) { const r = document.createElement("span"); r.className = "rawbadge"; r.textContent = "RAW"; cell.appendChild(r); }
      img.onload = () => { cell.classList.remove("loading"); cell.classList.add("ready"); };
      img.onerror = () => { cell.classList.remove("loading"); cell.classList.add("thumb-fail"); };
      img.src = url;
    } catch (e) { cell.classList.remove("loading"); cell.classList.add("thumb-fail"); }
  }
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); q.push(e.target); pump(); } }, { rootMargin: "300px" });

  function fmtBytes(n) { return n >= 1e6 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(0) + " KB"; }

  async function download(fpath, name, btn) {
    const prev = btn.textContent; btn.textContent = "…"; btn.disabled = true;
    try {
      const f = allFiles.find((x) => x.fpath === fpath) || { fpath, name }; const blob = await filmBlob(f);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      RP.markSeen([fpath]); renderPage(); btn.textContent = "✓";
    } catch (e) { btn.textContent = "err"; msg("Download failed: " + e.message, "err"); }
    finally { btn.disabled = false; setTimeout(() => (btn.textContent = prev), 1500); }
  }

  async function downloadAll() {
    const btn = $("downloadall"), prev = btn.textContent; btn.disabled = true;
    const files = RP.syncableFiles(lastFiles);
    if (!files.length) { msg("Nothing to download.", "err"); btn.disabled = false; return; }
    try {
      const entries = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        btn.textContent = "ZIP " + (i + 1) + "/" + files.length;
        msg("Zipping " + (i + 1) + "/" + files.length + ": " + f.name + " …", "wait");
        const blob = await filmBlob(f);   // ._FILM frames get their LUT baked in; others raw (single-client queue)
        entries.push({ name: f.folder + "/" + f.name, bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      msg("Packaging " + entries.length + " photos…", "wait");
      const zip = RPZip.build(entries);
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a"); a.href = url;
      a.download = "rewindpix-" + new Date().toISOString().slice(0, 10) + ".zip";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000);
      RP.markSeen(files.map((f) => f.fpath)); renderGallery(lastFiles);
      msg("Downloaded " + entries.length + " photos as a ZIP (" + fmtBytes(zip.size) + ").", "ok");
    } catch (e) { msg("ZIP download failed: " + e.message + " — try saving photos individually.", "err"); }
    finally { btn.disabled = false; btn.textContent = prev; }
  }

  // ---- fullscreen mobile photo viewer (lightbox) ----
  let vFiles = [], vIdx = 0, viewerEl = null, vImg, vName, vCount, vSpin;
  function buildViewer() {
    if (viewerEl) return viewerEl;
    const old = document.getElementById("rp-viewer"); if (old) old.remove();
    const v = document.createElement("div"); v.className = "viewer"; v.id = "rp-viewer";
    v.innerHTML =
      '<div class="v-top"><span class="v-name"></span><span class="v-count"></span><button class="v-x" aria-label="Close">✕</button></div>' +
      '<div class="v-stage"><span class="v-spin">Loading…</span><img alt=""><button class="v-nav v-prev" aria-label="Previous">‹</button><button class="v-nav v-next" aria-label="Next">›</button></div>' +
      '<div class="v-actions"><button class="v-dev primary">Develop</button><button class="v-dl">Download ⤓</button></div>';
    document.body.appendChild(v);
    viewerEl = v; vImg = v.querySelector("img"); vName = v.querySelector(".v-name"); vCount = v.querySelector(".v-count"); vSpin = v.querySelector(".v-spin");
    vImg.onload = () => { vSpin.style.display = "none"; }; vImg.onerror = () => { vSpin.textContent = "Failed to load"; };
    v.querySelector(".v-x").onclick = closeViewer;
    v.querySelector(".v-prev").onclick = () => vStep(-1);
    v.querySelector(".v-next").onclick = () => vStep(1);
    v.querySelector(".v-dev").onclick = () => { const f = vFiles[vIdx]; closeViewer(); if (window.RP_SPA) { window.RP_PICK = f.fpath; window.RP_PICK_TIME = f.time || ""; location.hash = "#develop"; } else location.href = "develop.html?photo=" + encodeURIComponent(f.fpath) + (f.time ? "&t=" + encodeURIComponent(f.time) : ""); };
    v.querySelector(".v-dl").onclick = (e) => download(vFiles[vIdx].fpath, vFiles[vIdx].name, e.currentTarget);
    let x0 = null, y0 = null; const stage = v.querySelector(".v-stage");
    stage.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) closeViewer(); else if (Math.abs(dx) > 45) vStep(dx < 0 ? 1 : -1); x0 = y0 = null; }, { passive: true });
    return v;
  }
  function vKey(e) { if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowLeft") vStep(-1); else if (e.key === "ArrowRight") vStep(1); }
  function vShow() { const f = vFiles[vIdx]; vSpin.style.display = "block"; vSpin.textContent = "Loading…"; vImg.src = RP.urlFor(f.fpath); vName.textContent = f.name; vCount.textContent = (vIdx + 1) + " / " + vFiles.length; }
  function vStep(d) { vIdx = (vIdx + d + vFiles.length) % vFiles.length; vShow(); }
  function openViewer(files, i) { buildViewer(); vFiles = files; vIdx = i; vShow(); viewerEl.classList.add("open"); document.addEventListener("keydown", vKey); }
  function closeViewer() { if (viewerEl) viewerEl.classList.remove("open"); document.removeEventListener("keydown", vKey); }

  function filtered() {
    let list;
    if (curFolder === "._FILM") list = allFiles.filter((f) => f.folder === "._FILM");
    else if (curFolder === "*") list = allFiles.filter((f) => f.folder !== "._FILM");
    else list = allFiles.filter((f) => f.folder === curFolder);
    const now = Date.now(), day = 86400000, win = { today: day, "7d": 7 * day, "30d": 30 * day }[curFilter];
    if (win) list = list.filter((f) => now - parseTime(f) < win);
    return list.slice().sort((a, b) => b.timecode - a.timecode);
  }
  function chip(label, on, fn) { const b = document.createElement("button"); b.className = "chip" + (on ? " on" : ""); b.textContent = label; b.onclick = fn; return b; }
  function setFolder(f) { curFolder = f; shown = PAGE; renderControls(); renderPage(); }
  function renderControls() {
    const counts = {}; allFiles.forEach((f) => (counts[f.folder] = (counts[f.folder] || 0) + 1));
    const nonFilm = allFiles.filter((f) => f.folder !== "._FILM").length;
    const fb = $("folderChips"); fb.innerHTML = "";
    fb.appendChild(chip("All (" + nonFilm + ")", curFolder === "*", () => setFolder("*")));
    if (counts["._FILM"]) fb.appendChild(chip("Current film (" + counts["._FILM"] + ")", curFolder === "._FILM", () => setFolder("._FILM")));
    Object.keys(counts).filter((n) => n !== "._FILM").sort().forEach((n) => fb.appendChild(chip(n + " (" + counts[n] + ")", curFolder === n, () => setFolder(n))));
    const tb = $("timeChips"); tb.innerHTML = "";
    [["all", "All time"], ["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]].forEach(([k, l]) => tb.appendChild(chip(l, curFilter === k, () => { curFilter = k; shown = PAGE; renderControls(); renderPage(); })));
  }
  function renderPage() {
    const seen = RP.seen(), list = filtered();
    galleryEl.innerHTML = "";
    if (exPickReq()) {
      const bn = document.createElement("div"); bn.style.cssText = "background:#1b2740;border:1px solid #2f6feb;border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#cfe0ff;font-size:.85rem;display:flex;align-items:center;justify-content:space-between;gap:10px";
      bn.innerHTML = "<span>📷 Pick a photo to use as the Presets example — tap one.</span>";
      const cx = document.createElement("button"); cx.textContent = "Cancel"; cx.onclick = () => { try { sessionStorage.removeItem("rp_expick_req"); } catch (e) {} if (window.RP_SPA) location.hash = "#presets"; else location.href = "presets.html"; };
      bn.appendChild(cx); galleryEl.appendChild(bn);
    }
    if (!list.length) { const em = document.createElement("div"); em.style.cssText = "color:#7b848f;padding:24px;text-align:center"; em.textContent = "No photos in this view."; galleryEl.appendChild(em); return; }
    const grid = document.createElement("div"); grid.className = "grid";
    list.slice(0, shown).forEach((f, idx) => {
      const cell = document.createElement("div"); cell.className = "cell loading"; cell.tabIndex = 0; cell.style.cursor = "pointer";
      if (selectMode && selected.has(f.fpath)) cell.classList.add("sel");
      const img = document.createElement("img"); img.dataset.fp = f.fpath; img.alt = f.name;
      cell.appendChild(img); io.observe(img);
      if (!seen.has(f.fpath)) { const b = document.createElement("span"); b.className = "new"; b.textContent = "NEW"; cell.appendChild(b); }
      const cap = document.createElement("div"); cap.className = "cap"; const nm = document.createElement("span"); nm.className = "name"; nm.textContent = f.name; nm.title = f.name + " · " + fmtBytes(f.size);
      cap.appendChild(nm); cell.appendChild(cap); grid.appendChild(cell);
      cell.onclick = () => { if (exPickReq()) return pickExample(f); if (selectMode) toggleSel(f, cell); else openViewer(list, idx); };
      cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cell.onclick(); } };
    });
    galleryEl.appendChild(grid);
    if (list.length > shown) { const more = document.createElement("button"); more.className = "primary"; more.style.cssText = "margin:16px auto 0;display:block"; more.textContent = "Load more (" + (list.length - shown) + ")"; more.onclick = () => { shown += PAGE; renderPage(); }; galleryEl.appendChild(more); }
  }
  function renderGallery(files) {
    allFiles = (files || []).filter((f) => f.folder);   // include ._FILM (shown under "Current film")
    const seen = RP.seen(); const newCount = allFiles.filter((f) => !seen.has(f.fpath)).length;
    shown = PAGE; renderControls(); renderPage();
    return { total: allFiles.length, newCount };
  }

  let lastFiles = [];
  async function connect() {
    statusEl.textContent = "connecting…"; statusEl.className = "status-bar";
    try {
      const [fw, model, st, free] = [await RP.firmware(), await RP.model(), await RP.status(), await RP.freeFrames()];
      statusEl.innerHTML = "<span class='ok'>●</span> <b>" + (model || "?") + "</b> fw " + (fw || "?") +
        " · roll <b>" + (st.maxPhotos ?? "?") + "</b> · <b>" + (free ?? "?") + "</b> frames free";
      return true;
    } catch (e) {
      statusEl.innerHTML = "<span class='err'>●</span> not reachable — join the camera's WiFi";
      msg("Camera not reachable: " + e.message + "\nJoin the camera's WiFi and press Reconnect.", "err");
      return false;
    }
  }

  async function sync() {
    if (!(await connect())) return;
    msg("Reading photos…", "wait");
    try {
      lastFiles = await RP.listFiles();
      const r = renderGallery(lastFiles);
      msg(r.total + " photos · " + r.newCount + " new since last sync. Tap ⤓ to save a photo; “Mark all synced” to clear NEW badges.", "ok");
    } catch (e) { msg("List failed: " + e.message, "err"); }
  }

  $("sync").onclick = sync;
  $("reconnect").onclick = connect;
  $("marksynced").onclick = () => { RP.markSeen(allFiles.map((f) => f.fpath)); renderPage(); msg("Marked all photos as synced — NEW badges cleared.", "ok"); };
  $("clearseen").onclick = () => { RP.resetSeen(); renderPage(); msg("Sync memory reset — all photos show as NEW again.", "ok"); };
  $("downloadall").onclick = downloadAll;

  // ---- select / download mode: checkboxes, then download individually (or ZIP) ----
  function refreshSel() { $("selcount").textContent = selected.size + " selected"; }
  function toggleSel(f, cell) { if (selected.has(f.fpath)) { selected.delete(f.fpath); cell.classList.remove("sel"); } else { selected.add(f.fpath); cell.classList.add("sel"); } refreshSel(); }
  function exitSelect() { selectMode = false; selected.clear(); document.body.classList.remove("selecting"); $("selbar").style.display = "none"; $("galtools").style.display = "flex"; renderPage(); }
  $("select").onclick = () => { selectMode = true; selected.clear(); document.body.classList.add("selecting"); $("galtools").style.display = "none"; $("selbar").style.display = "flex"; refreshSel(); renderPage(); };
  $("selcancel").onclick = exitSelect;
  $("selall").onclick = () => { filtered().forEach((f) => selected.add(f.fpath)); refreshSel(); renderPage(); };
  $("seldl").onclick = () => downloadSelected(false);
  $("selzip").onclick = () => downloadSelected(true);
  $("seldel").onclick = () => deleteSelected();
  async function deleteSelected() {
    const files = allFiles.filter((f) => selected.has(f.fpath));
    if (!files.length) { msg("Nothing selected.", "err"); return; }
    if (!confirm("Delete " + files.length + " photo(s) from the camera? This can't be undone.")) return;
    $("seldl").disabled = $("selzip").disabled = $("seldel").disabled = true;
    const del = new Set(); let fail = 0;
    try {
      for (let i = 0; i < files.length; i++) { const f = files[i]; msg("Deleting " + (i + 1) + "/" + files.length + ": " + f.name + "…", "wait"); try { const xml = await RP.deleteFile(f.fpath); if (RP.ackOk(xml)) del.add(f.fpath); else fail++; } catch (e) { fail++; } }
      selectMode = false; selected.clear(); document.body.classList.remove("selecting"); $("selbar").style.display = "none"; $("galtools").style.display = "flex";
      lastFiles = lastFiles.filter((f) => !del.has(f.fpath));
      renderGallery(lastFiles);
      msg("Deleted " + del.size + " photo(s)." + (fail ? " " + fail + " failed — try again." : ""), fail ? "err" : "ok");
    } catch (e) { msg("Delete failed: " + e.message, "err"); }
    finally { $("seldl").disabled = $("selzip").disabled = $("seldel").disabled = false; }
  }
  async function downloadSelected(zip) {
    const files = allFiles.filter((f) => selected.has(f.fpath));
    if (!files.length) { msg("Nothing selected.", "err"); return; }
    $("seldl").disabled = $("selzip").disabled = true;
    try {
      if (zip) {
        const entries = [];
        for (let i = 0; i < files.length; i++) { const f = files[i]; msg("Zipping " + (i + 1) + "/" + files.length + ": " + f.name + "…", "wait"); const blob = await filmBlob(f); entries.push({ name: f.folder + "/" + f.name, bytes: new Uint8Array(await blob.arrayBuffer()) }); }
        const url = URL.createObjectURL(RPZip.build(entries)); const a = document.createElement("a"); a.href = url; a.download = "rewindpix-" + new Date().toISOString().slice(0, 10) + ".zip"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000);
        msg("Downloaded " + files.length + " photo(s) as a ZIP.", "ok");
      } else {
        for (let i = 0; i < files.length; i++) { const f = files[i]; msg("Downloading " + (i + 1) + "/" + files.length + ": " + f.name + "…", "wait"); const blob = await filmBlob(f); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000); await new Promise((r) => setTimeout(r, 400)); }
        msg("Downloaded " + files.length + " file(s) individually.", "ok");
      }
      RP.markSeen(files.map((f) => f.fpath)); exitSelect();
    } catch (e) { msg("Download failed: " + e.message, "err"); } finally { $("seldl").disabled = $("selzip").disabled = false; }
  }

  // ---- finish roll: delete ._FILM working copies that have an Original_Film twin, then reset the budget ----
  let _frTs = 0;
  $("finishroll").onclick = async () => {
    const films = allFiles.filter((f) => f.folder === "._FILM");
    if (!films.length) { msg("No current-film (._FILM) frames to finish.", "err"); return; }
    const now = Date.now();
    if (now - _frTs > 4000) { _frTs = now; msg("Finish roll deletes " + films.length + " ._FILM working copies (twins stay in Original_Film) and resets the frame budget to 0. Tap Finish roll again to confirm.", "err"); return; }
    _frTs = 0;
    const orig = new Set(allFiles.filter((f) => f.folder === "Original_Film").map((f) => f.name));
    let del = 0, skip = 0;
    for (let i = 0; i < films.length; i++) { const f = films[i]; if (!orig.has(f.name)) { skip++; continue; } msg("Finishing " + (i + 1) + "/" + films.length + "…", "wait"); try { const xml = await RP.deleteFile(f.fpath); if (RP.ackOk(xml)) del++; } catch (e) {} }
    try { await RP.setMaxPhotos(0); } catch (e) {}
    msg("Finished roll: deleted " + del + " ._FILM frame(s), reset budget to 0." + (skip ? " Skipped " + skip + " without an Original_Film twin — download those first." : ""), "ok");
    await sync();
  };

  // auto-connect + initial sync on load
  sync();
})();
