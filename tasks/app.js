const sb = Auth.client;

// ---------- dates: local-time strings only ----------
// toISOString()/new Date("YYYY-MM-DD") are UTC-based and land a day off in
// Asia/Seoul around midnight, so every date here is built from local parts.
const { pad, localISO, parse, addDays, firstOf, addMonths, weekStart, periodStart } = TasksCore;
const TODAY = localISO(new Date());

const fmt = (iso, opts) => parse(iso).toLocaleDateString(undefined, opts);
function periodLabel(view, anchor) {
  if (view === "projects") return "Projects";
  if (view === "day") return fmt(anchor, { weekday: "short", month: "short", day: "numeric" }) + (anchor === TODAY ? " · Today" : "");
  if (view === "week") {
    const mon = weekStart(anchor), sun = addDays(mon, 6);
    const sameMonth = mon.slice(0, 7) === sun.slice(0, 7);
    return `${fmt(mon, { month: "short", day: "numeric" })} – ${fmt(sun, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  }
  return fmt(anchor, { month: "long", year: "numeric" });
}

// ---------- colours + durations ----------
const COLORS = { red: "#e5484d", orange: "#f76b15", yellow: "#d9a406", green: "#30a46c", teal: "#12a594", blue: "#3e63dd", purple: "#8e4ec6", pink: "#d6409f", gray: "#8b8d98" };
const colorStyle = (t) => { const c = effColor(t); return c ? { style: `--tc: ${COLORS[c]}` } : {}; };
const colorClass = (t) => (effColor(t) ? " tinted" : "");
function fmtDur(m) { if (!m) return ""; const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; }
function addMinutes(hhmm, m) { const [h, mi] = hhmm.split(":").map(Number), t = h * 60 + mi + m; return t >= 1440 ? "23:59" : `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; }
// end time to show: the explicit one, else start + duration
const endOf = (t) => (t.end_time ? t.end_time.slice(0, 5) : t.start_time && t.duration_min ? addMinutes(t.start_time.slice(0, 5), t.duration_min) : "");

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
function toast(msg, action) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  if (action) { t.append(" ", el("button", { type: "button", class: "toast-act", onclick: () => { t.classList.remove("show"); action.fn(); } }, action.label)); }
  t.style.pointerEvents = action ? "auto" : "";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove("show"); t.style.pointerEvents = ""; }, action ? 7000 : 2600);
}

// ---------- state ----------
let tasks = [];
let view = "day";
let anchor = TODAY;
try { const v = localStorage.getItem("tasks:view"); if (["day", "week", "month", "projects"].includes(v)) view = v; } catch {}

