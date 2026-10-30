-- ============================================================
-- ACCESS LEVELS (ceiling) + DELEGATED ROLE ASSIGNMENT (staging, 2026-10-30)
-- Run after 01–03. Safe to run more than once.
--  • Every person has a level: owner > administrator > manager > user. It is the MAXIMUM
--    authority they can have. Owner = anyone holding the Owner role.
--  • Every checkbox has a minimum level. has_perm()/my_permissions() never grant a checkbox
--    above the person's level — no role, copied role or adjustment can bypass it.
--  • Assigning a role / adding an adjustment that goes above someone's level is refused.
--  • Delegation: each role lists which roles its holders may assign (access_role_delegation).
--    Managers may assign those roles only within their own scope, never to themselves,
--    never to someone at/above their own level. Adjustments: Administrators/Owners only.
-- ============================================================

-- ---------- levels ----------
create or replace function public.level_rank(p text) returns int language sql immutable as $$
  select case lower(coalesce(p, 'user')) when 'owner' then 4 when 'administrator' then 3 when 'manager' then 2 else 1 end
$$;

alter table public.perm_catalog add column if not exists min_level text not null default 'user'
  check (min_level in ('user', 'manager', 'administrator'));
update public.perm_catalog set min_level = 'administrator'
 where key in ('admin.roles','admin.settings','admin.integrations','admin.automations','admin.audit','clients.manage','finance.manage','sales.manage');
update public.perm_catalog set min_level = 'manager'
 where key in ('admin.assign','tasks.manage','calendar.manage','schedule.create','schedule.approve','time.edit','time.export','chat.manage',
               'updates.manage','meetings.manage','reporting.manage','qa.approve','qa.manage','coaching.manage','people.create','people.edit',
               'people.delete','hiring.approve','learning.manage','kb.manage','rewards.manage','finance.approve');

create table if not exists public.access_levels (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  level text not null default 'user' check (level in ('user', 'manager', 'administrator')),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now());
alter table public.access_levels enable row level security;

-- a person's level (Owner role ⇒ owner; otherwise their stored level; default user)
create or replace function public.level_of(p_profile uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select case when exists (select 1 from public.access_assignments a join public.access_roles r on r.id = a.role_id and r.archived_at is null
                           where a.profile_id = p_profile and r.is_owner) then 'owner'
              else coalesce((select level from public.access_levels where profile_id = p_profile), 'user') end
$$;
create or replace function public.my_level() returns text language sql stable security definer set search_path to 'public' as $$
  select public.level_of(auth.uid())
$$;
grant execute on function public.level_of(uuid), public.my_level(), public.level_rank(text) to authenticated;

drop policy if exists access_levels_read on public.access_levels;
create policy access_levels_read on public.access_levels for select to authenticated using (true);
drop policy if exists access_levels_write on public.access_levels;
create policy access_levels_write on public.access_levels for all to authenticated
  using (public.level_rank(public.my_level()) >= 3) with check (public.level_rank(public.my_level()) >= 3);

create or replace function public.tg_access_levels_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare mine int; target text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.profile_id, old.profile_id) = auth.uid() then raise exception 'You can''t change your own access level.'; end if;
  mine := public.level_rank(public.my_level());
  if mine < 3 then raise exception 'Only Administrators and Owners can change access levels.'; end if;
  target := public.level_of(coalesce(new.profile_id, old.profile_id));
  if target = 'owner' then raise exception 'Owners are set by the Owner role, not by level.'; end if;
  if mine < 4 and (public.level_rank(target) >= 3 or (tg_op <> 'DELETE' and public.level_rank(new.level) >= 3)) then
    raise exception 'Only an Owner can make someone an Administrator or change an Administrator.'; end if;
  if tg_op <> 'DELETE' then new.set_by := auth.uid(); new.set_at := now(); end if;
  insert into public.access_audit_log (actor_id, action, target_profile, detail)
  values (auth.uid(), 'level.' || lower(tg_op), coalesce(new.profile_id, old.profile_id),
          jsonb_build_object('from', case when tg_op = 'INSERT' then 'user' else old.level end, 'to', case when tg_op = 'DELETE' then 'user' else new.level end));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_access_levels_guard on public.access_levels;
