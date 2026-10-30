-- ============================================================
-- SELF-SERVICE ROLES & PERMISSIONS (2026-10-29) — safe to run more than once.
-- perm_catalog            every checkbox (module × action)
-- access_roles            unlimited, renameable roles (Owner is the only protected one)
-- access_role_permissions which checkboxes each role has
-- access_assignments      many roles per person, each scoped to everything or specific projects/clients
-- has_perm(key, scope)    the single check used by both the app and the database
-- ============================================================
create table if not exists public.perm_catalog (
  key text primary key, module text not null, module_label text not null, module_group text not null,
  action text not null, label text not null, description text,
  scopeable boolean not null default true, sort int not null default 0);

create table if not exists public.access_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text, color text not null default '#0F766E', icon text default '👤',
  is_owner boolean not null default false, is_starter boolean not null default false,
  sort int not null default 100,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  archived_at timestamptz);
create unique index if not exists access_roles_name_unique on public.access_roles (lower(name)) where archived_at is null;

create table if not exists public.access_role_permissions (
  role_id uuid not null references public.access_roles(id) on delete cascade,
  perm_key text not null references public.perm_catalog(key) on delete cascade,
  primary key (role_id, perm_key));

create table if not exists public.access_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.access_roles(id) on delete cascade,
  scope_type text not null default 'all' check (scope_type in ('all', 'scoped')),
  project_ids uuid[] not null default '{}', client_ids uuid[] not null default '{}',
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (profile_id, role_id));
create index if not exists access_assignments_profile on public.access_assignments (profile_id);

create table if not exists public.access_audit_log (
  id bigserial primary key, at timestamptz not null default now(), actor_id uuid,
  action text not null, target_role uuid, target_profile uuid, detail jsonb);

