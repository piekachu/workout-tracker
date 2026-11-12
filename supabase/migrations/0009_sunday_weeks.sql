-- Weeks now start on Sunday. A week task is anchored on its week's first day
-- (tasks.period_start), which used to be a Monday; move existing ones back one
-- day so they stay in the same week. Idempotent: only touches rows that still
-- sit on a Monday (extract(dow) = 1).
update tasks
set period_start = period_start - 1
where horizon = 'week' and extract(dow from period_start) = 1;
