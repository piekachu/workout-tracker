-- Toy collection checklist (Gundam Converge). The catalogue itself is a static
-- file in the site (collection/catalog.json); this table holds only YOUR marks,
-- one row per figure you own or want. Owner-only, same rule as migration 0006.

create table if not exists collection (
  item_id text not null,
  status text not null check (status in ('owned', 'wishlist')),
  updated_at timestamptz default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, item_id)
);

alter table collection enable row level security;
drop policy if exists "owner only" on collection;
create policy "owner only" on collection for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on collection from anon;
