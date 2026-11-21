const sb = Auth.client;
const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
// Local-date (not UTC) YYYY-MM-DD: toISOString()/new Date("YYYY-MM-DD") are UTC-based and drift a day.
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => localISO();
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const parseISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const GROUPS = ["Back + Biceps", "Chest + Triceps", "Shoulder + Arms", "Legs", "Whole body"];
const DROP_TAG = "[drop]";                      // notes prefix marking a drop set (no schema column needed)
// Sanity limits: anything outside these is treated as a typo (stepper clamps it, charts ignore it).
const MAX_REPS = 50, MAX_KG = 300;
const sane = (s) => s.reps != null && s.reps > 0 && s.reps <= MAX_REPS && s.weight_kg != null && s.weight_kg >= 0 && s.weight_kg <= MAX_KG;
const isDrop = (s) => (s.notes || "").startsWith(DROP_TAG);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtKg = (v) => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());
const prettyDate = (iso) => parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// "Back + Biceps + Legs" -> ["Back + Biceps", "Legs"]  (whole-label match per group; partial labels still map sensibly)
function splitGroups(label) {
  const parts = (label || "").split("+").map((s) => s.trim()).filter(Boolean);
  const out = new Set();
  for (const g of GROUPS) {
    const gp = g.split("+").map((s) => s.trim());
    if (gp.every((p) => parts.includes(p))) out.add(g);
  }
  if (!out.size) parts.forEach((p) => { const g = GROUPS.find((x) => x.split("+").map((s) => s.trim()).includes(p)); if (g) out.add(g); });
  return [...out];
}

// ============================================================ stepper -----
// −/+ buttons (hold to repeat and speed up). Tap the number to type an exact value.
function attachStepper(stepperEl, { step = 1, min = 0, max = 999, decimals = 0, onChange } = {}) {
  const minusBtn = stepperEl.querySelector(".minus"), plusBtn = stepperEl.querySelector(".plus");
  const inp = stepperEl.querySelector(".num-display");
  const factor = 10 ** decimals, round = (n) => Math.round(n * factor) / factor;
  const getVal = () => { const v = parseFloat(inp.value); return Number.isFinite(v) ? v : 0; };
  const setVal = (v) => { inp.value = String(round(Math.min(max, Math.max(min, v)))); if (onChange) onChange(); };
  function wire(btn, dir) {
    let timeout, interval, count = 0;
    const tick = () => { setVal(getVal() + dir * step * (count > 20 ? 4 : count > 8 ? 2 : 1)); count++; };
    const start = (e) => { e.preventDefault(); count = 0; tick(); timeout = setTimeout(() => { interval = setInterval(tick, 90); }, 350); };
    const stop = () => { clearTimeout(timeout); clearInterval(interval); };
    btn.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setVal(getVal() + dir * step); } });
  }
  wire(minusBtn, -1); wire(plusBtn, 1);
  inp.addEventListener("click", () => { if (inp.readOnly) { inp.readOnly = false; inp.focus(); inp.select(); } });
  inp.addEventListener("blur", () => { inp.readOnly = true; if (inp.value !== "") setVal(getVal()); });
  inp.addEventListener("input", () => { if (onChange) onChange(); });
}

// ============================================================ data --------
let HIST = [];                       // sessions, newest first: {id, log_date, category, workout_sets:[...]}
let catalogByCategory = {};
async function loadHistory() {
  const { data, error } = await sb.from("workout_sessions")
    .select("id, log_date, category, start_time, end_time, workout_sets(exercise, reps, weight_kg, set_number, notes)")
    .order("log_date", { ascending: false }).order("id", { ascending: false }).limit(2000);
  if (error) { HIST = []; return false; }
  HIST = (data || []).map((s) => ({ ...s, workout_sets: (s.workout_sets || []).sort((a, b) => a.set_number - b.set_number) }));
  return true;
}
async function loadCatalog() {
  const { data, error } = await sb.from("exercise_catalog").select("*").order("sort_order");
  if (error) return;
  catalogByCategory = {};
  GROUPS.forEach((g) => (catalogByCategory[g] = []));
  (data || []).forEach((r) => { (catalogByCategory[r.category] || (catalogByCategory[r.category] = [])).push(r); });
}
const catalogRow = (name) => { for (const rows of Object.values(catalogByCategory)) { const r = rows.find((x) => x.exercise === name); if (r) return r; } return null; };

// most recent earlier session that has this exercise
function lastTime(exercise, excludeDate) {
  for (const s of HIST) {
    if (s.log_date === excludeDate) continue;
    const sets = s.workout_sets.filter((x) => x.exercise === exercise);
    if (sets.length) return { log_date: s.log_date, sets };
  }
  return null;
}
const sessionVolume = (s) => s.workout_sets.filter(sane).reduce((a, x) => a + x.reps * x.weight_kg, 0);

