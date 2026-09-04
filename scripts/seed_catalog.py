#!/usr/bin/env python3
"""
Seeds exercise_catalog from historical workout_sets: for each exercise that
appears in the data, computes a proposed goal (target sets/reps/weight) and
assigns it to one of the 5 fixed categories (scripts/exercise_aliases.GROUPS).

  target_sets   = most common number of sets logged per session for that exercise
  target_reps   = most common reps value logged (mode)
  target_weight = the weight used in the most recent session for that exercise
                   (i.e. "keep pushing from where you left off")

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/seed_catalog.py
"""
import json
import os
import statistics
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exercise_aliases import group_for

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not URL or not KEY:
    print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.", file=sys.stderr)
    sys.exit(1)


def request(method, path, body=None, extra_headers=None):
    headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def mode_or(values, default):
    values = [v for v in values if v is not None]
    if not values:
        return default
    try:
        return statistics.mode(values)
    except statistics.StatisticsError:
        return round(statistics.mean(values))


def main():
    sessions = request("GET", "workout_sessions?select=log_date,workout_sets(exercise,reps,weight_kg,set_number)&order=log_date.desc")

    sets_per_session = defaultdict(list)  # exercise -> [set_count, ...]
    reps_values = defaultdict(list)       # exercise -> [reps, ...]
    most_recent_weight = {}               # exercise -> weight (first session encountered, desc order)

    for session in sessions:
        by_exercise = defaultdict(list)
        for row in session.get("workout_sets") or []:
            by_exercise[row["exercise"]].append(row)
        for exercise, rows in by_exercise.items():
            sets_per_session[exercise].append(len(rows))
            for r in rows:
                if r["reps"] is not None:
                    reps_values[exercise].append(r["reps"])
            if exercise not in most_recent_weight:
                weights = [r["weight_kg"] for r in rows if r["weight_kg"] is not None]
                if weights:
                    most_recent_weight[exercise] = max(weights)

    exercises = sorted(sets_per_session.keys())
    rows = []
    for i, exercise in enumerate(exercises):
        rows.append({
            "category": group_for(exercise),
            "exercise": exercise,
            "target_sets": mode_or(sets_per_session[exercise], 3),
            "target_reps": mode_or(reps_values[exercise], 10),
            "target_weight": most_recent_weight.get(exercise),
            "sort_order": i,
        })

    print(f"Seeding {len(rows)} exercise_catalog rows...")
    request("POST", "exercise_catalog", rows, {"Prefer": "return=minimal"})
    for r in rows:
        print(f"  [{r['category']:16s}] {r['exercise']:35s} {r['target_sets']}/{r['target_reps']}/{r['target_weight']}")
    print("Done.")


if __name__ == "__main__":
    main()
