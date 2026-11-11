-- ============================================================
-- KNOWLEDGE BASE v2 — FOUNDATION (staging 2026-11-11). Run after 24.
-- Sections (unlimited, renamable, reorderable) → folders (unlimited nesting, optional client/project)
-- → resources (articles, files, recordings). Permissions: view · create · upload · edit · move ·
-- download · delete · restore · manage_permissions, granted to everyone / roles / teams / people /
-- a client's or project's people, on a section, folder or single resource. Content inherits its
-- parent's permissions unless it is "restricted" (then only its own list applies, inherited downward).
-- The Access & Permissions baseline (kb.* checkboxes, scopeable to clients/projects) applies to
-- unrestricted content. Everything is enforced here, in the database.
-- Existing content is preserved: old per-folder audiences become restricted folders with the same
-- audience; people without roles (live today) keep today's behavior through the legacy fallback.
-- ============================================================

-- ---------- permission checkboxes (Access & Permissions → Knowledge Base) ----------
update public.perm_catalog set label = 'View the Knowledge Base', action = 'special', scopeable = true, sort = 500, min_level = 'user' where key = 'kb.view';
update public.perm_catalog set label = 'Edit articles and folders', action = 'special', scopeable = true, sort = 503, min_level = 'user' where key = 'kb.edit';
update public.perm_catalog set label = 'Full control of the Knowledge Base (sees and does everything)', action = 'special', scopeable = false, sort = 512, min_level = 'administrator' where key = 'kb.manage';
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level)
select k, 'kb', (select module_label from public.perm_catalog where key = 'kb.view'), (select module_group from public.perm_catalog where key = 'kb.view'), 'special', l, sc, so, ml
from (values ('kb.create', 'Create folders and articles', true, 501, 'user'), ('kb.upload', 'Upload files and recordings', true, 502, 'user'),
             ('kb.move', 'Move folders and resources', true, 504, 'user'), ('kb.download', 'Download files', true, 505, 'user'),
             ('kb.delete', 'Delete (to trash)', true, 506, 'manager'), ('kb.restore', 'Restore from trash', true, 507, 'manager'),
             ('kb.permissions', 'Manage permissions on sections, folders and resources', true, 508, 'manager'),
             ('kb.sections', 'Create, rename and reorder sections', false, 509, 'administrator'),
             ('kb.templates', 'Create and manage article templates', false, 510, 'manager')) v(k, l, sc, so, ml)
on conflict (key) do update set label = excluded.label, action = excluded.action, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['kb.view','kb.create','kb.upload','kb.edit','kb.move','kb.download','kb.delete','kb.restore','kb.permissions','kb.sections','kb.templates','kb.manage']) k where r.is_starter and r.sort = 2 on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['kb.view','kb.create','kb.upload','kb.edit','kb.move','kb.download','kb.templates']) k where r.is_starter and r.sort = 3 on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['kb.view','kb.download']) k where r.is_starter and r.sort = 4 on conflict do nothing;

-- ---------- structure ----------
create table if not exists public.kb_sections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text, icon text not null default '📚', color text,
  sort_order int not null default 0, restricted boolean not null default false,
  archived_at timestamptz, created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.kb_folders add column if not exists section_id uuid references public.kb_sections(id) on delete restrict;
alter table public.kb_folders add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.kb_folders add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.kb_folders add column if not exists restricted boolean not null default false;
alter table public.kb_articles add column if not exists restricted boolean not null default false;
alter table public.kb_articles add column if not exists template_id uuid;
alter table public.kb_files add column if not exists restricted boolean not null default false;
alter table public.kb_files add column if not exists kind text not null default 'file' check (kind in ('file', 'recording'));
update public.kb_files set kind = 'recording' where kind = 'file' and (mime_type like 'audio/%' or mime_type like 'video/%');