// ============================================================ consistency
function renderConsistency() {
  const dates = new Set(HIST.map((s) => s.log_date));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = localISO(today), fourWeeks = localISO(addDays(today, -28));
  const recent = HIST.filter((s) => s.log_date >= fourWeeks && s.log_date <= todayStr);
  $("stat-recent").textContent = new Set(recent.map((s) => s.log_date)).size;
  $("stat-volume").textContent = Math.round(recent.reduce((a, s) => a + sessionVolume(s), 0)).toLocaleString();
  $("stat-total").textContent = dates.size;
  let streak = 0;
  for (let w = 0; w < 105; w++) {
    const end = localISO(addDays(today, -w * 7)), start = localISO(addDays(today, -w * 7 - 6));
    if (![...dates].some((d) => d >= start && d <= end)) { if (w === 0) continue; break; }   // an empty current week doesn't end the streak yet
    streak++;
  }
  $("stat-streak").textContent = streak;

  const WEEKS = 18, endOfGrid = addDays(today, 6 - today.getDay()), startOfGrid = addDays(endOfGrid, -(WEEKS * 7 - 1));
  const hm = $("heatmap"); hm.innerHTML = "";
  for (let i = 0; i < WEEKS * 7; i++) {
    const iso = localISO(addDays(startOfGrid, i));
    const cell = el("div", { class: "heat-cell" + (dates.has(iso) ? " filled" : "") + (iso === todayStr ? " today" : ""), title: iso });
    if (iso > todayStr) cell.style.visibility = "hidden";
    hm.append(cell);
  }
}

