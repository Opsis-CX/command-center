-- ============================================================
-- CHAT & CHANNEL PERMISSIONS (staging 2026-11-10). Run after 23.
-- Separate checkboxes for each Chat power, enforced by the database:
--   Create channels · Start direct messages · Start group messages (3+ people) ·
--   Add people to channels · Remove people from channels · Permanently delete channels ·
--   Permanently delete direct messages · Delete other people's messages · Pin messages · Use @here
-- People on the new roles system get exactly their checkboxes. People without roles (live today)
-- keep today's behavior through chat_can()'s fallback, so nothing breaks before roles roll out.
-- Also closes holes: anyone allowed to make DMs could add anyone to any channel; anyone could add
-- themselves to a channel; admins could permanently delete channels.
-- ============================================================
update public.perm_catalog set label = 'Create channels', action = 'special', sort = 401, min_level = 'user' where key = 'chat.create';
update public.perm_catalog set label = 'Use Chat', sort = 400 where key = 'chat.view';
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('chat.dm_create',        'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Start direct messages (1-on-1)', false, 402, 'user'),
 ('chat.group_dm_create',  'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Start group messages (3+ people)', false, 403, 'user'),
 ('chat.members_add',      'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Add people to channels', false, 404, 'user'),
 ('chat.members_remove',   'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Remove people from channels', false, 405, 'manager'),
 ('chat.channel_delete',   'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Permanently delete channels', false, 406, 'manager'),
 ('chat.dm_delete',        'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Permanently delete direct messages (for everyone)', false, 407, 'manager'),
 ('chat.moderate',         'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Delete other people''s messages', false, 408, 'manager'),
 ('chat.pin',              'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Pin messages', false, 409, 'user'),
 ('chat.here',             'chat', (select module_label from public.perm_catalog where key = 'chat.view'), (select module_group from public.perm_catalog where key = 'chat.view'), 'special', 'Use @here (notify everyone in a channel)', false, 410, 'user')
on conflict (key) do update set label = excluded.label, action = excluded.action, sort = excluded.sort, min_level = excluded.min_level;
update public.perm_catalog set action = 'special' where key in ('chat.view');

-- starter roles: Administrator everything · Manager day-to-day · User: DMs, group messages, @here
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['chat.create','chat.dm_create','chat.group_dm_create','chat.members_add','chat.members_remove','chat.channel_delete','chat.dm_delete','chat.moderate','chat.pin','chat.here']) k
 where r.is_starter and r.sort = 2 on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['chat.create','chat.dm_create','chat.group_dm_create','chat.members_add','chat.members_remove','chat.moderate','chat.pin','chat.here']) k
 where r.is_starter and r.sort = 3 on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['chat.dm_create','chat.group_dm_create','chat.here']) k
 where r.is_starter and r.sort = 4 on conflict do nothing;
-- the old catch-all "Moderate and manage channels" becomes the specific checkboxes it covered
insert into public.access_role_permissions (role_id, perm_key)
select rp.role_id, k from public.access_role_permissions rp, unnest(array['chat.members_add','chat.members_remove','chat.channel_delete','chat.dm_delete','chat.moderate','chat.pin']) k
 where rp.perm_key = 'chat.manage' on conflict do nothing;
delete from public.access_role_permissions where perm_key = 'chat.manage';
delete from public.perm_catalog where key = 'chat.manage';

