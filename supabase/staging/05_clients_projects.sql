-- ============================================================
-- CLIENTS → PROJECTS SETUP + YOUR OWN WORDS (staging, 2026-10-30)
-- Run after 01–04. Safe to run more than once.
--  • Clients: added/renamed/archived by people with clients.manage (Administrator level).
--    Archiving is recoverable and only allowed once the client has no active projects.
--  • Projects: under a client, or internal (no client). Managed with tasks.manage in scope
--    (rules from 03). Archiving a project = the recoverable project delete from 03.
--  • org_terms: what this company calls a client / a project ("Account" / "Campaign"…).
--    Labels only — the security structure underneath never changes.
-- ============================================================
alter table public.clients add column if not exists archived_at timestamptz;
alter table public.clients add column if not exists archived_by uuid references public.profiles(id) on delete set null;

drop policy if exists "Admins can manage clients" on public.clients;
drop policy if exists clients_insert_manage on public.clients;
create policy clients_insert_manage on public.clients for insert to authenticated with check (public.has_perm('clients.manage'));
drop policy if exists clients_update_manage on public.clients;
create policy clients_update_manage on public.clients for update to authenticated
  using (public.has_perm('clients.manage')) with check (public.has_perm('clients.manage'));
-- (no DELETE rule → clients are archived, never permanently deleted, from the app)

create or replace function public.tg_clients_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null then
    if exists (select 1 from public.projects where client_id = new.id and deleted_at is null) then
      raise exception 'Archive or move this client''s projects first.'; end if;
    new.archived_by := auth.uid();
  end if;
  if tg_op = 'UPDATE' and new.archived_at is null then new.archived_by := null; end if;
  if btrim(coalesce(new.name, '')) = '' then raise exception 'Give the client a name.'; end if;
  insert into public.access_audit_log (actor_id, action, detail)
  values (auth.uid(), case when tg_op = 'INSERT' then 'client.add'
                           when new.archived_at is not null and old.archived_at is null then 'client.archive'
                           when new.archived_at is null and old.archived_at is not null then 'client.restore'
                           else 'client.update' end,
          jsonb_build_object('name', new.name) || case when tg_op = 'UPDATE' and new.name is distinct from old.name then jsonb_build_object('from', old.name) else '{}'::jsonb end);
  return new;
end $$;
drop trigger if exists trg_clients_guard on public.clients;
create trigger trg_clients_guard before insert or update on public.clients for each row execute function public.tg_clients_guard();

-- Project names must be unique within a client (case-insensitive), among active projects.
create unique index if not exists projects_unique_name_per_client
  on public.projects (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where deleted_at is null;
create unique index if not exists clients_unique_name on public.clients (lower(name)) where archived_at is null;

-- ---------- your own words ----------
create table if not exists public.org_terms (
  key text primary key check (key in ('client', 'project')),
  singular text not null check (char_length(btrim(singular)) between 1 and 30),
  plural text not null check (char_length(btrim(plural)) between 1 and 30),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now());
alter table public.org_terms enable row level security;
drop policy if exists org_terms_read on public.org_terms;
create policy org_terms_read on public.org_terms for select to authenticated using (true);
drop policy if exists org_terms_write on public.org_terms;
create policy org_terms_write on public.org_terms for all to authenticated
  using (public.has_perm('admin.settings')) with check (public.has_perm('admin.settings'));
insert into public.org_terms (key, singular, plural) values ('client', 'Client', 'Clients'), ('project', 'Project', 'Projects')
on conflict (key) do nothing;