// ============================================================ muscle groups
// Pick any combination -- Back + Chest, Legs + Shoulder, … The session label is the picked groups joined
// ("Back + Biceps + Chest + Triceps"), which the older single-group history still matches.
const selectedGroups = new Set();
const groupPicker = $("group-picker");
GROUPS.forEach((g) => {
  const b = el("button", { type: "button", class: "group-chip", "aria-pressed": "false", "data-g": g, onclick: () => toggleGroup(g) }, g);
  groupPicker.append(b);
});
const sessionLabel = () => GROUPS.filter((g) => selectedGroups.has(g)).join(" + ");
function toggleGroup(g) {
  selectedGroups.has(g) ? selectedGroups.delete(g) : selectedGroups.add(g);
  groupPicker.querySelectorAll(".group-chip").forEach((b) => b.setAttribute("aria-pressed", String(selectedGroups.has(b.dataset.g))));
  const wasHidden = $("log-form").hidden;
  $("log-form").hidden = selectedGroups.size === 0 && !$("exercise-list").children.length;
  syncEmptyHint();
  if (!$("log-form").hidden) refreshDateState();
  loadRoutines();
  if (wasHidden && !$("log-form").hidden) setTimeout(() => $("log-form").scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}
const syncEmptyHint = () => { $("add-exercise").classList.toggle("primary", !$("exercise-list").children.length); };

// ---- routines (optional: needs the workout_routines table) ----
let routines = [];
async function loadRoutines() {
  const row = $("routine-row"), sel = $("routine-select"); routines = [];
  if (!selectedGroups.size) { row.hidden = true; return; }
  const { data, error } = await sb.from("workout_routines").select("id, name, exercises, category").in("category", [...selectedGroups]).order("sort_order");
  if (error || !data || !data.length) { row.hidden = true; return; }
  routines = data;
  sel.innerHTML = '<option value="">Pick one…</option>' + data.map((r) => `<option value="${r.id}">${escapeHtml(r.name)} (${(r.exercises || []).length})</option>`).join("");
  row.hidden = false;
}
$("load-routine-btn").addEventListener("click", () => {
  const r = routines.find((x) => String(x.id) === $("routine-select").value);
  if (!r || !(r.exercises || []).length) return;
  $("exercise-list").innerHTML = "";
  r.exercises.forEach((ex) => addExerciseCard({ exercise: ex.exercise, sets: ex.target_sets || 1, collapsed: true }));
  openCard($("exercise-list").firstElementChild);
});

// ============================================================ exercise sheet
const sheet = $("ex-sheet");
let sheetOnPick = null, sheetMode = "log", sheetScope = "today";
function openSheet({ mode, onPick, title }) {
  sheetMode = mode; sheetOnPick = onPick;
  sheetScope = mode === "log" && selectedGroups.size ? "today" : "all";
  $("sheet-title").textContent = title || "Choose exercise";
  $("sheet-scope").hidden = mode !== "log" || !selectedGroups.size;
  $("sheet-custom").hidden = mode !== "log";
  $("sheet-search").value = ""; $("sheet-custom-name").value = "";
  syncScope(); renderSheet();
  sheet.showModal();
  if (window.matchMedia("(hover: hover)").matches) $("sheet-search").focus();   // don't pop the keyboard up on phones
}
function closeSheet() { if (sheet.open) sheet.close(); }
function syncScope() { $("sheet-scope").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.s === sheetScope))); }
function pick(name) { const cb = sheetOnPick; closeSheet(); if (cb) cb(name); }
function renderSheet() {
  const q = $("sheet-search").value.trim().toLowerCase(), list = $("sheet-list"); list.textContent = "";
  const inToday = new Set(), seen = new Set(), logged = new Set(HIST.flatMap((s) => s.workout_sets.map((x) => x.exercise)));
  const inCard = new Set([...$("exercise-list").querySelectorAll(".ex-card")].map((c) => c.dataset.exercise).filter(Boolean));
  const row = (name, hint, done) => el("button", { type: "button", class: "sheet-row" + (done ? " done" : ""), onclick: () => pick(name) },
    el("span", { class: "sr-name" }, name), el("span", { class: "sr-hint" }, done ? "added" : hint || ""));
  const hintFor = (name) => { const lt = lastTime(name, ""); if (lt) { const top = lt.sets.filter((s) => !isDrop(s)).sort((a, b) => b.weight_kg - a.weight_kg)[0]; return top ? `${fmtKg(num(top.weight_kg))}kg × ${top.reps ?? "?"} · ${prettyDate(lt.log_date)}` : prettyDate(lt.log_date); } const c = catalogRow(name); return c && c.target_weight != null ? `goal ${c.target_sets || "?"}×${c.target_reps || "?"}×${c.target_weight}` : ""; };
  const section = (title, names, track = true) => {
    const fresh = names.filter((n) => !(track && seen.has(n)) && (!q || n.toLowerCase().includes(q)));
    if (!fresh.length) return;
    list.append(el("div", { class: "sheet-group" }, title));
    fresh.forEach((n) => { if (track) seen.add(n); list.append(row(n, hintFor(n), inCard.has(n))); });
  };
  const wantAll = sheetMode !== "log" || sheetScope === "all" || !!q || !selectedGroups.size;
  if (sheetMode === "history") {
    const byCount = new Map(); HIST.forEach((s) => s.workout_sets.forEach((x) => byCount.set(x.exercise, (byCount.get(x.exercise) || 0) + 1)));
    section("Exercises you've logged", [...byCount.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n));
  } else {
    const todayGroups = GROUPS.filter((g) => selectedGroups.has(g));
    todayGroups.forEach((g) => (catalogByCategory[g] || []).forEach((r) => inToday.add(r.exercise)));
    if (!q) {                                       // recent first, within today's groups
      const recent = []; for (const s of HIST) for (const x of s.workout_sets) if (inToday.has(x.exercise) && !recent.includes(x.exercise)) recent.push(x.exercise);
      if (sheetScope === "today" && selectedGroups.size) section("Recent", recent.slice(0, 6), false);
    }
    (wantAll ? [...todayGroups, ...GROUPS.filter((g) => !selectedGroups.has(g))] : todayGroups).forEach((g) => section(g, (catalogByCategory[g] || []).map((r) => r.exercise)));
    if (wantAll) section("Logged before, not in a group", [...logged].filter((n) => !catalogRow(n)).sort());
  }
  if (!list.children.length) list.append(el("p", { class: "empty" }, q ? "No match — type the name below to add it." : "Nothing here yet."));
}
$("sheet-search").addEventListener("input", renderSheet);
$("sheet-scope").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; sheetScope = b.dataset.s; syncScope(); renderSheet(); });
$("sheet-close").addEventListener("click", closeSheet);
sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });          // tap outside
$("sheet-custom").addEventListener("submit", (e) => { e.preventDefault(); const n = $("sheet-custom-name").value.trim(); if (n) pick(n); });

// ============================================================ exercise cards
const cardTpl = $("ex-card-template"), setTpl = $("set-template"), dropTpl = $("drop-template");
const listEl = $("exercise-list");

function openCard(card, open = true) {
  card.classList.toggle("open", open);
  card.querySelector(".ex-title").setAttribute("aria-expanded", String(open));
}
function setsSummary(card) {
  const sets = [...card.querySelectorAll(".ex-sets > .set-row")].map(readSet).filter((s) => s.reps > 0);
  if (!sets.length) return "";
  const top = sets.reduce((a, b) => (b.weight > a.weight ? b : a));
  return `${sets.length} set${sets.length === 1 ? "" : "s"} · ${fmtKg(top.weight)}kg × ${top.reps}`;
}
const refreshSummary = (card) => { card.querySelector(".ex-sum").textContent = card.classList.contains("open") ? "" : setsSummary(card); };
function readSet(setEl) {
  const main = setEl.querySelector(".set-main");
  const reps = parseInt(main.querySelector(".set-reps").value, 10) || 0, weight = parseFloat(main.querySelector(".set-weight").value) || 0;
  const drops = [...setEl.querySelectorAll(".drop-row")].map((d) => ({ reps: parseInt(d.querySelector(".set-reps").value, 10) || 0, weight: parseFloat(d.querySelector(".set-weight").value) || 0 }));
  return { reps, weight, drops };
}

