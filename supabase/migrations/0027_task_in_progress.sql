-- Tasks: an "in progress" state between not-started and done (done is still done_at).
alter table tasks add column if not exists in_progress boolean not null default false;
