const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// Local-date (not UTC) YYYY-MM-DD -- toISOString()/new Date("YYYY-MM-DD") are both
// UTC-based and drift a day off in timezones ahead of/behind UTC around midnight.
function localISO(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const todayISO = () => localISO();
const GROUPS = ["Back + Biceps", "Chest + Triceps", "Shoulder + Arms", "Legs", "Whole body"];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ============================================================ consistency
async function loadConsistency() {
  const { data, error } = await sb.from("workout_sessions").select("log_date");
  if (error) return;
  const dates = new Set((data || []).map((r) => r.log_date));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = localISO(today);

  // last 4 weeks stat (ISO date strings sort/compare lexicographically)
  const fourWeeksAgoStr = localISO(addDays(today, -28));
  const recentCount = [...dates].filter((d) => d >= fourWeeksAgoStr && d <= todayStr).length;
  document.getElementById("stat-recent").textContent = recentCount;

  // current weekly streak: consecutive 7-day windows ending this week with >=1 session
  let streak = 0;
  for (let w = 0; ; w++) {
    const endStr = localISO(addDays(today, -w * 7));
    const startStr = localISO(addDays(today, -w * 7 - 6));
    const hasSession = [...dates].some((d) => d >= startStr && d <= endStr);
    if (!hasSession) break;
    streak++;
    if (streak > 104) break;
  }
  document.getElementById("stat-streak").textContent = streak;

  // heatmap: 18 weeks, Sun-Sat columns
  const WEEKS = 18;
  const endOfGrid = addDays(today, 6 - today.getDay()); // extend to end of this week (Sat)
  const startOfGrid = addDays(endOfGrid, -(WEEKS * 7 - 1));

  const heatmap = document.getElementById("heatmap");
  heatmap.innerHTML = "";
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(startOfGrid, i);
    const iso = localISO(d);
    const cell = document.createElement("div");
    cell.className = "heat-cell";
    if (dates.has(iso)) cell.classList.add("filled");
    if (iso === todayStr) cell.classList.add("today");
    if (iso > todayStr) cell.style.visibility = "hidden";
    cell.title = iso;
    heatmap.appendChild(cell);
  }
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ============================================================ catalog ----
let catalogByCategory = {};

async function loadCatalog() {
  const { data, error } = await sb.from("exercise_catalog").select("*").order("sort_order");
  if (error) return;
  catalogByCategory = {};
  GROUPS.forEach((g) => (catalogByCategory[g] = []));
  (data || []).forEach((row) => {
    if (!catalogByCategory[row.category]) catalogByCategory[row.category] = [];
    catalogByCategory[row.category].push(row);
  });
}

function goalText(row) {
  if (!row) return "";
  const parts = [row.target_sets ?? "?", row.target_reps ?? "?", row.target_weight != null ? row.target_weight : "?"];
  return `Goal: ${parts.join("/")}`;
}

// ============================================================ category picker
const picker = document.getElementById("category-picker");
GROUPS.forEach((g) => {
  const btn = document.createElement("button");
  btn.className = "category-btn";
  btn.textContent = g;
  btn.dataset.category = g;
  btn.addEventListener("click", () => selectCategory(g));
  picker.appendChild(btn);
});

let selectedCategory = null;

function selectCategory(category) {
  selectedCategory = category;
  [...picker.children].forEach((b) => b.classList.toggle("active", b.dataset.category === category));
  document.getElementById("log-form").hidden = false;

  document.getElementById("exercise-list").innerHTML = ""; // no prefilled rows -- start empty
  addExerciseRow();
}

// ============================================================ exercise rows
const exerciseListEl = document.getElementById("exercise-list");
const exerciseRowTemplate = document.getElementById("exercise-row-template");
const setInputTemplate = document.getElementById("set-input-template");
const OTHER_VALUE = "__other__";

function addSetInput(setsContainer) {
  const node = setInputTemplate.content.cloneNode(true);
  const num = setsContainer.children.length + 1;
  node.querySelector(".set-num").textContent = num;
  setsContainer.appendChild(node);
}

function setSetCount(setsContainer, n) {
  setsContainer.innerHTML = "";
  for (let i = 0; i < n; i++) addSetInput(setsContainer);
}

function addExerciseRow() {
  const node = exerciseRowTemplate.content.cloneNode(true);
  const row = node.querySelector(".ex-row");
  const select = row.querySelector(".ex-select");
  const otherInput = row.querySelector(".ex-name-other");
  const goalEl = row.querySelector(".ex-goal");
  const setsContainer = row.querySelector(".ex-sets");

  // options limited to the selected category's catalog, plus a manual fallback
  const options = catalogByCategory[selectedCategory] || [];
  options.forEach((catalogRow) => {
    const opt = document.createElement("option");
    opt.value = catalogRow.exercise;
    opt.textContent = catalogRow.exercise;
    select.appendChild(opt);
  });
  const otherOpt = document.createElement("option");
  otherOpt.value = OTHER_VALUE;
  otherOpt.textContent = "Other…";
  select.appendChild(otherOpt);

  setSetCount(setsContainer, 3);

  select.addEventListener("change", () => {
    if (select.value === OTHER_VALUE) {
      otherInput.hidden = false;
      otherInput.value = "";
      otherInput.focus();
      goalEl.textContent = "";
      setSetCount(setsContainer, 3);
      return;
    }
    otherInput.hidden = true;
    const catalogRow = options.find((r) => r.exercise === select.value);
    goalEl.textContent = goalText(catalogRow);
    setSetCount(setsContainer, catalogRow?.target_sets || 3);
  });

  row.querySelector(".add-set").addEventListener("click", () => addSetInput(setsContainer));
  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());

  exerciseListEl.appendChild(node);
}