create table if not exists public.kb_grants (
  id uuid primary key default gen_random_uuid(),
  object_type text not null check (object_type in ('section', 'folder', 'article', 'file')),
  object_id uuid not null,
  principal_type text not null check (principal_type in ('everyone', 'role', 'team', 'person', 'client', 'project', 'legacy_role')),
  principal_id text not null default '',
  actions text[] not null check (actions <@ array['view','create','upload','edit','move','download','delete','restore','manage_permissions']::text[]),
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  unique (object_type, object_id, principal_type, principal_id));
create index if not exists kb_grants_object on public.kb_grants (object_type, object_id);

create table if not exists public.kb_favorites (profile_id uuid not null references public.profiles(id) on delete cascade,
  object_type text not null check (object_type in ('section', 'folder', 'article', 'file')), object_id uuid not null,
  created_at timestamptz not null default now(), primary key (profile_id, object_type, object_id));
create table if not exists public.kb_follows (profile_id uuid not null references public.profiles(id) on delete cascade,
  object_type text not null check (object_type in ('section', 'folder', 'article', 'file')), object_id uuid not null,
  created_at timestamptz not null default now(), primary key (profile_id, object_type, object_id));
create table if not exists public.kb_templates (
  id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 1 and 80),
  description text, icon text not null default '📝', body text not null default '',
  section_id uuid references public.kb_sections(id) on delete set null,
  is_starter boolean not null default false, sort_order int not null default 0, archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- a folder's section follows its parent (sub-folders always live in their parent's section)
create or replace function public.kb_folder_section_sync() returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then new.section_id := (select section_id from public.kb_folders where id = new.parent_id);
  elsif new.section_id is null then new.section_id := (select id from public.kb_sections where archived_at is null order by sort_order, created_at limit 1); end if;
  return new;
end $$;
drop trigger if exists trg_kb_folder_section_sync on public.kb_folders;
create trigger trg_kb_folder_section_sync before insert or update of parent_id, section_id on public.kb_folders for each row execute function public.kb_folder_section_sync();
create or replace function public.kb_folder_section_cascade() returns trigger language plpgsql as $$
begin
  if new.section_id is distinct from old.section_id then
    update public.kb_folders set section_id = new.section_id where parent_id = new.id and section_id is distinct from new.section_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_kb_folder_section_cascade on public.kb_folders;
create trigger trg_kb_folder_section_cascade after update of section_id on public.kb_folders for each row execute function public.kb_folder_section_cascade();

