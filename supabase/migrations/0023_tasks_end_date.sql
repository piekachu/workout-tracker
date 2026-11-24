-- Tasks have a start date and an optional end date (the deadline) instead of a duration.
-- duration_min is left in place, unused, so nothing is lost.
alter table tasks add column if not exists end_on date;
update tasks set end_on = period_start + (duration_days - 1) where duration_days > 1 and period_start is not null and end_on is null;
alter table tasks drop column if exists duration_days;
alter table tasks drop constraint if exists tasks_end_after_start;
alter table tasks add constraint tasks_end_after_start check (end_on is null or period_start is null or end_on >= period_start);
