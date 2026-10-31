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

-- ---------- archive a client together with its projects; restore brings them back ----------
alter table public.projects add column if not exists deleted_with_client uuid;

create or replace function public.archive_client(p_client uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c record; pr record; n_proj int := 0; n_tasks int := 0; k int;
begin
  select * into c from public.clients where id = p_client;
  if c is null then raise exception 'Not found.'; end if;
  if not public.has_perm('clients.manage') then raise exception 'You don''t have permission to archive this.'; end if;
  if c.archived_at is not null then return jsonb_build_object('projects', 0, 'tasks', 0); end if;
  for pr in select id from public.projects where client_id = p_client and deleted_at is null loop
    update public.projects set deleted_at = now(), deleted_by = auth.uid(), deleted_with_client = p_client where id = pr.id;
    update public.tasks set deleted_at = now(), deleted_by = auth.uid(), deleted_with_project = pr.id where project_id = pr.id and deleted_at is null;
    get diagnostics k = row_count; n_tasks := n_tasks + k; n_proj := n_proj + 1;
  end loop;
  update public.clients set archived_at = now() where id = p_client;
  return jsonb_build_object('projects', n_proj, 'tasks', n_tasks);
end $$;

create or replace function public.restore_client(p_client uuid, p_also_earlier boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pr record; n_proj int := 0; n_tasks int := 0; k int;
begin
  if not public.has_perm('clients.manage') then raise exception 'You don''t have permission to restore this.'; end if;
  update public.clients set archived_at = null where id = p_client;
  -- projects archived WITH the client (+ optionally ones archived on their own earlier)
  for pr in select id from public.projects where client_id = p_client and deleted_at is not null
              and (deleted_with_client = p_client or p_also_earlier) loop
    update public.projects set deleted_at = null, deleted_by = null, deleted_with_client = null where id = pr.id;
    update public.tasks set deleted_at = null, deleted_by = null, deleted_with_project = null where deleted_with_project = pr.id;
    get diagnostics k = row_count; n_tasks := n_tasks + k; n_proj := n_proj + 1;
  end loop;
  return jsonb_build_object('projects', n_proj, 'tasks', n_tasks,
    'earlier', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'archived_at', deleted_at) order by name), '[]'::jsonb)
                from public.projects where client_id = p_client and deleted_at is not null));
end $$;
grant execute on function public.archive_client(uuid), public.restore_client(uuid, boolean) to authenticated;

-- Recently deleted: projects archived along with their client are restored from the client, so
-- don't list them twice (my_recently_deleted from 03, now skipping those).
create or replace function public.my_recently_deleted() returns table (kind text, id uuid, name text, project_name text, deleted_at timestamptz, deleted_by_name text, task_count int)
language sql stable security definer set search_path to 'public' as $$
  select 'project', p.id, p.name, null, p.deleted_at, (select full_name from profiles where id = p.deleted_by),
         (select count(*)::int from tasks t where t.deleted_with_project = p.id)
    from projects p where p.deleted_at is not null and p.deleted_with_client is null
     and public.has_perm_on('tasks.delete', p.id, p.client_id) and public.has_perm_on('tasks.manage', p.id, p.client_id)
  union all
  select 'task', t.id, t.name, (select name from projects where id = t.project_id), t.deleted_at, (select full_name from profiles where id = t.deleted_by), null
    from tasks t where t.deleted_at is not null and t.deleted_with_project is null and public.has_perm_on('tasks.delete', t.project_id, t.client_id)
  order by 5 desc
  limit 300
$$;
