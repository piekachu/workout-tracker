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
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600); }

let series = [], items = [];
const marks = new Map();            // item id -> "owned" | "wishlist"
const open = new Set();             // series indexes the user expanded
let status = "all", year = "all", query = "";
let ready = false;

// ---- data ----
async function init() {
  try {
    const cat = await (await fetch("catalog.json")).json();
    series = cat.series; items = cat.items;
  } catch { toast("Couldn't load the list"); return; }
  const years = [...new Set(series.map((s) => s.year))].filter(Boolean).sort((a, b) => b - a);
  $("year").append(el("option", { value: "all" }, "All years"), ...years.map((y) => el("option", { value: y }, String(y))));
  render();
  // paged: the API caps a response at 1000 rows
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("collection").select("item_id,status").order("item_id").range(from, from + 999);
    if (error) { toast("Couldn't load your marks — check your connection"); return; }
    (data || []).forEach((r) => marks.set(r.item_id, r.status));
    if (!data || data.length < 1000) break;
  }
  ready = true;
  render();
}

async function save(ids, next) {                       // next: "owned" | "wishlist" | null
  if (!ready) { toast("Still loading your marks…"); return; }
  const prev = ids.map((id) => [id, marks.get(id) || null]);
  ids.forEach((id) => next ? marks.set(id, next) : marks.delete(id));
  render();
  let error;
  if (next) ({ error } = await sb.from("collection").upsert(ids.map((id) => ({ item_id: id, status: next })), { onConflict: "user_id,item_id" }));
  else ({ error } = await sb.from("collection").delete().in("item_id", ids));
  if (error) {
    prev.forEach(([id, st]) => st ? marks.set(id, st) : marks.delete(id));
    render(); toast("Couldn't save — check your connection");
  }
}

// ---- rendering ----
const matches = (it) => {
  const m = marks.get(it.id);
  if (status === "owned" && m !== "owned") return false;
  if (status === "wishlist" && m !== "wishlist") return false;
  if (status === "missing" && m === "owned") return false;
  if (query && !(it.name + " " + (it.no || "")).toLowerCase().includes(query)) return false;
  return true;
};

function stats() {
  let owned = 0, wish = 0, secret = 0;
  for (const it of items) { const m = marks.get(it.id); if (m === "owned") { owned++; if (it.secret) secret++; } else if (m === "wishlist") wish++; }
  $("s-owned").textContent = owned; $("s-wish").textContent = wish; $("s-miss").textContent = items.length - owned; $("s-secret").textContent = secret;
  Charts.ring($("c-ring"), { size: 96, value: owned, total: items.length, big: items.length ? Math.round(owned / items.length * 100) + "%" : "–",
    small: `${owned}/${items.length}`, aria: `${owned} of ${items.length} figures owned` });
}

function render() {
  if (!items.length) return;
  stats();
  const filtering = status !== "all" || !!query;
  const bySeries = series.map(() => []);
  items.forEach((it) => bySeries[it.s].push(it));
  const host = $("list"); host.textContent = "";
  let shown = 0;
  series.forEach((s, i) => {
    if (year !== "all" && String(s.year) !== year) return;
    const all = bySeries[i], vis = all.filter(matches);
    if (filtering && !vis.length) return;
    shown++;
    const own = all.filter((x) => marks.get(x.id) === "owned").length;
    const isOpen = open.has(i) || (filtering && vis.length > 0);
    const g = el("div", { class: "grp" + (isOpen ? " open" : "") + (own === all.length ? " done" : "") });
    g.append(el("button", { type: "button", class: "grp-h", "aria-expanded": String(isOpen), onclick: () => { open.has(i) ? open.delete(i) : open.add(i); render(); } },
      Object.assign(el("span", { class: "chev" }), { innerHTML: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' }), el("span", { class: "nm" }, s.name.replace(/^Gundam Converge\s*:?\s*/, "") || s.name),
      el("span", { class: "dt" }, s.date || ""), el("span", { class: "bar" }, Object.assign(el("i"), {})), el("span", { class: "ct" }, `${own}/${all.length}`)));
    const bar = g.querySelector(".bar i"); bar.style.width = (all.length ? own / all.length * 100 : 0) + "%";
    if (isOpen) {
      const body = el("div", { class: "grp-body" });
      body.append(el("div", { class: "grp-tools" },
        el("button", { type: "button", onclick: () => save(all.filter((x) => marks.get(x.id) !== "owned").map((x) => x.id), "owned") }, "Mark all owned"),
        el("button", { type: "button", onclick: () => { if (confirm("Clear all marks in this series?")) save(all.filter((x) => marks.has(x.id)).map((x) => x.id), null); } }, "Clear all")));
      vis.forEach((it) => {
        const m = marks.get(it.id);
        const row = el("div", { class: "it" + (m === "owned" ? " owned" : "") + (m === "wishlist" ? " wish" : ""), role: "checkbox", tabindex: "0",
          "aria-checked": String(m === "owned"), onclick: () => save([it.id], m === "owned" ? null : "owned"),
          onkeydown: (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); save([it.id], m === "owned" ? null : "owned"); } } },
          el("span", { class: "ck" }, "✓"), el("span", { class: "no" }, it.no || "·"), el("span", { class: "nm" }, it.name),
          it.secret ? el("span", { class: "tag" }, "Secret") : null,
          el("button", { type: "button", class: "st", "aria-label": m === "wishlist" ? "Remove from wishlist" : "Add to wishlist",
            onclick: (e) => { e.stopPropagation(); save([it.id], m === "wishlist" ? null : "wishlist"); } }, m === "wishlist" ? "★" : "☆"));
        body.append(row);
      });
      g.append(body);
    }
    host.append(g);
  });
  if (!shown) host.append(el("p", { class: "empty" }, filtering ? "Nothing matches." : "No series."));
  $("toggle-all").textContent = open.size ? "Collapse all" : "Expand all";
}

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
