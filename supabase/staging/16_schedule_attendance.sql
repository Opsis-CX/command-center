-- ============================================================
-- SCHEDULE — CHECK IN / OUT + NO-SHOW from Interval details (staging, 2026-11-05). Run after 15.
-- Two separate, client/project-scoped permissions:
--   schedule.checkin  "Check people in and out"
--   schedule.no_show  "Mark and clear no-shows"
-- p_action: 'in' | 'in_at_start' | 'out' | 'no_show' | 'clear_no_show'
-- Never on yourself. Every change is noted on the claim (checkout_note) and logged.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('schedule.checkin', 'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Check people in and out', true, 157, 'manager'),
 ('schedule.no_show', 'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'Mark and clear no-shows', true, 158, 'manager')
on conflict (key) do update set label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level, module = excluded.module, action = excluded.action;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['schedule.checkin', 'schedule.no_show']) k where r.is_starter and r.sort in (2, 3) on conflict do nothing;

create or replace function public.sched_attendance(p_claims uuid[], p_action text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; done int := 0; skipped int := 0; reasons text[] := '{}'; me text := (select full_name from public.profiles where id = auth.uid());
  now_et timestamp := now() at time zone 'America/New_York'; k text; note text; why text;
begin
  if p_action not in ('in', 'in_at_start', 'out', 'no_show', 'clear_no_show') then raise exception 'Unknown action.'; end if;
  k := case when p_action in ('no_show', 'clear_no_show') then 'schedule.no_show' else 'schedule.checkin' end;
  for r in select c.*, b.block_date, b.start_time, b.end_time, b.schedule_id, pr.full_name
             from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id join public.profiles pr on pr.id = c.profile_id
            where c.id = any (p_claims) for update of c loop
    why := case
      when not public.sched_can(k, r.schedule_id) then 'no permission'
      when r.profile_id = auth.uid() then 'can''t change your own'
      when p_action in ('in', 'in_at_start') and r.checked_in_at is not null then 'already checked in'
      when p_action in ('in', 'in_at_start') and r.status = 'no_show' then 'marked no-show — clear that first'
      when p_action = 'out' and (r.checked_in_at is null or r.checked_out_at is not null) then 'not checked in'
      when p_action = 'no_show' and r.checked_in_at is not null then 'they checked in'
      when p_action = 'no_show' and (r.block_date + r.start_time) > now_et then 'interval hasn''t started'
      when p_action = 'no_show' and r.status = 'no_show' then 'already a no-show'
      when p_action = 'clear_no_show' and r.status is distinct from 'no_show' then 'not a no-show'
      else null end;
    if why is not null then skipped := skipped + 1; reasons := reasons || (r.full_name || ': ' || why); continue; end if;
    note := case p_action when 'in' then 'Checked in' when 'in_at_start' then 'Checked in (as of shift start)' when 'out' then 'Checked out'
                          when 'no_show' then 'Marked no-show' else 'No-show cleared' end || ' by ' || coalesce(me, 'a manager');
    if p_action in ('in', 'in_at_start') then
      update public.shift_claims set checked_in_at = case when p_action = 'in_at_start' then (r.block_date + r.start_time) at time zone 'America/New_York' else now() end,
        status = 'checked_in', checkout_note = concat_ws(' · ', nullif(checkout_note, ''), note) where id = r.id;
    elsif p_action = 'out' then
      update public.shift_claims set checked_out_at = now(), status = 'completed', checkout_note = concat_ws(' · ', nullif(checkout_note, ''), note) where id = r.id;
    elsif p_action = 'no_show' then
      update public.shift_claims set status = 'no_show', checkout_note = concat_ws(' · ', nullif(checkout_note, ''), note) where id = r.id;
    else
      update public.shift_claims set status = case when checked_out_at is not null then 'completed' when checked_in_at is not null then 'checked_in' else 'claimed' end,
        checkout_note = concat_ws(' · ', nullif(checkout_note, ''), note) where id = r.id;
    end if;
    perform public._sched_log(r.shift_block_id, case p_action when 'in' then 'checked_in' when 'in_at_start' then 'checked_in' when 'out' then 'checked_out'
                                                 when 'no_show' then 'marked_no_show' else 'no_show_cleared' end, r.profile_id, 'by ' || coalesce(me, 'a manager'));
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'skipped', skipped, 'reasons', to_jsonb(reasons));
end $$;
grant execute on function public.sched_attendance(uuid[], text) to authenticated;

-- Interval details: attendance per person + whether you may change it
do $$ declare d text; begin
  d := pg_get_functiondef('public.sched_detail(uuid)'::regprocedure);
  if position('''no_show'', public.sched_can' in d) = 0 then
    d := replace(d, '''checked_in'', c.checked_in_at is not null, ''status'', c.status) order by pr.full_name)',
                    '''checked_in'', c.checked_in_at is not null, ''checked_in_at'', c.checked_in_at, ''checked_out_at'', c.checked_out_at, ''status'', c.status) order by pr.full_name)');
    d := replace(d, '''unassign'', public.sched_can(''schedule.unassign'', sid),',
                    '''unassign'', public.sched_can(''schedule.unassign'', sid), ''checkin'', public.sched_can(''schedule.checkin'', sid), ''no_show'', public.sched_can(''schedule.no_show'', sid), ''started'', (b.block_date + b.start_time) <= now_et,');
    if position('''no_show'', public.sched_can' in d) = 0 or position('checked_out_at'', c.checked_out_at' in d) = 0 then raise exception 'sched_detail not updated'; end if;
    execute d;
  end if;
end $$;
