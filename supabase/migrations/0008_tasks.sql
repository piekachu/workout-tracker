-- Tasks with a horizon: a day task belongs to one date, a week task to a
-- Monday-start week, a month task to a calendar month. `period_start` anchors
-- it (the date itself / that week's Monday / the 1st of the month), so "what's
-- on this week" is a plain equality lookup.
--
-- start_time/end_time (day tasks only) are what becomes a Google Calendar
-- event; notion_page_id / gcal_event_id remember the synced copies so edits
-- update them instead of duplicating. The site stays the source of truth.
-- Owner-only RLS, same rule as 0006.

create table if not exists tasks (
  id bigint generated always as identity primary key,
  title text not null,
  notes text,
  horizon text not null default 'day' check (horizon in ('day', 'week', 'month')),
  period_start date not null,
  start_time time,
  end_time time,
  priority smallint not null default 0 check (priority between 0 and 2),
  recur text check (recur in ('daily', 'weekly', 'monthly')),
  done_at timestamptz,
  notion_page_id text,
  gcal_event_id text,
  synced_at timestamptz,
  created_at timestamptz default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade
);

create index if not exists tasks_user_id_idx on tasks (user_id);
create index if not exists tasks_period_idx on tasks (horizon, period_start);

alter table tasks enable row level security;
drop policy if exists "owner only" on tasks;
create policy "owner only" on tasks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on tasks from anon;
