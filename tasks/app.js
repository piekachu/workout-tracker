const sb = Auth.client;

// ---------- dates: local-time strings only ----------
// toISOString()/new Date("YYYY-MM-DD") are UTC-based and land a day off in
// Asia/Seoul around midnight, so every date here is built from local parts.
const { pad, localISO, parse, addDays, firstOf, addMonths, weekStart, periodStart } = TasksCore;
const TODAY = localISO(new Date());

const fmt = (iso, opts) => parse(iso).toLocaleDateString(undefined, opts);
function periodLabel(view, anchor) {
  if (view === "nested") return "Tasks with sub-tasks";
  if (view === "day") return fmt(anchor, { weekday: "short", month: "short", day: "numeric" }) + (anchor === TODAY ? " · Today" : "");
  if (view === "week") {
    const mon = weekStart(anchor), sun = addDays(mon, 6);
    const sameMonth = mon.slice(0, 7) === sun.slice(0, 7);
    return `${fmt(mon, { month: "short", day: "numeric" })} – ${fmt(sun, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  }
  return fmt(anchor, { month: "long", year: "numeric" });
}

// ---------- colours ----------
const COLORS = { red: "#e5484d", orange: "#f76b15", yellow: "#d9a406", green: "#30a46c", teal: "#12a594", blue: "#3e63dd", purple: "#8e4ec6", pink: "#d6409f", gray: "#8b8d98" };
const hexOf = (c) => (c && (COLORS[c] || (/^#[0-9a-fA-F]{6}$/.test(c) ? c : null))) || null;
const colorStyle = (t) => { const c = effColor(t); return c ? { style: `--tc: ${hexOf(c)}` } : {}; };
const colorClass = (t) => (effColor(t) ? " tinted" : "");
const endOf = (t) => (t.end_time ? t.end_time.slice(0, 5) : "");

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
try { const v = localStorage.getItem("tasks:view"); if (["day", "week", "month", "nested"].includes(v)) view = v; } catch {}

// ---------- spans + D-day counter ----------
// A task starts on period_start and may have an end date (end_on), its deadline.
const endDate = (t) => (t.period_start ? (t.end_on && t.end_on > t.period_start ? t.end_on : t.period_start) : null);
const isMulti = (t) => !!t.period_start && endDate(t) > t.period_start;
const spanDays = (t) => (isMulti(t) ? Math.round((parse(endDate(t)) - parse(t.period_start)) / 86400000) + 1 : 1);
const covers = (t, iso) => !!t.period_start && t.period_start <= iso && endDate(t) >= iso;
const dayGap = (iso) => Math.round((parse(iso) - parse(TODAY)) / 86400000);
// time left today, to the task's end time if it has one, otherwise to midnight
function timeLeftToday(t) {
  const now = new Date(), end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 24, 0, 0);
  if (t.end_time) { const [h, m] = t.end_time.split(":").map(Number); end.setHours(h, m, 0, 0); }
  const min = Math.floor((end - now) / 60000);
  if (min <= 0) return "time's up";
  return (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`) + " left";
}
// D-5 until the last day, then "D-Day · 3h 20m left", then D+1 once it's past. Only for tasks that last several days.
function dleft(t) {
  if (!isMulti(t) || !t.period_start) return null;
  const n = dayGap(endDate(t));
  return { n, text: n > 0 ? `D-${n}` : n === 0 ? `D-Day · ${timeLeftToday(t)}` : `D+${-n}`, cls: n < 0 ? "late" : n <= 3 ? "soon" : "" };
}
// ---------- hierarchy ----------
// A task can sit under another one (max 3 levels). Sub-tasks may be unscheduled (period_start = null): the project's backlog.
const MAX_DEPTH = 3;
let idx = new Map(), kidMap = new Map();
function reindex() {
  idx = new Map(tasks.map((t) => [t.id, t])); kidMap = new Map();
  for (const t of [...tasks].sort((x, y) => ((x.sort_order ?? 1e15) - (y.sort_order ?? 1e15)) || x.id - y.id)) if (t.parent_id) (kidMap.get(t.parent_id) || kidMap.set(t.parent_id, []).get(t.parent_id)).push(t);
}
const kids = (t) => kidMap.get(t.id) || [];
const parentOf = (t) => (t.parent_id ? idx.get(t.parent_id) || null : null);
function depthOf(t) { let d = 1, p = parentOf(t); while (p && d < 10) { d++; p = parentOf(p); } return d; }
const heightOf = (t) => 1 + Math.max(0, ...kids(t).map(heightOf));
const leaves = (t) => (kids(t).length ? kids(t).flatMap(leaves) : [t]);
function crumb(t) { const out = []; let p = parentOf(t); while (p && out.length < 10) { out.unshift(p.title); p = parentOf(p); } return out.join(" › "); }
function effColor(t) { let x = t, n = 0; while (x && n++ < 10) { if (hexOf(x.color)) return x.color; x = parentOf(x); } return null; }
// not started / in progress / done. A task with sub-tasks follows them.
function statusOf(t) {
  const ks = kids(t);
  if (ks.length) { const st = ks.map(statusOf); return st.every((s) => s === "done") ? "done" : st.some((s) => s !== "todo") ? "doing" : "todo"; }
  return t.done_at ? "done" : t.in_progress ? "doing" : "todo";
}
const NEXT_STATUS = { todo: "doing", doing: "done", done: "todo" };
const stCls = (t) => (statusOf(t) === "doing" ? " doing" : "");
const stLabel = (t) => ({ todo: "Not started — tap to start", doing: "In progress — tap to finish", done: "Done — tap to reset" })[statusOf(t)];
// done / total leaves
function progressOf(t) {
  const L = leaves(t);
  return { total: L.length, done: L.filter((x) => x.done_at).length };
}

