-- ============================================================
-- DASHBOARD: "Who's on" view (Who's On + Time pages combined) and Schedule → "By hour" + Mix
-- (staging 2026-11-06). Run after 21.
--  • Checkboxes: dashboard.whos_on (view), dashboard.time_edit (stop/edit task time),
--    dashboard.time_delete (delete task time entries). Check in/out + nudge reuse the existing ones.
--  • Everything is scoped (client/project) and follows the same who-can-see-whom rules.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('dashboard.whos_on', 'dashboard', 'Dashboard', 'My work', 'special', 'Dashboard view: Who''s on', false, 29, 'user'),
 ('dashboard.time_edit', 'dashboard', 'Dashboard', 'My work', 'special', 'Stop and edit people''s task time', false, 30, 'manager'),
 ('dashboard.time_delete', 'dashboard', 'Dashboard', 'My work', 'special', 'Delete people''s task time entries', false, 31, 'manager')
on conflict (key) do update set label = excluded.label, action = excluded.action, sort = excluded.sort, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['dashboard.whos_on', 'dashboard.time_edit', 'dashboard.time_delete']) k where r.is_starter and r.sort = 2 on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['dashboard.whos_on', 'dashboard.time_edit']) k where r.is_starter and r.sort = 3 on conflict do nothing;

-- may I see/act on this person on the dashboard? (agents in scope; internal staff for admins+; my reports; owners all)
create or replace function public.dash_can_see(p uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_access_owner() or public.dash_reports_to_me(p) or public.dash_is_agent(p) and public.dash_person_visible(p)
      or (public.level_rank(public.my_level()) >= 3 and public.dash_person_visible(p))
$$;

-- ---------- Who's on ----------
create or replace function public.dash_whos_on(p_client uuid default null, p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare now_et timestamp := (now() at time zone 'America/New_York'); today date := (now() at time zone 'America/New_York')::date; res jsonb;
  can_names boolean := public.is_access_owner() or public.has_perm('dashboard.names'); can_internal boolean := public.is_access_owner() or public.level_rank(public.my_level()) >= 3;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.whos_on')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  with sched_rows as (
    select c.id claim_id, c.profile_id, s.client_id, s.project_id, b.role, b.start_time, b.end_time, c.checked_in_at, c.checked_out_at, c.status,
      case when c.status = 'no_show' then 'no_show' when c.checked_out_at is not null then 'done' when c.checked_in_at is not null then 'checked_in'
           when (b.block_date + b.start_time) <= now_et and (b.block_date + b.end_time) > now_et then 'late'
           when (b.block_date + b.end_time) <= now_et then 'no_show' else 'scheduled' end st,
      floor(extract(epoch from (now_et - (b.block_date + b.start_time))) / 60)::int mins_since_start
    from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id
    join public.dash_schedules(p_client, p_project) s on s.schedule_id = b.schedule_id
    where b.block_date = today and (public.dash_is_agent(c.profile_id) or can_internal or public.dash_reports_to_me(c.profile_id))),
  people as (select distinct profile_id from sched_rows union
             -- working on a task without an interval today (admins+ only; internal staff)
             select distinct te.user_id from public.time_entries te where te.ended_at is null and p_client is null and can_internal
               and not exists (select 1 from sched_rows r where r.profile_id = te.user_id))
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'claim_id', r.claim_id, 'person_id', r.profile_id, 'client_id', r.client_id, 'project_id', r.project_id,
        'client', (select name from public.clients where id = r.client_id), 'project', (select name from public.projects where id = r.project_id),
        'role', r.role, 'start', r.start_time, 'end', r.end_time, 'checked_in_at', r.checked_in_at, 'checked_out_at', r.checked_out_at,
        'status', r.st, 'minutes_late', case when r.st = 'late' then r.mins_since_start end,
        'break_started', (select max(br.started_at) from public.shift_breaks br where br.claim_id = r.claim_id and br.ended_at is null),
        'last_nudged', (select max(l.created_at) from public.schedule_activity_log l where l.action = 'nudged' and l.affected_profile_id = r.profile_id and l.created_at::date = today))
      order by case r.st when 'late' then 1 when 'checked_in' then 2 when 'scheduled' then 3 when 'done' then 4 else 5 end, r.start_time) from sched_rows r), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(pp.profile_id, jsonb_build_object(
        'name', case when can_names or public.is_access_owner() then pr.full_name else 'A team member' end, 'avatar', case when can_names then pr.avatar_url end,
        'type', case when public.dash_is_agent(pr.id) then 'agent' else 'internal' end, 'title', pr.job_title,
        'today_min', coalesce((select sum(coalesce(te.duration_minutes, extract(epoch from (now() - te.started_at)) / 60))::int from public.time_entries te
                               where te.user_id = pr.id and (te.started_at at time zone 'America/New_York')::date = today), 0),
        'timer', (select jsonb_build_object('entry_id', te.id, 'started_at', te.started_at, 'task', t.name, 'project', pj.name)
                  from public.time_entries te left join public.tasks t on t.id = te.task_id left join public.projects pj on pj.id = t.project_id
                  where te.user_id = pr.id and te.ended_at is null order by te.started_at desc limit 1)))
      from people pp join public.profiles pr on pr.id = pp.profile_id), '{}'::jsonb)
  ) into res;
  return res;
