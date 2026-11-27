-- Row level security. The app server talks to Postgres with the service role
-- (bypasses RLS); these policies protect the database if anyone ever connects
-- with the anon/authenticated keys (Supabase client, PostgREST).
-- Rule: only signed-in, active app users (matched by email) can read/write;
-- viewers read only. Anonymous users get nothing (public proposal pages are
-- served by the server by token, never by direct table access).

create or replace function app_current_role() returns text
language sql stable security definer as $$
  select role from app_users
  where active and lower(email) = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))  -- = auth.jwt() ->> 'email'
  limit 1
$$;
-- pin the function to the schema the app lives in (public locally, "hub" on Supabase)
do $$ begin execute format('alter function app_current_role() set search_path = %I', current_schema()); end $$;

do $$ declare t text; begin
  foreach t in array array['app_users','settings','companies','contacts','opportunities','lead_measures',
    'lag_measures','outreach','tasks','line_item_templates','proposals','proposal_items','fee_precedents',
    'projects','project_phases','project_consultants','time_entries','audit_log','import_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (app_current_role() is not null)', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_write on %I for all to authenticated using (app_current_role() in (''owner'',''admin'',''staff'')) with check (app_current_role() in (''owner'',''admin'',''staff''))', t, t);
  end loop;
end $$;

-- audit log is append-only for app users
drop policy if exists audit_log_write on audit_log;
create policy audit_log_insert on audit_log for insert to authenticated with check (app_current_role() in ('owner','admin','staff'));
-- settings & users: admins only
drop policy if exists settings_write on settings;
create policy settings_write on settings for all to authenticated using (app_current_role() in ('owner','admin')) with check (app_current_role() in ('owner','admin'));
drop policy if exists app_users_write on app_users;
create policy app_users_write on app_users for all to authenticated using (app_current_role() in ('owner','admin')) with check (app_current_role() in ('owner','admin'));
