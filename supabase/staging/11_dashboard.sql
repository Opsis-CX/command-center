-- ============================================================
-- DASHBOARD (staging, 2026-11-04). Run after 01–10.
--  • schedules.project_id — each schedule belongs to a client AND (optionally) a project.
--  • Checkboxes: Overview tab, Client/Project tab (scoped), each view, and seeing names.
--  • dash_* functions return ONLY what the caller may see (server-side), never raw tables:
--      scope   = schedules whose client/project the caller has "dashboard.client" for (Owners: all)
--      people  = Owners: all · Administrators: agents + internal staff in scope · everyone else
--                with dashboard access: agents in scope · plus anyone who reports to them.
-- ============================================================
alter table public.schedules add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists schedules_project on public.schedules (project_id);

insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('dashboard.overview', 'dashboard', 'Dashboard', 'My work', 'view', 'See the Overview tab (all their clients & projects combined)', false, 20, 'manager'),
 ('dashboard.client', 'dashboard', 'Dashboard', 'My work', 'create', 'See the Client / Project tab', true, 21, 'user'),
 ('dashboard.operations', 'dashboard', 'Dashboard', 'My work', 'edit', 'Dashboard view: Operations', false, 22, 'user'),
 ('dashboard.staffing', 'dashboard', 'Dashboard', 'My work', 'delete', 'Dashboard view: Staffing', false, 23, 'user'),
 ('dashboard.schedule', 'dashboard', 'Dashboard', 'My work', 'approve', 'Dashboard view: Schedule', false, 24, 'user'),
 ('dashboard.activity', 'dashboard', 'Dashboard', 'My work', 'export', 'Dashboard view: Activity', false, 25, 'user'),
 ('dashboard.names', 'dashboard', 'Dashboard', 'My work', 'manage', 'See individual employees (names, who''s on)', false, 26, 'user')
on conflict (key) do update set module = excluded.module, module_label = excluded.module_label, module_group = excluded.module_group, action = excluded.action,
  label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level;
-- starter roles: Administrator → all; Manager → client tab + all views + names (no Overview)
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['dashboard.overview','dashboard.client','dashboard.operations','dashboard.staffing','dashboard.schedule','dashboard.activity','dashboard.names']) k
 where r.is_starter and r.sort = 2 on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['dashboard.client','dashboard.operations','dashboard.staffing','dashboard.schedule','dashboard.activity','dashboard.names']) k
 where r.is_starter and r.sort = 3 on conflict do nothing;

-- ---------- scope ----------
create or replace function public.dash_schedule_ok(p_client uuid, p_project uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.is_access_owner() or public.has_perm_on('dashboard.client', p_project, p_client)
$$;
-- clients & projects the caller can pick (for the dropdowns / overview rows)
create or replace function public.dash_scope() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'overview', public.is_access_owner() or public.has_perm('dashboard.overview'),
    'client_tab', public.is_access_owner() or public.has_perm('dashboard.client'),
    'views', jsonb_build_object('operations', public.is_access_owner() or public.has_perm('dashboard.operations'), 'staffing', public.is_access_owner() or public.has_perm('dashboard.staffing'),
      'schedule', public.is_access_owner() or public.has_perm('dashboard.schedule'), 'activity', public.is_access_owner() or public.has_perm('dashboard.activity')),
    'names', public.is_access_owner() or public.has_perm('dashboard.names'),
    'internal', public.is_access_owner() or public.level_rank(public.my_level()) >= 3,
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.projects p
                              where p.client_id = c.id and p.deleted_at is null and public.dash_schedule_ok(c.id, p.id)), '[]'::jsonb)) order by c.name)
      from public.clients c where c.archived_at is null and (public.dash_schedule_ok(c.id, null)
        or exists (select 1 from public.projects p where p.client_id = c.id and p.deleted_at is null and public.dash_schedule_ok(c.id, p.id)))), '[]'::jsonb))
$$;

