-- Tasks: optional duration (minutes) and an optional colour label.
alter table tasks add column if not exists duration_min int check (duration_min between 1 and 1440);
alter table tasks add column if not exists color text
  check (color in ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'));