-- ---------- who am I matched against? ----------
create or replace function public.kb_principal_match(p_type text, p_id text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select case p_type
    when 'everyone' then auth.uid() is not null
    when 'person' then p_id = auth.uid()::text
    when 'role' then exists (select 1 from public.access_assignments a where a.profile_id = auth.uid() and a.role_id::text = p_id)
    when 'team' then exists (select 1 from public.taggables g where g.entity_type = 'profile' and g.entity_id = auth.uid() and g.tag_id::text = p_id)
    when 'legacy_role' then lower(p_id) = any (public.kb_my_roles())
    -- a client's / project's people = those who work on it (on its schedules, or assigned its tasks)
    when 'client' then exists (select 1 from public.schedule_audience sa join public.schedules s on s.id = sa.schedule_id where sa.profile_id = auth.uid() and s.client_id::text = p_id)
                     or exists (select 1 from public.task_assignees ta join public.tasks t on t.id = ta.task_id where ta.profile_id = auth.uid() and t.client_id::text = p_id and t.deleted_at is null)
    when 'project' then exists (select 1 from public.schedule_audience sa join public.schedules s on s.id = sa.schedule_id where sa.profile_id = auth.uid() and s.project_id::text = p_id)
                     or exists (select 1 from public.task_assignees ta join public.tasks t on t.id = ta.task_id where ta.profile_id = auth.uid() and t.project_id::text = p_id and t.deleted_at is null)
    else false end
$$;

-- an Access & Permissions checkbox for this content (scoped to its client/project; unscoped content
-- needs a company-wide grant, so a one-client role can't act on company-wide content)
create or replace function public.kb_baseline(p_key text, p_client uuid, p_project uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select case when p_project is not null or p_client is not null
              then (p_project is not null and public.has_perm(p_key, p_project)) or (p_client is not null and public.has_perm(p_key, p_client))
              -- company-wide content: anyone with the checkbox can read it; changing it needs a company-wide grant
              when p_key in ('kb.view', 'kb.download') then public.has_perm(p_key)
              else public.has_perm(p_key, '00000000-0000-0000-0000-000000000000'::uuid) end
$$;

-- ---------- the one permission check everything uses ----------
create or replace function public.kb_can(p_action text, p_type text, p_id uuid) returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_folder uuid; v_section uuid; v_client uuid; v_project uuid; v_restricted boolean := false; v_hit boolean := false;
  r record; f record; hops int := 0; a_rec record; fi_rec record; v_status text; v_author uuid;
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

  -- 1) the object itself
  if p_type = 'article' then
    select a.folder_id, a.restricted, a.status, a.author_id into v_folder, v_restricted, v_status, v_author from public.kb_articles a where a.id = p_id;
    if not found then return false; end if;
    -- drafts: only people who can edit (or the author) see them
    if v_status <> 'published' and p_action = 'view' and v_author is distinct from auth.uid() then return public.kb_can('edit', 'article', p_id); end if;
  elsif p_type = 'file' then
    select coalesce(x.folder_id, (select a.folder_id from public.kb_articles a where a.id = x.article_id)), x.restricted into v_folder, v_restricted from public.kb_files x where x.id = p_id;
    if not found then return false; end if;
    -- a file inside an article follows that article, unless the file has its own list
    if not v_restricted and exists (select 1 from public.kb_files x where x.id = p_id and x.article_id is not null)
       and not exists (select 1 from public.kb_grants g where g.object_type = 'file' and g.object_id = p_id) then
      return public.kb_can(p_action, 'article', (select article_id from public.kb_files where id = p_id));
    end if;
  elsif p_type = 'folder' then
    v_folder := p_id;
  elsif p_type = 'section' then
    v_section := p_id;
  end if;
  if p_type in ('article', 'file') then
    for r in select g.principal_type, g.principal_id, g.actions from public.kb_grants g where g.object_type = p_type and g.object_id = p_id loop
      if p_action = any (r.actions) and public.kb_principal_match(r.principal_type, r.principal_id) then v_hit := true; end if;
    end loop;
    if v_hit then return true; end if;
    if v_restricted then return false; end if;
  end if;

  -- 2) up the folder chain (and pick up client/project + section on the way)
  while v_folder is not null and hops < 60 loop
    select * into f from public.kb_folders where id = v_folder;
    exit when not found;
    v_client := coalesce(v_client, f.client_id); v_project := coalesce(v_project, f.project_id); v_section := f.section_id;
    for r in select g.principal_type, g.principal_id, g.actions from public.kb_grants g where g.object_type = 'folder' and g.object_id = f.id loop
      if p_action = any (r.actions) and public.kb_principal_match(r.principal_type, r.principal_id) then return true; end if;
    end loop;
    if f.restricted then return false; end if;      -- inheritance stops at a restricted folder
    v_folder := f.parent_id; hops := hops + 1;
  end loop;

  -- 3) the section
  if v_section is not null then
    for r in select g.principal_type, g.principal_id, g.actions from public.kb_grants g where g.object_type = 'section' and g.object_id = v_section loop
      if p_action = any (r.actions) and public.kb_principal_match(r.principal_type, r.principal_id) then return true; end if;
    end loop;
    if (select restricted from public.kb_sections where id = v_section) then return false; end if;
  end if;

  -- 4) unrestricted all the way up: the Access & Permissions baseline
  return public.kb_baseline(case p_action when 'manage_permissions' then 'kb.permissions' else 'kb.' || p_action end, v_client, v_project);
end $$;
grant execute on function public.kb_can(text, text, uuid) to authenticated;

