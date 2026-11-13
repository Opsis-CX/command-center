-- ============================================================
-- CHAT SUPPORT LINES (staging 2026-11-12). Run after 27.
-- Agents don't DM individuals. Each agent gets one conversation per support line (one per client/project)
-- that looks and works like a DM; everyone who supports that project is in it and can answer.
--   Support for a line = people whose role has "Answer agent support chats" for that client/project
--                        + members of the team(s) assigned to the line.
--   An internal person messaging an agent opens that agent's support conversation (the team sees it too).
-- Members are kept in sync automatically (on open, when a line changes, and every 10 minutes).
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level)
select k, 'chat', module_label, module_group, 'special', l, sc, so, ml from public.perm_catalog, (values
  ('chat.support', 'Answer agent support chats (for their clients/projects)', true, 411, 'manager'),
  ('chat.support_manage', 'Set up chat support lines', false, 412, 'administrator')) v(k, l, sc, so, ml)
where key = 'chat.view'
on conflict (key) do update set label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key) select r.id, k from public.access_roles r, unnest(array['chat.support', 'chat.support_manage']) k where r.is_starter and r.sort = 2 on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key) select r.id, 'chat.support' from public.access_roles r where r.is_starter and r.sort = 3 on conflict do nothing;

create table if not exists public.chat_support_lines (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  team_tag_ids uuid[] not null default '{}',
  active boolean not null default true, sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (client_id is not null or project_id is not null));
alter table public.chat_support_lines enable row level security;
drop policy if exists chat_support_lines_read on public.chat_support_lines;
create policy chat_support_lines_read on public.chat_support_lines for select to authenticated using (true);
drop policy if exists chat_support_lines_write on public.chat_support_lines;
create policy chat_support_lines_write on public.chat_support_lines for all to authenticated
  using (public.is_access_owner() or public.has_perm('chat.support_manage')) with check (public.is_access_owner() or public.has_perm('chat.support_manage'));

alter table public.channels add column if not exists support_line_id uuid references public.chat_support_lines(id) on delete set null;
alter table public.channels add column if not exists support_agent_id uuid references public.profiles(id) on delete cascade;
create unique index if not exists channels_support_one_per_agent on public.channels (support_line_id, support_agent_id) where support_line_id is not null;
alter table public.channel_members add column if not exists via_support boolean not null default false;

-- does this person work on this client / project? (schedules, tasks, or a role scoped to it)
create or replace function public.chat_works_on(p_profile uuid, p_client uuid, p_project uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.schedule_audience sa join public.schedules s on s.id = sa.schedule_id
                  where sa.profile_id = p_profile and ((p_client is not null and s.client_id = p_client) or (p_project is not null and s.project_id = p_project)))
      or exists (select 1 from public.task_assignees ta join public.tasks t on t.id = ta.task_id
                  where ta.profile_id = p_profile and t.deleted_at is null and ((p_client is not null and t.client_id = p_client) or (p_project is not null and t.project_id = p_project)))
      or exists (select 1 from public.access_assignments a where a.profile_id = p_profile
                  and ((p_client is not null and p_client = any (coalesce(a.client_ids, '{}'))) or (p_project is not null and p_project = any (coalesce(a.project_ids, '{}')))))
$$;

-- who supports a line: role permission for that client/project (or company-wide) + the line's teams
create or replace function public.chat_line_supporters(p_line uuid) returns setof uuid language sql stable security definer set search_path to 'public' as $$
  with l as (select * from public.chat_support_lines where id = p_line and active)
  select distinct p.id from public.profiles p, l
  where p.is_active and p.client_id is null and not public.dash_is_agent(p.id) and (
    exists (select 1 from public.access_assignments a join public.access_roles r on r.id = a.role_id and r.archived_at is null
              join public.access_role_permissions rp on rp.role_id = r.id and rp.perm_key = 'chat.support'
             where a.profile_id = p.id
               and public.level_rank(public.level_of(p.id)) >= public.level_rank((select min_level from public.perm_catalog where key = 'chat.support'))
               and (a.scope_type = 'all' or (l.client_id is not null and l.client_id = any (coalesce(a.client_ids, '{}'))) or (l.project_id is not null and l.project_id = any (coalesce(a.project_ids, '{}')))))
    or exists (select 1 from public.taggables g where g.entity_type = 'profile' and g.entity_id = p.id and g.tag_id = any (l.team_tag_ids)))
$$;

-- keep one conversation's members right: the agent + current supporters (+ anyone who joined it directly)
create or replace function public.chat_support_sync(p_channel uuid) returns void language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select * into c from public.channels where id = p_channel and support_line_id is not null;
  if c.id is null then return; end if;
  insert into public.channel_members (channel_id, profile_id, via_support)
  select c.id, c.support_agent_id, false where not exists (select 1 from public.channel_members m where m.channel_id = c.id and m.profile_id = c.support_agent_id);
  insert into public.channel_members (channel_id, profile_id, via_support)
  select c.id, s, true from public.chat_line_supporters(c.support_line_id) s
  where not exists (select 1 from public.channel_members m where m.channel_id = c.id and m.profile_id = s);
  delete from public.channel_members m where m.channel_id = c.id and m.via_support
    and m.profile_id not in (select public.chat_line_supporters(c.support_line_id));
