-- Tasks: any hex colour, not just the nine named ones.
alter table tasks drop constraint if exists tasks_color_check;
alter table tasks add constraint tasks_color_check
  check (color ~ '^(#[0-9a-fA-F]{6}|red|orange|yellow|green|teal|blue|purple|pink|gray)$');
