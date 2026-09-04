#!/usr/bin/env python3
"""
Best-effort parser for the messy workout-log CSV exports.

Input:
  data/Workout Tracker - Body Mass.csv   (clean: date, weight)
  data/Workout Tracker - 26 Jan-Apr.csv  (side-by-side blocks per muscle group,
                                           each with its own Date/Exercise/Set1-4/Weight/RPE header)
  data/Workout Tracker - 26 Jun.csv      (free-form side-by-side blocks, no headers,
                                           cells mix "sets/reps/weight" scheme notes and
                                           actual per-set "reps/weight" results)

Output (in out/):
  body_weight.csv    -- log_date, weight_kg
  workout_sets.csv   -- log_date, muscle_group, exercise, set_number, reps, reps_raw,
                         weight_kg, weight_raw, rpe, notes
  needs_review.csv   -- subset of workout_sets rows where nothing numeric could be
                         extracted (kept in workout_sets too -- nothing is dropped,
                         this is just a visibility list)

Nothing is discarded: whenever a cell can't be confidently split into numeric
reps/weight, the original text is preserved in reps_raw / notes.
"""
import csv
import re
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "june": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
DATE_RE = re.compile(r'^([A-Za-z]{3,4})\.?\s*(\d{1,2})$')

# Year assumption: both sheets are titled "26" (2026) and span Jan-Jun.
YEAR = 2026


def parse_date_cell(cell):
    """Return an ISO date string if `cell` looks like 'Jan 9' / 'June 24', else None."""
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


NUM_RE = r'[-+]?\d+(?:\.\d+)?'


def parse_number(s):
    s = s.strip().lower().replace("kgs", "").replace("kg", "").replace("ea", "").strip()
    m = re.fullmatch(NUM_RE, s)
    return float(m.group(0)) if m else None


def parse_set_cell(raw):
    """
    Parse one 'set' cell into (reps, weight_kg) when confidently possible.
    Always keeps the original text as reps_raw for traceability.
    Handles: '8', '10/45kg', '6ea', '10ea/12kg', 'test/20kg', '6+4 negatives', 'X', ''.
    Drop-sets / compound cells ('8/45+4/36') are left unparsed (raw only).
    """
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


SCHEME_RE = re.compile(rf'^{NUM_RE}/[\w?f]+/{NUM_RE}$', re.I)  # e.g. "2/12/55", "3/8/50"


def looks_like_scheme(cell):
    """A planned 'sets/reps/weight' prescription rather than a performed set, e.g. '2/12/55'."""
    c = (cell or "").strip()
    return bool(SCHEME_RE.match(c)) or bool(re.fullmatch(r'x\d+', c, re.I))


def strip_trailing_scheme(exercise):
    """Exercise names sometimes have a prescription baked in: 'T-bar rows 4/10/25'."""
    m = re.match(rf'^(.*?)\s+({NUM_RE}/[\w?f]+/{NUM_RE})$', exercise.strip())
    if m:
        return m.group(1).strip(), m.group(2)
    return exercise.strip(), None


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
# Jan-Apr: headered side-by-side blocks
# ---------------------------------------------------------------------------
def find_header_blocks(grid):
    """Locate (row_idx, col_idx, field_names) for every 'Date,Exercise,...' header row,
    and the muscle-group label sitting in the row directly above it."""
    blocks = []
    for ridx, row in enumerate(grid):
        for cidx, cell in enumerate(row):
            if cell.strip().lower() == "date" and cidx + 1 < len(row) and \
               row[cidx + 1].strip().lower() == "exercise":
                # collect header fields until the next blank-ish gap (2 blanks) or row end
                fields = []
                c = cidx
                blanks = 0
                while c < len(row):
                    name = row[c].strip()
                    if name == "":
                        blanks += 1
                        if blanks >= 1:
                            break
                    else:
                        blanks = 0
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
    # sort block start columns to know each block's right edge
    starts = sorted(b["col"] for b in header_blocks)

    out_rows = []
    for b in header_blocks:
        col0 = b["col"]
        fields = b["fields"]  # e.g. ['Date','Exercise','Set 1','Set 2','Set 3','Set 4','Weight','RPE']
        idx = {name: col0 + i for i, name in enumerate(fields)}
        set_cols = [idx[k] for k in fields if k.lower().startswith("set")]
        weight_col = idx.get("Weight")
        rpe_col = idx.get("RPE")
        plan_col = idx.get("Plan")
        muscle_group = b["label"] or None

        current_date = None
        for r in grid[b["row"] + 1:]:
            def cell(c):
                return r[c].strip() if c < len(r) else ""

            date_cell = cell(col0)
            d = parse_date_cell(date_cell)
            if d:
                current_date = d
            # non-date, non-empty junk in the date cell (a time, a stray weight) is ignored
            # except it does NOT reset current_date.

            exercise_raw = cell(col0 + 1)
            if not exercise_raw or current_date is None:
                continue

            exercise, scheme = strip_trailing_scheme(exercise_raw)
            plan_note = f"Plan: {cell(plan_col)}" if plan_col and cell(plan_col) else None
            scheme_note = f"Plan: {scheme}" if scheme else None
            weight_fallback = parse_number(cell(weight_col)) if weight_col else None
            rpe = cell(rpe_col) if rpe_col else ""

            set_num = 0
            any_set = False
            for sc in set_cols:
                raw = cell(sc)
                if not raw:
                    continue
                set_num += 1
                any_set = True
                reps, weight, reps_raw = parse_set_cell(raw)
                notes = " | ".join(n for n in [plan_note, scheme_note] if n)
                out_rows.append({
                    "log_date": current_date,
                    "muscle_group": muscle_group,
                    "exercise": exercise,
                    "set_number": set_num,
                    "reps": reps,
                    "reps_raw": reps_raw,
                    "weight_kg": weight if weight is not None else weight_fallback,
                    "weight_raw": cell(weight_col) if weight_col else "",
                    "rpe": rpe,
                    "notes": notes,
                })
            if not any_set:
                # exercise logged with no set data at all -- keep a single placeholder row
                notes = " | ".join(n for n in [plan_note, scheme_note] if n)
                out_rows.append({
                    "log_date": current_date,
                    "muscle_group": muscle_group,
                    "exercise": exercise,
                    "set_number": 1,
                    "reps": None,
                    "reps_raw": "",
                    "weight_kg": weight_fallback,
                    "weight_raw": cell(weight_col) if weight_col else "",
                    "rpe": rpe,
                    "notes": notes,
                })
    return out_rows