-- ---------- the checkbox catalog ----------
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort) values
 ('home.view','home','Home','My work','view','See the Home page',false,10),
 ('tasks.view','tasks','Projects & Tasks','My work','view','See projects and tasks',true,20),
 ('tasks.create','tasks','Projects & Tasks','My work','create','Create tasks',true,21),
 ('tasks.edit','tasks','Projects & Tasks','My work','edit','Edit any task (not just their own)',true,22),
 ('tasks.delete','tasks','Projects & Tasks','My work','delete','Delete tasks',true,23),
 ('tasks.manage','tasks','Projects & Tasks','My work','manage','Create and manage projects',true,24),
 ('notes.view','notes','My Notes','My work','view','Use My Notes',false,30),
 ('calendar.view','calendar','Calendar','My work','view','Use the Calendar',false,40),
 ('calendar.manage','calendar','Calendar','My work','manage','Manage company calendars',false,41),
 ('schedule.view','schedule','Schedule','My work','view','See the schedule',true,50),
 ('schedule.create','schedule','Schedule','My work','create','Build schedules',true,51),
 ('schedule.edit','schedule','Schedule','My work','edit','Edit schedules and shifts',true,52),
 ('schedule.approve','schedule','Schedule','My work','approve','Approve time off and trades',true,53),
 ('time.view','time','Time tracking','My work','view','Track their own time',false,60),
 ('time.edit','time','Time tracking','My work','edit','Edit other people''s time',true,61),
 ('time.export','time','Time tracking','My work','export','Export time and payroll',true,62),
 ('chat.view','chat','Chat','Communication','view','Use Chat',false,100),
 ('chat.create','chat','Chat','Communication','create','Create channels',false,101),
 ('chat.manage','chat','Chat','Communication','manage','Moderate and manage channels',false,102),
 ('updates.view','updates','Updates','Communication','view','Read Updates',false,110),
 ('updates.create','updates','Updates','Communication','create','Post Updates',false,111),
 ('updates.manage','updates','Updates','Communication','manage','Edit, pin and archive any Update',false,112),
 ('meetings.view','meetings','Meetings','Communication','view','See meetings they joined',false,120),
 ('meetings.create','meetings','Meetings','Communication','create','Record meetings',false,121),
 ('meetings.manage','meetings','Meetings','Communication','manage','See all meetings and assign meeting tasks',false,122),
 ('reporting.view','reporting','Reporting','Operations','view','View reports',true,200),
 ('reporting.create','reporting','Reporting','Operations','create','Create reports',true,201),
 ('reporting.edit','reporting','Reporting','Operations','edit','Edit reports',true,202),
 ('reporting.export','reporting','Reporting','Operations','export','Export report data',true,203),
 ('reporting.manage','reporting','Reporting','Operations','manage','Manage report schedules and recipients',true,204),
 ('qa.view','qa','Call Quality','Operations','view','View call scores and recordings',true,210),
 ('qa.create','qa','Call Quality','Operations','create','Score calls',true,211),
 ('qa.edit','qa','Call Quality','Operations','edit','Adjust scores',true,212),
 ('qa.approve','qa','Call Quality','Operations','approve','Approve score disputes',true,213),
 ('qa.export','qa','Call Quality','Operations','export','Export call data',true,214),
 ('qa.manage','qa','Call Quality','Operations','manage','Edit rubrics and QA settings',true,215),
 ('coaching.view','coaching','Coaching','Operations','view','See coaching',true,220),
 ('coaching.create','coaching','Coaching','Operations','create','Run coaching sessions',true,221),
 ('coaching.manage','coaching','Coaching','Operations','manage','Manage the coaching program',true,222),
 ('clients.view','clients','Clients','Operations','view','See client details',true,230),
 ('clients.edit','clients','Clients','Operations','edit','Edit client details',true,231),
 ('clients.manage','clients','Clients','Operations','manage','Add and remove clients',false,232),
 ('people.view','people','People','People & learning','view','See the team directory',true,300),
 ('people.create','people','People','People & learning','create','Invite people',true,301),
 ('people.edit','people','People','People & learning','edit','Edit people''s profiles',true,302),
 ('people.delete','people','People','People & learning','delete','Deactivate people',true,303),
 ('hiring.view','hiring','Hiring','People & learning','view','See candidates',false,310),
 ('hiring.edit','hiring','Hiring','People & learning','edit','Move and update candidates',false,311),
 ('hiring.approve','hiring','Hiring','People & learning','approve','Make hiring decisions',false,312),
 ('learning.view','learning','Courses & Certifications','People & learning','view','Take courses and certifications',false,320),
 ('learning.create','learning','Courses & Certifications','People & learning','create','Build courses',false,321),
 ('learning.manage','learning','Courses & Certifications','People & learning','manage','Assign courses and manage certifications',true,322),
 ('kb.view','kb','Knowledge Base','People & learning','view','Read the Knowledge Base',false,330),
 ('kb.edit','kb','Knowledge Base','People & learning','edit','Write and edit articles',false,331),
 ('kb.manage','kb','Knowledge Base','People & learning','manage','Manage folders and article access',false,332),
 ('rewards.view','rewards','Tokens & Rewards','People & learning','view','Earn and spend tokens',false,340),
 ('rewards.manage','rewards','Tokens & Rewards','People & learning','manage','Award tokens and manage rewards',false,341),
 ('sales.view','sales','Sales','Business','view','See the sales pipeline',false,400),
 ('sales.edit','sales','Sales','Business','edit','Work deals',false,401),
 ('sales.manage','sales','Sales','Business','manage','Manage pipeline settings',false,402),
 ('finance.view','finance','Finance','Business','view','See finance',false,410),
 ('finance.create','finance','Finance','Business','create','Submit purchases',false,411),
 ('finance.approve','finance','Finance','Business','approve','Approve purchases and invoices',false,412),
 ('finance.manage','finance','Finance','Business','manage','Manage billing and payroll settings',false,413),
 ('admin.roles','admin','Company settings','Administration','manage','Create and edit roles',false,500),
 ('admin.assign','admin','Company settings','Administration','manage','Give people roles',false,501),
 ('admin.settings','admin','Company settings','Administration','manage','Change company settings and branding',false,502),
 ('admin.integrations','admin','Company settings','Administration','manage','Connect integrations',false,503),
 ('admin.automations','admin','Company settings','Administration','manage','Build automations and forms',false,504),
 ('admin.audit','admin','Company settings','Administration','manage','See the access history',false,505)
on conflict (key) do update set module = excluded.module, module_label = excluded.module_label, module_group = excluded.module_group,
  action = excluded.action, label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort;

-- ---------- the permission check ----------
create or replace function public.has_perm(p_key text, p_scope uuid default null) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.access_assignments a
    join public.access_roles r on r.id = a.role_id and r.archived_at is null
    where a.profile_id = auth.uid()
      and (r.is_owner or exists (select 1 from public.access_role_permissions rp where rp.role_id = r.id and rp.perm_key = p_key))
      and (a.scope_type = 'all' or p_scope is null or p_scope = any (a.project_ids) or p_scope = any (a.client_ids)))
$$;
create or replace function public.perm_scope(p_key text)
returns table (all_access boolean, project_ids uuid[], client_ids uuid[])
language sql stable security definer set search_path to 'public' as $$
  select bool_or(a.scope_type = 'all'),
         coalesce(array_agg(distinct p) filter (where p is not null), '{}'),
         coalesce(array_agg(distinct c) filter (where c is not null), '{}')
  from public.access_assignments a
  join public.access_roles r on r.id = a.role_id and r.archived_at is null
  left join lateral unnest(a.project_ids) p on true
  left join lateral unnest(a.client_ids) c on true
  where a.profile_id = auth.uid()
    and (r.is_owner or exists (select 1 from public.access_role_permissions rp where rp.role_id = r.id and rp.perm_key = p_key))
