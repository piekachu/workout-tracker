# Personal site

A small multi-page personal site: the root (`/`) is a home page listing
every tool on the site as a card; each tool is otherwise an independent app
in its own folder. Today that's a workout tracker (`/workout/`) and a
vocabulary-review app (`/vocab/`), sharing one Supabase project (separate
tables) and one visual design system (`/shared/theme.css`). Static frontend
on GitHub Pages throughout — no build step, no framework.

**Live site:** https://piekachu.github.io/workout-tracker/ · [Workout](https://piekachu.github.io/workout-tracker/workout/) · [Vocab](https://piekachu.github.io/workout-tracker/vocab/)

## Adding a new page

1. Make a folder for it (e.g. `/journal/`) with its own `index.html`.
2. In its `<head>`, link `../shared/theme.css` first — this gives it the
   site's color tokens (light + dark), Fraunces + IBM Plex Mono, and the
   `.site-nav` bar styling. Add whatever page-specific CSS it needs after
   that; reference the shared tokens (`var(--accent)`, `var(--bg)`, etc.)
   rather than hardcoding colors, so a future palette change still reaches it.
3. Add a `<nav class="site-nav">` near the top with a link to `../` (Home)
   and to itself/siblings, matching the pattern in `workout/index.html` or
   `vocab/index.html`. If the page has its own internal sections (the way
   Workout has Log/Database/Manage), add a second `<nav class="sub-nav">`
   below it rather than changing what's in `.site-nav` — the top-level nav
   should look and behave identically on every page, full stop.
4. Add one entry to the `PAGES` array in the root `index.html`'s script —
   that's the only change needed for it to show up on the home page. If it
   has day-based activity worth showing as a 14-week strip, add an
   `activity` key too (see "14-week strip" below).
5. `workout/`, `vocab/`, and `shared/` each get their own `cp -r` line in
   `.github/workflows/pages.yml`'s "Stage site files only" step. A page
   living entirely *inside* one of those (like `/workout/database/`) needs
   nothing extra there, since `cp -r workout` already copies it -- but a
   sibling top-level folder does need its own line, or it won't actually
   deploy (this bit everyone once already — see git history).

## Workout Tracker (`/workout/`)

- **Frontend:** plain HTML/CSS/JS (no charting library — the heatmap and the progress-comparison chart are both hand-built, the latter as inline SVG), [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript) v2 via CDN.
- **Backend:** Supabase (Postgres + auto-generated REST API), project `loandword-desk` (ref `xxcwyttfhqnhuelkkimu`), tables `workout_sessions`, `workout_sets`, `body_weight`, `exercise_catalog`, `workout_routines` (`/vocab/` uses its own `kv_store` table in the same project).
- **Hosting:** GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`.

Three sub-pages under one `.sub-nav` (Log / Database / Manage):

### Log (`/workout/`)

Open it and immediately see a consistency heatmap of the last ~18 weeks,
then scroll down to log today's workout — pick a category, then add
exercises one at a time from a carousel scoped to that category (each shows
its proposed goal, sets/reps/weight, once picked); fill in what you actually
did per set, plus body weight.

- **Exercises swipe, not stack.** `#exercise-list` is a native CSS scroll-snap
  carousel (one exercise per screen) with dot/arrow controls built in
  `assets/app.js`; this is what keeps the page's scroll height capped at the
  tallest single exercise instead of growing with every exercise you add.
- **Picking an exercise is a carousel too**, not a `<select>` dropdown --
  `‹ Exercise Name ›` with the same prev/next arrows used for swiping between
  exercises, cycling through that category's catalog plus a final "Other…"
  slot for typing something not in it. Starts on "Select exercise…"; nothing
  is pre-chosen.
- **One session per date, always.** Saving looks for an existing session on
  `log_date` alone (not date *and* category) and appends into it, continuing
  each exercise's `set_number` rather than restarting at 1. If the category
  differs from what's already logged that day, the labels merge instead of
  overwriting (`"Back + Biceps"` + `"Legs"` → `"Back + Biceps + Legs"`) --
  see `mergeCategoryLabel`. A retroactive pass merged the historical
  duplicates this replaced (see Data cleanup below).
- **The date/time fields disappear once they're not needed.** If the chosen
  date already has a session, `#date-time-fields` hides and a "Continuing
  `<date>`" note takes its place (only body weight stays editable) -- so
  adding a few more exercises to today's already-started workout never means
  re-typing the date or start time. "Log a different date instead" backs out
  of that, for logging a separate/missed day.
- **Load previous** pulls the most recent occurrence of the selected exercise
  (scanning the last 60 sessions client-side) and pre-fills its reps/weight;
  a dropdown of the next few occurrences appears after first use, for
  loading further back than "last time."
