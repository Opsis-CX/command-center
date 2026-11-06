-- ============================================================
-- SCHEDULE RULES — 100% configurable (Configuration → Schedule rules, staging 2026-11-05). Run after 18.
-- One settings row drives the rules everywhere (database enforcement AND the screens):
--   release schedule (weekly / daily-rolling / off) · release waves · weekly hour cap ·
--   commitment lock (was "96-hour lock") · check-out grace window · auto check-out.
-- Defaults = today's live policy, so nothing changes until someone changes it.
-- Each section has its own permission; changes go through sched_rules_save(), which checks them.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('schedule.rules_view',     'schedule_rules', 'Schedule rules (Configuration)', 'My work', 'special', 'See the Schedule rules page', false, 160, 'administrator'),
 ('schedule.rules_release',  'schedule_rules', 'Schedule rules (Configuration)', 'My work', 'special', 'Change the release schedule', false, 161, 'administrator'),
 ('schedule.rules_waves',    'schedule_rules', 'Schedule rules (Configuration)', 'My work', 'special', 'Change release waves', false, 162, 'administrator'),
 ('schedule.rules_cap',      'schedule_rules', 'Schedule rules (Configuration)', 'My work', 'special', 'Change the weekly hour cap', false, 163, 'administrator'),
 ('schedule.rules_lock',     'schedule_rules', 'Schedule rules (Configuration)', 'My work', 'special', 'Change the commitment lock (hours before an interval)', false, 164, 'administrator'),
 ('schedule.rules_checkout', 'schedule_rules', 'Schedule rules (Configuration)', 'My work', 'special', 'Change check-out grace & auto check-out', false, 165, 'administrator')
on conflict (key) do update set module = excluded.module, module_label = excluded.module_label, module_group = excluded.module_group, action = excluded.action,
  label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, c.key from public.access_roles r, public.perm_catalog c where r.is_starter and r.sort = 2 and c.module = 'schedule_rules' on conflict do nothing;

create table if not exists public.schedule_rules (
  id boolean primary key default true check (id),
  release_enabled boolean not null default true,
  release_mode text not null default 'weekly' check (release_mode in ('weekly', 'daily')),
  release_weekday int not null default 3 check (release_weekday between 0 and 6),       -- 0 Sun … 6 Sat (weekly)
  release_time time not null default '11:00',                                            -- Eastern
  release_weeks_before int not null default 1 check (release_weeks_before between 1 and 8), -- weekly
  release_days_before int not null default 14 check (release_days_before between 1 and 90), -- daily rolling
  release_now_days int not null default 2 check (release_now_days between 0 and 30),     -- this close → released immediately
  waves_enabled boolean not null default true,
  waves jsonb not null default '[
    {"name": "New agents", "delay": 0, "match": [{"type": "new", "hours": 10}]},
    {"name": "Top Performer", "delay": 30, "match": [{"type": "tier", "tier": "Top Performer"}]},
    {"name": "High Performer", "delay": 45, "match": [{"type": "tier", "tier": "High Performer"}, {"type": "recent", "days": 14}]},
    {"name": "Developing Performer", "delay": 60, "match": [{"type": "tier", "tier": "Developing Performer"}]},
    {"name": "Everyone else", "delay": 90, "match": [{"type": "everyone"}]}]',
  cap_enabled boolean not null default true,
  cap_hours numeric not null default 40 check (cap_hours between 1 and 168),
  lock_enabled boolean not null default true,
  lock_hours int not null default 96 check (lock_hours between 1 and 720),
  grace_enabled boolean not null default true,
  grace_min int not null default 15 check (grace_min between 1 and 240),
  auto_checkout_enabled boolean not null default true,
  auto_checkout_min int not null default 15 check (auto_checkout_min between 0 and 720),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now());
insert into public.schedule_rules (id) values (true) on conflict do nothing;
alter table public.schedule_rules enable row level security;
drop policy if exists schedule_rules_read on public.schedule_rules;
create policy schedule_rules_read on public.schedule_rules for select to authenticated using (true);   -- the screens need the values; changes only via sched_rules_save()

