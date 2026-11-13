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

let baseSeries = [], baseItems = [], series = [], items = [], byId = new Map();
const edits = new Map();            // catalogue item id -> {name, no, cat} overrides (null = not overridden)
let added = [], customCats = [];    // figures and category names the user created
const marks = new Map();            // item id -> { status, price, qty, on }
const open = new Set();             // series indexes the user expanded
let status = "all", year = "all", cat = "all", fr = "all", my = "all", query = "";
let CATS = [], FRS = [];            // the fixed categories and the franchise list (from catalog.json)
let ready = false;
const st = (id) => (marks.get(id) || {}).status || null;

// ---- data ----
// Merge the static catalogue with the user's edits and additions into the working lists.
function rebuild() {
  series = baseSeries.slice();
  const sIdx = new Map(series.map((x, i) => [x.name, i]));
  items = baseItems.map((b) => {
    const e = edits.get(b.id) || {}, sr = series[b.s];
    return { id: b.id, s: b.s, secret: b.secret, no: e.no != null ? e.no : b.no, name: e.name || b.name,
      cat: sr.cat, fr: e.fr || b.fr, my: e.cat || null,                 // fixed category / franchise / my own category
      base: { no: b.no || "", name: b.name, fr: b.fr }, edited: !!(e.name || e.no != null || e.cat || e.fr) };
  });
  for (const a of added) {
    let i = sIdx.get(a.series_name);
    if (i == null) { i = series.length; series.push({ name: a.series_name, date: "", year: null, cat: a.base_cat || "Classics", virtual: true }); sIdx.set(a.series_name, i); }
    items.push({ id: a.id, s: i, secret: false, no: a.no || "", name: a.name, cat: a.base_cat || "Classics", fr: a.fr || "Other", my: a.cat || null, custom: true, base: null, edited: false });
  }
  byId = new Map(items.map((i) => [i.id, i]));
  fillCats();
}
const myCats = () => [...new Set([...customCats, ...items.map((i) => i.my).filter(Boolean)])];
function fillCats() {
  const fill = (id, label, list, keep, extra) => {
    const sel = $(id); sel.textContent = "";
    sel.append(el("option", { value: "all" }, label), ...(extra || []), ...list.map((c) => el("option", { value: c }, c)));
    const ok = keep === "all" || list.includes(keep) || (extra && keep === "__none"); sel.value = ok ? keep : "all"; return sel.value;
  };
  cat = fill("cat", "All categories", CATS, cat);
  const cnt = new Map(); items.forEach((i) => cnt.set(i.fr, (cnt.get(i.fr) || 0) + 1));
  fr = fill("fr", "All series", FRS.filter((f) => cnt.get(f)).sort((a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0)), fr);
  my = fill("my", "All my categories", myCats(), my, [el("option", { value: "__none" }, "No category of mine")]);
  $("series-list").textContent = "";
  $("series-list").append(...series.map((x) => el("option", { value: x.name })));
}
const seriesCat = (i, list) => { const cs = new Set(list.map((x) => x.cat)); return cs.size === 1 ? [...cs][0] : "Mixed"; };