function addDrop(setEl, vals) {
  const drops = setEl.querySelector(".drop-sets"), node = dropTpl.content.cloneNode(true), row = node.querySelector(".drop-row");
  row.querySelector(".drop-num").textContent = `Drop ${drops.children.length + 1}`;
  attachStepper(row.querySelector('[data-kind="reps"]'), { step: 1, max: MAX_REPS });
  attachStepper(row.querySelector('[data-kind="weight"]'), { step: 2.5, max: MAX_KG, decimals: 1 });
  row.querySelector(".drop-del").addEventListener("click", () => { row.remove(); [...drops.children].forEach((r, i) => (r.querySelector(".drop-num").textContent = `Drop ${i + 1}`)); });
  if (vals) { row.querySelector(".set-reps").value = vals.reps ?? ""; row.querySelector(".set-weight").value = vals.weight ?? ""; }
  drops.append(node);
}
// A new set starts as a copy of the one before it (same reps and weight), which is what you almost always want.
function addSet(card, vals) {
  const sets = card.querySelector(".ex-sets"), node = setTpl.content.cloneNode(true), row = node.querySelector(".set-row");
  const prev = sets.lastElementChild ? readSet(sets.lastElementChild) : null;
  row.querySelector(".set-num").textContent = sets.children.length + 1;
  const sync = () => refreshSummary(card);
  attachStepper(row.querySelector('[data-kind="reps"]'), { step: 1, max: MAX_REPS, onChange: sync });
  attachStepper(row.querySelector('[data-kind="weight"]'), { step: 2.5, max: MAX_KG, decimals: 1, onChange: sync });
  const v = vals || (prev && prev.reps > 0 ? { reps: prev.reps, weight: prev.weight } : null);
  if (v) { row.querySelector(".set-reps").value = v.reps || ""; row.querySelector(".set-weight").value = v.weight != null ? v.weight : ""; }
  row.querySelector(".add-drop").addEventListener("click", () => addDrop(row));
  row.querySelector(".set-del").addEventListener("click", () => {
    if (sets.children.length <= 1) { row.querySelector(".set-reps").value = ""; row.querySelector(".set-weight").value = ""; return; }
    row.remove(); [...sets.children].forEach((r, i) => (r.querySelector(".set-num").textContent = i + 1)); sync();
  });
  sets.append(node);
  return sets.lastElementChild;
}
function resetSets(card, n) { card.querySelector(".ex-sets").textContent = ""; for (let i = 0; i < Math.max(1, n); i++) addSet(card); }

function applyLast(card, lt) {
  const groups = [];
  lt.sets.forEach((s) => { if (isDrop(s) && groups.length) groups[groups.length - 1].drops.push(s); else groups.push({ main: s, drops: [] }); });
  card.querySelector(".ex-sets").textContent = "";
  groups.forEach((g) => {
    const row = addSet(card, { reps: g.main.reps || 0, weight: num(g.main.weight_kg) });
    g.drops.forEach((d) => addDrop(row, { reps: d.reps || 0, weight: num(d.weight_kg) }));
  });
  refreshSummary(card);
}
function setExercise(card, name) {
  card.dataset.exercise = name;
  card.querySelector(".ex-name").textContent = name;
  card.classList.add("chosen");
  const c = catalogRow(name), goal = card.querySelector(".ex-goal");
  goal.textContent = c && (c.target_sets || c.target_reps || c.target_weight != null) ? `Goal ${c.target_sets ?? "?"} × ${c.target_reps ?? "?"} @ ${c.target_weight ?? "?"}kg` : "";
  const touched = [...card.querySelectorAll(".ex-sets .set-reps")].some((i) => i.value !== "");
  if (!touched) resetSets(card, Math.min(6, (c && c.target_sets) || 1));
  const chip = card.querySelector(".last-chip"), lt = lastTime(name, $("s-date").value);
  if (lt) {
    const txt = lt.sets.filter((s) => !isDrop(s)).slice(0, 4).map((s) => `${fmtKg(num(s.weight_kg))}×${s.reps ?? "?"}`).join(", ");
    chip.hidden = false; chip.textContent = `Last time ${prettyDate(lt.log_date)}: ${txt} — use`;
    chip.onclick = () => applyLast(card, lt);
  } else chip.hidden = true;
}
const chooseFor = (card) => openSheet({ mode: "log", onPick: (n) => setExercise(card, n) });
function addExerciseCard({ exercise, sets, collapsed } = {}) {
  // keep the page short: fold the other cards (their summary line stays visible)
  [...listEl.querySelectorAll(".ex-card.open")].forEach((c) => { if (c.dataset.exercise) { openCard(c, false); refreshSummary(c); } });
  const node = cardTpl.content.cloneNode(true), card = node.querySelector(".ex-card");
  card.querySelector(".ex-title").addEventListener("click", () => {
    if (!card.dataset.exercise) return chooseFor(card);                  // nothing picked yet: the title opens the picker
    openCard(card, !card.classList.contains("open")); refreshSummary(card);
  });
  card.querySelector(".ex-change").addEventListener("click", () => chooseFor(card));
  card.querySelector(".add-set").addEventListener("click", () => { addSet(card); refreshSummary(card); });
  card.querySelector(".ex-remove").addEventListener("click", () => { card.remove(); if (!listEl.children.length && !selectedGroups.size) $("log-form").hidden = true; syncEmptyHint(); });
  resetSets(card, sets || 1);
  listEl.append(node);
  const added = listEl.lastElementChild; syncEmptyHint();
  if (exercise) { setExercise(added, exercise); if (sets) resetSets(added, sets); if (collapsed) { openCard(added, false); refreshSummary(added); } }
  else chooseFor(added);                                                  // straight into choosing
  return added;
}
$("add-exercise").addEventListener("click", () => addExerciseCard());