async function load() {
  const { data, error } = await sb.from("tasks").select("*").order("id").limit(3000);
  if (error) { toast("Couldn't load tasks"); return; }
  tasks = data || [];
  render();
}

// open first, then timed, then creation order
function sorted(list) {
  return [...list].sort((a, b) =>
    (!!a.done_at - !!b.done_at) ||
    ((a.sort_order ?? 1e15) - (b.sort_order ?? 1e15)) ||
    ((a.start_time || "99") < (b.start_time || "99") ? -1 : (a.start_time || "99") > (b.start_time || "99") ? 1 : 0) ||
    (a.id - b.id));
}
const startingOn = (iso) => sorted(tasks.filter((t) => t.period_start === iso));
const ongoingOn = (iso) => sorted(tasks.filter((t) => isMulti(t) && covers(t, iso) && t.period_start < iso));

// ---------- rendering ----------
function taskRow(t, opts = {}) {
  const hhmm = (s) => (s ? s.slice(0, 5) : "");
  const bits = [], hasKids = kids(t).length;
  if (opts.dueTag) bits.push("⚑ due");
  if (t.parent_id && !opts.noCrumb) bits.push(crumb(t));
  if (hasKids) { const p = progressOf(t); bits.push(`${p.done}/${p.total} sub-tasks`); }
  if (!t.period_start) bits.push("backlog");
  if (t.start_time) bits.push(hhmm(t.start_time) + (endOf(t) ? "–" + endOf(t) : ""));
  if (t.recur) bits.push("↻ " + t.recur);
  if (isMulti(t)) { bits.push(`${fmt(t.period_start, { month: "short", day: "numeric" })} → ${fmt(endDate(t), { month: "short", day: "numeric" })}`); const d = !t.done_at && dleft(t); if (d) bits.push(d.text); }
  const row = el("div", { class: `task${t.done_at ? " done" : ""}${colorClass(t)}`, "data-id": String(t.id), ...colorStyle(t) },
    opts.drag ? el("button", { class: "drag-h" + (t.done_at ? " off" : ""), type: "button", tabindex: "-1", "aria-label": "Drag to reorder", title: "Drag to reorder" }, "⋮⋮") : null,
    el("button", { class: "tick" + stCls(t), type: "button", "aria-label": hasKids ? "Follows its sub-tasks" : stLabel(t), title: hasKids ? "Follows its sub-tasks" : stLabel(t),
      onclick: () => (hasKids ? toast("Follows its sub-tasks") : toggle(t)) }, "✓"),
    el("button", { class: "main", type: "button", onclick: () => openSheet(t) },
      el("div", { class: "title" }, t.title), t.notes ? el("div", { class: "desc" }, t.notes) : null, bits.length ? el("div", { class: "meta" }, bits.join(" · ")) : null));
  if (opts.plan) row.append(el("button", { class: "move", type: "button", onclick: opts.plan.fn }, opts.plan.label));
  if (opts.moveToToday) row.append(el("button", { class: "move", type: "button", onclick: () => moveToToday(t) }, "→ Today"));
  return row;
}
function group(title, rows, opts = {}) {
  const head = el("div", { class: "group-title" + (opts.today ? " today" : "") }, el("span", {}, title),
    opts.action ? el("button", { type: "button", onclick: opts.action.fn }, opts.action.label) : null);
  const sec = el("section", { class: "group" }, head, ...(rows.length ? rows : [el("div", { class: "empty" }, opts.empty || "Nothing here")]));
  if (opts.reorder) UI.reorder(sec, { item: ".task", onDrop: (ids) => saveOrder(ids) });
  return sec;
}
// persist a manual order: sort_order = position in the list
async function saveOrder(ids) {
  const byId = new Map(tasks.map((x) => [String(x.id), x])), jobs = [];
  ids.forEach((id, i) => { const x = byId.get(id), v = (i + 1) * 10; if (x && x.sort_order !== v) { x.sort_order = v; jobs.push(sb.from("tasks").update({ sort_order: v }).eq("id", x.id)); } });
  const res = await Promise.all(jobs);
  if (res.some((r) => r.error)) toast("Couldn't save the order");
  render();
}
async function moveSibling(t, dir) {
  const sibs = t.parent_id ? kids(parentOf(t)) : [], i = sibs.indexOf(t), j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return toast(dir < 0 ? "Already first" : "Already last");
  const ids = sibs.map((x) => String(x.id)); [ids[i], ids[j]] = [ids[j], ids[i]];
  await saveOrder(ids);
}

