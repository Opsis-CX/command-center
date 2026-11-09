-- ============================================================
-- SCHEDULE RULES PER SCHEDULE (staging 2026-11-05). Run after 19.
-- Company rules (schedule_rules) are the default; any schedule can override whole sections
-- (release · waves · cap · lock · checkout) in schedule_rule_overrides. Every rule the database
-- enforces now uses the rules of the interval's own schedule.
-- Changing a schedule's rules needs "Set different rules for individual schedules" AND the
-- section's own permission.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('schedule.rules_per_schedule', 'schedule_rules', 'Schedule rules (Configuration)', 'My work', 'special', 'Set different rules for individual schedules', false, 166, 'administrator')
on conflict (key) do update set label = excluded.label, sort = excluded.sort, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key) select r.id, 'schedule.rules_per_schedule' from public.access_roles r where r.is_starter and r.sort = 2 on conflict do nothing;

create table if not exists public.schedule_rule_overrides (
  schedule_id uuid primary key references public.schedules(id) on delete cascade,
  rules jsonb not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now());
alter table public.schedule_rule_overrides enable row level security;
drop policy if exists schedule_rule_overrides_read on public.schedule_rule_overrides;
create policy schedule_rule_overrides_read on public.schedule_rule_overrides for select to authenticated using (true);   -- changes only via sched_rules_save_schedule()

