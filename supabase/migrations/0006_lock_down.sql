-- Lock the database to a single signed-in owner.
--
-- Before this: every table had an "anon full access" policy, so anyone holding
-- the public anon key (it is embedded in the site's JavaScript) could read and
-- write everything. After this: rows belong to a user (user_id) and only that
-- user, signed in, can see or change them. The anon key alone gets nothing.
--
-- Run it AFTER signing in once on the site, so exactly one account exists to
-- adopt the existing rows. If there are zero or several accounts it refuses.

do $$
begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'expected exactly one auth user to own the existing data, found %',
      (select count(*) from auth.users);
  end if;
end $$;

do $$
declare
  t text;
  pol text;
  owner uuid := (select id from auth.users limit 1);
begin
  foreach t in array array[
    'body_weight', 'workout_sets', 'workout_sessions', 'exercise_catalog',
    'workout_routines', 'expenses', 'drug_log', 'kv_store'
  ] loop
    execute format(
      'alter table public.%I add column if not exists user_id uuid
         references auth.users (id) on delete cascade default auth.uid()', t);
    execute format('update public.%I set user_id = $1 where user_id is null', t) using owner;
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_id_idx', t);

    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol, t);
    end loop;
    execute format(
      'create policy "owner only" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