end $$;

-- a person's task time for a day (for "Edit time")
create or replace function public.dash_time_entries(p_person uuid, p_day date default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare d date := coalesce(p_day, (now() at time zone 'America/New_York')::date);
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.time_edit')) then raise exception 'You don''t have permission to manage task time.'; end if;
  if not public.dash_can_see(p_person) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', te.id, 'task', t.name, 'project', pj.name, 'started_at', te.started_at, 'ended_at', te.ended_at,
      'minutes', coalesce(te.duration_minutes, (extract(epoch from (now() - te.started_at)) / 60)::int), 'running', te.ended_at is null, 'note', te.note) order by te.started_at desc)
    from public.time_entries te left join public.tasks t on t.id = te.task_id left join public.projects pj on pj.id = t.project_id
    where te.user_id = p_person and (te.started_at at time zone 'America/New_York')::date = d), '[]'::jsonb);
end $$;

create or replace function public.dash_time_action(p_entry uuid, p_action text, p_minutes int default null, p_date date default null, p_note text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare te record; st timestamptz;
begin
  select * into te from public.time_entries where id = p_entry for update;
  if te.id is null then raise exception 'That time entry no longer exists.'; end if;
  if not public.dash_can_see(te.user_id) then raise exception 'not allowed'; end if;
  if p_action = 'delete' then
    if not (public.is_access_owner() or public.has_perm('dashboard.time_delete')) then raise exception 'You don''t have permission to delete task time.'; end if;
    delete from public.time_entries where id = te.id; return;
  end if;
  if not (public.is_access_owner() or public.has_perm('dashboard.time_edit')) then raise exception 'You don''t have permission to manage task time.'; end if;
  if p_action = 'stop' then
    if te.ended_at is not null then raise exception 'That timer is already stopped.'; end if;
    update public.time_entries set ended_at = now(), duration_minutes = greatest(1, round(extract(epoch from (now() - te.started_at)) / 60)::int) where id = te.id;
  elsif p_action = 'edit' then
    if coalesce(p_minutes, 0) <= 0 then raise exception 'Enter a valid amount of time.'; end if;
    st := case when p_date is null then te.started_at else ((p_date + time '09:00') at time zone 'America/New_York') end;
    update public.time_entries set duration_minutes = p_minutes, started_at = st, ended_at = st + make_interval(mins => p_minutes), note = nullif(btrim(coalesce(p_note, '')), '') where id = te.id;
  else raise exception 'Unknown action.'; end if;
end $$;

-- adjust a check-in time (like the old Who's On page)
create or replace function public.dash_adjust_checkin(p_claim uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path to 'public' as $$
declare r record; me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.checkin')) then raise exception 'You don''t have permission to check people in or out.'; end if;
  select c.*, b.schedule_id, s.client_id, s.project_id into r from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id join public.schedules s on s.id = b.schedule_id where c.id = p_claim for update of c;
  if r.id is null then raise exception 'Not found.'; end if;
  if not public.dash_schedule_ok(r.client_id, r.project_id) or not public.dash_can_see(r.profile_id) then raise exception 'not allowed'; end if;
  if r.profile_id = auth.uid() then raise exception 'You can''t change your own check-in here.'; end if;
  update public.shift_claims set checked_in_at = p_at, status = case when checked_out_at is null then 'checked_in' else status end,
    checkout_note = concat_ws(' · ', nullif(checkout_note, ''), 'Check-in time set to ' || to_char(p_at at time zone 'America/New_York', 'FMHH12:MI AM') || ' by ' || coalesce(me, 'a manager')) where id = r.id;
  perform public._sched_log(r.shift_block_id, 'checked_in', r.profile_id, 'time set to ' || to_char(p_at at time zone 'America/New_York', 'FMHH12:MI AM') || ' by ' || coalesce(me, 'a manager'));
end $$;

grant execute on function public.dash_can_see(uuid), public.dash_whos_on(uuid, uuid), public.dash_time_entries(uuid, date),
  public.dash_time_action(uuid, text, int, date, text), public.dash_adjust_checkin(uuid, timestamptz) to authenticated;

-- checking someone out also ends their break and stops their running task timer (like the old Who's On page)
do $$ declare d text; begin
  d := pg_get_functiondef('public.dash_check(uuid[],text)'::regprocedure);
  if position('shift_breaks' in d) = 0 then
    d := replace(d, 'update public.shift_claims set checked_out_at = now(), status = ''completed'',',
      'update public.shift_breaks set ended_at = now() where claim_id = r.id and ended_at is null;
      update public.time_entries set ended_at = now(), duration_minutes = greatest(0, round(extract(epoch from (now() - started_at)) / 60)::int) where user_id = r.profile_id and ended_at is null;
      update public.shift_claims set checked_out_at = now(), status = ''completed'',');
    if position('shift_breaks' in d) = 0 then raise exception 'dash_check not updated'; end if;
    execute d;
  end if;
end $$;

-- ---------- Schedule → By hour + Mix ----------
create or replace function public.dash_by_hour(p_client uuid default null, p_project uuid default null, p_day date default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare d date := coalesce(p_day, (now() at time zone 'America/New_York')::date); res jsonb;
  can_names boolean := public.is_access_owner() or public.has_perm('dashboard.names');
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.schedule')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  with b as (select bl.*, s.client_id, s.project_id, (select count(*) from public.shift_claims c where c.shift_block_id = bl.id) filled
             from public.shift_blocks bl join public.dash_fill_schedules(p_client, p_project) s on s.schedule_id = bl.schedule_id where bl.block_date = d),
  hrs as (select h from generate_series(0, 23) h),
  cell as (   -- per client/project/hour: intervals overlapping that hour
    select b.client_id, b.project_id, h.h, sum(b.total_spots) spots, sum(least(b.filled, b.total_spots)) filled,
           sum(case when b.locked_at is null then greatest(b.total_spots - b.filled, 0) else 0 end) open,
           jsonb_agg(distinct b.id) filter (where b.locked_at is null and b.filled < b.total_spots) open_ids, array_agg(b.id) ids
    from b join hrs h on b.start_time < make_time(h.h, 59, 59) and b.end_time > make_time(h.h, 0, 0)
    group by b.client_id, b.project_id, h.h),
  ppl as (select c.profile_id, b.role from public.shift_claims c join b on b.id = c.shift_block_id)
  select jsonb_build_object('date', d,
    'clients', coalesce((select jsonb_agg(x order by x->>'client') from (
      select jsonb_build_object('client_id', cl.client_id, 'project_id', cl.project_id,
        'client', coalesce((select name from public.clients where id = cl.client_id), 'Internal'), 'project', (select name from public.projects where id = cl.project_id),
        'pct', round(100.0 * sum(cl.filled) / nullif(sum(cl.spots), 0)),
        'hours', jsonb_agg(jsonb_build_object('hour', cl.h, 'spots', cl.spots, 'filled', cl.filled, 'open', cl.open, 'open_ids', cl.open_ids,
           'people', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', c.profile_id,
                 'name', case when can_names and public.dash_can_see(c.profile_id) then pr.full_name else null end)), '[]'::jsonb)
              from public.shift_claims c join public.profiles pr on pr.id = c.profile_id where c.shift_block_id = any (cl.ids))) order by cl.h)) x
      from cell cl group by cl.client_id, cl.project_id) z), '[]'::jsonb),
    -- Mix: by Scorecard tier (count today + how reliably that tier works its picked-up intervals, last 30 days) and by role
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('tier', t.tier, 'people', t.n,
        'worked_pct', (select round(100.0 * count(*) filter (where c2.checked_in_at is not null) / nullif(count(*), 0))
             from public.shift_claims c2 join public.shift_blocks b2 on b2.id = c2.shift_block_id
             left join public.sc_scorecard sc2 on sc2.profile_id = c2.profile_id
            where b2.block_date between d - 30 and least(d, (now() at time zone 'America/New_York')::date - 1)
              and coalesce(sc2.performance_tier, 'No tier') = t.tier and c2.profile_id in (select profile_id from ppl))) order by t.n desc)
      from (select coalesce(sc.performance_tier, 'No tier') tier, count(distinct p.profile_id) n
            from ppl p left join public.sc_scorecard sc on sc.profile_id = p.profile_id group by 1) t), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', coalesce(role, 'No role'), 'people', n) order by n desc)
                       from (select role, count(distinct profile_id) n from ppl group by role) r), '[]'::jsonb)
  ) into res;
  return res;
