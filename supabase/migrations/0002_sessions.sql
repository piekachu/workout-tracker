-- Reorganize workout logging around day/category sessions.
-- body_weight is untouched. workout_sets is dropped and recreated to reference
-- the new workout_sessions table (safe: no live data has been added since the
-- initial CSV import — verified row counts unchanged before running this).

drop table if exists workout_sets;

create table if not exists workout_sessions (
  id bigint generated always as identity primary key,
  log_date date not null,
  category text,
  start_time time,
  end_time time,
  notes text,
  created_at timestamptz default now()
);

create table workout_sets (
  id bigint generated always as identity primary key,
  session_id bigint not null references workout_sessions(id) on delete cascade,
  exercise text not null,
  exercise_raw text,
  set_number int not null default 1,
  reps int,
  reps_raw text,
  weight_kg numeric,
  weight_raw text,
  rpe text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists workout_sessions_log_date_idx on workout_sessions (log_date);
create index if not exists workout_sets_session_id_idx on workout_sets (session_id);
create index if not exists workout_sets_exercise_idx on workout_sets (exercise);

alter table workout_sessions enable row level security;
alter table workout_sets enable row level security;

drop policy if exists "anon full access" on workout_sessions;
create policy "anon full access" on workout_sessions
  for all to anon using (true) with check (true);

drop policy if exists "anon full access" on workout_sets;
create policy "anon full access" on workout_sets
  for all to anon using (true) with check (true);
