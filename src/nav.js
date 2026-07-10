/* RewindPix bottom tab bar — thumb-zone navigation for both the multi-file pages and the single-file
 * SPA. Built once; marks the active tab from the hash (SPA) or the pathname (multi-file). */
(function () {
  if (document.getElementById("rp-tabbar")) return;
  const S = (p) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>";
  const TABS = [
    { id: "gallery", href: "index.html", label: "Gallery", icon: S('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>') },
    { id: "develop", href: "develop.html", label: "Develop", icon: S('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>') },
    { id: "presets", href: "presets.html", label: "Presets", icon: S('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>') },
    { id: "library", href: "library.html", label: "Library", icon: S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>') },
  ];
  const spa = !!window.RP_SPA;
  const bar = document.createElement("nav"); bar.className = "tabbar"; bar.id = "rp-tabbar";
  bar.innerHTML = TABS.map((t) => '<a href="' + (spa ? "#" + t.id : t.href) + '" data-tab="' + t.id + '">' + t.icon + "<span>" + t.label + "</span></a>").join("");
  document.body.appendChild(bar);
  const mark = (id) => bar.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.tab === id));
  if (spa) {
    const cur = () => (location.hash.replace(/^#/, "").split("?")[0]) || "gallery";
    window.RPNav = mark;                                  // the SPA router calls this on view change
    mark(cur()); addEventListener("hashchange", () => mark(cur()));
  } else {
    const page = location.pathname.split("/").pop() || "index.html";
    const t = TABS.find((x) => x.href === page) || TABS[0];
    mark(t.id);
  }
})();
