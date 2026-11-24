-- The app no longer uses a duration (tasks have start and end dates). The empty column stays so an older cached page
-- that still asks for it keeps working instead of failing to load tasks.
alter table tasks add column if not exists duration_days int;