-- which sections may I see / change?
create or replace function public.sched_rules_access() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'view', public.is_access_owner() or public.has_perm('schedule.rules_view'),
    'release', public.is_access_owner() or public.has_perm('schedule.rules_release'),
    'waves', public.is_access_owner() or public.has_perm('schedule.rules_waves'),
    'cap', public.is_access_owner() or public.has_perm('schedule.rules_cap'),
    'lock', public.is_access_owner() or public.has_perm('schedule.rules_lock'),
    'checkout', public.is_access_owner() or public.has_perm('schedule.rules_checkout'))
$$;
grant execute on function public.sched_rules_access() to authenticated;

-- the longest wave delay (claims are wave-checked until release + this)
create or replace function public.sched_rules_max_delay() returns int language sql stable security definer set search_path to 'public' as $$
  select case when r.waves_enabled then coalesce((select max((w->>'delay')::int) from jsonb_array_elements(r.waves) w), 0) else 0 end
  from public.schedule_rules r where r.id
$$;

-- ---------- release time for an interval ----------
create or replace function public.default_block_release_at(p_date date) returns timestamptz
language plpgsql stable security definer set search_path to 'public' as $$
declare r record; v_today date := (now() at time zone 'America/New_York')::date; v_ts timestamptz;
begin
  select * into r from public.schedule_rules where id;
  if r is null or not r.release_enabled then return now(); end if;
  if p_date <= v_today + r.release_now_days then return now(); end if;
  if r.release_mode = 'daily' then
    v_ts := ((p_date - r.release_days_before) + r.release_time) at time zone 'America/New_York';
    return greatest(v_ts, now());
  end if;
  -- weekly: release weekday/time of the week that's N weeks before the interval's week (weeks start Monday)
  v_ts := ((date_trunc('week', p_date::timestamp)::date - 7 * r.release_weeks_before + ((r.release_weekday + 6) % 7)) + r.release_time) at time zone 'America/New_York';
  if v_ts > now() then return v_ts; end if;
  v_ts := (v_today + r.release_time) at time zone 'America/New_York';
  if v_ts <= now() then v_ts := v_ts + interval '1 day'; end if;
  return v_ts;
end $$;

-- ---------- which wave is this person in? (same signature as before) ----------
-- Priority: "new" first, then a performance tier, then "recently active", then "everyone".
create or replace function public.release_wave(p_profile uuid, p_tier text)
returns table(wave integer, offset_min integer, wave_name text, time_label text)
language plpgsql stable security definer set search_path to 'public' as $$
declare r record; w jsonb; m jsonb; i int; hit int; ty text; lifetime numeric; n int;
begin
  select * into r from public.schedule_rules where id;
  if r is null or not r.waves_enabled or jsonb_array_length(r.waves) = 0 then
    return query select 1, 0, 'Everyone'::text, to_char(r.release_time, 'FMHH12:MIam'); return;
  end if;
  n := jsonb_array_length(r.waves);
  foreach ty in array array['new', 'tier', 'recent', 'everyone'] loop
    for i in 0 .. n - 1 loop
      w := r.waves -> i;
      for m in select * from jsonb_array_elements(coalesce(w->'match', '[]'::jsonb)) loop
        if m->>'type' <> ty then continue; end if;
        if (ty = 'new' and public.agent_serviced_hours(p_profile) < coalesce((m->>'hours')::numeric, 10))
           or (ty = 'tier' and p_tier is not null and lower(btrim(p_tier)) = lower(btrim(m->>'tier')))
           or (ty = 'recent' and p_tier is null and public.agent_serviced_hours(p_profile, now() - make_interval(days => coalesce((m->>'days')::int, 14))) > 0)
           or ty = 'everyone' then
          hit := i; exit;
        end if;
      end loop;
      exit when hit is not null;
    end loop;
    exit when hit is not null;
  end loop;
  if hit is null then hit := n - 1; end if;
  w := r.waves -> hit;
  return query select hit + 1, coalesce((w->>'delay')::int, 0), coalesce(w->>'name', 'Wave ' || (hit + 1)),
    to_char(r.release_time + make_interval(mins => coalesce((w->>'delay')::int, 0)), 'FMHH12:MIam');