-- what may I do here? (for menus — the server still checks every action)
create or replace function public.kb_powers(p_type text, p_id uuid) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_object_agg(a, public.kb_can(a, p_type, p_id)) from unnest(array['view','create','upload','edit','move','download','delete','restore','manage_permissions']) a
$$;
grant execute on function public.kb_powers(text, uuid) to authenticated;
create or replace function public.kb_admin_powers() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'sections', public.is_access_owner() or public.has_perm('kb.manage', '00000000-0000-0000-0000-000000000000'::uuid) or public.has_perm('kb.sections', '00000000-0000-0000-0000-000000000000'::uuid)
                or (not exists (select 1 from public.access_assignments x where x.profile_id = auth.uid()) and public.kb_is_author()),
    'templates', public.is_access_owner() or public.has_perm('kb.manage', '00000000-0000-0000-0000-000000000000'::uuid) or public.has_perm('kb.templates')
                or (not exists (select 1 from public.access_assignments x where x.profile_id = auth.uid()) and public.kb_is_author()),
    'restore', public.is_access_owner() or public.has_perm('kb.manage', '00000000-0000-0000-0000-000000000000'::uuid) or public.has_perm('kb.restore')
                or (not exists (select 1 from public.access_assignments x where x.profile_id = auth.uid()) and public.kb_is_author()))
$$;
grant execute on function public.kb_admin_powers() to authenticated;

-- ---------- row rules: you only ever see what you may view; writes check the matching action ----------
alter table public.kb_sections enable row level security;
alter table public.kb_grants enable row level security;
alter table public.kb_favorites enable row level security;
alter table public.kb_follows enable row level security;
alter table public.kb_templates enable row level security;

drop policy if exists kb_sections_read on public.kb_sections;
create policy kb_sections_read on public.kb_sections for select to authenticated using (archived_at is null and public.kb_can('view', 'section', id) or (public.kb_admin_powers()->>'sections')::boolean);
drop policy if exists kb_sections_write on public.kb_sections;
create policy kb_sections_write on public.kb_sections for all to authenticated using ((public.kb_admin_powers()->>'sections')::boolean) with check ((public.kb_admin_powers()->>'sections')::boolean);

drop policy if exists kb_grants_read on public.kb_grants;
create policy kb_grants_read on public.kb_grants for select to authenticated using (public.kb_can('manage_permissions', object_type, object_id));
drop policy if exists kb_grants_write on public.kb_grants;
create policy kb_grants_write on public.kb_grants for all to authenticated using (public.kb_can('manage_permissions', object_type, object_id)) with check (public.kb_can('manage_permissions', object_type, object_id));

drop policy if exists kb_favorites_own on public.kb_favorites;
create policy kb_favorites_own on public.kb_favorites for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid() and public.kb_can('view', object_type, object_id));
drop policy if exists kb_follows_own on public.kb_follows;
create policy kb_follows_own on public.kb_follows for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid() and public.kb_can('view', object_type, object_id));

drop policy if exists kb_templates_read on public.kb_templates;
create policy kb_templates_read on public.kb_templates for select to authenticated using (archived_at is null or (public.kb_admin_powers()->>'templates')::boolean);
drop policy if exists kb_templates_write on public.kb_templates;
create policy kb_templates_write on public.kb_templates for all to authenticated using ((public.kb_admin_powers()->>'templates')::boolean) with check ((public.kb_admin_powers()->>'templates')::boolean);

-- folders / articles / files: replace the old "editors can do anything" rule with per-action rules
drop policy if exists "kb_folders_read" on public.kb_folders;
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where tablename in ('kb_folders', 'kb_articles', 'kb_files') and policyname not in ('csr_lockout', 'portal_client_deny') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
create policy kb_folders_select on public.kb_folders for select to authenticated using (public.kb_can('view', 'folder', id));
create policy kb_folders_insert on public.kb_folders for insert to authenticated with check (
  case when parent_id is null then public.kb_can('create', 'section', section_id) else public.kb_can('create', 'folder', parent_id) end);
create policy kb_folders_update on public.kb_folders for update to authenticated using (public.kb_can('edit', 'folder', id) or public.kb_can('move', 'folder', id))
  with check (case when parent_id is null then public.kb_can('create', 'section', section_id) or public.kb_can('edit', 'folder', id) else public.kb_can('create', 'folder', parent_id) or public.kb_can('edit', 'folder', id) end);