-- one check for every Chat power (new roles system, or today's behavior for people without roles)
create or replace function public.chat_can(p_key text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when public.is_access_owner() then true
    when exists (select 1 from public.access_assignments a where a.profile_id = auth.uid()) then public.has_perm(p_key)
    else case p_key
      when 'chat.create' then public.is_admin_user(auth.uid())
      when 'chat.dm_create' then public.can_create_dms()
      when 'chat.group_dm_create' then public.can_create_dms()
      when 'chat.members_add' then public.is_admin_user(auth.uid())
      when 'chat.members_remove' then public.is_admin_user(auth.uid()) or public.is_owner()
      when 'chat.channel_delete' then public.is_admin_user(auth.uid()) or public.is_owner()
      when 'chat.dm_delete' then public.is_admin_user(auth.uid()) or public.is_owner()
      when 'chat.moderate' then public.can_moderate_messages(auth.uid())
      when 'chat.pin' then public.can_moderate_messages(auth.uid())
      when 'chat.here' then true
      else false end
  end
$$;
grant execute on function public.chat_can(text) to authenticated;

-- ---------- channels ----------
drop policy if exists "Admins manage channels" on public.channels;
drop policy if exists channels_admin_insert on public.channels;
drop policy if exists channels_dm_insert on public.channels;
drop policy if exists channels_delete_owner on public.channels;
drop policy if exists channels_admin_select on public.channels;
create policy channels_admin_select on public.channels for select to authenticated using (public.is_admin_user(auth.uid()));
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated with check (
  created_by = auth.uid() and ((not coalesce(is_dm, false) and public.chat_can('chat.create'))
                            or (coalesce(is_dm, false) and (public.chat_can('chat.dm_create') or public.chat_can('chat.group_dm_create')))));
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated using (
  case when coalesce(is_dm, false) then public.chat_can('chat.dm_delete') and (public.is_channel_member(id) or public.is_access_owner())
       else public.chat_can('chat.channel_delete') end);

-- ---------- members ----------
drop policy if exists "Admins manage members" on public.channel_members;
drop policy if exists channel_members_dm_insert on public.channel_members;
drop policy if exists members_insert on public.channel_members;
drop policy if exists channel_members_delete_owner on public.channel_members;
drop policy if exists members_admin_select on public.channel_members;
create policy members_admin_select on public.channel_members for select to authenticated using (public.is_admin_user(auth.uid()));
drop policy if exists members_insert_v2 on public.channel_members;
create policy members_insert_v2 on public.channel_members for insert to authenticated with check (
  -- setting up a conversation you just created (initial members)
  exists (select 1 from public.channels c where c.id = channel_id and c.created_by = auth.uid() and c.created_at > now() - interval '10 minutes')
  -- adding people to an existing channel (not DMs)
  or (public.chat_can('chat.members_add') and exists (select 1 from public.channels c where c.id = channel_id and not coalesce(c.is_dm, false))
      and (public.is_channel_member(channel_id) or public.is_admin_user(auth.uid()) or public.is_access_owner())));
drop policy if exists members_delete_v2 on public.channel_members;
create policy members_delete_v2 on public.channel_members for delete to authenticated using (
  profile_id = auth.uid()     -- leaving
  or (public.chat_can('chat.members_remove') and exists (select 1 from public.channels c where c.id = channel_id and not coalesce(c.is_dm, false))
      and (public.is_channel_member(channel_id) or public.is_admin_user(auth.uid()) or public.is_access_owner())));

-- a DM with 3+ people needs "Start group messages"; a 1-on-1 needs "Start direct messages" (checked once all members are in)
create or replace function public.chat_guard_group_dm() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if auth.uid() is null or not coalesce((select is_dm from public.channels where id = new.channel_id), false) then return null; end if;
  n := (select count(*) from public.channel_members where channel_id = new.channel_id);
  if n > 2 and not public.chat_can('chat.group_dm_create') then
    raise exception 'You don''t have permission to start group messages (3 or more people).'; end if;
  if n = 2 and not public.chat_can('chat.dm_create') then
    raise exception 'You don''t have permission to start 1-on-1 direct messages.'; end if;
  return null;
end $$;
drop trigger if exists trg_chat_guard_group_dm on public.channel_members;
create trigger trg_chat_guard_group_dm after insert on public.channel_members for each row execute function public.chat_guard_group_dm();

-- ---------- messages ----------
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and public.is_channel_member(channel_id) and (not coalesce(is_here, false) or public.chat_can('chat.here')));
drop policy if exists "delete own or moderate" on public.messages;
drop policy if exists messages_moderate on public.messages;
create policy messages_moderate on public.messages for update to authenticated
  using (sender_id = auth.uid() or ((public.chat_can('chat.moderate') or public.chat_can('chat.pin')) and (public.is_channel_member(channel_id) or public.is_admin_user(auth.uid()))))
  with check (sender_id = auth.uid() or ((public.chat_can('chat.moderate') or public.chat_can('chat.pin')) and (public.is_channel_member(channel_id) or public.is_admin_user(auth.uid()))));
-- what each power may change: pin needs "Pin messages"; deleting someone else's needs "Delete other people's messages";
-- nobody edits another person's words
create or replace function public.chat_guard_message_update() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.pinned_at is distinct from old.pinned_at) and not public.chat_can('chat.pin') then
    raise exception 'You don''t have permission to pin messages.'; end if;
  if old.sender_id <> auth.uid() then
    if new.body is distinct from old.body then raise exception 'You can only edit your own messages.'; end if;
    if (new.deleted_at is distinct from old.deleted_at) and not public.chat_can('chat.moderate') then
      raise exception 'You don''t have permission to delete other people''s messages.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_chat_guard_message_update on public.messages;
create trigger trg_chat_guard_message_update before update on public.messages for each row execute function public.chat_guard_message_update();

-- the Chat screen asks what this person may do
create or replace function public.chat_powers() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('create', public.chat_can('chat.create'), 'dm', public.chat_can('chat.dm_create'), 'group_dm', public.chat_can('chat.group_dm_create'),
    'add', public.chat_can('chat.members_add'), 'remove', public.chat_can('chat.members_remove'), 'delete_channel', public.chat_can('chat.channel_delete'),
    'delete_dm', public.chat_can('chat.dm_delete'), 'moderate', public.chat_can('chat.moderate'), 'pin', public.chat_can('chat.pin'), 'here', public.chat_can('chat.here'))
$$;
grant execute on function public.chat_powers() to authenticated;
