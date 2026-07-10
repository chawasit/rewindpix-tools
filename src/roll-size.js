/* RewindPix — set the camera roll size (frame budget) via cmd=8004. Same-origin RP client
 * (camera.js), matching the gallery/develop/presets pages. */
(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), msgEl = $("msg"), nEl = $("n"), goEl = $("go");

  function msg(text, kind) { msgEl.textContent = text; msgEl.className = "msg show " + (kind || "wait"); }

  async function refreshStatus() {
    statusEl.textContent = "connecting…";
    try {
      const [model, fw, st] = await Promise.all([RP.model(), RP.firmware(), RP.status()]);
      statusEl.innerHTML = "<b>● " + (model || "?") + "</b> fw " + (fw || "?") + " · roll " + (st.maxPhotos != null ? st.maxPhotos : "?");
      if (st.maxPhotos != null) nEl.value = st.maxPhotos;
    } catch (e) {
      statusEl.textContent = "not connected — join the camera's WiFi, then Reconnect";
    }
  }

  async function setRoll(n) {
    if (!Number.isInteger(n) || n < 0) { msg("Enter a whole number ≥ 0.", "err"); return; }
    goEl.disabled = true;
    msg("Setting max photos → " + n + " …", "wait");
    try {
      const xml = await RP.setMaxPhotos(n);
      if (!RP.ackOk(xml)) throw new Error("camera rejected (status " + RP.tag(xml, "Status") + ")");
      msg("Set: max photos → " + n + (n === 0 ? "  (roll cleared)" : "") + ". Verify the count on the camera screen.", "ok");
      statusEl.innerHTML = statusEl.innerHTML.replace(/roll \S+$/, "roll " + n);
    } catch (e) {
      msg("Could not set roll size: " + e.message + "\n• On the camera's WiFi?  • Served over HTTP (not HTTPS)?", "err");
    } finally {
      goEl.disabled = false;
    }
  }

  goEl.onclick = () => setRoll(parseInt(nEl.value, 10));
  $("reconnect").onclick = refreshStatus;
  nEl.addEventListener("keydown", (e) => { if (e.key === "Enter") setRoll(parseInt(nEl.value, 10)); });
  document.querySelectorAll(".row button[data-n]").forEach((b) => {
    b.onclick = () => { nEl.value = b.dataset.n; setRoll(parseInt(b.dataset.n, 10)); };
  });

  refreshStatus();
})();
