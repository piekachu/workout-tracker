const sb = Auth.client;
const { localISO, parse, addDays, firstOf, addMonths, mondayOf } = TasksCore;
const TODAY = localISO(new Date());
const VOCAB_SLOT_ID = "56ba90d2a3a5add3cb";

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else e.setAttribute(k, v); }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}
const fmt = (iso, o) => parse(iso).toLocaleDateString(undefined, o);
const num = (v) => Number(v) || 0;
const pct = (v) => Math.round(v) + "%";

// ---------- money: same currency choice as /expenses/ ----------
const CUR = { KRW: { sym: "₩", digits: 0 }, USD: { sym: "$", digits: 2 }, EUR: { sym: "€", digits: 2 }, JPY: { sym: "¥", digits: 0 } };
let cur = CUR.KRW;
try { cur = CUR[localStorage.getItem("expenses.currency")] || CUR.KRW; } catch {}
const money = (v) => cur.sym + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: cur.digits });

// ---------- state ----------
let view = "week", anchor = TODAY, D = null;     // D = everything, indexed by day, once loaded
try { const v = localStorage.getItem("progress:view"); if (["day", "week", "month"].includes(v)) view = v; } catch {}

// A table that fails to load (e.g. a missing grant) shouldn't blank the whole page.
const rows = async (p) => { const { data, error } = await p; return error ? [] : data || []; };

async function loadAll() {
  const [tasks, habits, habitLog, drugLog, sessions, sets, exps, weights, kv] = await Promise.all([
    rows(sb.from("tasks").select("id,title,horizon,period_start,done_at").limit(5000)),
    rows(sb.from("habits").select("id,name,archived").order("sort_order").order("id")),
    rows(sb.from("habit_log").select("habit_id,done_on").limit(20000)),
    rows(sb.from("drug_log").select("studied_on,quiz_correct,quiz_total")),
    rows(sb.from("workout_sessions").select("id,log_date,category")),
    rows(sb.from("workout_sets").select("session_id,reps,weight_kg").limit(20000)),
    rows(sb.from("expenses").select("spent_on,amount,kind,category").limit(20000)),
    rows(sb.from("body_weight").select("log_date,weight_kg").order("log_date")),
    sb.from("kv_store").select("data").eq("slot_id", VOCAB_SLOT_ID).maybeSingle().then(({ data }) => (data && data.data) || {}),
  ]);

  const d = { habitsActive: habits.filter((h) => !h.archived), vocab: {}, drug: {}, sessions: {}, tasksDone: {}, tasksPlanned: {},
    tasksDoneList: {}, tasksOpenList: {}, habitDone: {}, spent: {}, expenses: exps.filter((e) => e.kind === "expense"), weights };

  for (const lang of Object.values(kv.langs || {})) for (const [day, n] of Object.entries(lang.activity || {})) d.vocab[day] = (d.vocab[day] || 0) + num(n);
  for (const r of drugLog) d.drug[r.studied_on] = { correct: num(r.quiz_correct), total: num(r.quiz_total) };

  const volBySession = {}, setsBySession = {};
  for (const s of sets) {
    volBySession[s.session_id] = (volBySession[s.session_id] || 0) + num(s.reps) * num(s.weight_kg);
    setsBySession[s.session_id] = (setsBySession[s.session_id] || 0) + 1;
  }
  for (const s of sessions) (d.sessions[s.log_date] = d.sessions[s.log_date] || []).push({
    id: s.id, category: s.category, volume: Math.round(volBySession[s.id] || 0), sets: setsBySession[s.id] || 0 });

  for (const t of tasks) {
    (d.tasksPlanned[t.period_start] = d.tasksPlanned[t.period_start] || []).push(t);
    if (t.done_at) {
      const day = localISO(new Date(t.done_at));
      d.tasksDone[day] = (d.tasksDone[day] || 0) + 1;
      (d.tasksDoneList[day] = d.tasksDoneList[day] || []).push(t);
    }
  }
  for (const r of habitLog) (d.habitDone[r.done_on] = d.habitDone[r.done_on] || new Set()).add(r.habit_id);
  for (const e of d.expenses) d.spent[e.spent_on] = (d.spent[e.spent_on] || 0) + num(e.amount);
  return d;
}