function syncPasteUi() {
  const b = document.getElementById("add-paste"); if (!b) return;
  b.hidden = !canPaste(null); if (clip) b.textContent = "Paste";
}
function render() {
  syncPasteUi();
  reindex();
  document.querySelectorAll("#view-btns button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  for (const id of ["prev", "next", "today-btn"]) $(id).hidden = view === "nested";
  $("period-label").textContent = periodLabel(view, anchor);
  $("add-title").placeholder = view === "nested" ? "New task (then add sub-tasks)" : view === "day" ? `Add a task for ${anchor === TODAY ? "today" : "this day"}` : "Add a task";
  renderRings();
  const c = $("content"); c.innerHTML = ""; c.dataset.view = view;
  if (view === "day") renderDay(c); else if (view === "week") renderWeek(c); else if (view === "nested") renderNested(c); else renderMonth(c);
}

// done / total for tasks that start in a period
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
    const overdue = sorted(tasks.filter((t) => t.period_start && endDate(t) < TODAY && !t.done_at));
    if (overdue.length) c.append(group("Overdue", overdue.map((t) => taskRow(t, { moveToToday: true })), {}));
  }
  c.append(group("Day", startingOn(anchor).map((t) => taskRow(t, { drag: true })), { today: anchor === TODAY, reorder: true, empty: "Nothing planned — add something below." }));
  const ongoing = ongoingOn(anchor);
  if (ongoing.length) c.append(group("Ongoing", ongoing.map((t) => taskRow(t))));
  // next waiting sub-task of each open task, one tap to pull it into this day
  const picks = tasks.filter((r) => !r.parent_id && kids(r).length && !r.done_at)
    .map((r) => leaves(r).filter((l) => !l.period_start && !l.done_at)[0]).filter(Boolean).slice(0, 6);
  if (picks.length) c.append(group("From sub-tasks", picks.map((t) => taskRow(t, { plan: { label: "+ Add to day", fn: () => schedule(t, anchor) } })), {}));
}

function renderWeek(c) {
  const mon = weekStart(anchor), sun = addDays(mon, 6);
  const spanning = sorted(tasks.filter((t) => isMulti(t) && t.period_start <= sun && endDate(t) >= mon));
  if (spanning.length) {
    // the tasks that last several days, drawn as long lines across the days they cover
    const { bar } = calBits();
    const days = el("div", { class: "wk-days" }), bars = el("div", { class: "mcal-bars" });
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i);
      days.append(el("button", { type: "button", class: d === TODAY ? "today" : "", onclick: () => { view = "day"; anchor = d; render(); } },
        el("span", { class: "n" }, fmt(d, { weekday: "short" })), el("span", { class: "d" }, String(parse(d).getDate()))));
    }
    spanning.forEach((t) => {
      const c1 = t.period_start > mon ? Math.round((parse(t.period_start) - parse(mon)) / 86400000) : 0;
      const e = endDate(t), c2 = e < sun ? Math.round((parse(e) - parse(mon)) / 86400000) : 6;
      bars.append(bar(t, c1, c2));
    });
    c.append(el("section", { class: "wk-strip", "aria-label": "Tasks spanning this week" }, days, bars));
  }
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, i);
    const rows = [...sorted(tasks.filter((t) => isMulti(t) && endDate(t) === day)).map((t) => taskRow(t, { dueTag: true })),
      ...startingOn(day).filter((t) => !isMulti(t)).map((t) => taskRow(t))];
    c.append(group(fmt(day, { weekday: "short", month: "short", day: "numeric" }), rows,
      { today: day === TODAY, empty: "—", action: { label: "Open ›", fn: () => { view = "day"; anchor = day; render(); } } }));
  }
}

// ---------- drag and drop in the month grid ----------
// A day chip dropped on another day changes its date; a week bar dropped anywhere in
// another week's row changes its week. The edit sheet stays the keyboard/phone route.
let drag = null;   // { id } while something is being dragged
function dragAttrs(t) {
  return { draggable: "true",
    ondragstart: (e) => { drag = { id: t.id }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(t.id)); e.currentTarget.classList.add("dragging"); },
    ondragend: () => { drag = null; clearDrop(); } };
}
function clearDrop() { document.querySelectorAll(".drop, .dragging").forEach((n) => n.classList.remove("drop", "dragging")); }
function acceptDrops(nodes, iso) {
  for (const n of nodes) {
    n.addEventListener("dragover", (e) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; clearDrop(); nodes.forEach((x) => x.classList.add("drop")); });
    n.addEventListener("drop", (e) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); const d = drag; drag = null; clearDrop(); moveTask(d, iso); });
  }
}
// dropping a task on a day makes that its start date (a multi-day task keeps its length)
async function moveTask(d, iso) {
  const t = tasks.find((x) => x.id === d.id); if (!t || iso === t.period_start) return;
  const prev = t.period_start; t.period_start = iso; render();
  const { error } = await sb.from("tasks").update({ period_start: iso }).eq("id", t.id);
  if (error) { t.period_start = prev; render(); toast("Couldn't move it"); return; }
  toast(`Moved to ${fmt(iso, { weekday: "short", month: "short", day: "numeric" })}`);
}

