const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// Local-date (not UTC) YYYY-MM-DD -- toISOString()/new Date("YYYY-MM-DD") are both
// UTC-based and drift a day off in timezones ahead of/behind UTC around midnight.
function localISO(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const todayISO = () => localISO();
const GROUPS = ["Back + Biceps", "Chest + Triceps", "Shoulder + Arms", "Legs", "Whole body"];
// Sets tagged with this notes prefix are drop sets chained onto the set
// before them -- a lightweight convention rather than a schema column, so
// no migration is needed. Never collides with a real exercise-level comment
// since drop sets are never the first set of an exercise.
const DROP_TAG = "[drop]";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ============================================================ stepper -----
// Big +/- buttons instead of a keyboard for entering numbers on mobile.
// Tapping the number itself is still a (deliberate) escape hatch for exact values.
// An optional bigStep wires a second, wider-spaced pair of buttons (».«) for
// jumping in bigger increments -- e.g. +5kg per tap instead of +2.5kg -- for
// exercises where you're loading whole plates rather than fine-tuning.
function attachStepper(stepperEl, { step = 1, bigStep = null, min = 0, max = 999, decimals = 0, input } = {}) {
  const minusBtn = stepperEl.querySelector(".minus");
  const plusBtn = stepperEl.querySelector(".plus");
  const bigMinusBtn = stepperEl.querySelector(".big-minus");
  const bigPlusBtn = stepperEl.querySelector(".big-plus");
  const inp = input || stepperEl.querySelector(".num-display");
  const factor = 10 ** decimals;
  const round = (n) => Math.round(n * factor) / factor;
  const getVal = () => {
    const v = parseFloat(inp.value);
    return Number.isFinite(v) ? v : 0;
  };
  const setVal = (v) => {
    inp.value = String(round(Math.min(max, Math.max(min, v))));
  };

  function wireRepeat(btn, dir, stepSize) {
    if (!btn || !stepSize) return;
    let timeout, interval, count;
    const tick = () => {
      const mult = count > 20 ? 4 : count > 8 ? 2 : 1;
      setVal(getVal() + dir * stepSize * mult);
      count++;
    };
    const start = (e) => {
      e.preventDefault();
      count = 0;
      tick();
      timeout = setTimeout(() => { interval = setInterval(tick, 90); }, 350);
    };
    const stop = () => { clearTimeout(timeout); clearInterval(interval); };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
    btn.addEventListener("pointercancel", stop);
  }
  wireRepeat(minusBtn, -1, step);
  wireRepeat(plusBtn, 1, step);
  wireRepeat(bigMinusBtn, -1, bigStep);
  wireRepeat(bigPlusBtn, 1, bigStep);

  inp.addEventListener("click", () => {
    if (inp.readOnly) {
      inp.readOnly = false;
      inp.focus();
      inp.select();
    }
  });
  inp.addEventListener("blur", () => {
    inp.readOnly = true;
    if (inp.value !== "") setVal(getVal());
  });
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

// Once picked, the category locks in (no accidental switching mid-entry) --
// a deliberate "Change" tap is the only way back, and it confirms first.
function selectCategory(category) {
  selectedCategory = category;
  picker.hidden = true;
  document.getElementById("category-locked").hidden = false;
  document.getElementById("category-locked-name").textContent = category;
  document.getElementById("log-form").classList.add("open");

  document.getElementById("exercise-list").innerHTML = ""; // no prefilled rows -- start empty
  addExerciseRow();

  setTimeout(() => {
    document.getElementById("log-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

document.getElementById("change-category").addEventListener("click", () => {
  if (!confirm("Change today's category? This clears the exercises you've entered so far.")) return;
  resetLogForm();
});

// ============================================================ exercise carousel
// Exercises swipe horizontally (one per screen) instead of stacking
// vertically, via native CSS scroll-snap on #exercise-list -- this is what
// keeps the page's scroll height capped at the tallest single exercise
// instead of growing with every exercise added to today's workout.
const exerciseListEl = document.getElementById("exercise-list");
const carouselControlsEl = document.getElementById("carousel-controls");

function currentSlideIndex() {
  const rows = [...exerciseListEl.querySelectorAll(".ex-row")];
  if (!rows.length) return 0;
  const w = exerciseListEl.clientWidth || 1;
  return Math.max(0, Math.min(rows.length - 1, Math.round(exerciseListEl.scrollLeft / w)));
}
function scrollToExercise(i) {
  const rows = [...exerciseListEl.querySelectorAll(".ex-row")];
  if (!rows.length) return;
  const idx = Math.max(0, Math.min(rows.length - 1, i));
  exerciseListEl.scrollTo({ left: idx * exerciseListEl.clientWidth, behavior: "smooth" });
}
function syncActiveDot() {
  const idx = currentSlideIndex();
  [...carouselControlsEl.querySelectorAll(".carousel-dot")].forEach((d, i) => d.classList.toggle("active", i === idx));
  const rows = [...exerciseListEl.querySelectorAll(".ex-row")];
  const prevBtn = carouselControlsEl.querySelector(".carousel-arrow.prev");
  const nextBtn = carouselControlsEl.querySelector(".carousel-arrow.next");
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= rows.length - 1;
}
function updateCarouselControls() {
  const rows = [...exerciseListEl.querySelectorAll(".ex-row")];
  carouselControlsEl.innerHTML = "";
  if (rows.length <= 1) { carouselControlsEl.hidden = true; return; }
  carouselControlsEl.hidden = false;

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "carousel-arrow prev";
  prevBtn.setAttribute("aria-label", "Previous exercise");
  prevBtn.textContent = "‹";
  prevBtn.addEventListener("click", () => scrollToExercise(currentSlideIndex() - 1));

  const dots = document.createElement("div");
  dots.className = "carousel-dots";
  rows.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carousel-dot";
    dot.setAttribute("aria-label", `Go to exercise ${i + 1}`);
    dot.addEventListener("click", () => scrollToExercise(i));
    dots.appendChild(dot);
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "carousel-arrow next";
  nextBtn.setAttribute("aria-label", "Next exercise");
  nextBtn.textContent = "›";
  nextBtn.addEventListener("click", () => scrollToExercise(currentSlideIndex() + 1));

  carouselControlsEl.append(prevBtn, dots, nextBtn);
  syncActiveDot();
}
let scrollRAF;
exerciseListEl.addEventListener("scroll", () => {
  cancelAnimationFrame(scrollRAF);
  scrollRAF = requestAnimationFrame(syncActiveDot);
});

// ============================================================ exercise rows
const exerciseRowTemplate = document.getElementById("exercise-row-template");
const setInputTemplate = document.getElementById("set-input-template");
const dropSetTemplate = document.getElementById("drop-set-template");
const OTHER_VALUE = "__other__";

// ---- drop sets: a mini reps/weight pair chained under a working set, for
// "same exercise, drop the weight, keep going without rest." Stored as an
// ordinary extra workout_sets row (see DROP_TAG) rather than needing a
// schema change.
function updateDropBadge(setRow) {
  const badge = setRow.querySelector(".drop-badge");
  const n = setRow.querySelectorAll(".drop-row").length;
  badge.textContent = n > 0 ? `🔻 ${n} drop${n > 1 ? "s" : ""}` : "";
}
function renumberDrops(dropsContainer) {
  [...dropsContainer.children].forEach((el, i) => {
    el.querySelector(".drop-num").textContent = `Drop ${i + 1}`;
  });
}
function addDropInput(dropsContainer) {
  const node = dropSetTemplate.content.cloneNode(true);
  const row = node.querySelector(".drop-row");
  const num = dropsContainer.children.length + 1;
  row.querySelector(".drop-num").textContent = `Drop ${num}`;
  attachStepper(row.querySelector('.stepper[data-kind="reps"]'), { step: 1, min: 0, max: 99, decimals: 0 });
  attachStepper(row.querySelector('.stepper[data-kind="weight"]'), { step: 2.5, min: 0, max: 400, decimals: 1 });
  row.querySelector(".remove-drop").addEventListener("click", () => {
    const setRow = dropsContainer.closest(".set-row");
    row.remove();
    renumberDrops(dropsContainer);
    updateDropBadge(setRow);
  });
  dropsContainer.appendChild(node);
  return dropsContainer.lastElementChild;
}

function addSetInput(setsContainer) {
  const node = setInputTemplate.content.cloneNode(true);
  const row = node.querySelector(".set-row");
  const num = setsContainer.children.length + 1;
  row.querySelector(".set-num").textContent = num;
  attachStepper(row.querySelector('.stepper[data-kind="reps"]'), { step: 1, bigStep: 5, min: 0, max: 99, decimals: 0 });
  attachStepper(row.querySelector('.stepper[data-kind="weight"]'), { step: 2.5, bigStep: 10, min: 0, max: 400, decimals: 1 });

  const dropsContainer = row.querySelector(".drop-sets");
  row.querySelector(".add-drop").addEventListener("click", () => {
    addDropInput(dropsContainer);
    updateDropBadge(row);
  });
  updateDropBadge(row);

  setsContainer.appendChild(node);
}

function setSetCount(setsContainer, n) {
  setsContainer.innerHTML = "";
  for (let i = 0; i < n; i++) addSetInput(setsContainer);
}

// ---- load previous: pulls the most recent (or a picked-from-a-list-of-recent)
// occurrence of this exact exercise name and pre-fills the current sets
// (and any drop sets it had) from it, so you're not retyping last time's
// numbers from memory.
async function fetchPreviousInstances(exercise, excludeDate, limit = 5) {
  if (!exercise) return [];
  const { data, error } = await sb
    .from("workout_sessions")
    .select("id, log_date, workout_sets(reps, weight_kg, exercise, set_number, notes)")
    .order("log_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(60); // recent window scanned client-side, cheap for a personal log
  if (error || !data) return [];
  const out = [];
  for (const sess of data) {
    if (sess.log_date === excludeDate) continue;
    const sets = (sess.workout_sets || [])
      .filter((s) => s.exercise === exercise)
      .sort((a, b) => a.set_number - b.set_number);
    if (sets.length) {
      out.push({ log_date: sess.log_date, sets });
      if (out.length >= limit) break;
    }
  }
  return out;
}

function addExerciseRow() {
  const node = exerciseRowTemplate.content.cloneNode(true);
  const row = node.querySelector(".ex-row");
  const select = row.querySelector(".ex-select");
  const otherInput = row.querySelector(".ex-name-other");
  const goalEl = row.querySelector(".ex-goal");
  const setsContainer = row.querySelector(".ex-sets");
  const loadPrevBtn = row.querySelector(".load-prev-btn");
  const loadPrevSelect = row.querySelector(".load-prev-select");

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

  let prevInstances = [];
  function applyPrevious(i) {
    const inst = prevInstances[i];
    if (!inst) return;
    // Re-nest any drop-tagged rows under the working set that preceded them.
    const groups = [];
    inst.sets.forEach((s) => {
      const isDrop = (s.notes || "").startsWith(DROP_TAG);
      if (isDrop && groups.length) groups[groups.length - 1].drops.push(s);
      else groups.push({ main: s, drops: [] });
    });
    setSetCount(setsContainer, groups.length || 1);
    const rowEls = [...setsContainer.querySelectorAll(".set-row")];
    groups.forEach((g, gi) => {
      const el = rowEls[gi];
      if (!el) return;
      if (g.main.reps != null) el.querySelector(".set-row-main .set-reps").value = g.main.reps;
      if (g.main.weight_kg != null) el.querySelector(".set-row-main .set-weight").value = g.main.weight_kg;
      const dropsContainer = el.querySelector(".drop-sets");
      g.drops.forEach((d) => {
        addDropInput(dropsContainer);
        const dEl = dropsContainer.lastElementChild;
        if (d.reps != null) dEl.querySelector(".set-reps").value = d.reps;
        if (d.weight_kg != null) dEl.querySelector(".set-weight").value = d.weight_kg;
      });
      updateDropBadge(el);
    });
  }
  async function refreshLoadPrevious(exerciseName) {
    if (!exerciseName) {
      loadPrevBtn.hidden = true;
      loadPrevSelect.hidden = true;
      return;
    }
    prevInstances = await fetchPreviousInstances(exerciseName, document.getElementById("s-date").value, 5);
    if (prevInstances.length === 0) {
      loadPrevBtn.hidden = true;
      loadPrevSelect.hidden = true;
      return;
    }
    loadPrevBtn.hidden = false;
    loadPrevBtn.textContent = `↺ Load previous (${prevInstances[0].log_date})`;
    loadPrevSelect.innerHTML = prevInstances
      .map((inst, i) => {
        const summary = inst.sets
          .filter((s) => !(s.notes || "").startsWith(DROP_TAG))
          .map((s) => `${s.weight_kg ?? "?"}×${s.reps ?? "?"}`)
          .join(", ");
        return `<option value="${i}">${inst.log_date} — ${escapeHtml(summary)}</option>`;
      })
      .join("");
    loadPrevSelect.hidden = true; // revealed once "Load previous" has been used at least once
  }
  loadPrevBtn.addEventListener("click", () => {
    applyPrevious(0);
    loadPrevSelect.value = "0";
    if (prevInstances.length > 1) loadPrevSelect.hidden = false;
  });
  loadPrevSelect.addEventListener("change", () => applyPrevious(Number(loadPrevSelect.value)));

  select.addEventListener("change", () => {
    if (select.value === OTHER_VALUE) {
      otherInput.hidden = false;
      otherInput.value = "";
      otherInput.focus();
      goalEl.textContent = "";
      setSetCount(setsContainer, 3);
      loadPrevBtn.hidden = true;
      loadPrevSelect.hidden = true;
      return;
    }
    otherInput.hidden = true;
    const catalogRow = options.find((r) => r.exercise === select.value);
    goalEl.textContent = goalText(catalogRow);
    setSetCount(setsContainer, catalogRow?.target_sets || 3);
    refreshLoadPrevious(select.value);
  });
  otherInput.addEventListener("blur", () => refreshLoadPrevious(otherInput.value.trim()));

  row.querySelector(".add-set").addEventListener("click", () => addSetInput(setsContainer));
  row.querySelector(".remove-btn").addEventListener("click", () => {
    row.remove();
    updateCarouselControls();
  });

  exerciseListEl.appendChild(node);
  updateCarouselControls();
  scrollToExercise(exerciseListEl.querySelectorAll(".ex-row").length - 1);
}

document.getElementById("add-exercise").addEventListener("click", () => addExerciseRow());

// ============================================================ save --------
document.getElementById("s-date").value = todayISO();

function resetLogForm() {
  document.getElementById("s-date").value = todayISO();
  document.getElementById("s-bodyweight").value = "";
  document.getElementById("s-start").value = "";
  document.getElementById("s-end").value = "";
  document.getElementById("log-form").classList.remove("open");
  document.getElementById("category-locked").hidden = true;
  picker.hidden = false;
  selectedCategory = null;
  document.getElementById("session-status").textContent = "";
  document.getElementById("session-status").classList.remove("error");
}

attachStepper(document.getElementById("bodyweight-stepper"), {
  input: document.getElementById("s-bodyweight"), step: 0.5, min: 0, max: 300, decimals: 1,
});

document.getElementById("save-session").addEventListener("click", async () => {
  const statusEl = document.getElementById("session-status");
  const saveBtn = document.getElementById("save-session");
  const log_date = document.getElementById("s-date").value;
  const bodyweight = document.getElementById("s-bodyweight").value;
  const start_time = document.getElementById("s-start").value || null;
  const end_time = document.getElementById("s-end").value || null;

  if (!log_date || !selectedCategory) {
    statusEl.textContent = "Date and category are required.";
    statusEl.classList.add("error");
    return;
  }

  // Collect sets grouped by exercise, each working set followed by any drop
  // sets chained onto it (tagged via DROP_TAG rather than a schema column).
  const exerciseRows = [...exerciseListEl.querySelectorAll(".ex-row")];
  const setsByExercise = {};
  exerciseRows.forEach((row) => {
    const select = row.querySelector(".ex-select");
    const exercise = select.value === OTHER_VALUE
      ? row.querySelector(".ex-name-other").value.trim()
      : select.value.trim();
    if (!exercise) return;
    const comment = row.querySelector(".ex-comment").value.trim() || null;

    const collected = [];
    [...row.querySelectorAll(".ex-sets > .set-row")].forEach((setEl) => {
      const repsVal = setEl.querySelector(".set-row-main .set-reps").value;
      const weightVal = setEl.querySelector(".set-row-main .set-weight").value;
      if (repsVal !== "" || weightVal !== "") {
        collected.push({
          reps: repsVal !== "" ? parseInt(repsVal, 10) : null,
          weight_kg: weightVal !== "" ? parseFloat(weightVal) : null,
          notes: null,
        });
      }
      [...setEl.querySelectorAll(".drop-row")].forEach((dropEl) => {
        const dReps = dropEl.querySelector(".set-reps").value;
        const dWeight = dropEl.querySelector(".set-weight").value;
        if (dReps === "" && dWeight === "") return;
        collected.push({
          reps: dReps !== "" ? parseInt(dReps, 10) : null,
          weight_kg: dWeight !== "" ? parseFloat(dWeight) : null,
          notes: DROP_TAG,
        });
      });
    });
    if (collected.length === 0) return;
    if (comment) collected[0].notes = collected[0].notes ? `${comment} ${collected[0].notes}` : comment;
    (setsByExercise[exercise] || (setsByExercise[exercise] = [])).push(...collected);
  });

  if (Object.keys(setsByExercise).length === 0) {
    statusEl.textContent = "Log at least one set.";
    statusEl.classList.add("error");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  statusEl.classList.remove("error");
  statusEl.textContent = "";

  try {
    // Consolidate into today's existing session for this category, if one's
    // already been saved, instead of creating a second fragment -- so adding
    // "two more exercises" later the same day appends rather than duplicates.
    const { data: existingSessions, error: findErr } = await sb
      .from("workout_sessions")
      .select("id, start_time, end_time")
      .eq("log_date", log_date)
      .eq("category", selectedCategory)
      .limit(1);
    if (findErr) {
      statusEl.textContent = `Error: ${findErr.message}`;
      statusEl.classList.add("error");
      return;
    }

    let sessionId;
    const isConsolidating = !!(existingSessions && existingSessions.length);
    if (isConsolidating) {
      sessionId = existingSessions[0].id;
      const patch = {};
      const existingStart = existingSessions[0].start_time;
      const existingEnd = existingSessions[0].end_time;
      if (start_time && (!existingStart || start_time < existingStart)) patch.start_time = start_time;
      if (end_time && (!existingEnd || end_time > existingEnd)) patch.end_time = end_time;
      if (Object.keys(patch).length) {
        const { error: updErr } = await sb.from("workout_sessions").update(patch).eq("id", sessionId);
        if (updErr) {
          statusEl.textContent = `Error: ${updErr.message}`;
          statusEl.classList.add("error");
          return;
        }
      }
    } else {
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
      sessionId = session.id;
    }

    // Continue set numbering per exercise rather than restarting at 1, so a
    // second entry of the same lift later today doesn't collide with the first.
    let startNumByExercise = {};
    if (isConsolidating) {
      const { data: existingSets } = await sb.from("workout_sets").select("exercise, set_number").eq("session_id", sessionId);
      (existingSets || []).forEach((r) => {
        startNumByExercise[r.exercise] = Math.max(startNumByExercise[r.exercise] || 0, r.set_number);
      });
    }

    const insertRows = [];
    Object.entries(setsByExercise).forEach(([exercise, rows]) => {
      let n = startNumByExercise[exercise] || 0;
      rows.forEach((r) => {
        n++;
        insertRows.push({ exercise, set_number: n, reps: r.reps, weight_kg: r.weight_kg, notes: r.notes, session_id: sessionId });
      });
    });

    const { error: setsErr } = await sb.from("workout_sets").insert(insertRows);
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
    statusEl.textContent = isConsolidating ? "Added to today's workout ✓" : "Saved ✓";
    setTimeout(() => {
      resetLogForm();
      loadConsistency();
      loadRecent();
      loadProgressExerciseOptions();
    }, 700);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save workout";
  }
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

// ============================================================ progress ----
// Comparison chart: pick an exercise, see top weight (and reps at that
// weight) across your last several sessions with it, plus a plain-language
// delta between the two most recent so "is this better than last time" is a
// glance, not a memory exercise.
async function loadProgressExerciseOptions() {
  const sel = document.getElementById("progress-exercise");
  const current = sel.value;
  const { data, error } = await sb.from("workout_sets").select("exercise").limit(3000);
  if (error || !data) return;
  const names = [...new Set(data.map((r) => r.exercise))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">Select exercise…</option>' + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  if (current && names.includes(current)) sel.value = current;
}

async function loadProgressChart(exercise) {
  const emptyEl = document.getElementById("progress-empty");
  const wrapEl = document.getElementById("progress-chart-wrap");
  if (!exercise) {
    emptyEl.hidden = false;
    wrapEl.hidden = true;
    return;
  }

  const { data, error } = await sb
    .from("workout_sessions")
    .select("id, log_date, workout_sets(reps, weight_kg, exercise, set_number)")
    .order("log_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error || !data) {
    emptyEl.hidden = false;
    wrapEl.hidden = true;
    return;
  }

  const points = [];
  for (const sess of data) {
    const sets = (sess.workout_sets || []).filter((s) => s.exercise === exercise && s.weight_kg != null);
    if (!sets.length) continue;
    const topWeight = Math.max(...sets.map((s) => s.weight_kg));
    const bestSet = sets.filter((s) => s.weight_kg === topWeight).sort((a, b) => (b.reps || 0) - (a.reps || 0))[0];
    points.push({ log_date: sess.log_date, topWeight, reps: bestSet?.reps ?? null });
    if (points.length >= 10) break;
  }
  points.reverse(); // chronological order for the chart

  if (points.length === 0) {
    emptyEl.hidden = false;
    wrapEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  wrapEl.hidden = false;

  renderProgressDelta(points);
  renderProgressSvg(points);
}

function renderProgressDelta(points) {
  const el = document.getElementById("progress-delta");
  if (points.length < 2) {
    el.textContent = `${points.length} session logged so far — one more and you'll see a comparison here.`;
    return;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dw = last.topWeight - prev.topWeight;
  const dr = (last.reps ?? 0) - (prev.reps ?? 0);
  const fmt = (n, unit) => (n > 0 ? "+" : "") + (Number.isInteger(n) ? n : n.toFixed(1)) + unit;
  el.innerHTML =
    `Last time (<strong>${escapeHtml(prev.log_date)}</strong>): ${prev.topWeight}kg × ${prev.reps ?? "?"} ` +
    `&nbsp;→&nbsp; This time (<strong>${escapeHtml(last.log_date)}</strong>): ${last.topWeight}kg × ${last.reps ?? "?"} ` +
    `&nbsp; <span class="delta ${dw >= 0 ? "up" : "down"}">${fmt(dw, "kg")}</span> ` +
    `<span class="delta ${dr >= 0 ? "up" : "down"}">${fmt(dr, " reps")}</span>`;
}

function renderProgressSvg(points) {
  const svg = document.getElementById("progress-chart");
  const W = 600, H = 220, PAD_X = 34, PAD_Y = 30;
  const weights = points.map((p) => p.topWeight);
  const minW = Math.min(...weights), maxW = Math.max(...weights);
  const range = maxW - minW || 1;
  const stepX = points.length > 1 ? (W - PAD_X * 2) / (points.length - 1) : 0;
  const yFor = (w) => H - PAD_Y - ((w - minW) / range) * (H - PAD_Y * 2);
  const xFor = (i) => (points.length > 1 ? PAD_X + i * stepX : W / 2);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.topWeight).toFixed(1)}`).join(" ");

  let content = `
    <line x1="${PAD_X}" y1="${H - PAD_Y}" x2="${W - PAD_X}" y2="${H - PAD_Y}" stroke="var(--border)" stroke-width="1" />
    <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
  `;
  points.forEach((p, i) => {
    const x = xFor(i), y = yFor(p.topWeight);
    const isLast = i === points.length - 1;
    content += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isLast ? 5 : 3.5}" fill="var(--accent)" />`;
    content += `<text x="${x.toFixed(1)}" y="${(y - 11).toFixed(1)}" font-size="11" font-weight="${isLast ? 700 : 400}" text-anchor="middle" fill="var(--text)">${p.topWeight}${p.reps != null ? "×" + p.reps : ""}</text>`;
    content += `<text x="${x.toFixed(1)}" y="${H - PAD_Y + 16}" font-size="9" text-anchor="middle" fill="var(--text-dim)">${escapeHtml(p.log_date.slice(5))}</text>`;
  });
  svg.innerHTML = content;
}

document.getElementById("progress-exercise").addEventListener("change", (e) => loadProgressChart(e.target.value));

// ============================================================ init --------
loadConsistency();
loadCatalog();
loadRecent();
loadProgressExerciseOptions();