end $$;

-- ---------- eligibility (assign screen) follows the weekly cap ----------
create or replace function public.sched_ineligible_reason(p_block uuid, p_person uuid) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare b record; gating uuid[]; agent boolean; wk_start date; hrs numeric; rl record;
begin
  select * into rl from public.schedule_rules where id;
  select bl.*, s.call_type_id, s.id sid into b from public.shift_blocks bl join public.schedules s on s.id = bl.schedule_id where bl.id = p_block;
  if b.id is null then return 'Interval not found'; end if;
  if not exists (select 1 from public.profiles where id = p_person and is_active) then return 'Not active'; end if;
  if exists (select 1 from public.shift_claims where shift_block_id = p_block and profile_id = p_person) then return 'Already on this interval'; end if;
  if not exists (select 1 from public.schedule_audience where schedule_id = b.sid and profile_id = p_person) then return 'Not on this schedule'; end if;
  agent := public.dash_is_agent(p_person);
  select array_agg(id) into gating from public.certifications where call_type_id = b.call_type_id and coalesce(active, true);
  if agent and gating is not null and not exists (select 1 from public.agent_cert_records r where r.profile_id = p_person and r.certification_id = any (gating) and r.status = 'passed') then
    return 'Missing required certification'; end if;
  if exists (select 1 from public.shift_claims c join public.shift_blocks o on o.id = c.shift_block_id
             where c.profile_id = p_person and o.block_date = b.block_date and o.id <> b.id and o.start_time < b.end_time and b.start_time < o.end_time) then
    return 'Overlaps another interval'; end if;
  if coalesce(rl.cap_enabled, true) then
    wk_start := date_trunc('week', b.block_date::timestamp)::date;
    select coalesce(sum(extract(epoch from (o.end_time - o.start_time)) / 3600), 0) into hrs from public.shift_claims c join public.shift_blocks o on o.id = c.shift_block_id
     where c.profile_id = p_person and o.block_date between wk_start and wk_start + 6;
    if hrs + extract(epoch from (b.end_time - b.start_time)) / 3600 > coalesce(rl.cap_hours, 40) then return 'Would go over ' || trim_scale(coalesce(rl.cap_hours, 40)) || ' hours that week'; end if;
  end if;
  return null;
end $$;

-- ---------- auto check-out follows its setting ----------
create or replace function public.auto_checkout_stale_claims() returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.schedule_rules where id;
  if r is not null and not r.auto_checkout_enabled then return; end if;
  update shift_claims sc set checked_out_at = ((sb.block_date + sb.end_time) at time zone 'America/New_York'), status = 'auto_checkout'
    from shift_blocks sb
   where sc.shift_block_id = sb.id and sc.status = 'checked_in' and sc.checked_out_at is null
     and ((sb.block_date + sb.end_time) at time zone 'America/New_York') < now() - make_interval(mins => coalesce(r.auto_checkout_min, 15));
end $$;

-- ---------- claim rules (waves window + weekly cap) and release (commitment lock) ----------
do $$ declare d text; begin
  d := pg_get_functiondef('public.enforce_claim_rules'::regproc);
  if position('sched_rules_max_delay' in d) = 0 then
    d := replace(d, 'now() < v_block.release_at + interval ''90 minutes''', 'now() < v_block.release_at + make_interval(mins => public.sched_rules_max_delay())');
    d := regexp_replace(d, 'if\s+v_hours\s*\+\s*v_new_hours\s*>\s*40\s+then\s+raise exception ''That would put you over 40 hours for the week\.'';',
      'if coalesce((select cap_enabled from public.schedule_rules where id), true) and v_hours + v_new_hours > coalesce((select cap_hours from public.schedule_rules where id), 40) then raise exception ''That would put you over % hours for the week.'', trim_scale(coalesce((select cap_hours from public.schedule_rules where id), 40));');
    if position('sched_rules_max_delay' in d) = 0 or position('cap_enabled' in d) = 0 then raise exception 'enforce_claim_rules not updated (text did not match)'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.release_interval'::regproc);
  if position('lock_hours' in d) = 0 then
    d := regexp_replace(d, 'if\s+v_hours\s*<\s*96\s+then\s+raise exception\s+''This interval is locked \(within 4 days of start\) — it can no longer be released\. Put it up for trade instead\.'';',
      'if coalesce((select lock_enabled from public.schedule_rules where id), true) and v_hours < coalesce((select lock_hours from public.schedule_rules where id), 96) then raise exception ''This interval is within % hours of starting — it can no longer be released. Put it up for trade instead.'', coalesce((select lock_hours from public.schedule_rules where id), 96);');
    if position('lock_hours' in d) = 0 then raise exception 'release_interval not updated (text did not match)'; end if;
    execute d;
  end if;