// ============================================================ date / session state
$("s-date").value = todayISO();
async function refreshDateState() {
  const date = $("s-date").value; if (!date) return;
  const { data } = await sb.from("workout_sessions").select("id, category, start_time, end_time").eq("log_date", date).limit(1);
  const existing = data && data.length ? data[0] : null;
  $("date-time-fields").hidden = !!existing; $("continuing-note").hidden = !existing;
  if (existing) {
    $("continuing-date").textContent = date;
    const t = [existing.start_time, existing.end_time].filter(Boolean).map((x) => x.slice(0, 5)).join(" – ");
    $("continuing-detail").textContent = `— ${existing.category}${t ? " · " + t : ""}`;
  }
}
$("s-date").addEventListener("change", refreshDateState);
$("log-different-date").addEventListener("click", () => { $("s-date").value = localISO(addDays(new Date(), -1)); refreshDateState(); $("date-time-fields").hidden = false; $("continuing-note").hidden = true; });

function mergeCategoryLabel(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming || existing === incoming) return existing;
  const parts = new Set(existing.split(" + ").map((s) => s.trim()).filter(Boolean));
  incoming.split(" + ").forEach((p) => parts.add(p.trim()));
  return [...parts].join(" + ");
}
function resetLogForm() {
  $("s-date").value = todayISO(); $("s-start").value = ""; $("s-end").value = "";
  listEl.textContent = ""; selectedGroups.clear();
  groupPicker.querySelectorAll(".group-chip").forEach((b) => b.setAttribute("aria-pressed", "false"));
  $("log-form").hidden = true; $("routine-row").hidden = true;
  $("date-time-fields").hidden = false; $("continuing-note").hidden = true;
  $("session-status").textContent = ""; $("session-status").classList.remove("error");
}

