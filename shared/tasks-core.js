// Date maths and repeat logic shared by /tasks/ and the Today screen.
// Dates are local-time "YYYY-MM-DD" strings, never UTC (toISOString and
// new Date("YYYY-MM-DD") drift a day in Asia/Seoul around midnight).
window.TasksCore = (function () {
  const pad = (n) => String(n).padStart(2, "0");
  const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return localISO(d); };
  const firstOf = (iso) => iso.slice(0, 8) + "01";
  const addMonths = (iso, n) => { const d = parse(iso); return localISO(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
  const weekStart = (iso) => addDays(iso, -parse(iso).getDay());   // weeks run Sunday to Saturday
  const periodStart = (horizon, iso) => (horizon === "week" ? weekStart(iso) : horizon === "month" ? firstOf(iso) : iso);

  // Where a repeating task lands next, anchored to its own horizon.
  function nextPeriod(t) {
    let next = t.recur === "daily" ? addDays(t.period_start, 1)
      : t.recur === "weekly" ? addDays(t.period_start, 7)
      : addMonths(firstOf(t.period_start), 1);
    if (t.recur === "monthly" && t.horizon === "day") {
      const d = parse(t.period_start), target = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      next = localISO(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)));
    }
    next = periodStart(t.horizon, next);
    // a week task set to repeat daily would land in the same week: step a whole period instead
    if (next === t.period_start) next = periodStart(t.horizon, t.horizon === "week" ? addDays(next, 7) : addMonths(next, 1));
    return next;
  }

  // Insert the next occurrence of a just-completed repeating task. Resolves to
  // the new row, or null when it already exists or the insert failed.
  async function spawnNext(sb, t, existing) {
    const next = nextPeriod(t);
    if (existing.some((x) => x.title === t.title && x.horizon === t.horizon && x.period_start === next && x.recur === t.recur)) return null;
    const row = { title: t.title, notes: t.notes, horizon: t.horizon, period_start: next, start_time: t.start_time,
      end_time: t.end_time, priority: t.priority, recur: t.recur };
    const { data, error } = await sb.from("tasks").insert(row).select().single();
    return error ? null : data;
  }

  return { pad, localISO, parse, addDays, firstOf, addMonths, weekStart, periodStart, nextPeriod, spawnNext };
})();
