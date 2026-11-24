-- Tasks: a work timer. time_spent_sec is banked time; timer_started_at is set while the timer is running.
alter table tasks add column if not exists time_spent_sec int not null default 0 check (time_spent_sec >= 0);
alter table tasks add column if not exists timer_started_at timestamptz;
