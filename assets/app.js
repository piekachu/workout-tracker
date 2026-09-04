const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const todayISO = () => new Date().toISOString().slice(0, 10);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------- tabs ----
document.querySelectorAll("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "history") loadHistory(true);
    if (btn.dataset.tab === "progress") loadProgress();
  });
});

// ------------------------------------------------------------- datalists --
async function loadDistinctLists() {
  const { data: exRows } = await sb.from("workout_sets").select("exercise").not("exercise", "is", null);
  const { data: catRows } = await sb.from("workout_sessions").select("category").not("category", "is", null);

  const exercises = [...new Set((exRows || []).map((r) => r.exercise))].sort();
  const categories = [...new Set((catRows || []).map((r) => r.category))].sort();

  document.getElementById("exercises").innerHTML = exercises.map((e) => `<option value="${escapeHtml(e)}">`).join("");
  document.getElementById("categories").innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}">`).join("");

  const progressSelect = document.getElementById("progress-exercise");
  const prev = progressSelect.value;
  progressSelect.innerHTML = exercises.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");
  if (exercises.includes(prev)) progressSelect.value = prev;
}

// ------------------------------------------------------------- log form ---
document.getElementById("s-date").value = todayISO();
document.getElementById("bw-date").value = todayISO();

const exerciseRowsEl = document.getElementById("exercise-rows");
const exerciseRowTemplate = document.getElementById("exercise-row-template");

function addExerciseRow() {
  const node = exerciseRowTemplate.content.cloneNode(true);
  node.querySelector(".remove-exercise-row").addEventListener("click", (e) => {
    e.target.closest(".exercise-row").remove();
  });
  exerciseRowsEl.appendChild(node);
}
document.getElementById("add-exercise-row").addEventListener("click", addExerciseRow);
addExerciseRow(); // start with one row

function resetSessionForm() {
  document.getElementById("s-date").value = todayISO();
  document.getElementById("s-category").value = "";
  document.getElementById("s-start").value = "";
  document.getElementById("s-end").value = "";
  exerciseRowsEl.innerHTML = "";
  addExerciseRow();
  document.getElementById("session-status").textContent = "";
  document.getElementById("session-status").classList.remove("error");
}
document.getElementById("reset-session").addEventListener("click", resetSessionForm);

document.getElementById("save-session").addEventListener("click", async () => {
  const statusEl = document.getElementById("session-status");
  const log_date = document.getElementById("s-date").value;
  const category = document.getElementById("s-category").value.trim() || null;
  const start_time = document.getElementById("s-start").value || null;
  const end_time = document.getElementById("s-end").value || null;

  if (!log_date) {
    statusEl.textContent = "Date is required.";
    statusEl.classList.add("error");
    return;
  }

  const exerciseRows = [...exerciseRowsEl.querySelectorAll(".exercise-row")];
  const entries = exerciseRows.map((row) => ({
    exercise: row.querySelector(".ex-name").value.trim(),
    sets: parseInt(row.querySelector(".ex-sets").value, 10) || 0,
    reps: row.querySelector(".ex-reps").value ? parseInt(row.querySelector(".ex-reps").value, 10) : null,
    weight_kg: row.querySelector(".ex-weight").value ? parseFloat(row.querySelector(".ex-weight").value) : null,
    rpe: row.querySelector(".ex-rpe").value.trim() || null,
  })).filter((e) => e.exercise && e.sets > 0);

  if (entries.length === 0) {
    statusEl.textContent = "Add at least one exercise (name + sets).";
    statusEl.classList.add("error");
    return;
  }

  const { data: session, error: sessErr } = await sb
    .from("workout_sessions")
    .insert({ log_date, category, start_time, end_time })
    .select()
    .single();

  if (sessErr) {
    statusEl.textContent = `Error: ${sessErr.message}`;
    statusEl.classList.add("error");
    return;
  }

  const setRows = [];
  entries.forEach((e) => {
    for (let i = 1; i <= e.sets; i++) {
      setRows.push({
        session_id: session.id,
        exercise: e.exercise,
        set_number: i,
        reps: e.reps,
        weight_kg: e.weight_kg,
        rpe: e.rpe,
      });
    }
  });

  const { error: setsErr } = await sb.from("workout_sets").insert(setRows);
  if (setsErr) {
    statusEl.textContent = `Session saved, but sets failed: ${setsErr.message}`;
    statusEl.classList.add("error");
    return;
  }

  statusEl.classList.remove("error");
  statusEl.textContent = "Saved ✓";
  resetSessionForm();
  loadDistinctLists();
});

