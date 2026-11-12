const sb = Auth.client;

// ---------- dates: local-time strings only ----------
// toISOString()/new Date("YYYY-MM-DD") are UTC-based and land a day off in
// Asia/Seoul around midnight, so every date here is built from local parts.
const { pad, localISO, parse, addDays, firstOf, addMonths, weekStart, periodStart } = TasksCore;
const TODAY = localISO(new Date());

const fmt = (iso, opts) => parse(iso).toLocaleDateString(undefined, opts);
function periodLabel(view, anchor) {
  if (view === "day") return fmt(anchor, { weekday: "short", month: "short", day: "numeric" }) + (anchor === TODAY ? " · Today" : "");
  if (view === "week") {
    const mon = weekStart(anchor), sun = addDays(mon, 6);
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
  $("view-select").value = view;
  $("period-label").textContent = periodLabel(view, anchor);
  $("add-title").placeholder = `Add a task for ${view === "day" ? (anchor === TODAY ? "today" : "this day") : "this " + view}`;
  renderRings();
  const c = $("content"); c.innerHTML = ""; c.dataset.view = view;
  if (view === "day") renderDay(c); else if (view === "week") renderWeek(c); else renderMonth(c);
}

// done / total for tasks anchored in a period (day tasks by date, week tasks by the week's Sunday, month tasks by the 1st)
function periodStats(from, to) {
  const t = tasks.filter((x) => x.period_start >= from && x.period_start <= to);
  return { done: t.filter((x) => x.done_at).length, total: t.length };
}
function renderRings() {
  const mon = weekStart(TODAY), first = firstOf(TODAY);
  const sets = [["r-today", periodStats(TODAY, TODAY), "today"], ["r-week", periodStats(mon, addDays(mon, 6)), "this week"],
    ["r-month", periodStats(first, addDays(addMonths(first, 1), -1)), "this month"]];
  for (const [id, s, label] of sets) {
    Charts.ring($(id), { size: 56, value: s.done, total: s.total || 1, big: s.total ? `${s.done}/${s.total}` : "–", aria: `${s.done} of ${s.total} tasks done ${label}` });
  }
}

function renderDay(c) {
  if (anchor === TODAY) {
    const overdue = sorted(tasks.filter((t) => t.horizon === "day" && t.period_start < TODAY && !t.done_at));
    if (overdue.length) c.append(group("Overdue", overdue.map((t) => taskRow(t, { moveToToday: true })), {}));
  }
  c.append(group("Day", inPeriod("day", anchor).map((t) => taskRow(t)), { today: anchor === TODAY, empty: "Nothing planned — add something below." }));
  const wk = inPeriod("week", weekStart(anchor)), mo = inPeriod("month", firstOf(anchor));
  if (wk.length) c.append(group("This week", wk.map((t) => taskRow(t))));
  if (mo.length) c.append(group("This month", mo.map((t) => taskRow(t))));
}

function renderWeek(c) {
  const mon = weekStart(anchor);
  c.append(group("This week", inPeriod("week", mon).map((t) => taskRow(t)), { empty: "No week-level tasks." }));
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, i);
    const rows = inPeriod("day", day).map((t) => taskRow(t));
    c.append(group(fmt(day, { weekday: "short", month: "short", day: "numeric" }), rows,
      { today: day === TODAY, empty: "—", action: { label: "Open ›", fn: () => { view = "day"; anchor = day; render(); } } }));
  }
}

// ---------- drag and drop in the month grid ----------
// A day chip dropped on another day changes its date; a week bar dropped anywhere in
// another week's row changes its week. The edit sheet stays the keyboard/phone route.
let drag = null;   // { id, kind } while something is being dragged
function dragAttrs(t, kind) {
  return { draggable: "true",
    ondragstart: (e) => { drag = { id: t.id, kind }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(t.id)); e.currentTarget.classList.add("dragging"); },
    ondragend: () => { drag = null; clearDrop(); } };
}
function clearDrop() { document.querySelectorAll(".drop, .drop-week, .dragging").forEach((n) => n.classList.remove("drop", "drop-week", "dragging")); }
function acceptDrops(nodes, iso, row, weekOnly = false) {
  const mark = () => { clearDrop(); if (drag.kind === "week") row.classList.add("drop-week"); else nodes.forEach((n) => n.classList.add("drop")); };
  for (const n of nodes) {
    n.addEventListener("dragover", (e) => {
      if (!drag || (weekOnly && drag.kind !== "week")) return;     // the bar area only takes week bars
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; mark();
    });
    n.addEventListener("drop", (e) => {
      if (!drag || (weekOnly && drag.kind !== "week")) return;
      e.preventDefault(); e.stopPropagation(); const d = drag; drag = null; clearDrop(); moveTask(d, iso);
    });
  }
}
async function moveTask(d, iso) {
  const t = tasks.find((x) => x.id === d.id); if (!t) return;
  const target = d.kind === "week" ? weekStart(iso) : iso;
  if (target === t.period_start) return;
  const prev = t.period_start; t.period_start = target; render();
  const { error } = await sb.from("tasks").update({ period_start: target }).eq("id", t.id);
  if (error) { t.period_start = prev; render(); toast("Couldn't move it"); return; }
  toast(d.kind === "week" ? `Moved to the week of ${fmt(target, { month: "short", day: "numeric" })}` : `Moved to ${fmt(target, { weekday: "short", month: "short", day: "numeric" })}`);
}