// ISO week number of the week containing `iso`. A Sunday-start week gets the number of its Monday, as Notion Calendar does.
function isoWeek(iso) {
  const d = parse(iso); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

// pieces shared by the month grid and the week strip: one-day chips, multi-day bars, due flags
function calBits() {
  const taskLabel = (t) => (t.start_time ? t.start_time.slice(0, 5) : "");
  // divs, not buttons: Firefox won't start a drag from a <button>
  const press = (t) => ({ role: "button", tabindex: "0", title: t.title, onclick: () => openSheet(t),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(t); } } });
  // the round check marks a task done without opening it
  const check = (t) => el("button", { type: "button", class: "mck" + stCls(t), "aria-label": stLabel(t), title: stLabel(t),
    onclick: (e) => { e.stopPropagation(); toggle(t); }, onkeydown: (e) => e.stopPropagation() }, "✓");
  const bar = (t, c1, c2) => { const d = !t.done_at && dleft(t);
    return el("div", { ...press(t), ...colorStyle(t), ...dragAttrs(t), class: "mbar" + colorClass(t) + (t.done_at ? " done" : ""), style: `${colorStyle(t).style || ""}; grid-column: ${c1 + 1} / ${c2 + 2}` },
      check(t), el("span", { class: "tt" }, t.title), el("span", { class: "tm" }, d ? d.text.split(" · ")[0] : spanDays(t) + "d")); };
  const chip = (t) => el("div", { ...press(t), ...colorStyle(t), ...dragAttrs(t), class: `mchip${colorClass(t)}${t.done_at ? " done" : ""}` },
    check(t), taskLabel(t) ? el("span", { class: "tm" }, taskLabel(t)) : null, el("span", { class: "tt" }, t.title));
  // a flag on the day a task ends, so deadlines stand out from the bar that leads up to them
  const dueFlag = (t) => el("div", { ...press(t), ...colorStyle(t), class: "mdue" + colorClass(t) + (t.done_at ? " done" : ""), title: `Due: ${t.title}` },
    el("span", { class: "fl", "aria-hidden": "true" }, "⚑"), el("span", { class: "tt" }, t.title), el("span", { class: "tm" }, "due"));
  return { press, check, bar, chip, dueFlag };
}

// Month grid: week rows with a week number, date numbers on top. A task that lasts several days is a bar
// across the days it covers; a one-day task is a tinted chip; "N more" when a day overflows.
function renderMonth(c) {
  const first = firstOf(anchor), last = addDays(addMonths(first, 1), -1), month = first.slice(0, 7);
  const { chip, bar, dueFlag } = calBits();
  const goDay = (iso) => { view = "day"; anchor = iso; render(); };

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayIdx = parse(TODAY).getDay();
  const head = el("div", { class: "mcal-head" }, el("span", { class: "w" }, "W"),
    el("div", { class: "days" }, ...names.map((n, i) => el("span", { class: view === "month" && TODAY.slice(0, 7) === month && i === todayIdx ? "today-col" : "" }, n))));
  const grid = el("div", { class: "mcal" }, head);

  for (let m = weekStart(first); m <= last; m = addDays(m, 7)) {
    const m6 = addDays(m, 6);
    const spans = sorted(tasks.filter((t) => isMulti(t) && t.period_start <= m6 && endDate(t) >= m));
    const dates = el("div", { class: "mcal-dates" }), chips = el("div", { class: "mcal-chips" }), dayTargets = [];
    const bars = el("div", { class: "mcal-bars" });
    spans.forEach((t) => {
      const c1 = t.period_start > m ? Math.round((parse(t.period_start) - parse(m)) / 86400000) : 0;
      const e = endDate(t), c2 = e < m6 ? Math.round((parse(e) - parse(m)) / 86400000) : 6;
      bars.append(bar(t, c1, c2));
    });
    const maxChips = Math.max(2, 4 - Math.min(spans.length, 2));
    for (let i = 0; i < 7; i++) {
      const iso = addDays(m, i), inMonth = iso.slice(0, 7) === month, list = startingOn(iso).filter((t) => !isMulti(t));
      const dues = sorted(tasks.filter((t) => isMulti(t) && endDate(t) === iso));
      const showMonth = iso.slice(8) === "01";
      const dateBtn = el("button", { type: "button", class: (iso === TODAY ? "today " : "") + (inMonth ? "" : "out"), "aria-label": iso, onclick: () => goDay(iso) },
        showMonth ? el("span", { class: "m" }, fmt(iso, { month: "short" })) : null, el("span", { class: "d" }, String(parse(iso).getDate())));
      dates.append(dateBtn);
      const col = el("div", { class: "mcal-col" });
      dayTargets.push([[dateBtn, col], iso]);
      const items = [...dues.map((t) => [dueFlag, t]), ...list.map((t) => [chip, t])];
      const visible = items.length > maxChips ? maxChips - 1 : items.length;
      items.slice(0, visible).forEach(([make, t]) => col.append(make(t)));
      if (items.length > visible) col.append(el("button", { type: "button", class: "mmore", onclick: () => goDay(iso) }, `${items.length - visible} more`));
      const dots = el("div", { class: "mdots", onclick: () => goDay(iso) });
      items.slice(0, 6).forEach(([make, t]) => dots.append(el("i", { ...colorStyle(t), class: `${colorClass(t).trim()}${make === dueFlag ? " due" : ""}${t.done_at ? " done" : ""}` })));
      col.append(dots);
      chips.append(col);
    }
    const body = el("div", { class: "mcal-body" }, dates, bars, chips);
    const weekRow = el("div", { class: "mcal-week" }, el("div", { class: "wk" }, String(isoWeek(addDays(m, 1)))), body);
    dayTargets.forEach(([nodes, iso]) => acceptDrops(nodes, iso));
    grid.append(weekRow);
  }
  c.append(grid);
}

