-- ============================================================
-- DASHBOARD ACTIONS (staging, 2026-11-04). Run after 11.
--  • Nudge people who haven't checked in (notification type 'checkin_nudge' → in-app + push).
--  • Alert AVAILABLE people about an open interval: on that schedule's audience, not already
--    working an overlapping interval, not already on it (type 'open_interval_alert').
--  • Checkbox "dashboard.nudge"; scope + person visibility checked server-side; cooldowns;
--    every send is logged to schedule_activity_log (shows in Dashboard → Activity).
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('dashboard.nudge', 'dashboard', 'Dashboard', 'My work', 'approve', 'Nudge people and send open-interval alerts', false, 27, 'manager')
on conflict (key) do update set label = excluded.label, sort = excluded.sort, min_level = excluded.min_level, module_group = excluded.module_group;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, 'dashboard.nudge' from public.access_roles r where r.is_starter and r.sort in (2, 3) on conflict do nothing;

-- people available for an interval (see header)
create or replace function public.dash_available_for(p_block uuid) returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select a.profile_id from public.shift_blocks b join public.schedule_audience a on a.schedule_id = b.schedule_id
   join public.profiles pr on pr.id = a.profile_id and pr.is_active
   where b.id = p_block
     and not exists (select 1 from public.shift_claims c where c.shift_block_id = b.id and c.profile_id = a.profile_id)
     and not exists (select 1 from public.shift_claims c join public.shift_blocks o on o.id = c.shift_block_id
                      where c.profile_id = a.profile_id and o.block_date = b.block_date and o.id <> b.id
                        and o.start_time < b.end_time and o.end_time > b.start_time)
$$;

-- who should have checked in by now (interval started, not checked in, not marked no-show)
create or replace function public.dash_not_checked_in(p_client uuid default null, p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare now_et timestamp := (now() at time zone 'America/New_York'); res jsonb;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.staffing')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(x order by (x->>'minutes_late')::int desc), '[]'::jsonb) into res from (
    select jsonb_build_object('claim_id', c.id, 'person_id', c.profile_id,
      'name', case when public.is_access_owner() or (public.has_perm('dashboard.names') and public.dash_person_visible(c.profile_id)) then pr.full_name else 'A team member' end,
      'role', b.role, 'start', b.start_time, 'end', b.end_time,
      'client', (select name from public.clients where id = s.client_id), 'project', (select name from public.projects where id = s.project_id),
      'minutes_late', floor(extract(epoch from (now_et - (b.block_date + b.start_time))) / 60)::int,
      'last_nudged', (select max(l.created_at) from public.schedule_activity_log l where l.action = 'nudged' and l.shift_block_id = b.id and l.affected_profile_id = c.profile_id)) x
    from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id
    join public.dash_schedules(p_client, p_project) s on s.schedule_id = b.schedule_id
    join public.profiles pr on pr.id = c.profile_id
    where c.checked_in_at is null and coalesce(c.status, '') not in ('no_show', 'completed', 'auto_checkout')
      and (b.block_date + b.start_time) <= now_et and (b.block_date + b.end_time) > now_et
      and (public.dash_is_agent(c.profile_id) or public.is_access_owner() or public.level_rank(public.my_level()) >= 3 or public.dash_reports_to_me(c.profile_id))) z;
  return res;
end $$;

