/* RewindPix gallery + sync — uses the RP client (camera.js). No build step. */
(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), msgEl = $("msg"), galleryEl = $("gallery");

  function msg(text, kind) { msgEl.textContent = text; msgEl.className = "msg show " + (kind || "wait"); }
  function clearMsg() { msgEl.className = "msg"; }

  // ---- lazy, concurrency-capped image loader (single-client camera) ----
  const MAX_CONCURRENT = 2;
  let active = 0; const queue = [];
  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const img = queue.shift(); active++;
      img.src = img.dataset.src;
      const done = () => { active--; pump(); };
      img.onload = done; img.onerror = () => { img.classList.add("failed"); done(); };
    }
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target); pump(); }
  }, { rootMargin: "300px" });

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

  function renderGallery(files) {
    const seen = RP.seen();
    const syncable = RP.syncableFiles(files);
    const byFolder = {};
    for (const f of syncable) (byFolder[f.folder] = byFolder[f.folder] || []).push(f);

    galleryEl.innerHTML = "";
    const order = ["Original_Film", "In_Camera_Mode"];
    const folders = Object.keys(byFolder).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    let newCount = 0;

    for (const folder of folders) {
      const items = byFolder[folder].sort((a, b) => b.timecode - a.timecode);
      const title = document.createElement("div"); title.className = "folder-title";
      title.textContent = folder + "  ·  " + items.length + " photos"; galleryEl.appendChild(title);

      const grid = document.createElement("div"); grid.className = "grid";
      for (let idx = 0; idx < items.length; idx++) {
        const f = items[idx];
        const isNew = !seen.has(f.fpath); if (isNew) newCount++;
        const cell = document.createElement("div"); cell.className = "cell"; cell.tabIndex = 0; cell.style.cursor = "pointer";
        const img = document.createElement("img"); img.dataset.src = RP.urlFor(f.fpath); img.alt = f.name; img.loading = "lazy";
        cell.appendChild(img); io.observe(img);
        if (isNew) { const b = document.createElement("span"); b.className = "new"; b.textContent = "NEW"; cell.appendChild(b); }
        const cap = document.createElement("div"); cap.className = "cap";
        const nm = document.createElement("span"); nm.className = "name"; nm.textContent = f.name; nm.title = f.name + " · " + fmtBytes(f.size);
        cap.appendChild(nm); cell.appendChild(cap); grid.appendChild(cell);
        const openThis = ((arr, i) => () => openViewer(arr, i))(items, idx);
        cell.onclick = openThis; cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openThis(); } };
      }
      galleryEl.appendChild(grid);
    }
    return { total: syncable.length, newCount, files: syncable };
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
  $("marksynced").onclick = () => { RP.markSeen(RP.syncableFiles(lastFiles).map((f) => f.fpath)); renderGallery(lastFiles); msg("Marked all current photos as synced.", "ok"); };
  $("clearseen").onclick = () => { RP.resetSeen(); renderGallery(lastFiles); msg("Sync memory reset — all photos show as NEW again.", "ok"); };
  $("downloadall").onclick = downloadAll;

  // auto-connect + initial sync on load
  sync();
})();
