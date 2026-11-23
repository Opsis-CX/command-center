-- ============================================================
-- INTEGRATIONS (staging 2026-11-23). Run after 28.
-- One place to connect outside tools (Five9, BigQuery, HubSpot, phone systems, payroll, analytics…).
--   integration_catalog — every tool we know about: the fields it needs, what it can do, whether it's ready.
--   integrations        — a company's saved connections. Secrets live in Supabase Vault, never in this table;
--                         only the last 4 characters are kept for display.
--   integration_log     — who connected / changed / tested / removed what, and requests for new tools.
-- org_id is here for multi-company Command Center; it's null (this company) until organizations exist.
-- Gate: "Connect and manage integrations" (admin.integrations) or an access owner.
-- ============================================================
update public.perm_catalog set label = 'Connect and manage integrations (API keys for Five9, BigQuery, HubSpot…)' where key = 'admin.integrations';

create table if not exists public.integration_catalog (
  key text primary key,
  name text not null,
  category text not null,
  description text not null default '',
  icon text not null default '🔌',
  fields jsonb not null default '[]',        -- [{key,label,type:text|password|textarea|select,secret,required,help,options,placeholder}]
  capabilities text[] not null default '{}',
  available boolean not null default false,  -- true = we can test and use it today
  auth_type text not null default 'api_key', -- api_key | basic | service_account | oauth (oauth = later)
  docs_url text,
  sort int not null default 0);
alter table public.integration_catalog enable row level security;
drop policy if exists integration_catalog_read on public.integration_catalog;
create policy integration_catalog_read on public.integration_catalog for select to authenticated using (true);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,                                -- multi-company later; null = this company
  provider text not null references public.integration_catalog(key),
  label text not null check (length(btrim(label)) between 1 and 80),
  config jsonb not null default '{}',         -- non-secret settings (region, project id, account sid…)
  vault_secret_id uuid,                       -- secrets JSON in vault.secrets
  secret_hint text,                           -- e.g. "••••7Kd2"
  status text not null default 'untested' check (status in ('untested','connected','error','disabled')),
  last_test_at timestamptz, last_error text, last_test_detail jsonb, last_sync_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists integrations_one_label on public.integrations (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, lower(label));
alter table public.integrations enable row level security;
-- no direct table access from the app: everything goes through the functions below
drop policy if exists integrations_none on public.integrations;

create table if not exists public.integration_log (
  id bigserial primary key,
  integration_id uuid, provider text, action text not null, ok boolean, detail text,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now());
alter table public.integration_log enable row level security;

create or replace function public.integrations_can_manage() returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.is_access_owner(), false) or coalesce(public.has_perm('admin.integrations'), false)
$$;

-- page data: the catalog + this company's connections (never the secrets) + recent activity
create or replace function public.integrations_list() returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.integrations_can_manage() then raise exception 'You don''t have permission to manage integrations.'; end if;
  return jsonb_build_object(
    'catalog', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.name) from public.integration_catalog c), '[]'),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'provider', i.provider, 'label', i.label, 'config', i.config,
        'secret_hint', i.secret_hint, 'status', i.status, 'last_test_at', i.last_test_at, 'last_error', i.last_error,
        'last_test_detail', i.last_test_detail, 'last_sync_at', i.last_sync_at, 'created_at', i.created_at,
        'created_by_name', (select full_name from public.profiles where id = i.created_by)) order by i.created_at)
      from public.integrations i), '[]'),
    'log', coalesce((select jsonb_agg(x order by x.at desc) from (select l.at, l.provider, l.action, l.ok, l.detail,
        (select full_name from public.profiles where id = l.actor) as actor_name from public.integration_log l order by l.at desc limit 40) x), '[]'));
end $$;

