-- Tasks no longer have a scope (day / week / month). A task starts on a date (period_start) and may last
-- several days (duration_days); the end of that span is its deadline. Old week/month tasks become multi-day tasks.
alter table tasks add column if not exists duration_days int check (duration_days between 1 and 3650);

-- a start date set on its own becomes the task's date
update tasks set period_start = start_on where start_on is not null and period_start is not null;
-- week / month scoped tasks span their whole week / month
update tasks set duration_days = 7 where horizon = 'week' and duration_days is null and period_start is not null;
update tasks set duration_days = extract(day from (date_trunc('month', period_start) + interval '1 month' - interval '1 day'))::int
  where horizon = 'month' and duration_days is null and period_start is not null;
-- an old deadline becomes the end of the span
update tasks set duration_days = (due_on - period_start) + 1
  where due_on is not null and period_start is not null and due_on > period_start and duration_days is null;
update tasks set horizon = 'day' where horizon <> 'day';