// ---------- periods ----------
function daysBetween(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
function rangeFor(v, a) {
  if (v === "day") return { days: [a], prev: [addDays(a, -1)], prevLabel: "yesterday" };
  if (v === "week") { const m = mondayOf(a); return { days: daysBetween(m, addDays(m, 6)), prev: daysBetween(addDays(m, -7), addDays(m, -1)), prevLabel: "last week" }; }
  const f = firstOf(a), nf = addMonths(f, 1), pf = addMonths(f, -1);
  return { days: daysBetween(f, addDays(nf, -1)), prev: daysBetween(pf, addDays(f, -1)), prevLabel: "last month" };
}
function periodLabel() {
  if (view === "day") return fmt(anchor, { weekday: "short", month: "short", day: "numeric" }) + (anchor === TODAY ? " · Today" : "");
  if (view === "week") {
    const m = mondayOf(anchor), s = addDays(m, 6);
    return `${fmt(m, { month: "short", day: "numeric" })} – ${fmt(s, m.slice(0, 7) === s.slice(0, 7) ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  }
  return fmt(anchor, { month: "long", year: "numeric" });
}

// ---------- per-day facts ----------
const vocabOn = (d) => num(D.vocab[d]);
const drugOn = (d) => D.drug[d] || null;
const sessionsOn = (d) => D.sessions[d] || [];
const customDone = (d) => D.habitsActive.filter((h) => D.habitDone[d] && D.habitDone[d].has(h.id));
// "Daily habits" = vocab, drug of the day, and your own habits. Workout is tracked on its own (rest days are normal).
function dayHabitPct(d) {
  const total = 2 + D.habitsActive.length;
  return ((vocabOn(d) > 0 ? 1 : 0) + (drugOn(d) ? 1 : 0) + customDone(d).length) / total * 100;
}
const quizPct = (d) => { const q = drugOn(d); return q && q.total ? (q.correct / q.total) * 100 : null; };

function metrics(days) {
  const past = days.filter((d) => d <= TODAY);
  const m = { habit: past.length ? past.reduce((s, d) => s + dayHabitPct(d), 0) / past.length : 0,
    tasksDone: 0, tasksPlanned: 0, sessions: 0, volume: 0, vocab: 0, vocabDays: 0, drugDays: 0, quiz: 0, quizN: 0, spent: 0 };
  for (const d of days) {
    m.tasksDone += num(D.tasksDone[d]); m.tasksPlanned += (D.tasksPlanned[d] || []).length;
    for (const s of sessionsOn(d)) { m.sessions++; m.volume += s.volume; }
    m.vocab += vocabOn(d); if (vocabOn(d) > 0) m.vocabDays++;
    if (drugOn(d)) m.drugDays++; const q = quizPct(d); if (q != null) { m.quiz += q; m.quizN++; }
    m.spent += num(D.spent[d]);
  }
  m.quiz = m.quizN ? m.quiz / m.quizN : 0;
  return m;
}

// ---------- rendering ----------
function delta(now, before, label, unit = "") {
  if (!now && !before) return "";
  if (!before) return `new vs ${label}`;
  const diff = now - before;
  if (!diff) return `same as ${label}`;
  const p = unit === "pp" ? `${Math.round(Math.abs(diff))} pt${Math.round(Math.abs(diff)) === 1 ? "" : "s"}` : `${Math.round(Math.abs(diff) / before * 100)}%`;
  return `${diff > 0 ? "▲" : "▼"} ${p} vs ${label}`;
}
function tile(k, v, s, d) { return el("div", { class: "tile" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "s" }, s), d ? el("div", { class: "d" }, d) : null); }

function renderTiles(m, p, r) {
  const t = $("tiles"); t.innerHTML = "";
  t.append(
    tile("Daily habits", pct(m.habit), "average completion", delta(m.habit, p.habit, r.prevLabel, "pp")),
    tile("Tasks done", String(m.tasksDone), `of ${m.tasksPlanned} planned`, delta(m.tasksDone, p.tasksDone, r.prevLabel)),
    tile("Workouts", String(m.sessions), `${m.volume.toLocaleString()} kg lifted`, delta(m.sessions, p.sessions, r.prevLabel)),
    tile("Vocab reviews", m.vocab.toLocaleString(), `${m.vocabDays} active day${m.vocabDays === 1 ? "" : "s"}`, delta(m.vocab, p.vocab, r.prevLabel)),
    tile("Drugs studied", String(m.drugDays), m.quizN ? `${pct(m.quiz)} average quiz` : "no quizzes yet", delta(m.drugDays, p.drugDays, r.prevLabel)),
    tile("Spent", money(m.spent), "expenses only", delta(m.spent, p.spent, r.prevLabel)));
}

function renderDetail(d) {
  const box = $("detail"); box.innerHTML = "";
  if (view !== "day") return;
  const row = (on, what, info) => el("div", { class: "drow" + (on ? " on" : "") }, el("span", { class: "mark" }, on ? "✓" : "○"), el("span", { class: "what" }, what), el("span", { class: "info" }, info || ""));
  const card = el("div", { class: "detail" });
  const q = drugOn(d), ss = sessionsOn(d);
  card.append(row(vocabOn(d) > 0, "Vocab", vocabOn(d) ? `${vocabOn(d)} reviewed` : "none"));
  card.append(row(!!q, "Drug of the day", q ? `quiz ${q.correct}/${q.total}` : "not studied"));
  card.append(row(ss.length > 0, "Workout", ss.length ? ss.map((s) => `${s.category || "Session"} · ${s.volume.toLocaleString()} kg`).join("; ") : "rest day"));
  D.habitsActive.forEach((h) => card.append(row(!!(D.habitDone[d] && D.habitDone[d].has(h.id)), h.name)));
  (D.tasksDoneList[d] || []).forEach((t) => card.append(row(true, t.title, "task")));
  (D.tasksPlanned[d] || []).filter((t) => !t.done_at && t.horizon === "day").forEach((t) => card.append(row(false, t.title, "task")));
  if (D.spent[d]) card.append(row(true, "Spent", money(D.spent[d])));
  box.append(card);
}

function card(title, sub) {
  const host = el("div", { class: "chart" });
  const c = el("section", { class: "card" }, el("h3", {}, title), el("p", { class: "sub" }, sub), host);
  $("charts").append(c); return { c, host };
}

function renderCharts(r) {
  const out = $("charts"); out.innerHTML = "";
  // Day view charts show the week leading up to that day, so a single day still has context.
  const days = view === "day" ? daysBetween(addDays(anchor, -6), anchor) : r.days;
  const n = days.length, hl = view === "day" ? n - 1 : null;
  const long = (d) => fmt(d, { weekday: "short", month: "short", day: "numeric" });
  const xTick = (i) => (n <= 7 ? fmt(days[i], { weekday: "short" }) : (i % 5 === 0 || i === n - 1) && (n - 1 - i > 1 || i === n - 1) ? String(parse(days[i]).getDate()) : "");
  const scope = view === "day" ? "last 7 days" : view === "week" ? "this week" : "this month";
  const past = days.filter((d) => d <= TODAY);

  out.append(el("div", { class: "group-h" }, view === "day" ? "The week leading up to this day" : "Trends"));

  // 1. consistency matrix
  {
    const { host, c } = card("Consistency", `Which habits you hit each day · ${scope}`);
    const rowsDef = [
      { label: "Vocab", on: (d) => vocabOn(d) > 0, tip: (d) => (vocabOn(d) ? `${vocabOn(d)} reviewed · ${long(d)}` : `Not done · ${long(d)}`) },
      { label: "Drug", on: (d) => !!drugOn(d), tip: (d) => (drugOn(d) ? `Quiz ${drugOn(d).correct}/${drugOn(d).total} · ${long(d)}` : `Not done · ${long(d)}`) },
      { label: "Workout", on: (d) => sessionsOn(d).length > 0, tip: (d) => (sessionsOn(d).length ? `${sessionsOn(d)[0].category || "Session"} · ${long(d)}` : `Rest · ${long(d)}`) },
      { label: "Tasks", on: (d) => num(D.tasksDone[d]) > 0, tip: (d) => `${num(D.tasksDone[d])} completed · ${long(d)}` },
      ...D.habitsActive.map((h) => ({ label: h.name, on: (d) => !!(D.habitDone[d] && D.habitDone[d].has(h.id)), tip: (d) => `${D.habitDone[d] && D.habitDone[d].has(h.id) ? "Done" : "Not done"} · ${long(d)}` })),
    ];
    Charts.matrix(host, { days, rows: rowsDef, today: TODAY, dayLabel: (d, i) => (n <= 7 ? fmt(d, { weekday: "narrow" }) : xTick(i)) });
    c.append(Charts.table(["Habit", "Days done"], rowsDef.map((rw) => [rw.label, `${past.filter(rw.on).length} of ${past.length}`])));
  }

  // 2. daily habit completion %
  {
    const vals = days.map((d) => (d <= TODAY ? Math.round(dayHabitPct(d)) : 0));
    const { host, c } = card("Daily habits", "Share of your daily habits done each day");
    Charts.bar(host, { values: vals, xTick, max: 100, highlight: hl, fmtTick: (v) => v + "%", fmtLabel: (v) => v + "%",
      tipTitle: (i) => long(days[i]), tipValue: (i) => `${vals[i]}% done` });
    c.append(Charts.table(["Day", "Done"], days.map((d, i) => [long(d), vals[i] + "%"])));
  }

  // 3. tasks completed per day
  {
    const vals = days.map((d) => num(D.tasksDone[d]));
    const total = vals.reduce((a, b) => a + b, 0);
    const { host, c } = card("Tasks completed", `${total} finished · ${scope}`);
    Charts.bar(host, { values: vals, xTick, highlight: hl, tipTitle: (i) => long(days[i]), tipValue: (i) => `${vals[i]} completed` });
    c.append(Charts.table(["Day", "Completed"], days.map((d, i) => [long(d), vals[i]])));
  }

  // 4. workout volume per session
  {
    const ss = days.flatMap((d) => sessionsOn(d).map((s) => ({ ...s, day: d })));
    const total = ss.reduce((a, s) => a + s.volume, 0);
    const { host, c } = card("Workout volume", ss.length ? `${total.toLocaleString()} kg across ${ss.length} session${ss.length === 1 ? "" : "s"} · reps × weight` : `Reps × weight per session · ${scope}`);
    Charts.bar(host, { values: ss.map((s) => s.volume), emptyText: "No workouts in this period",
      xTick: (i) => (ss.length <= 8 || i % Math.ceil(ss.length / 6) === 0 ? fmt(ss[i].day, { month: "numeric", day: "numeric" }) : ""),
      fmtTick: (v) => Charts.compact(v), tipTitle: (i) => `${long(ss[i].day)} · ${ss[i].category || "Session"}`,
      tipValue: (i) => `${ss[i].volume.toLocaleString()} kg · ${ss[i].sets} sets` });
    if (ss.length) c.append(Charts.table(["Day", "Category", "Volume (kg)", "Sets"], ss.map((s) => [long(s.day), s.category || "", s.volume.toLocaleString(), s.sets])));
  }

  // 5. vocab reviews per day
  {
    const vals = days.map((d) => vocabOn(d));
    const total = vals.reduce((a, b) => a + b, 0);
    const { host, c } = card("Vocab reviews", `${total.toLocaleString()} cards reviewed · ${scope}`);
    Charts.bar(host, { values: vals, xTick, highlight: hl, tipTitle: (i) => long(days[i]), tipValue: (i) => `${vals[i]} reviewed` });
    c.append(Charts.table(["Day", "Reviews"], days.map((d, i) => [long(d), vals[i]])));
  }

  // 6. drug quiz score
  {
    const vals = days.map((d) => { const q = quizPct(d); return q == null ? null : Math.round(q); });
    const got = vals.filter((v) => v != null);
    const { host, c } = card("Drug quiz score", got.length ? `${pct(got.reduce((a, b) => a + b, 0) / got.length)} average over ${got.length} quiz${got.length === 1 ? "" : "zes"}` : `Quiz result on the days you studied · ${scope}`);
    Charts.line(host, { values: vals, xTick, zero: true, min: 0, max: 100, fmtTick: (v) => v + "%", emptyText: "No quizzes in this period",
      tipTitle: (i) => long(days[i]), tipValue: (i) => `${vals[i]}% (${drugOn(days[i]).correct}/${drugOn(days[i]).total})` });
    if (got.length) c.append(Charts.table(["Day", "Score"], days.map((d, i) => [long(d), vals[i] == null ? "—" : vals[i] + "%"])));
  }

  // 7. spending
  {
    const vals = days.map((d) => num(D.spent[d]));
    const total = vals.reduce((a, b) => a + b, 0);
    const { host, c } = card("Spending", total ? `${money(total)} spent · ${scope}` : `Expenses per day · ${scope}`);
    Charts.bar(host, { values: vals, xTick, highlight: hl, fmtLabel: (v) => Charts.compact(v), tipTitle: (i) => long(days[i]), tipValue: (i) => money(vals[i]) });
    const byCat = {};
    const inRange = new Set(days);
    for (const e of D.expenses) if (inRange.has(e.spent_on)) byCat[e.category || "Other"] = (byCat[e.category || "Other"] || 0) + num(e.amount);
    const cats = Object.entries(byCat).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    if (cats.length) {
      c.append(el("p", { class: "sub", style: "margin-top:14px" }, "By category"));
      const h = el("div", {}); c.append(h); Charts.hbar(h, cats, money);
      c.append(Charts.table(["Category", "Spent"], cats.map((x) => [x.label, money(x.value)])));
    }
  }

  // 8. body weight (trailing 90 days, independent of the period)
  {
    const end = days[n - 1], span = daysBetween(addDays(end, -89), end);
    const byDay = {}; D.weights.forEach((w) => { byDay[w.log_date] = num(w.weight_kg); });
    const vals = span.map((d) => (byDay[d] != null ? byDay[d] : null));
    const got = vals.filter((v) => v != null);
    const { host, c } = card("Body weight", got.length > 1 ? `${got[got.length - 1]} kg latest · ${(got[got.length - 1] - got[0] >= 0 ? "+" : "")}${(got[got.length - 1] - got[0]).toFixed(1)} kg over the last 90 days` : "Last 90 days");
    Charts.line(host, { values: vals, xTick: (i) => (i % 15 === 0 ? fmt(span[i], { month: "numeric", day: "numeric" }) : ""), emptyText: "No weigh-ins in the last 90 days",
      fmtTick: (v) => String(Math.round(v * 10) / 10), tipTitle: (i) => long(span[i]), tipValue: (i) => `${vals[i]} kg` });
    if (got.length) c.append(Charts.table(["Day", "Weight (kg)"], span.map((d, i) => [long(d), vals[i]]).filter((r) => r[1] != null)));
  }
}

function render() {
  Charts.hideTip();
  document.querySelectorAll("#view-seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  $("period-label").textContent = periodLabel();
  if (!D) return;
  const r = rangeFor(view, anchor);
  renderDetail(anchor);
  renderTiles(metrics(r.days), metrics(r.prev), r);
  renderCharts(r);
}

// ---------- navigation ----------
function step(dir) {
  anchor = view === "day" ? addDays(anchor, dir) : view === "week" ? addDays(anchor, 7 * dir) : addMonths(firstOf(anchor), dir);
  render();
}
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("period-label").addEventListener("click", () => { anchor = TODAY; render(); });
document.querySelectorAll("#view-seg button").forEach((b) => b.addEventListener("click", () => {
  view = b.dataset.view; try { localStorage.setItem("progress:view", view); } catch {}
  render();
}));

render();
loadAll().then((d) => { D = d; $("loading").remove(); render(); }).catch(() => { $("loading").textContent = "Couldn't load your history — check your connection."; });