end $$;
create or replace function public.chat_support_sync_all() returns int language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in select id from public.channels where support_line_id is not null loop perform public.chat_support_sync(r.id); n := n + 1; end loop;
  return n;
end $$;
create or replace function public.chat_support_line_changed() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin perform public.chat_support_sync_all(); return null; end $$;
drop trigger if exists trg_chat_support_line_changed on public.chat_support_lines;
create trigger trg_chat_support_line_changed after insert or update or delete on public.chat_support_lines for each statement execute function public.chat_support_line_changed();
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'chat-support-sync';
    perform cron.schedule('chat-support-sync', '*/10 * * * *', 'select public.chat_support_sync_all()');
  end if;
end $$;

-- which support lines can this agent use? (and does the caller support each one)
create or replace function public.chat_support_options(p_agent uuid default null) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'i_support', auth.uid() in (select public.chat_line_supporters(l.id)),
           'channel_id', (select c.id from public.channels c where c.support_line_id = l.id and c.support_agent_id = coalesce(p_agent, auth.uid())))
         order by l.sort_order, l.name), '[]'::jsonb)
  from public.chat_support_lines l
  where l.active and public.dash_is_agent(coalesce(p_agent, auth.uid())) and public.chat_works_on(coalesce(p_agent, auth.uid()), l.client_id, l.project_id)
$$;

-- open (or create) an agent's conversation on a line
create or replace function public.chat_support_open(p_line uuid, p_agent uuid default null) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_agent uuid := coalesce(p_agent, auth.uid()); l record; v_ch uuid; v_support boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  select * into l from public.chat_support_lines where id = p_line and active;
  if l.id is null then raise exception 'That support line isn''t available.'; end if;
  if not public.dash_is_agent(v_agent) or not public.chat_works_on(v_agent, l.client_id, l.project_id) then raise exception 'That agent isn''t on this support line.'; end if;
  v_support := auth.uid() in (select public.chat_line_supporters(l.id));
  if auth.uid() <> v_agent and not v_support and not (public.chat_can('chat.dm_create') and not public.dash_is_agent(auth.uid())) then
    raise exception 'You don''t have permission to message this agent.'; end if;
  select id into v_ch from public.channels where support_line_id = l.id and support_agent_id = v_agent;
  if v_ch is null then
    insert into public.channels (name, is_dm, created_by, support_line_id, support_agent_id) values (l.name, true, auth.uid(), l.id, v_agent) returning id into v_ch;
  end if;
  perform public.chat_support_sync(v_ch);
  -- an internal person who isn't on the support team joins this conversation (it stays visible to the team)
  if auth.uid() <> v_agent and not v_support then
    insert into public.channel_members (channel_id, profile_id, via_support) values (v_ch, auth.uid(), false) on conflict do nothing;
  end if;
  update public.channel_members set hidden_at = null where channel_id = v_ch and profile_id = auth.uid();
  return v_ch;
end $$;
grant execute on function public.chat_support_options(uuid), public.chat_support_open(uuid, uuid) to authenticated;

-- agents can't have private 1-on-1 / group DMs (new roles system); messages with agents go through support lines
create or replace function public.chat_guard_group_dm() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare n int; c record;
begin
  select * into c from public.channels where id = new.channel_id;
  if auth.uid() is null or not coalesce(c.is_dm, false) or c.support_line_id is not null then return null; end if;
  n := (select count(*) from public.channel_members where channel_id = new.channel_id);
  if exists (select 1 from public.access_assignments x where x.profile_id = auth.uid()) and not public.is_access_owner()
     and exists (select 1 from public.channel_members m where m.channel_id = new.channel_id and public.dash_is_agent(m.profile_id)) then
    raise exception 'Messages with agents go through their project''s support line, so the support team can see them.'; end if;
  if n > 2 and not public.chat_can('chat.group_dm_create') then
    raise exception 'You don''t have permission to start group messages (3 or more people).'; end if;
  if n = 2 and not public.chat_can('chat.dm_create') then
    raise exception 'You don''t have permission to start 1-on-1 direct messages.'; end if;
  return null;
end $$;
-- the conversation is the support line's, not one person's: only line managers delete it for everyone
create or replace function public.chat_support_powers() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('manage', public.is_access_owner() or public.has_perm('chat.support_manage'), 'agent', public.dash_is_agent(auth.uid()))
$$;
grant execute on function public.chat_support_powers() to authenticated;

-- who's on a line (for the setup page; line managers only)
create or replace function public.chat_support_preview(p_line uuid) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare l record;
begin
  if not (public.is_access_owner() or public.has_perm('chat.support_manage')) then raise exception 'not allowed'; end if;
  select * into l from public.chat_support_lines where id = p_line;
  return jsonb_build_object(
    'supporters', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name,
        'via', case when exists (select 1 from public.taggables g where g.entity_type = 'profile' and g.entity_id = p.id and g.tag_id = any (l.team_tag_ids)) then 'team' else 'role' end) order by p.full_name)
      from public.chat_line_supporters(p_line) s join public.profiles p on p.id = s), '[]'::jsonb),
    'agents', (select count(*) from public.profiles p where p.is_active and public.dash_is_agent(p.id) and public.chat_works_on(p.id, l.client_id, l.project_id)),
    'conversations', (select count(*) from public.channels c where c.support_line_id = p_line));
end $$;
grant execute on function public.chat_support_preview(uuid) to authenticated;