// ---------- tasks with sub-tasks ----------
const collapsed = new Set();      // task ids folded shut (remembered between visits)
try { JSON.parse(localStorage.getItem("tasks.collapsed") || "[]").forEach((i) => collapsed.add(i)); } catch (_) {}
const saveCollapsed = () => { try { localStorage.setItem("tasks.collapsed", JSON.stringify([...collapsed])); } catch (_) {} };
let addingUnder = null;           // node id with an open inline "add sub-task" box
function whenLabel(t) {
  if (!t.period_start) return "";
  const d = (x) => fmt(x, { month: "short", day: "numeric" });
  return isMulti(t) ? `${d(t.period_start)} → ${d(endDate(t))}` : d(t.period_start);
}
// small circular progress for the tasks directly under a top-level task
function miniRing(done, total, size = 24) {
  const r = (size - 5) / 2, c = 2 * Math.PI * r, f = total ? done / total : 0, full = total && done === total;
  const span = document.createElement("span"); span.className = "mring"; span.title = `${done} of ${total} done`;
  span.setAttribute("role", "img"); span.setAttribute("aria-label", `${done} of ${total} sub-tasks done`);
  span.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="3.5"/>` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${full ? "var(--up)" : "var(--accent)"}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  return span;
}
function nodeRow(t, depth) {
  const hasKids = kids(t).length, p = hasKids ? progressOf(t) : null, dl = !t.done_at && dleft(t), st = statusOf(t);
  const sub = [hasKids ? `${p.done}/${p.total}` : "", whenLabel(t)].filter(Boolean).join(" · ");
  const row = el("div", { class: "pnode" + (t.done_at ? " done" : "") + colorClass(t), ...colorStyle(t), style: `${colorStyle(t).style || ""}; --depth: ${depth}` },
    el("button", { class: "tick sm" + stCls(t), type: "button", "aria-label": hasKids ? "Follows its sub-tasks" : stLabel(t), title: hasKids ? "Follows its sub-tasks" : stLabel(t),
      onclick: () => (hasKids ? toast("Follows its sub-tasks") : toggle(t)) }, "✓"),
    hasKids ? el("button", { class: "pt-fold", type: "button", "aria-expanded": String(!collapsed.has(t.id)), "aria-label": collapsed.has(t.id) ? "Expand" : "Collapse", onclick: () => { collapsed.has(t.id) ? collapsed.delete(t.id) : collapsed.add(t.id); saveCollapsed(); render(); } }, collapsed.has(t.id) ? "▸" : "▾") : el("span", { class: "pt-fold" }),
    el("button", { class: "pt-title", type: "button", onclick: () => openSheet(t) }, t.title),
    UI.kebab(() => [
      !hasKids ? { label: st === "doing" ? "Mark not started" : "Mark in progress", fn: () => setStatus(t, st === "doing" ? "todo" : "doing") } : null,
      !hasKids && st !== "done" ? { label: "Mark done", fn: () => setStatus(t, "done") } : null,
      !hasKids && !t.done_at && t.period_start !== TODAY ? { label: "Move to today", fn: () => schedule(t, TODAY) } : null,
      depth < MAX_DEPTH ? { label: "Add sub-task", fn: () => { addingUnder = t.id; collapsed.delete(t.id); render(); } } : null,
      { label: "Move up", fn: () => moveSibling(t, -1) }, { label: "Move down", fn: () => moveSibling(t, 1) },
      { label: "Copy", fn: () => copyTask(t) },
      canPaste(t) ? { label: "Paste inside", fn: () => pasteTask(t) } : null,
      { label: "Edit", fn: () => openSheet(t) },
      { label: "Delete", danger: true, fn: () => deleteTree(t) }], `Actions for "${t.title}"`),
    sub || dl ? el("div", { class: "pt-sub" }, depth === 1 && hasKids ? miniRing(p.done, p.total) : null, sub ? el("span", { class: "pt-meta" }, sub) : null, dl ? el("span", { class: "dd " + dl.cls }, dl.text) : null) : null);
  return row;
}
function addBox(parent, depth) {
  const input = el("input", { type: "text", maxlength: "200", placeholder: "Add a sub-task", enterkeyhint: "done", "aria-label": "New sub-task" });
  const go = async () => { await addKid(parent, input.value, null); addingUnder = parent.id; render(); const n = document.querySelector(`[data-addbox="${parent.id}"] input`); if (n) n.focus(); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  return el("div", { class: "pnode add", "data-addbox": String(parent.id), style: `--depth: ${depth}` }, input, el("button", { type: "button", onclick: go }, "Add"));
}
function treeRows(t, depth, out) {
  for (const k of kids(t)) { out.push(nodeRow(k, depth)); if (addingUnder === k.id) out.push(addBox(k, depth + 1)); if (!collapsed.has(k.id)) treeRows(k, depth + 1, out); }
  return out;
}
function nestedCard(r) {
  const hasKids = kids(r).length, p = progressOf(r), open = !collapsed.has(r.id), pct = p.total && hasKids ? Math.round(p.done / p.total * 100) : (r.done_at ? 100 : 0);
  const stats = hasKids ? `${p.done}/${p.total} done` : "no sub-tasks yet";
  const dl = !r.done_at && dleft(r);
  const span = r.period_start ? whenLabel(r) + (isMulti(r) ? ` · ${spanDays(r)} days` : "") : "";
  const head = el("div", { class: "lane-head" },
    el("div", { class: "lh-top" },
      el("button", { class: "pc-fold", type: "button", "aria-expanded": String(open), "aria-label": open ? "Collapse" : "Expand", onclick: () => { open ? collapsed.add(r.id) : collapsed.delete(r.id); saveCollapsed(); render(); } }, open ? "▾" : "▸"),
      el("button", { class: "pc-title", type: "button", onclick: () => openSheet(r) }, r.title),
      UI.kebab(() => [
        { label: "Add sub-task", fn: () => { addingUnder = r.id; collapsed.delete(r.id); render(); } },
        { label: "Copy", fn: () => copyTask(r) },
        canPaste(r) ? { label: "Paste inside", fn: () => pasteTask(r) } : null,
        { label: "Edit", fn: () => openSheet(r) },
        { label: "Delete", danger: true, fn: () => deleteTree(r) }], `Actions for "${r.title}"`)),
    dl ? el("div", { class: "lh-chip" }, el("span", { class: "dd big " + dl.cls, title: "Ends " + endDate(r) }, dl.text)) : null,
    el("div", { class: "pbar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, el("i", { style: `width:${pct}%` })),
    span ? el("div", { class: "pc-span" }, span) : null,
    el("div", { class: "pc-stats" }, stats));
  const card = el("section", { class: "pcard lane" + colorClass(r) + (r.done_at ? " done" : ""), ...colorStyle(r) }, head);
  if (open) {
    const cols = el("div", { class: "lane-cols" });
    for (const k of kids(r)) {
      const col = el("div", { class: "lane-col" + colorClass(k) + (k.done_at ? " done" : ""), ...colorStyle(k) }, nodeRow(k, 1));
      if (addingUnder === k.id) col.append(addBox(k, 2));
      if (!collapsed.has(k.id)) treeRows(k, 2, []).forEach((n) => col.append(n));
      cols.append(col);
    }
    if (addingUnder === r.id) cols.append(el("div", { class: "lane-col" }, addBox(r, 1)));
    if (!kids(r).length && addingUnder !== r.id) cols.append(el("div", { class: "empty" }, "No sub-tasks yet — use ⋯ → Add sub-task."));
    card.append(cols);
  }
  return card;
}
function renderNested(c) {
  const roots = tasks.filter((t) => !t.parent_id && kids(t).length);
  const byEnd = (x, y) => (endDate(x) || "9") < (endDate(y) || "9") ? -1 : (endDate(x) || "9") > (endDate(y) || "9") ? 1 : x.id - y.id;
  const openOnes = roots.filter((t) => !t.done_at).sort(byEnd), doneOnes = roots.filter((t) => t.done_at);
  if (!roots.length) c.append(el("div", { class: "empty" }, "No tasks have sub-tasks yet. Add a task above and break it into steps, or open any task and add sub-tasks."));
  openOnes.forEach((r) => c.append(nestedCard(r)));
  if (doneOnes.length) c.append(group("Completed", doneOnes.map((r) => nestedCard(r)), {}));
}

// ---------- mutations ----------
// tap cycles: not started → in progress → done → not started
async function toggle(t) { await setStatus(t, NEXT_STATUS[statusOf(t)]); }
async function setStatus(t, st) {
  const prev = { done_at: t.done_at, in_progress: t.in_progress };
  t.done_at = st === "done" ? new Date().toISOString() : null; t.in_progress = st === "doing"; render();
  const { error } = await sb.from("tasks").update({ done_at: t.done_at, in_progress: t.in_progress }).eq("id", t.id);
  if (error) { Object.assign(t, prev); render(); toast("Couldn't save — check your connection"); return; }
  await syncUp(t);
  if (st === "done" && t.recur) await spawnNext(t);
}
// a parent is done exactly when all its sub-tasks are
async function syncUp(t) {
  if (!t.parent_id) return;
  const changed = await TasksCore.syncParents(sb, t);
  for (const ch of changed) { const p = idx.get(ch.id); if (p) p.done_at = ch.done_at; }
  if (changed.length) { render(); toast(changed[0].done_at ? "Step complete — parent task done too" : "Parent task reopened"); }
}
// put a task (usually a backlog sub-task) on a specific day
async function schedule(t, iso) {
  const prev = { period_start: t.period_start };
  t.period_start = iso; render();
  const { error } = await sb.from("tasks").update({ period_start: iso }).eq("id", t.id);
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
  const inWeek = weekStart(anchor) <= TODAY && TODAY <= addDays(weekStart(anchor), 6), inMonth = anchor.slice(0, 7) === TODAY.slice(0, 7);
  const start = view === "day" ? anchor : view === "week" ? (inWeek ? TODAY : weekStart(anchor)) : view === "month" ? (inMonth ? TODAY : firstOf(anchor)) : TODAY;
  const { data, error } = await sb.from("tasks").insert({ title, horizon: "day", period_start: start }).select().single();
  input.disabled = false;
  if (error) { toast("Couldn't add it"); return; }
  tasks.push(data); input.value = ""; render();
  if (view === "nested") openSheet(data); else input.focus();      // in this view the next step is adding its sub-tasks
});

// ---------- edit sheet ----------
let editing = null, sheetColor = "", pickerSet = null;
const END_CHIPS = [["", "Same day"], [3, "+3 days"], [7, "+1 week"], [14, "+2 weeks"], [30, "+1 month"]];
function syncDateUi() {
  const d = $("f-date").value, e = $("f-end-date").value;
  $("f-end-date").min = d || "";
  const multi = !!d && !!e && e > d && !$("f-date").disabled;
  $("f-time-row").hidden = multi;                        // clock times only make sense inside a single day
  const info = $("f-endinfo");
  if (multi) {
    const g = dayGap(e), n = Math.round((parse(e) - parse(d)) / 86400000) + 1;
    info.textContent = `${n} days · ends ${fmt(e, { weekday: "short", month: "short", day: "numeric" })} · ${g > 0 ? "D-" + g : g === 0 ? "D-Day" : "D+" + -g}`; info.hidden = false;
  } else info.hidden = true;
}
function setColor(c) {
  sheetColor = c;
  if (pickerSet) pickerSet(hexOf(c));
}
function openSheet(t) {
  editing = t;
  $("f-title").value = t.title; $("f-notes").value = t.notes || "";
  $("f-date").value = t.period_start || ""; $("f-end-date").value = t.end_on && t.period_start && t.end_on > t.period_start ? t.end_on : "";
  $("f-start").value = t.start_time ? t.start_time.slice(0, 5) : ""; $("f-end").value = t.end_time ? t.end_time.slice(0, 5) : "";
  setColor(t.color || ""); $("f-recur").value = t.recur || ""; $("f-status").value = statusOf(t); $("f-status").disabled = !!kids(t).length;
  $("f-unsched-row").hidden = !t.parent_id; $("f-unsched").checked = !!t.parent_id && !t.period_start; $("f-date").disabled = $("f-unsched").checked;
  renderKidsList(t); syncDateUi(); syncPasteUi(); $("sheet").hidden = false;
}
{
  pickerSet = UI.colorPicker($("f-colors"), (hx) => { sheetColor = hx; });
  END_CHIPS.forEach(([n, label]) => $("dur-chips").append(el("button", { type: "button", "data-n": String(n) }, label)));
  $("dur-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-n]"); if (!b) return;
    const d = $("f-date").value; if (!d) { toast("Pick a start date first"); return; }
    $("f-end-date").value = b.dataset.n ? addDays(d, Number(b.dataset.n)) : ""; syncDateUi();
  });
}
const closeSheet = () => { $("sheet").hidden = true; editing = null; };
$("f-date").addEventListener("input", syncDateUi);
$("f-end-date").addEventListener("input", syncDateUi);
$("f-unsched").addEventListener("change", () => { $("f-date").disabled = $("f-unsched").checked; syncDateUi(); });

// sub-tasks list inside the sheet
function renderKidsList(t) {
  const wrap = $("f-kids-wrap"), box = $("f-kids");
  wrap.hidden = depthOf(t) >= MAX_DEPTH; box.innerHTML = "";
  kids(t).forEach((k) => box.append(el("div", { class: "kid" + (k.done_at ? " done" : "") },
    el("button", { type: "button", class: "kid-tick" + stCls(k), "aria-label": stLabel(k), title: stLabel(k), onclick: async () => { await toggle(k); renderKidsList(t); } }, "✓"),
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
  const unsched = !!t.parent_id && $("f-unsched").checked, endOn = $("f-end-date").value, multi = !unsched && endOn && endOn > $("f-date").value;
  const start = multi ? null : $("f-start").value || null, end = multi ? null : $("f-end").value || null;
  if (end && !start) { toast("Add a start time too"); return; }
  if (start && end && end <= start) { toast("End must be after start"); return; }
  if (!unsched && !$("f-date").value) { toast("Pick a start date"); return; }
  if (endOn && !unsched && endOn < $("f-date").value) { toast("The end date is before the start date"); return; }
  const patch = { title: $("f-title").value.trim(), notes: $("f-notes").value.trim() || null, horizon: "day",
    period_start: unsched ? null : $("f-date").value, start_time: start, end_time: end,
    recur: $("f-recur").value || null, end_on: multi ? endOn : null, color: sheetColor || null };
  if (!patch.title) return;
  const want = kids(t).length ? statusOf(t) : $("f-status").value, wantDone = want === "done", becameDone = wantDone && !t.done_at;
  if (!kids(t).length) { patch.in_progress = want === "doing"; if (wantDone !== !!t.done_at) patch.done_at = wantDone ? new Date().toISOString() : null; }
  const { data, error } = await sb.from("tasks").update(patch).eq("id", t.id).select().single();
  if (error) { toast("Couldn't save"); return; }
  Object.assign(t, data); closeSheet(); render();
  await syncUp(t);
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

// ---------- copy / paste (a task with all its sub-tasks) ----------
let clip = null;
try { clip = JSON.parse(localStorage.getItem("tasks.clip") || "null"); } catch (_) {}
const clipDepth = (n) => 1 + Math.max(0, ...(n.kids || []).map(clipDepth));
const snap = (t) => ({ title: t.title, notes: t.notes, color: t.color, recur: t.recur, start: t.period_start, end_on: t.end_on,
  start_time: t.start_time, end_time: t.end_time, kids: kids(t).map(snap) });
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5);
const canPaste = (parent) => !!clip && (parent ? depthOf(parent) : 0) + clipDepth(clip) <= MAX_DEPTH;
function copyTask(t) {
  clip = snap(t);
  try { localStorage.setItem("tasks.clip", JSON.stringify(clip)); } catch (_) {}
  render(); toast(`Copied "${t.title}"${clip.kids.length ? " with its sub-tasks" : ""}`);
}
async function pasteTask(parent) {
  if (!clip) return;
  if (!canPaste(parent)) return toast("That would nest too deep");
  const inWeek = weekStart(anchor) <= TODAY && TODAY <= addDays(weekStart(anchor), 6), inMonth = anchor.slice(0, 7) === TODAY.slice(0, 7);
  const base = parent ? TODAY : view === "day" ? anchor : view === "week" ? (inWeek ? TODAY : weekStart(anchor)) : view === "month" ? (inMonth ? TODAY : firstOf(anchor)) : TODAY;
  const delta = clip.start ? daysBetween(clip.start, base) : 0;
  const shift = (d) => (d ? addDays(d, delta) : null);
  let made = 0, failed = false;
  const put = async (n, parentId, top) => {
    const start = n.start ? shift(n.start) : (top && !parentId ? base : null);
    const row = { title: top && !parentId ? n.title + " (copy)" : n.title, notes: n.notes, color: n.color, recur: n.recur, horizon: "day",
      period_start: start, end_on: n.start && n.end_on ? shift(n.end_on) : null, start_time: n.start_time, end_time: n.end_time, parent_id: parentId };
    const { data, error } = await sb.from("tasks").insert(row).select().single();
    if (error) { failed = true; return; }
    tasks.push(data); made++;
    for (const k of n.kids) { if (failed) break; await put(k, data.id, false); }
  };
  await put(clip, parent ? parent.id : null, true);
  render();
  if (parent) await syncUp({ id: -1, parent_id: parent.id });
  toast(failed ? "Couldn't paste everything" : `Pasted ${made} task${made === 1 ? "" : "s"}`);
}
$("f-more-host").append(UI.kebab(() => [
  { label: "Copy", fn: () => editing && copyTask(editing) },
  editing && canPaste(editing) ? { label: "Paste inside", fn: async () => { const t = editing; if (t) { await pasteTask(t); renderKidsList(t); } } } : null,
  { label: "Delete", danger: true, fn: () => { const t = editing; if (t) { closeSheet(); deleteTree(t); } } }], "More actions"));
$("add-paste").addEventListener("click", () => pasteTask(null));

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