end $$;

-- ---------- save (each section checks its own permission) ----------
create or replace function public.sched_rules_save(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare cur record; acc jsonb := public.sched_rules_access(); changed text[] := '{}'; k text; grp text; moved int := 0;
begin
  select * into cur from public.schedule_rules where id for update;
  for k in select jsonb_object_keys(p) loop
    grp := case when k like 'release_%' then 'release' when k like 'waves%' then 'waves' when k like 'cap_%' then 'cap'
                when k like 'lock_%' then 'lock' when k like 'grace_%' or k like 'auto_checkout_%' then 'checkout' else null end;
    if grp is null then raise exception 'Unknown setting: %', k; end if;
    if (to_jsonb(cur) -> k) is distinct from (p -> k) then
      if not coalesce((acc->>grp)::boolean, false) then raise exception 'You don''t have permission to change the % settings.', grp; end if;
      if not (grp = any (changed)) then changed := changed || grp; end if;
    end if;
  end loop;
  if array_length(changed, 1) is null then return jsonb_build_object('changed', '[]'::jsonb); end if;
  update public.schedule_rules set
    release_enabled = coalesce((p->>'release_enabled')::boolean, release_enabled), release_mode = coalesce(p->>'release_mode', release_mode),
    release_weekday = coalesce((p->>'release_weekday')::int, release_weekday), release_time = coalesce((p->>'release_time')::time, release_time),
    release_weeks_before = coalesce((p->>'release_weeks_before')::int, release_weeks_before), release_days_before = coalesce((p->>'release_days_before')::int, release_days_before),
    release_now_days = coalesce((p->>'release_now_days')::int, release_now_days),
    waves_enabled = coalesce((p->>'waves_enabled')::boolean, waves_enabled), waves = coalesce(p->'waves', waves),
    cap_enabled = coalesce((p->>'cap_enabled')::boolean, cap_enabled), cap_hours = coalesce((p->>'cap_hours')::numeric, cap_hours),
    lock_enabled = coalesce((p->>'lock_enabled')::boolean, lock_enabled), lock_hours = coalesce((p->>'lock_hours')::int, lock_hours),
    grace_enabled = coalesce((p->>'grace_enabled')::boolean, grace_enabled), grace_min = coalesce((p->>'grace_min')::int, grace_min),
    auto_checkout_enabled = coalesce((p->>'auto_checkout_enabled')::boolean, auto_checkout_enabled), auto_checkout_min = coalesce((p->>'auto_checkout_min')::int, auto_checkout_min),
    updated_by = auth.uid(), updated_at = now()
  where id;
  -- a new release schedule re-times intervals that haven't been released yet (released ones stay released)
  if 'release' = any (changed) then
    update public.shift_blocks set release_at = public.default_block_release_at(block_date) where release_at > now();
    get diagnostics moved = row_count;
  end if;
  return jsonb_build_object('changed', to_jsonb(changed), 'retimed', moved);
end $$;
grant execute on function public.sched_rules_save(jsonb) to authenticated;
revoke all on function public.sched_rules_max_delay() from public;
grant execute on function public.sched_rules_max_delay() to authenticated;
