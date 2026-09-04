#!/usr/bin/env python3
"""
Best-effort parser for the messy workout-log CSV exports, organized into
day/category *sessions* (workout_sessions) each holding a set of exercise
sets (workout_sets), matching how the source spreadsheets actually recorded
things (a block of columns = one category's log across many days).

Input:
  data/Workout Tracker - Body Mass.csv   (clean: date, weight)
  data/Workout Tracker - 26 Jan-Apr.csv  (side-by-side blocks per muscle group,
                                           each with its own Date/Exercise/Set1-4/Weight/RPE header)
  data/Workout Tracker - 26 Jun.csv      (free-form side-by-side blocks, no headers,
                                           cells mix "sets/reps/weight" scheme notes and
                                           actual per-set "reps/weight" results)

Output (in out/):
  body_weight.csv        -- log_date, weight_kg
  workout_sessions.csv   -- session_key, log_date, category, start_time, end_time, notes
  workout_sets.csv       -- session_key, exercise, exercise_raw, set_number, reps, reps_raw,
                             weight_kg, weight_raw, rpe, notes
  needs_review.csv       -- subset of workout_sets rows where nothing numeric could be
                             extracted (kept in workout_sets too -- nothing is dropped,
                             this is just a visibility list)

Key behaviors:
  - Exercise names are canonicalized via scripts/exercise_aliases.py (merges
    typo/notation variants like "Pull ups"/"Pull-ups"/"N-grip Pull ups").
  - "sets/reps/weight" triplets like "2/12/40" embedded in a cell or exercise
    name are treated as real prescribed data: when no more-granular explicit
    per-set values exist for that exercise entry, they expand into that many
    actual set rows (2 sets @ 12 reps @ 40kg) instead of being dropped as a note.
  - Stray 3-4 digit numbers that show up in date cells (e.g. "1450", "1906")
    are recovered as HH:MM timestamps and used to derive each session's
    start_time/end_time (min/max across its rows) where available.
  - Weekly-tally rows like "Back/8" or "S/6 + Bi/6 + Tri/4" are filtered out.
"""
import csv
import re
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exercise_aliases import canonicalize, is_junk_label

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "june": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
DATE_RE = re.compile(r'^([A-Za-z]{3,4})\.?\s*(\d{1,2})$')
YEAR = 2026  # both sheets are titled "26" (2026) and span Jan-Jun


def parse_date_cell(cell):
    if not cell:
        return None
    m = DATE_RE.match(cell.strip())
    if not m:
        return None
    mon = MONTHS.get(m.group(1).lower())
    if not mon:
        return None
    day = int(m.group(2))
    try:
        return datetime(YEAR, mon, day).date().isoformat()
    except ValueError:
        return None


TIME_RE = re.compile(r'^\d{3,4}$')


def parse_time_token(cell):
    """Recover a stray 'HHMM' token (e.g. '1450', '845') as 'HH:MM:00'."""
    c = (cell or "").strip()
    if not TIME_RE.match(c):
        return None
    c4 = c.zfill(4)
    h, m = int(c4[:2]), int(c4[2:])
    if 0 <= h <= 23 and 0 <= m <= 59:
        return f"{h:02d}:{m:02d}:00"
    return None


NUM_RE = r'[-+]?\d+(?:\.\d+)?'


def parse_number(s):
    s = s.strip().lower().replace("kgs", "").replace("kg", "").replace("ea", "").strip()
    m = re.fullmatch(NUM_RE, s)
    return float(m.group(0)) if m else None


def parse_set_cell(raw):
    """Parse one 'set' cell into (reps, weight_kg); always keeps raw text."""
    raw = (raw or "").strip()
    if not raw or "+" in raw:
        return None, None, raw
    parts = raw.split("/")
    if len(parts) == 1:
        n = parse_number(parts[0])
        return (int(n) if n is not None and n.is_integer() else None), None, raw
    if len(parts) == 2:
        reps = parse_number(parts[0])
        weight = parse_number(parts[1])
        reps_i = int(reps) if reps is not None and reps.is_integer() else None
        return reps_i, weight, raw
    return None, None, raw


SCHEME_RE = re.compile(rf'(\d+)/([\w.]+)/([\w.]+)')


def find_scheme(text):
    """Find a 'sets/reps/weight' triplet anywhere in text, e.g. '2/12/40' or
    '3/f/25'. Returns (n_sets, reps_or_None, weight_or_None, matched_text) or None."""
    if not text:
        return None
    m = SCHEME_RE.search(text)
    if not m:
        return None
    try:
        n_sets = int(float(m.group(1)))
    except ValueError:
        return None
    if not (1 <= n_sets <= 10):
        return None
    reps = parse_number(m.group(2))
    reps_i = int(reps) if reps is not None and reps.is_integer() else None
    weight = parse_number(m.group(3))
    return n_sets, reps_i, weight, m.group(0)


def looks_like_scheme(cell):
    c = (cell or "").strip()
    return bool(re.fullmatch(rf'{NUM_RE}/[\w?f]+/{NUM_RE}', c, re.I)) or bool(re.fullmatch(r'x\d+', c, re.I))


