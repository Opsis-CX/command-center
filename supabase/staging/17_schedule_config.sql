-- ============================================================
-- SCHEDULE CONFIGURATION + CUSTOM VIEWS (Configuration → Schedule, staging 2026-11-05). Run after 16.
--  • schedule_settings: colors per interval state, grouping, default range, week start, time
--    format, density, open-row position, people sort + "show more" limit.
--  • schedule_views: as many saved views as wanted (base Team/Internal + filters + layout), shown
--    as tabs to everyone or to chosen people/teams. Views only NARROW — sched_view's server-side
--    client/project permissions still decide what anyone can see.
--  • Checkbox: schedule.manage_views "Manage schedule settings & views".
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('schedule.manage_views', 'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Manage schedule settings & views (Configuration)', false, 159, 'manager')
on conflict (key) do update set label = excluded.label, sort = excluded.sort, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key) select r.id, 'schedule.manage_views' from public.access_roles r where r.is_starter and r.sort = 2 on conflict do nothing;

create table if not exists public.schedule_settings (
  id boolean primary key default true check (id),
  colors jsonb not null default '{"past":"#94A3B8","current":"#3B82F6","upcoming":"#8B5CF6","open":"#F59E0B","locked":"#64748B","noshow":"#DC2626","checkedin":"#16A34A"}',
  group_by text not null default 'client_project' check (group_by in ('client_project', 'client', 'project', 'none')),
  default_range text not null default 'week' check (default_range in ('day', 'week', 'month')),
  week_starts int not null default 1 check (week_starts in (0, 1)),
  time_format text not null default '12' check (time_format in ('12', '24')),
  density text not null default 'compact' check (density in ('compact', 'comfortable')),
  open_row text not null default 'top' check (open_row in ('top', 'bottom', 'hidden')),
  people_sort text not null default 'name' check (people_sort in ('name', 'hours', 'first')),
  people_limit int not null default 8 check (people_limit between 3 and 200),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now());
insert into public.schedule_settings (id) values (true) on conflict do nothing;
alter table public.schedule_settings enable row level security;
drop policy if exists schedule_settings_read on public.schedule_settings;
create policy schedule_settings_read on public.schedule_settings for select to authenticated using (true);
drop policy if exists schedule_settings_write on public.schedule_settings;
create policy schedule_settings_write on public.schedule_settings for update to authenticated
  using (public.is_access_owner() or public.has_perm('schedule.manage_views')) with check (public.is_access_owner() or public.has_perm('schedule.manage_views'));

create table if not exists public.schedule_views (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  icon text not null default '🗓',
  sort int not null default 100,
  base text not null default 'team' check (base in ('team', 'internal')),
  client_ids uuid[] not null default '{}',
  project_ids uuid[] not null default '{}',
  roles text[] not null default '{}',              -- interval role contains any of these (case-insensitive)
  people text not null default 'all' check (people in ('all', 'agents', 'internal')),
  group_by text check (group_by in ('client_project', 'client', 'project', 'none')),   -- null = company default
  default_range text check (default_range in ('day', 'week', 'month')),
  open_row text check (open_row in ('top', 'bottom', 'hidden')),
  everyone boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz);
create table if not exists public.schedule_view_access (
  id uuid primary key default gen_random_uuid(),
  view_id uuid not null references public.schedule_views(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  check ((profile_id is null) <> (tag_id is null)));
create unique index if not exists schedule_view_access_person on public.schedule_view_access (view_id, profile_id) where profile_id is not null;
create unique index if not exists schedule_view_access_team on public.schedule_view_access (view_id, tag_id) where tag_id is not null;

create or replace function public.sched_view_visible(p_view uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.schedule_views v where v.id = p_view and (
    public.is_access_owner() or public.has_perm('schedule.manage_views')
    or (v.archived_at is null and (v.everyone or exists (select 1 from public.schedule_view_access a where a.view_id = v.id and (a.profile_id = auth.uid()
          or a.tag_id in (select tag_id from public.taggables where entity_type = 'profile' and entity_id = auth.uid())))))))
$$;
alter table public.schedule_views enable row level security;
alter table public.schedule_view_access enable row level security;
drop policy if exists schedule_views_read on public.schedule_views;
create policy schedule_views_read on public.schedule_views for select to authenticated using (public.sched_view_visible(id));
drop policy if exists schedule_views_manage on public.schedule_views;
create policy schedule_views_manage on public.schedule_views for all to authenticated
  using (public.is_access_owner() or public.has_perm('schedule.manage_views')) with check (public.is_access_owner() or public.has_perm('schedule.manage_views'));
drop policy if exists schedule_view_access_read on public.schedule_view_access;
create policy schedule_view_access_read on public.schedule_view_access for select to authenticated using (public.is_access_owner() or public.has_perm('schedule.manage_views'));
drop policy if exists schedule_view_access_manage on public.schedule_view_access;
create policy schedule_view_access_manage on public.schedule_view_access for all to authenticated
  using (public.is_access_owner() or public.has_perm('schedule.manage_views')) with check (public.is_access_owner() or public.has_perm('schedule.manage_views'));

-- the schedule view now says whether each person is an agent (for "Staff type" in views)
do $$ declare d text; begin
  d := pg_get_functiondef('public.sched_view(text,date,date,uuid,uuid)'::regprocedure);
  if position('''agent'', public.dash_is_agent' in d) = 0 then
    d := replace(d, '''checked_in'', c.checked_in_at is not null, ''checked_out'', c.checked_out_at is not null, ''status'', c.status)',
                    '''checked_in'', c.checked_in_at is not null, ''checked_out'', c.checked_out_at is not null, ''status'', c.status, ''agent'', public.dash_is_agent(c.profile_id))');
    if position('''agent'', public.dash_is_agent' in d) = 0 then raise exception 'sched_view not updated'; end if;
    execute d;
  end if;
end $$;
