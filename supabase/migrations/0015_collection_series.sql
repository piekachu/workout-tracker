-- Collection: editable series (franchise) list.
--   name = the series name shown; orig = the built-in series it renames (null = a series you made up).
create table if not exists collection_series (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  orig text,
  primary key (user_id, name)
);
alter table collection_series enable row level security;
drop policy if exists "owner only" on collection_series;
create policy "owner only" on collection_series for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on collection_series from anon;
