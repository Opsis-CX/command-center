-- ============================================================
-- ALERT SETTINGS (Configuration → Alerts, staging 2026-11-04). Run after 12.
-- One settings row drives check-in nudges and open-interval alerts: on/off, message
-- templates ({first_name} {name} {role} {date} {start} {end} {client_project} {spots}
-- {minutes_late} {note}), cooldowns, automatic sending, and who counts as "available".
-- Automatic alerts run every 5 minutes (cron) and are OFF until turned on.
-- Checkbox: admin.alerts "Manage alert settings" (Administrator level).
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('admin.alerts', 'admin', 'Administration', 'Administration', 'manage', 'Manage alert settings (nudges & open-interval alerts)', false, 905, 'administrator')
on conflict (key) do update set label = excluded.label, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key) select r.id, 'admin.alerts' from public.access_roles r where r.is_starter and r.sort = 2 on conflict do nothing;

create table if not exists public.alert_settings (
  id boolean primary key default true check (id),
  nudge_enabled boolean not null default true,
  nudge_title text not null default 'Time to check in ⏰',
  nudge_body text not null default 'Hi {first_name} — your {role} interval started at {start}. Please check in.',
  nudge_cooldown_min int not null default 10 check (nudge_cooldown_min between 1 and 240),
  auto_nudge boolean not null default false,
  auto_nudge_after_min int not null default 10 check (auto_nudge_after_min between 1 and 120),
  auto_nudge_max int not null default 2 check (auto_nudge_max between 1 and 5),
  open_enabled boolean not null default true,
  open_title text not null default '📣 Open interval: {date}, {start}–{end}',
  open_body text not null default '{client_project} — {role} · {spots} open. {note}',
  open_cooldown_min int not null default 120 check (open_cooldown_min between 10 and 1440),
  auto_open boolean not null default false,
  auto_open_hours_before int not null default 24 check (auto_open_hours_before between 1 and 168),
  auto_open_min_spots int not null default 1 check (auto_open_min_spots between 1 and 50),
  avail_skip_working_day boolean not null default false,
  avail_max_week_hours numeric check (avail_max_week_hours is null or avail_max_week_hours between 1 and 80),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now());
insert into public.alert_settings (id) values (true) on conflict do nothing;
alter table public.alert_settings enable row level security;
drop policy if exists alert_settings_read on public.alert_settings;
create policy alert_settings_read on public.alert_settings for select to authenticated using (true);
drop policy if exists alert_settings_write on public.alert_settings;
create policy alert_settings_write on public.alert_settings for update to authenticated using (public.has_perm('admin.alerts')) with check (public.has_perm('admin.alerts'));

create or replace function public.render_tpl(p_tpl text, p_vars jsonb) returns text language plpgsql immutable as $$
declare k text; v text; out text := coalesce(p_tpl, '');
begin
  for k, v in select key, value #>> '{}' from jsonb_each(p_vars) loop out := replace(out, '{' || k || '}', coalesce(v, '')); end loop;
  return btrim(regexp_replace(out, '\s+', ' ', 'g'));
end $$;

-- availability now honors the settings
create or replace function public.dash_available_for(p_block uuid) returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  with st as (select * from public.alert_settings where id),
  b as (select * from public.shift_blocks where id = p_block)
  select a.profile_id from b join public.schedule_audience a on a.schedule_id = b.schedule_id
   join public.profiles pr on pr.id = a.profile_id and pr.is_active, st
   where not exists (select 1 from public.shift_claims c where c.shift_block_id = b.id and c.profile_id = a.profile_id)
     and not exists (select 1 from public.shift_claims c join public.shift_blocks o on o.id = c.shift_block_id
                      where c.profile_id = a.profile_id and o.block_date = b.block_date and o.id <> b.id
                        and (st.avail_skip_working_day or (o.start_time < b.end_time and o.end_time > b.start_time)))
     and (st.avail_max_week_hours is null or coalesce((select sum(extract(epoch from (o.end_time - o.start_time)) / 3600)
            from public.shift_claims c join public.shift_blocks o on o.id = c.shift_block_id
           where c.profile_id = a.profile_id and date_trunc('week', o.block_date) = date_trunc('week', b.block_date)), 0)
           + extract(epoch from (b.end_time - b.start_time)) / 3600 <= st.avail_max_week_hours)
$$;