create trigger trg_access_levels_guard before insert or update or delete on public.access_levels for each row execute function public.tg_access_levels_guard();

-- ---------- the ceiling, inside the one permission check ----------
create or replace function public.has_perm(p_key text, p_scope uuid default null) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select
    exists (select 1 from public.access_assignments a join public.access_roles r on r.id = a.role_id and r.archived_at is null
            where a.profile_id = auth.uid() and r.is_owner)
    or (
      -- ceiling: never above the person's level
      public.level_rank(public.level_of(auth.uid())) >= public.level_rank(coalesce((select min_level from public.perm_catalog where key = p_key), 'administrator'))
      and not exists (select 1 from public.access_overrides o where o.profile_id = auth.uid() and o.perm_key = p_key and o.effect = 'remove')
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
  lvl as (select public.level_rank(public.level_of(auth.uid())) as rk),
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
  kept as (select s.* from src s join public.perm_catalog c on c.key = s.k
           where (select yes from owner)
              or (s.k not in (select perm_key from removed) and (select rk from lvl) >= public.level_rank(c.min_level)))
  select k, bool_or(scope_type = 'all'),
         coalesce((select array_agg(distinct x) from kept k2, unnest(k2.project_ids) x where k2.k = kept.k), '{}'),
         coalesce((select array_agg(distinct x) from kept k2, unnest(k2.client_ids) x where k2.k = kept.k), '{}')
  from kept group by k
$$;

-- highest level any checkbox in a role needs (for badges + checks)
create or replace function public.role_level(p_role uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select case when (select is_owner from public.access_roles where id = p_role) then 'owner'
    else coalesce((select c.min_level from public.access_role_permissions rp join public.perm_catalog c on c.key = rp.perm_key
                   where rp.role_id = p_role order by public.level_rank(c.min_level) desc limit 1), 'user') end
$$;
grant execute on function public.role_level(uuid) to authenticated;

-- ---------- delegation: which roles each role's holders may assign ----------
create table if not exists public.access_role_delegation (
  role_id uuid not null references public.access_roles(id) on delete cascade,             -- the delegating role (e.g. Manager)
  assignable_role_id uuid not null references public.access_roles(id) on delete cascade,  -- a role they may assign (e.g. User)
  primary key (role_id, assignable_role_id),
  check (role_id <> assignable_role_id));
alter table public.access_role_delegation enable row level security;
drop policy if exists access_role_delegation_read on public.access_role_delegation;
create policy access_role_delegation_read on public.access_role_delegation for select to authenticated using (true);
drop policy if exists access_role_delegation_write on public.access_role_delegation;
create policy access_role_delegation_write on public.access_role_delegation for all to authenticated
  using (public.has_perm('admin.roles')) with check (public.has_perm('admin.roles'));
create or replace function public.tg_access_role_delegation_log() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.assignable_role_id, old.assignable_role_id) in (select id from public.access_roles where is_owner) then
    raise exception 'The Owner role can''t be delegated.'; end if;
  insert into public.access_audit_log (actor_id, action, target_role, detail)
  values (auth.uid(), case when tg_op = 'DELETE' then 'delegate.remove' else 'delegate.add' end, coalesce(new.role_id, old.role_id),
          jsonb_build_object('assignable', (select name from public.access_roles where id = coalesce(new.assignable_role_id, old.assignable_role_id))));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_access_role_delegation_log on public.access_role_delegation;
create trigger trg_access_role_delegation_log before insert or delete on public.access_role_delegation for each row execute function public.tg_access_role_delegation_log();

-- Roles I may assign, and where (Administrators/Owners: any non-owner role / Owner role for Owners).
create or replace function public.my_assignable_roles() returns table (role_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select r.id from public.access_roles r where r.archived_at is null and (
       public.my_level() = 'owner'
    or (public.level_rank(public.my_level()) >= 3 and not r.is_owner and public.has_perm('admin.assign'))
    or (public.has_perm('admin.assign') and exists (
          select 1 from public.access_assignments a join public.access_role_delegation d on d.role_id = a.role_id
          join public.access_roles ar on ar.id = a.role_id and ar.archived_at is null
          where a.profile_id = auth.uid() and d.assignable_role_id = r.id)))
$$;
grant execute on function public.my_assignable_roles() to authenticated;

-- ---------- the assignment guard (replaces the "must hold it yourself" rule) ----------
create or replace function public.tg_access_assign_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record; s record; my_rk int; target_rk int; need text; row_role uuid; row_profile uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  row_role := coalesce(new.role_id, old.role_id); row_profile := coalesce(new.profile_id, old.profile_id);
  select * into r from public.access_roles where id = row_role;
  my_rk := public.level_rank(public.my_level());
  target_rk := public.level_rank(public.level_of(row_profile));

  if row_profile = auth.uid() and my_rk < 4 then raise exception 'You can''t change your own access.'; end if;
  if r.is_owner and my_rk < 4 then raise exception 'Only an Owner can give or remove the Owner role.'; end if;
  if my_rk < 4 and target_rk >= my_rk then raise exception 'You can only manage access for people below your own level.'; end if;
  if not exists (select 1 from public.my_assignable_roles() m where m.role_id = row_role) then
    raise exception 'You''re not allowed to assign the % role. An Administrator can add it to your role''s "Can assign" list.', r.name; end if;

  if tg_op in ('INSERT', 'UPDATE') then
    -- ceiling: the role can't include checkboxes above the person's level
    need := public.role_level(new.role_id);
    if not r.is_owner and public.level_rank(need) > target_rk then
      raise exception '% includes %-level permissions, but % is a %. Raise their access level first, or choose another role.',
        r.name, initcap(need), coalesce((select full_name from public.profiles where id = new.profile_id), 'this person'), initcap(public.level_of(new.profile_id)); end if;
    -- scope: Managers only within their own clients/projects
    if my_rk < 3 then
      select * into s from public.perm_scope('admin.assign');
      if not coalesce(s.all_access, false) then
        if new.scope_type = 'all' then raise exception 'You can only give access to your own projects and clients.'; end if;
        if exists (select 1 from unnest(new.project_ids) x where not (x = any (s.project_ids)))
           or exists (select 1 from unnest(new.client_ids) x where not (x = any (s.client_ids))) then
          raise exception 'You can only give access to projects and clients you manage.'; end if;
      end if;
    end if;
    new.granted_by := auth.uid(); new.granted_at := now();
  end if;
  if tg_op = 'DELETE' and r.is_owner and (select count(*) from public.access_assignments where role_id = old.role_id) <= 1 then
    raise exception 'You can''t remove the last Owner.'; end if;

  insert into public.access_audit_log (actor_id, action, target_role, target_profile, detail)
  values (auth.uid(), 'assign.' || lower(tg_op), row_role, row_profile,
          jsonb_build_object('scope', coalesce(new.scope_type, old.scope_type), 'projects', coalesce(new.project_ids, old.project_ids), 'clients', coalesce(new.client_ids, old.client_ids)));
  return coalesce(new, old);
end $$;

-- ---------- adjustments: Administrators/Owners only, and never above the person's level ----------
create or replace function public.tg_access_overrides_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare my_rk int; need text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  my_rk := public.level_rank(public.my_level());
  if coalesce(new.profile_id, old.profile_id) = auth.uid() and my_rk < 4 then raise exception 'You can''t change your own access.'; end if;
  if my_rk < 3 then raise exception 'Only Administrators and Owners can make individual adjustments.'; end if;
  if my_rk < 4 and public.level_rank(public.level_of(coalesce(new.profile_id, old.profile_id))) >= my_rk then
    raise exception 'You can only adjust access for people below your own level.'; end if;
  if tg_op in ('INSERT', 'UPDATE') and new.effect = 'add' then
    need := (select min_level from public.perm_catalog where key = new.perm_key);
    if public.level_rank(need) > public.level_rank(public.level_of(new.profile_id)) then
      raise exception 'That permission needs the % level, but % is a %.', initcap(need),
        coalesce((select full_name from public.profiles where id = new.profile_id), 'this person'), initcap(public.level_of(new.profile_id)); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then new.granted_by := auth.uid(); new.granted_at := now(); end if;
  insert into public.access_audit_log (actor_id, action, target_profile, detail)
  values (auth.uid(), 'adjust.' || lower(tg_op), coalesce(new.profile_id, old.profile_id),
          jsonb_build_object('perm', coalesce(new.perm_key, old.perm_key), 'effect', coalesce(new.effect, old.effect)));
  return coalesce(new, old);
end $$;
drop policy if exists access_overrides_write on public.access_overrides;
create policy access_overrides_write on public.access_overrides for all to authenticated
  using (public.level_rank(public.my_level()) >= 3) with check (public.level_rank(public.my_level()) >= 3);

-- Who can I manage, and what may I give them? (for the People tab "Authority" section)
create or replace function public.my_authority() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'level', public.my_level(),
    'assignable_roles', coalesce((select jsonb_agg(role_id) from public.my_assignable_roles()), '[]'::jsonb),
    'scope', (select to_jsonb(s) from public.perm_scope('admin.assign') s),
    'can_adjust', public.level_rank(public.my_level()) >= 3,
    'can_set_levels', public.level_rank(public.my_level()) >= 3)
$$;
grant execute on function public.my_authority() to authenticated;

-- ---------- starter delegation (only if none set yet): Managers can assign User + QA Reviewer ----------
insert into public.access_role_delegation (role_id, assignable_role_id)
select m.id, r.id from public.access_roles m, public.access_roles r
 where m.name = 'Manager' and r.name in ('User', 'QA Reviewer')
   and not exists (select 1 from public.access_role_delegation)
on conflict do nothing;

-- ---------- History says "archived"/"restored" instead of "updated" ----------
create or replace function public.tg_access_roles_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare act text;
begin
  if tg_op = 'DELETE' then
    if old.is_owner then raise exception 'The Owner role can''t be deleted.'; end if;
    insert into public.access_audit_log (actor_id, action, target_role, detail) values (auth.uid(), 'role.delete', old.id, jsonb_build_object('name', old.name));
    return old;
  end if;
  act := 'role.' || lower(tg_op);
  if tg_op = 'UPDATE' then
    if old.is_owner and (not new.is_owner or new.archived_at is not null) then raise exception 'The Owner role is protected.'; end if;
    if new.is_owner and not old.is_owner then raise exception 'There is already an Owner role.'; end if;
    if new.archived_at is not null and old.archived_at is null then
      if exists (select 1 from public.access_assignments where role_id = new.id) then raise exception 'Move everyone off this role before archiving it.'; end if;
      act := 'role.archive';
    elsif new.archived_at is null and old.archived_at is not null then act := 'role.restore';
    elsif new.name is distinct from old.name then act := 'role.rename'; end if;
    new.updated_at := now();
  end if;
  if tg_op = 'INSERT' and new.is_owner and exists (select 1 from public.access_roles where is_owner) then
    raise exception 'There is already an Owner role.';
  end if;
  insert into public.access_audit_log (actor_id, action, target_role, detail)
  values (auth.uid(), act, new.id, jsonb_build_object('name', new.name) || case when tg_op = 'UPDATE' and new.name is distinct from old.name then jsonb_build_object('from', old.name) else '{}'::jsonb end);
  return new;
end $$;
