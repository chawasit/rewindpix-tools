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
        .then((d) => { d.luts.forEach((l) => names.add(l.name)); res(names); }).catch(() => res(names));
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
      const meta = document.createElement("div"); meta.innerHTML = "<b>" + name + "</b> <span class='p'>" + kind + "</span>"; info.appendChild(meta);
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
  $("lutFile").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => {
      const name = (f.name.replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9_. -]/g, "").slice(0, 16)) || "CUSTOM";
      try { RPDev.customLuts.add(name, r.result); msg("Added custom LUT: " + name, "ok"); renderLuts(); }
      catch (err) { msg("Couldn't save: " + err.message, "err"); }
    };
    r.readAsDataURL(f); e.target.value = "";
  };

  // ---- LUT sync from GitHub → camera luts/ (incremental) ----
  $("lutSync").onclick = async () => {
    const appDir = location.pathname.slice(0, location.pathname.lastIndexOf("/") + 1);
    const dst = appDir + "luts/";
    $("lutSync").disabled = true;
    try {
      msg("Sync: fetching manifest from GitHub…", "wait");
      const gh = await fetch(GH_LUTS + "luts.json?t=" + Date.now(), { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error("manifest HTTP " + r.status); return r.json(); });
      const have = new Set();
      try { const loc = await fetch(dst + "luts.json?t=" + Date.now(), { cache: "no-store" }); if (loc.ok) (await loc.json()).luts.forEach((l) => have.add(l.file)); } catch (e) {}
      const missing = gh.luts.filter((l) => !have.has(l.file));
      if (!missing.length) { msg("LUTs already up to date (" + gh.luts.length + " on the card).", "ok"); return; }
      for (let i = 0; i < missing.length; i++) {
        const l = missing[i]; msg("Sync " + (i + 1) + "/" + missing.length + ": " + l.file + " …", "wait");
        const blob = await fetch(GH_LUTS + l.file + "?t=" + Date.now(), { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(l.file + " HTTP " + r.status); return r.blob(); });
        const form = new FormData(); form.append("fileupload1", blob, l.file); form.append("upbtn", "Upload files");
        await fetch(dst, { method: "POST", body: form, cache: "no-store" });
      }
      const mblob = new Blob([JSON.stringify(gh, null, 2)], { type: "application/json" });
      const mf = new FormData(); mf.append("fileupload1", mblob, "luts.json"); mf.append("upbtn", "Upload files");
      await fetch(dst, { method: "POST", body: mf, cache: "no-store" });
      msg("Synced " + missing.length + " LUT(s) into the camera's luts/. Power-cycle the camera so its file server re-serves them.", "ok");
      renderLuts();
    } catch (e) { msg("LUT sync failed: " + e.message + " — needs internet + the camera's WiFi at once.", "err"); }
    finally { $("lutSync").disabled = false; }
  };

  // ---- preset backup (shared 'rp_presets' with the Presets tab) ----
  const CKEY = "rp_presets";
  const loadP = () => JSON.parse(localStorage.getItem(CKEY) || "[]");
  const saveP = (a) => localStorage.setItem(CKEY, JSON.stringify(a));
  const token = (p) => "RWP1|" + p.name + "|" + p.params.join(":");
  const parseToken = (line) => { const m = line.trim().match(/^RWP1\|([^|]{1,20})\|([\-0-9:]+)$/); if (!m) return null; const params = m[2].split(":").map(Number); if (params.length !== 7 || params.some(isNaN)) return null; return { name: m[1], params }; };
  const renderCount = () => { $("presetCount").textContent = "(" + loadP().length + ")"; };
  $("pExport").onclick = () => { const io = $("pio"); io.style.display = "block"; io.value = loadP().map(token).join("\n"); io.select(); msg("Exported " + loadP().length + " presets (copy the tokens).", "ok"); };
  $("pImport").onclick = () => {
    const io = $("pio"); if (io.style.display === "none") { io.style.display = "block"; io.focus(); return; }
    let added = 0; const a = loadP(); const raw = io.value.trim(); let items = [];
    try { const j = JSON.parse(raw); if (Array.isArray(j)) items = j; } catch (e) { items = raw.split("\n").map(parseToken).filter(Boolean); }
    items.forEach((p) => { if (p && p.name && Array.isArray(p.params) && p.params.length === 7) { const i = a.findIndex((q) => q.name === p.name); if (i >= 0) a[i] = p; else a.push(p); added++; } });
    saveP(a); renderCount(); msg(added ? ("Imported " + added + " preset(s).") : "Nothing valid to import.", added ? "ok" : "err");
  };
  $("pClear").onclick = () => { if (!loadP().length) return; if (confirm("Delete ALL saved presets?")) { saveP([]); renderCount(); msg("Cleared all presets.", "ok"); } };

  renderLuts(); renderCount();
})();