-- ---------- the senders (shared by buttons and automatic runs; p_actor null = automatic) ----------
create or replace function public._send_nudge(p_claim uuid, p_actor uuid) returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare st record; r record; actor_name text := coalesce((select full_name from public.profiles where id = p_actor), 'Command Center');
begin
  select * into st from public.alert_settings where id;
  if not st.nudge_enabled then return false; end if;
  select c.id, c.profile_id, c.checked_in_at, b.id block_id, b.role, b.block_date, b.start_time, b.end_time, s.id sched_id, s.title, s.client_id, s.project_id,
         pr.full_name, floor(extract(epoch from ((now() at time zone 'America/New_York') - (b.block_date + b.start_time))) / 60)::int late
    into r from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id join public.schedules s on s.id = b.schedule_id join public.profiles pr on pr.id = c.profile_id
   where c.id = p_claim;
  if r.id is null or r.checked_in_at is not null then return false; end if;
  if exists (select 1 from public.schedule_activity_log l where l.action = 'nudged' and l.shift_block_id = r.block_id and l.affected_profile_id = r.profile_id
             and l.created_at > now() - make_interval(mins => st.nudge_cooldown_min)) then return false; end if;
  insert into public.notifications (recipient_id, type, title, body, link, actor_id, actor_name)
  select r.profile_id, 'checkin_nudge', public.render_tpl(st.nudge_title, v), public.render_tpl(st.nudge_body, v), '/schedule', p_actor, actor_name
  from (select jsonb_build_object('first_name', split_part(r.full_name, ' ', 1), 'name', r.full_name, 'role', coalesce(r.role, 'interval'),
    'date', to_char(r.block_date, 'Dy FMMM/FMDD'), 'start', to_char(r.start_time, 'FMHH12:MI AM'), 'end', to_char(r.end_time, 'FMHH12:MI AM'),
    'client_project', concat_ws(' · ', coalesce((select name from public.clients where id = r.client_id), 'Internal'), (select name from public.projects where id = r.project_id)),
    'minutes_late', r.late, 'spots', '', 'note', '') v) x;
  insert into public.schedule_activity_log (actor_id, action, schedule_id, schedule_title, shift_block_id, block_label, affected_profile_id, affected_profile_name)
  values (p_actor, 'nudged', r.sched_id, r.title, r.block_id, to_char(r.block_date, 'Dy Mon DD') || ' ' || to_char(r.start_time, 'HH12:MI AM') || case when p_actor is null then ' · automatic' else '' end, r.profile_id, r.full_name);
  return true;
end $$;

create or replace function public._send_open_alert(p_block uuid, p_note text, p_actor uuid) returns int
language plpgsql security definer set search_path to 'public' as $$
declare st record; b record; pid uuid; sent int := 0; open_n int; actor_name text := coalesce((select full_name from public.profiles where id = p_actor), 'Command Center'); v jsonb;
begin
  select * into st from public.alert_settings where id;
  if not st.open_enabled then return 0; end if;
  select bl.*, s.title, s.client_id, s.project_id into b from public.shift_blocks bl join public.schedules s on s.id = bl.schedule_id where bl.id = p_block;
  if b.id is null then return 0; end if;
  open_n := b.total_spots - (select count(*) from public.shift_claims where shift_block_id = b.id);
  if open_n <= 0 or (b.block_date + b.end_time) < (now() at time zone 'America/New_York') then return 0; end if;
  v := jsonb_build_object('role', coalesce(b.role, 'interval'), 'date', to_char(b.block_date, 'Dy FMMM/FMDD'), 'start', to_char(b.start_time, 'FMHH12:MI AM'), 'end', to_char(b.end_time, 'FMHH12:MI AM'),
    'client_project', concat_ws(' · ', coalesce((select name from public.clients where id = b.client_id), 'Internal'), (select name from public.projects where id = b.project_id)),
    'spots', open_n || ' spot' || case when open_n = 1 then '' else 's' end, 'note', coalesce(nullif(btrim(p_note), ''), ''), 'minutes_late', '');
  for pid in select * from public.dash_available_for(b.id) loop
    if exists (select 1 from public.notifications n where n.recipient_id = pid and n.type = 'open_interval_alert' and n.link = '/schedule?block=' || b.id
               and n.created_at > now() - make_interval(mins => st.open_cooldown_min)) then continue; end if;
    insert into public.notifications (recipient_id, type, title, body, link, actor_id, actor_name)
    select pid, 'open_interval_alert', public.render_tpl(st.open_title, vv), public.render_tpl(st.open_body, vv), '/schedule?block=' || b.id, p_actor, actor_name
      from (select v || jsonb_build_object('first_name', split_part(full_name, ' ', 1), 'name', full_name) vv from public.profiles where id = pid) x;
    sent := sent + 1;
  end loop;
  insert into public.schedule_activity_log (actor_id, action, schedule_id, schedule_title, shift_block_id, block_label, affected_profile_name)
  values (p_actor, 'open_alert', b.schedule_id, b.title, b.id, to_char(b.block_date, 'Dy Mon DD') || ' ' || to_char(b.start_time, 'HH12:MI AM') || case when p_actor is null then ' · automatic' else '' end,
          sent || ' available people');
  return sent;
