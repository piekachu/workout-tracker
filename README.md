# Workout Tracker

A small personal workout-tracking site: log sets and body weight, browse history,
and see progress charts. Static frontend on GitHub Pages, data in Supabase.

**Live site:** set after first deploy — see repo Settings → Pages, or the
Actions tab for the deployment URL.

## Stack

- **Frontend:** plain HTML/CSS/JS (no build step), [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript) v2 and [Chart.js](https://www.chartjs.org/) via CDN.
- **Backend:** Supabase (Postgres + auto-generated REST API), project `loandword-desk` (ref `xxcwyttfhqnhuelkkimu`), tables `body_weight` and `workout_sets`.
- **Hosting:** GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`.

## Project layout

```
index.html, assets/          the deployed site (assets/config.js holds the public Supabase URL + anon key)
supabase/migrations/         schema (body_weight, workout_sets tables + RLS policies)
data/                        original CSV exports
scripts/parse_csv.py         best-effort parser: data/*.csv -> out/*.csv
scripts/import_data.py       loads out/*.csv into Supabase (needs the service_role key, local use only)
out/                         parsed output, incl. needs_review.csv (rows the parser wasn't confident about)
```

## Security model — no login, by design

This is a single-user app with no auth. The Supabase **anon key embedded in
`assets/config.js` is meant to be public** — Supabase's security model puts
access control in Row Level Security (RLS) policies, not in keeping that key
secret. The migration in `supabase/migrations/0001_init.sql` grants the
`anon` role full read/write on both tables, so **anyone who finds the Pages
URL and reads the page source can view or modify the data**. That's an
accepted tradeoff for a personal, unlisted tool. To lock it down later:
add Supabase Auth (email/magic-link) and change the RLS policies to check
`auth.uid()` instead of allowing `anon` outright.

The `service_role` key (used only by `scripts/import_data.py`, run locally)
bypasses RLS entirely and must never be committed or put in frontend code.

## Data import notes

The source spreadsheets were a free-form workout log (inconsistent notation
like `10ea/12kg`, `test/20kg`, prescribed-scheme text baked into exercise
names, etc.). `scripts/parse_csv.py` does a best-effort structured parse:
- Numbers it can confidently split into reps/weight become the `reps` /
  `weight_kg` columns.
- Everything else is preserved as-is in `reps_raw` / `notes` — no data was
  dropped, but not everything is numeric/queryable.
- `out/needs_review.csv` lists the ~180 rows (of ~1020) where nothing
  numeric could be extracted, for manual cleanup in the app or DB if wanted.

To re-run the import (e.g. after editing the parser):

```bash
python3 scripts/parse_csv.py
SUPABASE_URL="https://xxcwyttfhqnhuelkkimu.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role key, from `supabase projects api-keys`>" \
python3 scripts/import_data.py
```

## Local development

```bash
python3 -m http.server 8934
# open http://localhost:8934
```

No build step — it's static files talking directly to Supabase's REST API.