-- schedules in scope for a filter (mode overview = all permitted; client/project narrows)
create or replace function public.dash_schedules(p_client uuid, p_project uuid) returns table (schedule_id uuid, client_id uuid, project_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select s.id, s.client_id, s.project_id from public.schedules s
   where s.status = 'published'
     and (p_client is null or s.client_id = p_client) and (p_project is null or s.project_id = p_project)
     and public.dash_schedule_ok(s.client_id, s.project_id)
$$;

-- is this person an agent?
create or replace function public.dash_is_agent(p uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select lower(coalesce(role, '')) like '%agent%' from public.profiles where id = p), false)
$$;
-- does p report to me (any depth)?
create or replace function public.dash_reports_to_me(p uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  with recursive chain as (select id, manager_id, 1 d from public.profiles where id = p
                           union all select pr.id, pr.manager_id, c.d + 1 from public.profiles pr join chain c on pr.id = c.manager_id where c.d < 12)
  select exists (select 1 from chain where manager_id = auth.uid())
$$;
-- may I see this person on the dashboard, given the schedules they're tied to?
create or replace function public.dash_person_visible(p uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_access_owner() or public.dash_reports_to_me(p) or (
    (public.has_perm('dashboard.names'))
    and (public.dash_is_agent(p) or public.level_rank(public.my_level()) >= 3)
    and exists (select 1 from public.schedules s where public.dash_schedule_ok(s.client_id, s.project_id) and (
          exists (select 1 from public.schedule_audience a where a.schedule_id = s.id and a.profile_id = p)
       or exists (select 1 from public.shift_blocks b join public.shift_claims c on c.shift_block_id = b.id
                   where b.schedule_id = s.id and c.profile_id = p and b.block_date > current_date - 30))))
$$;
grant execute on function public.dash_scope(), public.dash_schedule_ok(uuid, uuid), public.dash_person_visible(uuid) to authenticated;

-- ---------- OPERATIONS ----------
create or replace function public.dash_operations(p_client uuid default null, p_project uuid default null, p_from date default null, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare f date := coalesce(p_from, (now() at time zone 'America/New_York')::date); t date; pf date; res jsonb;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.operations')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  t := f + greatest(1, least(p_days, 31)) - 1; pf := f - greatest(1, least(p_days, 31));
  with s as (select * from public.dash_schedules(p_client, p_project)),
  b as (select bl.*, s.client_id, s.project_id, (select count(*) from public.shift_claims c where c.shift_block_id = bl.id) as filled
          from public.shift_blocks bl join s on s.schedule_id = bl.schedule_id where bl.block_date between pf and t),
  cur as (select * from b where block_date between f and t), prev as (select * from b where block_date < f),
  agents_cur as (select distinct c.profile_id from cur join public.shift_claims c on c.shift_block_id = cur.id where public.dash_is_agent(c.profile_id)),
  agents_prev as (select distinct c.profile_id from prev join public.shift_claims c on c.shift_block_id = prev.id where public.dash_is_agent(c.profile_id))
  select jsonb_build_object(
    'from', f, 'to', t,
    'kpis', jsonb_build_object(
      'fill_rate', (select round(100.0 * sum(least(filled, total_spots)) / nullif(sum(total_spots), 0)) from cur),
      'fill_rate_prev', (select round(100.0 * sum(least(filled, total_spots)) / nullif(sum(total_spots), 0)) from prev),
      'open_spots', (select coalesce(sum(greatest(total_spots - filled, 0)), 0) from cur),
      'open_spots_prev', (select coalesce(sum(greatest(total_spots - filled, 0)), 0) from prev),
      'active_agents', (select count(*) from agents_cur), 'active_agents_prev', (select count(*) from agents_prev),
      'certs_week', (select count(*) from public.agent_cert_records r where r.status = 'passed' and r.passed_at >= now() - interval '7 days'
                       and exists (select 1 from agents_cur a where a.profile_id = r.profile_id))),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'spots', coalesce(x.spots, 0), 'filled', coalesce(x.filled, 0),
                'pct', case when coalesce(x.spots, 0) > 0 then round(100.0 * x.filled / x.spots) end) order by d), '[]'::jsonb)
              from generate_series(f, t, interval '1 day') d
              left join (select block_date, sum(total_spots) spots, sum(least(filled, total_spots)) filled from cur group by 1) x on x.block_date = d::date),
    'rows', (select coalesce(jsonb_agg(r order by r->>'client'), '[]'::jsonb) from (
              select jsonb_build_object('client_id', c.id, 'client', coalesce(c.name, 'Internal'),
                'spots', sum(cur.total_spots), 'filled', sum(least(cur.filled, cur.total_spots)), 'open', sum(greatest(cur.total_spots - cur.filled, 0)),
                'pct', round(100.0 * sum(least(cur.filled, cur.total_spots)) / nullif(sum(cur.total_spots), 0)),
                'agents', (select count(distinct cl.profile_id) from cur c2 join public.shift_claims cl on cl.shift_block_id = c2.id where c2.client_id is not distinct from c.id and public.dash_is_agent(cl.profile_id)),
                'projects', (select coalesce(jsonb_agg(pp order by pp->>'name'), '[]'::jsonb) from (
                    select jsonb_build_object('project_id', p.id, 'name', coalesce(p.name, 'No project'), 'spots', sum(c3.total_spots), 'filled', sum(least(c3.filled, c3.total_spots)),
                      'open', sum(greatest(c3.total_spots - c3.filled, 0)), 'pct', round(100.0 * sum(least(c3.filled, c3.total_spots)) / nullif(sum(c3.total_spots), 0)),
                      'agents', (select count(distinct cl.profile_id) from cur c4 join public.shift_claims cl on cl.shift_block_id = c4.id
                                  where c4.client_id is not distinct from c.id and c4.project_id is not distinct from p.id and public.dash_is_agent(cl.profile_id))) pp
                    from cur c3 left join public.projects p on p.id = c3.project_id where c3.client_id is not distinct from c.id group by p.id, p.name) q)) r
              from cur left join public.clients c on c.id = cur.client_id group by c.id, c.name) z),
    'attention', (select coalesce(jsonb_agg(a order by (a->>'pct')::int nulls last), '[]'::jsonb) from (
              select jsonb_build_object('client', coalesce(c.name, 'Internal'), 'project', p.name, 'date', cur.block_date,
                'pct', round(100.0 * sum(least(cur.filled, cur.total_spots)) / nullif(sum(cur.total_spots), 0)), 'open', sum(greatest(cur.total_spots - cur.filled, 0))) a
              from cur left join public.clients c on c.id = cur.client_id left join public.projects p on p.id = cur.project_id
              group by c.name, p.name, cur.block_date
              having sum(cur.total_spots) > 0 and 100.0 * sum(least(cur.filled, cur.total_spots)) / sum(cur.total_spots) < 70
              order by 100.0 * sum(least(cur.filled, cur.total_spots)) / sum(cur.total_spots) limit 6) y)
  ) into res;
  return res;
