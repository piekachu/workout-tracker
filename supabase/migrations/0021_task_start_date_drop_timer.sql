-- Tasks: a start date for projects (next to the existing deadline, due_on); the work timer is gone.
alter table tasks add column if not exists start_on date;
alter table tasks drop column if exists time_spent_sec;
alter table tasks drop column if exists timer_started_at;