-- add or update a connection. p_secrets = {field: value} for secret fields; empty values keep what's saved.
create or replace function public.integration_save(p_id uuid, p_provider text, p_label text, p_config jsonb, p_secrets jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare c public.integration_catalog; r public.integrations; f jsonb; merged jsonb := '{}'; prev jsonb := '{}'; v text; hint text; sid uuid; new_id uuid;
begin
  if not public.integrations_can_manage() then raise exception 'You don''t have permission to manage integrations.'; end if;
  select * into c from public.integration_catalog where key = p_provider;
  if not found then raise exception 'Unknown tool.'; end if;
  if not c.available then raise exception '% isn''t ready to connect yet.', c.name; end if;
  if p_id is not null then
    select * into r from public.integrations where id = p_id and provider = p_provider;
    if not found then raise exception 'That connection no longer exists.'; end if;
    if r.vault_secret_id is not null then
      select coalesce(decrypted_secret, '{}')::jsonb into prev from vault.decrypted_secrets where id = r.vault_secret_id;
    end if;
  end if;
  -- secret fields: new value wins, blank keeps the saved one; required fields must end up filled
  for f in select * from jsonb_array_elements(c.fields) loop
    if coalesce((f->>'secret')::boolean, false) then
      v := nullif(btrim(coalesce(p_secrets->>(f->>'key'), '')), '');
      if v is null then v := prev->>(f->>'key'); end if;
      if v is not null and left(v, 1) = '{' then
        begin perform v::jsonb; exception when others then raise exception '% isn''t valid JSON — paste the whole key file.', f->>'label'; end;
      end if;
      if v is not null then merged := merged || jsonb_build_object(f->>'key', v);
        if hint is null then hint := case when left(v, 1) = '{' then coalesce(v::jsonb->>'client_email', 'key saved') else '••••' || right(v, 4) end; end if; end if;
      if v is null and coalesce((f->>'required')::boolean, false) then raise exception '% is required.', f->>'label'; end if;
    elsif coalesce((f->>'required')::boolean, false) and nullif(btrim(coalesce(p_config->>(f->>'key'), '')), '') is null then
      raise exception '% is required.', f->>'label';
    end if;
  end loop;
  -- keep only known non-secret fields in config
  p_config := coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(p_config, '{}')) e
    where exists (select 1 from jsonb_array_elements(c.fields) ff where ff->>'key' = e.key and not coalesce((ff->>'secret')::boolean, false))), '{}');
  if p_id is null then
    sid := case when merged = '{}' then null else vault.create_secret(merged::text, 'integration_' || gen_random_uuid()::text, 'Command Center integration: ' || c.name) end;
    insert into public.integrations (provider, label, config, vault_secret_id, secret_hint, created_by)
    values (p_provider, btrim(coalesce(nullif(p_label, ''), c.name)), p_config, sid, hint, auth.uid()) returning id into new_id;
    insert into public.integration_log (integration_id, provider, action, ok, detail, actor) values (new_id, p_provider, 'connected', true, btrim(coalesce(nullif(p_label, ''), c.name)), auth.uid());
    return new_id;
  else
    if r.vault_secret_id is null and merged <> '{}' then
      sid := vault.create_secret(merged::text, 'integration_' || p_id::text, 'Command Center integration: ' || c.name);
    elsif r.vault_secret_id is not null then
      perform vault.update_secret(r.vault_secret_id, merged::text); sid := r.vault_secret_id;
    end if;
    update public.integrations set label = btrim(coalesce(nullif(p_label, ''), c.name)), config = p_config, vault_secret_id = sid,
      secret_hint = coalesce(hint, secret_hint), status = 'untested', last_error = null, updated_at = now() where id = p_id;
    insert into public.integration_log (integration_id, provider, action, ok, detail, actor) values (p_id, p_provider, 'updated', true, btrim(coalesce(nullif(p_label, ''), c.name)), auth.uid());
    return p_id;
  end if;
end $$;

