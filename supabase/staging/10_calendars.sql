-- ============================================================
-- SHARED CALENDARS + CALENDAR CUSTOMIZE (staging, 2026-11-04). Run after 01–09.
--  • org_calendars: as many calendars as needed (like Team calendar), created by people with
--    "Manage company calendars". Visible to everyone, or to specific people and/or teams;
--    each person/team can view, or view + add events.
--  • calendar_events.calendar_id: events that belong to one of these calendars.
--  • calendar_prefs: each person's own choices — show meals / water / wellbeing / tasks.
-- ============================================================
create table if not exists public.org_calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text,
  icon text not null default '📅',
  color text not null default '#2563EB' check (color ~* '^#[0-9a-f]{6}$'),
  everyone boolean not null default false,          -- visible to everyone
  everyone_can_add boolean not null default false,  -- …and everyone can add events
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz);
create table if not exists public.org_calendar_access (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.org_calendars(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  can_edit boolean not null default false,
  check ((profile_id is null) <> (tag_id is null)));
create unique index if not exists org_calendar_access_person on public.org_calendar_access (calendar_id, profile_id) where profile_id is not null;
create unique index if not exists org_calendar_access_team on public.org_calendar_access (calendar_id, tag_id) where tag_id is not null;
alter table public.calendar_events add column if not exists calendar_id uuid references public.org_calendars(id) on delete cascade;
create index if not exists calendar_events_calendar on public.calendar_events (calendar_id) where calendar_id is not null;

-- who can see / add to / manage a calendar
create or replace function public.org_cal_can(p_cal uuid, p_what text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.org_calendars c where c.id = p_cal and (
      c.created_by = auth.uid() or public.has_perm('calendar.manage')
      or (p_what = 'view' and c.archived_at is null and (c.everyone or exists (
            select 1 from public.org_calendar_access a where a.calendar_id = c.id and (a.profile_id = auth.uid()
              or a.tag_id in (select tag_id from public.taggables where entity_type = 'profile' and entity_id = auth.uid()))))
      )
      or (p_what = 'edit' and c.archived_at is null and (c.everyone_can_add or exists (
            select 1 from public.org_calendar_access a where a.calendar_id = c.id and a.can_edit and (a.profile_id = auth.uid()
              or a.tag_id in (select tag_id from public.taggables where entity_type = 'profile' and entity_id = auth.uid()))))
      )))
$$;
grant execute on function public.org_cal_can(uuid, text) to authenticated;

alter table public.org_calendars enable row level security;
alter table public.org_calendar_access enable row level security;
drop policy if exists org_calendars_read on public.org_calendars;
create policy org_calendars_read on public.org_calendars for select to authenticated
  using (created_by = auth.uid() or public.has_perm('calendar.manage') or public.org_cal_can(id, 'view'));
drop policy if exists org_calendars_create on public.org_calendars;
create policy org_calendars_create on public.org_calendars for insert to authenticated with check (public.has_perm('calendar.manage') and created_by = auth.uid());
drop policy if exists org_calendars_manage on public.org_calendars;
create policy org_calendars_manage on public.org_calendars for update to authenticated
  using (created_by = auth.uid() or public.has_perm('calendar.manage')) with check (created_by = auth.uid() or public.has_perm('calendar.manage'));
drop policy if exists org_calendar_access_read on public.org_calendar_access;
create policy org_calendar_access_read on public.org_calendar_access for select to authenticated using (public.org_cal_can(calendar_id, 'view'));
drop policy if exists org_calendar_access_manage on public.org_calendar_access;
create policy org_calendar_access_manage on public.org_calendar_access for all to authenticated
  using (exists (select 1 from public.org_calendars c where c.id = calendar_id and (c.created_by = auth.uid() or public.has_perm('calendar.manage'))))
  with check (exists (select 1 from public.org_calendars c where c.id = calendar_id and (c.created_by = auth.uid() or public.has_perm('calendar.manage'))));

-- events on a shared calendar: read if you can see it; add/change/delete if you can add to it
drop policy if exists calendar_events_org_read on public.calendar_events;
create policy calendar_events_org_read on public.calendar_events for select to authenticated
  using (calendar_id is not null and public.org_cal_can(calendar_id, 'view'));
drop policy if exists calendar_events_org_write on public.calendar_events;
create policy calendar_events_org_write on public.calendar_events for all to authenticated
  using (calendar_id is not null and public.org_cal_can(calendar_id, 'edit'))
  with check (calendar_id is not null and public.org_cal_can(calendar_id, 'edit'));
-- your own personal events can't be quietly moved onto a calendar you can't add to
create or replace function public.tg_calendar_event_calendar_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and new.calendar_id is not null
     and (tg_op = 'INSERT' or new.calendar_id is distinct from old.calendar_id)
     and not public.org_cal_can(new.calendar_id, 'edit') then
    raise exception 'You can''t add events to that calendar.'; end if;
  return new;
end $$;
drop trigger if exists trg_calendar_event_calendar_guard on public.calendar_events;
create trigger trg_calendar_event_calendar_guard before insert or update on public.calendar_events for each row execute function public.tg_calendar_event_calendar_guard();

-- ---------- each person's calendar layout choices ----------
create table if not exists public.calendar_prefs (
  owner_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  show_meals boolean not null default true,
  show_water boolean not null default true,
  show_wellbeing boolean not null default true,
  show_tasks boolean not null default true,
  updated_at timestamptz not null default now());
alter table public.calendar_prefs enable row level security;
drop policy if exists calendar_prefs_own on public.calendar_prefs;
create policy calendar_prefs_own on public.calendar_prefs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