// ============================================================ timer -------
// state: { startedAt (clock ms of first start), acc (ms banked before the current run), runFrom (ms, or null when paused) }
const TIMER_KEY = "workout.timer.v1";
let timer = (() => { try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || null; } catch { return null; } })();
const saveTimer = () => { try { timer ? localStorage.setItem(TIMER_KEY, JSON.stringify(timer)) : localStorage.removeItem(TIMER_KEY); } catch {} };
const timerMs = () => (timer ? timer.acc + (timer.runFrom ? Date.now() - timer.runFrom : 0) : 0);
const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
function fmtTimer(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
function renderTimer() {
  const running = !!(timer && timer.runFrom);
  $("timer-time").textContent = fmtTimer(timerMs());
  $("timer").classList.toggle("running", running);
  $("timer-main").textContent = !timer ? "Start timer" : running ? "Pause" : "Resume";
  $("timer-reset").hidden = !timer;
  $("timer-note").textContent = !timer ? "Tap start when you begin. Start and end times fill in when you save."
    : `Started ${hhmm(timer.startedAt)}${running ? "" : " · paused"}. Saving the workout stops the timer.`;
}
$("timer-main").addEventListener("click", () => {
  const now = Date.now();
  if (!timer) timer = { startedAt: now, acc: 0, runFrom: now };
  else if (timer.runFrom) { timer.acc += now - timer.runFrom; timer.runFrom = null; timer.pausedAt = now; }
  else timer.runFrom = now;
  saveTimer(); renderTimer();
});
$("timer-reset").addEventListener("click", () => {
  if (timerMs() > 60000 && !$("timer-reset").dataset.armed) {   // one tap to arm, second to confirm (no popup)
    const b = $("timer-reset"); b.dataset.armed = "1"; b.textContent = "Tap again";
    setTimeout(() => { delete b.dataset.armed; b.textContent = "Reset"; }, 3000); return;
  }
  timer = null; saveTimer(); $("timer-reset").textContent = "Reset"; delete $("timer-reset").dataset.armed; renderTimer();
});
setInterval(() => { if (timer && timer.runFrom) $("timer-time").textContent = fmtTimer(timerMs()); }, 500);
document.addEventListener("visibilitychange", renderTimer);

// ============================================================ save --------
function setStatus(msg, err) { const s = $("session-status"); s.textContent = msg; s.classList.toggle("error", !!err); }
$("save-session").addEventListener("click", async () => {
  const saveBtn = $("save-session"), log_date = $("s-date").value;
  // times typed by hand win; otherwise use the timer's first start and the moment it stopped / was saved
  const start_time = $("s-start").value || (timer ? hhmm(timer.startedAt) : null);
  const end_time = $("s-end").value || (timer ? hhmm(timer.runFrom ? Date.now() : timer.pausedAt) : null), label = sessionLabel();
  if (!log_date) return setStatus("Pick a date.", true);
  if (!label) return setStatus("Pick at least one muscle group above.", true);

  // collect: per exercise, each working set then its drop sets. Empty sets (0 reps) are skipped; a blank weight is 0 kg.
  const byExercise = {};
  [...listEl.querySelectorAll(".ex-card")].forEach((card) => {
    const exercise = (card.dataset.exercise || "").trim(); if (!exercise) return;
    const comment = card.querySelector(".ex-comment").value.trim() || null, out = [];
    [...card.querySelectorAll(".ex-sets > .set-row")].forEach((setEl) => {
      const s = readSet(setEl);
      if (s.reps > 0) out.push({ reps: Math.min(MAX_REPS, s.reps), weight_kg: Math.min(MAX_KG, s.weight), notes: null });
      s.drops.forEach((d) => { if (d.reps > 0) out.push({ reps: Math.min(MAX_REPS, d.reps), weight_kg: Math.min(MAX_KG, d.weight), notes: DROP_TAG }); });
    });
    if (!out.length) return;
    if (comment) out[0].notes = out[0].notes ? `${comment} ${out[0].notes}` : comment;
    (byExercise[exercise] || (byExercise[exercise] = [])).push(...out);
  });
  if (!Object.keys(byExercise).length) return setStatus("Add at least one set with reps.", true);

  saveBtn.disabled = true; saveBtn.textContent = "Saving…"; setStatus("");
  try {
    // one session per date: later saves on the same day append to it and merge the group labels
    const { data: found, error: findErr } = await sb.from("workout_sessions").select("id, category, start_time, end_time").eq("log_date", log_date).limit(1);
    if (findErr) return setStatus(`Error: ${findErr.message}`, true);
    let sessionId; const merging = !!(found && found.length);
    if (merging) {
      sessionId = found[0].id; const patch = {};
      if (start_time && (!found[0].start_time || start_time < found[0].start_time)) patch.start_time = start_time;
      if (end_time && (!found[0].end_time || end_time > found[0].end_time)) patch.end_time = end_time;
      const merged = mergeCategoryLabel(found[0].category, label); if (merged !== found[0].category) patch.category = merged;
      if (Object.keys(patch).length) { const { error } = await sb.from("workout_sessions").update(patch).eq("id", sessionId); if (error) return setStatus(`Error: ${error.message}`, true); }
    } else {
      const { data: sess, error } = await sb.from("workout_sessions").insert({ log_date, category: label, start_time, end_time }).select().single();
      if (error) return setStatus(`Error: ${error.message}`, true);
      sessionId = sess.id;
    }
    const startNum = {};
    if (merging) { const { data: ex } = await sb.from("workout_sets").select("exercise, set_number").eq("session_id", sessionId); (ex || []).forEach((r) => { startNum[r.exercise] = Math.max(startNum[r.exercise] || 0, r.set_number); }); }
    const rows = [];
    Object.entries(byExercise).forEach(([exercise, list]) => { let n = startNum[exercise] || 0; list.forEach((r) => rows.push({ exercise, set_number: ++n, reps: r.reps, weight_kg: r.weight_kg, notes: r.notes, session_id: sessionId })); });
    const { error: setsErr } = await sb.from("workout_sets").insert(rows);
    if (setsErr) return setStatus(`Session saved, but sets failed: ${setsErr.message}`, true);
    setStatus(merging ? "Added to the day's workout ✓" : "Saved ✓");
    if (timer) { timer = null; saveTimer(); renderTimer(); }
    setTimeout(async () => { resetLogForm(); await loadHistory(); renderAll(); }, 700);
  } finally { saveBtn.disabled = false; saveBtn.textContent = "Save workout"; }
});

// ============================================================ progress charts
const C = Charts;
function weekStartISO(iso) { const d = parseISO(iso); return localISO(addDays(d, -d.getDay())); }       // Sunday-start weeks, like the rest of the site

function chartWeekly() {
  const today = localISO(), thisWeek = weekStartISO(today), weeks = [];
  for (let i = 11; i >= 0; i--) weeks.push(localISO(addDays(parseISO(thisWeek), -7 * i)));
  const count = new Map(weeks.map((w) => [w, new Set()]));
  HIST.forEach((s) => { const w = weekStartISO(s.log_date); if (count.has(w)) count.get(w).add(s.log_date); });
  const vals = weeks.map((w) => count.get(w).size);
  C.bar($("ch-weekly"), { labels: weeks, values: vals, height: 170, color: "var(--chart-1)", emptyText: "Log a workout to see your weekly rhythm.",
    xTick: (i) => (i % 2 ? "" : prettyDate(weeks[i])), tipTitle: (i) => `Week of ${prettyDate(weeks[i])}`, tipValue: (i) => `${vals[i]} session${vals[i] === 1 ? "" : "s"}` });
}
function chartVolume() {
  const list = HIST.filter((s) => s.workout_sets.some(sane)).slice(0, 16).reverse();
  const vals = list.map((s) => Math.round(sessionVolume(s)));
  C.bar($("ch-volume"), { labels: list.map((s) => s.log_date), values: vals, height: 170, color: "var(--chart-3)", emptyText: "No sessions with weights yet.",
    xTick: (i) => (list.length > 8 && i % 2 ? "" : prettyDate(list[i].log_date)), fmtTick: (v) => C.compact(v),
    tipTitle: (i) => `${prettyDate(list[i].log_date)} · ${list[i].category || "Workout"}`, tipValue: (i) => `${vals[i].toLocaleString()} kg` });
}
function chartSplit() {
  const host = $("ch-split"); host.textContent = "";
  const from = localISO(addDays(new Date(), -56)), by = {};
  HIST.filter((s) => s.log_date >= from).forEach((s) => splitGroups(s.category).forEach((g) => { by[g] = (by[g] || 0) + 1; }));
  const groups = GROUPS.filter((g) => by[g]).map((g) => ({ label: g, value: by[g], color: C.slotColor(g, C.WORKOUT_SLOTS) }));
  const total = groups.reduce((a, g) => a + g.value, 0);
  if (!total) { host.append(el("p", { class: "empty" }, "Nothing in the last 8 weeks yet.")); return; }
  const dh = el("div", { class: "donut-host" }); host.append(el("div", { class: "split-row" }, dh, C.legend(groups.map((g) => ({ label: g.label, color: g.color, text: `${g.value} · ${Math.round(g.value / total * 100)}%` })))));
  C.donut(dh, { segments: groups, size: 150, big: String(total), small: total === 1 ? "group-day" : "group-days", aria: "Sessions by muscle group", tipValue: (s, sh) => `${s.value} · ${Math.round(sh * 100)}%` });
}
function bestSets() {
  const best = new Map();
  HIST.forEach((s) => s.workout_sets.filter((x) => sane(x) && !isDrop(x) && x.weight_kg > 0).forEach((x) => {
    const b = best.get(x.exercise);
    if (!b || x.weight_kg > b.kg || (x.weight_kg === b.kg && x.reps > b.reps)) best.set(x.exercise, { kg: x.weight_kg, reps: x.reps, date: s.log_date });
  }));
  return best;
}
function chartPB() {
  const host = $("ch-pb"); host.textContent = "";
  const rows = [...bestSets()].sort((a, b) => b[1].kg - a[1].kg).slice(0, 8).map(([n, b]) => ({ label: `${n} · ${b.reps} reps`, value: b.kg }));
  if (!rows.length) { host.append(el("p", { class: "empty" }, "Your heaviest sets will show up here.")); return; }
  C.hbar(host, rows, (v) => `${fmtKg(v)} kg`);
}

// ---- exercise explorer ----
let exploreEx = null, metric = "top";
const e1rm = (kg, reps) => (reps <= 1 ? kg : kg * (1 + reps / 30));          // Epley
function exercisePoints(name) {
  const pts = [];
  HIST.slice().reverse().forEach((s) => {
    const sets = s.workout_sets.filter((x) => x.exercise === name && sane(x) && !isDrop(x));
    if (!sets.length) return;
    const top = sets.reduce((a, b) => (b.weight_kg > a.weight_kg || (b.weight_kg === a.weight_kg && b.reps > a.reps) ? b : a));
    const bestE = Math.max(...sets.map((x) => e1rm(x.weight_kg, x.reps)));
    pts.push({ date: s.log_date, top: top.weight_kg, reps: top.reps, e1rm: bestE, vol: sets.reduce((a, x) => a + x.reps * x.weight_kg, 0), sets: sets.length });
  });
  return pts;
}
function renderExplorer() {
  const has = !!exploreEx;
  $("progress-empty").hidden = has; $("progress-chart-wrap").hidden = !has; $("progress-empty").textContent = "Pick an exercise to see how it's going over time.";
  $("progress-choose-text").textContent = exploreEx || "Choose exercise…";
  if (!has) { $("ex-meta").textContent = ""; return; }
  const pts = exercisePoints(exploreEx);
  if (!pts.length) { $("progress-empty").hidden = false; $("progress-empty").textContent = "No valid sets logged for this exercise yet."; $("progress-chart-wrap").hidden = true; return; }
  const shown = pts.slice(-24), key = metric === "top" ? "top" : metric === "e1rm" ? "e1rm" : "vol";
  const vals = shown.map((p) => Math.round(p[key] * 10) / 10), unit = metric === "vol" ? "kg total" : "kg";
  $("ex-meta").textContent = `${pts.length} session${pts.length === 1 ? "" : "s"}`;
  const last = shown[shown.length - 1], prev = shown[shown.length - 2], d = $("progress-delta");
  if (prev) {
    const dv = Math.round((vals[vals.length - 1] - vals[vals.length - 2]) * 10) / 10;
    d.innerHTML = `<strong>${prettyDate(last.date)}</strong>: ${fmtKg(last.top)}kg × ${last.reps} <span class="delta ${dv >= 0 ? "up" : "down"}">${dv > 0 ? "▲ +" : dv < 0 ? "▼ −" : "＝ "}${fmtKg(Math.abs(dv))} ${unit}</span> vs ${prettyDate(prev.date)}`;
  } else d.textContent = "One session logged so far — one more and you'll see the trend.";
  C.line($("progress-chart"), { values: vals, height: 190, zero: metric === "vol", emptyText: "Not enough data yet.",
    xTick: (i) => (shown.length > 8 && i % 2 ? "" : prettyDate(shown[i].date)), fmtTick: (v) => C.compact(v),
    tipTitle: (i) => prettyDate(shown[i].date), tipValue: (i) => `${fmtKg(vals[i])} ${unit} · top set ${fmtKg(shown[i].top)}kg × ${shown[i].reps}` });
  $("progress-table").textContent = "";
  $("progress-table").append(C.table(["Date", "Top set", "Est. 1RM", "Volume"], pts.slice(-8).reverse().map((p) => [prettyDate(p.date), `${fmtKg(p.top)}kg × ${p.reps}`, `${fmtKg(Math.round(p.e1rm * 10) / 10)} kg`, `${Math.round(p.vol).toLocaleString()} kg`])));
}
$("progress-choose").addEventListener("click", () => openSheet({ mode: "history", title: "Which exercise?", onPick: (n) => { exploreEx = n; renderExplorer(); } }));
$("metric-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; metric = b.dataset.m; $("metric-seg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b))); renderExplorer(); });

