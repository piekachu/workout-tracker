const sb = Auth.client;
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}
let toastTimer;
function toast(msg, undo) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show"); t.classList.toggle("act", !!undo);
  if (undo) t.append(el("button", { type: "button", onclick: () => { t.classList.remove("show"); undo(); } }, "Undo"));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), undo ? 7000 : 2600);
}
const pad = (n) => String(n).padStart(2, "0");
const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Currency follows the Expenses page setting (KRW by default).
let CUR = "KRW";
try { const c = localStorage.getItem("expenses.currency"); if (c === "USD" || c === "KRW") CUR = c; } catch {}
const CURS = { KRW: { sym: "₩", locale: "ko-KR", digits: 0 }, USD: { sym: "$", locale: "en-US", digits: 2 } };
const money = (v) => CURS[CUR].sym + Number(v || 0).toLocaleString(CURS[CUR].locale, { minimumFractionDigits: 0, maximumFractionDigits: CURS[CUR].digits });

let series = [], items = [], byId = new Map();
const marks = new Map();            // item id -> { status, price, qty, on }
const open = new Set();             // series indexes the user expanded
let status = "all", year = "all", query = "";
let ready = false;
const st = (id) => (marks.get(id) || {}).status || null;

// ---- data ----
const COLS = "item_id,status,price,qty,bought_on";
const fromRow = (r) => ({ status: r.status, price: r.price == null ? null : Number(r.price), qty: r.qty || 1, on: r.bought_on || null });
async function init() {
  try {
    const cat = await (await fetch("catalog.json")).json();
    series = cat.series; items = cat.items; items.forEach((i) => byId.set(i.id, i));
  } catch { toast("Couldn't load the list"); return; }
  const years = [...new Set(series.map((s) => s.year))].filter(Boolean).sort((a, b) => b - a);
  $("year").append(el("option", { value: "all" }, "All years"), ...years.map((y) => el("option", { value: y }, String(y))));
  $("buy-cur").textContent = `(${CURS[CUR].sym})`;
  render();
  for (let from = 0; ; from += 1000) {                 // paged: the API caps a response at 1000 rows
    const { data, error } = await sb.from("collection").select(COLS).order("item_id").range(from, from + 999);
    if (error) { toast("Couldn't load your marks — check your connection"); return; }
    (data || []).forEach((r) => marks.set(r.item_id, fromRow(r)));
    if (!data || data.length < 1000) break;
  }
  ready = true;
  render();
}
const toRow = (id, m) => ({ item_id: id, status: m.status, price: m.price, qty: m.qty, bought_on: m.on });

// Write full records (or delete when rec is null) with an optimistic update and rollback on error.
async function commit(ids, make) {
  if (!ready) { toast("Still loading your marks…"); return; }
  const prev = ids.map((id) => [id, marks.get(id) || null]);
  const rows = [], gone = [];
  ids.forEach((id) => { const rec = make(marks.get(id) || null, id); if (rec) { marks.set(id, rec); rows.push(toRow(id, rec)); } else { marks.delete(id); gone.push(id); } });
  render();
  let error;
  if (rows.length) ({ error } = await sb.from("collection").upsert(rows, { onConflict: "user_id,item_id" }));
  if (!error && gone.length) ({ error } = await sb.from("collection").delete().in("item_id", gone));
  if (error) {
    prev.forEach(([id, rec]) => rec ? marks.set(id, rec) : marks.delete(id));
    render(); toast("Couldn't save — check your connection");
  }
}
// Change only the status. Price/quantity/date belong to "owned", so they're dropped on any other status.
const setStatus = (ids, next) => commit(ids, (old) => !next ? null
  : next === "owned" ? { status: "owned", price: old && old.status === "owned" ? old.price : null, qty: old && old.status === "owned" ? old.qty : 1, on: old && old.status === "owned" ? old.on : null }
  : { status: next, price: null, qty: 1, on: null });

// Bulk/destructive change with an Undo toast instead of a confirm() dialog.
function undoable(label, ids, next) {
  if (!ids.length) return;
  const before = new Map(ids.map((id) => [id, marks.get(id) || null]));
  setStatus(ids, next);
  toast(label, () => commit(ids, (old, id) => before.get(id)));
}

