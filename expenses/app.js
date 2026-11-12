const sb = Auth.client;

// ---------- helpers ----------
// Local-date strings only: toISOString()/new Date("YYYY-MM-DD") are UTC-based and
// land a day off in timezones ahead of UTC (this site is used from Asia/Seoul).
const pad = (n) => String(n).padStart(2, "0");
const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CATEGORIES = {
  expense: ["Food", "Groceries", "Transport", "Bills", "Rent", "Health", "Shopping", "Fun", "Study", "Other"],
  income: ["Salary", "Allowance", "Gift", "Other"],
};
const CURRENCIES = {
  KRW: { sym: "₩", locale: "ko-KR", digits: 0, quick: [1000, 5000, 10000] },
  USD: { sym: "$", locale: "en-US", digits: 2, quick: [1, 5, 20] },
  EUR: { sym: "€", locale: "de-DE", digits: 2, quick: [1, 5, 20] },
  JPY: { sym: "¥", locale: "ja-JP", digits: 0, quick: [100, 500, 1000] },
};

const state = {
  month: monthStart(new Date()),     // Date at 1st of the shown month
  rows: [],                          // this month's rows, newest first
  kind: "expense",
  category: null,
  editing: null,                     // row being edited, or null
  currency: safeGet("expenses.currency") || "KRW",
};
if (!CURRENCIES[state.currency]) state.currency = "KRW";

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc. */ } }
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

const cur = () => CURRENCIES[state.currency];
function fmt(n) {
  const c = cur();
  return c.sym + new Intl.NumberFormat(c.locale, { minimumFractionDigits: c.digits, maximumFractionDigits: c.digits }).format(n);
}
function parseAmount(s) {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2200);
}
function setStatus(msg, isErr) { const s = $("status"); s.textContent = msg || ""; s.classList.toggle("error", !!isErr); }

// ---------- data ----------
async function loadMonth() {
  const start = localISO(state.month), end = localISO(addMonths(state.month, 1));
  const { data, error } = await sb.from("expenses").select("*")
    .gte("spent_on", start).lt("spent_on", end)
    .order("spent_on", { ascending: false }).order("id", { ascending: false });
  if (error) {
    state.rows = [];
    render();
    $("list").innerHTML = `<p class="empty">Couldn't load expenses (${esc(error.message)}).</p>`;
    return;
  }
  state.rows = data || [];
  render();
}

// ---------- rendering ----------
function render() {
  const mLabel = state.month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  $("month-label").textContent = mLabel;
  $("next-month").disabled = state.month >= monthStart(new Date());

  const spent = state.rows.filter((r) => r.kind === "expense");
  const income = state.rows.filter((r) => r.kind === "income");
  const sum = (a) => a.reduce((t, r) => t + Number(r.amount), 0);
  const totalSpent = sum(spent), totalIncome = sum(income);

  $("total-spent").textContent = fmt(totalSpent);
  $("total-sub").textContent = state.month.getTime() === monthStart(new Date()).getTime() ? "spent this month" : `spent in ${mLabel}`;
  $("net-row").hidden = income.length === 0;
  $("total-income").textContent = fmt(totalIncome);
  $("total-net").textContent = fmt(totalIncome - totalSpent);

  // category donut (a category keeps one colour everywhere) + daily bars for the month
  const byCat = new Map();
  spent.forEach((r) => byCat.set(r.category || "Other", (byCat.get(r.category || "Other") || 0) + Number(r.amount)));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const dh = $("ex-donut"); dh.innerHTML = "";
  if (cats.length) {
    const segs = cats.map(([label, value]) => ({ label, value, color: Charts.slotColor(label, Charts.EXPENSE_SLOTS) }));
    const host = document.createElement("div"); host.className = "ring-host"; dh.append(host);
    Charts.donut(host, { segments: segs, size: 170, big: Charts.compact(totalSpent), small: cur().sym,
      tipValue: (sg, sh) => `${fmt(sg.value)} · ${Math.round(sh * 100)}%` });
    dh.append(Charts.legend(segs.map((s) => ({ label: s.label, color: s.color, text: `${fmt(s.value)} · ${Math.round((s.value / totalSpent) * 100)}%` }))));
  }
  const dim = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate();
  const perDay = Array.from({ length: dim }, (_, i) => 0);
  spent.forEach((r) => { perDay[Number(r.spent_on.slice(8, 10)) - 1] += Number(r.amount); });
  $("daily-card").hidden = !spent.length;
  Charts.bar($("ex-daily"), { values: perDay, height: 170, xTick: (i) => ((i + 1) % 5 === 1 || i === dim - 1 ? String(i + 1) : ""),
    fmtLabel: (v) => Charts.compact(v), tipTitle: (i) => `${state.month.toLocaleDateString("en-US", { month: "short" })} ${i + 1}`, tipValue: (i) => fmt(perDay[i]) });

  // list grouped by day
  const list = $("list");
  if (state.rows.length === 0) { list.innerHTML = `<p class="empty">Nothing logged in ${esc(mLabel)} yet.</p>`; return; }
  const days = new Map();
  state.rows.forEach((r) => { if (!days.has(r.spent_on)) days.set(r.spent_on, []); days.get(r.spent_on).push(r); });
  list.innerHTML = [...days.entries()].map(([d, rows]) => {
    const dayTotal = rows.reduce((t, r) => t + (r.kind === "expense" ? Number(r.amount) : 0), 0);
    const dt = new Date(d + "T00:00:00");
    const label = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return `<div class="day"><div class="day-head"><span>${label}</span><span>${dayTotal ? fmt(dayTotal) : ""}</span></div>` +
      rows.map((r) => `<button type="button" class="tx" data-id="${r.id}">
        <span class="cat">${esc(r.category || "Other")}</span>
        <span class="amt ${r.kind}">${r.kind === "income" ? "+" : ""}${fmt(Number(r.amount))}</span>
        ${r.note ? `<span class="note">${esc(r.note)}</span>` : ""}
      </button>`).join("") + `</div>`;
  }).join("");
}