create or replace function public.integration_remove(p_id uuid) returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.integrations;
begin
  if not public.integrations_can_manage() then raise exception 'You don''t have permission to manage integrations.'; end if;
  select * into r from public.integrations where id = p_id;
  if not found then return; end if;
  if r.vault_secret_id is not null then delete from vault.secrets where id = r.vault_secret_id; end if;
  delete from public.integrations where id = p_id;
  insert into public.integration_log (integration_id, provider, action, ok, detail, actor) values (p_id, r.provider, 'removed', true, r.label, auth.uid());
end $$;

-- "Ask for this tool" on a coming-soon card
create or replace function public.integration_request(p_provider text, p_note text) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.integrations_can_manage() then raise exception 'You don''t have permission to manage integrations.'; end if;
  insert into public.integration_log (provider, action, ok, detail, actor) values (p_provider, 'requested', true, left(coalesce(p_note, ''), 500), auth.uid());
end $$;

-- server only: the edge function reads a connection with its secrets, then records the test result
create or replace function public.integration_for_server(p_id uuid) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('id', i.id, 'provider', i.provider, 'label', i.label, 'config', i.config,
    'secrets', coalesce((select decrypted_secret::jsonb from vault.decrypted_secrets where id = i.vault_secret_id), '{}'))
  from public.integrations i where i.id = p_id
$$;
create or replace function public.integration_record_test(p_id uuid, p_ok boolean, p_error text, p_detail jsonb, p_actor uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.integrations;
begin
  update public.integrations set status = case when p_ok then 'connected' else 'error' end, last_test_at = now(),
    last_error = case when p_ok then null else left(p_error, 500) end, last_test_detail = p_detail, updated_at = now()
  where id = p_id returning * into r;
  if found then insert into public.integration_log (integration_id, provider, action, ok, detail, actor) values (p_id, r.provider, 'tested', p_ok, case when p_ok then 'Connection works' else left(p_error, 300) end, p_actor); end if;
end $$;

revoke all on function public.integration_for_server(uuid) from public, anon, authenticated;
revoke all on function public.integration_record_test(uuid, boolean, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.integration_for_server(uuid) to service_role;
grant execute on function public.integration_record_test(uuid, boolean, text, jsonb, uuid) to service_role;
grant execute on function public.integrations_can_manage(), public.integrations_list(), public.integration_save(uuid, text, text, jsonb, jsonb),
  public.integration_remove(uuid), public.integration_request(text, text) to authenticated;

-- ---------- the catalog ----------
insert into public.integration_catalog (key, name, category, description, icon, fields, capabilities, available, auth_type, docs_url, sort) values
-- Contact center & telephony
('five9', 'Five9', 'Contact center & telephony', 'Live agent states, queue and today''s totals, plus any Five9 report on demand.', '☎️',
 '[{"key":"username","label":"API username","type":"text","required":true,"help":"A Five9 user made for Command Center, with the Supervisor role and reporting permissions."},
   {"key":"password","label":"API password","type":"password","secret":true,"required":true},
   {"key":"region","label":"Data center","type":"select","required":true,"options":[{"value":"us","label":"United States (api.five9.com)"},{"value":"eu","label":"Europe (api.five9.eu)"}]},
   {"key":"api_host","label":"API host (only if Five9 gave you a different one)","type":"text","placeholder":"api.five9.com"}]',
 '{"Live agent states","Queue / calls waiting","Today''s running totals","Run reports on demand","Campaigns, skills, dispositions"}', true, 'basic', 'https://www.five9.com/products/capabilities/apis-and-sdks', 10),
('twilio', 'Twilio', 'Contact center & telephony', 'Calls, recordings and SMS from your Twilio account.', '📞',
 '[{"key":"account_sid","label":"Account SID","type":"text","required":true,"placeholder":"AC…"},
   {"key":"auth_token","label":"Auth token","type":"password","secret":true,"required":true}]',
 '{"Call logs","Recordings","SMS"}', true, 'basic', 'https://www.twilio.com/docs/usage/api', 20),