// ---- derived numbers ----
function compute() {
  const c = { total: items.length, removed: 0, owned: 0, wish: 0, skip: 0, secret: 0, qty: 0, spent: 0, priced: 0, unpriced: 0 };
  const yr = new Map(), mon = new Map(), ser = series.map(() => ({ owned: 0, tracked: 0, spent: 0 }));
  for (const it of items) {
    const m = marks.get(it.id), s = m && m.status, sr = series[it.s], y = sr.year, S = ser[it.s];
    if (s === "removed") { c.removed++; continue; }
    if (s !== "skip") { S.tracked++; if (y) { const o = yr.get(y) || { owned: 0, tracked: 0 }; o.tracked++; if (s === "owned") o.owned++; yr.set(y, o); } }
    if (s === "owned") {
      c.owned++; S.owned++; if (it.secret) c.secret++; c.qty += m.qty;
      if (m.price != null) { const amt = m.price * m.qty; c.spent += amt; c.priced += m.qty; S.spent += amt; if (m.on) { const k = m.on.slice(0, 7); mon.set(k, (mon.get(k) || 0) + amt); } }
      else c.unpriced += m.qty;
    } else if (s === "wishlist") c.wish++;
    else if (s === "skip") c.skip++;
  }
  c.total -= c.removed; c.tracked = c.total - c.skip; c.missing = c.tracked - c.owned;
  return { c, yr, mon, ser };
}

// ---- rendering ----
const matches = (it) => {
  const s = st(it.id);
  if (status === "removed") return s === "removed" && (!query || (it.name + " " + (it.no || "")).toLowerCase().includes(query));
  if (s === "removed") return false;
  if (status === "owned" && s !== "owned") return false;
  if (status === "wishlist" && s !== "wishlist") return false;
  if (status === "skip" && s !== "skip") return false;
  if (status === "missing" && (s === "owned" || s === "skip")) return false;
  if (query && !(it.name + " " + (it.no || "")).toLowerCase().includes(query)) return false;
  return true;
};
const shortName = (n) => n.replace(/^Gundam Converge\s*:?\s*/, "") || n;

function summary(d) {
  const { c } = d;
  $("s-owned").textContent = c.owned; $("s-owned-sub").textContent = `of ${c.tracked} wanted`;
  $("s-miss").textContent = c.missing; $("s-wish").textContent = c.wish; $("s-skip").textContent = c.skip; $("s-removed").textContent = c.removed ? `${c.removed} deleted` : ""; $("s-secret").textContent = c.secret;
  $("s-spent").textContent = money(c.spent);
  $("s-spent-sub").textContent = c.unpriced ? `${c.unpriced} owned without a price` : (c.priced ? "all owned items priced" : "");
  $("s-bought").textContent = c.qty;
  $("s-avg").textContent = c.priced ? money(c.spent / c.priced) : "–";
  Charts.ring($("c-ring"), { size: 104, value: c.owned, total: c.tracked, big: c.tracked ? Math.round(c.owned / c.tracked * 100) + "%" : "–",
    small: `${c.owned}/${c.tracked}`, aria: `${c.owned} of ${c.tracked} wanted figures owned` });
}

