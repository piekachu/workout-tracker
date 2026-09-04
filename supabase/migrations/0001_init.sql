-- Workout tracker schema
create table if not exists body_weight (
  id bigint generated always as identity primary key,
  log_date date not null unique,
  weight_kg numeric not null,
  created_at timestamptz default now()
);

create table if not exists workout_sets (
  id bigint generated always as identity primary key,
  log_date date not null,
  muscle_group text,
  exercise text not null,
  set_number int not null default 1,
  reps int,
  reps_raw text,
  weight_kg numeric,
  weight_raw text,
  rpe text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists workout_sets_log_date_idx on workout_sets (log_date);
create index if not exists workout_sets_exercise_idx on workout_sets (exercise);
create index if not exists body_weight_log_date_idx on body_weight (log_date);

alter table body_weight enable row level security;
alter table workout_sets enable row level security;

-- Personal, no-auth app: allow the public anon key full access.
-- Access control relies on the Pages URL being unlisted, not on secrecy of the anon key.
drop policy if exists "anon full access" on body_weight;
create policy "anon full access" on body_weight
  for all to anon using (true) with check (true);

drop policy if exists "anon full access" on workout_sets;
create policy "anon full access" on workout_sets
  for all to anon using (true) with check (true);