end $$;

-- ---------- STAFFING ----------
create or replace function public.dash_staffing(p_client uuid default null, p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare today date := (now() at time zone 'America/New_York')::date; can_internal boolean; can_names boolean; res jsonb;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.staffing')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  can_internal := public.is_access_owner() or public.level_rank(public.my_level()) >= 3;
  can_names := public.is_access_owner() or public.has_perm('dashboard.names');
  with s as (select * from public.dash_schedules(p_client, p_project)),
  -- people tied to these schedules: assigned (audience) or worked/working an interval in the last 30 / next 14 days
  tied as (
    select distinct x.profile_id, x.client_id, x.project_id from (
      select a.profile_id, s.client_id, s.project_id from public.schedule_audience a join s on s.schedule_id = a.schedule_id
      union
      select c.profile_id, s.client_id, s.project_id from public.shift_blocks b join s on s.schedule_id = b.schedule_id
        join public.shift_claims c on c.shift_block_id = b.id where b.block_date between today - 30 and today + 14) x
    join public.profiles pr on pr.id = x.profile_id and pr.is_active and pr.client_id is null),
  ppl as (select t.*, public.dash_is_agent(t.profile_id) as is_agent from tied t),
  shown as (select * from ppl where is_agent or can_internal or public.dash_reports_to_me(profile_id)),
  onnow as (select distinct c.profile_id, s.client_id, s.project_id from public.shift_claims c join public.shift_blocks b on b.id = c.shift_block_id
              join s on s.schedule_id = b.schedule_id where c.checked_in_at is not null and c.checked_out_at is null and b.block_date between today - 1 and today),
  wk as (select b.*, s.client_id, s.project_id, (select count(*) from public.shift_claims c where c.shift_block_id = b.id) filled
           from public.shift_blocks b join s on s.schedule_id = b.schedule_id where b.block_date between today and today + 6)
  select jsonb_build_object(
    'can_internal', can_internal, 'can_names', can_names,
    'totals', jsonb_build_object(
      'total', (select count(distinct profile_id) from shown),
      'agents', (select count(distinct profile_id) from shown where is_agent),
      'internal', case when can_internal then (select count(distinct profile_id) from shown where not is_agent) end,
      'on_now', (select count(distinct o.profile_id) from onnow o where o.profile_id in (select profile_id from shown)),
      'open_spots', (select coalesce(sum(greatest(total_spots - filled, 0)), 0) from wk)),
    'rows', (select coalesce(jsonb_agg(r order by r->>'client'), '[]'::jsonb) from (
      select jsonb_build_object('client_id', c.id, 'client', coalesce(c.name, 'Internal'),
        'assigned', count(distinct sh.profile_id), 'agents', count(distinct sh.profile_id) filter (where sh.is_agent),
        'on_now', (select count(distinct o.profile_id) from onnow o where o.client_id is not distinct from c.id and o.profile_id in (select profile_id from shown)),
        'utilization', (select round(100.0 * sum(least(w.filled, w.total_spots)) / nullif(sum(w.total_spots), 0)) from wk w where w.client_id is not distinct from c.id),
        'projects', (select coalesce(jsonb_agg(pp order by pp->>'name'), '[]'::jsonb) from (
            select jsonb_build_object('project_id', p.id, 'name', coalesce(p.name, 'No project'), 'assigned', count(distinct s2.profile_id),
              'on_now', (select count(distinct o.profile_id) from onnow o where o.client_id is not distinct from c.id and o.project_id is not distinct from p.id and o.profile_id in (select profile_id from shown)),
              'utilization', (select round(100.0 * sum(least(w.filled, w.total_spots)) / nullif(sum(w.total_spots), 0)) from wk w where w.client_id is not distinct from c.id and w.project_id is not distinct from p.id)) pp
            from shown s2 left join public.projects p on p.id = s2.project_id where s2.client_id is not distinct from c.id group by p.id, p.name) q)) r
      from shown sh left join public.clients c on c.id = sh.client_id group by c.id, c.name) z),
    'people', case when can_names then (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'avatar', pr.avatar_url, 'type', case when x.is_agent then 'agent' else 'internal' end,
                 'title', pr.job_title, 'on_now', exists (select 1 from onnow o where o.profile_id = pr.id),
                 'where', (select string_agg(distinct coalesce(c.name, 'Internal') || coalesce(' · ' || p.name, ''), ', ') from shown s3
                            left join public.clients c on c.id = s3.client_id left join public.projects p on p.id = s3.project_id where s3.profile_id = pr.id))
                 order by exists (select 1 from onnow o where o.profile_id = pr.id) desc, pr.full_name), '[]'::jsonb)
               from (select distinct profile_id, bool_or(is_agent) is_agent from shown group by profile_id) x join public.profiles pr on pr.id = x.profile_id
               where public.dash_person_visible(pr.id) or public.dash_reports_to_me(pr.id) or public.is_access_owner()) end
  ) into res;
  return res;
