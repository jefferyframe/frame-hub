-- Frame Hub — core schema (Postgres / Supabase)
-- One record per real thing, linked: proposal -> opportunity -> project.
-- Money is numeric(14,2); hours numeric(10,2); percentages are fractions (0.05 = 5%).

-- gen_random_uuid() is built in (PG13+); no extensions needed.

-- ---------------------------------------------------------------- people & access
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  initials text,
  role text not null default 'staff' check (role in ('owner','admin','staff','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Firm-wide settings (single row, key/value so new knobs need no migration)
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- CRM
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'client' check (kind in ('client','prospect','consultant','contractor','cre_firm','partner','other')),
  phone text,
  address text,
  website text,
  notes text,
  qb_customer_id text,                      -- QuickBooks seam
  source_key text unique,                   -- idempotent import key
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists companies_name_idx on companies (lower(name));

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  first_name text,
  last_name text,
  full_name text generated always as (trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) stored,
  title text,
  email text,
  phone text,
  address text,
  birthday date,
  best_contact_method text,
  is_past_client boolean not null default false,
  past_client_since date,                    -- "Date Added to List" → drives 1/2/6-month cadence
  linkedin_connected text,                   -- Prospects Met: "Requested Connection on LinkedIn"
  card_sent text,
  met_on date,                               -- Prospects Met: "Date of Meeting"
  notes text,
  source_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_email_idx on contacts (lower(email));

-- Pipeline statuses mirror the sales sheet's dropdown, in its sort order.
create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  job_number text,                           -- NN-NN, may be blank before a number is issued
  name text not null,                        -- "Client Name/Project Name"
  status text not null default 'Proposal Needed' check (status in (
    'Proposal Needed','Consultant Outreach','Internal Review','Presented',
    'Follow Up 1','Follow Up 1 Completed','Follow Up 2','Follow Up 2 Completed',
    'Sold','Project Completed','Rejected')),
  company_id uuid references companies(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  contact_text text,                         -- free text "Contact Person" as typed in the sheet
  best_contact_method text,
  project_type text,
  project_detail text,
  date_received date,
  construction_start date,
  date_presented date,
  follow_up_1_date date, follow_up_1_by text, follow_up_1_result text,
  follow_up_2_date date, follow_up_2_by text, follow_up_2_result text,
  subs_cost numeric(14,2),
  design_fee numeric(14,2),
  total_bid_override numeric(14,2),          -- sheet rows where Total Bid was typed, not =Z+AA
  projected_arch_hours numeric(10,2),
  owner_id uuid references app_users(id) on delete set null,
  proposal_id uuid,                          -- FK added after proposals exists
  closed_at timestamptz,
  source_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists opportunities_status_idx on opportunities (status);

-- Daily lead measures (one row per day)
create table if not exists lead_measures (
  day date primary key,
  connection_requests int not null default 0,
  responses int not null default 0,
  conversations int not null default 0,
  opportunities int not null default 0,
  proposals int not null default 0,
  yes int not null default 0,
  no int not null default 0,
  updated_at timestamptz not null default now()
);

-- Lag measures (opportunity outcomes; options from the sheet's Data tab)
create table if not exists lag_measures (
  id uuid primary key default gen_random_uuid(),
  day date,
  project_number text,
  opportunity text not null,
  status text not null check (status in ('Opportunity','Investigation','Pitching','Won','Lost')),
  notes text,
  source_key text unique,
  created_at timestamptz not null default now()
);

-- Outreach / biz-dev log: CRE firm presentations, bagel deliveries, direct sales, biz-dev notes
create table if not exists outreach (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cre_firm','bagels','direct_sales','biz_dev','other')),
  company_id uuid references companies(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  label text not null,                       -- company / firm name as written
  day date,
  period text,                               -- e.g. "October 2026" for biz-dev notes
  status text,                               -- e.g. "Date booked" text for CRE firms
  phone text,
  address text,
  notes text,
  author text,
  source_key text unique,
  created_at timestamptz not null default now()
);

-- Follow-up tasks (manual and cadence-generated)
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  due_on date,
  done_at timestamptz,
  assignee text,
  cadence text,                              -- 'past_client_1m' | 'past_client_2m' | 'past_client_6m' | 'prospect_1m' | 'opp_follow_up_1' | ...
  contact_id uuid references contacts(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  project_id uuid,
  notes text,
  source_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists tasks_due_idx on tasks (due_on) where done_at is null;

-- ---------------------------------------------------------------- proposals
create table if not exists line_item_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('phase','consultant','additional_service','reimbursable','exclusion','clause')),
  key text,
  label text not null,
  description text,
  default_pct numeric(8,5),                  -- phase % of architectural fee, or discipline % suggestion
  default_amount numeric(14,2),
  unit text,
  sort int not null default 0,
  active boolean not null default true,
  unique (kind, label)
);

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  number text not null,                      -- P-YYNN; versions share a number
  version int not null default 1,
  parent_id uuid references proposals(id) on delete set null,   -- previous version
  is_current boolean not null default true,
  status text not null default 'draft' check (status in ('draft','in_review','approved','sent','viewed','accepted','declined','superseded')),
  title text not null,
  company_id uuid references companies(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  client jsonb not null default '{}'::jsonb,           -- snapshot {name, contact_name, contact_title, email, phone} (old tool shape)
  project_name text,
  address text,
  project_type text,                         -- sales-sheet Project Type (Office, Healthcare, …)
  building_type text,                        -- old quoting tool's building_type (medical, multifamily, …)
  delivery_type text,                        -- old tool's delivery_type (tenant_improvement, new_construction, …)
  construction_cost numeric(14,2),
  fee_basis text not null default 'fixed' check (fee_basis in ('fixed','pct_construction','hourly_nte')),
  arch_fee numeric(14,2),                    -- architectural base fee
  arch_target_pct numeric(8,5) default 0.05, -- % of construction (old tool default 5%)
  scope_text_raw text,
  scope_text text,                           -- polished scope narrative
  phase_narrative jsonb not null default '{}'::jsonb,
  exclusions text,
  terms text,
  valid_until date,
  precedents_used jsonb,
  public_token text unique default replace(gen_random_uuid()::text, '-', ''),
  approved_at timestamptz,                   -- internal sign-off; fee edits after approval un-approve (old tool rule)
  approved_by text,
  sent_at timestamptz, viewed_at timestamptz, accepted_at timestamptz, declined_at timestamptz,
  accepted_by_name text,
  opportunity_id uuid references opportunities(id) on delete set null,
  legacy_quote_id uuid unique,               -- id from the old frame-quoting app, if imported
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (number, version)
);

create table if not exists proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  kind text not null check (kind in ('phase','consultant','additional_service','reimbursable','exclusion')),
  label text not null,
  description text,
  pct numeric(8,5),                          -- phase: share of arch fee
  amount numeric(14,2),                      -- explicit amount (consultants, add services); phases computed if null
  hours numeric(10,2),
  included boolean not null default true,
  optional boolean not null default false,   -- shown as an option the client can add
  sort int not null default 0
);
create index if not exists proposal_items_p_idx on proposal_items (proposal_id, sort);

create table if not exists fee_precedents (     -- old tool's archive_index, kept for fee suggestions
  id uuid primary key default gen_random_uuid(),
  file text not null,
  is_frame_proposal boolean not null default true,
  project_number text, project_name text,
  building_type text, delivery_type text,
  disciplines text[] default '{}',
  construction_cost numeric, total_fee numeric,
  fee_range_low numeric, fee_range_high numeric, fee_pct_of_construction numeric,
  discipline_fees jsonb, phases text[] default '{}',
  notable_scope_language text, notes text,
  category text,                             -- normalized building category (classifyBuilding) for matching
  fee_pct_derived boolean not null default false, -- fee % computed here from total_fee ÷ construction_cost
  legacy_id uuid unique,                     -- archive_index.id from the old tool
  created_at timestamptz not null default now()
);

alter table opportunities drop constraint if exists opportunities_proposal_fk;
alter table opportunities add constraint opportunities_proposal_fk foreign key (proposal_id) references proposals(id) on delete set null;

-- ---------------------------------------------------------------- projects (job cost)
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique,           -- NN-NN (YY-seq), sub-jobs NN-NN.N
  name text not null,
  status text not null default 'active' check (status in ('active','on_hold','phase_complete','closeout','archived')),
  current_phase text,
  lead text,
  team text,
  contract_date date,
  company_id uuid references companies(id) on delete set null,
  client_text text,
  client_contact text,
  client_contact_2 text,
  contractor text,
  contractor_contact text,
  arch_fee numeric(14,2),                    -- template B10
  profit_pct numeric(6,4) not null default 0.85,   -- template E30 ("Profit Percentage"; see README)
  burden_rate numeric(10,2) not null default 180,  -- template E33
  billing_notes text,                        -- Job List "Notes" (e.g. QB)
  notes text,                                -- Job List "Additional Notes"
  opportunity_id uuid references opportunities(id) on delete set null,
  proposal_id uuid references proposals(id) on delete set null,
  closeout_at timestamptz,
  archived_at timestamptz,
  qb_customer_id text, qb_project_id text,   -- QuickBooks seam
  source_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The 9 phase blocks of the job cost template
create table if not exists project_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  phase text not null,                       -- 'Pre Design' ... 'Interior Design'
  sort int not null,
  fee_pct numeric(8,5),                      -- row 12: share of arch fee
  arch_fee numeric(14,2),                    -- row 10 C..K (explicit) — null means fee_pct × arch fee
  hours_pct numeric(8,5),                    -- row 7: share of hours allowance
  hours_assigned numeric(10,2),
  target_date date,
  status text not null default 'not_started' check (status in ('not_started','active','complete')),
  unique (project_id, phase)
);

-- Consultant fees by discipline × phase (template rows 13-26) and their status per phase
create table if not exists project_consultants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  discipline text not null,                  -- Civil, Landscape, Structural, ...
  firm text,
  phase text not null,
  fee numeric(14,2),
  status text check (status in ('On Task','Off Task','Complete')),
  unique (project_id, discipline, phase)
);

-- Weekly hours log (template rows 31-430, one block per phase)
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  phase text not null,
  week_label text,                           -- as written ("Thru 1/5/26", "Week 3")
  week_ending date,
  person text,
  hours numeric(10,2) not null default 0,
  notes text,
  source_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists time_entries_proj_idx on time_entries (project_id, phase);

alter table tasks drop constraint if exists tasks_project_fk;
alter table tasks add constraint tasks_project_fk foreign key (project_id) references projects(id) on delete cascade;

-- ---------------------------------------------------------------- audit trail
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  entity text not null,                      -- 'proposal' | 'opportunity' | 'project' | ...
  entity_id uuid not null,
  action text not null,                      -- 'create' | 'update' | 'status' | 'convert' | 'import' ...
  summary text,
  data jsonb,
  related_entity text,
  related_id uuid
);
create index if not exists audit_entity_idx on audit_log (entity, entity_id, at desc);
create index if not exists audit_related_idx on audit_log (related_entity, related_id);

create table if not exists import_runs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null,
  report jsonb not null
);

-- keep updated_at current
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

do $$ declare t text; begin
  foreach t in array array['companies','contacts','opportunities','proposals','projects'] loop
    execute format('drop trigger if exists %I_updated on %I', t, t);
    execute format('create trigger %I_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
