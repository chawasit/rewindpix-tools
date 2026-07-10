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
      for (const f of items) {
        const isNew = !seen.has(f.fpath); if (isNew) newCount++;
        const cell = document.createElement("div"); cell.className = "cell";
        const img = document.createElement("img"); img.dataset.src = RP.urlFor(f.fpath); img.alt = f.name; img.loading = "lazy";
        cell.appendChild(img); io.observe(img);
        if (isNew) { const b = document.createElement("span"); b.className = "new"; b.textContent = "NEW"; cell.appendChild(b); }
        const cap = document.createElement("div"); cap.className = "cap";
        const nm = document.createElement("span"); nm.className = "name"; nm.textContent = f.name; nm.title = f.name + " · " + fmtBytes(f.size);
        const dl = document.createElement("button"); dl.className = "dl-btn"; dl.textContent = "⤓"; dl.title = "Download";
        dl.style.cssText = "padding:2px 8px;font-size:.8rem"; dl.onclick = () => download(f.fpath, f.name, dl);
        const dev = document.createElement("a"); dev.className = "dl-btn"; dev.textContent = "Develop";
        dev.style.cssText = "padding:2px 8px;font-size:.8rem;text-decoration:none"; dev.href = "develop.html?photo=" + encodeURIComponent(f.fpath);
        cap.appendChild(nm); cap.appendChild(dev); cap.appendChild(dl); cell.appendChild(cap); grid.appendChild(cell);
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

  // auto-connect + initial sync on load
  sync();
})();