-- the rules that apply to one schedule (company rules + that schedule's overrides); null = company
create or replace function public.sched_rules_for(p_schedule uuid) returns public.schedule_rules
language sql stable security definer set search_path to 'public' as $$
  select jsonb_populate_record(r, coalesce((select o.rules from public.schedule_rule_overrides o where o.schedule_id = p_schedule), '{}'::jsonb))
  from public.schedule_rules r where r.id
$$;
grant execute on function public.sched_rules_for(uuid) to authenticated;

create or replace function public.sched_rule_group(k text) returns text language sql immutable as $$
  select case when k like 'release_%' then 'release' when k like 'waves%' then 'waves' when k like 'cap_%' then 'cap'
              when k like 'lock_%' then 'lock' when k like 'grace_%' or k like 'auto_checkout_%' then 'checkout' end
$$;

-- ---------- per-schedule versions of the rule helpers ----------
create or replace function public.sched_rules_max_delay(p_schedule uuid) returns int language sql stable security definer set search_path to 'public' as $$
  select case when r.waves_enabled then coalesce((select max((w->>'delay')::int) from jsonb_array_elements(r.waves) w), 0) else 0 end
  from public.sched_rules_for(p_schedule) r
$$;
create or replace function public.sched_rules_max_delay() returns int language sql stable security definer set search_path to 'public' as $$
  select public.sched_rules_max_delay(null::uuid)
$$;
grant execute on function public.sched_rules_max_delay(uuid) to authenticated;

create or replace function public.default_block_release_at_for(p_schedule uuid, p_date date) returns timestamptz
language plpgsql stable security definer set search_path to 'public' as $$
declare r public.schedule_rules; v_today date := (now() at time zone 'America/New_York')::date; v_ts timestamptz;
begin
  r := public.sched_rules_for(p_schedule);
  if r is null or not r.release_enabled then return now(); end if;
  if p_date <= v_today + r.release_now_days then return now(); end if;
  if r.release_mode = 'daily' then
    v_ts := ((p_date - r.release_days_before) + r.release_time) at time zone 'America/New_York';
    return greatest(v_ts, now());
  end if;
  v_ts := ((date_trunc('week', p_date::timestamp)::date - 7 * r.release_weeks_before + ((r.release_weekday + 6) % 7)) + r.release_time) at time zone 'America/New_York';
  if v_ts > now() then return v_ts; end if;
  v_ts := (v_today + r.release_time) at time zone 'America/New_York';
  if v_ts <= now() then v_ts := v_ts + interval '1 day'; end if;
  return v_ts;
end $$;
create or replace function public.default_block_release_at(p_date date) returns timestamptz
language sql stable security definer set search_path to 'public' as $$ select public.default_block_release_at_for(null, p_date) $$;
create or replace function public.set_block_release_at() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.release_at is null then new.release_at := public.default_block_release_at_for(new.schedule_id, new.block_date); end if;
  return new;
end $$;

create or replace function public.release_wave_for(p_schedule uuid, p_profile uuid, p_tier text)
returns table(wave integer, offset_min integer, wave_name text, time_label text)
language plpgsql stable security definer set search_path to 'public' as $$
declare r public.schedule_rules; w jsonb; m jsonb; i int; hit int; ty text; n int;
begin
  r := public.sched_rules_for(p_schedule);
  if r is null or not r.waves_enabled or jsonb_array_length(r.waves) = 0 then
    return query select 1, 0, 'Everyone'::text, to_char(coalesce(r.release_time, time '11:00'), 'FMHH12:MIam'); return;
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
create or replace function public.release_wave(p_profile uuid, p_tier text)
returns table(wave integer, offset_min integer, wave_name text, time_label text)
language sql stable security definer set search_path to 'public' as $$ select * from public.release_wave_for(null, p_profile, p_tier) $$;

create or replace function public.auto_checkout_stale_claims() returns void language plpgsql as $$
begin
  update shift_claims sc set checked_out_at = ((sb.block_date + sb.end_time) at time zone 'America/New_York'), status = 'auto_checkout'
    from shift_blocks sb, lateral (select (public.sched_rules_for(sb.schedule_id)).*) r
   where sc.shift_block_id = sb.id and sc.status = 'checked_in' and sc.checked_out_at is null and r.auto_checkout_enabled
     and ((sb.block_date + sb.end_time) at time zone 'America/New_York') < now() - make_interval(mins => coalesce(r.auto_checkout_min, 15));
end $$;

-- ---------- the enforced rules now read the interval's own schedule ----------
do $$ declare d text; begin
  d := pg_get_functiondef('public.enforce_claim_rules'::regproc);
  if position('release_wave_for' in d) = 0 then
    d := replace(d, 'public.sched_rules_max_delay()', 'public.sched_rules_max_delay(v_block.schedule_id)');
    d := replace(d, 'public.release_wave(new.profile_id, v_tier)', 'public.release_wave_for(v_block.schedule_id, new.profile_id, v_tier)');
    d := replace(d, '(select cap_enabled from public.schedule_rules where id)', '(public.sched_rules_for(v_block.schedule_id)).cap_enabled');
    d := replace(d, '(select cap_hours from public.schedule_rules where id)', '(public.sched_rules_for(v_block.schedule_id)).cap_hours');
    if position('release_wave_for' in d) = 0 or position('(public.sched_rules_for(v_block.schedule_id)).cap_hours' in d) = 0
       or position('sched_rules_max_delay(v_block.schedule_id)' in d) = 0 then raise exception 'enforce_claim_rules not updated'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.release_interval'::regproc);
  if position('sched_rules_for' in d) = 0 then
    d := replace(d, '(select lock_enabled from public.schedule_rules where id)', '(public.sched_rules_for(v_block.schedule_id)).lock_enabled');
    d := replace(d, '(select lock_hours from public.schedule_rules where id)', '(public.sched_rules_for(v_block.schedule_id)).lock_hours');
    if position('(public.sched_rules_for(v_block.schedule_id)).lock_hours' in d) = 0 then raise exception 'release_interval not updated'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.sched_ineligible_reason(uuid,uuid)'::regprocedure);
  if position('sched_rules_for' in d) = 0 then
    d := replace(d, 'select * into rl from public.schedule_rules where id;', '');
    d := replace(d, 'if b.id is null then return ''Interval not found''; end if;', 'if b.id is null then return ''Interval not found''; end if;
  rl := public.sched_rules_for(b.schedule_id);');
    if position('rl := public.sched_rules_for(b.schedule_id)' in d) = 0 then raise exception 'sched_ineligible_reason not updated'; end if;
    execute d;
  end if;
end $$;

-- ---------- company save also re-times only schedules that follow the company release ----------
do $$ declare d text; begin
  d := pg_get_functiondef('public.sched_rules_save(jsonb)'::regprocedure);
  if position('default_block_release_at_for' in d) = 0 then
    d := replace(d, 'update public.shift_blocks set release_at = public.default_block_release_at(block_date) where release_at > now();',
      'update public.shift_blocks b set release_at = public.default_block_release_at_for(b.schedule_id, b.block_date) where b.release_at > now()
       and not exists (select 1 from public.schedule_rule_overrides o where o.schedule_id = b.schedule_id and o.rules ? ''release_enabled'');');
    if position('default_block_release_at_for' in d) = 0 then raise exception 'sched_rules_save not updated'; end if;
    execute d;
  end if;
end $$;

-- ---------- save one schedule's rules ----------
-- p_set: full values for the sections this schedule customizes; p_clear: sections going back to company default
create or replace function public.sched_rules_save_schedule(p_schedule uuid, p_set jsonb, p_clear text[] default '{}') returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare acc jsonb := public.sched_rules_access(); cur jsonb; nxt jsonb; k text; g text; groups text[] := '{}'; moved int := 0;
begin
  if not (public.is_access_owner() or public.has_perm('schedule.rules_per_schedule')) then raise exception 'You don''t have permission to set rules for individual schedules.'; end if;
  if not exists (select 1 from public.schedules where id = p_schedule) then raise exception 'That schedule no longer exists.'; end if;
  cur := coalesce((select rules from public.schedule_rule_overrides where schedule_id = p_schedule), '{}');
  nxt := cur;
  foreach g in array coalesce(p_clear, '{}') loop
    if not coalesce((acc->>g)::boolean, false) then raise exception 'You don''t have permission to change the % settings.', g; end if;
    for k in select jsonb_object_keys(cur) loop if public.sched_rule_group(k) = g then nxt := nxt - k; end if; end loop;
    groups := groups || g;
  end loop;
  for k in select jsonb_object_keys(coalesce(p_set, '{}')) loop
    g := public.sched_rule_group(k);
    if g is null then raise exception 'Unknown setting: %', k; end if;
    if (cur -> k) is distinct from (p_set -> k) and not coalesce((acc->>g)::boolean, false) then raise exception 'You don''t have permission to change the % settings.', g; end if;
    nxt := nxt || jsonb_build_object(k, p_set -> k);
    if not (g = any (groups)) then groups := groups || g; end if;
  end loop;
  -- same ranges as the company rules
  declare v public.schedule_rules; begin
    v := (select jsonb_populate_record(r, nxt) from public.schedule_rules r where r.id);
    if v.release_mode not in ('weekly', 'daily') or v.release_weekday not between 0 and 6 or v.release_weeks_before not between 1 and 8
       or v.release_days_before not between 1 and 90 or v.release_now_days not between 0 and 30 or v.cap_hours not between 1 and 168
       or v.lock_hours not between 1 and 720 or v.grace_min not between 1 and 240 or v.auto_checkout_min not between 0 and 720
       or jsonb_typeof(v.waves) <> 'array' then
      raise exception 'One of the numbers is outside the allowed range.';
    end if;
  end;
  if nxt = '{}'::jsonb then delete from public.schedule_rule_overrides where schedule_id = p_schedule;
  else insert into public.schedule_rule_overrides (schedule_id, rules, updated_by, updated_at) values (p_schedule, nxt, auth.uid(), now())
       on conflict (schedule_id) do update set rules = excluded.rules, updated_by = excluded.updated_by, updated_at = excluded.updated_at; end if;
  if 'release' = any (groups) then
    update public.shift_blocks set release_at = public.default_block_release_at_for(p_schedule, block_date) where schedule_id = p_schedule and release_at > now();
    get diagnostics moved = row_count;
  end if;
  return jsonb_build_object('sections', to_jsonb(groups), 'retimed', moved);
end $$;
grant execute on function public.sched_rules_save_schedule(uuid, jsonb, text[]) to authenticated;

-- the Schedule rules page needs to know whether you can set per-schedule rules
create or replace function public.sched_rules_access() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'view', public.is_access_owner() or public.has_perm('schedule.rules_view'),
    'release', public.is_access_owner() or public.has_perm('schedule.rules_release'),
    'waves', public.is_access_owner() or public.has_perm('schedule.rules_waves'),
    'cap', public.is_access_owner() or public.has_perm('schedule.rules_cap'),
    'lock', public.is_access_owner() or public.has_perm('schedule.rules_lock'),
    'checkout', public.is_access_owner() or public.has_perm('schedule.rules_checkout'),
    'per_schedule', public.is_access_owner() or public.has_perm('schedule.rules_per_schedule'))
$$;
