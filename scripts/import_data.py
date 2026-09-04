#!/usr/bin/env python3
"""
Bulk-imports out/body_weight.csv and out/workout_sets.csv into Supabase via
the PostgREST REST API, using the service_role key (bypasses RLS -- local
import only, this key must never ship to the frontend).

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/import_data.py
"""
import csv
import json
import os
import sys
import urllib.request
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


def clean_row(row, numeric_fields):
    out = {}
    for k, v in row.items():
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


def post_batch(table, rows, batch_size=500):
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        body = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(
            f"{URL}/rest/v1/{table}",
            data=body,
            method="POST",
            headers={
                "apikey": KEY,
                "Authorization": f"Bearer {KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            print(f"Error inserting into {table}: {e.code} {e.read().decode()}", file=sys.stderr)
            raise
        total += len(batch)
        print(f"  {table}: inserted {total}/{len(rows)}")
    return total


def main():
    bw = [clean_row(r, {"weight_kg"}) for r in read_csv(OUT / "body_weight.csv")]
    sets = [clean_row(r, {"set_number", "reps", "weight_kg"}) for r in read_csv(OUT / "workout_sets.csv")]

    print(f"Importing {len(bw)} body_weight rows...")
    post_batch("body_weight", bw)

    print(f"Importing {len(sets)} workout_sets rows...")
    post_batch("workout_sets", sets)

    print("Done.")


if __name__ == "__main__":
    main()