end $$;
revoke all on function public._send_nudge(uuid, uuid), public._send_open_alert(uuid, text, uuid) from public, authenticated;

-- buttons: same permission/scope checks as before, now through the shared senders
create or replace function public.dash_nudge(p_claims uuid[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; sent int := 0; skipped int := 0;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.nudge')) then raise exception 'You don''t have permission to send nudges.'; end if;
  if not (select nudge_enabled from public.alert_settings where id) then raise exception 'Check-in nudges are turned off in Configuration → Alerts.'; end if;
  for r in select c.id, c.profile_id, s.client_id, s.project_id from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id
             join public.schedules s on s.id = b.schedule_id where c.id = any (p_claims) loop
    if public.dash_schedule_ok(r.client_id, r.project_id)
       and (public.dash_is_agent(r.profile_id) or public.is_access_owner() or public.level_rank(public.my_level()) >= 3 or public.dash_reports_to_me(r.profile_id))
       and public._send_nudge(r.id, auth.uid()) then sent := sent + 1; else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('sent', sent, 'skipped', skipped);
end $$;
create or replace function public.dash_alert_open(p_blocks uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare b record; sent int := 0; intervals int := 0;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.nudge')) then raise exception 'You don''t have permission to send alerts.'; end if;
  if not (select open_enabled from public.alert_settings where id) then raise exception 'Open-interval alerts are turned off in Configuration → Alerts.'; end if;
  for b in select bl.id, s.client_id, s.project_id from public.shift_blocks bl join public.schedules s on s.id = bl.schedule_id where bl.id = any (p_blocks) loop
    if not public.dash_schedule_ok(b.client_id, b.project_id) then continue; end if;
    intervals := intervals + 1; sent := sent + public._send_open_alert(b.id, p_note, auth.uid());
  end loop;
  return jsonb_build_object('intervals', intervals, 'people', sent);
end $$;

-- ---------- automatic run (cron, every 5 minutes) ----------
create or replace function public.run_auto_alerts() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare st record; c record; b record; nudges int := 0; alerts int := 0; now_et timestamp := now() at time zone 'America/New_York';
begin
  select * into st from public.alert_settings where id;
  if st.nudge_enabled and st.auto_nudge then
    for c in select cl.id from public.shift_claims cl join public.shift_blocks bl on bl.id = cl.shift_block_id join public.schedules s on s.id = bl.schedule_id
              where s.status = 'published' and cl.checked_in_at is null and coalesce(cl.status, '') not in ('no_show', 'completed', 'auto_checkout')
                and (bl.block_date + bl.start_time) <= now_et - make_interval(mins => st.auto_nudge_after_min) and (bl.block_date + bl.end_time) > now_et
                and (select count(*) from public.schedule_activity_log l where l.action = 'nudged' and l.shift_block_id = bl.id and l.affected_profile_id = cl.profile_id) < st.auto_nudge_max loop
      if public._send_nudge(c.id, null) then nudges := nudges + 1; end if;
    end loop;
  end if;
  if st.open_enabled and st.auto_open then
    for b in select bl.id from public.shift_blocks bl join public.schedules s on s.id = bl.schedule_id
              where s.status = 'published' and (bl.block_date + bl.start_time) between now_et and now_et + make_interval(hours => st.auto_open_hours_before)
                and bl.total_spots - (select count(*) from public.shift_claims where shift_block_id = bl.id) >= st.auto_open_min_spots loop
      alerts := alerts + public._send_open_alert(b.id, null, null);
    end loop;
  end if;
  return jsonb_build_object('nudges', nudges, 'alerted_people', alerts);
end $$;
revoke all on function public.run_auto_alerts() from public, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'auto-alerts';
select cron.schedule('auto-alerts', '*/5 * * * *', $$select public.run_auto_alerts()$$);

-- the dashboard hides buttons for alert types that are turned off
create or replace function public.dash_alert_flags() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('nudge', nudge_enabled, 'open', open_enabled) from public.alert_settings where id
$$;
grant execute on function public.dash_alert_flags() to authenticated;