function charts(d) {
  const { c, yr, mon, ser } = d;
  // status donut
  const segs = [
    { label: "Owned", value: c.owned, color: "var(--chart-3)" }, { label: "Wishlist", value: c.wish, color: "var(--chart-4)" },
    { label: "Missing", value: Math.max(0, c.missing - c.wish), color: "var(--chart-1)" }, { label: "Skipped", value: c.skip, color: "var(--text-faint)" }];
  const sh = $("ch-status"); sh.textContent = "";
  const dn = el("div"); sh.append(el("div", { class: "status-row" }, dn,
    Charts.legend(segs.map((s) => ({ label: s.label, color: s.color, text: String(s.value) })))));
  Charts.donut(dn, { segments: segs, size: 150, big: String(c.total), small: "figures", aria: "Figures by status",
    tipValue: (s, share) => `${s.value} (${Math.round(share * 100)}%)` });
  // completion by year
  const ys = [...yr.keys()].sort((a, b) => a - b);
  Charts.bar($("ch-year"), { labels: ys.map(String), values: ys.map((y) => yr.get(y).tracked ? Math.round(yr.get(y).owned / yr.get(y).tracked * 100) : 0),
    max: 100, height: 190, color: "var(--chart-1)", emptyText: "Mark figures as owned to see progress by year.",
    xTick: (i) => (ys.length > 9 && i % 2) ? "" : "’" + String(ys[i]).slice(2), fmtTick: (v) => v + "%",
    tipTitle: (i) => String(ys[i]), tipValue: (i) => `${yr.get(ys[i]).owned} of ${yr.get(ys[i]).tracked} owned` });
  // spend by month (dated purchases only)
  const ks = [...mon.keys()].sort(); let months = [];
  if (ks.length) {
    let [y, m] = ks[0].split("-").map(Number); const [ey, em] = ks[ks.length - 1].split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) { months.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
    months = months.slice(-18);
  }
  $("ch-month-meta").textContent = c.priced ? "dated purchases" : "";
  Charts.bar($("ch-month"), { labels: months, values: months.map((k) => mon.get(k) || 0), height: 190, color: "var(--chart-2)",
    emptyText: "Record a price and purchase date on owned figures to see spending over time.",
    xTick: (i) => (months.length > 12 && i % 2) ? "" : new Date(months[i] + "-15").toLocaleDateString(undefined, { month: "short" }) + (months[i].endsWith("-01") || i === 0 ? " ’" + months[i].slice(2, 4) : ""),
    fmtTick: (v) => CURS[CUR].sym + Charts.compact(v), tipTitle: (i) => new Date(months[i] + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" }), tipValue: (i) => money(mon.get(months[i]) || 0) });
  // spend by series
  const top = series.map((s, i) => ({ label: shortName(s.name), value: ser[i].spent })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
  const th = $("ch-series"); th.textContent = "";
  if (!top.length) th.append(el("p", { class: "empty" }, "Prices you record will rank the series here."));
  else Charts.hbar(th, top, money);
}

function render() {
  if (!items.length) return;
  const d = compute(); summary(d); charts(d);
  const filtering = status !== "all" || !!query;  // "removed" also counts, so those series open
  const bySeries = series.map(() => []);
  items.forEach((it) => bySeries[it.s].push(it));
  const host = $("list"); host.textContent = "";
  let shown = 0;
  series.forEach((s, i) => {
    if (year !== "all" && String(s.year) !== year) return;
    const all = bySeries[i], vis = all.filter(matches);
    if ((filtering || status === "removed") && !vis.length) return;
    if (!vis.length && all.every((x) => st(x.id) === "removed")) return;
    shown++;
    const S = d.ser[i], isOpen = open.has(i) || (filtering && vis.length > 0);
    const g = el("div", { class: "grp" + (isOpen ? " open" : "") + (S.tracked > 0 && S.owned === S.tracked ? " done" : "") });
    g.append(el("button", { type: "button", class: "grp-h", "aria-expanded": String(isOpen), onclick: () => { open.has(i) ? open.delete(i) : open.add(i); render(); } },
      Object.assign(el("span", { class: "chev" }), { innerHTML: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      el("span", { class: "nm" }, shortName(s.name)), S.spent ? el("span", { class: "sp" }, money(S.spent)) : null,
      el("span", { class: "dt" }, s.date || ""), el("span", { class: "bar" }, el("i")), el("span", { class: "ct" }, S.tracked ? `${S.owned}/${S.tracked}` : "skipped")));
    g.querySelector(".bar i").style.width = (S.tracked ? S.owned / S.tracked * 100 : 0) + "%";
    if (isOpen) {
      const body = el("div", { class: "grp-body" });
      body.append(el("div", { class: "grp-tools" },
        el("button", { type: "button", onclick: () => setStatus(all.filter((x) => !["owned", "skip", "removed"].includes(st(x.id))).map((x) => x.id), "owned") }, "Mark all owned"),
        el("button", { type: "button", onclick: () => { const ids = all.filter((x) => !["owned", "skip", "removed"].includes(st(x.id))).map((x) => x.id); undoable(`Skipped ${ids.length}`, ids, "skip"); } }, "Skip all"),
        el("button", { type: "button", onclick: () => { const ids = all.filter((x) => marks.has(x.id) && st(x.id) !== "removed").map((x) => x.id); undoable(`Cleared ${ids.length}`, ids, null); } }, "Clear all")));
      vis.forEach((it) => body.append(row(it)));
      g.append(body);
    }
    host.append(g);
  });
  if (!shown) host.append(el("p", { class: "empty" }, filtering ? "Nothing matches." : "No series."));
  $("toggle-all").textContent = open.size ? "Collapse all" : "Expand all";
}

function row(it) {
  const m = marks.get(it.id), s = m && m.status;
  const label = m && m.price != null ? money(m.price * m.qty) + (m.qty > 1 ? ` ×${m.qty}` : "") : (m && m.qty > 1 ? `×${m.qty}` : "+ price");
  return el("div", { class: "it" + (s ? " " + (s === "wishlist" ? "wish" : s) : ""), role: "checkbox", tabindex: "0", "aria-checked": String(s === "owned"),
    onclick: () => { if (s !== "removed") setStatus([it.id], s === "owned" ? null : "owned"); },
    onkeydown: (e) => { if (s !== "removed" && e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setStatus([it.id], s === "owned" ? null : "owned"); } } },
    el("span", { class: "ck" }, "✓"), el("span", { class: "no" }, it.no || "·"), el("span", { class: "nm" }, it.name),
    it.secret ? el("span", { class: "tag" }, "Secret") : null,
    el("button", { type: "button", class: "price" + (m && m.price != null ? " set" : ""), "aria-label": "Price and quantity", onclick: (e) => { e.stopPropagation(); editBuy(it); } }, label),
    el("button", { type: "button", class: "st", "aria-label": s === "wishlist" ? "Remove from wishlist" : "Add to wishlist",
      onclick: (e) => { e.stopPropagation(); setStatus([it.id], s === "wishlist" ? null : "wishlist"); } }, s === "wishlist" ? "★" : "☆"),
    el("button", { type: "button", class: "st skipb", "aria-label": s === "skip" ? "Want this again" : "Don't want this (skip)",
      onclick: (e) => { e.stopPropagation(); setStatus([it.id], s === "skip" ? null : "skip"); } }, "⊘"),
    el("button", { type: "button", class: "st delb", "aria-label": "Delete from my list", title: "Delete from my list",
      onclick: (e) => { e.stopPropagation(); undoable("Deleted “" + it.name + "”", [it.id], "removed"); } }, "✕"),
    el("button", { type: "button", class: "restore", onclick: (e) => { e.stopPropagation(); setStatus([it.id], null); } }, "Restore"));
}

// ---- purchase editor ----
let editing = null;
function editBuy(it) {
  const m = marks.get(it.id); if (!m || m.status !== "owned") return;
  editing = it.id; $("buy-title").textContent = it.name;
  $("b-price").value = m.price == null ? "" : m.price; $("b-qty").value = m.qty; $("b-date").value = m.on || "";
  $("b-price").step = CUR === "KRW" ? "1" : "0.01"; calcTotal(); $("buy-dlg").showModal();
}
function calcTotal() {
  const p = parseFloat($("b-price").value), q = Math.max(1, parseInt($("b-qty").value, 10) || 1);
  $("b-total").textContent = isNaN(p) ? "Leave the price empty if you don't know it." : `Total: ${money(p * q)}`;
}
$("b-price").addEventListener("input", calcTotal); $("b-qty").addEventListener("input", calcTotal);
$("b-cancel").addEventListener("click", () => $("buy-dlg").close());
$("buy-form").addEventListener("submit", () => {
  const id = editing; if (!id) return;
  const p = parseFloat($("b-price").value), q = Math.max(1, parseInt($("b-qty").value, 10) || 1), on = $("b-date").value || null;
  commit([id], (old) => old && old.status === "owned" ? { status: "owned", price: isNaN(p) || p < 0 ? null : p, qty: q, on } : old);
});

// ---- controls ----
$("q").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });
$("year").addEventListener("change", (e) => { year = e.target.value; render(); });
$("status-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  status = b.dataset.v;
  $("status-seg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  render();
});
$("toggle-all").addEventListener("click", () => {
  if (open.size) open.clear();
  else series.forEach((s, i) => { if (year === "all" || String(s.year) === year) open.add(i); });
  render();
});
init();
