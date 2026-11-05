-- ============================================================
-- SCHEDULE — TEAM / INTERNAL VIEW, LOCKING, GRANULAR PERMISSIONS (staging, 2026-11-05). Run after 14.
--  • Lock: shift_blocks.locked_at/locked_by. A locked interval keeps every existing assignment,
--    but its unfilled openings close: no claiming, no assigning, hidden from people who can't
--    manage the schedule (unless they're on it). Trades of EXISTING spots still work.
--    Capacity (total_spots) never changes; locked openings still count as unfilled in fill rate.
--  • Permissions (each separate, scoped by client/project): view team/internal, see names,
--    open details, claim, assign, unassign, add, edit, move, copy, delete, bulk, lock, unlock,
--    export, see ineligible people. Viewing NEVER grants changing.
--  • Server-side eligibility for claims and assignments: on the schedule (audience), passed the
--    gating certification (agents; "graceful" — only when one exists), no overlap, weekly cap.
--  • sched_* functions power the new Team / Internal view and every interval action.
-- ============================================================
alter table public.shift_blocks add column if not exists locked_at timestamptz;
alter table public.shift_blocks add column if not exists locked_by uuid references public.profiles(id) on delete set null;

insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('schedule.view_team',   'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'See the team schedule (agent intervals)', true, 140, 'user'),
 ('schedule.view_internal','schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'See internal schedules (internal staff shifts)', false, 141, 'manager'),
 ('schedule.view_names',  'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'See who''s assigned (names)', true, 142, 'user'),
 ('schedule.view_details','schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Open interval details', true, 143, 'user'),
 ('schedule.claim',       'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Pick up open intervals for themselves', false, 144, 'user'),
 ('schedule.assign',      'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Assign people to intervals', true, 145, 'manager'),
 ('schedule.unassign',    'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Unassign people from intervals', true, 146, 'manager'),
 ('schedule.view_ineligible','schedule_team','Schedule — team & intervals', 'My work', 'special', 'See ineligible people and why (when assigning)', true, 147, 'manager'),
 ('schedule.add',         'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Add intervals', true, 148, 'manager'),
 ('schedule.edit_iv',     'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Edit intervals', true, 149, 'manager'),
 ('schedule.move',        'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Move intervals', true, 150, 'manager'),
 ('schedule.copy',        'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Copy intervals', true, 151, 'manager'),
 ('schedule.delete_iv',   'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Delete intervals', true, 152, 'manager'),
 ('schedule.bulk',        'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Bulk actions (several intervals at once)', true, 153, 'manager'),
 ('schedule.lock',        'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Lock intervals (close their open spots)', true, 154, 'manager'),
 ('schedule.unlock',      'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Unlock intervals', true, 155, 'manager'),
 ('schedule.export',      'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Export schedules', true, 156, 'user')
on conflict (key) do update set module = excluded.module, module_label = excluded.module_label, module_group = excluded.module_group, action = excluded.action,
  label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level;
-- starter roles: Administrator → all; Manager → everything except internal + delete; User → claim + open details
insert into public.access_role_permissions (role_id, perm_key)
select r.id, c.key from public.access_roles r, public.perm_catalog c where r.is_starter and r.sort = 2 and c.module = 'schedule_team' on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, c.key from public.access_roles r, public.perm_catalog c where r.is_starter and r.sort = 3 and c.module = 'schedule_team'
   and c.key not in ('schedule.view_internal', 'schedule.delete_iv') on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['schedule.claim', 'schedule.view_details']) k where r.is_starter and r.sort = 4 on conflict do nothing;

-- ---------- helpers ----------
-- may I do <key> on this schedule? (client/project scope; internal schedules need "everything")
create or replace function public.sched_can(p_key text, p_schedule uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.is_access_owner() or exists (select 1 from public.schedules s where s.id = p_schedule and public.has_perm_on(p_key, s.project_id, s.client_id))
$$;
create or replace function public.sched_can_block(p_key text, p_block uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.sched_can(p_key, (select schedule_id from public.shift_blocks where id = p_block))
$$;
-- why can't this person work this interval? (null = they can)
create or replace function public.sched_ineligible_reason(p_block uuid, p_person uuid) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare b record; ct uuid; gating uuid[]; agent boolean; wk_start date; hrs numeric;
begin
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
  wk_start := date_trunc('week', b.block_date::timestamp)::date;
  select coalesce(sum(extract(epoch from (o.end_time - o.start_time)) / 3600), 0) into hrs from public.shift_claims c join public.shift_blocks o on o.id = c.shift_block_id
   where c.profile_id = p_person and o.block_date between wk_start and wk_start + 6;
  if hrs + extract(epoch from (b.end_time - b.start_time)) / 3600 > 40 then return 'Would go over 40 hours that week'; end if;
  return null;
end $$;

-- ---------- claim rules: + lock, + eligibility for self-claims ----------
do $$ declare d text; begin
  d := pg_get_functiondef('public.enforce_claim_rules'::regproc);
  if position('locked_at' in d) = 0 then
    d := replace(d, '-- RULE 1: never exceed total_spots',
      '-- RULE L (2026-11-05): locked intervals take no new people (a trade of an existing spot is allowed)
  if v_block.locked_at is not null and coalesce(current_setting(''cc.lock_bypass'', true), '''') <> ''1'' then
    raise exception ''This interval is locked — its open spots are closed.'';
  end if;
  -- RULE E (2026-11-05): people claiming for themselves must be on the schedule and hold the gating cert
  if auth.uid() is not null and auth.uid() = new.profile_id and coalesce(current_setting(''cc.lock_bypass'', true), '''') <> ''1''
     and not public.can_assign_intervals() and not public.is_access_owner() then
    declare v_reason text; begin
      v_reason := public.sched_ineligible_reason(new.shift_block_id, new.profile_id);
      if v_reason in (''Not on this schedule'', ''Missing required certification'', ''Not active'') then
        raise exception ''You can''''t pick up this interval: %.'', lower(v_reason);
      end if;
    end;
  end if;
  -- RULE 1: never exceed total_spots');
    if position('locked_at' in d) = 0 then raise exception 'claim rules not updated'; end if;
    execute d;
  end if;
  -- trades hand over an EXISTING spot, so they may proceed on locked intervals
  d := pg_get_functiondef('public.accept_interval_trade'::regproc);
  if position('cc.lock_bypass' in d) = 0 then
    d := regexp_replace(d, 'insert into shift_claims \(shift_block_id, profile_id, status\)', 'perform set_config(''cc.lock_bypass'', ''1'', true); insert into shift_claims (shift_block_id, profile_id, status)');
    if position('cc.lock_bypass' in d) = 0 then raise exception 'accept_interval_trade not updated'; end if;
    execute d;
  end if;
end $$;

-- ---------- visibility: locked intervals hidden from people who can't manage them (unless on them) ----------
create or replace function public.sched_on_block(p_block uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.shift_claims where shift_block_id = p_block and profile_id = auth.uid())
$$;
grant execute on function public.sched_on_block(uuid) to authenticated;
drop policy if exists "Everyone sees blocks of visible schedules" on public.shift_blocks;
create policy "Everyone sees blocks of visible schedules" on public.shift_blocks for select to authenticated using (
  exists (select 1 from public.schedules s where s.id = shift_blocks.schedule_id
          and (s.status = 'published' or exists (select 1 from public.profiles where id = auth.uid() and is_admin)))
  and (shift_blocks.locked_at is null
       or public.sched_on_block(shift_blocks.id)
       or public.can_assign_intervals() or public.sched_can('schedule.view_team', shift_blocks.schedule_id) or public.sched_can('schedule.view_internal', shift_blocks.schedule_id)));

-- ---------- the view ----------
-- Who can use which view, plus clients/projects for the filters.
create or replace function public.sched_scope() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'team', public.is_access_owner() or public.has_perm('schedule.view_team'),
    'internal', public.is_access_owner() or public.has_perm('schedule.view_internal'),
    'export', public.is_access_owner() or public.has_perm('schedule.export'),
    'add', public.is_access_owner() or public.has_perm('schedule.add'),
    'bulk', public.is_access_owner() or public.has_perm('schedule.bulk'),
    'lock', public.is_access_owner() or public.has_perm('schedule.lock'),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
       'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.projects p where p.client_id = c.id and p.deleted_at is null), '[]'::jsonb)) order by c.name)
       from public.clients c where c.archived_at is null and exists (select 1 from public.schedules s where s.client_id = c.id and s.status = 'published' and public.sched_can('schedule.view_team', s.id))), '[]'::jsonb))
$$;

-- p_mode: 'team' (client schedules, agents) | 'internal' (no-client schedules, internal staff)
create or replace function public.sched_view(p_mode text, p_from date, p_to date, p_client uuid default null, p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare res jsonb; now_et timestamp := now() at time zone 'America/New_York'; key text := case when p_mode = 'internal' then 'schedule.view_internal' else 'schedule.view_team' end;
begin
  if p_to < p_from or p_to - p_from > 42 then raise exception 'Pick a range up to 6 weeks.'; end if;
  with s as (
    select sc.* from public.schedules sc where sc.status = 'published'
      and ((p_mode = 'internal' and sc.client_id is null) or (p_mode <> 'internal' and sc.client_id is not null))
      and (p_client is null or sc.client_id = p_client) and (p_project is null or sc.project_id = p_project)
      and public.sched_can(key, sc.id)),
  b as (
    select bl.*, s.client_id, s.project_id, s.title sched_title,
      (select count(*) from public.shift_claims c where c.shift_block_id = bl.id) filled,
      public.sched_can('schedule.view_names', s.id) names_ok
    from public.shift_blocks bl join s on s.id = bl.schedule_id where bl.block_date between p_from and p_to)
  select jsonb_build_object(
    'blocks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'schedule_id', b.schedule_id, 'client_id', b.client_id, 'project_id', b.project_id, 'date', b.block_date, 'start', b.start_time, 'end', b.end_time,
        'role', b.role, 'total', b.total_spots, 'filled', b.filled, 'locked', b.locked_at is not null,
        'state', case when (b.block_date + b.end_time) <= now_et then 'past' when (b.block_date + b.start_time) <= now_et then 'current' else 'upcoming' end,
        'people', (select coalesce(jsonb_agg(jsonb_build_object('claim_id', c.id, 'person_id', c.profile_id,
              'name', case when b.names_ok then pr.full_name else null end,
              'checked_in', c.checked_in_at is not null, 'checked_out', c.checked_out_at is not null, 'status', c.status) order by pr.full_name), '[]'::jsonb)
            from public.shift_claims c join public.profiles pr on pr.id = c.profile_id where c.shift_block_id = b.id)
      ) order by b.block_date, b.start_time) from b), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', cl.id, 'name', coalesce(cl.name, 'Internal'),
        'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, 'No project')) order by p.name nulls last), '[]'::jsonb)
                     from (select distinct project_id from b where b.client_id is not distinct from cl.id) bp left join public.projects p on p.id = bp.project_id))
      order by cl.name nulls last)
      from (select distinct client_id from b) bc left join public.clients cl on cl.id = bc.client_id), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- interval details + the actions this person may take on it
create or replace function public.sched_detail(p_block uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare b record; sid uuid; res jsonb; now_et timestamp := now() at time zone 'America/New_York';
begin
  select bl.*, s.client_id, s.project_id, s.title, s.call_type_id into b from public.shift_blocks bl join public.schedules s on s.id = bl.schedule_id where bl.id = p_block;
  if b.id is null then raise exception 'That interval no longer exists.'; end if;
  sid := b.schedule_id;
  if not (public.sched_can('schedule.view_details', sid) or public.sched_can('schedule.view_team', sid) or public.sched_can('schedule.view_internal', sid)) then raise exception 'not allowed'; end if;
  select jsonb_build_object('id', b.id, 'schedule_id', sid, 'schedule', b.title,
    'client', (select name from public.clients where id = b.client_id), 'project', (select name from public.projects where id = b.project_id),
    'date', b.block_date, 'start', b.start_time, 'end', b.end_time, 'role', b.role, 'notes', b.notes, 'total', b.total_spots,
    'filled', (select count(*) from public.shift_claims where shift_block_id = b.id), 'locked', b.locked_at is not null, 'locked_at', b.locked_at,
    'locked_by', (select full_name from public.profiles where id = b.locked_by),
    'state', case when (b.block_date + b.end_time) <= now_et then 'past' when (b.block_date + b.start_time) <= now_et then 'current' else 'upcoming' end,
    'people', case when public.sched_can('schedule.view_names', sid) then (select coalesce(jsonb_agg(jsonb_build_object('claim_id', c.id, 'person_id', c.profile_id, 'name', pr.full_name,
        'checked_in', c.checked_in_at is not null, 'status', c.status) order by pr.full_name), '[]'::jsonb) from public.shift_claims c join public.profiles pr on pr.id = c.profile_id where c.shift_block_id = b.id) end,
    'can', jsonb_build_object(
      'assign', public.sched_can('schedule.assign', sid) and b.locked_at is null and (b.block_date + b.end_time) > now_et,
      'unassign', public.sched_can('schedule.unassign', sid), 'edit', public.sched_can('schedule.edit_iv', sid),
      'copy', public.sched_can('schedule.copy', sid), 'move', public.sched_can('schedule.move', sid), 'delete', public.sched_can('schedule.delete_iv', sid),
      'lock', public.sched_can('schedule.lock', sid) and b.locked_at is null, 'unlock', public.sched_can('schedule.unlock', sid) and b.locked_at is not null,
      'claim', public.has_perm('schedule.claim') and b.locked_at is null and (b.block_date + b.start_time) > now_et and public.sched_ineligible_reason(b.id, auth.uid()) is null
               and (select count(*) from public.shift_claims where shift_block_id = b.id) < b.total_spots)
  ) into res;
  return res;
end $$;

-- who can be assigned (eligible) and who can't + why (ineligible: only with that permission)
create or replace function public.sched_eligible(p_block uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare sid uuid := (select schedule_id from public.shift_blocks where id = p_block); show_inel boolean;
begin
  if not public.sched_can('schedule.assign', sid) then raise exception 'You don''t have permission to assign people here.'; end if;
  show_inel := public.sched_can('schedule.view_ineligible', sid);
  return (select jsonb_build_object(
    'eligible', coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'title', x.job_title, 'agent', x.agent) order by x.full_name) filter (where x.reason is null), '[]'::jsonb),
    'ineligible', case when show_inel then coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'reason', x.reason) order by x.full_name) filter (where x.reason is not null and x.reason <> 'Already on this interval'), '[]'::jsonb) end)
  from (select pr.id, pr.full_name, pr.job_title, public.dash_is_agent(pr.id) agent, public.sched_ineligible_reason(p_block, pr.id) reason
        from public.profiles pr where pr.is_active and pr.client_id is null
          and pr.id in (select profile_id from public.schedule_audience where schedule_id = sid
                        union select c.profile_id from public.shift_claims c where c.shift_block_id = p_block)) x);
end $$;

-- ---------- actions (each checks its own permission + scope; all logged) ----------
create or replace function public._sched_log(p_block uuid, p_action text, p_person uuid default null, p_extra text default null) returns void
language sql security definer set search_path to 'public' as $$
  insert into public.schedule_activity_log (actor_id, action, schedule_id, schedule_title, shift_block_id, block_label, affected_profile_id, affected_profile_name)
  select auth.uid(), p_action, s.id, s.title, b.id, to_char(b.block_date, 'Dy Mon DD') || ' ' || to_char(b.start_time, 'HH12:MI AM') || coalesce(' · ' || p_extra, ''),
         p_person, (select full_name from public.profiles where id = p_person)
  from public.shift_blocks b join public.schedules s on s.id = b.schedule_id where b.id = p_block
$$;
revoke all on function public._sched_log(uuid, text, uuid, text) from public, authenticated;

create or replace function public.sched_assign(p_block uuid, p_people uuid[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare b record; pid uuid; reason text; done int := 0; out jsonb := '[]'::jsonb;
begin
  select * into b from public.shift_blocks where id = p_block for update;   -- one assigner at a time per interval
  if b.id is null then raise exception 'That interval no longer exists.'; end if;
  if not public.sched_can('schedule.assign', b.schedule_id) then raise exception 'You don''t have permission to assign people here.'; end if;
  if b.locked_at is not null then raise exception 'This interval is locked — unlock it first.'; end if;
  foreach pid in array p_people loop
    if (select count(*) from public.shift_claims where shift_block_id = b.id) >= b.total_spots then
      out := out || jsonb_build_object('id', pid, 'ok', false, 'reason', 'No open spots left'); continue; end if;
    reason := public.sched_ineligible_reason(b.id, pid);
    if reason is not null then out := out || jsonb_build_object('id', pid, 'ok', false, 'reason', reason); continue; end if;
    begin
      perform set_config('cc.assigning', '1', true);
      insert into public.shift_claims (shift_block_id, profile_id, status) values (b.id, pid, 'claimed');
      perform public._sched_log(b.id, 'assigned', pid);
      done := done + 1; out := out || jsonb_build_object('id', pid, 'ok', true);
    exception when others then out := out || jsonb_build_object('id', pid, 'ok', false, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('assigned', done, 'results', out);
end $$;

create or replace function public.sched_unassign(p_claims uuid[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; done int := 0; skipped int := 0;
begin
  for r in select c.*, b.schedule_id from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id where c.id = any (p_claims) loop
    if not public.sched_can('schedule.unassign', r.schedule_id) or r.checked_in_at is not null then skipped := skipped + 1; continue; end if;
    delete from public.shift_claims where id = r.id;
    perform public._sched_log(r.shift_block_id, 'unassigned', r.profile_id);
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'skipped', skipped);
end $$;

create or replace function public.sched_lock(p_blocks uuid[], p_lock boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare b record; done int := 0; skipped int := 0; k text := case when p_lock then 'schedule.lock' else 'schedule.unlock' end;
begin
  if coalesce(array_length(p_blocks, 1), 0) > 1 and not (public.is_access_owner() or public.has_perm('schedule.bulk')) then raise exception 'You don''t have permission for bulk actions.'; end if;
  for b in select * from public.shift_blocks where id = any (p_blocks) for update loop
    if not public.sched_can(k, b.schedule_id) or (p_lock and b.locked_at is not null) or (not p_lock and b.locked_at is null) then skipped := skipped + 1; continue; end if;
    update public.shift_blocks set locked_at = case when p_lock then now() end, locked_by = case when p_lock then auth.uid() end where id = b.id;
    perform public._sched_log(b.id, case when p_lock then 'locked' else 'unlocked' end, null,
      (b.total_spots - (select count(*) from public.shift_claims where shift_block_id = b.id)) || ' open spot(s) ' || case when p_lock then 'closed' else 'reopened' end);
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'skipped', skipped);
end $$;

create or replace function public.sched_edit(p_block uuid, p_start time, p_end time, p_spots int, p_role text, p_notes text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare b record; filled int;
begin
  select * into b from public.shift_blocks where id = p_block for update;
  if not public.sched_can('schedule.edit_iv', b.schedule_id) then raise exception 'You don''t have permission to edit intervals here.'; end if;
  if p_end <= p_start then raise exception 'The end time has to be after the start time.'; end if;
  filled := (select count(*) from public.shift_claims where shift_block_id = b.id);
  if p_spots < greatest(filled, 1) then raise exception 'There are already % people on this interval — spots can''t go below that.', filled; end if;
  if filled > 0 and (p_start <> b.start_time or p_end <> b.end_time) then raise exception 'People are already on this interval — unassign them before changing its time, or copy it instead.'; end if;
  update public.shift_blocks set start_time = p_start, end_time = p_end, total_spots = p_spots, role = nullif(btrim(p_role), ''), notes = nullif(btrim(p_notes), '') where id = b.id;
  perform public._sched_log(b.id, 'edited');
end $$;

create or replace function public.sched_move(p_block uuid, p_date date, p_start time, p_end time) returns void
language plpgsql security definer set search_path to 'public' as $$
declare b record;
begin
  select * into b from public.shift_blocks where id = p_block for update;
  if not public.sched_can('schedule.move', b.schedule_id) then raise exception 'You don''t have permission to move intervals here.'; end if;
  if exists (select 1 from public.shift_claims where shift_block_id = b.id) then raise exception 'People are on this interval — unassign them first, or copy it instead.'; end if;
  if p_end <= p_start then raise exception 'The end time has to be after the start time.'; end if;
  update public.shift_blocks set block_date = p_date, start_time = p_start, end_time = p_end where id = b.id;
  perform public._sched_log(b.id, 'moved', null, 'from ' || to_char(b.block_date, 'Mon DD') || ' ' || to_char(b.start_time, 'FMHH12:MI AM'));
end $$;

create or replace function public.sched_copy(p_block uuid, p_dates date[]) returns int
language plpgsql security definer set search_path to 'public' as $$
declare b record; d date; n int := 0; nid uuid;
begin
  select * into b from public.shift_blocks where id = p_block;
  if not public.sched_can('schedule.copy', b.schedule_id) then raise exception 'You don''t have permission to copy intervals here.'; end if;
  if coalesce(array_length(p_dates, 1), 0) > 1 and not (public.is_access_owner() or public.has_perm('schedule.bulk')) then raise exception 'Copying to several days is a bulk action.'; end if;
  foreach d in array p_dates loop
    insert into public.shift_blocks (schedule_id, block_date, start_time, end_time, role, total_spots, notes, release_at)
    values (b.schedule_id, d, b.start_time, b.end_time, b.role, b.total_spots, b.notes, b.release_at) returning id into nid;
    perform public._sched_log(nid, 'copied', null, 'from ' || to_char(b.block_date, 'Mon DD'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.sched_delete(p_blocks uuid[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare b record; done int := 0; blocked int := 0;
begin
  if coalesce(array_length(p_blocks, 1), 0) > 1 and not (public.is_access_owner() or public.has_perm('schedule.bulk')) then raise exception 'You don''t have permission for bulk actions.'; end if;
  for b in select * from public.shift_blocks where id = any (p_blocks) loop
    if not public.sched_can('schedule.delete_iv', b.schedule_id) or exists (select 1 from public.shift_claims where shift_block_id = b.id) then blocked := blocked + 1; continue; end if;
    perform public._sched_log(b.id, 'deleted');
    delete from public.shift_blocks where id = b.id;
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'blocked', blocked);
end $$;

create or replace function public.sched_add(p_schedule uuid, p_date date, p_start time, p_end time, p_spots int, p_role text) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare nid uuid;
begin
  if not public.sched_can('schedule.add', p_schedule) then raise exception 'You don''t have permission to add intervals here.'; end if;
  if p_end <= p_start then raise exception 'The end time has to be after the start time.'; end if;
  insert into public.shift_blocks (schedule_id, block_date, start_time, end_time, role, total_spots, release_at)
  values (p_schedule, p_date, p_start, p_end, nullif(btrim(p_role), ''), greatest(p_spots, 1), now()) returning id into nid;
  perform public._sched_log(nid, 'added');
  return nid;
end $$;
grant execute on function public.sched_scope(), public.sched_view(text, date, date, uuid, uuid), public.sched_detail(uuid), public.sched_eligible(uuid),
  public.sched_assign(uuid, uuid[]), public.sched_unassign(uuid[]), public.sched_lock(uuid[], boolean), public.sched_edit(uuid, time, time, int, text, text),
  public.sched_move(uuid, date, time, time), public.sched_copy(uuid, date[]), public.sched_delete(uuid[]), public.sched_add(uuid, date, time, time, int, text) to authenticated;

-- assignments made through sched_assign skip release waves (like ASC assigning today)
do $$ declare d text; begin
  d := pg_get_functiondef('public.enforce_claim_rules'::regproc);
  if position('cc.assigning' in d) = 0 then
    d := replace(d, 'and not (auth.uid() is distinct from new.profile_id and public.can_assign_intervals())',
                    'and not (auth.uid() is distinct from new.profile_id and (public.can_assign_intervals() or coalesce(current_setting(''cc.assigning'', true), '''') = ''1''))');
    if position('cc.assigning' in d) = 0 then raise exception 'release-wave bypass not added'; end if;
    execute d;
  end if;
end $$;

-- ---------- locked openings are never "open" for alerts or the Dashboard's open list ----------
do $$ declare d text; begin
  d := pg_get_functiondef('public._send_open_alert(uuid,text,uuid)'::regprocedure);
  if position('locked_at' in d) = 0 then
    d := replace(d, 'if b.id is null then return 0; end if;', 'if b.id is null or b.locked_at is not null then return 0; end if;');
    if position('locked_at' in d) = 0 then raise exception '_send_open_alert not updated'; end if; execute d;
  end if;
  d := pg_get_functiondef('public.dash_schedule(uuid,uuid,date,int)'::regprocedure);
  if position('locked_at' in d) = 0 then
    d := replace(d, 'from b where b.filled < b.total_spots)', 'from b where b.filled < b.total_spots and b.locked_at is null)');
    if position('locked_at' in d) = 0 then raise exception 'dash_schedule not updated'; end if; execute d;
  end if;
end $$;
