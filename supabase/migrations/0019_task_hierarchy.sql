-- Tasks: nesting (parent_id), a backlog of unscheduled sub-tasks (period_start may be null), optional deadline.
alter table tasks add column if not exists parent_id bigint references tasks (id) on delete cascade;
alter table tasks add column if not exists due_on date;
alter table tasks alter column period_start drop not null;
create index if not exists tasks_parent_idx on tasks (parent_id);