end $$;

-- ---------- SCHEDULE ----------
create or replace function public.dash_schedule(p_client uuid default null, p_project uuid default null, p_from date default null, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare f date := coalesce(p_from, (now() at time zone 'America/New_York')::date); t date; res jsonb;
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.schedule')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  t := f + greatest(1, least(p_days, 31)) - 1;
  with s as (select * from public.dash_schedules(p_client, p_project)),
  b as (select bl.*, s.client_id, s.project_id, (select count(*) from public.shift_claims c where c.shift_block_id = bl.id) filled
          from public.shift_blocks bl join s on s.schedule_id = bl.schedule_id where bl.block_date between f and t)
  select jsonb_build_object('from', f, 'to', t,
    'days', (select jsonb_agg(d::date order by d) from generate_series(f, t, interval '1 day') d),
    'rows', (select coalesce(jsonb_agg(r order by r->>'client'), '[]'::jsonb) from (
      select jsonb_build_object('client_id', c.id, 'client', coalesce(c.name, 'Internal'),
        'cells', (select jsonb_object_agg(d::date, jsonb_build_object('spots', coalesce(x.spots, 0), 'filled', coalesce(x.filled, 0)))
                  from generate_series(f, t, interval '1 day') d left join (select block_date, sum(total_spots) spots, sum(least(filled, total_spots)) filled
                    from b where b.client_id is not distinct from c.id group by 1) x on x.block_date = d::date),
        'projects', (select coalesce(jsonb_agg(pp order by pp->>'name'), '[]'::jsonb) from (
            select jsonb_build_object('project_id', p.id, 'name', coalesce(p.name, 'No project'),
              'cells', (select jsonb_object_agg(d::date, jsonb_build_object('spots', coalesce(x.spots, 0), 'filled', coalesce(x.filled, 0)))
                        from generate_series(f, t, interval '1 day') d left join (select block_date, sum(total_spots) spots, sum(least(filled, total_spots)) filled
                          from b b2 where b2.client_id is not distinct from c.id and b2.project_id is not distinct from p.id group by 1) x on x.block_date = d::date)) pp
            from (select distinct project_id from b where b.client_id is not distinct from c.id) bp left join public.projects p on p.id = bp.project_id) q)) r
      from (select distinct client_id from b) bc left join public.clients c on c.id = bc.client_id) z),
    'open', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'date', b.block_date, 'start', b.start_time, 'end', b.end_time, 'role', b.role,
               'client', (select name from public.clients where id = b.client_id), 'project', (select name from public.projects where id = b.project_id),
               'spots', b.total_spots, 'open', b.total_spots - b.filled) order by b.block_date, b.start_time), '[]'::jsonb)
             from b where b.filled < b.total_spots)
  ) into res;
  return res;