# ---------------------------------------------------------------------------
# Jun: header-less, positionally-inferred blocks (block width 9, same as Jan-Apr)
# ---------------------------------------------------------------------------
def parse_jun():
    grid = read_grid(DATA / "Workout Tracker - 26 Jun.csv")
    max_cols = max(len(r) for r in grid)
    block_starts = list(range(2, max_cols, 9))  # empirically: date columns at 2, 11, 20, 29...

    out_rows = []
    for col0 in block_starts:
        current_date = None
        for r in grid:
            def cell(c):
                return r[c].strip() if c < len(r) else ""

            date_cell = cell(col0)
            d = parse_date_cell(date_cell)
            if d:
                current_date = d

            exercise_raw = cell(col0 + 1)
            if not exercise_raw or current_date is None:
                continue
            exercise, _ = strip_trailing_scheme(exercise_raw)

            # remaining cells in this block, up to (but not including) the next block's start
            rest = [cell(c) for c in range(col0 + 2, col0 + 9)]

            scheme_note = None
            data_cells = rest
            if rest and looks_like_scheme(rest[0]):
                scheme_note = f"Plan: {rest[0]}"
                data_cells = rest[1:]

            # trailing free-text notes: any cell that doesn't parse as a set-like token
            set_cells, note_cells = [], []
            for c in data_cells:
                if not c:
                    continue
                r_, w_, _ = parse_set_cell(c)
                if r_ is None and w_ is None and "/" not in c and not re.fullmatch(NUM_RE, c):
                    note_cells.append(c)
                else:
                    set_cells.append(c)

            notes = " | ".join(n for n in [scheme_note, *note_cells] if n)

            if not set_cells:
                out_rows.append({
                    "log_date": current_date,
                    "muscle_group": None,
                    "exercise": exercise,
                    "set_number": 1,
                    "reps": None,
                    "reps_raw": "",
                    "weight_kg": None,
                    "weight_raw": "",
                    "rpe": "",
                    "notes": notes,
                })
                continue

            for i, raw in enumerate(set_cells, start=1):
                reps, weight, reps_raw = parse_set_cell(raw)
                out_rows.append({
                    "log_date": current_date,
                    "muscle_group": None,
                    "exercise": exercise,
                    "set_number": i,
                    "reps": reps,
                    "reps_raw": reps_raw,
                    "weight_kg": weight,
                    "weight_raw": "",
                    "rpe": "",
                    "notes": notes if i == 1 else "",
                })
    return out_rows


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

    sets = parse_jan_apr() + parse_jun()
    fields = ["log_date", "muscle_group", "exercise", "set_number", "reps", "reps_raw",
              "weight_kg", "weight_raw", "rpe", "notes"]
    write_csv(OUT / "workout_sets.csv", sets, fields)
    print(f"workout_sets.csv: {len(sets)} rows")

    review = [row for row in sets if row["reps"] is None and row["weight_kg"] is None]
    write_csv(OUT / "needs_review.csv", review, fields)
    print(f"needs_review.csv: {len(review)} rows (no numeric reps/weight extracted -- raw text preserved)")


if __name__ == "__main__":
    main()