const COLS = "item_id,status,price,qty,bought_on";
const fromRow = (r) => ({ status: r.status, price: r.price == null ? null : Number(r.price), qty: r.qty || 1, on: r.bought_on || null });
async function init() {
  try {
    const cat = await (await fetch("catalog.json")).json();
    baseSeries = cat.series; baseItems = cat.items; CATS = cat.categories; FRS = cat.franchises;
  } catch { toast("Couldn't load the list"); return; }
  const years = [...new Set(baseSeries.map((s) => s.year))].filter(Boolean).sort((a, b) => b - a);
  $("year").append(el("option", { value: "all" }, "All years"), ...years.map((y) => el("option", { value: y }, String(y))));
  $("buy-cur").textContent = `(${CURS[CUR].sym})`;
  rebuild(); render();
  const [ed, ad, cc] = await Promise.all([sb.from("collection_edits").select("*").limit(5000), sb.from("collection_added").select("*").order("created_at").limit(5000), sb.from("collection_cats").select("name").order("name")]);
  if (ed.error || ad.error || cc.error) toast("Couldn't load your edits — check your connection");
  (ed.data || []).forEach((r) => edits.set(r.item_id, { name: r.name, no: r.no, cat: r.cat, fr: r.fr }));
  added = ad.data || []; customCats = (cc.data || []).map((r) => r.name);
  rebuild(); render();
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
  const frs = new Map(), mys = new Map(), cats = new Map(), yr = new Map(), mon = new Map(), ser = series.map(() => ({ owned: 0, tracked: 0, spent: 0 }));
  for (const it of items) {
    const m = marks.get(it.id), s = m && m.status, sr = series[it.s], y = sr.year, S = ser[it.s];
    if (s === "removed") { c.removed++; continue; }
    const K = cats.get(it.cat) || cats.set(it.cat, { owned: 0, tracked: 0, spent: 0 }).get(it.cat);
    const F = frs.get(it.fr) || frs.set(it.fr, { owned: 0, tracked: 0, spent: 0 }).get(it.fr);
    const M = it.my ? (mys.get(it.my) || mys.set(it.my, { owned: 0, tracked: 0, spent: 0 }).get(it.my)) : null;
    if (s !== "skip") { K.tracked++; F.tracked++; if (M) M.tracked++; }
    if (s !== "skip") { S.tracked++; if (y) { const o = yr.get(y) || { owned: 0, tracked: 0 }; o.tracked++; if (s === "owned") o.owned++; yr.set(y, o); } }
    if (s === "owned") {
      c.owned++; S.owned++; K.owned++; F.owned++; if (M) M.owned++; if (it.secret) c.secret++; c.qty += m.qty;
      if (m.price != null) { const amt = m.price * m.qty; c.spent += amt; c.priced += m.qty; S.spent += amt; K.spent += amt; F.spent += amt; if (M) M.spent += amt; if (m.on) { const k = m.on.slice(0, 7); mon.set(k, (mon.get(k) || 0) + amt); } }
      else c.unpriced += m.qty;
    } else if (s === "wishlist") c.wish++;
    else if (s === "skip") c.skip++;
  }
  c.total -= c.removed; c.tracked = c.total - c.skip; c.missing = c.tracked - c.owned;
  return { c, yr, mon, ser, cats, frs, mys };
}

// ---- rendering ----
const matches = (it) => {
  const s = st(it.id);
  if (cat !== "all" && it.cat !== cat) return false;
  if (fr !== "all" && it.fr !== fr) return false;
  if (my !== "all" && (my === "__none" ? !!it.my : it.my !== my)) return false;
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
  // progress / spend per fixed category, per series (franchise) and per my category
  const prog = (id, map, order, emptyMsg) => {
    const h = $(id); h.textContent = "";
    const rows = (order || [...map.keys()]).filter((k) => map.has(k) && map.get(k).tracked > 0).map((k) => [k, map.get(k)]);
    if (!rows.length) { h.append(el("p", { class: "empty" }, emptyMsg || "Nothing to show yet.")); return; }
    Charts.hbar(h, rows.map(([k, v]) => ({ label: `${k} · ${v.owned}/${v.tracked}`, value: Math.round(v.owned / v.tracked * 100) })), (v) => v + "%");
  };
  const spend = (id, map, msg) => {
    const h = $(id); h.textContent = "";
    const rows = [...map].filter(([, v]) => v.spent > 0).sort((a, b) => b[1].spent - a[1].spent).slice(0, 10).map(([k, v]) => ({ label: k, value: v.spent }));
    if (!rows.length) h.append(el("p", { class: "empty" }, msg)); else Charts.hbar(h, rows, money);
  };
  prog("ch-cat", d.cats, CATS);
  prog("ch-fr", d.frs, [...d.frs.keys()].sort((a, b) => d.frs.get(b).tracked - d.frs.get(a).tracked));
  prog("ch-my", d.mys, [...d.mys.keys()].sort(), "Make your own categories (Categories button) and tag figures to see progress here.");
  spend("ch-catspend", d.cats, "Prices you record will rank the categories here.");
  spend("ch-frspend", d.frs, "Prices you record will rank the series here.");
}

