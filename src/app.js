/* RewindPix gallery + sync — uses the RP client (camera.js). No build step. */
(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), msgEl = $("msg"), galleryEl = $("gallery");

  function msg(text, kind) { msgEl.textContent = text; msgEl.className = "msg show " + (kind || "wait"); }
  function clearMsg() { msgEl.className = "msg"; }


  // ---- localStorage thumbnail cache (downscaled data URLs; works over plain-HTTP LAN, no secure context) ----
  const TKEY = (fp) => "thumb:" + fp;
  function lsGet(fp) { try { return localStorage.getItem(TKEY(fp)); } catch (e) { return null; } }
  function lsPut(fp, dataUrl) {
    try { localStorage.setItem(TKEY(fp), dataUrl); }
    catch (e) { try { Object.keys(localStorage).filter((k) => k.indexOf("thumb:") === 0).forEach((k) => localStorage.removeItem(k)); localStorage.setItem(TKEY(fp), dataUrl); } catch (e2) {} }
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
  // ---- lazy loader → localStorage cache (downscaled data URLs). ONE image at a time; skeleton until ready ----
  let active = 0; const q = [];
  function pump() { while (active < 1 && q.length) { const img = q.shift(); active++; loadThumb(img).finally(() => { active--; pump(); }); } }
  async function loadThumb(img) {
    const cell = img.parentElement, fp = img.dataset.fp;
    try {
      let url = lsGet(fp);
      if (!url) { const res = await fetch(RP.urlFor(fp), { cache: "force-cache" }); if (!res.ok) throw 0; url = await downscaleURL(await res.blob()); if (!url) throw 0; lsPut(fp, url); }
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
      const blob = await RP.downloadBlob(fpath);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      btn.textContent = "✓";
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
        const blob = await RP.downloadBlob(f.fpath);   // serialized through the single-client queue
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
    v.querySelector(".v-dev").onclick = () => { const f = vFiles[vIdx]; closeViewer(); if (window.RP_SPA) { window.RP_PICK = f.fpath; location.hash = "#develop"; } else location.href = "develop.html?photo=" + encodeURIComponent(f.fpath); };
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
    let list = allFiles.slice();
    if (curFolder !== "*") list = list.filter((f) => f.folder === curFolder);
    const now = Date.now(), day = 86400000, win = { today: day, "7d": 7 * day, "30d": 30 * day }[curFilter];
    if (win) list = list.filter((f) => now - parseTime(f) < win);
    return list.sort((a, b) => b.timecode - a.timecode);
  }
  function chip(label, on, fn) { const b = document.createElement("button"); b.className = "chip" + (on ? " on" : ""); b.textContent = label; b.onclick = fn; return b; }
  function renderControls() {
    const counts = {}; allFiles.forEach((f) => (counts[f.folder] = (counts[f.folder] || 0) + 1));
    const fb = $("folderChips"); fb.innerHTML = "";
    fb.appendChild(chip("All (" + allFiles.length + ")", curFolder === "*", () => { curFolder = "*"; shown = PAGE; renderControls(); renderPage(); }));
    Object.keys(counts).sort().forEach((n) => fb.appendChild(chip(n + " (" + counts[n] + ")", curFolder === n, () => { curFolder = n; shown = PAGE; renderControls(); renderPage(); })));
    const tb = $("timeChips"); tb.innerHTML = "";
    [["all", "All time"], ["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]].forEach(([k, l]) => tb.appendChild(chip(l, curFilter === k, () => { curFilter = k; shown = PAGE; renderControls(); renderPage(); })));
  }
  function renderPage() {
    const seen = RP.seen(), list = filtered();
    galleryEl.innerHTML = "";
    if (!list.length) { galleryEl.innerHTML = "<div style='color:#7b848f;padding:24px;text-align:center'>No photos in this view.</div>"; return; }
    const grid = document.createElement("div"); grid.className = "grid";
    list.slice(0, shown).forEach((f, idx) => {
      const cell = document.createElement("div"); cell.className = "cell loading"; cell.tabIndex = 0; cell.style.cursor = "pointer";
      const img = document.createElement("img"); img.dataset.fp = f.fpath; img.alt = f.name;
      cell.appendChild(img); io.observe(img);
      if (!seen.has(f.fpath)) { const b = document.createElement("span"); b.className = "new"; b.textContent = "NEW"; cell.appendChild(b); }
      const cap = document.createElement("div"); cap.className = "cap"; const nm = document.createElement("span"); nm.className = "name"; nm.textContent = f.name; nm.title = f.name + " · " + fmtBytes(f.size);
      cap.appendChild(nm); cell.appendChild(cap); grid.appendChild(cell);
      cell.onclick = () => openViewer(list, idx);
      cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(list, idx); } };
    });
    galleryEl.appendChild(grid);
    if (list.length > shown) { const more = document.createElement("button"); more.className = "primary"; more.style.cssText = "margin:16px auto 0;display:block"; more.textContent = "Load more (" + (list.length - shown) + ")"; more.onclick = () => { shown += PAGE; renderPage(); }; galleryEl.appendChild(more); }
  }
  function renderGallery(files) {
    allFiles = (files || []).filter((f) => f.folder && f.folder !== "._FILM");
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
  $("marksynced").onclick = () => { RP.markSeen(RP.syncableFiles(lastFiles).map((f) => f.fpath)); renderPage(); msg("Marked all current photos as synced.", "ok"); };
  $("clearseen").onclick = () => { RP.resetSeen(); renderPage(); msg("Sync memory reset — all photos show as NEW again.", "ok"); };
  $("downloadall").onclick = downloadAll;

  // auto-connect + initial sync on load
  sync();
})();
