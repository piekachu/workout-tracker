-- Collection: your own edits and additions, layered over the static catalogue.
--   collection_edits  overrides of a catalogue figure's name / number / category
--   collection_added  figures you add yourself
--   collection_cats   your own category names
-- Owner-only like every other table (migration 0006 rule).

create table if not exists collection_edits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id text not null,
  name text, no text, cat text,
  updated_at timestamptz default now(),
  primary key (user_id, item_id)
);
create table if not exists collection_added (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null default ('u_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null, no text, cat text,
  series_name text not null default 'My additions',
  created_at timestamptz default now(),
  primary key (user_id, id)
);
create table if not exists collection_cats (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  primary key (user_id, name)
);

do $$
declare t text;
begin
  foreach t in array array['collection_edits', 'collection_added', 'collection_cats'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner only" on %I', t);
    execute format('create policy "owner only" on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;
