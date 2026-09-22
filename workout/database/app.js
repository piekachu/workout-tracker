const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

function localISO(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
const DROP_TAG = "[drop]";

let sessionsByDate = {}; // "YYYY-MM-DD" -> {id, category}
let viewYear, viewMonth; // viewMonth is 0-based
const today = new Date();
viewYear = today.getFullYear();
viewMonth = today.getMonth();

async function loadSessionIndex() {
  const { data, error } = await sb.from("workout_sessions").select("id, log_date, category");
  if (error) return;
  sessionsByDate = {};
  (data || []).forEach((r) => { sessionsByDate[r.log_date] = r; });
  renderCalendar();
  renderLegend();
}

function renderLegend() {
  const el = document.getElementById("cal-legend");
  const items = [
    ["back", "Back"], ["chest", "Chest"], ["shoulder", "Shoulder/Arms"], ["legs", "Legs"], ["whole", "Whole body"],
  ];
  el.innerHTML = items
    .map(([key, label]) => `<span class="legend-item">${categoryIconSvg(key, 14)} ${label}</span>`)
    .join("");
}

function renderCalendar() {
  const label = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  document.getElementById("cal-month-label").textContent = label;

  const grid = document.getElementById("cal-grid");
  grid.innerHTML = "";

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDow = firstOfMonth.getDay(); // 0=Sun
  const gridStart = new Date(viewYear, viewMonth, 1 - startDow);
  const todayStr = localISO(today);

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = localISO(d);
    const session = sessionsByDate[iso];
    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (d.getMonth() !== viewMonth) cell.classList.add("out-of-month");
    if (iso === todayStr) cell.classList.add("today");
    if (session) cell.classList.add("has-session");

    const num = document.createElement("div");
    num.className = "cal-daynum";
    num.textContent = d.getDate();
    cell.appendChild(num);

    if (session) {
      const icons = document.createElement("div");
      icons.className = "cal-icons";
      icons.innerHTML = categoryIconsHtml(session.category, 12);
      cell.appendChild(icons);
      cell.addEventListener("click", () => {
        [...grid.querySelectorAll(".cal-cell.selected")].forEach((c) => c.classList.remove("selected"));
        cell.classList.add("selected");
        showDay(iso, session.id);
      });
    }
    grid.appendChild(cell);
  }
}

document.getElementById("cal-prev").addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
});

let currentDaySessionId = null;

async function showDay(iso, sessionId) {
  currentDaySessionId = sessionId;
  document.getElementById("day-detail-empty").hidden = true;
  const detail = document.getElementById("day-detail");
  detail.hidden = false;

  const { data: session } = await sb
    .from("workout_sessions")
    .select("id, log_date, category, start_time, end_time, workout_sets(exercise, set_number, reps, weight_kg, notes)")
    .eq("id", sessionId)
    .single();
  if (!session) return;

  const timeRange = [session.start_time, session.end_time].filter(Boolean).map((t) => t.slice(0, 5)).join(" – ");
  document.getElementById("day-detail-title").innerHTML =
    `${categoryIconsHtml(session.category, 18)} ${escapeHtml(session.log_date)}${timeRange ? " · " + timeRange : ""}`;

  const byExercise = {};
  (session.workout_sets || []).forEach((s) => {
    (byExercise[s.exercise] || (byExercise[s.exercise] = [])).push(s);
  });

  const body = document.getElementById("day-detail-body");
  body.innerHTML = Object.entries(byExercise)
    .map(([exercise, sets]) => {
      sets.sort((a, b) => a.set_number - b.set_number);
      const setsText = sets
        .map((s) => {
          const isDrop = (s.notes || "").startsWith(DROP_TAG);
          const txt = `${s.weight_kg ?? "?"}kg × ${s.reps ?? "?"}`;
          return isDrop ? `<span class="drop">↳ ${txt}</span>` : txt;
        })
        .join(", ");
      return `<div class="day-ex"><div class="day-ex-name">${escapeHtml(exercise)}</div><div class="day-ex-sets">${setsText}</div></div>`;
    })
    .join("") || '<p class="empty">No sets recorded.</p>';

  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.getElementById("day-delete-btn").addEventListener("click", async () => {
  if (!currentDaySessionId) return;
  if (!confirm("Delete this entire workout? This removes all its exercises and sets.")) return;
  const { error } = await sb.from("workout_sessions").delete().eq("id", currentDaySessionId);
  if (error) { alert(`Couldn't delete: ${error.message}`); return; }
  document.getElementById("day-detail").hidden = true;
  document.getElementById("day-detail-empty").hidden = false;
  currentDaySessionId = null;
  loadSessionIndex();
});

loadSessionIndex();
