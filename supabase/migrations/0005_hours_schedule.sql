-- Frame Hub: daily hour logging, reminders to log hours, and the project schedule.
-- Additive only: existing tables keep their columns and data; imported weekly log rows are untouched.

-- ---------------------------------------------------------------- team: expected hours + reminders
alter table team_members add column if not exists hours_per_day numeric(5,2) not null default 8;
alter table team_members add column if not exists work_days int[] not null default '{1,2,3,4,5}';   -- ISO weekdays, 1 = Monday
alter table team_members add column if not exists track_hours boolean not null default true;        -- counted in missing-hours checks
alter table team_members add column if not exists remind_enabled boolean not null default true;     -- "Log your hours" event in their calendar feed
alter table team_members add column if not exists remind_time text not null default '16:30';        -- Pacific wall-clock time
alter table team_members add column if not exists remind_seq int not null default 0;                -- iCalendar SEQUENCE for the reminder
alter table team_members drop constraint if exists team_members_remind_time_check;
alter table team_members add constraint team_members_remind_time_check check (remind_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table team_members drop constraint if exists team_members_hours_check;
alter table team_members add constraint team_members_hours_check check (hours_per_day >= 0 and hours_per_day <= 24);

-- ---------------------------------------------------------------- time entries: the day, who, who typed it
-- work_date = the day worked (app entries). Imported spreadsheet rows keep only week_ending ("Thru" Friday).
-- App entries also get week_ending = that week's Friday and week_label "Thru M/D/YY", so the weekly log and
-- job cost (hours completed = sum of the log) work the same for both.
alter table time_entries add column if not exists work_date date;
alter table time_entries add column if not exists member_id uuid references team_members(id) on delete set null;
alter table time_entries add column if not exists entered_by text;   -- signed-in first name; only they can edit/delete it
alter table time_entries add column if not exists updated_at timestamptz not null default now();
create index if not exists time_entries_project_idx on time_entries (project_id);
create index if not exists time_entries_member_day_idx on time_entries (member_id, work_date);
create index if not exists time_entries_day_idx on time_entries (work_date) where work_date is not null;

update time_entries t set member_id = m.id from team_members m
 where t.member_id is null and t.person is not null and lower(trim(t.person)) = lower(m.first_name);

drop trigger if exists time_entries_updated on time_entries;
create trigger time_entries_updated before update on time_entries for each row execute function set_updated_at();

-- ---------------------------------------------------------------- schedule
alter table project_phases add column if not exists start_date date;   -- planned start (null = right after the previous phase)

-- Who works on a phase and how much of their week it gets. Neither hours_per_week nor allocation_pct = "auto"
-- (an even share of the capacity they have left).
create table if not exists project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  phase text not null,
  member_id uuid not null references team_members(id) on delete cascade,
  hours_per_week numeric(6,2) check (hours_per_week is null or (hours_per_week >= 0 and hours_per_week <= 168)),
  allocation_pct numeric(6,4) check (allocation_pct is null or (allocation_pct >= 0 and allocation_pct <= 1)),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, phase, member_id)
);
create index if not exists project_assignments_member_idx on project_assignments (member_id);
drop trigger if exists project_assignments_updated on project_assignments;
create trigger project_assignments_updated before update on project_assignments for each row execute function set_updated_at();

do $$ declare t text; begin
  foreach t in array array['project_assignments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (app_current_role() is not null)', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_write on %I for all to authenticated using (app_current_role() in (''owner'',''admin'',''staff'')) with check (app_current_role() in (''owner'',''admin'',''staff''))', t, t);
  end loop;
end $$;