$$;
create or replace function public.my_permissions()
returns table (perm_key text, all_access boolean, project_ids uuid[], client_ids uuid[])
language sql stable security definer set search_path to 'public' as $$
  with mine as (
    select r.is_owner, r.id as role_id, a.scope_type, a.project_ids, a.client_ids
    from public.access_assignments a join public.access_roles r on r.id = a.role_id and r.archived_at is null
    where a.profile_id = auth.uid()),
  keys as (
    select c.key, m.scope_type, m.project_ids, m.client_ids from mine m join public.perm_catalog c on m.is_owner
    union all
    select rp.perm_key, m.scope_type, m.project_ids, m.client_ids from mine m join public.access_role_permissions rp on rp.role_id = m.role_id where not m.is_owner)
  select k.key, bool_or(k.scope_type = 'all'),
         coalesce((select array_agg(distinct x) from keys k2, unnest(k2.project_ids) x where k2.key = k.key), '{}'),
         coalesce((select array_agg(distinct x) from keys k2, unnest(k2.client_ids) x where k2.key = k.key), '{}')
  from keys k group by k.key
$$;
create or replace function public.is_access_owner() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.access_assignments a join public.access_roles r on r.id = a.role_id where a.profile_id = auth.uid() and r.is_owner and r.archived_at is null)
$$;
grant execute on function public.has_perm(text, uuid), public.perm_scope(text), public.my_permissions(), public.is_access_owner() to authenticated;

-- ---------- who can read / change roles ----------
alter table public.perm_catalog enable row level security;
alter table public.access_roles enable row level security;
alter table public.access_role_permissions enable row level security;
alter table public.access_assignments enable row level security;
alter table public.access_audit_log enable row level security;
drop policy if exists perm_catalog_read on public.perm_catalog;             create policy perm_catalog_read on public.perm_catalog for select to authenticated using (true);
drop policy if exists access_roles_read on public.access_roles;             create policy access_roles_read on public.access_roles for select to authenticated using (true);
drop policy if exists access_roles_write on public.access_roles;            create policy access_roles_write on public.access_roles for all to authenticated using (public.has_perm('admin.roles')) with check (public.has_perm('admin.roles'));
drop policy if exists access_role_perms_read on public.access_role_permissions;  create policy access_role_perms_read on public.access_role_permissions for select to authenticated using (true);
drop policy if exists access_role_perms_write on public.access_role_permissions; create policy access_role_perms_write on public.access_role_permissions for all to authenticated using (public.has_perm('admin.roles')) with check (public.has_perm('admin.roles'));
drop policy if exists access_assign_read on public.access_assignments;      create policy access_assign_read on public.access_assignments for select to authenticated using (profile_id = auth.uid() or public.has_perm('admin.assign') or public.has_perm('people.view'));
drop policy if exists access_assign_write on public.access_assignments;     create policy access_assign_write on public.access_assignments for all to authenticated using (public.has_perm('admin.assign')) with check (public.has_perm('admin.assign'));
drop policy if exists access_audit_read on public.access_audit_log;         create policy access_audit_read on public.access_audit_log for select to authenticated using (public.has_perm('admin.audit'));

-- ---------- safety rules ----------
create or replace function public.tg_access_roles_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    if old.is_owner then raise exception 'The Owner role can''t be deleted.'; end if;
    insert into public.access_audit_log (actor_id, action, target_role, detail) values (auth.uid(), 'role.delete', old.id, jsonb_build_object('name', old.name));
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.is_owner and (not new.is_owner or new.archived_at is not null) then raise exception 'The Owner role is protected.'; end if;
    if new.is_owner and not old.is_owner then raise exception 'There is already an Owner role.'; end if;
    new.updated_at := now();
  end if;
  if tg_op = 'INSERT' and new.is_owner and exists (select 1 from public.access_roles where is_owner) then
    raise exception 'There is already an Owner role.';
  end if;
  insert into public.access_audit_log (actor_id, action, target_role, detail)
  values (auth.uid(), 'role.' || lower(tg_op), new.id, jsonb_build_object('name', new.name));
  return new;
end $$;
drop trigger if exists trg_access_roles_guard on public.access_roles;
create trigger trg_access_roles_guard before insert or update or delete on public.access_roles for each row execute function public.tg_access_roles_guard();

create or replace function public.tg_access_role_perms_log() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.access_audit_log (actor_id, action, target_role, detail)
  values (auth.uid(), case when tg_op = 'DELETE' then 'perm.remove' else 'perm.add' end,
          coalesce(new.role_id, old.role_id), jsonb_build_object('perm', coalesce(new.perm_key, old.perm_key)));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_access_role_perms_log on public.access_role_permissions;
create trigger trg_access_role_perms_log after insert or delete on public.access_role_permissions for each row execute function public.tg_access_role_perms_log();

