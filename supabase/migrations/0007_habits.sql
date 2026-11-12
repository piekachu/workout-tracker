-- Custom daily habits for the Today screen (water, reading, sleep, ...).
-- The built-in habits (vocab, drug of the day, workout) come from their own
-- tables; these two hold only the ones you add yourself.
-- Owner-only from day one: rows carry user_id (defaults to the caller) and RLS
-- lets a signed-in user touch only their own, same rule as migration 0006.

create table if not exists habits (
  id bigint generated always as identity primary key,
  name text not null,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade
);

create table if not exists habit_log (
  id bigint generated always as identity primary key,
  habit_id bigint not null references habits (id) on delete cascade,
  done_on date not null,
  created_at timestamptz default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  unique (habit_id, done_on)
);

create index if not exists habits_user_id_idx on habits (user_id);
create index if not exists habit_log_user_id_idx on habit_log (user_id);
create index if not exists habit_log_done_on_idx on habit_log (done_on);

alter table habits enable row level security;
alter table habit_log enable row level security;

drop policy if exists "owner only" on habits;
create policy "owner only" on habits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "owner only" on habit_log;
create policy "owner only" on habit_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on habits from anon;
revoke all on habit_log from anon;
