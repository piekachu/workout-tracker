const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const GROUPS = ["Back + Biceps", "Chest + Triceps", "Shoulder + Arms", "Legs", "Whole body"];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ============================================================ exercises --
async function loadExerciseCatalog() {
  const { data, error } = await sb.from("exercise_catalog").select("*").order("category").order("sort_order");
  const wrap = document.getElementById("exercise-groups");
  wrap.innerHTML = "";
  if (error) {
    wrap.innerHTML = `<p class="empty">Couldn't load: ${escapeHtml(error.message)}</p>`;
    return;
  }
  const byCategory = {};
  GROUPS.forEach((g) => (byCategory[g] = []));
  (data || []).forEach((row) => (byCategory[row.category] || (byCategory[row.category] = [])).push(row));

  GROUPS.forEach((category) => {
    const group = document.createElement("div");
    group.className = "ex-group";
    group.innerHTML = `<h3>${escapeHtml(category)}</h3>
      <div class="ex-catalog-head"><span>Exercise</span><span>Sets</span><span>Reps</span><span>Weight</span><span></span></div>
      <div class="ex-rows"></div>
      <div class="ex-add-row">
        <input type="text" class="ex-add-name" placeholder="Add exercise…" />
        <button type="button" class="link-btn small ex-add-btn">+ Add</button>
      </div>`;
    const rowsEl = group.querySelector(".ex-rows");

    byCategory[category].forEach((row) => rowsEl.appendChild(catalogRowEl(row)));

    group.querySelector(".ex-add-btn").addEventListener("click", async () => {
      const input = group.querySelector(".ex-add-name");
      const name = input.value.trim();
      if (!name) return;
      const { data: inserted, error: insErr } = await sb
        .from("exercise_catalog")
        .insert({ category, exercise: name, target_sets: 3, sort_order: byCategory[category].length })
        .select()
        .single();
      if (insErr) { alert(`Couldn't add: ${insErr.message}`); return; }
      rowsEl.appendChild(catalogRowEl(inserted));
      byCategory[category].push(inserted);
      input.value = "";
    });

    wrap.appendChild(group);
  });
}

function catalogRowEl(row) {
  const el = document.createElement("div");
  el.className = "ex-catalog-row";
  el.innerHTML = `
    <input type="text" class="c-name" value="${escapeHtml(row.exercise)}" />
    <input type="number" class="c-sets" value="${row.target_sets ?? ""}" min="0" max="20" />
    <input type="number" class="c-reps" value="${row.target_reps ?? ""}" min="0" max="99" />
    <input type="number" class="c-weight" value="${row.target_weight ?? ""}" min="0" max="500" step="0.5" />
    <button type="button" class="ex-row-del" title="Delete">✕</button>
  `;
  const save = async (patch) => {
    const { error } = await sb.from("exercise_catalog").update(patch).eq("id", row.id);
    if (error) alert(`Couldn't save: ${error.message}`);
  };
  el.querySelector(".c-name").addEventListener("change", (e) => save({ exercise: e.target.value.trim() }));
  el.querySelector(".c-sets").addEventListener("change", (e) => save({ target_sets: e.target.value === "" ? null : parseInt(e.target.value, 10) }));
  el.querySelector(".c-reps").addEventListener("change", (e) => save({ target_reps: e.target.value === "" ? null : parseInt(e.target.value, 10) }));
  el.querySelector(".c-weight").addEventListener("change", (e) => save({ target_weight: e.target.value === "" ? null : parseFloat(e.target.value) }));
  el.querySelector(".ex-row-del").addEventListener("click", async () => {
    if (!confirm(`Remove "${row.exercise}" from the catalog? This doesn't touch anything you've already logged.`)) return;
    const { error } = await sb.from("exercise_catalog").delete().eq("id", row.id);
    if (error) { alert(`Couldn't delete: ${error.message}`); return; }
    el.remove();
  });
  return el;
}

// ============================================================ routines ---
const MIGRATION_SQL = `create table if not exists workout_routines (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null,
  exercises jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists workout_routines_category_idx on workout_routines (category);
alter table workout_routines enable row level security;
create policy "anon full access" on workout_routines
  for all to anon using (true) with check (true);`;
document.getElementById("migration-sql").textContent = MIGRATION_SQL;
document.getElementById("copy-migration-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(MIGRATION_SQL);
    const btn = document.getElementById("copy-migration-btn");
    const orig = btn.textContent;
    btn.textContent = "Copied ✓";
    setTimeout(() => (btn.textContent = orig), 1500);
  } catch { /* clipboard permission denied -- SQL is still selectable in the <pre> */ }
});
document.getElementById("retry-routines-btn").addEventListener("click", loadRoutines);

