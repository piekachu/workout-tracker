-- Collection: a price for a whole set/release (e.g. a CORE or EX set) instead of per figure.
create table if not exists collection_sets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  series_name text not null,                      -- the release name in catalog.json
  price numeric(12, 2) not null check (price >= 0),
  qty int not null default 1 check (qty >= 1),
  bought_on date,
  primary key (user_id, series_name)
);
alter table collection_sets enable row level security;
drop policy if exists "owner only" on collection_sets;
create policy "owner only" on collection_sets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on collection_sets from anon;