create or replace function public.tg_access_assign_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record; missing text; s record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- setup scripts / system
  if tg_op in ('INSERT', 'UPDATE') then
    select * into r from public.access_roles where id = new.role_id;
    if new.profile_id = auth.uid() and not public.is_access_owner() then raise exception 'You can''t change your own access.'; end if;
    if r.is_owner and not public.is_access_owner() then raise exception 'Only an Owner can make someone an Owner.'; end if;
    if not public.is_access_owner() then
      select string_agg(rp.perm_key, ', ') into missing from public.access_role_permissions rp
       where rp.role_id = new.role_id and not public.has_perm(rp.perm_key);
      if missing is not null then raise exception 'You can only give access you have yourself. Missing: %', missing; end if;
      select * into s from public.perm_scope('admin.assign');
      if not coalesce(s.all_access, false) then
        if new.scope_type = 'all' then raise exception 'You can only give access to your own projects and clients.'; end if;
        if exists (select 1 from unnest(new.project_ids) x where not (x = any (s.project_ids)))
           or exists (select 1 from unnest(new.client_ids) x where not (x = any (s.client_ids))) then
          raise exception 'You can only give access to projects and clients you manage.';
        end if;
      end if;
    end if;
    new.granted_by := auth.uid(); new.granted_at := now();
  end if;
  if tg_op = 'DELETE' then
    select * into r from public.access_roles where id = old.role_id;
    if old.profile_id = auth.uid() and not public.is_access_owner() then raise exception 'You can''t change your own access.'; end if;
    if r.is_owner then
      if not public.is_access_owner() then raise exception 'Only an Owner can remove an Owner.'; end if;
      if (select count(*) from public.access_assignments where role_id = old.role_id) <= 1 then raise exception 'You can''t remove the last Owner.'; end if;
    end if;
  end if;
  insert into public.access_audit_log (actor_id, action, target_role, target_profile, detail)
  values (auth.uid(), 'assign.' || lower(tg_op), coalesce(new.role_id, old.role_id), coalesce(new.profile_id, old.profile_id),
          jsonb_build_object('scope', coalesce(new.scope_type, old.scope_type), 'projects', coalesce(new.project_ids, old.project_ids), 'clients', coalesce(new.client_ids, old.client_ids)));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_access_assign_guard on public.access_assignments;
create trigger trg_access_assign_guard before insert or update or delete on public.access_assignments for each row execute function public.tg_access_assign_guard();

-- ---------- the 4 starter roles (created only if missing; fully editable except Owner) ----------
do $$ declare rid uuid; begin
  if not exists (select 1 from public.access_roles where is_owner) then
    insert into public.access_roles (name, description, color, icon, is_owner, is_starter, sort)
    values ('Owner', 'Complete access to everything in your company. Protected — can''t be deleted.', '#B45309', '👑', true, true, 1);
  end if;
  if not exists (select 1 from public.access_roles where is_starter and sort = 2) then
    insert into public.access_roles (name, description, color, icon, is_starter, sort)
    values ('Administrator', 'Runs the company day to day: people, roles, settings and every module.', '#7C3AED', '🛡️', true, 2) returning id into rid;
    insert into public.access_role_permissions select rid, key from public.perm_catalog;
  end if;
  if not exists (select 1 from public.access_roles where is_starter and sort = 3) then
    insert into public.access_roles (name, description, color, icon, is_starter, sort)
    values ('Manager', 'Manages their own projects and teams, and can invite people to them.', '#0F766E', '🧭', true, 3) returning id into rid;
    insert into public.access_role_permissions select rid, key from public.perm_catalog where key in (
      'home.view','tasks.view','tasks.create','tasks.edit','tasks.delete','tasks.manage','notes.view','calendar.view',
      'schedule.view','schedule.create','schedule.edit','schedule.approve','time.view','time.edit','time.export',
      'chat.view','chat.create','updates.view','updates.create','meetings.view','meetings.create',
      'reporting.view','reporting.export','qa.view','qa.create','qa.edit','coaching.view','coaching.create','clients.view',
      'people.view','people.create','people.edit','learning.view','learning.manage','kb.view','kb.edit','rewards.view','admin.assign');
  end if;
  if not exists (select 1 from public.access_roles where is_starter and sort = 4) then
    insert into public.access_roles (name, description, color, icon, is_starter, sort)
    values ('User', 'Does their everyday work: tasks, chat, schedule, learning.', '#2563EB', '👤', true, 4) returning id into rid;
    insert into public.access_role_permissions select rid, key from public.perm_catalog where key in (
      'home.view','tasks.view','tasks.create','notes.view','calendar.view','schedule.view','time.view',
      'chat.view','updates.view','meetings.view','people.view','learning.view','kb.view','rewards.view');
  end if;
end $$;
