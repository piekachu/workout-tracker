const sb = Auth.client;

// ---------- dates: local-time strings only ----------
// toISOString()/new Date("YYYY-MM-DD") are UTC-based and land a day off in
// Asia/Seoul around midnight, so every date here is built from local parts.
const { pad, localISO, parse, addDays, firstOf, addMonths, mondayOf, periodStart } = TasksCore;
const TODAY = localISO(new Date());

const fmt = (iso, opts) => parse(iso).toLocaleDateString(undefined, opts);
function periodLabel(view, anchor) {
  if (view === "day") return fmt(anchor, { weekday: "short", month: "short", day: "numeric" }) + (anchor === TODAY ? " · Today" : "");
  if (view === "week") {
    const mon = mondayOf(anchor), sun = addDays(mon, 6);
    const sameMonth = mon.slice(0, 7) === sun.slice(0, 7);
    return `${fmt(mon, { month: "short", day: "numeric" })} – ${fmt(sun, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  }
  return fmt(anchor, { month: "long", year: "numeric" });
}

// ---------- tiny DOM helper ----------
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
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- state ----------
let tasks = [];
let view = "day";
let anchor = TODAY;
try { const v = localStorage.getItem("tasks:view"); if (["day", "week", "month"].includes(v)) view = v; } catch {}

async function load() {
  const { data, error } = await sb.from("tasks").select("*").order("id").limit(3000);
  if (error) { toast("Couldn't load tasks"); return; }
  tasks = data || [];
  render();
}

// open first, then timed, then priority, then creation order
function sorted(list) {
  return [...list].sort((a, b) =>
    (!!a.done_at - !!b.done_at) ||
    ((a.start_time || "99") < (b.start_time || "99") ? -1 : (a.start_time || "99") > (b.start_time || "99") ? 1 : 0) ||
    (b.priority - a.priority) || (a.id - b.id));
}
const inPeriod = (horizon, start) => sorted(tasks.filter((t) => t.horizon === horizon && t.period_start === start));

// ---------- rendering ----------
function taskRow(t, opts = {}) {
  const hhmm = (s) => (s ? s.slice(0, 5) : "");
  const bits = [];
  if (t.start_time) bits.push(hhmm(t.start_time) + (t.end_time ? "–" + hhmm(t.end_time) : ""));
  if (opts.showHorizon && t.horizon !== "day") bits.push(t.horizon === "week" ? "this week" : "this month");
  if (t.recur) bits.push("↻ " + t.recur);
  const row = el("div", { class: `task p${t.priority}${t.done_at ? " done" : ""}` },
    el("button", { class: "tick", type: "button", "aria-label": t.done_at ? "Mark not done" : "Mark done", onclick: () => toggle(t) }, "✓"),
    el("button", { class: "main", type: "button", onclick: () => openSheet(t) },
      el("div", { class: "title" }, t.title), bits.length ? el("div", { class: "meta" }, bits.join(" · ")) : null));
  if (opts.moveToToday) row.append(el("button", { class: "move", type: "button", onclick: () => moveToToday(t) }, "→ Today"));
  return row;
}
function group(title, rows, opts = {}) {
  const head = el("div", { class: "group-title" + (opts.today ? " today" : "") }, el("span", {}, title),
    opts.action ? el("button", { type: "button", onclick: opts.action.fn }, opts.action.label) : null);
  return el("section", { class: "group" }, head, ...(rows.length ? rows : [el("div", { class: "empty" }, opts.empty || "Nothing here")]));
}

function render() {
  document.querySelectorAll("#view-seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  $("period-label").textContent = periodLabel(view, anchor);
  $("add-title").placeholder = `Add a task for ${view === "day" ? (anchor === TODAY ? "today" : "this day") : "this " + view}`;
  renderRings();
  const c = $("content"); c.innerHTML = ""; c.dataset.view = view;
  if (view === "day") renderDay(c); else if (view === "week") renderWeek(c); else renderMonth(c);
}

// done / total for tasks anchored in a period (day tasks by date, week tasks by Monday, month tasks by the 1st)
function periodStats(from, to) {
  const t = tasks.filter((x) => x.period_start >= from && x.period_start <= to);
  return { done: t.filter((x) => x.done_at).length, total: t.length };
}
function renderRings() {
  const mon = mondayOf(TODAY), first = firstOf(TODAY);
  const sets = [["r-today", periodStats(TODAY, TODAY), "today"], ["r-week", periodStats(mon, addDays(mon, 6)), "this week"],
    ["r-month", periodStats(first, addDays(addMonths(first, 1), -1)), "this month"]];
  for (const [id, s, label] of sets) {
    Charts.ring($(id), { size: 84, value: s.done, total: s.total || 1, big: s.total ? `${s.done}/${s.total}` : "–", aria: `${s.done} of ${s.total} tasks done ${label}` });
  }
}

function renderDay(c) {
  if (anchor === TODAY) {
    const overdue = sorted(tasks.filter((t) => t.horizon === "day" && t.period_start < TODAY && !t.done_at));
    if (overdue.length) c.append(group("Overdue", overdue.map((t) => taskRow(t, { moveToToday: true })), {}));
  }
  c.append(group("Day", inPeriod("day", anchor).map((t) => taskRow(t)), { today: anchor === TODAY, empty: "Nothing planned — add something below." }));
  const wk = inPeriod("week", mondayOf(anchor)), mo = inPeriod("month", firstOf(anchor));
  if (wk.length) c.append(group("This week", wk.map((t) => taskRow(t))));
  if (mo.length) c.append(group("This month", mo.map((t) => taskRow(t))));
}

function renderWeek(c) {
  const mon = mondayOf(anchor);
  c.append(group("This week", inPeriod("week", mon).map((t) => taskRow(t)), { empty: "No week-level tasks." }));
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, i);
    const rows = inPeriod("day", day).map((t) => taskRow(t));
    c.append(group(fmt(day, { weekday: "short", month: "short", day: "numeric" }), rows,
      { today: day === TODAY, empty: "—", action: { label: "Open ›", fn: () => { view = "day"; anchor = day; render(); } } }));
  }
}

function renderMonth(c) {
  const first = firstOf(anchor), dim = new Date(parse(first).getFullYear(), parse(first).getMonth() + 1, 0).getDate();
  c.append(group("This month", inPeriod("month", first).map((t) => taskRow(t)), { empty: "No month-level tasks." }));

  const cal = el("div", { class: "cal" });
  ["M", "T", "W", "T", "F", "S", "S"].forEach((d) => cal.append(el("div", { class: "dow" }, d)));
  for (let i = 0; i < (parse(first).getDay() + 6) % 7; i++) cal.append(el("div", { class: "cell blank" }));
  for (let n = 1; n <= dim; n++) {
    const iso = `${first.slice(0, 8)}${pad(n)}`;
    const day = tasks.filter((t) => t.horizon === "day" && t.period_start === iso);
    const open = day.filter((t) => !t.done_at).length;
    const dots = el("span", { class: "dots" });
    if (open) for (let i = 0; i < Math.min(open, 3); i++) dots.append(el("i"));
    else if (day.length) dots.append(el("i", { class: "all-done" }));
    cal.append(el("button", { type: "button", class: "cell" + (iso === TODAY ? " today" : ""),
      "aria-label": `${iso}: ${open} open`, onclick: () => { view = "day"; anchor = iso; render(); } }, String(n), dots));
  }
  c.append(el("section", { class: "group group-cal" }, el("div", { class: "group-title" }, el("span", {}, "Days")), cal));

  // week-level tasks for each week that touches this month
  const weeks = [];
  for (let m = mondayOf(first); m <= `${first.slice(0, 8)}${pad(dim)}`; m = addDays(m, 7)) weeks.push(m);
  for (const m of weeks) {
    const rows = inPeriod("week", m);
    if (rows.length) c.append(group(`Week of ${fmt(m, { month: "short", day: "numeric" })}`, rows.map((t) => taskRow(t)),
      { action: { label: "Open ›", fn: () => { view = "week"; anchor = m; render(); } } }));
  }
}

// ---------- mutations ----------
async function toggle(t) {
  const was = t.done_at, next = was ? null : new Date().toISOString();
  t.done_at = next; render();
  const { error } = await sb.from("tasks").update({ done_at: next }).eq("id", t.id);
  if (error) { t.done_at = was; render(); toast("Couldn't save — check your connection"); return; }
  if (next && t.recur) await spawnNext(t);
}

// A repeating task, once done, drops its next occurrence in the future.
async function spawnNext(t) {
  const row = await TasksCore.spawnNext(sb, t, tasks);
  if (!row) return;
  tasks.push(row); render(); toast(`Next: ${fmt(row.period_start, { month: "short", day: "numeric" })}`);
}

async function moveToToday(t) {
  const prev = t.period_start; t.period_start = TODAY; render();
  const { error } = await sb.from("tasks").update({ period_start: TODAY }).eq("id", t.id);
  if (error) { t.period_start = prev; render(); toast("Couldn't move it"); }
}

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("add-title"), title = input.value.trim();
  if (!title) return;
  input.disabled = true;
  const { data, error } = await sb.from("tasks").insert({ title, horizon: view, period_start: periodStart(view, anchor) }).select().single();
  input.disabled = false;
  if (error) { toast("Couldn't add it"); return; }
  tasks.push(data); input.value = ""; render(); input.focus();
});

// ---------- edit sheet ----------
let editing = null;
function syncTimeRow() { $("f-time-row").hidden = $("f-horizon").value !== "day"; }
function openSheet(t) {
  editing = t;
  $("f-title").value = t.title; $("f-notes").value = t.notes || "";
  $("f-horizon").value = t.horizon; $("f-date").value = t.period_start;
  $("f-start").value = t.start_time ? t.start_time.slice(0, 5) : ""; $("f-end").value = t.end_time ? t.end_time.slice(0, 5) : "";
  $("f-priority").value = String(t.priority); $("f-recur").value = t.recur || "";
  syncTimeRow(); $("sheet").hidden = false;
}
const closeSheet = () => { $("sheet").hidden = true; editing = null; };
$("f-horizon").addEventListener("change", syncTimeRow);
$("f-cancel").addEventListener("click", closeSheet);
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

$("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = editing; if (!t) return;
  const horizon = $("f-horizon").value, timed = horizon === "day";
  const start = timed ? $("f-start").value || null : null, end = timed ? $("f-end").value || null : null;
  if (end && !start) { toast("Add a start time too"); return; }
  if (start && end && end <= start) { toast("End must be after start"); return; }
  const patch = { title: $("f-title").value.trim(), notes: $("f-notes").value.trim() || null, horizon,
    period_start: periodStart(horizon, $("f-date").value), start_time: start, end_time: end,
    priority: Number($("f-priority").value), recur: $("f-recur").value || null };
  if (!patch.title) return;
  const { data, error } = await sb.from("tasks").update(patch).eq("id", t.id).select().single();
  if (error) { toast("Couldn't save"); return; }
  Object.assign(t, data); closeSheet(); render();
});
$("f-delete").addEventListener("click", async () => {
  const t = editing; if (!t || !confirm(`Delete "${t.title}"?`)) return;
  const { error } = await sb.from("tasks").delete().eq("id", t.id);
  if (error) { toast("Couldn't delete"); return; }
  tasks = tasks.filter((x) => x.id !== t.id); closeSheet(); render();
});

// ---------- navigation ----------
function step(dir) {
  anchor = view === "day" ? addDays(anchor, dir) : view === "week" ? addDays(anchor, 7 * dir) : addMonths(firstOf(anchor), dir);
  render();
}
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("period-label").addEventListener("click", () => { anchor = TODAY; render(); });
document.querySelectorAll("#view-seg button").forEach((b) => b.addEventListener("click", () => {
  view = b.dataset.view;
  try { localStorage.setItem("tasks:view", view); } catch {}
  render();
}));

render();
load();
