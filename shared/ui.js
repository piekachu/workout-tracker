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
  return { menu, kebab, reorder, closeMenu };
})();