// ---------- D-day counter + work timer ----------
function dday(iso) {
  const n = Math.round((parse(iso) - parse(TODAY)) / 86400000);
  return { n, text: n > 0 ? `D-${n}` : n === 0 ? "D-Day" : `D+${-n}`, cls: n < 0 ? "late" : n <= 3 ? "soon" : "" };
}
// ---------- hierarchy ----------
// A task can sit under another one (max 3 levels). Sub-tasks may be unscheduled (period_start = null): the project's backlog.
const MAX_DEPTH = 3;
let idx = new Map(), kidMap = new Map();
function reindex() {
  idx = new Map(tasks.map((t) => [t.id, t])); kidMap = new Map();
  for (const t of [...tasks].sort((x, y) => x.id - y.id)) if (t.parent_id) (kidMap.get(t.parent_id) || kidMap.set(t.parent_id, []).get(t.parent_id)).push(t);
}
const kids = (t) => kidMap.get(t.id) || [];
const parentOf = (t) => (t.parent_id ? idx.get(t.parent_id) || null : null);
function depthOf(t) { let d = 1, p = parentOf(t); while (p && d < 10) { d++; p = parentOf(p); } return d; }
const heightOf = (t) => 1 + Math.max(0, ...kids(t).map(heightOf));
const leaves = (t) => (kids(t).length ? kids(t).flatMap(leaves) : [t]);
function crumb(t) { const out = []; let p = parentOf(t); while (p && out.length < 10) { out.unshift(p.title); p = parentOf(p); } return out.join(" › "); }
function effColor(t) { let x = t, n = 0; while (x && n++ < 10) { if (x.color && COLORS[x.color]) return x.color; x = parentOf(x); } return null; }
// done / total leaves and minutes (planned = leaves with a duration)
function progressOf(t) {
  const L = leaves(t);
  return { total: L.length, done: L.filter((x) => x.done_at).length,
    planMin: L.reduce((s, x) => s + (x.duration_min || 0), 0), doneMin: L.filter((x) => x.done_at).reduce((s, x) => s + (x.duration_min || 0), 0) };
}

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
  const bits = [], hasKids = kids(t).length;
  if (t.parent_id && !opts.noCrumb) bits.push(crumb(t));
  if (hasKids) { const p = progressOf(t); bits.push(`${p.done}/${p.total} sub-tasks`); }
  if (!t.period_start) bits.push("backlog");
  if (t.start_time) bits.push(hhmm(t.start_time) + (endOf(t) ? "–" + endOf(t) : ""));
  if (t.duration_min) bits.push(fmtDur(t.duration_min));
  if (opts.showHorizon && t.horizon !== "day") bits.push(t.horizon === "week" ? "this week" : "this month");
  if (t.recur) bits.push("↻ " + t.recur);
  if (t.due_on) bits.push((t.done_at ? "" : dday(t.due_on).text + " · ") + fmt(t.due_on, { month: "short", day: "numeric" }));
  const row = el("div", { class: `task p${t.priority}${t.done_at ? " done" : ""}${colorClass(t)}`, ...colorStyle(t) },
    el("button", { class: "tick", type: "button", "aria-label": t.done_at ? "Mark not done" : hasKids ? "Done when all sub-tasks are done" : "Mark done",
      onclick: () => (hasKids ? toast("Completes when all its sub-tasks are done") : toggle(t)) }, "✓"),
    el("button", { class: "main", type: "button", onclick: () => openSheet(t) },
      el("div", { class: "title" }, t.title), t.notes ? el("div", { class: "desc" }, t.notes) : null, bits.length ? el("div", { class: "meta" }, bits.join(" · ")) : null));
  if (opts.plan) row.append(el("button", { class: "move", type: "button", onclick: opts.plan.fn }, opts.plan.label));
  if (opts.moveToToday) row.append(el("button", { class: "move", type: "button", onclick: () => moveToToday(t) }, "→ Today"));
  return row;
}
function group(title, rows, opts = {}) {
  const head = el("div", { class: "group-title" + (opts.today ? " today" : "") }, el("span", {}, title),
    opts.action ? el("button", { type: "button", onclick: opts.action.fn }, opts.action.label) : null);
  return el("section", { class: "group" }, head, ...(rows.length ? rows : [el("div", { class: "empty" }, opts.empty || "Nothing here")]));
}

function render() {
  reindex();
  document.querySelectorAll("#view-btns button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  for (const id of ["prev", "next", "today-btn"]) $(id).hidden = view === "projects";
  $("period-label").textContent = periodLabel(view, anchor);
  $("add-title").placeholder = view === "projects" ? "New project" : `Add a task for ${view === "day" ? (anchor === TODAY ? "today" : "this day") : "this " + view}`;
  renderRings();
  const c = $("content"); c.innerHTML = ""; c.dataset.view = view;
  if (view === "day") renderDay(c); else if (view === "week") renderWeek(c); else if (view === "projects") renderProjects(c); else renderMonth(c);
}

// done / total for tasks anchored in a period (day tasks by date, week tasks by the week's Sunday, month tasks by the 1st)
function periodStats(from, to) {
  const t = tasks.filter((x) => x.period_start && x.period_start >= from && x.period_start <= to && !kids(x).length);
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
  // next backlog step of each open project, one tap to pull it into this day
  const picks = tasks.filter((r) => !r.parent_id && kids(r).length && !r.done_at)
    .map((r) => leaves(r).filter((l) => !l.period_start && !l.done_at)[0]).filter(Boolean).slice(0, 6);
  if (picks.length) c.append(group("From projects", picks.map((t) => taskRow(t, { plan: { label: "+ Add to day", fn: () => schedule(t, anchor) } })), {}));
  const wk = inPeriod("week", weekStart(anchor)), mo = inPeriod("month", firstOf(anchor));
  if (wk.length) c.append(group("This week", wk.map((t) => taskRow(t))));
  if (mo.length) c.append(group("This month", mo.map((t) => taskRow(t))));
}

function renderWeek(c) {
  const mon = weekStart(anchor);
  c.append(group("This week", inPeriod("week", mon).map((t) => taskRow(t)), { empty: "No week-level tasks." }));
  const mo = inPeriod("month", firstOf(mon));
  if (mo.length) c.append(group("This month", mo.map((t) => taskRow(t))));
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
  const taskLabel = (t) => [t.start_time ? t.start_time.slice(0, 5) : "", t.duration_min ? fmtDur(t.duration_min) : ""].filter(Boolean).join(" · ");
  // divs, not buttons: Firefox won't start a drag from a <button>
  const press = (t) => ({ role: "button", tabindex: "0", title: t.title, onclick: () => openSheet(t),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(t); } } });
  // the round check marks a task done without opening it
  const check = (t) => el("button", { type: "button", class: "mck", "aria-label": t.done_at ? "Mark not done" : "Mark done", "aria-pressed": String(!!t.done_at),
    onclick: (e) => { e.stopPropagation(); toggle(t); }, onkeydown: (e) => e.stopPropagation() }, "✓");
  const bar = (t, extra) => el("div", { ...press(t), ...colorStyle(t), class: "mbar" + (extra ? " " + extra : "") + colorClass(t) + (t.done_at ? " done" : ""),
    ...(t.horizon === "week" ? dragAttrs(t, "week") : {}) }, check(t), el("span", { class: "tt" }, t.title),
    t.duration_min ? el("span", { class: "tm" }, fmtDur(t.duration_min)) : null);
  const chip = (t) => el("div", { ...press(t), ...colorStyle(t), class: `mchip c${t.priority}${colorClass(t)}${t.done_at ? " done" : ""}`, ...dragAttrs(t, "day") },
    check(t), taskLabel(t) ? el("span", { class: "tm" }, taskLabel(t)) : null, el("span", { class: "tt" }, t.title));
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
      list.slice(0, 6).forEach((t) => dots.append(el("i", { ...colorStyle(t), class: `c${t.priority}${colorClass(t)}${t.done_at ? " done" : ""}` })));
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