end $$;

-- ---------- ACTIVITY ----------
create or replace function public.dash_activity(p_client uuid default null, p_project uuid default null, p_kind text default null, p_search text default null, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare res jsonb; can_names boolean := public.is_access_owner() or public.has_perm('dashboard.names'); q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not (public.is_access_owner() or public.has_perm('dashboard.activity')) then raise exception 'not allowed'; end if;
  if p_client is null and not (public.is_access_owner() or public.has_perm('dashboard.overview')) then raise exception 'not allowed'; end if;
  with s as (select * from public.dash_schedules(p_client, p_project)),
  ev as (
    select l.id::text id, 'schedule' kind, l.action, l.created_at at_, l.actor_id, l.affected_profile_id person_id,
           coalesce(l.block_label, l.schedule_title) what, s.client_id, s.project_id
      from public.schedule_activity_log l join s on s.schedule_id = l.schedule_id
     where l.created_at > now() - interval '60 days'
    union all
    select 'cert-' || r.id, 'certification', 'passed', r.passed_at, null, r.profile_id, (select name from public.certifications where id = r.certification_id), null, null
      from public.agent_cert_records r where r.status = 'passed' and r.passed_at > now() - interval '60 days' and p_client is null and p_project is null
       and public.dash_person_visible(r.profile_id)),
  named as (
    select ev.*, (select name from public.clients where id = ev.client_id) client, (select name from public.projects where id = ev.project_id) project,
      case when ev.person_id is null then null when can_names and (public.dash_person_visible(ev.person_id) or public.is_access_owner()) then (select full_name from public.profiles where id = ev.person_id) else 'A team member' end person,
      case when ev.actor_id is null then null when can_names and (public.dash_person_visible(ev.actor_id) or public.is_access_owner()) then (select full_name from public.profiles where id = ev.actor_id) else 'Someone' end actor
    from ev where (p_kind is null or ev.kind = p_kind or ev.action = p_kind))
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'action', action, 'at', at_, 'person', person, 'actor', actor, 'what', what, 'client', client, 'project', project) order by at_ desc), '[]'::jsonb)
    into res
  from (select * from named where q is null or concat_ws(' ', action, person, actor, what, client, project) ilike '%' || q || '%' order by at_ desc limit greatest(1, least(p_limit, 500))) z;
  return res;
end $$;
grant execute on function public.dash_operations(uuid, uuid, date, int), public.dash_staffing(uuid, uuid), public.dash_schedule(uuid, uuid, date, int), public.dash_activity(uuid, uuid, text, text, int) to authenticated;