-- nudge: in-app + push, 10-minute cooldown per person per interval, logged
create or replace function public.dash_nudge(p_claims uuid[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; sent int := 0; skipped int := 0; me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.nudge')) then raise exception 'You don''t have permission to send nudges.'; end if;
  for r in select c.id claim_id, c.profile_id, b.id block_id, b.role, b.start_time, b.block_date, s.id sched_id, s.title, s.client_id, s.project_id
             from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id join public.schedules s on s.id = b.schedule_id
            where c.id = any (p_claims) and c.checked_in_at is null loop
    if not public.dash_schedule_ok(r.client_id, r.project_id)
       or not (public.dash_is_agent(r.profile_id) or public.is_access_owner() or public.level_rank(public.my_level()) >= 3 or public.dash_reports_to_me(r.profile_id))
       or exists (select 1 from public.schedule_activity_log l where l.action = 'nudged' and l.shift_block_id = r.block_id and l.affected_profile_id = r.profile_id and l.created_at > now() - interval '10 minutes') then
      skipped := skipped + 1; continue;
    end if;
    insert into public.notifications (recipient_id, type, title, body, link, actor_id, actor_name)
    values (r.profile_id, 'checkin_nudge', 'Time to check in ⏰',
      'Your ' || coalesce(r.role, 'interval') || ' interval started at ' || to_char(r.start_time, 'FMHH12:MI AM') || ' — please check in.', '/schedule', auth.uid(), me);
    insert into public.schedule_activity_log (actor_id, action, schedule_id, schedule_title, shift_block_id, block_label, affected_profile_id, affected_profile_name)
    values (auth.uid(), 'nudged', r.sched_id, r.title, r.block_id, to_char(r.block_date, 'Dy Mon DD') || ' ' || to_char(r.start_time, 'HH12:MI AM'), r.profile_id, (select full_name from public.profiles where id = r.profile_id));
    sent := sent + 1;
  end loop;
  return jsonb_build_object('sent', sent, 'skipped', skipped);
end $$;

-- alert available people about open intervals: 2-hour cooldown per person per interval, logged
create or replace function public.dash_alert_open(p_blocks uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare b record; pid uuid; sent int := 0; intervals int := 0; me text := (select full_name from public.profiles where id = auth.uid()); open_n int; note text := nullif(btrim(coalesce(p_note, '')), ''); before_n int;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.nudge')) then raise exception 'You don''t have permission to send alerts.'; end if;
  for b in select bl.*, s.title, s.client_id, s.project_id from public.shift_blocks bl join public.schedules s on s.id = bl.schedule_id where bl.id = any (p_blocks) loop
    if not public.dash_schedule_ok(b.client_id, b.project_id) then continue; end if;
    open_n := b.total_spots - (select count(*) from public.shift_claims where shift_block_id = b.id);
    if open_n <= 0 or (b.block_date + b.end_time) < (now() at time zone 'America/New_York') then continue; end if;
    intervals := intervals + 1; before_n := sent;
    for pid in select * from public.dash_available_for(b.id) loop
      if exists (select 1 from public.notifications n where n.recipient_id = pid and n.type = 'open_interval_alert' and n.link = '/schedule?block=' || b.id and n.created_at > now() - interval '2 hours') then continue; end if;
      insert into public.notifications (recipient_id, type, title, body, link, actor_id, actor_name)
      values (pid, 'open_interval_alert', '📣 Open interval: ' || to_char(b.block_date, 'Dy FMMM/FMDD') || ', ' || to_char(b.start_time, 'FMHH12:MI AM') || '–' || to_char(b.end_time, 'FMHH12:MI AM'),
        coalesce((select name from public.clients where id = b.client_id), 'Internal') || coalesce(' · ' || (select name from public.projects where id = b.project_id), '') || ' — ' || coalesce(b.role, 'interval')
          || ' · ' || open_n || ' spot' || case when open_n = 1 then '' else 's' end || ' open.' || coalesce(' ' || note, ''), '/schedule?block=' || b.id, auth.uid(), me);
      sent := sent + 1;
    end loop;
    insert into public.schedule_activity_log (actor_id, action, schedule_id, schedule_title, shift_block_id, block_label, affected_profile_name)
    values (auth.uid(), 'open_alert', b.schedule_id, b.title, b.id, to_char(b.block_date, 'Dy Mon DD') || ' ' || to_char(b.start_time, 'HH12:MI AM'), (sent - before_n) || ' available people');
  end loop;
  return jsonb_build_object('intervals', intervals, 'people', sent);
end $$;
grant execute on function public.dash_not_checked_in(uuid, uuid), public.dash_nudge(uuid[]), public.dash_alert_open(uuid[], text) to authenticated;

-- open intervals now also say how many people are available for each
create or replace function public.dash_open_available(p_blocks uuid[]) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(b.id, (select count(*) from public.dash_available_for(b.id))), '{}'::jsonb)
  from public.shift_blocks b join public.schedules s on s.id = b.schedule_id
  where b.id = any (p_blocks) and public.dash_schedule_ok(s.client_id, s.project_id)
$$;
grant execute on function public.dash_open_available(uuid[]) to authenticated;

-- ---------- check people in / out on their behalf (2026-11-04) ----------
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('dashboard.checkin', 'dashboard', 'Dashboard', 'My work', 'edit', 'Check people in and out (on their behalf)', false, 28, 'manager')
on conflict (key) do update set label = excluded.label, sort = excluded.sort, min_level = excluded.min_level, module_group = excluded.module_group;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, 'dashboard.checkin' from public.access_roles r where r.is_starter and r.sort in (2, 3) on conflict do nothing;

-- who's checked in right now (for the Check out list)
create or replace function public.dash_on_now(p_client uuid default null, p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare res jsonb;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.staffing')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
    select jsonb_build_object('claim_id', c.id, 'person_id', c.profile_id,
      'name', case when public.is_access_owner() or (public.has_perm('dashboard.names') and public.dash_person_visible(c.profile_id)) then pr.full_name else 'A team member' end,
      'role', b.role, 'start', b.start_time, 'end', b.end_time, 'checked_in_at', c.checked_in_at,
      'client', (select name from public.clients where id = s.client_id), 'project', (select name from public.projects where id = s.project_id)) x
    from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id
    join public.dash_schedules(p_client, p_project) s on s.schedule_id = b.schedule_id
    join public.profiles pr on pr.id = c.profile_id
    where c.checked_in_at is not null and c.checked_out_at is null and b.block_date between (now() at time zone 'America/New_York')::date - 1 and (now() at time zone 'America/New_York')::date
      and (public.dash_is_agent(c.profile_id) or public.is_access_owner() or public.level_rank(public.my_level()) >= 3 or public.dash_reports_to_me(c.profile_id))) z;
  return res;
end $$;

-- p_action: 'in' | 'in_at_start' | 'out'
create or replace function public.dash_check(p_claims uuid[], p_action text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; done int := 0; skipped int := 0; me text := (select full_name from public.profiles where id = auth.uid()); at_ timestamptz;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.checkin')) then raise exception 'You don''t have permission to check people in or out.'; end if;
  if p_action not in ('in', 'in_at_start', 'out') then raise exception 'Unknown action.'; end if;
  for r in select c.*, b.block_date, b.start_time, b.end_time, b.id block_id, s.id sched_id, s.title, s.client_id, s.project_id
             from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id join public.schedules s on s.id = b.schedule_id
            where c.id = any (p_claims) loop
    if not public.dash_schedule_ok(r.client_id, r.project_id)
       or not (public.dash_is_agent(r.profile_id) or public.is_access_owner() or public.level_rank(public.my_level()) >= 3 or public.dash_reports_to_me(r.profile_id))
       or r.profile_id = auth.uid() then
      skipped := skipped + 1; continue;
    end if;
    if p_action in ('in', 'in_at_start') then
      if r.checked_in_at is not null then skipped := skipped + 1; continue; end if;
      at_ := case when p_action = 'in_at_start' then (r.block_date + r.start_time) at time zone 'America/New_York' else now() end;
      update public.shift_claims set checked_in_at = at_, status = 'checked_in',
        checkout_note = concat_ws(' · ', nullif(checkout_note, ''), 'Checked in by ' || coalesce(me, 'a manager') || ' from the Dashboard') where id = r.id;
    else
      if r.checked_in_at is null or r.checked_out_at is not null then skipped := skipped + 1; continue; end if;
      update public.shift_claims set checked_out_at = now(), status = 'completed',
        checkout_note = concat_ws(' · ', nullif(checkout_note, ''), 'Checked out by ' || coalesce(me, 'a manager') || ' from the Dashboard') where id = r.id;
    end if;
    insert into public.schedule_activity_log (actor_id, action, schedule_id, schedule_title, shift_block_id, block_label, affected_profile_id, affected_profile_name)
    values (auth.uid(), case when p_action = 'out' then 'checked_out' else 'checked_in' end, r.sched_id, r.title, r.block_id,
            to_char(r.block_date, 'Dy Mon DD') || ' ' || to_char(r.start_time, 'HH12:MI AM') || ' · by ' || coalesce(me, 'a manager'), r.profile_id, (select full_name from public.profiles where id = r.profile_id));
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'skipped', skipped);
end $$;
grant execute on function public.dash_on_now(uuid, uuid), public.dash_check(uuid[], text) to authenticated;
