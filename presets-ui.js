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

  // ---- preview (params applied to a generated color chart, no LUT) ----
  const chartSrc = document.createElement("canvas"); chartSrc.width = 360; chartSrc.height = 120;
  (function drawChart() {
    const x = chartSrc.getContext("2d");
    const bars = ["#e33", "#3d3", "#39f", "#3dd", "#d3d", "#ee3", "#fff", "#111", "#c9a37a", "#7a5a3a"];
    const bw = 360 / bars.length;
    bars.forEach((c, i) => { x.fillStyle = c; x.fillRect(i * bw, 0, bw, 80); });
    for (let i = 0; i < 360; i++) { const v = Math.round((i / 359) * 255); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 80, 1, 40); }
  })();
  let previewEngine = null;
  function preview(params) {
    try {
      if (!previewEngine) { previewEngine = RPDev.createEngine(); previewEngine.setPhoto(chartSrc); }
      const obj = {}; FIELDS.forEach((f, i) => (obj[f.k] = params[i]));
      previewEngine.render(obj, 360, 120);
      const c = $("chart"), cx = c.getContext("2d"); cx.clearRect(0, 0, c.width, c.height); cx.drawImage(previewEngine.canvas, 0, 0, c.width, c.height);
    } catch (e) { /* WebGL may be unavailable; preview is optional */ }
  }

  // ---- slot card ----
  const UNSET = new Array(7).fill(-255);
  const isUnset = (p) => p && p.length === 7 && p.every((v) => v === -255);
  function makeSlot(container, tag, hasName, overridable) {
    const el = document.createElement("div"); el.className = "slot";
    const hd = document.createElement("div"); hd.className = "hd";
    hd.innerHTML = `<span class="tag">${tag}</span>`;
    let nameEl = null, ovr = null;
    if (hasName) {
      nameEl = document.createElement("input"); nameEl.className = "name"; nameEl.maxLength = 10; nameEl.placeholder = "NAME";
      nameEl.oninput = () => { nameEl.value = nameEl.value.toUpperCase().replace(/[^A-Z0-9_. -]/g, "").slice(0, 10); };
      hd.appendChild(nameEl);
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
      r.oninput = () => { v.textContent = r.value; preview(get().params); };
      row.appendChild(r); row.appendChild(v); el.appendChild(row); return r;
    });
    function setDisabled(d) { sliders.forEach((s) => (s.disabled = d)); el.style.opacity = d ? ".6" : "1"; }
    if (ovr) ovr.onchange = () => { setDisabled(!ovr.checked); preview(get().params); };
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
    }
    container.appendChild(el); return { get, set };
  }

  const film = [0, 1, 2].map((i) => makeSlot($("filmSlots"), "Film C" + (i + 1), true));
  const incam = [0, 1, 2].map((i) => makeSlot($("incamSlots"), "In-cam C" + (i + 1), false, true));
  film.forEach((s) => s.set("STD. FILM", DEFAULTS));
  incam.forEach((s) => s.set(null, UNSET.slice()));
  preview(DEFAULTS);

  // ---- camera load / apply ----
  $("loadcam").onclick = async () => {
    msg("Reading slots from camera…", "wait");
    try {
      const fw = await RP.firmware(); $("status").innerHTML = "<span class='ok'>●</span> connected · fw " + fw;
      const names = await RP.getSlotNames();
      for (let i = 0; i < 3; i++) film[i].set(names[i], await RP.getParams(RP.FILM.get[i]));
      for (let i = 0; i < 3; i++) incam[i].set(null, await RP.getParams(RP.INCAM.get[i]));
      preview(film[0].get().params);
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

  // ---- preset collection ----
  const CKEY = "rp_presets";
  const load = () => JSON.parse(localStorage.getItem(CKEY) || "[]");
  const save = (a) => localStorage.setItem(CKEY, JSON.stringify(a));
  const token = (p) => "RWP1|" + p.name + "|" + p.params.join(":");
  const parseToken = (line) => { const m = line.trim().match(/^RWP1\|([^|]{1,20})\|([\-0-9:]+)$/); if (!m) return null;
    const params = m[2].split(":").map(Number); if (params.length !== 7 || params.some(isNaN)) return null; return { name: m[1], params }; };

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
      apply.onclick = () => { SLOTS[+sel.value][1](p.params); preview(p.params); msg("Loaded “" + p.name + "” into " + SLOTS[+sel.value][0] + " (not yet pushed — hit Apply … to camera).", "ok"); };
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
  $("exportAll").onclick = () => { const io = $("io"); io.style.display = "block"; io.value = load().map(token).join("\n"); io.select(); msg("Exported " + load().length + " presets as tokens (copy them, or import elsewhere).", "ok"); };
  $("importBtn").onclick = () => {
    const io = $("io"); if (io.style.display === "none") { io.style.display = "block"; io.focus(); return; }
    let added = 0; const a = load(); const raw = io.value.trim();
    let items = [];
    try { const j = JSON.parse(raw); if (Array.isArray(j)) items = j; } catch (e) { items = raw.split("\n").map(parseToken).filter(Boolean); }
    items.forEach((p) => { if (p && p.name && Array.isArray(p.params) && p.params.length === 7) { const i = a.findIndex((q) => q.name === p.name); if (i >= 0) a[i] = p; else a.push(p); added++; } });
    save(a); renderColl(); msg(added ? ("Imported " + added + " preset(s).") : "Nothing valid to import.", added ? "ok" : "err");
  };
  renderColl();
})();
