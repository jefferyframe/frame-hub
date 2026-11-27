-- Frame Hub CRM: team members, activity timeline, richer tasks/reminders, calendar feeds.
-- Additive only: existing tables keep their columns and data.

-- ---------------------------------------------------------------- team
-- Who tasks can be assigned to. The signed-in first name maps to a member by first_name.
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,                        -- as shown ("Jeff Frame" or just "Jeff")
  first_name text not null,                  -- matching key for the sign-in name (case-insensitive)
  email text,
  role text not null default 'Staff',
  active boolean not null default true,
  sort int not null default 0,
  -- Calendar feed: a long random token per person. Only its SHA-256 is used to look it up;
  -- the token itself is kept encrypted (AES-GCM, key derived from SESSION_SECRET) so Settings can show it again.
  cal_token_hash text unique,
  cal_token_enc text,
  cal_token_created_at timestamptz,
  cal_include_unassigned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists team_members_first_idx on team_members (lower(first_name));

-- Seeded from the Job List leads / teams. Emails are added in Settings.
insert into team_members (name, first_name, role, sort, cal_include_unassigned) values
  ('Jeff', 'Jeff', 'Principal', 1, true),
  ('Bella', 'Bella', 'Staff', 2, false),
  ('June', 'June', 'Staff', 3, false),
  ('Roy', 'Roy', 'Staff', 4, false),
  ('Troy', 'Troy', 'Staff', 5, false),
  ('Brandon', 'Brandon', 'Staff', 6, false),
  ('Jaden', 'Jaden', 'Staff', 7, false),
  ('Emily', 'Emily', 'Staff', 8, false),
  ('Mathew', 'Mathew', 'Staff', 9, false)
on conflict (lower(first_name)) do nothing;
update team_members set email = 'jframe@framearchitecture.com', name = 'Jeff Frame' where lower(first_name) = 'jeff' and email is null;

-- ---------------------------------------------------------------- deals: owner
alter table opportunities add column if not exists owner_member_id uuid references team_members(id) on delete set null;

-- ---------------------------------------------------------------- tasks & reminders
alter table tasks add column if not exists due_at timestamptz;              -- date + time; null time = all-day on due_on
alter table tasks add column if not exists owner_id uuid references team_members(id) on delete set null;
alter table tasks add column if not exists kind text not null default 'todo';
alter table tasks add column if not exists priority text not null default 'normal';
alter table tasks add column if not exists reminder_minutes int default 15;  -- VALARM before the due time (all-day: 9 am that day)
alter table tasks add column if not exists company_id uuid references companies(id) on delete cascade;
alter table tasks add column if not exists created_by text;
alter table tasks add column if not exists snoozed_count int not null default 0;
alter table tasks add column if not exists sequence int not null default 0;  -- iCalendar SEQUENCE, bumped on every change
alter table tasks add column if not exists updated_at timestamptz not null default now();
alter table tasks drop constraint if exists tasks_kind_check;
alter table tasks add constraint tasks_kind_check check (kind in ('todo','call','email','meeting'));
alter table tasks drop constraint if exists tasks_priority_check;
alter table tasks add constraint tasks_priority_check check (priority in ('low','normal','high'));
create index if not exists tasks_owner_idx on tasks (owner_id) where done_at is null;

-- earlier free-text assignees → team members, by first name
update tasks t set owner_id = m.id from team_members m
 where t.owner_id is null and t.assignee is not null and lower(split_part(trim(t.assignee), ' ', 1)) = lower(m.first_name);

drop trigger if exists tasks_updated on tasks;
create trigger tasks_updated before update on tasks for each row execute function set_updated_at();
drop trigger if exists team_members_updated on team_members;
create trigger team_members_updated before update on team_members for each row execute function set_updated_at();

-- ---------------------------------------------------------------- activity timeline
-- Notes, calls, emails (logged by hand), meetings, stage changes and task events on a record.
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('note','call','email','meeting','task','stage')),
  subject text,
  body text,
  outcome text,                               -- calls: connected / left voicemail / no answer …
  direction text check (direction in ('inbound','outbound')),
  duration_min int,
  occurred_at timestamptz not null default now(),
  author text not null,                       -- signed-in first name
  company_id uuid references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists activities_opp_idx on activities (opportunity_id, occurred_at desc);
create index if not exists activities_contact_idx on activities (contact_id, occurred_at desc);
create index if not exists activities_company_idx on activities (company_id, occurred_at desc);

-- RLS like every other table (the server connects as the owner role and bypasses it)
do $$ declare t text; begin
  foreach t in array array['team_members','activities'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (app_current_role() is not null)', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_write on %I for all to authenticated using (app_current_role() in (''owner'',''admin'',''staff'')) with check (app_current_role() in (''owner'',''admin'',''staff''))', t, t);
  end loop;
end $$;