document.getElementById("save-bw").addEventListener("click", async () => {
  const statusEl = document.getElementById("bw-status");
  const log_date = document.getElementById("bw-date").value;
  const weight_kg = parseFloat(document.getElementById("bw-weight").value);
  if (!log_date || Number.isNaN(weight_kg)) {
    statusEl.textContent = "Date and weight are required.";
    statusEl.classList.add("error");
    return;
  }
  const { error } = await sb.from("body_weight").upsert({ log_date, weight_kg }, { onConflict: "log_date" });
  if (error) {
    statusEl.textContent = `Error: ${error.message}`;
    statusEl.classList.add("error");
    return;
  }
  statusEl.classList.remove("error");
  statusEl.textContent = "Saved ✓";
  document.getElementById("bw-weight").value = "";
});

// -------------------------------------------------------------- history ---
const PAGE_SIZE = 20;
let historyOffset = 0;

function currentFilters() {
  return {
    from: document.getElementById("f-from").value || null,
    to: document.getElementById("f-to").value || null,
    category: document.getElementById("f-category").value.trim() || null,
    exercise: document.getElementById("f-exercise").value.trim() || null,
  };
}

async function loadHistory(reset) {
  if (reset) {
    historyOffset = 0;
    document.getElementById("sessions-list").innerHTML = "";
  }
  const f = currentFilters();

  let q = sb
    .from("workout_sessions")
    .select("*, workout_sets(*)")
    .order("log_date", { ascending: false })
    .order("id", { ascending: false });
  if (f.from) q = q.gte("log_date", f.from);
  if (f.to) q = q.lte("log_date", f.to);
  if (f.category) q = q.eq("category", f.category);
  if (f.exercise) q = q.ilike("workout_sets.exercise", `%${f.exercise}%`);
  q = q.range(historyOffset, historyOffset + PAGE_SIZE - 1);

  const { data, error } = await q;
  if (error) {
    console.error(error);
    return;
  }

  let sessions = data;
  if (f.exercise) sessions = sessions.filter((s) => (s.workout_sets || []).length > 0);

  const list = document.getElementById("sessions-list");
  sessions.forEach((s) => list.appendChild(sessionCardEl(s)));
  historyOffset += data.length;

  document.getElementById("sessions-empty").style.display = (list.children.length === 0) ? "block" : "none";
  document.getElementById("load-more-sessions").style.display = data.length < PAGE_SIZE ? "none" : "inline-block";

  if (reset) loadBodyWeightTable();
}

function sessionCardEl(session) {
  const card = document.createElement("div");
  card.className = "card session-card";

  const timeRange = [session.start_time, session.end_time].filter(Boolean).map((t) => t.slice(0, 5)).join(" – ");

  // group sets by exercise, preserving first-seen order
  const byExercise = new Map();
  (session.workout_sets || [])
    .sort((a, b) => a.set_number - b.set_number)
    .forEach((row) => {
      if (!byExercise.has(row.exercise)) byExercise.set(row.exercise, []);
      byExercise.get(row.exercise).push(row);
    });

  const exerciseHtml = [...byExercise.entries()].map(([exercise, rows]) => {
    const setsHtml = rows.map((r) => {
      const reps = r.reps ?? escapeHtml(r.reps_raw || "?");
      const weight = r.weight_kg != null ? `${r.weight_kg}kg` : "";
      return `<span class="set-chip">${reps}${weight ? " × " + weight : ""}</span>`;
    }).join("");
    return `<div class="exercise-line"><strong>${escapeHtml(exercise)}</strong><div class="set-chips">${setsHtml}</div></div>`;
  }).join("");

  card.innerHTML = `
    <div class="session-head">
      <div>
        <span class="session-date">${session.log_date}</span>
        ${session.category ? `<span class="badge">${escapeHtml(session.category)}</span>` : ""}
        ${timeRange ? `<span class="session-time">${timeRange}</span>` : ""}
      </div>
      <button class="btn danger small" data-action="delete-session">Delete</button>
    </div>
    <div class="session-body">${exerciseHtml || '<span class="empty">No exercises.</span>'}</div>
  `;
  card.querySelector('[data-action="delete-session"]').addEventListener("click", async () => {
    if (!confirm("Delete this whole session (and its sets)?")) return;
    const { error } = await sb.from("workout_sessions").delete().eq("id", session.id);
    if (!error) card.remove();
  });
  return card;
}

