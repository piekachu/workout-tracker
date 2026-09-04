-- Exercise catalog: the fixed-ish list of exercises shown per category on
-- the logging form, each with a proposed goal (sets/reps/weight) seeded from
-- historical data. Categories are the 5 fixed workout-day types used by the
-- app (not DB-enforced, to avoid touching historical workout_sessions.category
-- text): Back + Biceps, Chest + Triceps, Shoulder + Arms, Legs, Whole body.

create table if not exists exercise_catalog (
  id bigint generated always as identity primary key,
  category text not null,
  exercise text not null,
  target_sets int not null default 3,
  target_reps int,
  target_weight numeric,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index if not exists exercise_catalog_category_idx on exercise_catalog (category);

alter table exercise_catalog enable row level security;

drop policy if exists "anon full access" on exercise_catalog;
create policy "anon full access" on exercise_catalog
  for all to anon using (true) with check (true);