('ringcentral', 'RingCentral', 'Contact center & telephony', 'Call logs and recordings.', '📞', '[]', '{"Call logs","Recordings"}', false, 'oauth', null, 30),
('zoom_phone', 'Zoom Phone', 'Contact center & telephony', 'Call logs and recordings.', '📞', '[]', '{"Call logs","Recordings"}', false, 'oauth', null, 31),
('aircall', 'Aircall', 'Contact center & telephony', 'Calls, recordings and users.', '📞', '[]', '{"Call logs","Recordings"}', false, 'api_key', null, 32),
('dialpad', 'Dialpad', 'Contact center & telephony', 'Calls, recordings and AI notes.', '📞', '[]', '{"Call logs","Recordings"}', false, 'api_key', null, 33),
('genesys', 'Genesys Cloud', 'Contact center & telephony', 'Agent states, queues, interactions and reports.', '☎️', '[]', '{"Live agent states","Queues","Reports"}', false, 'oauth', null, 34),
('nice_cxone', 'NICE CXone', 'Contact center & telephony', 'Agent states, contacts and reports.', '☎️', '[]', '{"Live agent states","Contacts","Reports"}', false, 'oauth', null, 35),
('talkdesk', 'Talkdesk', 'Contact center & telephony', 'Calls, agents and reports.', '☎️', '[]', '{"Calls","Agents","Reports"}', false, 'oauth', null, 36),
('eight_x_eight', '8x8', 'Contact center & telephony', 'Call logs and contact center stats.', '☎️', '[]', '{"Call logs","Stats"}', false, 'api_key', null, 37),
('vonage', 'Vonage', 'Contact center & telephony', 'Calls and recordings.', '☎️', '[]', '{"Call logs","Recordings"}', false, 'api_key', null, 38),
('lightspeed', 'LightSpeed Voice', 'Contact center & telephony', 'Call records and recordings.', '☎️', '[]', '{"Call records","Recordings"}', false, 'api_key', null, 39),
-- Data & analytics
('bigquery', 'Google BigQuery', 'Data & analytics', 'Read your BigQuery tables (Five9 exports, CRM data, anything you keep there).', '📊',
 '[{"key":"project_id","label":"Project ID","type":"text","required":true,"placeholder":"my-project-123"},
   {"key":"dataset","label":"Default dataset (optional)","type":"text"},
   {"key":"service_account_json","label":"Service account key (JSON)","type":"textarea","secret":true,"required":true,"help":"Create a service account with BigQuery Data Viewer + Job User, then paste its JSON key."}]',
 '{"Query tables","Feed reports and scorecards"}', true, 'service_account', 'https://cloud.google.com/bigquery/docs/authentication/service-account-file', 100),
('snowflake', 'Snowflake', 'Data & analytics', 'Query your Snowflake warehouse.', '📊', '[]', '{"Query tables"}', false, 'api_key', null, 110),
('ga4', 'Google Analytics 4', 'Data & analytics', 'Website traffic and conversions.', '📈', '[]', '{"Traffic","Conversions"}', false, 'oauth', null, 120),
('power_bi', 'Power BI', 'Data & analytics', 'Push Command Center data to Power BI.', '📈', '[]', '{"Datasets"}', false, 'oauth', null, 130),
('looker', 'Looker / Looker Studio', 'Data & analytics', 'Share Command Center data with Looker.', '📈', '[]', '{"Datasets"}', false, 'oauth', null, 140),
-- CRM & sales
('hubspot', 'HubSpot', 'CRM & sales', 'Contacts, companies and deals.', '🧲',
 '[{"key":"access_token","label":"Private app access token","type":"password","secret":true,"required":true,"placeholder":"pat-…","help":"HubSpot → Settings → Integrations → Private apps → create one with CRM read scopes."}]',
 '{"Contacts","Companies","Deals"}', true, 'api_key', 'https://developers.hubspot.com/docs/api/private-apps', 200),