// ---------- projects view ----------
const collapsed = new Set();      // project ids folded shut
let addingUnder = null;           // node id with an open inline "add sub-task" box
function whenLabel(t) { return t.period_start ? fmt(t.period_start, { month: "short", day: "numeric" }) + (t.horizon !== "day" ? ` · ${t.horizon}` : "") : "Backlog"; }
function nodeRow(t, depth) {
  const hasKids = kids(t).length, p = hasKids ? progressOf(t) : null;
  const row = el("div", { class: "pnode" + (t.done_at ? " done" : "") + colorClass(t), ...colorStyle(t), style: `${colorStyle(t).style || ""}; --depth: ${depth}` },
    el("button", { class: "tick sm", type: "button", "aria-label": t.done_at ? "Mark not done" : "Mark done",
      onclick: () => (hasKids ? toast("Completes when all its sub-tasks are done") : toggle(t)) }, "✓"),
    el("button", { class: "pt-title", type: "button", onclick: () => openSheet(t) }, t.title),
    el("span", { class: "pt-meta" }, [hasKids ? `${p.done}/${p.total}` : "", whenLabel(t), t.duration_min ? fmtDur(t.duration_min) : ""].filter(Boolean).join(" · ")),
    t.due_on && !t.done_at ? el("span", { class: "dd " + dday(t.due_on).cls }, dday(t.due_on).text) : null,
    !hasKids && !t.done_at && t.period_start !== TODAY ? el("button", { class: "pt-btn", type: "button", onclick: () => schedule(t, TODAY) }, "→ Today") : null,
    depth < MAX_DEPTH ? el("button", { class: "pt-btn", type: "button", "aria-label": "Add sub-task", onclick: () => { addingUnder = addingUnder === t.id ? null : t.id; render(); } }, "＋") : null);
  return row;
}
function addBox(parent, depth) {
  const input = el("input", { type: "text", maxlength: "200", placeholder: "Add a sub-task", enterkeyhint: "done", "aria-label": "New sub-task" });
  const go = async () => { await addKid(parent, input.value, null); addingUnder = parent.id; render(); const n = document.querySelector(`[data-addbox="${parent.id}"] input`); if (n) n.focus(); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  return el("div", { class: "pnode add", "data-addbox": String(parent.id), style: `--depth: ${depth}` }, input, el("button", { type: "button", onclick: go }, "Add"));
}
function treeRows(t, depth, out) {
  for (const k of kids(t)) { out.push(nodeRow(k, depth)); if (addingUnder === k.id) out.push(addBox(k, depth + 1)); treeRows(k, depth + 1, out); }
  return out;
}
function projectCard(r) {
  const hasKids = kids(r).length, p = progressOf(r), open = !collapsed.has(r.id), pct = p.total && hasKids ? Math.round(p.done / p.total * 100) : (r.done_at ? 100 : 0);
  const stats = [hasKids ? `${p.done}/${p.total} done` : "no sub-tasks yet",
    p.planMin ? `${fmtDur(p.doneMin)} of ${fmtDur(p.planMin)} planned` : "", r.duration_min ? `budget ${fmtDur(r.duration_min)}` : ""].filter(Boolean).join(" · ");
  const over = r.duration_min && p.planMin > r.duration_min;
  const next = leaves(r).filter((l) => !l.done_at && (!l.period_start || l.period_start > TODAY))[0];
  const dd = r.due_on && !r.done_at ? dday(r.due_on) : null;
  const short = (d) => fmt(d, { month: "short", day: "numeric" });
  let span = "";
  if (r.start_on || r.due_on) {
    span = (r.start_on ? short(r.start_on) : "…") + " → " + (r.due_on ? short(r.due_on) : "…");
    if (r.start_on && r.start_on > TODAY) span += ` · starts in ${Math.round((parse(r.start_on) - parse(TODAY)) / 86400000)}d`;
    else if (r.start_on && r.due_on) { const tot = Math.round((parse(r.due_on) - parse(r.start_on)) / 86400000) + 1, day = Math.round((parse(TODAY) - parse(r.start_on)) / 86400000) + 1; if (day <= tot && !r.done_at) span += ` · day ${day} of ${tot}`; }
  }
  const card = el("section", { class: "pcard" + colorClass(r) + (r.done_at ? " done" : ""), ...colorStyle(r) },
    el("div", { class: "pc-head" },
      el("button", { class: "pc-fold", type: "button", "aria-expanded": String(open), "aria-label": open ? "Collapse" : "Expand", onclick: () => { open ? collapsed.add(r.id) : collapsed.delete(r.id); render(); } }, open ? "▾" : "▸"),
      el("button", { class: "pc-title", type: "button", onclick: () => openSheet(r) }, r.title),
      dd ? el("span", { class: "dd big " + dd.cls, title: "Deadline " + r.due_on }, dd.text) : null),
    el("div", { class: "pbar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, el("i", { style: `width:${pct}%` })),
    span ? el("div", { class: "pc-span" }, span) : null,
    el("div", { class: "pc-stats" + (over ? " warn" : "") }, stats + (over ? " — over budget" : "")),
    el("div", { class: "pc-actions" },
      next ? el("button", { type: "button", class: "pt-btn solid", onclick: () => schedule(next, TODAY) }, "Plan next → today") : null,
      el("button", { type: "button", class: "pt-btn", onclick: () => { addingUnder = addingUnder === r.id ? null : r.id; collapsed.delete(r.id); render(); } }, "＋ Sub-task")));
  if (open) {
    const body = el("div", { class: "pc-body" });
    if (addingUnder === r.id) body.append(addBox(r, 1));
    treeRows(r, 1, []).forEach((n) => body.append(n));
    if (!hasKids && addingUnder !== r.id) body.append(el("div", { class: "empty" }, "No sub-tasks yet — add the first step."));
    card.append(body);
  }
  return card;
}
function renderProjects(c) {
  const roots = tasks.filter((t) => !t.parent_id && (kids(t).length || t.horizon !== "day"));
  const byDue = (x, y) => (x.due_on || "9") < (y.due_on || "9") ? -1 : (x.due_on || "9") > (y.due_on || "9") ? 1 : x.id - y.id;
  const openOnes = roots.filter((t) => !t.done_at).sort(byDue), doneOnes = roots.filter((t) => t.done_at);
  if (!roots.length) c.append(el("div", { class: "empty" }, "No projects yet. Add one above, then add sub-tasks to it."));
  openOnes.forEach((r) => c.append(projectCard(r)));
  if (doneOnes.length) c.append(group("Completed", doneOnes.map((r) => projectCard(r)), {}));
}

// ---------- mutations ----------
async function toggle(t) {
  const was = t.done_at, next = was ? null : new Date().toISOString();
  t.done_at = next; render();
  const { error } = await sb.from("tasks").update({ done_at: next }).eq("id", t.id);
  if (error) { t.done_at = was; render(); toast("Couldn't save — check your connection"); return; }
  await syncUp(t);
  if (next && t.recur) await spawnNext(t);
}
// a parent is done exactly when all its sub-tasks are
async function syncUp(t) {
  if (!t.parent_id) return;
  const changed = await TasksCore.syncParents(sb, t);
  for (const ch of changed) { const p = idx.get(ch.id); if (p) p.done_at = ch.done_at; }
  if (changed.length) { render(); toast(changed[0].done_at ? "Project step complete — parent task done too" : "Parent task reopened"); }
}
// put a task (usually a backlog sub-task) on a specific day
async function schedule(t, iso) {
  const prev = { horizon: t.horizon, period_start: t.period_start };
  t.horizon = "day"; t.period_start = iso; render();
  const { error } = await sb.from("tasks").update({ horizon: "day", period_start: iso }).eq("id", t.id);
  if (error) { Object.assign(t, prev); render(); toast("Couldn't plan it"); return; }
  toast(iso === TODAY ? "Added to today" : `Planned for ${fmt(iso, { weekday: "short", month: "short", day: "numeric" })}`);
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
  const row = view === "projects" ? { title, horizon: "month", period_start: firstOf(TODAY) } : { title, horizon: view, period_start: periodStart(view, anchor) };
  const { data, error } = await sb.from("tasks").insert(row).select().single();
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
  $("f-dur").value = t.duration_min || ""; setColor(t.color || "");
  $("f-due").value = t.due_on || ""; $("f-start-on").value = t.start_on || ""; fillParentSelect(t); $("f-unsched").checked = !t.period_start;
  syncParentUi(); renderKidsList(t);
  $("f-priority").value = String(t.priority); $("f-recur").value = t.recur || ""; $("f-done").checked = !!t.done_at;
  syncTimeRow(); $("sheet").hidden = false;
}
// colour swatches + duration presets in the edit sheet
let sheetColor = "";
function setColor(c) {
  sheetColor = c;
  document.querySelectorAll("#f-colors button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.c === c)));
}
{
  const box = $("f-colors");
  box.append(el("button", { type: "button", class: "sw none", "data-c": "", role: "radio", "aria-label": "No color", title: "No color", onclick: () => setColor("") }, "∅"));
  for (const [name, hex] of Object.entries(COLORS)) box.append(el("button", { type: "button", class: "sw", "data-c": name, role: "radio", "aria-label": name, title: name,
    style: `--tc: ${hex}`, onclick: () => setColor(name) }));
  $("dur-chips").addEventListener("click", (e) => { const b = e.target.closest("button[data-m]"); if (b) $("f-dur").value = b.dataset.m; });
}
const closeSheet = () => { $("sheet").hidden = true; editing = null; };
$("f-horizon").addEventListener("change", syncTimeRow);

// parent picker: anything that isn't this task or inside it, as long as 3 levels still hold
function fillParentSelect(t) {
  const sel = $("f-parent"); sel.innerHTML = ""; sel.append(new Option("None (top level)", ""));
  const room = MAX_DEPTH - heightOf(t);                 // deepest allowed depth for the new parent
  const walk = (n, d) => {
    if (n.id === t.id) return;
    if (d <= room) sel.append(new Option("\u00a0\u00a0".repeat(d - 1) + (d > 1 ? "↳ " : "") + n.title, String(n.id)));
    kids(n).forEach((k) => walk(k, d + 1));
  };
  tasks.filter((n) => !n.parent_id).sort((x, y) => x.id - y.id).forEach((n) => walk(n, 1));
  sel.value = t.parent_id ? String(t.parent_id) : "";
}
function syncParentUi() {
  const has = !!$("f-parent").value;
  $("f-unsched-row").hidden = !has;
  if (!has) $("f-unsched").checked = false;
  $("f-date").disabled = $("f-unsched").checked;
}
$("f-parent").addEventListener("change", syncParentUi);
$("f-unsched").addEventListener("change", syncParentUi);

// sub-tasks list inside the sheet
function renderKidsList(t) {
  const wrap = $("f-kids-wrap"), box = $("f-kids");
  wrap.hidden = depthOf(t) >= MAX_DEPTH; box.innerHTML = "";
  kids(t).forEach((k) => box.append(el("div", { class: "kid" + (k.done_at ? " done" : "") },
    el("button", { type: "button", class: "kid-tick", "aria-label": k.done_at ? "Mark not done" : "Mark done", onclick: async () => { await toggle(k); renderKidsList(t); } }, "✓"),
    el("button", { type: "button", class: "kid-title", onclick: () => openSheet(k) }, k.title),
    el("span", { class: "kid-when" }, k.period_start ? fmt(k.period_start, { month: "short", day: "numeric" }) : "backlog"))));
}
async function addKid(parent, title, input) {
  title = title.trim(); if (!title) return;
  const { data, error } = await sb.from("tasks").insert({ title, horizon: "day", period_start: null, parent_id: parent.id }).select().single();
  if (error) { toast("Couldn't add the sub-task"); return; }
  tasks.push(data); render(); if (input) { input.value = ""; input.focus(); }
  await syncUp(data);                                   // a finished parent reopens when it gets a new step
}
$("f-kid-add").addEventListener("click", () => editing && addKid(editing, $("f-kid").value, $("f-kid")).then(() => editing && renderKidsList(editing)));
$("f-kid").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("f-kid-add").click(); } });
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
  const parentId = $("f-parent").value ? Number($("f-parent").value) : null, unsched = !!parentId && $("f-unsched").checked;
  if (!unsched && !$("f-date").value) { toast("Pick a date"); return; }
  if ($("f-start-on").value && $("f-due").value && $("f-due").value < $("f-start-on").value) { toast("The deadline is before the start date"); return; }
  const patch = { title: $("f-title").value.trim(), notes: $("f-notes").value.trim() || null, horizon,
    period_start: unsched ? null : periodStart(horizon, $("f-date").value), start_time: start, end_time: end,
    parent_id: parentId, due_on: $("f-due").value || null, start_on: $("f-start-on").value || null,
    priority: Number($("f-priority").value), recur: $("f-recur").value || null,
    duration_min: Math.round(Number($("f-dur").value)) || null, color: sheetColor || null };
  if (patch.duration_min && (patch.duration_min < 1 || patch.duration_min > 1440)) { toast("Duration must be 1–1440 minutes"); return; }
  if (!patch.title) return;
  const wantDone = $("f-done").checked, becameDone = wantDone && !t.done_at;
  if (wantDone !== !!t.done_at) patch.done_at = wantDone ? new Date().toISOString() : null;
  const { data, error } = await sb.from("tasks").update(patch).eq("id", t.id).select().single();
  if (error) { toast("Couldn't save"); return; }
  const oldParent = t.parent_id;
  Object.assign(t, data); closeSheet(); render();
  await syncUp(t);
  if (oldParent && oldParent !== t.parent_id) { const gone = { id: t.id, parent_id: oldParent }; await syncUp(gone); }
  if (becameDone && t.recur) await spawnNext(t);
});
// delete a task and everything under it; the toast offers Undo (re-creates the same tree)
const subtree = (t) => [t, ...kids(t).flatMap(subtree)];
async function deleteTree(t) {
  const gone = subtree(t), goneIds = new Set(gone.map((x) => x.id)), parentId = t.parent_id;
  const { error } = await sb.from("tasks").delete().eq("id", t.id);        // children go with it (on delete cascade)
  if (error) { toast("Couldn't delete"); return; }
  tasks = tasks.filter((x) => !goneIds.has(x.id)); render();
  if (parentId) await syncUp({ id: -1, parent_id: parentId });
  toast(gone.length > 1 ? `Deleted "${t.title}" and ${gone.length - 1} sub-task${gone.length > 2 ? "s" : ""}` : `Deleted "${t.title}"`, { label: "Undo", fn: () => restoreTree(gone) });
}
async function restoreTree(rows) {
  const map = new Map(), skip = ["id", "created_at", "user_id", "synced_at"];
  for (const r of rows) {                                                     // parents come before their children
    const row = Object.fromEntries(Object.entries(r).filter(([k]) => !skip.includes(k)));
    row.parent_id = r.parent_id && map.has(r.parent_id) ? map.get(r.parent_id) : r.parent_id;
    const { data, error } = await sb.from("tasks").insert(row).select().single();
    if (error) { toast("Couldn't restore everything"); break; }
    map.set(r.id, data.id); tasks.push(data);
  }
  render(); toast("Restored");
}
$("f-delete").addEventListener("click", async () => {
  const t = editing; if (!t) return;
  closeSheet(); await deleteTree(t);
});

// ---------- navigation ----------
function step(dir) {
  anchor = view === "day" ? addDays(anchor, dir) : view === "week" ? addDays(anchor, 7 * dir) : addMonths(firstOf(anchor), dir);
  render();
}
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("today-btn").addEventListener("click", () => { anchor = TODAY; render(); });
$("view-btns").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]"); if (!b) return;
  view = b.dataset.view;
  try { localStorage.setItem("tasks:view", view); } catch {}
  render();
});

render();
load();