function render() {
  if (!items.length) return;
  const d = compute(); summary(d); charts(d);
  const filtering = status !== "all" || !!query || cat !== "all" || fr !== "all" || my !== "all";  // "removed" also counts, so those series open
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
      el("span", { class: "nm" }, shortName(s.name)), el("span", { class: "cat" }, seriesCat(i, all)), S.spent ? el("span", { class: "sp" }, money(S.spent)) : null,
      el("span", { class: "dt" }, s.date || ""), el("span", { class: "bar" }, el("i")), el("span", { class: "ct" }, S.tracked ? `${S.owned}/${S.tracked}` : "skipped")));
    g.querySelector(".bar i").style.width = (S.tracked ? S.owned / S.tracked * 100 : 0) + "%";
    if (isOpen) {
      const body = el("div", { class: "grp-body" });
      body.append(el("div", { class: "grp-tools" },
        el("button", { type: "button", onclick: () => setStatus(all.filter((x) => !["owned", "skip", "removed"].includes(st(x.id))).map((x) => x.id), "owned") }, "Mark all owned"),
        el("button", { type: "button", onclick: () => { const ids = all.filter((x) => !["owned", "skip", "removed"].includes(st(x.id))).map((x) => x.id); undoable(`Skipped ${ids.length}`, ids, "skip"); } }, "Skip all"),
        el("button", { type: "button", onclick: () => { const ids = all.filter((x) => marks.has(x.id) && st(x.id) !== "removed").map((x) => x.id); undoable(`Cleared ${ids.length}`, ids, null); } }, "Clear all")));
      body.querySelector(".grp-tools").append(el("select", { class: "mv", "aria-label": "Move series to category", onchange: async (e) => {
        const v = e.target.value; if (v === "") return;
        await moveCat(all, v === "__default" ? null : v); }},
        el("option", { value: "" }, "Set my category…"), el("option", { value: "__default" }, "↺ No category of mine"), ...myCats().map((c) => el("option", { value: c }, c))));
      vis.forEach((it) => body.append(row(it)));
      g.append(body);
    }
    host.append(g);
  });
  if (!shown) host.append(el("p", { class: "empty" }, filtering ? "Nothing matches." : "No series."));
  $("toggle-all").textContent = open.size ? "Collapse all" : "Expand all";
}