create policy kb_folders_delete on public.kb_folders for delete to authenticated using (public.kb_can('delete', 'folder', id));

create policy kb_articles_select on public.kb_articles for select to authenticated using (public.kb_can('view', 'article', id));
create policy kb_articles_insert on public.kb_articles for insert to authenticated with check (folder_id is not null and public.kb_can('create', 'folder', folder_id));
create policy kb_articles_update on public.kb_articles for update to authenticated using (public.kb_can('edit', 'article', id) or public.kb_can('move', 'article', id))
  with check (public.kb_can('edit', 'article', id) or public.kb_can('create', 'folder', folder_id));
create policy kb_articles_delete on public.kb_articles for delete to authenticated using (public.kb_can('delete', 'article', id));

create policy kb_files_select on public.kb_files for select to authenticated using (public.kb_can('view', 'file', id));
create policy kb_files_insert on public.kb_files for insert to authenticated with check (
  case when article_id is not null then public.kb_can('edit', 'article', article_id) else folder_id is not null and public.kb_can('upload', 'folder', folder_id) end);
create policy kb_files_update on public.kb_files for update to authenticated using (public.kb_can('edit', 'file', id) or public.kb_can('move', 'file', id))
  with check (public.kb_can('edit', 'file', id) or (folder_id is not null and public.kb_can('upload', 'folder', folder_id)));
create policy kb_files_delete on public.kb_files for delete to authenticated using (public.kb_can('delete', 'file', id));

-- what changed inside a move: moving needs "move" on the item AND "create"/"upload" where it lands
create or replace function public.kb_guard_move() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'kb_folders' and (new.parent_id is distinct from old.parent_id or new.section_id is distinct from old.section_id) then
    if not public.kb_can('move', 'folder', old.id) then raise exception 'You don''t have permission to move this folder.'; end if;
    if new.parent_id is not null then
      if not public.kb_can('create', 'folder', new.parent_id) then raise exception 'You can''t add folders where you''re moving it.'; end if;
      if exists (with recursive d as (select id from public.kb_folders where id = old.id union all select f.id from public.kb_folders f join d on f.parent_id = d.id) select 1 from d where id = new.parent_id) then
        raise exception 'A folder can''t be moved inside itself.'; end if;
    elsif not public.kb_can('create', 'section', new.section_id) then raise exception 'You can''t add folders to that section.'; end if;
  elsif tg_table_name = 'kb_articles' and new.folder_id is distinct from old.folder_id then
    if not public.kb_can('move', 'article', old.id) then raise exception 'You don''t have permission to move this article.'; end if;
    if not public.kb_can('create', 'folder', new.folder_id) then raise exception 'You can''t add articles where you''re moving it.'; end if;
  elsif tg_table_name = 'kb_files' and new.folder_id is distinct from old.folder_id then
    if not public.kb_can('move', 'file', old.id) then raise exception 'You don''t have permission to move this file.'; end if;
    if new.folder_id is not null and not public.kb_can('upload', 'folder', new.folder_id) then raise exception 'You can''t upload where you''re moving it.'; end if;
  end if;
  -- turning a restricted list on/off is a permissions change
  if new.restricted is distinct from old.restricted and not public.kb_can('manage_permissions', case tg_table_name when 'kb_folders' then 'folder' when 'kb_articles' then 'article' else 'file' end, old.id) then
    raise exception 'You don''t have permission to change who can access this.'; end if;
  return new;
end $$;
drop trigger if exists trg_kb_guard_move on public.kb_folders;
create trigger trg_kb_guard_move before update on public.kb_folders for each row execute function public.kb_guard_move();
drop trigger if exists trg_kb_guard_move on public.kb_articles;
create trigger trg_kb_guard_move before update on public.kb_articles for each row execute function public.kb_guard_move();
drop trigger if exists trg_kb_guard_move on public.kb_files;
create trigger trg_kb_guard_move before update on public.kb_files for each row execute function public.kb_guard_move();

-- trash: see and restore what you may restore
drop policy if exists kb_trash_select_v2 on public.kb_trash;
create policy kb_trash_select_v2 on public.kb_trash for select to authenticated using ((public.kb_admin_powers()->>'restore')::boolean);

