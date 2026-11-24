/* Small shared UI helpers: a "⋯" popup menu and drag-to-reorder for lists. */
const UI = (() => {
  let openMenu = null, cleanup = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } if (cleanup) { cleanup(); cleanup = null; } }
  function menu(anchor, items) {
    closeMenu();
    const m = document.createElement("div"); m.className = "ui-menu"; m.setAttribute("role", "menu");
    for (const it of items.filter(Boolean)) {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
      b.className = "ui-mi" + (it.danger ? " danger" : ""); b.textContent = it.label;
      b.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); it.fn(); });
      m.append(b);
    }
    document.body.append(m); openMenu = m;
    const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
    m.style.top = (r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
    const away = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
    const esc = (e) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc);
    window.addEventListener("resize", closeMenu); window.addEventListener("scroll", closeMenu, true);
    cleanup = () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); window.removeEventListener("resize", closeMenu); window.removeEventListener("scroll", closeMenu, true); };
    const first = m.querySelector("button"); if (first) first.focus({ preventScroll: true });
  }
  // a ⋯ button; `items` is a function returning the menu entries when it is opened
  function kebab(items, label) {
    const b = document.createElement("button"); b.type = "button"; b.className = "kebab"; b.textContent = "⋯";
    b.setAttribute("aria-label", label || "More actions"); b.setAttribute("aria-haspopup", "menu"); b.title = label || "More";
    b.addEventListener("click", (e) => { e.stopPropagation(); menu(b, items()); });
    return b;
  }
  // drag rows (by their ".drag-h" grip) up and down inside `container`; onDrop gets the ids in the new order
  function reorder(container, { item, onDrop }) {
    container.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest(".drag-h"); if (!grip) return;
      const row = grip.closest(item); if (!row || row.parentElement !== container) return;
      e.preventDefault();
      const rows = () => [...container.children].filter((c) => c.matches(item) && c !== row);
      const startY = e.clientY; let target = null, before = true;
      row.classList.add("dragging-row");
      const clear = () => rows().forEach((s) => s.classList.remove("drop-above", "drop-below"));
      const move = (ev) => {
        row.style.transform = `translateY(${ev.clientY - startY}px)`;
        clear(); target = null;
        for (const s of rows()) { const r = s.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { target = s; before = true; break; } }
        if (!target) { const all = rows(); target = all[all.length - 1] || null; before = false; }
        if (target) target.classList.add(before ? "drop-above" : "drop-below");
        if (ev.clientY < 70) scrollBy(0, -14); else if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
      };
      const up = () => {
        document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
        clear(); row.classList.remove("dragging-row"); row.style.transform = "";
        if (!target) return;
        if (before) container.insertBefore(row, target); else target.after(row);
        onDrop([...container.children].filter((c) => c.matches(item)).map((c) => c.dataset.id));
      };
      document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
    });
  }
  // ---- colour picker: hue / saturation / shade bars + exact picker + "No color" ----
  const hslHex = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join(""); };
  const hexHsl = (hex) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round(((h * 60) + 360) % 360), d ? Math.round(d / (1 - Math.abs(2 * l - 1)) * 100) : 0, Math.round(l * 100)]; };
  function colorPicker(host, onPick) {
    let H = 210, S = 70, L = 50, on = false;
    const mk = (t, c, a) => { const e = document.createElement(t); if (c) e.className = c; if (a) for (const k in a) e.setAttribute(k, a[k]); return e; };
    const bar = (label, max, get, set) => {
      const track = mk("div", "cp-bar", { role: "slider", "aria-label": label, tabindex: "0", "aria-valuemin": "0", "aria-valuemax": String(max) }), thumb = mk("i", "cp-thumb");
      track.append(thumb);
      const put = (clientX) => { const r = track.getBoundingClientRect(); set(Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max)); on = true; sync(true); };
      track.addEventListener("pointerdown", (e) => { e.preventDefault(); track.setPointerCapture(e.pointerId); put(e.clientX); track.onpointermove = (ev) => put(ev.clientX); });
      const stop = () => { track.onpointermove = null; };
      track.addEventListener("pointerup", stop); track.addEventListener("pointercancel", stop);
      track.addEventListener("keydown", (e) => { const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0; if (!d) return; e.preventDefault(); set(Math.max(0, Math.min(max, get() + d * Math.max(1, Math.round(max / 50))))); on = true; sync(true); });
      return { track, thumb, max, get };
    };
    const hue = bar("Hue", 359, () => H, (v) => { H = v; }), sat = bar("Saturation", 100, () => S, (v) => { S = v; }), lit = bar("Shade", 100, () => Math.round((L - 10) / 0.8), (v) => { L = Math.round(10 + v * 0.8); });
    const exact = mk("input", "cp-exact", { type: "color", "aria-label": "Exact colour" });
    const none = mk("button", "cp-none", { type: "button" }); none.textContent = "No color";
    const dot = mk("span", "cp-dot");
    const row = mk("div", "cp-row"); row.append(dot, exact, none);
    hue.track.classList.add("hue"); host.classList.add("cp"); host.append(hue.track, sat.track, lit.track, row);
    function sync(fire) {
      const hex = hslHex(H, S, L);
      hue.thumb.style.left = (H / 359 * 100) + "%"; sat.thumb.style.left = S + "%"; lit.thumb.style.left = ((L - 10) / 0.8) + "%";
      sat.track.style.background = `linear-gradient(90deg, ${hslHex(H, 0, L)}, ${hslHex(H, 100, L)})`;
      lit.track.style.background = `linear-gradient(90deg, ${hslHex(H, S, 10)}, ${hslHex(H, S, 50)}, ${hslHex(H, S, 90)})`;
      dot.style.background = on ? hex : "transparent"; dot.classList.toggle("empty", !on); none.classList.toggle("active", !on);
      if (on) exact.value = hex;
      if (fire) onPick(on ? hex : "");
    }
    exact.addEventListener("input", () => { [H, S, L] = hexHsl(exact.value); L = Math.max(10, Math.min(90, L)); on = true; sync(true); });
    none.addEventListener("click", () => { on = false; sync(true); });
    sync(false);
    return (hex) => { if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) { [H, S, L] = hexHsl(hex); L = Math.max(10, Math.min(90, L)); on = true; } else on = false; sync(false); };
  }
  return { menu, kebab, reorder, closeMenu, colorPicker, hslHex, hexHsl };
})();