const actsOpen = new Set();           // rows whose action buttons are shown on phones
function row(it) {
  const m = marks.get(it.id), s = m && m.status;
  const label = m && m.price != null ? money(m.price * m.qty) + (m.qty > 1 ? ` ×${m.qty}` : "") : (m && m.qty > 1 ? `×${m.qty}` : "+ price");
  return el("div", { class: "it" + (actsOpen.has(it.id) ? " acts-open" : "") + (s ? " " + (s === "wishlist" ? "wish" : s) : ""), role: "checkbox", tabindex: "0", "aria-checked": String(s === "owned"),
    onclick: () => { if (s !== "removed") setStatus([it.id], s === "owned" ? null : "owned"); },
    onkeydown: (e) => { if (s !== "removed" && e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setStatus([it.id], s === "owned" ? null : "owned"); } } },
    el("span", { class: "ck" }, "✓"), el("span", { class: "no" }, it.no || "·"), el("span", { class: "nm" }, it.name),
    it.secret ? el("span", { class: "tag" }, "Secret") : null, el("span", { class: "frn" }, it.fr), it.my ? el("span", { class: "tag cattag" }, it.my) : null,
    el("button", { type: "button", class: "price" + (m && m.price != null ? " set" : ""), "aria-label": "Price and quantity", onclick: (e) => { e.stopPropagation(); editBuy(it); } }, label),
    el("button", { type: "button", class: "more", "aria-label": "More actions", onclick: (e) => { e.stopPropagation(); actsOpen.has(it.id) ? actsOpen.delete(it.id) : actsOpen.add(it.id); e.currentTarget.closest(".it").classList.toggle("acts-open"); } }, "⋯"),
    el("span", { class: "acts" },
    el("button", { type: "button", class: "st", "aria-label": s === "wishlist" ? "Remove from wishlist" : "Add to wishlist",
      onclick: (e) => { e.stopPropagation(); setStatus([it.id], s === "wishlist" ? null : "wishlist"); } }, s === "wishlist" ? "★" : "☆"),
    el("button", { type: "button", class: "st skipb", "aria-label": s === "skip" ? "Want this again" : "Don't want this (skip)",
      onclick: (e) => { e.stopPropagation(); setStatus([it.id], s === "skip" ? null : "skip"); } }, "⊘"),
    el("button", { type: "button", class: "st delb", "aria-label": "Delete from my list", title: "Delete from my list",
      onclick: (e) => { e.stopPropagation(); undoable("Deleted “" + it.name + "”", [it.id], "removed"); } }, "✕"),
    el("button", { type: "button", class: "st editb", "aria-label": "Edit", title: "Edit", onclick: (e) => { e.stopPropagation(); openEdit(it); } }, "✎")),
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

// ---- editing: figures, categories ----
async function applyEdit(it, v) {          // v: {name?, no?, cat? (MY category, ""/null = none), fr?, base_cat? (own figures only)}
  if (it.custom) {
    const a = added.find((x) => x.id === it.id);
    const row = { name: v.name !== undefined ? v.name : a.name, no: v.no !== undefined ? v.no : a.no, cat: v.cat !== undefined ? (v.cat || null) : a.cat,
      fr: v.fr !== undefined ? v.fr : a.fr, base_cat: v.base_cat !== undefined ? v.base_cat : a.base_cat };
    const { error } = await sb.from("collection_added").update(row).eq("id", it.id);
    if (error) return false; Object.assign(a, row); return true;
  }
  const cur = edits.get(it.id) || {};
  const rec = {
    name: v.name !== undefined ? (v.name !== it.base.name ? v.name : null) : (cur.name ?? null),
    no: v.no !== undefined ? (v.no !== it.base.no ? v.no : null) : (cur.no ?? null),
    cat: v.cat !== undefined ? (v.cat || null) : (cur.cat ?? null),
    fr: v.fr !== undefined ? (v.fr && v.fr !== it.base.fr ? v.fr : null) : (cur.fr ?? null) };
  const empty = rec.name == null && rec.no == null && rec.cat == null && rec.fr == null;
  const { error } = empty ? await sb.from("collection_edits").delete().eq("item_id", it.id) : await sb.from("collection_edits").upsert({ item_id: it.id, ...rec }, { onConflict: "user_id,item_id" });
  if (error) return false;
  empty ? edits.delete(it.id) : edits.set(it.id, rec); return true;
}
async function moveCat(list, value) {
  const res = await Promise.all(list.map((it) => applyEdit(it, { cat: value })));
  rebuild(); render();
  toast(res.every(Boolean) ? (value ? `Tagged ${list.length} figure${list.length === 1 ? "" : "s"} “${value}”` : `Cleared my category`) : "Some changes didn't save — check your connection");
}
let editTarget = null;                                     // figure being edited, or "new"
function fillSel(sel, opts, keep, first) {
  sel.textContent = ""; if (first != null) sel.append(el("option", { value: "" }, first));
  sel.append(...opts.map((c) => el("option", { value: c }, c))); sel.value = keep || "";
}
function openEdit(it) {
  editTarget = it || "new";
  $("e-title").textContent = it ? "Edit figure" : "Add a figure";
  $("e-name").value = it ? it.name : ""; $("e-no").value = it ? (it.no || "") : "";
  fillSel($("e-fr"), FRS, it ? it.fr : "Universal Century");
  fillSel($("e-cat"), myCats(), it ? it.my : "", "None");
  const own = !it || it.custom;                                          // fixed category can only be chosen for figures you add yourself
  $("e-fixed-wrap").style.display = own ? "" : "none";
  fillSel($("e-fixed"), CATS, it ? it.cat : (CATS.includes(cat) ? cat : "Classics"));
  $("e-fixed-note").style.display = own ? "none" : "";
  $("e-fixed-note").textContent = it ? `Category: ${it.cat} (fixed)` : "";
  $("e-series-wrap").style.display = it ? "none" : "";
  $("e-series").value = it ? "" : "My additions";
  $("e-reset").style.display = it && it.edited ? "" : "none";
  $("e-del").style.display = it && it.custom ? "" : "none";
  $("e-dlg").showModal(); $("e-name").focus();
}
$("add-fig").addEventListener("click", () => openEdit(null));
$("e-cancel").addEventListener("click", () => $("e-dlg").close());
$("e-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = $("e-name").value.trim(); if (!name) { $("e-name").focus(); return; }
  const no = $("e-no").value.trim(), c = $("e-cat").value, f = $("e-fr").value, fixed = $("e-fixed").value;
  if (editTarget === "new") {
    const row = { name, no: no || null, cat: c || null, fr: f, base_cat: fixed, series_name: $("e-series").value.trim() || "My additions" };
    const { data, error } = await sb.from("collection_added").insert(row).select("id").single();
    if (error || !data) { toast("Couldn't add it — check your connection"); return; }
    added.push({ id: data.id, ...row }); rebuild(); render(); toast(`Added “${name}”`);
  } else {
    const ok = await applyEdit(editTarget, editTarget.custom ? { name, no, cat: c, fr: f, base_cat: fixed } : { name, no, cat: c, fr: f });
    rebuild(); render(); toast(ok ? "Saved" : "Couldn't save — check your connection");
  }
  $("e-dlg").close();
});
$("e-reset").addEventListener("click", async () => {
  const it = editTarget; if (!it || it === "new") return;
  const { error } = await sb.from("collection_edits").delete().eq("item_id", it.id);
  if (error) { toast("Couldn't reset — check your connection"); return; }
  edits.delete(it.id); rebuild(); render(); $("e-dlg").close(); toast("Restored the original");
});
$("e-del").addEventListener("click", async () => {
  const it = editTarget; if (!it || it === "new" || !it.custom) return;
  let r = await sb.from("collection_added").delete().eq("id", it.id);
  if (!r.error) r = await sb.from("collection").delete().eq("item_id", it.id);
  if (r.error) { toast("Couldn't delete — check your connection"); return; }
  added = added.filter((x) => x.id !== it.id); marks.delete(it.id); rebuild(); render(); $("e-dlg").close(); toast("Deleted");
});

// manage your own categories
function renderCats() {
  const list = $("c-list"); list.textContent = "";
  if (!customCats.length) list.append(el("p", { class: "empty" }, "No categories of your own yet."));
  customCats.forEach((name) => {
    const n = items.filter((i) => i.my === name).length;
    const inp = el("input", { type: "text", value: name, "aria-label": "Category name", maxlength: "40" });
    const commit = async () => { const v = inp.value.trim(); if (v && v !== name) await renameCat(name, v); else inp.value = name; };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    inp.addEventListener("change", commit);
    list.append(el("div", { class: "c-row" }, inp, el("span", { class: "c-n" }, `${n} figure${n === 1 ? "" : "s"}`),
      el("button", { type: "button", class: "c-x", "aria-label": "Delete category", onclick: () => deleteCat(name) }, "✕")));
  });
}
const nameTaken = (n) => myCats().some((c) => c.toLowerCase() === n.toLowerCase());
async function addCat() {
  const v = $("c-new").value.trim(); if (!v) return;
  if (nameTaken(v)) { toast("That category already exists"); return; }
  const { error } = await sb.from("collection_cats").insert({ name: v });
  if (error) { toast("Couldn't add — check your connection"); return; }
  customCats.push(v); $("c-new").value = ""; rebuild(); renderCats(); render();
}
async function renameCat(from, to) {
  if (nameTaken(to) && to.toLowerCase() !== from.toLowerCase()) { toast("That category already exists"); renderCats(); return; }
  let r = await sb.from("collection_cats").delete().eq("name", from);
  if (!r.error) r = await sb.from("collection_cats").insert({ name: to });
  if (!r.error) r = await sb.from("collection_edits").update({ cat: to }).eq("cat", from);
  if (!r.error) r = await sb.from("collection_added").update({ cat: to }).eq("cat", from);
  if (r.error) { toast("Couldn't rename — check your connection"); return; }
  customCats = customCats.map((c) => c === from ? to : c);
  edits.forEach((e) => { if (e.cat === from) e.cat = to; }); added.forEach((a) => { if (a.cat === from) a.cat = to; });
  if (my === from) my = to;
  rebuild(); renderCats(); render();
}
async function deleteCat(name) {
  let r = await sb.from("collection_cats").delete().eq("name", name);
  const hit = [...edits].filter(([, e]) => e.cat === name), empty = hit.filter(([, e]) => e.name == null && e.no == null).map(([k]) => k);
  if (!r.error && hit.length) r = await sb.from("collection_edits").update({ cat: null }).eq("cat", name);
  if (!r.error && empty.length) r = await sb.from("collection_edits").delete().in("item_id", empty);   // overrides that only held this category
  if (!r.error) r = await sb.from("collection_added").update({ cat: null }).eq("cat", name);
  if (r.error) { toast("Couldn't delete — check your connection"); return; }
  customCats = customCats.filter((c) => c !== name);
  hit.forEach(([k, e]) => { e.cat = null; if (empty.includes(k)) edits.delete(k); }); added.forEach((a) => { if (a.cat === name) a.cat = null; });
  rebuild(); renderCats(); render(); toast(`Deleted “${name}” — its figures went back to their original category`);
}
$("manage-cats").addEventListener("click", () => { renderCats(); $("c-dlg").showModal(); });
$("c-close").addEventListener("click", () => $("c-dlg").close());
$("c-add").addEventListener("click", addCat);
$("c-new").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCat(); } });

// ---- controls ----
$("q").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });
$("cat").addEventListener("change", (e) => { cat = e.target.value; render(); });
$("fr").addEventListener("change", (e) => { fr = e.target.value; render(); });
$("my").addEventListener("change", (e) => { my = e.target.value; render(); });
$("year").addEventListener("change", (e) => { year = e.target.value; render(); });
$("status-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  status = b.dataset.v;
  $("status-seg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  render();
});
$("toggle-all").addEventListener("click", () => {
  if (open.size) open.clear();
  else series.forEach((s, i) => { if ((year === "all" || String(s.year) === year) && (cat === "all" || s.cat === cat)) open.add(i); });
  render();
});
try { if (matchMedia("(max-width: 760px)").matches) $("charts-wrap").open = false; } catch {}
init();