-- ---------- search (everything you may view; filters for section, client, project, type, folder) ----------
create or replace function public.kb_search2(q text default null, p_section uuid default null, p_client uuid default null, p_project uuid default null,
  p_types text[] default null, p_folder uuid default null, p_limit int default 100)
returns table(kind text, id uuid, title text, folder_id uuid, section_id uuid, snippet text, updated_at timestamptz, rank real)
language sql stable security definer set search_path to 'public' as $$
  with recursive tree as (select f.id, f.parent_id, f.section_id, f.client_id, f.project_id, f.id as root from public.kb_folders f where p_folder is null or f.id = p_folder
                           union all select c.id, c.parent_id, c.section_id, coalesce(c.client_id, t.client_id), coalesce(c.project_id, t.project_id), t.root from public.kb_folders c join tree t on c.parent_id = t.id where p_folder is not null),
  scope as (select distinct on (id) * from tree),
  -- client/project are inherited from the nearest folder that has one
  fx as (select f.id, f.section_id,
           (with recursive up as (select x.id, x.parent_id, x.client_id, x.project_id from public.kb_folders x where x.id = f.id union all select y.id, y.parent_id, y.client_id, y.project_id from public.kb_folders y join up on y.id = up.parent_id)
            select client_id from up where client_id is not null limit 1) cl,
           (with recursive up as (select x.id, x.parent_id, x.client_id, x.project_id from public.kb_folders x where x.id = f.id union all select y.id, y.parent_id, y.client_id, y.project_id from public.kb_folders y join up on y.id = up.parent_id)
            select project_id from up where project_id is not null limit 1) pr
         from scope f),
  tq as (select case when nullif(btrim(coalesce(q, '')), '') is null then null else websearch_to_tsquery('english', q) end as t),
  hits as (
    select 'article'::text kind, a.id, a.title, a.folder_id, fx.section_id,
      case when (select t from tq) is null then null else ts_headline('english', regexp_replace(coalesce(a.body, ''), '<[^>]+>', ' ', 'g'), (select t from tq), 'MaxFragments=1, MinWords=6, MaxWords=18') end snippet,
      a.updated_at, case when (select t from tq) is null then 0 else ts_rank(a.search_tsv, (select t from tq)) + case when a.title ilike '%' || q || '%' then 1 else 0 end end::real rank
    from public.kb_articles a join fx on fx.id = a.folder_id
    where (p_types is null or 'article' = any (p_types)) and ((select t from tq) is null or a.search_tsv @@ (select t from tq) or a.title ilike '%' || q || '%')
      and (p_section is null or fx.section_id = p_section) and (p_client is null or fx.cl = p_client) and (p_project is null or fx.pr = p_project)
    union all
    select x.kind, x.id, x.name, coalesce(x.folder_id, a.folder_id), fx.section_id, null, x.created_at, case when x.name ilike '%' || coalesce(q, '') || '%' then 1 else 0 end::real
    from public.kb_files x left join public.kb_articles a on a.id = x.article_id join fx on fx.id = coalesce(x.folder_id, a.folder_id)
    where (p_types is null or x.kind = any (p_types)) and (nullif(btrim(coalesce(q, '')), '') is null or x.name ilike '%' || q || '%')
      and (p_section is null or fx.section_id = p_section) and (p_client is null or fx.cl = p_client) and (p_project is null or fx.pr = p_project)
    union all
    select 'folder', f.id, f.name, f.parent_id, fx.section_id, f.description, f.updated_at, case when f.name ilike '%' || coalesce(q, '') || '%' then 2 else 0 end::real
    from public.kb_folders f join fx on fx.id = f.id
    where (p_types is null or 'folder' = any (p_types)) and (nullif(btrim(coalesce(q, '')), '') is null or f.name ilike '%' || q || '%' or f.description ilike '%' || q || '%')
      and (p_section is null or fx.section_id = p_section) and (p_client is null or fx.cl = p_client) and (p_project is null or fx.pr = p_project))
  select h.* from hits h where public.kb_can('view', case when h.kind in ('file', 'recording') then 'file' else h.kind end, h.id) order by h.rank desc, h.updated_at desc nulls last limit greatest(1, least(p_limit, 500))