('salesforce', 'Salesforce', 'CRM & sales', 'Accounts, contacts and opportunities.', '🧲', '[]', '{"Accounts","Contacts","Opportunities"}', false, 'oauth', null, 210),
('zoho_crm', 'Zoho CRM', 'CRM & sales', 'Leads, contacts and deals.', '🧲', '[]', '{"Leads","Deals"}', false, 'oauth', null, 220),
-- Payroll & HR
('gusto', 'Gusto', 'Payroll & HR', 'Employees, hours and payroll.', '💵', '[]', '{"Employees","Hours","Payroll"}', false, 'oauth', null, 300),
('adp', 'ADP', 'Payroll & HR', 'Workers, time and payroll.', '💵', '[]', '{"Workers","Time","Payroll"}', false, 'oauth', null, 310),
('rippling', 'Rippling', 'Payroll & HR', 'Employees, time and payroll.', '💵', '[]', '{"Employees","Time","Payroll"}', false, 'api_key', null, 320),
('paychex', 'Paychex', 'Payroll & HR', 'Workers and payroll.', '💵', '[]', '{"Workers","Payroll"}', false, 'oauth', null, 330),
-- Accounting
('quickbooks', 'QuickBooks Online', 'Accounting', 'Invoices, bills and customers.', '🧾', '[]', '{"Invoices","Bills","Customers"}', false, 'oauth', null, 400),
('acumatica', 'Acumatica', 'Accounting', 'Jobs, invoices and revenue.', '🧾', '[]', '{"Jobs","Invoices"}', false, 'basic', null, 410),
-- Productivity & messaging
('slack', 'Slack', 'Productivity & messaging', 'Post reports and alerts to Slack channels.', '💬',
 '[{"key":"bot_token","label":"Bot token","type":"password","secret":true,"required":true,"placeholder":"xoxb-…","help":"Create a Slack app, add the chat:write scope, install it, and copy the Bot User OAuth Token."}]',
 '{"Post messages","Alerts"}', true, 'api_key', 'https://api.slack.com/authentication/token-types#bot', 500),
('google_workspace', 'Google Workspace', 'Productivity & messaging', 'Calendar, Drive, Sheets and Gmail.', '📅', '[]', '{"Calendar","Drive","Sheets","Email"}', false, 'oauth', null, 510),
('microsoft_365', 'Microsoft 365', 'Productivity & messaging', 'Outlook, Teams, OneDrive and Excel.', '📅', '[]', '{"Calendar","Teams","OneDrive","Email"}', false, 'oauth', null, 520),
-- Anything else
('custom_rest', 'Custom API', 'Other', 'Any tool with a REST API and an API key. We''ll check it answers; ask us to wire it into reports.', '🔧',
 '[{"key":"base_url","label":"Base URL","type":"text","required":true,"placeholder":"https://api.example.com"},
   {"key":"test_path","label":"Test path","type":"text","placeholder":"/v1/me","help":"A GET endpoint that answers when the key is right."},
   {"key":"auth_style","label":"How the key is sent","type":"select","required":true,"options":[{"value":"bearer","label":"Authorization: Bearer <key>"},{"value":"header","label":"Custom header"},{"value":"basic","label":"Basic (username + password)"}]},
   {"key":"header_name","label":"Header name (custom header only)","type":"text","placeholder":"X-API-Key"},
   {"key":"username","label":"Username (basic only)","type":"text"},
   {"key":"api_key","label":"API key or password","type":"password","secret":true,"required":true}]',
 '{"Test the connection","Custom reports (ask us)"}', true, 'api_key', null, 900)
on conflict (key) do update set name = excluded.name, category = excluded.category, description = excluded.description, icon = excluded.icon,
  fields = excluded.fields, capabilities = excluded.capabilities, available = excluded.available, auth_type = excluded.auth_type,
  docs_url = excluded.docs_url, sort = excluded.sort;
