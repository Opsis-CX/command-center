-- ============================================================
-- RELEASE WAVES FROM THE COMPANY'S OWN DATA (staging 2026-11-06). Run after 20.
-- Nothing hard-coded: each wave = a name + a delay + conditions (any / all), checked top to bottom,
-- first match wins. Conditions:
--   {type:'tier', ids:[tier names]}             person's SCORECARD tier (calculated from performance; e.g. Top Performer)
--   {type:'no_tier'}                              person has no Scorecard tier
--   {type:'tag', ids:[tags.id]}                   person has one of these tags (any kind: team, access, …)  ('team' = older name)
--   {type:'tenure', op:'within'|'over', days:n}   time since starting (start date → first interval worked → account created)
--   {type:'cert', ids:[certifications.id]}        person passed one of these certifications
--   {type:'hours', op:'lt'|'lte'|'gte'|'gt', hours:n, days:null|n}   hours worked (check-ins), all-time or last n days
--   {type:'people', ids:[profiles.id]}            specific people
--   {type:'everyone'}
-- Older stored types ('new', 'tier' by name, 'recent') are still understood.
-- Tiers come from the Scorecard (sc_scorecard.performance_tier, calculated automatically) — the same source
-- waves always used. (The older "assigned tier" list, profiles.tier_id, is not used: nothing keeps it current.)
-- ============================================================
drop function if exists public.sched_wave_matches(uuid, jsonb);   -- replaced by the 3-input version below
create or replace function public.sched_wave_matches(p_profile uuid, c jsonb, p_tier text default null) returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare ty text := c->>'type'; v_tier text := p_tier; hrs numeric;
begin
  -- Scorecard tier (the Scorecard shows each person their own row, so this works when they claim)
  if v_tier is null and ty in ('tier', 'no_tier', 'recent') then
    select s.performance_tier into v_tier from public.sc_scorecard s where s.profile_id = p_profile limit 1;
  end if;
  if ty = 'everyone' then return true; end if;
  if ty = 'no_tier' then return v_tier is null; end if;
  if ty = 'tier' then
    if c ? 'ids' then
      return v_tier is not null and (lower(btrim(v_tier)) in (select lower(btrim(x)) from jsonb_array_elements_text(c->'ids') x)
        or exists (select 1 from public.performance_tiers t where t.id::text in (select jsonb_array_elements_text(c->'ids')) and lower(btrim(t.name)) = lower(btrim(v_tier))));
    end if;
    return v_tier is not null and lower(btrim(v_tier)) = lower(btrim(c->>'tier'));
  end if;
  if ty = 'tenure' then
    return (select case when coalesce(c->>'op', 'within') = 'within' then started >= current_date - coalesce((c->>'days')::int, 14)
                        else started < current_date - coalesce((c->>'days')::int, 14) end
            from (select coalesce(p.start_date::date,
                    (select min(cl.checked_in_at at time zone 'America/New_York')::date from public.shift_claims cl where cl.profile_id = p.id and cl.checked_in_at is not null),
                    (p.created_at at time zone 'America/New_York')::date) started
                  from public.profiles p where p.id = p_profile) x);
  end if;
  if ty in ('team', 'tag') then return exists (select 1 from public.taggables g where g.entity_type = 'profile' and g.entity_id = p_profile
                                      and g.tag_id::text in (select jsonb_array_elements_text(coalesce(c->'ids', '[]')))); end if;
  if ty = 'cert' then return exists (select 1 from public.agent_cert_records r where r.profile_id = p_profile and r.status = 'passed'
                                      and r.certification_id::text in (select jsonb_array_elements_text(coalesce(c->'ids', '[]')))); end if;
  if ty = 'people' then return p_profile::text in (select jsonb_array_elements_text(coalesce(c->'ids', '[]'))); end if;
  if ty in ('hours', 'new', 'recent') then
    hrs := public.agent_serviced_hours(p_profile, case when coalesce((c->>'days')::int, 0) > 0 then now() - make_interval(days => (c->>'days')::int) end);
    if ty = 'new' then return hrs < coalesce((c->>'hours')::numeric, 10); end if;
    if ty = 'recent' then return v_tier is null and hrs > 0; end if;
    return case coalesce(c->>'op', 'lt') when 'lt' then hrs < coalesce((c->>'hours')::numeric, 0) when 'lte' then hrs <= coalesce((c->>'hours')::numeric, 0)
                                         when 'gt' then hrs > coalesce((c->>'hours')::numeric, 0) else hrs >= coalesce((c->>'hours')::numeric, 0) end;
  end if;
  return false;
end $$;