def read_grid(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [row for row in csv.reader(f)]


# ---------------------------------------------------------------------------
# Body Mass
# ---------------------------------------------------------------------------
def parse_body_mass():
    grid = read_grid(DATA / "Workout Tracker - Body Mass.csv")
    rows = []
    for r in grid:
        if len(r) < 3:
            continue
        d = parse_date_cell(r[1])
        w = parse_number(r[2]) if len(r) > 2 else None
        if d and w is not None:
            rows.append({"log_date": d, "weight_kg": w})
    return rows


# ---------------------------------------------------------------------------
# Session builder shared by both sheets
# ---------------------------------------------------------------------------
_session_counter = 0


def new_session(log_date, category):
    global _session_counter
    _session_counter += 1
    return {
        "session_key": _session_counter,
        "log_date": log_date,
        "category": category,
        "time_tokens": [],
        "sets": [],  # list of dicts (exercise, exercise_raw, set_number, reps, reps_raw, weight_kg, weight_raw, rpe, notes)
        "cat_hints": [],  # canonicalize() category hints, used when category is None (Jun sheet)
    }


def add_sets_for_exercise(session, exercise_raw, explicit_sets, weight_fallback, weight_raw_fallback, rpe, plan_cell_text):
    """explicit_sets: list of (reps, weight, raw_text) already parsed from Set1-4-style cells.
    plan_cell_text: an explicit Plan/scheme cell's text, if any (e.g. a dedicated 'Plan' column,
    or Jun's leading scheme cell). A 'sets/reps/weight' triplet is also searched for directly in
    exercise_raw (schemes are often baked into the exercise name, e.g. 'T-bar rows 4/10/25')."""
    canon, cat_hint = canonicalize(exercise_raw)
    exercise = canon or re.sub(r'\s+', ' ', exercise_raw).strip()
    if cat_hint:
        session["cat_hints"].append(cat_hint)

    scheme = find_scheme(plan_cell_text) if plan_cell_text else None
    if not scheme:
        scheme = find_scheme(exercise_raw)
    plan_note = f"Plan: {scheme[3]}" if scheme else None

    rows = []
    if explicit_sets:
        for i, (reps, weight, raw_text) in enumerate(explicit_sets, start=1):
            rows.append({
                "exercise": exercise, "exercise_raw": exercise_raw, "set_number": i,
                "reps": reps, "reps_raw": raw_text,
                "weight_kg": weight if weight is not None else weight_fallback,
                "weight_raw": weight_raw_fallback or "",
                "rpe": rpe or "", "notes": plan_note if i == 1 and plan_note else "",
            })
    elif scheme:
        n_sets, reps, weight, matched = scheme
        for i in range(1, n_sets + 1):
            rows.append({
                "exercise": exercise, "exercise_raw": exercise_raw, "set_number": i,
                "reps": reps, "reps_raw": f"{matched} (planned)",
                "weight_kg": weight if weight is not None else weight_fallback,
                "weight_raw": weight_raw_fallback or "",
                "rpe": rpe or "", "notes": f"Derived from plan: {matched}" if i == 1 else "",
            })
    else:
        rows.append({
            "exercise": exercise, "exercise_raw": exercise_raw, "set_number": 1,
            "reps": None, "reps_raw": "",
            "weight_kg": weight_fallback, "weight_raw": weight_raw_fallback or "",
            "rpe": rpe or "", "notes": plan_note or "",
        })
    session["sets"].extend(rows)


def finalize_session(session):
    if session["time_tokens"]:
        session["start_time"] = min(session["time_tokens"])
        session["end_time"] = max(session["time_tokens"])
        if session["start_time"] == session["end_time"]:
            session["end_time"] = None
    else:
        session["start_time"] = None
        session["end_time"] = None
    if not session["category"] and session["cat_hints"]:
        # majority vote
        counts = {}
        for c in session["cat_hints"]:
            counts[c] = counts.get(c, 0) + 1
        session["category"] = max(counts, key=counts.get)
    del session["time_tokens"]
    del session["cat_hints"]


# ---------------------------------------------------------------------------
# Jan-Apr: headered side-by-side blocks
# ---------------------------------------------------------------------------
def find_header_blocks(grid):
    blocks = []
    for ridx, row in enumerate(grid):
        for cidx, cell in enumerate(row):
            if cell.strip().lower() == "date" and cidx + 1 < len(row) and \
               row[cidx + 1].strip().lower() == "exercise":
                fields = []
                c = cidx
                while c < len(row):
                    name = row[c].strip()
                    if name == "":
                        break
                    fields.append(name)
                    c += 1
                label = ""
                if ridx > 0 and cidx < len(grid[ridx - 1]):
                    label = grid[ridx - 1][cidx].strip()
                blocks.append({"row": ridx, "col": cidx, "fields": fields, "label": label})
    return blocks


def parse_jan_apr():
    grid = read_grid(DATA / "Workout Tracker - 26 Jan-Apr.csv")
    header_blocks = find_header_blocks(grid)

    sessions = []
    for b in header_blocks:
        col0 = b["col"]
        fields = b["fields"]
        idx = {name: col0 + i for i, name in enumerate(fields)}
        set_cols = [idx[k] for k in fields if k.lower().startswith("set")]
        weight_col = idx.get("Weight")
        rpe_col = idx.get("RPE")
        plan_col = idx.get("Plan")
        category = b["label"] or None

        current = None
        for r in grid[b["row"] + 1:]:
            def cell(c):
                return r[c].strip() if c < len(r) else ""

            date_cell = cell(col0)
            d = parse_date_cell(date_cell)
            if d:
                current = new_session(d, category)
                sessions.append(current)
            elif date_cell and current is not None:
                t = parse_time_token(date_cell)
                if t:
                    current["time_tokens"].append(t)

            exercise_raw = cell(col0 + 1)
            if not exercise_raw or current is None or is_junk_label(exercise_raw):
                continue

            explicit_sets = []
            for sc in set_cols:
                raw = cell(sc)
                if raw:
                    explicit_sets.append(parse_set_cell(raw))

            weight_raw = cell(weight_col) if weight_col else ""
            weight_fallback = parse_number(weight_raw) if weight_raw else None
            rpe = cell(rpe_col) if rpe_col else ""
            plan_text = cell(plan_col) if plan_col else None

            add_sets_for_exercise(current, exercise_raw, explicit_sets, weight_fallback, weight_raw, rpe, plan_text)

        for s in sessions:
            if "start_time" not in s:
                finalize_session(s)
    return sessions


# ---------------------------------------------------------------------------
# Jun: header-less, positionally-inferred blocks (block width 9, same as Jan-Apr)
# ---------------------------------------------------------------------------
def parse_jun():
    grid = read_grid(DATA / "Workout Tracker - 26 Jun.csv")
    max_cols = max(len(r) for r in grid)
    block_starts = list(range(2, max_cols, 9))

    sessions = []
    for col0 in block_starts:
        current = None
        for r in grid:
            def cell(c):
                return r[c].strip() if c < len(r) else ""

            date_cell = cell(col0)
            d = parse_date_cell(date_cell)
            if d:
                current = new_session(d, None)
                sessions.append(current)
            elif date_cell and current is not None:
                t = parse_time_token(date_cell)
                if t:
                    current["time_tokens"].append(t)

            exercise_raw = cell(col0 + 1)
            if not exercise_raw or current is None or is_junk_label(exercise_raw):
                continue

            rest = [cell(c) for c in range(col0 + 2, col0 + 9)]
            plan_text = None
            data_cells = rest
            if rest and looks_like_scheme(rest[0]):
                plan_text = rest[0]
                data_cells = rest[1:]

            explicit_sets, note_cells = [], []
            for c in data_cells:
                if not c:
                    continue
                r_, w_, _ = parse_set_cell(c)
                if r_ is None and w_ is None and "/" not in c and not re.fullmatch(NUM_RE, c):
                    note_cells.append(c)
                else:
                    explicit_sets.append((r_, w_, c))

            add_sets_for_exercise(current, exercise_raw, explicit_sets, None, "", "", plan_text)
            if note_cells and current["sets"]:
                last = current["sets"][-1]
                extra = " | ".join(note_cells)
                last["notes"] = (last["notes"] + " | " + extra) if last["notes"] else extra

        for s in sessions:
            if "start_time" not in s:
                finalize_session(s)
    return sessions


# ---------------------------------------------------------------------------
def write_csv(path, rows, fields):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in rows:
            w.writerow(row)


def main():
    bw = parse_body_mass()
    write_csv(OUT / "body_weight.csv", bw, ["log_date", "weight_kg"])
    print(f"body_weight.csv: {len(bw)} rows")

    sessions = parse_jan_apr() + parse_jun()

    session_rows = []
    set_rows = []
    for s in sessions:
        if not s["sets"]:
            continue  # a date cell with no exercises logged under it
        session_rows.append({
            "session_key": s["session_key"], "log_date": s["log_date"], "category": s["category"] or "",
            "start_time": s["start_time"] or "", "end_time": s["end_time"] or "", "notes": "",
        })
        for row in s["sets"]:
            row = dict(row)
            row["session_key"] = s["session_key"]
            set_rows.append(row)

    write_csv(OUT / "workout_sessions.csv", session_rows,
              ["session_key", "log_date", "category", "start_time", "end_time", "notes"])
    print(f"workout_sessions.csv: {len(session_rows)} rows")

    set_fields = ["session_key", "exercise", "exercise_raw", "set_number", "reps", "reps_raw",
                  "weight_kg", "weight_raw", "rpe", "notes"]
    write_csv(OUT / "workout_sets.csv", set_rows, set_fields)
    print(f"workout_sets.csv: {len(set_rows)} rows")

    review = [row for row in set_rows if row["reps"] is None and row["weight_kg"] is None]
    write_csv(OUT / "needs_review.csv", review, set_fields)
    print(f"needs_review.csv: {len(review)} rows (no numeric reps/weight extracted -- raw text preserved)")

    with_time = sum(1 for s in session_rows if s["start_time"])
    print(f"sessions with a recovered start_time: {with_time}/{len(session_rows)}")


if __name__ == "__main__":
    main()