end $$;
grant execute on function public.dash_by_hour(uuid, uuid, date) to authenticated;

-- the Dashboard needs to know the new view + time permissions
do $$ declare d text; begin
  d := pg_get_functiondef('public.dash_scope()'::regprocedure);
  if position('whos_on' in d) = 0 then
    d := replace(d, '''activity'', public.is_access_owner() or public.has_perm(''dashboard.activity'')),',
      '''activity'', public.is_access_owner() or public.has_perm(''dashboard.activity''), ''whos_on'', public.is_access_owner() or public.has_perm(''dashboard.whos_on'')),
    ''time_edit'', public.is_access_owner() or public.has_perm(''dashboard.time_edit''), ''time_delete'', public.is_access_owner() or public.has_perm(''dashboard.time_delete''),');
    if position('whos_on' in d) = 0 then raise exception 'dash_scope not updated'; end if;
    execute d;
  end if;
end $$;

-- By hour: each hour's people also carry their interval + check-in status (for the hover card)
do $$ declare d text; begin
  d := pg_get_functiondef('public.dash_by_hour(uuid,uuid,date)'::regprocedure);
  if position('''checked_in_at'', c.checked_in_at' in d) = 0 then
    d := regexp_replace(d,
      '''people'', \(select coalesce\(jsonb_agg\(distinct jsonb_build_object\(''id'', c\.profile_id,\s+''name'', case when can_names and public\.dash_can_see\(c\.profile_id\) then pr\.full_name else null end\)\), ''\[\]''::jsonb\)\s+from public\.shift_claims c join public\.profiles pr on pr\.id = c\.profile_id where c\.shift_block_id = any \(cl\.ids\)\)',
      '''people'', (select coalesce(jsonb_agg(jsonb_build_object(''id'', c.profile_id,
                 ''name'', case when can_names and public.dash_can_see(c.profile_id) then pr.full_name else null end,
                 ''start'', bb.start_time, ''end'', bb.end_time, ''role'', bb.role, ''status'', c.status,
                 ''checked_in_at'', c.checked_in_at, ''checked_out_at'', c.checked_out_at) order by bb.start_time, pr.full_name), ''[]''::jsonb)
              from public.shift_claims c join public.profiles pr on pr.id = c.profile_id join public.shift_blocks bb on bb.id = c.shift_block_id where c.shift_block_id = any (cl.ids))');
    if position('''checked_in_at'', c.checked_in_at' in d) = 0 then raise exception 'dash_by_hour not updated (text did not match)'; end if;
    execute d;
  end if;
end $$;