create or replace function public.release_wave_for(p_schedule uuid, p_profile uuid, p_tier text)
returns table(wave integer, offset_min integer, wave_name text, time_label text)
language plpgsql stable security definer set search_path to 'public' as $$
declare r public.schedule_rules; w jsonb; c jsonb; i int; n int; hit int; ok boolean; any_ok boolean; all_ok boolean; cnt int;
begin
  r := public.sched_rules_for(p_schedule);
  if r is null or not r.waves_enabled or jsonb_array_length(coalesce(r.waves, '[]')) = 0 then
    return query select 1, 0, 'Everyone'::text, to_char(coalesce(r.release_time, time '11:00'), 'FMHH12:MIam'); return;
  end if;
  n := jsonb_array_length(r.waves);
  for i in 0 .. n - 1 loop                          -- top to bottom; first match wins
    w := r.waves -> i; any_ok := false; all_ok := true; cnt := 0;
    for c in select * from jsonb_array_elements(coalesce(w->'match', '[]'::jsonb)) loop
      cnt := cnt + 1; ok := public.sched_wave_matches(p_profile, c, p_tier);
      any_ok := any_ok or ok; all_ok := all_ok and ok;
    end loop;
    if cnt > 0 and ((coalesce(w->>'join', 'any') = 'all' and all_ok) or (coalesce(w->>'join', 'any') <> 'all' and any_ok)) then hit := i; exit; end if;
  end loop;
  if hit is null then   -- nobody matched: everyone goes in the last wave
    hit := n - 1;
  end if;
  w := r.waves -> hit;
  return query select hit + 1, coalesce((w->>'delay')::int, 0), coalesce(w->>'name', 'Wave ' || (hit + 1)),
    to_char(r.release_time + make_interval(mins => coalesce((w->>'delay')::int, 0)), 'FMHH12:MIam');
end $$;

-- lists for the wave editor (each company's own data)
create or replace function public.sched_wave_options() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'tiers', (select jsonb_agg(jsonb_build_object('id', n, 'name', n) order by o, n) from (
               select n, min(o) o from (
                 select x.n, x.o from (values ('Top Performer', 1), ('High Performer', 2), ('Developing Performer', 3), ('Improvement Opportunity', 4),
                                              ('Onboarding', 5), ('Unrated', 6), ('Not Working', 7)) x(n, o)
                 union all select distinct performance_tier, 50 from public.sc_scorecard where performance_tier is not null) y group by n) z),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', initcap(replace(namespace, '_', ' ')) || ': ' || name) order by namespace, name) from public.tags), '[]'::jsonb),
    'certs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from public.certifications), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name) order by full_name) from public.profiles where is_active and client_id is null), '[]'::jsonb))
  where public.is_access_owner() or public.has_perm('schedule.rules_view')
$$;
grant execute on function public.sched_wave_options() to authenticated;

-- Rebuild the company's waves from these blocks — same behavior as before (Scorecard tiers):
--   New agents (hours < 10, all-time) +0 · Top Performer +30 · High Performer +45 · Developing Performer +60 ·
--   Active recently (worked in last 14 days AND no Scorecard tier) +45 · Everyone else +90.
-- Replaces waves still on the original default, or on the interim version that used the assigned-tier list.
do $$ declare old_default jsonb := '[
    {"name": "New agents", "delay": 0, "match": [{"type": "new", "hours": 10}]},
    {"name": "Top Performer", "delay": 30, "match": [{"type": "tier", "tier": "Top Performer"}]},
    {"name": "High Performer", "delay": 45, "match": [{"type": "tier", "tier": "High Performer"}, {"type": "recent", "days": 14}]},
    {"name": "Developing Performer", "delay": 60, "match": [{"type": "tier", "tier": "Developing Performer"}]},
    {"name": "Everyone else", "delay": 90, "match": [{"type": "everyone"}]}]';
  nw jsonb := '[
    {"name": "New agents", "delay": 0, "join": "any", "match": [{"type": "hours", "op": "lt", "hours": 10}]},
    {"name": "Top Performer", "delay": 30, "join": "any", "match": [{"type": "tier", "ids": ["Top Performer"]}]},
    {"name": "High Performer", "delay": 45, "join": "any", "match": [{"type": "tier", "ids": ["High Performer"]}]},
    {"name": "Developing Performer", "delay": 60, "join": "any", "match": [{"type": "tier", "ids": ["Developing Performer"]}]},
    {"name": "Active recently (no tier yet)", "delay": 45, "join": "all", "match": [{"type": "hours", "op": "gte", "hours": 0.01, "days": 14}, {"type": "no_tier"}]},
    {"name": "Everyone else", "delay": 90, "join": "any", "match": [{"type": "everyone"}]}]';
begin
  update public.schedule_rules set waves = nw where id and (waves = old_default
     or exists (select 1 from jsonb_array_elements(waves) w, jsonb_array_elements(w->'match') m where m->>'type' = 'tier' and m ? 'ids'
                and (m->'ids'->>0) ~ '^[0-9a-f]{8}-'));   -- interim version (assigned-tier ids)
end $$;
