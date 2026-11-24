-- Tasks: manual ordering (drag to reorder / move up-down). NULL = not ordered by hand yet.
alter table tasks add column if not exists sort_order double precision;