- **Drop sets** chain onto a set via `+ drop set` — a compact mini reps/weight
  row, with a `🔻 N drops` badge on the parent set. Stored as ordinary extra
  `workout_sets` rows (continuing that exercise's `set_number`), tagged via
  `notes` starting with `[drop]` rather than a schema column — see Data model.
- **Bigger steps.** Each reps/weight stepper has a second, wider-spaced pair
  of buttons (`«` `»`) for jumping by more per tap (default +5 reps / +10kg)
  alongside the normal ±1 / ±2.5kg buttons — for loading plates fast rather
  than fine-tuning.
- **New exercise slots start at 1 set**, not a fixed default of 3 -- unless
  the category's catalog specifies its own `target_sets` for the exercise
  you land on, in which case that's what shows.
- **Start from a routine**, once any exist (see Manage below) -- a picker
  appears right under the category banner; loading one fills the whole
  exercise carousel from it in one tap, each exercise's set count from its
  saved target.
- A comparison chart at the bottom: pick an exercise, see its top weight
  (and reps at that weight) across your last several sessions as an inline
  SVG line chart, plus a plain-language delta between the two most recent
  ("Last time: 40kg × 8 → This time: 42.5kg × 6, +2.5kg −2 reps").

### Database (`/workout/database/`)

A month calendar -- each day with a session shows an icon per body part
trained (hand-drawn SVGs in `/shared/icons.js`, keyword-matched off the
category string so old free-form labels like `"Back + Chest"` still resolve
sensibly). Tap a day to see its exercises and sets below, with a delete
button. This replaced the old scrolling "Recent" list on the Log page.

### Manage (`/workout/manage/`)

- **Exercises** -- add/edit/delete `exercise_catalog` rows per category
  in-page, instead of needing the Supabase table editor for it.
- **Routines** -- named, reusable exercise sets a category's log form can
  load in one tap (see Log above). Needs the `workout_routines` table from
  `supabase/migrations/0004_routines.sql`, which this app can't create for
  itself (that needs more than the anon key it runs on) -- the page shows
  the exact SQL to run once, with a copy button, if the table isn't there yet.

### Data model

- **`workout_sessions`** — one row per logged day: `log_date` (unique in practice, not DB-enforced — the app itself guarantees at most one per date, see Log above), `category` (free text; may be a `" + "`-joined merge of several of the 5 fixed categories below if more than one was logged that day), `start_time`, `end_time`.
- **`workout_sets`** — one row per set, referencing `session_id`: `exercise`, `set_number`, `reps`, `weight_kg`, `notes` (the exercise's comment on its first set; `[drop]`-prefixed on a drop-set row instead — see Log form features), plus `exercise_raw`/`reps_raw`/`weight_raw`/`rpe` left over from the historical CSV import for traceability (unused by the current UI).
- **`body_weight`** — `log_date`, `weight_kg` (upserted from the same log form).
- **`exercise_catalog`** — the exercises shown for each category, each with a proposed goal: `category`, `exercise`, `target_sets`, `target_reps`, `target_weight`, `sort_order`. Seeded once from history (`scripts/seed_catalog.py`); editable in-app now (Manage), or still directly in the Supabase table editor.
- **`workout_routines`** — optional (see Manage above): `name`, `category`, `exercises` (jsonb array of `{exercise, target_sets}`), `sort_order`.

**Categories** (fixed, in `assets/app.js`'s `GROUPS`): Back + Biceps, Chest + Triceps, Shoulder + Arms, Legs, Whole body.

### Data cleanup (2026-09-22)

Two one-off passes over the historical data, both backed up to `out/` before
touching anything (still there, nothing was ever silently discarded):
- **161 fully-empty `workout_sets` rows** (both `reps` and `weight_kg` null —
  leftover placeholders from the CSV import's sets×reps×weight expansion that
  never got real per-set data) were deleted. A full statistical pass over
  weight/reps found no genuine outliers otherwise — the numbers that looked
  extreme at a glance (e.g. 80kg on a Hip Abduction machine, 40 reps on a
  light cable row) turned out legitimate for their specific exercise once
  checked against that exercise's own range, so nothing else was touched.
  Backup: `out/removed_empty_sets_backup_2026-09-22.json`.
- **5 dates had more than one session** (fragments from re-logging partway
  through a day, plus two exact re-import duplicates from the original CSV
  load). Each was consolidated into one session per the rules Log now
  enforces going forward — set data was moved (not duplicated) into the kept
  session, categories merged where they differed, time ranges widened, and
  the emptied duplicate sessions deleted. Backup:
  `out/duplicate_date_sessions_backup_2026-09-22.json`.

### Security model — no login, by design

Single-user app, no auth. The Supabase anon key embedded in `assets/config.js`
is meant to be public — access control lives in the RLS policies (`anon` role
has full read/write on all three tables), not in keeping the key secret.
Anyone who finds the Pages URL can view/modify the data — an accepted
tradeoff for a personal, unlisted tool. To lock down later: add Supabase Auth
and scope the RLS policies to `auth.uid()`.

The `service_role` key (used only by `scripts/import_data.py`, run locally)
bypasses RLS entirely and must never be committed or put in frontend code.

## Home (`/`)

Each card on the home page shows a compact 14-week activity strip (7×14
dots, same "one dot per day" idea as Workout's own heatmap, just smaller)
pulled live from that tool's own data — `ACTIVITY_SOURCES.workout` reads
`workout_sessions.log_date` directly; `ACTIVITY_SOURCES.vocab` reads the
`kv_store` row's `data.langs.*.activity` keys. A future page adds its own
entry to `ACTIVITY_SOURCES` (and references it via `activity: "<key>"` on
its `PAGES` entry) to get the same strip, or omits `activity` for none.

## Vocab Desk (`/vocab/`)

Spaced-repetition vocabulary review, English and Japanese, self-contained in
one `vocab/index.html` (own inline CSS/JS, no separate assets/ folder). Same
no-login model as the workout tracker, on its own `kv_store` table in the
same Supabase project.

**Loads and updates automatically.** The first time this page is opened in a
browser, it silently connects to Supabase and loads whatever's already
there — no confirm dialog, no manual setup (see `autoConnectSilent`). After
that it stays live: every edit pushes (debounced ~2.5s), and it pulls
whenever the tab gains focus and every 60s while visible, so a change made
on one device shows up on another without a manual sync button. The
manual "Connect" flow in Data & backup (for entering different credentials)
still confirms before overwriting anything, since that's the one path where
there could be real local data worth protecting.

Its own accent color shifts (green ↔ indigo) when you switch between the
English and Japanese corpora — a deliberate in-app touch, kept as-is rather
than folded into the site-wide palette below.

## Shared design system (`/shared/theme.css`)

One token set (colors for light + dark, Fraunces for display type, IBM Plex
Mono for labels/data) plus the `.site-nav` bar, linked from every page's
`<head>`. `/workout/assets/style.css` and `/vocab/index.html` both predate
this file and used their own token names (`--paper`/`--ink`/... in Vocab,
same names as now in Workout) — rather than rewrite either app's existing
component CSS, `theme.css` aliases their old names to the new canonical ones
(e.g. `--paper: var(--bg)`), so both apps' full existing style sheets picked
up the unified palette with no per-rule changes. Write anything new against
the canonical names (`--bg`, `--text`, `--accent`, ...) directly — the
aliases exist only for those two pre-existing apps.

## Project layout

```
index.html                       the home page (a card per tool -- see "Adding a new page" above)
shared/theme.css                 the site's shared design tokens, nav bar styling, and font imports
shared/icons.js                  hand-drawn per-category SVG icons (used by workout/database/)
workout/index.html, assets/      the Log page (assets/config.js holds the public Supabase URL + anon key)
workout/database/                calendar view of past workouts, with per-day delete
workout/manage/                  exercise catalog CRUD + routines CRUD
vocab/index.html                 Vocab Desk -- self-contained (own Supabase table)
supabase/migrations/             schema history (0001: initial flat table, 0002: sessions + sets rework, 0003: catalog, 0004: routines -- not yet applied, see Manage above)
data/                            original CSV exports
scripts/exercise_aliases.py      canonicalizes ~150 raw exercise-name variants into ~30 real exercises
scripts/parse_csv.py             best-effort parser: data/*.csv -> out/*.csv (sessions + sets)
scripts/import_data.py           loads out/*.csv into Supabase (needs the service_role key, local use only)
scripts/seed_catalog.py          computes proposed goals from history and seeds exercise_catalog
out/                             parsed output + one-off cleanup backups (see Data cleanup above)
```

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
# home:    http://localhost:8934
# workout: http://localhost:8934/workout/
# vocab:   http://localhost:8934/vocab/
```

No build step — it's static files talking directly to Supabase's REST API.
Note: opening `/vocab/` against a fresh/empty `localStorage` triggers its
real auto-connect (see Vocab Desk above) against the live Supabase project
— when testing changes to it locally, swap `AUTO_SYNC.slotId` for a
throwaway value first, or you'll be reading/writing real data.