// ---- body weight (optional, never asked for when logging a workout) ----
let BW = [];
async function loadBodyWeight() {
  const { data } = await sb.from("body_weight").select("log_date, weight_kg").order("log_date");
  BW = (data || []).map((r) => ({ date: r.log_date, kg: Number(r.weight_kg) })).filter((r) => r.kg >= 30 && r.kg <= 250);   // ignore typos like 0 or 0.5
  chartBW();
}
function chartBW() {
  const host = $("ch-bw");
  if (BW.length < 2) { host.textContent = ""; host.append(el("p", { class: "empty" }, BW.length ? "Log it on a second day to see a trend." : "Totally optional — log it whenever you like and a trend line appears here.")); return; }
  const shown = BW.slice(-60);
  C.line(host, { values: shown.map((r) => r.kg), height: 170, xTick: (i) => (shown.length > 8 && i % Math.ceil(shown.length / 6) ? "" : prettyDate(shown[i].date)),
    tipTitle: (i) => prettyDate(shown[i].date), tipValue: (i) => `${fmtKg(shown[i].kg)} kg` });
}
$("bw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = parseFloat($("bw-input").value), s = $("bw-status");
  if (!Number.isFinite(v) || v < 30 || v > 250) { s.textContent = "Enter a weight between 30 and 250 kg."; s.classList.add("error"); return; }
  const { error } = await sb.from("body_weight").upsert({ log_date: todayISO(), weight_kg: v }, { onConflict: "log_date" });
  s.classList.toggle("error", !!error); s.textContent = error ? "Couldn't save." : "Saved ✓";
  if (!error) { $("bw-input").value = ""; await loadBodyWeight(); setTimeout(() => (s.textContent = ""), 2000); }
});

function renderAll() {
  renderConsistency(); chartWeekly(); chartVolume(); chartSplit(); chartPB();
  if (!exploreEx) { const c = new Map(); HIST.forEach((s) => s.workout_sets.forEach((x) => c.set(x.exercise, (c.get(x.exercise) || 0) + 1))); const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0]; if (top) exploreEx = top[0]; }
  renderExplorer();
}

// ============================================================ init --------
(async function init() {
  await Promise.all([loadHistory(), loadCatalog()]);
  renderAll(); loadBodyWeight(); renderTimer();
})();
