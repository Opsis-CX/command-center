-- ============================================================
-- PER-PERSON ADJUSTMENTS (2026-10-30) — run after 01_roles_permissions.sql. Safe to run more than once.
-- Fine-tune one person's access on top of their roles: ➕ add a checkbox (with its own
-- clients/projects) or ➖ remove one (remove always wins over roles).
-- ============================================================
create table if not exists public.access_overrides (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  perm_key text not null references public.perm_catalog(key) on delete cascade,
  effect text not null check (effect in ('add', 'remove')),
  scope_type text not null default 'scoped' check (scope_type in ('all', 'scoped')),
  project_ids uuid[] not null default '{}', client_ids uuid[] not null default '{}',
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (profile_id, perm_key));
alter table public.access_overrides enable row level security;
drop policy if exists access_overrides_read on public.access_overrides;
create policy access_overrides_read on public.access_overrides for select to authenticated using (profile_id = auth.uid() or public.has_perm('admin.assign') or public.has_perm('people.view'));
drop policy if exists access_overrides_write on public.access_overrides;
create policy access_overrides_write on public.access_overrides for all to authenticated using (public.has_perm('admin.assign')) with check (public.has_perm('admin.assign'));

-- has_perm: Owner → yes · a "remove" adjustment → no · an "add" adjustment or a role → yes if the scope matches.
create or replace function public.has_perm(p_key text, p_scope uuid default null) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select
    exists (select 1 from public.access_assignments a join public.access_roles r on r.id = a.role_id and r.archived_at is null
            where a.profile_id = auth.uid() and r.is_owner)
    or (
      not exists (select 1 from public.access_overrides o where o.profile_id = auth.uid() and o.perm_key = p_key and o.effect = 'remove')
      and (
        exists (select 1 from public.access_assignments a
                join public.access_roles r on r.id = a.role_id and r.archived_at is null
                join public.access_role_permissions rp on rp.role_id = r.id and rp.perm_key = p_key
                where a.profile_id = auth.uid()
                  and (a.scope_type = 'all' or p_scope is null or p_scope = any (a.project_ids) or p_scope = any (a.client_ids)))
        or exists (select 1 from public.access_overrides o
                   where o.profile_id = auth.uid() and o.perm_key = p_key and o.effect = 'add'
                     and (o.scope_type = 'all' or p_scope is null or p_scope = any (o.project_ids) or p_scope = any (o.client_ids)))))
$$;

create or replace function public.my_permissions()
returns table (perm_key text, all_access boolean, project_ids uuid[], client_ids uuid[])
language sql stable security definer set search_path to 'public' as $$
  with owner as (select exists (select 1 from public.access_assignments a join public.access_roles r on r.id = a.role_id and r.archived_at is null where a.profile_id = auth.uid() and r.is_owner) as yes),
  removed as (select perm_key from public.access_overrides where profile_id = auth.uid() and effect = 'remove'),
  src as (
    select c.key as k, 'all'::text as scope_type, '{}'::uuid[] as project_ids, '{}'::uuid[] as client_ids from public.perm_catalog c, owner where owner.yes
    union all
    select rp.perm_key, a.scope_type, a.project_ids, a.client_ids
      from public.access_assignments a join public.access_roles r on r.id = a.role_id and r.archived_at is null
      join public.access_role_permissions rp on rp.role_id = r.id
     where a.profile_id = auth.uid() and not (select yes from owner)
    union all
    select o.perm_key, o.scope_type, o.project_ids, o.client_ids from public.access_overrides o
     where o.profile_id = auth.uid() and o.effect = 'add' and not (select yes from owner)),
  kept as (select * from src where (select yes from owner) or k not in (select perm_key from removed))
  select k, bool_or(scope_type = 'all'),
         coalesce((select array_agg(distinct x) from kept k2, unnest(k2.project_ids) x where k2.k = kept.k), '{}'),
         coalesce((select array_agg(distinct x) from kept k2, unnest(k2.client_ids) x where k2.k = kept.k), '{}')
  from kept group by k
$$;

create or replace function public.perm_scope(p_key text)
returns table (all_access boolean, project_ids uuid[], client_ids uuid[])
language sql stable security definer set search_path to 'public' as $$
  select coalesce(bool_or(m.all_access), false), coalesce(max(m.project_ids), '{}'), coalesce(max(m.client_ids), '{}')
  from public.my_permissions() m where m.perm_key = p_key
$$;

create or replace function public.tg_access_overrides_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare s record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.profile_id, old.profile_id) = auth.uid() and not public.is_access_owner() then raise exception 'You can''t change your own access.'; end if;
  if tg_op in ('INSERT', 'UPDATE') and not public.is_access_owner() then
    if new.effect = 'add' and not public.has_perm(new.perm_key) then raise exception 'You can only give access you have yourself.'; end if;
    select * into s from public.perm_scope('admin.assign');
    if not coalesce(s.all_access, false) then
      if new.effect = 'add' and new.scope_type = 'all' then raise exception 'You can only give access to your own projects and clients.'; end if;
      if exists (select 1 from unnest(new.project_ids) x where not (x = any (s.project_ids)))
         or exists (select 1 from unnest(new.client_ids) x where not (x = any (s.client_ids))) then
        raise exception 'You can only give access to projects and clients you manage.'; end if;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then new.granted_by := auth.uid(); new.granted_at := now(); end if;
  insert into public.access_audit_log (actor_id, action, target_profile, detail)
  values (auth.uid(), 'adjust.' || lower(tg_op), coalesce(new.profile_id, old.profile_id),
          jsonb_build_object('perm', coalesce(new.perm_key, old.perm_key), 'effect', coalesce(new.effect, old.effect)));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_access_overrides_guard on public.access_overrides;
create trigger trg_access_overrides_guard before insert or update or delete on public.access_overrides for each row execute function public.tg_access_overrides_guard();
