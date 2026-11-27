-- Failed sign-in attempts, for rate limiting the shared-password gate (no passwords stored).
create table if not exists login_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on login_attempts (ip, at);
alter table login_attempts enable row level security;