function renderChips() {
  const cats = CATEGORIES[state.kind];
  if (!cats.includes(state.category)) state.category = null;
  $("cat-chips").innerHTML = cats.map((c) => `<button type="button" class="chip${state.category === c ? " on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
}
function renderQuick() {
  $("quick").innerHTML = cur().quick.map((n) => `<button type="button" data-add="${n}">+${new Intl.NumberFormat(cur().locale).format(n)}</button>`).join("");
  $("cur-sym").textContent = cur().sym;
}
function setKind(kind) {
  state.kind = kind;
  document.querySelectorAll("#kind-seg button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  renderChips();
}

// ---------- form ----------
function resetForm() {
  state.editing = null;
  $("amount").value = ""; $("note").value = ""; $("date").value = localISO();
  state.category = null;
  setKind("expense");
  $("entry-title").textContent = "Add";
  $("save").textContent = "Save";
  $("cancel-edit").hidden = true; $("delete").hidden = true;
  setStatus("");
}
function startEdit(row) {
  state.editing = row;
  $("amount").value = String(Number(row.amount));
  $("note").value = row.note || "";
  $("date").value = row.spent_on;
  state.category = row.category;
  setKind(row.kind);
  state.category = row.category; renderChips();
  $("entry-title").textContent = "Edit";
  $("save").textContent = "Update";
  $("cancel-edit").hidden = false; $("delete").hidden = false;
  setStatus("");
  $("entry").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function save() {
  const amount = parseAmount($("amount").value);
  const spent_on = $("date").value;
  if (!(amount > 0)) { setStatus("Enter an amount.", true); $("amount").focus(); return; }
  if (!spent_on) { setStatus("Pick a date.", true); return; }
  const payload = { spent_on, amount, kind: state.kind, category: state.category || "Other", note: $("note").value.trim() || null };

  const btn = $("save"); btn.disabled = true;
  setStatus("Saving…");
  const q = state.editing
    ? sb.from("expenses").update(payload).eq("id", state.editing.id)
    : sb.from("expenses").insert(payload);
  const { error } = await q;
  btn.disabled = false;
  if (error) { setStatus(`Couldn't save: ${error.message}`, true); return; }

  const wasEdit = !!state.editing;
  // jump to the month of the saved entry so it's visible
  const d = new Date(spent_on + "T00:00:00");
  state.month = monthStart(d);
  resetForm();
  toast(wasEdit ? "Updated" : "Saved");
  await loadMonth();
}

async function remove() {
  if (!state.editing) return;
  if (!confirm("Delete this entry?")) return;
  const { error } = await sb.from("expenses").delete().eq("id", state.editing.id);
  if (error) { setStatus(`Couldn't delete: ${error.message}`, true); return; }
  resetForm(); toast("Deleted"); await loadMonth();
}

// ---------- CSV export ----------
function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCsv(rows, name) {
  const head = ["date", "type", "category", "amount", "note"];
  const lines = [head.join(",")].concat(rows.map((r) => [r.spent_on, r.kind, r.category, r.amount, r.note].map(csvCell).join(",")));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function exportAll() {
  const { data, error } = await sb.from("expenses").select("*").order("spent_on").order("id");
  if (error) { toast("Export failed"); return; }
  downloadCsv(data || [], `expenses-all-${localISO()}.csv`);
}

// ---------- wiring ----------
$("prev-month").onclick = () => { state.month = addMonths(state.month, -1); loadMonth(); };
$("next-month").onclick = () => { if (state.month < monthStart(new Date())) { state.month = addMonths(state.month, 1); loadMonth(); } };
$("month-label").onclick = () => { state.month = monthStart(new Date()); loadMonth(); };
$("kind-seg").onclick = (e) => { const b = e.target.closest("button[data-kind]"); if (b) setKind(b.dataset.kind); };
$("cat-chips").onclick = (e) => {
  const b = e.target.closest("button[data-cat]"); if (!b) return;
  state.category = state.category === b.dataset.cat ? null : b.dataset.cat; renderChips();
};
$("quick").onclick = (e) => {
  const b = e.target.closest("button[data-add]"); if (!b) return;
  const n = (parseAmount($("amount").value) || 0) + Number(b.dataset.add);
  $("amount").value = String(n);
};
$("clear-amt").onclick = () => { $("amount").value = ""; $("amount").focus(); };
$("amount").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9.]/g, ""); });
$("amount").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
$("note").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
$("save").onclick = save;
$("cancel-edit").onclick = resetForm;
$("delete").onclick = remove;
$("list").onclick = (e) => {
  const b = e.target.closest("button.tx"); if (!b) return;
  const row = state.rows.find((r) => String(r.id) === b.dataset.id); if (row) startEdit(row);
};
$("currency").value = state.currency;
$("currency").onchange = (e) => { state.currency = e.target.value; safeSet("expenses.currency", state.currency); renderQuick(); render(); };
$("export-month").onclick = () => downloadCsv(state.rows.slice().reverse(), `expenses-${localISO(state.month).slice(0, 7)}.csv`);
$("export-all").onclick = exportAll;

renderQuick();
resetForm();
loadMonth();
