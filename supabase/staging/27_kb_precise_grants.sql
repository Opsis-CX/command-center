-- ============================================================
-- KNOWLEDGE BASE: precise, easy grants (staging 2026-11-12). Run after 26.
--  1. Old "Job role: …" entries (carried over from the old system) apply ONLY to people who don't have a
--     role yet (live today). Anyone with a role is governed by roles + Manage access.
--  2. On client/project content, broad entries (Everyone, a Role, a Team) only count for people working on
--     that client/project (or with "See every client's and project's resources"). Naming a specific Person
--     — or the client's/project's people — is a deliberate exception and always counts.
-- ============================================================
-- the client / project a folder belongs to (nearest one up the chain; a project's client counts)
create or replace function public.kb_folder_scope(p_folder uuid, out client_id uuid, out project_id uuid)
language sql stable security definer set search_path to 'public' as $$
  with recursive up as (select f.id, f.parent_id, f.client_id, f.project_id, 0 d from public.kb_folders f where f.id = p_folder
                        union all select f.id, f.parent_id, f.client_id, f.project_id, up.d + 1 from public.kb_folders f join up on f.id = up.parent_id where up.d < 60),
       pick as (select (select u.project_id from up u where u.project_id is not null order by d limit 1) pr,
                       (select u.client_id from up u where u.client_id is not null order by d limit 1) cl)
  select coalesce(cl, (select p.client_id from public.projects p where p.id = pr)), pr from pick
$$;

create or replace function public.kb_can(p_action text, p_type text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_folder uuid; v_section uuid; v_client uuid; v_project uuid; v_restricted boolean := false; v_in boolean;
  r record; f record; hops int := 0; v_status text; v_author uuid;
begin
  if auth.uid() is null then return false; end if;
  if public.is_access_owner() then return true; end if;
  -- people without roles (live today): today's rules
  if not exists (select 1 from public.access_assignments x where x.profile_id = auth.uid()) then
    if public.kb_is_author() then return true; end if;
    if p_action not in ('view', 'download') then return false; end if;
    return case p_type when 'folder' then public.kb_can_read_folder(p_id)
                       when 'article' then exists (select 1 from public.kb_articles a where a.id = p_id and public.kb_can_read_article(a))
                       when 'file' then exists (select 1 from public.kb_files x where x.id = p_id and public.kb_can_read_file(x))
                       when 'section' then true else false end;
  end if;
  if public.has_perm('kb.manage', '00000000-0000-0000-0000-000000000000'::uuid) then return true; end if;

  -- 1) what is it, and where does it live?
  if p_type = 'article' then
    select a.folder_id, a.restricted, a.status, a.author_id into v_folder, v_restricted, v_status, v_author from public.kb_articles a where a.id = p_id;
    if not found then return false; end if;
    if v_status <> 'published' and p_action = 'view' and v_author is distinct from auth.uid() then return public.kb_can('edit', 'article', p_id); end if;
  elsif p_type = 'file' then
    select coalesce(x.folder_id, (select a.folder_id from public.kb_articles a where a.id = x.article_id)), x.restricted into v_folder, v_restricted from public.kb_files x where x.id = p_id;
    if not found then return false; end if;
    if not v_restricted and exists (select 1 from public.kb_files x where x.id = p_id and x.article_id is not null)
       and not exists (select 1 from public.kb_grants g where g.object_type = 'file' and g.object_id = p_id) then
      return public.kb_can(p_action, 'article', (select article_id from public.kb_files where id = p_id));
    end if;
  elsif p_type = 'folder' then v_folder := p_id;
  elsif p_type = 'section' then v_section := p_id;
  end if;

  -- 2) its client / project, and is this person working on it?
  if v_folder is not null then select s.client_id, s.project_id into v_client, v_project from public.kb_folder_scope(v_folder) s; end if;
  v_in := (v_client is null and v_project is null)
       or public.has_perm('kb.all_clients', '00000000-0000-0000-0000-000000000000'::uuid)
       or public.kb_works_on(v_client, v_project);

  -- 3) entries on the item itself
  if p_type in ('article', 'file') then
    for r in select g.principal_type, g.principal_id, g.actions from public.kb_grants g where g.object_type = p_type and g.object_id = p_id loop
      if p_action = any (r.actions) and r.principal_type <> 'legacy_role' and (v_in or r.principal_type in ('person', 'client', 'project'))
         and public.kb_principal_match(r.principal_type, r.principal_id) then return true; end if;
    end loop;
    if v_restricted then return false; end if;
  end if;
  -- 4) up the folders (inheritance stops at a restricted folder)
  while v_folder is not null and hops < 60 loop
    select * into f from public.kb_folders where id = v_folder;
    exit when not found;
    v_section := f.section_id;
    for r in select g.principal_type, g.principal_id, g.actions from public.kb_grants g where g.object_type = 'folder' and g.object_id = f.id loop
      if p_action = any (r.actions) and r.principal_type <> 'legacy_role' and (v_in or r.principal_type in ('person', 'client', 'project'))
         and public.kb_principal_match(r.principal_type, r.principal_id) then return true; end if;
    end loop;
    if f.restricted then return false; end if;
    v_folder := f.parent_id; hops := hops + 1;
  end loop;
  -- 5) the section
  if v_section is not null then
    for r in select g.principal_type, g.principal_id, g.actions from public.kb_grants g where g.object_type = 'section' and g.object_id = v_section loop
      if p_action = any (r.actions) and r.principal_type <> 'legacy_role' and (v_in or r.principal_type in ('person', 'client', 'project'))
         and public.kb_principal_match(r.principal_type, r.principal_id) then return true; end if;
    end loop;
    if (select restricted from public.kb_sections where id = v_section) then return false; end if;
  end if;
  -- 6) unrestricted all the way up: the Access & Permissions baseline (client/project content: only if working on it)
  if not v_in then return false; end if;
  return public.kb_baseline(case p_action when 'manage_permissions' then 'kb.permissions' else 'kb.' || p_action end, v_client, v_project);
