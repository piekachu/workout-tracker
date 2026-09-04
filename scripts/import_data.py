#!/usr/bin/env python3
"""
Bulk-imports out/workout_sessions.csv and out/workout_sets.csv into Supabase
via the PostgREST REST API, using the service_role key (bypasses RLS -- local
import only, this key must never ship to the frontend).

Sessions are inserted one at a time (so each returned id can be captured and
mapped back to the CSV's synthetic session_key) before its sets are inserted
in batches referencing the real session_id.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/import_data.py
"""
import csv
import json
import os
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not URL or not KEY:
    print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.", file=sys.stderr)
    sys.exit(1)


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def clean_row(row, numeric_fields, drop_fields=()):
    out = {}
    for k, v in row.items():
        if k in drop_fields:
            continue
        if v == "":
            out[k] = None
        elif k in numeric_fields:
            try:
                out[k] = float(v) if "." in v else int(v)
            except ValueError:
                out[k] = None
        else:
            out[k] = v
    return out


def request(method, path, body=None, extra_headers=None):
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        print(f"Error {method} {path}: {e.code} {e.read().decode()}", file=sys.stderr)
        raise


def post_batch(table, rows, batch_size=500):
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        request("POST", table, batch, {"Prefer": "return=minimal"})
        total += len(batch)
        print(f"  {table}: inserted {total}/{len(rows)}")
    return total


def main():
    sessions = [clean_row(r, set(), drop_fields=()) for r in read_csv(OUT / "workout_sessions.csv")]
    sets = read_csv(OUT / "workout_sets.csv")

    print(f"Importing {len(sessions)} workout_sessions (one at a time, to capture ids)...")
    key_to_id = {}
    for i, row in enumerate(sessions, start=1):
        session_key = row.pop("session_key")
        body = {k: v for k, v in row.items()}
        result = request("POST", "workout_sessions", [body], {"Prefer": "return=representation"})
        key_to_id[session_key] = result[0]["id"]
        if i % 10 == 0 or i == len(sessions):
            print(f"  workout_sessions: {i}/{len(sessions)}")

    print(f"Importing {len(sets)} workout_sets...")
    numeric = {"set_number", "reps", "weight_kg"}
    clean_sets = []
    for row in sets:
        session_key = row.pop("session_key")
        cleaned = clean_row(row, numeric)
        cleaned["session_id"] = key_to_id[session_key]
        clean_sets.append(cleaned)
    post_batch("workout_sets", clean_sets)

    print("Done.")


if __name__ == "__main__":
    main()
