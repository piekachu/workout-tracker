const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const { data: grpRows } = await sb.from("workout_sets").select("muscle_group").not("muscle_group", "is", null);

  const exercises = [...new Set((exRows || []).map((r) => r.exercise))].sort();
  const groups = [...new Set((grpRows || []).map((r) => r.muscle_group))].sort();

  const exList = document.getElementById("exercises");
  exList.innerHTML = exercises.map((e) => `<option value="${escapeHtml(e)}">`).join("");

  const grpList = document.getElementById("muscle-groups");
  grpList.innerHTML = groups.map((g) => `<option value="${escapeHtml(g)}">`).join("");

  const progressSelect = document.getElementById("progress-exercise");
  progressSelect.innerHTML = exercises.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ------------------------------------------------------------- log form ---
document.getElementById("set-form").querySelector('[name="log_date"]').value = todayISO();
document.getElementById("bw-date").value = todayISO();

document.getElementById("save-set").addEventListener("click", async () => {
  const form = document.getElementById("set-form");
  const fd = new FormData(form);
  const statusEl = document.getElementById("set-status");

  const row = {
    log_date: fd.get("log_date"),
    muscle_group: fd.get("muscle_group") || null,
    exercise: fd.get("exercise"),
    set_number: fd.get("set_number") ? parseInt(fd.get("set_number"), 10) : 1,
    reps: fd.get("reps") ? parseInt(fd.get("reps"), 10) : null,
    weight_kg: fd.get("weight_kg") ? parseFloat(fd.get("weight_kg")) : null,
    rpe: fd.get("rpe") || null,
    notes: fd.get("notes") || null,
  };

  if (!row.log_date || !row.exercise) {
    statusEl.textContent = "Date and exercise are required.";
    statusEl.classList.add("error");
    return;
  }

  const { error } = await sb.from("workout_sets").insert(row);
  if (error) {
    statusEl.textContent = `Error: ${error.message}`;
    statusEl.classList.add("error");
    return;
  }
  statusEl.classList.remove("error");
  statusEl.textContent = "Saved ✓";
  const nextSet = row.set_number + 1;
  form.querySelector('[name="set_number"]').value = nextSet;
  form.querySelector('[name="reps"]').value = "";
  form.querySelector('[name="weight_kg"]').value = "";
  form.querySelector('[name="notes"]').value = "";
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
const PAGE_SIZE = 50;
let historyOffset = 0;

function currentFilters() {
  return {
    from: document.getElementById("f-from").value || null,
    to: document.getElementById("f-to").value || null,
    group: document.getElementById("f-group").value.trim() || null,
    exercise: document.getElementById("f-exercise").value.trim() || null,
  };
}

async function loadHistory(reset) {
  if (reset) {
    historyOffset = 0;
    document.querySelector("#sets-table tbody").innerHTML = "";
  }
  const f = currentFilters();
  let q = sb.from("workout_sets").select("*").order("log_date", { ascending: false }).order("set_number", { ascending: true });
  if (f.from) q = q.gte("log_date", f.from);
  if (f.to) q = q.lte("log_date", f.to);
  if (f.group) q = q.eq("muscle_group", f.group);
  if (f.exercise) q = q.ilike("exercise", `%${f.exercise}%`);
  q = q.range(historyOffset, historyOffset + PAGE_SIZE - 1);

  const { data, error } = await q;
  if (error) {
    console.error(error);
    return;
  }
  const tbody = document.querySelector("#sets-table tbody");
  data.forEach((row) => tbody.appendChild(setRowEl(row)));
  historyOffset += data.length;
  document.getElementById("sets-empty").style.display = (tbody.children.length === 0) ? "block" : "none";
  document.getElementById("load-more-sets").style.display = data.length < PAGE_SIZE ? "none" : "inline-block";

  if (reset) loadBodyWeightTable();
}

function setRowEl(row) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${row.log_date}</td>
    <td>${escapeHtml(row.muscle_group || "")}</td>
    <td>${escapeHtml(row.exercise)}</td>
    <td>${row.set_number ?? ""}</td>
    <td>${row.reps ?? escapeHtml(row.reps_raw || "")}</td>
    <td>${row.weight_kg ?? ""}</td>
    <td>${escapeHtml(row.rpe || "")}</td>
    <td class="notes-cell">${escapeHtml(row.notes || "")}</td>
    <td><button class="btn danger small" data-id="${row.id}">Delete</button></td>
  `;
  tr.querySelector("button").addEventListener("click", async (e) => {
    if (!confirm("Delete this set?")) return;
    const id = e.target.dataset.id;
    const { error } = await sb.from("workout_sets").delete().eq("id", id);
    if (!error) tr.remove();
  });
  return tr;
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
  document.getElementById("f-group").value = "";
  document.getElementById("f-exercise").value = "";
  loadHistory(true);
});
document.getElementById("load-more-sets").addEventListener("click", () => loadHistory(false));

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
    .select("log_date, reps, weight_kg")
    .eq("exercise", exercise)
    .order("log_date", { ascending: true });
  if (error || !data) return;

  const bySession = {};
  data.forEach((r) => {
    if (!bySession[r.log_date]) bySession[r.log_date] = [];
    bySession[r.log_date].push(r);
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
    // volume = sum(reps * weight)
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