$$;

grant execute on function public.kb_search2(text, uuid, uuid, uuid, text[], uuid, int) to authenticated;

-- ---------- trash + file storage use the new permissions ----------
do $$ declare d text; begin
  foreach d in array array['public.kb_trash_restore(uuid)', 'public.kb_trash_forget(uuid)'] loop
    execute (select replace(pg_get_functiondef(d::regprocedure), 'if not public.kb_is_author() then', 'if not (public.kb_admin_powers()->>''restore'')::boolean then'));
  end loop;
end $$;
create or replace function public.kb_can_upload_somewhere() returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_access_owner()
      or (exists (select 1 from public.access_assignments x where x.profile_id = auth.uid()) and (public.has_perm('kb.upload') or public.has_perm('kb.edit') or public.has_perm('kb.manage')
          or exists (select 1 from public.kb_grants g where ('upload' = any (g.actions) or 'edit' = any (g.actions)) and public.kb_principal_match(g.principal_type, g.principal_id))))
      or (not exists (select 1 from public.access_assignments x where x.profile_id = auth.uid()) and public.kb_is_author())
$$;
drop policy if exists kb_files_bucket_insert on storage.objects;
create policy kb_files_bucket_insert on storage.objects for insert to authenticated with check (bucket_id = 'kb-files' and public.kb_can_upload_somewhere());
drop policy if exists kb_files_bucket_update on storage.objects;
create policy kb_files_bucket_update on storage.objects for update to authenticated using (bucket_id = 'kb-files' and public.kb_can_upload_somewhere());
drop policy if exists kb_files_bucket_delete on storage.objects;
create policy kb_files_bucket_delete on storage.objects for delete to authenticated using (bucket_id = 'kb-files' and (
  exists (select 1 from public.kb_files f where f.storage_path = storage.objects.name and public.kb_can('delete', 'file', f.id))
  or (public.kb_admin_powers()->>'restore')::boolean));
-- downloading a file needs "download" on that file (same rules as everything else)
drop policy if exists kb_files_bucket_select on storage.objects;
create policy kb_files_bucket_select on storage.objects for select to authenticated using (bucket_id = 'kb-files' and (
  exists (select 1 from public.kb_files f where f.storage_path = storage.objects.name and public.kb_can('download', 'file', f.id))
  or exists (select 1 from public.kb_files f where f.storage_path = storage.objects.name and f.uploaded_by = auth.uid())
  or not exists (select 1 from public.kb_files f where f.storage_path = storage.objects.name)));   -- images embedded in articles (no file record)

-- ---------- bring existing content in ----------
-- starter sections (just examples — rename, reorder, add or remove them any time)
insert into public.kb_sections (name, description, icon, sort_order)
select v.n, v.d, v.i, v.o from (values ('Agents', 'Guides, call flows, scripts and resources for agents.', '🎧', 1),
                                       ('Internal', 'Internal SOPs, processes and team resources.', '🏢', 2)) v(n, d, i, o)
where not exists (select 1 from public.kb_sections);
-- top-level folders: anything agents can see today → Agents; everything else → Internal
update public.kb_folders f set section_id = (select id from public.kb_sections where name = case
    when not f.has_own_audience or 'agent' = any (coalesce(f.audience_roles, '{}')) then 'Agents' else 'Internal' end order by sort_order limit 1)
where f.parent_id is null and f.section_id is null;
update public.kb_folders f set section_id = (select p.section_id from public.kb_folders p where p.id = f.parent_id) where f.parent_id is not null;
-- any folder still without a section (deep nesting) gets its parent's
do $$ declare n int; begin
  loop
    update public.kb_folders f set section_id = p.section_id from public.kb_folders p where p.id = f.parent_id and f.section_id is null and p.section_id is not null;
    get diagnostics n = row_count; exit when n = 0;
  end loop;