document.getElementById("add-exercise").addEventListener("click", () => addExerciseRow());

// ============================================================ save --------
document.getElementById("s-date").value = todayISO();

function resetLogForm() {
  document.getElementById("s-date").value = todayISO();
  document.getElementById("s-bodyweight").value = "";
  document.getElementById("s-start").value = "";
  document.getElementById("s-end").value = "";
  document.getElementById("log-form").hidden = true;
  [...picker.children].forEach((b) => b.classList.remove("active"));
  selectedCategory = null;
  document.getElementById("session-status").textContent = "";
  document.getElementById("session-status").classList.remove("error");
}

document.getElementById("save-session").addEventListener("click", async () => {
  const statusEl = document.getElementById("session-status");
  const log_date = document.getElementById("s-date").value;
  const bodyweight = document.getElementById("s-bodyweight").value;
  const start_time = document.getElementById("s-start").value || null;
  const end_time = document.getElementById("s-end").value || null;

  if (!log_date || !selectedCategory) {
    statusEl.textContent = "Date and category are required.";
    statusEl.classList.add("error");
    return;
  }

  const exerciseRows = [...exerciseListEl.querySelectorAll(".ex-row")];
  const setRows = [];
  exerciseRows.forEach((row) => {
    const select = row.querySelector(".ex-select");
    const exercise = select.value === OTHER_VALUE
      ? row.querySelector(".ex-name-other").value.trim()
      : select.value.trim();
    if (!exercise) return;
    const comment = row.querySelector(".ex-comment").value.trim() || null;
    const sets = [...row.querySelectorAll(".set-input")];
    let setNum = 0;
    sets.forEach((s) => {
      const repsVal = s.querySelector(".set-reps").value;
      const weightVal = s.querySelector(".set-weight").value;
      if (repsVal === "" && weightVal === "") return; // skip untouched set slots
      setNum++;
      setRows.push({
        exercise,
        set_number: setNum,
        reps: repsVal !== "" ? parseInt(repsVal, 10) : null,
        weight_kg: weightVal !== "" ? parseFloat(weightVal) : null,
        notes: setNum === 1 ? comment : null,
      });
    });
  });

  if (setRows.length === 0) {
    statusEl.textContent = "Log at least one set.";
    statusEl.classList.add("error");
    return;
  }

  const { data: session, error: sessErr } = await sb
    .from("workout_sessions")
    .insert({ log_date, category: selectedCategory, start_time, end_time })
    .select()
    .single();
  if (sessErr) {
    statusEl.textContent = `Error: ${sessErr.message}`;
    statusEl.classList.add("error");
    return;
  }

  const { error: setsErr } = await sb.from("workout_sets")
    .insert(setRows.map((r) => ({ ...r, session_id: session.id })));
  if (setsErr) {
    statusEl.textContent = `Session saved, but sets failed: ${setsErr.message}`;
    statusEl.classList.add("error");
    return;
  }

  if (bodyweight) {
    await sb.from("body_weight").upsert(
      { log_date, weight_kg: parseFloat(bodyweight) },
      { onConflict: "log_date" }
    );
  }

  statusEl.classList.remove("error");
  statusEl.textContent = "Saved ✓";
  setTimeout(() => {
    resetLogForm();
    loadConsistency();
    loadRecent();
  }, 700);
});

// ============================================================ recent ------
async function loadRecent() {
  const { data, error } = await sb
    .from("workout_sessions")
    .select("*, workout_sets(*)")
    .order("log_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(8);
  if (error) return;

  const list = document.getElementById("recent-list");
  list.innerHTML = "";
  if (!data || data.length === 0) {
    list.innerHTML = '<p class="empty">No workouts logged yet.</p>';
    return;
  }

  data.forEach((session) => {
    const exercises = [...new Set((session.workout_sets || []).map((s) => s.exercise))];
    const div = document.createElement("div");
    div.className = "recent-item";
    const timeRange = [session.start_time, session.end_time].filter(Boolean).map((t) => t.slice(0, 5)).join(" – ");
    div.innerHTML = `
      <div class="recent-head">
        <span><span class="date">${session.log_date}</span> · ${escapeHtml(session.category || "")}${timeRange ? " · " + timeRange : ""}</span>
        <button class="remove-btn" title="Delete">✕</button>
      </div>
      <div class="recent-exercises">${exercises.map(escapeHtml).join(", ") || "—"}</div>
    `;
    div.querySelector(".remove-btn").addEventListener("click", async () => {
      if (!confirm("Delete this workout?")) return;
      const { error: delErr } = await sb.from("workout_sessions").delete().eq("id", session.id);
      if (!delErr) {
        div.remove();
        loadConsistency();
      }
    });
    list.appendChild(div);
  });
}

// ============================================================ init --------
loadConsistency();
loadCatalog();
loadRecent();