// ISO week number of the week containing `iso`. A Sunday-start week gets the number of its Monday, as Notion Calendar does.
function isoWeek(iso) {
  const d = parse(iso); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

// Notion-Calendar-style month: week rows with a week number, date numbers on top,
// week tasks as bars across the row, day tasks as tinted chips, "N more" when it overflows.
function renderMonth(c) {
  const first = firstOf(anchor), last = addDays(addMonths(first, 1), -1), month = first.slice(0, 7);
  const taskLabel = (t) => (t.start_time ? t.start_time.slice(0, 5) : "");
  // divs, not buttons: Firefox won't start a drag from a <button>
  const press = (t) => ({ role: "button", tabindex: "0", title: t.title, onclick: () => openSheet(t),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(t); } } });
  const bar = (t, extra) => el("div", { ...press(t), class: "mbar" + (extra ? " " + extra : "") + (t.done_at ? " done" : ""),
    ...(t.horizon === "week" ? dragAttrs(t, "week") : {}) }, t.title);
  const chip = (t) => el("div", { ...press(t), class: `mchip c${t.priority}${t.done_at ? " done" : ""}`, ...dragAttrs(t, "day") },
    taskLabel(t) ? el("span", { class: "tm" }, taskLabel(t)) : el("span", { class: "ic" }, t.done_at ? "✓" : "◌"), el("span", { class: "tt" }, t.title));
  const goDay = (iso) => { view = "day"; anchor = iso; render(); };

  const monthTasks = inPeriod("month", first);
  if (monthTasks.length) c.append(el("div", { class: "mcal-month" }, ...monthTasks.map((t) => bar(t, "mo"))));

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayIdx = parse(TODAY).getDay();
  const head = el("div", { class: "mcal-head" }, el("span", { class: "w" }, "W"),
    el("div", { class: "days" }, ...names.map((n, i) => el("span", { class: view === "month" && TODAY.slice(0, 7) === month && i === todayIdx ? "today-col" : "" }, n))));
  const grid = el("div", { class: "mcal" }, head);

  for (let m = weekStart(first); m <= last; m = addDays(m, 7)) {
    const wkTasks = inPeriod("week", m);
    const dates = el("div", { class: "mcal-dates" }), chips = el("div", { class: "mcal-chips" }), dayTargets = [];
    const maxChips = Math.max(2, 4 - Math.min(wkTasks.length, 2));
    for (let i = 0; i < 7; i++) {
      const iso = addDays(m, i), inMonth = iso.slice(0, 7) === month, list = inPeriod("day", iso);
      const showMonth = iso.slice(8) === "01";
      const dateBtn = el("button", { type: "button", class: (iso === TODAY ? "today " : "") + (inMonth ? "" : "out"), "aria-label": iso, onclick: () => goDay(iso) },
        showMonth ? el("span", { class: "m" }, fmt(iso, { month: "short" })) : null, el("span", { class: "d" }, String(parse(iso).getDate())));
      dates.append(dateBtn);
      const col = el("div", { class: "mcal-col" });
      dayTargets.push([[dateBtn, col], iso]);
      const visible = list.length > maxChips ? maxChips - 1 : list.length;
      list.slice(0, visible).forEach((t) => col.append(chip(t)));
      if (list.length > visible) col.append(el("button", { type: "button", class: "mmore", onclick: () => goDay(iso) }, `${list.length - visible} more`));
      const dots = el("div", { class: "mdots", onclick: () => goDay(iso) });
      list.slice(0, 6).forEach((t) => dots.append(el("i", { class: `c${t.priority}${t.done_at ? " done" : ""}` })));
      col.append(dots);
      chips.append(col);
    }
    const body = el("div", { class: "mcal-body" }, dates, ...wkTasks.map((t) => bar(t)), chips);
    const weekRow = el("div", { class: "mcal-week" }, el("div", { class: "wk" }, String(isoWeek(addDays(m, 1)))), body);
    dayTargets.forEach(([nodes, iso]) => acceptDrops(nodes, iso, weekRow));
    acceptDrops([body], m, weekRow, true);   // a week bar can also be dropped on the bar area itself
    grid.append(weekRow);
  }
  c.append(grid);
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
$("today-btn").addEventListener("click", () => { anchor = TODAY; render(); });
$("view-select").addEventListener("change", (e) => {
  view = e.target.value;
  try { localStorage.setItem("tasks:view", view); } catch {}
  render();
});

render();
load();
