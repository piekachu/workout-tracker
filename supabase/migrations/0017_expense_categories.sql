-- Expenses: user-editable category lists (per kind). Empty = app falls back to its built-in defaults.
create table if not exists expense_categories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null check (length(name) between 1 and 40),
  sort_order int not null default 0,
  primary key (user_id, kind, name)
);
alter table expense_categories enable row level security;
drop policy if exists "owner only" on expense_categories;
create policy "owner only" on expense_categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on expense_categories from anon;
