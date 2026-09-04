# Workout Tracker

A small, single-page personal workout tracker: open it and immediately see a
consistency heatmap of the last ~18 weeks, then scroll down to log today's
workout — pick a category, then add exercises one at a time from a dropdown
scoped to that category (each shows its proposed goal, sets/reps/weight, once
picked); fill in what you actually did per set, plus body weight and
start/end time. Static frontend on GitHub Pages, data in Supabase.

**Live site:** https://piekachu.github.io/workout-tracker/

## Stack

- **Frontend:** plain HTML/CSS/JS (no build step, no charting library — the heatmap is hand-built with CSS grid), [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript) v2 via CDN.
- **Backend:** Supabase (Postgres + auto-generated REST API), project `loandword-desk` (ref `xxcwyttfhqnhuelkkimu`), tables `workout_sessions`, `workout_sets`, `body_weight`, `exercise_catalog`.
- **Hosting:** GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`.

## Data model

- **`workout_sessions`** — one row per logged workout: `log_date`, `category` (one of the 5 fixed categories below), `start_time`, `end_time`.
- **`workout_sets`** — one row per set, referencing `session_id`: `exercise`, `set_number`, `reps`, `weight_kg`, `notes` (comment, kept on each exercise's first set), plus `exercise_raw`/`reps_raw`/`weight_raw`/`rpe` left over from the historical CSV import for traceability (unused by the current UI).
- **`body_weight`** — `log_date`, `weight_kg` (upserted from the same log form).
- **`exercise_catalog`** — the exercises shown for each category, each with a proposed goal: `category`, `exercise`, `target_sets`, `target_reps`, `target_weight`, `sort_order`. Seeded once from history (`scripts/seed_catalog.py`); edit rows directly in the Supabase table editor to adjust the exercise list or goals per category.

**Categories** (fixed, in `assets/app.js`'s `GROUPS`): Back + Biceps, Chest + Triceps, Shoulder + Arms, Legs, Whole body.

## Project layout

```
index.html, assets/              the deployed site (assets/config.js holds the public Supabase URL + anon key)
supabase/migrations/             schema history (0001: initial flat table, 0002: sessions + sets rework)
data/                            original CSV exports
scripts/exercise_aliases.py      canonicalizes ~150 raw exercise-name variants into ~30 real exercises
scripts/parse_csv.py             best-effort parser: data/*.csv -> out/*.csv (sessions + sets)
scripts/import_data.py           loads out/*.csv into Supabase (needs the service_role key, local use only)
scripts/seed_catalog.py          computes proposed goals from history and seeds exercise_catalog
out/                             parsed output, incl. needs_review.csv (rows the parser wasn't confident about)
```

## Security model — no login, by design

Single-user app, no auth. The Supabase anon key embedded in `assets/config.js`
is meant to be public — access control lives in the RLS policies (`anon` role
has full read/write on all three tables), not in keeping the key secret.
Anyone who finds the Pages URL can view/modify the data — an accepted
tradeoff for a personal, unlisted tool. To lock down later: add Supabase Auth
and scope the RLS policies to `auth.uid()`.

The `service_role` key (used only by `scripts/import_data.py`, run locally)
bypasses RLS entirely and must never be committed or put in frontend code.

## Data import notes

The source spreadsheets were a free-form workout log (`10ea/12kg`,
`2/12/40` sets×reps×weight prescriptions, typo'd exercise names, stray
timestamps in date columns, weekly-tally rows mixed in with real exercises).
`scripts/parse_csv.py` handles this:
- **Exercise name merging** — `scripts/exercise_aliases.py` canonicalizes ~150
  raw name variants (`Pull ups`/`Pull-ups`/`N-grip Pull ups`/`Nutral Grip Pull
  ups`/...) down to ~30 real exercises, via keyword rules, so progress charts
  aggregate correctly. Unrecognized names fall back to a light auto-cleanup
  and are still imported (nothing is silently dropped).
- **Sets/reps/weight triplets** (`2/12/40` = 2 sets × 12 reps × 40kg) expand
  into that many actual set rows whenever there's no more-granular explicit
  per-set data for that exercise entry.
- **Session times** — stray HHMM-looking numbers that ended up in date cells
  (e.g. `1450`, `1906`) are recovered as each exercise's logged time; a
  session's `start_time`/`end_time` are the min/max of those found among its
  rows (not every historical session has one).
- **Junk rows** like `Back/8` or `S/6 + Bi/6 + Tri/4` (weekly tallies that
  got misparsed as exercises) are filtered out.
- `out/needs_review.csv` lists rows where nothing numeric could be extracted
  for manual cleanup if wanted; `out/unmapped_exercises.csv`-equivalent
  visibility is in the parser's stdout summary.

To re-run the import (e.g. after editing the parser or alias table):

```bash
python3 scripts/parse_csv.py
SUPABASE_URL="https://xxcwyttfhqnhuelkkimu.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role key, from \`supabase projects api-keys\`>" \
python3 scripts/import_data.py
```
Note: re-running the import inserts a second copy of everything (it doesn't
delete first) — truncate `workout_sessions`/`workout_sets` first if you want
a clean re-import (deleting sessions cascades to their sets).

## Local development

```bash
python3 -m http.server 8934
# open http://localhost:8934
```

No build step — it's static files talking directly to Supabase's REST API.