async function loadBodyWeightTable() {
  const { data, error } = await sb.from("body_weight").select("*").order("log_date", { ascending: false }).limit(100);
  if (error) return;
  const tbody = document.querySelector("#bw-table tbody");
  tbody.innerHTML = "";
  data.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.log_date}</td><td>${row.weight_kg}</td><td><button class="btn danger small">Delete</button></td>`;
    tr.querySelector("button").addEventListener("click", async () => {
      if (!confirm("Delete this entry?")) return;
      const { error: delErr } = await sb.from("body_weight").delete().eq("id", row.id);
      if (!delErr) tr.remove();
    });
    tbody.appendChild(tr);
  });
}

document.getElementById("apply-filters").addEventListener("click", () => loadHistory(true));
document.getElementById("clear-filters").addEventListener("click", () => {
  document.getElementById("f-from").value = "";
  document.getElementById("f-to").value = "";
  document.getElementById("f-category").value = "";
  document.getElementById("f-exercise").value = "";
  loadHistory(true);
});
document.getElementById("load-more-sessions").addEventListener("click", () => loadHistory(false));

// -------------------------------------------------------------- progress --
let bwChart, exerciseChart;

async function loadProgress() {
  const { data: bwData } = await sb.from("body_weight").select("*").order("log_date", { ascending: true });
  const ctx = document.getElementById("bw-chart");
  if (bwChart) bwChart.destroy();
  bwChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: (bwData || []).map((r) => r.log_date),
      datasets: [{
        label: "Body weight (kg)",
        data: (bwData || []).map((r) => r.weight_kg),
        borderColor: "#5fa8ff",
        backgroundColor: "#5fa8ff33",
        tension: 0.25,
        fill: true,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  await loadDistinctLists();
  renderExerciseChart();
}

document.getElementById("progress-exercise").addEventListener("change", renderExerciseChart);
document.getElementById("progress-metric").addEventListener("change", renderExerciseChart);

async function renderExerciseChart() {
  const exercise = document.getElementById("progress-exercise").value;
  const metric = document.getElementById("progress-metric").value;
  if (!exercise) return;

  const { data, error } = await sb
    .from("workout_sets")
    .select("reps, weight_kg, workout_sessions(log_date)")
    .eq("exercise", exercise);
  if (error || !data) return;

  const bySession = {};
  data.forEach((r) => {
    const d = r.workout_sessions?.log_date;
    if (!d) return;
    if (!bySession[d]) bySession[d] = [];
    bySession[d].push(r);
  });

  const labels = Object.keys(bySession).sort();
  const values = labels.map((d) => {
    const sets = bySession[d];
    if (metric === "max_weight") {
      return Math.max(...sets.map((s) => s.weight_kg ?? 0));
    }
    if (metric === "max_reps") {
      return Math.max(...sets.map((s) => s.reps ?? 0));
    }
    return sets.reduce((sum, s) => sum + (s.reps ?? 0) * (s.weight_kg ?? 0), 0);
  });

  const ctx = document.getElementById("exercise-chart");
  if (exerciseChart) exerciseChart.destroy();
  exerciseChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `${exercise} — ${metric.replace("_", " ")}`,
        data: values,
        borderColor: "#7ee8b7",
        backgroundColor: "#7ee8b733",
        tension: 0.25,
        fill: true,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

// -------------------------------------------------------------- init ------
loadDistinctLists();
