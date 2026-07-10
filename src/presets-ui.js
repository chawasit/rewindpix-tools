/* RewindPix presets — film + in-camera slot editors, preview, and the preset collection. */
(function () {
  const $ = (id) => document.getElementById(id);
  const FIELDS = [
    { k: "LUM", min: -100, max: 100, def: 0 }, { k: "CONTRAST", min: 0, max: 100, def: 75 },
    { k: "RGAIN", min: 0, max: 255, def: 0 }, { k: "GGAIN", min: 0, max: 255, def: 0 }, { k: "BGAIN", min: 0, max: 255, def: 0 },
    { k: "HUE", min: -100, max: 100, def: 0 }, { k: "SAT", min: -100, max: 100, def: 0 },
  ];
  const DEFAULTS = FIELDS.map((f) => f.def);
  function msg(t, k) { const m = $("msg"); m.textContent = t; m.className = "msg show " + (k || "wait"); }

  // ---- example photo source: bundled samples + a gallery pick, shared across all slot cards ----
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} }, del: (k) => { try { sessionStorage.removeItem(k); } catch (e) {} } };
  const exRenderers = [];            // each slot registers renderExample() so switching the source re-renders every card
  let exPhoto = null;                // the chosen sample / gallery photo (HTMLImageElement)
  const sampleSrc = Object.assign({}, window.RP_SAMPLES || {});   // name -> src (inlined data URIs on the single-file build)
  function loadSample(src) { RPDev.load(src).then((img) => { exPhoto = img; exRenderers.forEach((fn) => fn()); }).catch(() => {}); }
  (function initSampleSelector() {
    const sel = $("exSample"); if (!sel) return;
    ss.del("rp_expick_req");   // entering presets cancels any pending gallery-pick request
    const opt = (v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); };
    // default "Color chart" example — the generated colour/greyscale pattern (shows param effects clearly)
    const chart = document.createElement("canvas"); chart.width = 384; chart.height = 256;
    (function () { const x = chart.getContext("2d"); const bars = ["#e33", "#3d3", "#39f", "#3dd", "#d3d", "#ee3", "#fff", "#111", "#c9a37a", "#7a5a3a"]; const bw = chart.width / bars.length; bars.forEach((c, i) => { x.fillStyle = c; x.fillRect(i * bw, 0, bw + 1, 170); }); for (let i = 0; i < chart.width; i++) { const v = Math.round(i / (chart.width - 1) * 255); x.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; x.fillRect(i, 170, 1, 86); } })();
    sampleSrc["Color chart"] = chart.toDataURL("image/png");
    fetch("samples/samples.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
      if (d && d.samples) d.samples.forEach((s) => { if (!(s.name in sampleSrc)) sampleSrc[s.name] = "samples/" + s.file; });
      opt("s:Color chart", "Color chart");
      Object.keys(sampleSrc).filter((n) => n !== "Color chart").sort().forEach((n) => opt("s:" + n, n));
      const picked = ss.get("rp_expick"); let pickedLabel = null;
      if (picked) {
        ss.del("rp_expick");
        pickedLabel = "📷 " + (ss.get("rp_expick_name") || "Gallery photo"); ss.del("rp_expick_name");
        sampleSrc[pickedLabel] = RP.urlFor(picked); opt("s:" + pickedLabel, pickedLabel);
      }
      opt("__gallery__", "📷 Pick from gallery…");
      const startVal = pickedLabel ? "s:" + pickedLabel : "s:Color chart";
      if (startVal) { sel.value = startVal; const nm = startVal.slice(2); if (sampleSrc[nm]) loadSample(sampleSrc[nm]); }
      sel.onchange = () => {
        if (sel.value === "__gallery__") { ss.set("rp_expick_req", "1"); if (window.RP_SPA) location.hash = "#gallery"; else location.href = "index.html"; return; }
        const nm = sel.value.slice(2); if (sampleSrc[nm]) loadSample(sampleSrc[nm]);
      };
    });
  })();

  // ---- slot card ----
  const UNSET = new Array(7).fill(-255);
  const isUnset = (p) => p && p.length === 7 && p.every((v) => v === -255);
  const lutNamesP = (window.RPDev && RPDev.lutCatalog) ? RPDev.lutCatalog() : Promise.resolve({});
  const lutSet = new Set(), lutSrcMap = {};
  lutNamesP.then((cat) => Object.keys(cat).forEach((n) => { const u = n.toUpperCase(); lutSet.add(u); lutSrcMap[u] = cat[n]; }));
  function makeSlot(container, tag, hasName, overridable) {
    const el = document.createElement("div"); el.className = "slot";
    const hd = document.createElement("div"); hd.className = "hd";
    hd.innerHTML = `<span class="tag">${tag}</span>`;
    let nameEl = null, ovr = null, resetBtn = null;
    if (hasName) {
      nameEl = document.createElement("input"); nameEl.className = "name"; nameEl.maxLength = 10; nameEl.placeholder = "NAME";
      nameEl.oninput = () => { nameEl.value = nameEl.value.toUpperCase().replace(/[^A-Z0-9_. -]/g, "").slice(0, 10); syncLutUi(); renderExample(); };
      hd.appendChild(nameEl);
      const pick = document.createElement("select"); pick.className = "lutpick";
      pick.title = "Use a LUT's name as this slot's name — enables the gallery's Current-film auto-preview";
      pick.innerHTML = '<option value="">LUT ▾</option>';
      lutNamesP.then((cat) => Object.keys(cat).sort().forEach((n) => { const o = document.createElement("option"); o.value = n; o.textContent = n; pick.appendChild(o); }));
      pick.onchange = () => { if (!pick.value) return; nameEl.value = pick.value.toUpperCase().replace(/[^A-Z0-9_. -]/g, "").slice(0, 10); pick.value = ""; syncLutUi(); renderExample(); };
      hd.appendChild(pick);
      resetBtn = document.createElement("button"); resetBtn.className = "lutreset"; resetBtn.textContent = "↺ defaults";
      resetBtn.title = "Reset the 7 params to defaults — official LUTs are tuned for the default params"; resetBtn.style.display = "none";
      hd.appendChild(resetBtn);
    } else if (overridable) {
      const lab = document.createElement("label"); lab.style.cssText = "font-size:.74rem;color:#9aa4af;display:flex;gap:5px;align-items:center";
      ovr = document.createElement("input"); ovr.type = "checkbox";
      lab.appendChild(ovr); lab.appendChild(document.createTextNode("Override (else keep baked)")); hd.appendChild(lab);
    } else { const s = document.createElement("span"); s.style.cssText = "color:#7b848f;font-size:.78rem"; s.textContent = "(fixed name)"; hd.appendChild(s); }
    el.appendChild(hd);
    const sliders = FIELDS.map((f) => {
      const row = document.createElement("div"); row.className = "f";
      row.innerHTML = `<label>${f.k}</label>`;
      const r = document.createElement("input"); r.type = "range"; r.min = f.min; r.max = f.max; r.step = 1; r.value = f.def;
      const v = document.createElement("span"); v.className = "v"; v.textContent = f.def;
      r.oninput = () => { v.textContent = r.value; renderExample(); };
      row.appendChild(r); row.appendChild(v); el.appendChild(row); return r;
    });
    // per-slot example: the color chart with this slot's params (+ its LUT, when the name matches one)
    const exWrap = document.createElement("div"); exWrap.className = "exwrap";
    exWrap.innerHTML = '<div class="exhd"><span class="exlabel">Example</span><span class="exstatus" aria-live="polite"></span></div>';
    const exStatus = exWrap.querySelector(".exstatus");
    const exCanvas = document.createElement("canvas"); exCanvas.className = "ex"; exCanvas.width = 300; exCanvas.height = 50;
    exWrap.appendChild(exCanvas); el.appendChild(exWrap);
    let exEng = null, exLut = null, exLutImg = null, exSeq = 0, exSet = null;
    function setExStatus(t, cls) { exStatus.textContent = t; exStatus.className = "exstatus" + (cls ? " " + cls : ""); }
    async function renderExample() {
      const seq = ++exSeq;
      try {
        if (!exPhoto) { setExStatus("no sample", ""); return; }
        const raw = get().params, pobj = {};
        FIELDS.forEach((f, i) => (pobj[f.k] = raw[i] === -255 ? f.def : raw[i]));
        if (!exEng) exEng = RPDev.createEngine();
        if (exSet !== exPhoto) { exEng.setPhoto(exPhoto); exSet = exPhoto; }
        const nm = (nameEl && nameEl.value || "").toUpperCase(), src = lutSrcMap[nm];
        if (src) {
          if (exLut !== nm) { setExStatus("loading " + nm + "…", "load"); exLutImg = await RPDev.load(src).catch(() => null); exLut = nm; if (seq !== exSeq) return; }
          if (exLutImg) exEng.setLut(exLutImg);
        } else if (exLut) {
          exLut = null; exLutImg = null;
          try { const lc = exEng.gl.getExtension("WEBGL_lose_context"); lc && lc.loseContext(); } catch (e) {}
          exEng = RPDev.createEngine(); exEng.setPhoto(exPhoto); exSet = exPhoto;
        }
        const w = 384, h = Math.max(1, Math.round(w * exPhoto.height / exPhoto.width));
        exCanvas.width = w; exCanvas.height = h;
        exEng.render(pobj, w, h);
        const cx = exCanvas.getContext("2d"); cx.clearRect(0, 0, w, h); cx.drawImage(exEng.canvas, 0, 0, w, h);
        setExStatus(src ? (exLutImg ? nm + " ✓" : "LUT failed") : "params only", src ? (exLutImg ? "ok" : "err") : "");
      } catch (e) { setExStatus("preview unavailable", "err"); }
    }
    exRenderers.push(renderExample);
    function setDisabled(d) { sliders.forEach((s) => (s.disabled = d)); el.style.opacity = d ? ".6" : "1"; }
    if (ovr) ovr.onchange = () => { setDisabled(!ovr.checked); renderExample(); };
    function resetParams() { DEFAULTS.forEach((val, i) => { sliders[i].value = val; sliders[i].nextSibling.textContent = val; }); renderExample(); }
    function syncLutUi() { if (resetBtn) resetBtn.style.display = lutSet.has((nameEl && nameEl.value || "").toUpperCase()) ? "" : "none"; }
    if (resetBtn) resetBtn.onclick = resetParams;
    lutNamesP.then(() => { syncLutUi(); renderExample(); });
    function get() {
      if (overridable && ovr && !ovr.checked) return { name: null, params: UNSET.slice() };
      return { name: nameEl ? nameEl.value : null, params: sliders.map((s) => +s.value) };
    }
    function set(name, params) {
      if (nameEl && name != null) nameEl.value = String(name).toUpperCase().slice(0, 10);
      if (overridable && ovr) {
        const unset = isUnset(params); ovr.checked = !unset; setDisabled(unset);
        (unset ? DEFAULTS : params).forEach((val, i) => { sliders[i].value = val; sliders[i].nextSibling.textContent = val; });
      } else {
        (params || DEFAULTS).forEach((val, i) => { sliders[i].value = val; sliders[i].nextSibling.textContent = val; });
      }
      syncLutUi(); renderExample();
    }
    container.appendChild(el); return { get, set };
  }

  const film = [0, 1, 2].map((i) => makeSlot($("filmSlots"), "Film C" + (i + 1), true));
  const incam = [0, 1, 2].map((i) => makeSlot($("incamSlots"), "In-cam C" + (i + 1), false, true));
  film.forEach((s) => s.set("STD. FILM", DEFAULTS));
  incam.forEach((s) => s.set(null, UNSET.slice()));

  // ---- camera load / apply ----
  $("loadcam").onclick = async () => {
    msg("Reading slots from camera…", "wait");
    try {
      const fw = await RP.firmware(); $("status").innerHTML = "<span class='ok'>●</span> connected · fw " + fw;
      const names = await RP.getSlotNames();
      for (let i = 0; i < 3; i++) film[i].set(names[i], await RP.getParams(RP.FILM.get[i]));
      for (let i = 0; i < 3; i++) incam[i].set(null, await RP.getParams(RP.INCAM.get[i]));
      try { const st = await RP.status(); if (st.maxPhotos != null) $("rollN").value = st.maxPhotos; } catch (e) {}
      msg("Loaded current film + in-camera slots from the camera.", "ok");
    } catch (e) { $("status").innerHTML = "<span class='err'>●</span> not reachable"; msg("Load failed: " + e.message + " — join the camera's WiFi.", "err"); }
  };
  $("applyFilm").onclick = async () => {
    const slots = film.map((s) => s.get());
    if (slots.some((s) => !s.name)) { msg("Every film slot needs a name (≤10, UPPERCASE).", "err"); return; }
    msg("Applying film slots…", "wait");
    try { await RP.applyFilm(slots); msg("Film slots applied: " + slots.map((s) => s.name).join(" · "), "ok"); }
    catch (e) { msg("Apply failed: " + e.message, "err"); }
  };
  $("applyIncam").onclick = async () => {
    msg("Applying in-camera slots…", "wait");
    try { await RP.applyIncam(incam.map((s) => s.get().params)); msg("In-camera slots applied. (-255 on a slot reverts it to the baked look.)", "ok"); }
    catch (e) { msg("Apply failed: " + e.message, "err"); }
  };

  // ---- roll size (merged from the old Roll size page) ----
  async function setRoll(n) {
    if (!Number.isInteger(n) || n < 0) { msg("Enter a whole number ≥ 0.", "err"); return; }
    msg("Setting roll size → " + n + "…", "wait");
    try { const xml = await RP.setMaxPhotos(n); if (!RP.ackOk(xml)) throw new Error("camera rejected (status " + RP.tag(xml, "Status") + ")");
      msg("Roll size set → " + n + (n === 0 ? "  (roll cleared)" : "") + ". Verify on the camera.", "ok"); }
    catch (e) { msg("Set roll failed: " + e.message, "err"); }
  }
  $("setRoll").onclick = () => setRoll(parseInt($("rollN").value, 10));
  document.querySelectorAll("[data-roll]").forEach((b) => { b.onclick = () => { $("rollN").value = b.dataset.roll; setRoll(parseInt(b.dataset.roll, 10)); }; });

  // ---- preset collection ----
  const CKEY = "rp_presets";
  const load = () => JSON.parse(localStorage.getItem(CKEY) || "[]");
  const save = (a) => localStorage.setItem(CKEY, JSON.stringify(a));

  const SLOTS = [["Film C1", (p) => film[0].set(film[0].get().name, p)], ["Film C2", (p) => film[1].set(film[1].get().name, p)],
    ["Film C3", (p) => film[2].set(film[2].get().name, p)], ["In-cam C1", (p) => incam[0].set(null, p)],
    ["In-cam C2", (p) => incam[1].set(null, p)], ["In-cam C3", (p) => incam[2].set(null, p)]];
  $("saveFrom").innerHTML = SLOTS.map((s, i) => `<option value="${i}">from ${s[0]}</option>`).join("");

  function renderColl() {
    const list = load(); const box = $("coll"); box.innerHTML = "";
    if (!list.length) { box.innerHTML = "<div style='color:#7b848f;font-size:.85rem'>No saved presets yet.</div>"; return; }
    list.forEach((p, idx) => {
      const it = document.createElement("div"); it.className = "coll-item";
      const opts = SLOTS.map((s, i) => `<option value="${i}">→ ${s[0]}</option>`).join("");
      it.innerHTML = `<div><b>${p.name}</b> <span class="p">${p.params.join(":")}</span></div>`;
      const right = document.createElement("div"); right.style.cssText = "display:flex;gap:6px";
      const sel = document.createElement("select"); sel.innerHTML = opts; sel.style.cssText = "padding:5px;font-size:.8rem";
      const apply = document.createElement("button"); apply.textContent = "Apply"; apply.style.cssText = "padding:5px 9px;font-size:.8rem";
      apply.onclick = () => { SLOTS[+sel.value][1](p.params); msg("Loaded “" + p.name + "” into " + SLOTS[+sel.value][0] + " (not yet pushed — hit Apply … to camera).", "ok"); };
      const del = document.createElement("button"); del.textContent = "✕"; del.style.cssText = "padding:5px 9px;font-size:.8rem";
      del.onclick = () => { const a = load(); a.splice(idx, 1); save(a); renderColl(); };
      right.append(sel, apply, del); it.appendChild(right); box.appendChild(it);
    });
  }
  $("save").onclick = () => {
    const slot = SLOTS[+$("saveFrom").value]; const src = slot[0].startsWith("Film") ? film[+slot[0].slice(-1) - 1].get() : incam[+slot[0].slice(-1) - 1].get();
    const name = ($("saveName").value || src.name || "PRESET").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 10) || "PRESET";
    const a = load(); const i = a.findIndex((p) => p.name === name); const preset = { name, params: src.params };
    if (i >= 0) a[i] = preset; else a.push(preset); save(a); renderColl(); $("saveName").value = ""; msg("Saved preset “" + name + "”.", "ok");
  };
  renderColl();
})();