end $$;

-- fix: editing a folder (rename, client, restricted) failed because the move check read article/file columns
create or replace function public.kb_guard_move() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_old_f uuid; v_new_f uuid; v_type text;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'kb_folders' then
    v_type := 'folder';
    if new.parent_id is distinct from old.parent_id or new.section_id is distinct from old.section_id then
      if not public.kb_can('move', 'folder', old.id) then raise exception 'You don''t have permission to move this folder.'; end if;
      if new.parent_id is not null then
        if not public.kb_can('create', 'folder', new.parent_id) then raise exception 'You can''t add folders where you''re moving it.'; end if;
        if exists (with recursive d as (select id from public.kb_folders where id = old.id union all select f.id from public.kb_folders f join d on f.parent_id = d.id) select 1 from d where id = new.parent_id) then
          raise exception 'A folder can''t be moved inside itself.'; end if;
      elsif not public.kb_can('create', 'section', new.section_id) then raise exception 'You can''t add folders to that section.'; end if;
    end if;
  elsif tg_table_name = 'kb_articles' then
    v_type := 'article'; v_old_f := old.folder_id; v_new_f := new.folder_id;
    if v_new_f is distinct from v_old_f then
      if not public.kb_can('move', 'article', old.id) then raise exception 'You don''t have permission to move this article.'; end if;
      if not public.kb_can('create', 'folder', v_new_f) then raise exception 'You can''t add articles where you''re moving it.'; end if;
    end if;
  else
    v_type := 'file'; v_old_f := old.folder_id; v_new_f := new.folder_id;
    if v_new_f is distinct from v_old_f then
      if not public.kb_can('move', 'file', old.id) then raise exception 'You don''t have permission to move this file.'; end if;
      if v_new_f is not null and not public.kb_can('upload', 'folder', v_new_f) then raise exception 'You can''t upload where you''re moving it.'; end if;
    end if;
  end if;
  if new.restricted is distinct from old.restricted and not public.kb_can('manage_permissions', v_type, old.id) then
    raise exception 'You don''t have permission to change who can access this.'; end if;
  return new;
end $$;
