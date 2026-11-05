-- ============================================================
-- DASHBOARD SETTINGS (Configuration → Dashboard, staging 2026-11-04). Run after 13.
--  • What counts toward fill rate & coverage: company default for internal schedules (no
--    client) + a per-schedule override (schedules.counts_toward_fill: null = use the default).
--    Schedules that don't count still show who's on (Staffing / Team attendance) — they're
--    left out of fill rate, coverage, Needs attention, open intervals and automatic alerts.
--  • Color thresholds, "needs attention" threshold, default date range.
-- ============================================================
create table if not exists public.dashboard_settings (
  id boolean primary key default true check (id),
  include_internal_fill boolean not null default false,
  good_pct int not null default 85 check (good_pct between 1 and 100),
  warn_pct int not null default 70 check (warn_pct between 0 and 100),
  attention_pct int not null default 70 check (attention_pct between 0 and 100),
  default_days int not null default 7 check (default_days in (7, 14)),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (warn_pct < good_pct));
insert into public.dashboard_settings (id) values (true) on conflict do nothing;
alter table public.dashboard_settings enable row level security;
drop policy if exists dashboard_settings_read on public.dashboard_settings;
create policy dashboard_settings_read on public.dashboard_settings for select to authenticated using (true);
drop policy if exists dashboard_settings_write on public.dashboard_settings;
create policy dashboard_settings_write on public.dashboard_settings for update to authenticated using (public.has_perm('admin.settings')) with check (public.has_perm('admin.settings'));

alter table public.schedules add column if not exists counts_toward_fill boolean;   -- null = use the company default

create or replace function public.dash_counts_fill(p_client uuid, p_override boolean) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(p_override, case when p_client is null then (select include_internal_fill from public.dashboard_settings where id) else true end)
$$;
create or replace function public.dash_fill_schedules(p_client uuid, p_project uuid) returns table (schedule_id uuid, client_id uuid, project_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select d.schedule_id, d.client_id, d.project_id from public.dash_schedules(p_client, p_project) d
  join public.schedules s on s.id = d.schedule_id where public.dash_counts_fill(s.client_id, s.counts_toward_fill)
$$;

create or replace function public.dash_fill_schedule_list() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'client', c.name, 'project', p.name, 'override', s.counts_toward_fill,
    'counts', public.dash_counts_fill(s.client_id, s.counts_toward_fill)) order by c.name nulls last, s.title), '[]'::jsonb)
  from public.schedules s left join public.clients c on c.id = s.client_id left join public.projects p on p.id = s.project_id
  where s.status = 'published' and public.has_perm('admin.settings')
$$;
create or replace function public.dash_set_fill_override(p_schedule uuid, p_value boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.has_perm('admin.settings') then raise exception 'You don''t have permission to change dashboard settings.'; end if;
  update public.schedules set counts_toward_fill = p_value where id = p_schedule;
end $$;
grant execute on function public.dash_fill_schedule_list(), public.dash_set_fill_override(uuid, boolean) to authenticated;

do $$ declare d text; begin
  d := pg_get_functiondef('public.dash_operations(uuid,uuid,date,int)'::regprocedure);
  if position('dash_fill_schedules' in d) = 0 then
    d := replace(d, 'from public.dash_schedules(p_client, p_project)', 'from public.dash_fill_schedules(p_client, p_project)');
    d := replace(d, '/ sum(cur.total_spots) < 70', '/ sum(cur.total_spots) < (select attention_pct from public.dashboard_settings where id)');
    if position('dash_fill_schedules' in d) = 0 or position('attention_pct' in d) = 0 then raise exception 'dash_operations not updated'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.dash_schedule(uuid,uuid,date,int)'::regprocedure);
  if position('dash_fill_schedules' in d) = 0 then
    d := replace(d, 'from public.dash_schedules(p_client, p_project)', 'from public.dash_fill_schedules(p_client, p_project)');
    if position('dash_fill_schedules' in d) = 0 then raise exception 'dash_schedule not updated'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.dash_staffing(uuid,uuid)'::regprocedure);
  if position('dash_fill_schedules' in d) = 0 then
    d := replace(d, 'from public.shift_blocks b join s on s.schedule_id = b.schedule_id where b.block_date between today and today + 6',
                    'from public.shift_blocks b join public.dash_fill_schedules(p_client, p_project) s on s.schedule_id = b.schedule_id where b.block_date between today and today + 6');
    if position('dash_fill_schedules' in d) = 0 then raise exception 'dash_staffing not updated'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.run_auto_alerts()'::regprocedure);
  if position('dash_counts_fill' in d) = 0 then
    d := replace(d, 'where s.status = ''published'' and (bl.block_date + bl.start_time) between now_et',
                    'where s.status = ''published'' and public.dash_counts_fill(s.client_id, s.counts_toward_fill) and (bl.block_date + bl.start_time) between now_et');
    if position('dash_counts_fill' in d) = 0 then raise exception 'run_auto_alerts not updated'; end if;
    execute d;
  end if;
end $$;

create or replace function public.dash_settings() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select to_jsonb(d) - 'updated_by' from public.dashboard_settings d where id
$$;
grant execute on function public.dash_settings() to authenticated;