end $$;
-- link top-level folders to their client when the name matches (e.g. "GarageCo…" → GarageCo)
update public.kb_folders f set client_id = c.id from public.clients c
where f.parent_id is null and f.client_id is null and length(c.name) >= 4 and (f.name ilike c.name || '%' or f.name ilike '%' || c.name || '%')
  and not exists (select 1 from public.clients c2 where c2.id <> c.id and (f.name ilike c2.name || '%') and length(c2.name) > length(c.name));
-- old audiences → restricted with the same audience (view + download), so nobody gains or loses access
update public.kb_folders set restricted = true where has_own_audience and not restricted;
update public.kb_articles set restricted = true where override_audience and not restricted;
update public.kb_files set restricted = true where override_audience and not restricted;
insert into public.kb_grants (object_type, object_id, principal_type, principal_id, actions)
select 'folder', f.id, 'legacy_role', r, array['view','download'] from public.kb_folders f, unnest(coalesce(f.audience_roles, '{}')) r where f.has_own_audience
union all select 'article', a.id, 'legacy_role', r, array['view','download'] from public.kb_articles a, unnest(coalesce(a.audience_roles, '{}')) r where a.override_audience
union all select 'file', x.id, 'legacy_role', r, array['view','download'] from public.kb_files x, unnest(coalesce(x.audience_roles, '{}')) r where x.override_audience
union all select 'folder', t.folder_id, 'team', t.tag_id::text, array['view','download'] from public.kb_folder_tags t
union all select 'article', t.article_id, 'team', t.tag_id::text, array['view','download'] from public.kb_article_tags t where t.is_audience
union all select 'file', t.file_id, 'team', t.tag_id::text, array['view','download'] from public.kb_file_tags t where t.is_audience
on conflict do nothing;
-- the old editors (Certification + Admin job roles) keep full control everywhere
insert into public.kb_grants (object_type, object_id, principal_type, principal_id, actions)
select 'section', s.id, 'legacy_role', r, array['view','create','upload','edit','move','download','delete','restore','manage_permissions']
from public.kb_sections s, unnest(array['admin', 'certification']) r on conflict do nothing;
insert into public.kb_grants (object_type, object_id, principal_type, principal_id, actions)
select 'folder', f.id, 'legacy_role', r, array['view','create','upload','edit','move','download','delete','restore','manage_permissions']
from public.kb_folders f, unnest(array['admin', 'certification']) r where f.restricted on conflict do nothing;

-- starter templates (optional — edit, archive or add your own)
insert into public.kb_templates (name, description, icon, body, is_starter, sort_order)
select v.n, v.d, v.i, v.b, true, v.o from (values
 ('SOP', 'A step-by-step standard operating procedure.', '📋', '<h2>Purpose</h2><p>What this SOP is for and when to use it.</p><h2>Who this is for</h2><p></p><h2>Steps</h2><ol><li></li><li></li><li></li></ol><h2>What “done” looks like</h2><p></p><h2>If something goes wrong</h2><p></p>', 1),
 ('Call flow', 'Greeting → discovery → solution → close, with rebuttals.', '📞', '<h2>Greeting</h2><p></p><h2>Discovery questions</h2><ul><li></li></ul><h2>Solution / offer</h2><p></p><h2>Common objections & rebuttals</h2><ul><li><b>Objection:</b> … <b>Response:</b> …</li></ul><h2>Close & next steps</h2><p></p><h2>Dispositions</h2><p></p>', 2),
 ('FAQ', 'Questions and answers people ask most.', '❓', '<h2>Frequently asked questions</h2><h3>Question?</h3><p>Answer.</p><h3>Question?</h3><p>Answer.</p>', 3),
 ('Guide', 'A how-to guide with background and tips.', '📘', '<h2>Overview</h2><p></p><h2>Before you start</h2><ul><li></li></ul><h2>How to</h2><ol><li></li></ol><h2>Tips</h2><ul><li></li></ul>', 4)
) v(n, d, i, b, o) where not exists (select 1 from public.kb_templates where is_starter);

-- every folder belongs to a section from now on
alter table public.kb_folders alter column section_id set not null;
