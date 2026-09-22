-- Workout routines: named, reusable templates ("Push Day A") that pre-fill
-- the log form's exercise list in one tap instead of picking each exercise
-- one at a time. Each routine belongs to one category (same 5 fixed
-- categories used elsewhere) and stores its exercise list as JSON rather
-- than a join table, since it's just [{exercise, target_sets}, ...] and
-- never queried by exercise -- a normalized table would add nothing here.
--
-- The app degrades gracefully if this migration hasn't been run yet (the
-- Manage page's Routines section just shows a "run this migration" notice
-- instead of erroring) -- but it can't apply this itself: creating a table
-- needs more than the anon key the frontend runs on. Run this once, by hand,
-- in the Supabase SQL Editor (or `supabase db push` if you use the CLI).

create table if not exists workout_routines (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null,
  exercises jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index if not exists workout_routines_category_idx on workout_routines (category);

alter table workout_routines enable row level security;

-- Same "personal app, no auth" model as every other table here -- see the
-- README's Security model section.
drop policy if exists "anon full access" on workout_routines;
create policy "anon full access" on workout_routines
  for all to anon using (true) with check (true);

-- The earlier delete-policy gap (workout_sets/workout_sessions initially had
-- no delete policy either, discovered when a cleanup pass needed one) --
-- "for all" above already covers select/insert/update/delete, so this table
-- doesn't need a follow-up fix like that one did.