let catalogByCategory = {}; // for the routine editor's exercise checklist
async function ensureCatalogLoaded() {
  if (Object.keys(catalogByCategory).length) return;
  const { data } = await sb.from("exercise_catalog").select("*").order("sort_order");
  catalogByCategory = {};
  GROUPS.forEach((g) => (catalogByCategory[g] = []));
  (data || []).forEach((row) => (catalogByCategory[row.category] || (catalogByCategory[row.category] = [])).push(row));
}

let routinesCache = [];
async function loadRoutines() {
  const { data, error } = await sb.from("workout_routines").select("*").order("category").order("sort_order");
  const missingEl = document.getElementById("routines-missing");
  const contentEl = document.getElementById("routines-content");
  if (error) {
    // 42P01 = undefined_table -- the migration hasn't been run yet.
    missingEl.hidden = false;
    contentEl.hidden = true;
    return;
  }
  missingEl.hidden = true;
  contentEl.hidden = false;
  routinesCache = data || [];
  renderRoutinesList();
}

function renderRoutinesList() {
  const list = document.getElementById("routines-list");
  if (routinesCache.length === 0) {
    list.innerHTML = '<p class="empty">No routines saved yet.</p>';
    return;
  }
  list.innerHTML = "";
  routinesCache.forEach((r) => {
    const card = document.createElement("div");
    card.className = "routine-card";
    card.innerHTML = `
      <div>
        <div class="rc-name">${escapeHtml(r.name)}</div>
        <div class="rc-meta">${escapeHtml(r.category)} · ${(r.exercises || []).length} exercises</div>
      </div>
      <div class="rc-actions">
        <button type="button" class="ex-row-del" title="Delete">✕</button>
      </div>
    `;
    card.querySelector(".ex-row-del").addEventListener("click", async () => {
      if (!confirm(`Delete routine "${r.name}"?`)) return;
      const { error } = await sb.from("workout_routines").delete().eq("id", r.id);
      if (error) { alert(`Couldn't delete: ${error.message}`); return; }
      routinesCache = routinesCache.filter((x) => x.id !== r.id);
      renderRoutinesList();
    });
    list.appendChild(card);
  });
}

const reCategorySel = document.getElementById("re-category");
GROUPS.forEach((g) => reCategorySel.appendChild(new Option(g, g)));

function renderRoutineExerciseChecklist() {
  const category = reCategorySel.value;
  const wrap = document.getElementById("re-exercise-list");
  wrap.innerHTML = "";
  (catalogByCategory[category] || []).forEach((ex) => {
    const row = document.createElement("div");
    row.className = "re-ex-row";
    row.innerHTML = `
      <label><input type="checkbox" class="re-check" data-exercise="${escapeHtml(ex.exercise)}" /> ${escapeHtml(ex.exercise)}</label>
      <input type="number" class="re-sets" value="${ex.target_sets || 3}" min="1" max="20" disabled />
      <span class="re-sets-label">sets</span>
    `;
    const check = row.querySelector(".re-check");
    const setsInput = row.querySelector(".re-sets");
    check.addEventListener("change", () => { setsInput.disabled = !check.checked; });
    wrap.appendChild(row);
  });
  if (!(catalogByCategory[category] || []).length) {
    wrap.innerHTML = '<p class="empty">No exercises in this category yet — add some above first.</p>';
  }
}
reCategorySel.addEventListener("change", renderRoutineExerciseChecklist);

document.getElementById("new-routine-btn").addEventListener("click", async () => {
  await ensureCatalogLoaded();
  document.getElementById("re-name").value = "";
  document.getElementById("re-status").textContent = "";
  renderRoutineExerciseChecklist();
  document.getElementById("routine-editor").hidden = false;
  document.getElementById("routine-editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
});
document.getElementById("re-cancel-btn").addEventListener("click", () => {
  document.getElementById("routine-editor").hidden = true;
});
document.getElementById("re-save-btn").addEventListener("click", async () => {
  const name = document.getElementById("re-name").value.trim();
  const category = reCategorySel.value;
  const statusEl = document.getElementById("re-status");
  if (!name) { statusEl.textContent = "Name it first."; return; }

  const exercises = [...document.querySelectorAll(".re-ex-row")]
    .filter((row) => row.querySelector(".re-check").checked)
    .map((row) => ({
      exercise: row.querySelector(".re-check").dataset.exercise,
      target_sets: parseInt(row.querySelector(".re-sets").value, 10) || 1,
    }));
  if (exercises.length === 0) { statusEl.textContent = "Pick at least one exercise."; return; }

  const { data, error } = await sb
    .from("workout_routines")
    .insert({ name, category, exercises, sort_order: routinesCache.length })
    .select()
    .single();
  if (error) { statusEl.textContent = `Error: ${error.message}`; return; }
  routinesCache.push(data);
  renderRoutinesList();
  document.getElementById("routine-editor").hidden = true;
});

// ============================================================ init -------
loadExerciseCatalog();
loadRoutines();
