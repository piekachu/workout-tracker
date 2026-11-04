-- Two new pages: /expenses/ (bookkeeping) and /drugs/ (small-molecule drug of
-- the day). Both are additive -- nothing existing is altered.
--
-- expenses: one row per transaction. `kind` lets the same table hold income
-- so the page can show a net figure; amount is always positive and `kind`
-- carries the sign. Single-currency by design (the page's currency symbol is
-- a display preference stored in the browser, not a per-row column).
--
-- drug_log: one row per day the drug-of-the-day quiz was completed, so the
-- streak survives across devices. `studied_on` is unique -- retaking the quiz
-- the same day updates that day's row instead of adding another.
--
-- Same "personal app, no auth" model as every other table here -- see the
-- README's Security model section. NOTE: expenses are more sensitive than
-- workout data; with these policies anyone holding the (public) anon key can
-- read them. See README for how to tighten that.

create table if not exists expenses (
  id bigint generated always as identity primary key,
  spent_on date not null,
  amount numeric(14,2) not null check (amount >= 0),
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  category text,
  note text,
  created_at timestamptz default now()
);

create index if not exists expenses_spent_on_idx on expenses (spent_on);

alter table expenses enable row level security;
drop policy if exists "anon full access" on expenses;
create policy "anon full access" on expenses
  for all to anon using (true) with check (true);

create table if not exists drug_log (
  id bigint generated always as identity primary key,
  studied_on date not null unique,
  drug_id text not null,
  quiz_correct int,
  quiz_total int,
  created_at timestamptz default now()
);

alter table drug_log enable row level security;
drop policy if exists "anon full access" on drug_log;
create policy "anon full access" on drug_log
  for all to anon using (true) with check (true);
