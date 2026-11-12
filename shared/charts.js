// Small dependency-free chart kit (inline SVG + DOM) for /progress/.
//
// Marks follow one fixed spec: bars <= 24px thick with a 4px rounded top and a
// square base, 2px lines, >= 8px end markers with a 2px surface ring, hairline
// solid gridlines. Colors come from the --chart-* tokens in theme.css (light
// and dark are separate selected steps there), applied through inline styles
// so a theme switch needs no re-render. Every chart is hover/tap-inspectable;
// the page adds a table view under each one.
window.Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, style = {}) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    Object.assign(e.style, style);
    return e;
  };

  // ---------- number formatting ----------
  const compact = (v) => (Math.abs(v) >= 10000 ? (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "K" : v.toLocaleString());

  // ~3 intervals on clean numbers; {lo, hi, step}
  function niceScale(min, max) {
    if (max <= min) max = min + 1;
    const raw = (max - min) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
    return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
  }

  // ---------- shared tooltip ----------
  let tip;
  function tipEl() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip"; tip.setAttribute("role", "status"); tip.hidden = true;
      document.body.appendChild(tip);
      document.addEventListener("pointerdown", (e) => { if (!e.target.closest("[data-chart]")) hideTip(); });
    }
    return tip;
  }
  function showTip(clientX, clientY, title, value) {
    const t = tipEl();
    t.innerHTML = ""; const a = document.createElement("div"); a.className = "t"; a.textContent = title;
    const b = document.createElement("div"); b.className = "v"; b.textContent = value; t.append(a, b);
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, clientX - w / 2)) + "px";
    t.style.top = Math.max(8, clientY - h - 14) + "px";
  }
  function hideTip() { if (tip) tip.hidden = true; }

  function empty(host, msg) {
    host.innerHTML = ""; const d = document.createElement("div");
    d.className = "chart-empty"; d.textContent = msg || "No data in this period"; host.appendChild(d);
  }

  // Re-render when the host's width changes (rotation, window resize).
  function responsive(host, draw) {
    host._draw = draw;
    if (!host._ro && "ResizeObserver" in window) {
      let last = 0;
      host._ro = new ResizeObserver(() => { const w = host.clientWidth; if (w && Math.abs(w - last) > 1) { last = w; host._draw(); } });
      host._ro.observe(host);
    }
    draw();
  }

  const M = { l: 40, r: 8, t: 18, b: 22 };

  function frame(host, height, scale, xTick, n, fmtTick) {
    const W = host.clientWidth || 320, H = height;
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" });
    root.setAttribute("data-chart", "");
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const y = (v) => M.t + ph - ((v - scale.lo) / (scale.hi - scale.lo)) * ph;
    for (let v = scale.lo; v <= scale.hi + 1e-9; v += scale.step) {
      root.append(svg("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), "stroke-width": 1 },
        { stroke: "var(--chart-grid)" }));
      const lab = svg("text", { x: M.l - 6, y: y(v) + 3.5, "text-anchor": "end", "font-size": 10 },
        { fill: "var(--text-dim)", fontFamily: "var(--font-mono)" });
      lab.textContent = (fmtTick || compact)(Math.round(v * 100) / 100); root.append(lab);
    }
    const band = pw / Math.max(n, 1), cx = (i) => M.l + band * (i + 0.5);
    for (let i = 0; i < n; i++) {
      const s = xTick(i); if (!s) continue;
      const lab = svg("text", { x: cx(i), y: H - 6, "text-anchor": "middle", "font-size": 10 },
        { fill: "var(--text-dim)", fontFamily: "var(--font-mono)" });
      lab.textContent = s; root.append(lab);
    }
    host.innerHTML = ""; host.appendChild(root);
    return { root, W, H, pw, ph, y, band, cx };
  }

  // ---------- bar / column ----------
  // opts: labels[], values[], xTick(i), tipTitle(i), tipValue(i), highlight?, height?, max?, fmtTick?, color?
  function bar(host, o) {
    const n = o.values.length;
    if (!n || !o.values.some((v) => v > 0)) return empty(host, o.emptyText);
    responsive(host, () => {
      const scale = niceScale(0, o.max != null ? o.max : Math.max(...o.values));
      const f = frame(host, o.height || 170, scale, o.xTick || (() => ""), n, o.fmtTick);
      const bw = Math.max(2, Math.min(24, f.band - 3)), base = f.y(0);
      const maxV = Math.max(...o.values);
      let labelled = false;
      o.values.forEach((v, i) => {
        if (v > 0) {
          const x0 = f.cx(i) - bw / 2, top = Math.min(f.y(v), base - 1), r = Math.min(4, bw / 2, base - top);
          const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${base}Z`;
          f.root.append(svg("path", { d }, { fill: o.color || "var(--chart-1)", opacity: o.highlight == null || o.highlight === i ? 1 : 0.55 }));
          if (!labelled && v === maxV && f.band >= 14) {         // label only the extreme
            labelled = true;
            const t = svg("text", { x: f.cx(i), y: top - 5, "text-anchor": "middle", "font-size": 10 },
              { fill: "var(--text-2)", fontFamily: "var(--font-mono)" });
            t.textContent = (o.fmtLabel || compact)(v); f.root.append(t);
          }
        }
        const hit = svg("rect", { x: f.cx(i) - f.band / 2, y: M.t, width: f.band, height: f.ph, fill: "transparent", tabindex: 0 });
        const show = (e) => { const r = hit.getBoundingClientRect(); showTip(e.clientX || r.left + r.width / 2, e.clientY || r.top, o.tipTitle(i), o.tipValue(i)); };
        hit.addEventListener("pointerenter", show); hit.addEventListener("pointermove", show);
        hit.addEventListener("pointerleave", hideTip); hit.addEventListener("click", show);
        hit.addEventListener("focus", show); hit.addEventListener("blur", hideTip);
        f.root.append(hit);
      });
    });
  }

  // ---------- line (sparse series allowed: null = no reading) ----------
  // opts: values[] (number|null), xTick(i), tipTitle(i), tipValue(i), zero?, min?, max?, height?
  function line(host, o) {
    const pts = o.values.map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (!pts.length) return empty(host, o.emptyText);
    responsive(host, () => {
      const vals = pts.map(([, v]) => v);
      let lo = o.min != null ? o.min : o.zero ? 0 : Math.min(...vals), hi = o.max != null ? o.max : Math.max(...vals);
      if (!o.zero && o.min == null) { const pad = (hi - lo || 1) * 0.25; lo -= pad; hi += pad; }
      const scale = niceScale(lo, hi);
      const f = frame(host, o.height || 170, scale, o.xTick || (() => ""), o.values.length, o.fmtTick);
      const X = (i) => f.cx(i), Y = (v) => f.y(v);
      const path = pts.map(([i, v], k) => `${k ? "L" : "M"}${X(i)},${Y(v)}`).join("");
      if (pts.length > 1) {
        f.root.append(svg("path", { d: `${path}L${X(pts[pts.length - 1][0])},${f.y(scale.lo)}L${X(pts[0][0])},${f.y(scale.lo)}Z` },
          { fill: "var(--chart-1)", opacity: 0.1 }));
        f.root.append(svg("path", { d: path, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" },
          { fill: "none", stroke: "var(--chart-1)" }));
      }
      const dot = (i, v) => f.root.append(svg("circle", { cx: X(i), cy: Y(v), r: 5, "stroke-width": 2 },
        { fill: "var(--chart-1)", stroke: "var(--surface)" }));
      const hi_ = vals.indexOf(Math.max(...vals)), lo_ = vals.indexOf(Math.min(...vals));
      pts.forEach(([i, v], k) => { if (pts.length <= 12 || k === pts.length - 1 || k === hi_ || k === lo_) dot(i, v); });

      const cross = svg("line", { y1: M.t, y2: M.t + f.ph, "stroke-width": 1 }, { stroke: "var(--text-faint)", display: "none" });
      const mark = svg("circle", { r: 5, "stroke-width": 2 }, { fill: "var(--chart-1)", stroke: "var(--surface)", display: "none" });
      f.root.append(cross, mark);
      const hit = svg("rect", { x: M.l, y: M.t, width: f.pw, height: f.ph, fill: "transparent" });
      const move = (e) => {
        const box = f.root.getBoundingClientRect(), px = e.clientX - box.left;
        let best = pts[0], bd = Infinity;
        for (const p of pts) { const d = Math.abs(X(p[0]) - px); if (d < bd) { bd = d; best = p; } }
        cross.setAttribute("x1", X(best[0])); cross.setAttribute("x2", X(best[0])); cross.style.display = "";
        mark.setAttribute("cx", X(best[0])); mark.setAttribute("cy", Y(best[1])); mark.style.display = "";
        showTip(box.left + X(best[0]), box.top + Y(best[1]), o.tipTitle(best[0]), o.tipValue(best[0]));
      };
      hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
      hit.addEventListener("pointerleave", () => { cross.style.display = "none"; mark.style.display = "none"; hideTip(); });
      f.root.append(hit);
    });
  }

  // ---------- consistency matrix: rows of habits x columns of days ----------
  // opts: days[] (ISO), rows[{label, on(iso)->bool, tip(iso)->string}], today, dayLabel(iso, i)
  function matrix(host, o) {
    host.innerHTML = "";
    const n = o.days.length;
    const grid = document.createElement("div");
    grid.className = "matrix"; grid.setAttribute("data-chart", "");
    grid.style.gridTemplateColumns = `76px repeat(${n}, minmax(0, 1fr))`;
    grid.append(document.createElement("span"));
    o.days.forEach((d, i) => {
      const s = document.createElement("span"); s.className = "mx-day" + (d === o.today ? " today" : "");
      s.textContent = o.dayLabel(d, i); grid.append(s);
    });
    for (const row of o.rows) {
      const lab = document.createElement("span"); lab.className = "mx-label"; lab.textContent = row.label; grid.append(lab);
      for (const d of o.days) {
        const c = document.createElement("button");
        const on = row.on(d);
        c.type = "button"; c.className = "mx-cell" + (on ? " on" : "") + (d === o.today ? " today" : "");
        c.setAttribute("aria-label", `${row.label}, ${d}: ${on ? "done" : "not done"}`);
        const show = (e) => { const r = c.getBoundingClientRect(); showTip(e.clientX || r.left + r.width / 2, e.clientY || r.top, row.label, row.tip(d)); };
        c.addEventListener("pointerenter", show); c.addEventListener("pointerleave", hideTip); c.addEventListener("click", show);
        grid.append(c);
      }
    }
    host.append(grid);
  }

  // ---------- horizontal ranked bars (parts of a whole) ----------
  function hbar(host, items, fmt) {
    host.innerHTML = "";
    if (!items.length) return empty(host);
    const max = Math.max(...items.map((i) => i.value));
    const list = document.createElement("div"); list.className = "hbars";
    for (const it of items) {
      const row = document.createElement("div"); row.className = "hb-row";
      const name = document.createElement("span"); name.className = "hb-name"; name.textContent = it.label;
      const val = document.createElement("span"); val.className = "hb-val"; val.textContent = fmt(it.value);
      const track = document.createElement("span"); track.className = "hb-track";
      const fill = document.createElement("i"); fill.style.width = Math.max(2, (it.value / max) * 100) + "%"; track.append(fill);
      row.append(name, val, track); list.append(row);
    }
    host.append(list);
  }

  // ---------- table view (screen-reader / precise-number fallback) ----------
  function table(headers, rows) {
    const d = document.createElement("details"); d.className = "chart-table";
    const s = document.createElement("summary"); s.textContent = "Table view"; d.append(s);
    const t = document.createElement("table");
    const thead = document.createElement("tr"); headers.forEach((h) => { const th = document.createElement("th"); th.textContent = h; thead.append(th); });
    t.append(thead);
    rows.forEach((r) => { const tr = document.createElement("tr"); r.forEach((c) => { const td = document.createElement("td"); td.textContent = c; tr.append(td); }); t.append(tr); });
    d.append(t); return d;
  }

  return { bar, line, matrix, hbar, table, hideTip, compact };
})();
