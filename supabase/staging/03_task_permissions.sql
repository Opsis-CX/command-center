-- ============================================================
-- TASK & PROJECT PERMISSIONS (staging, 2026-10-30) — run after 01 and 02. Safe to run more than once.
--  • Projects can belong to a client (Client → Project) or be standalone/internal (no client).
--  • Edit:   creator (own tasks, in scope) · assignee (progress fields only) · tasks.edit (any task in scope)
--  • Delete: soft delete / restore ONLY with tasks.delete in scope — even for creators/assignees.
--            Permanent deletion is blocked for everyone in the app.
--  • Projects: edit/delete/restore need tasks.manage in scope; deleting is recoverable and
--    takes its tasks with it (restoring brings them back).
--  • All enforced in the database (rules + triggers), not just hidden buttons.
-- ============================================================

-- ---------- Client → Project ----------
alter table public.projects add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.projects add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists deleted_with_project uuid;   -- set when a project delete took this task with it
create index if not exists projects_client on public.projects (client_id);

-- ---------- "does this person have <permission> for this task's project/client?" ----------
-- Task in a project → the project, or the project's client. Task with only a client → that client.
-- Personal task (no project, no client) → needs the permission for "Everything".
create or replace function public.has_perm_on(p_key text, p_project uuid, p_client uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select case
    when p_project is not null or p_client is not null then
         (p_project is not null and public.has_perm(p_key, p_project))
      or (p_client is not null and public.has_perm(p_key, p_client))
      or (p_project is not null and exists (                -- the project's client — only when the project HAS a client
            select 1 from public.projects pr where pr.id = p_project and pr.client_id is not null and public.has_perm(p_key, pr.client_id)))
      or coalesce((select all_access from public.perm_scope(p_key)), false)   -- "Everything" covers every project/client
    else coalesce((select all_access from public.perm_scope(p_key)), false)
  end
$$;
grant execute on function public.has_perm_on(text, uuid, uuid) to authenticated;

create or replace function public.is_task_assignee(p_task uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.task_assignees where task_id = p_task and profile_id = auth.uid())
$$;
grant execute on function public.is_task_assignee(uuid) to authenticated;

-- What I can do with one task — used by the app to show read-only fields / hide Delete.
create or replace function public.my_task_rights(p_task uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'edit_all', t.created_by = auth.uid() or public.has_perm_on('tasks.edit', t.project_id, t.client_id),
    'edit_progress', t.created_by = auth.uid() or public.is_task_assignee(t.id) or public.has_perm_on('tasks.edit', t.project_id, t.client_id),
    'delete', public.has_perm_on('tasks.delete', t.project_id, t.client_id))
  from public.tasks t where t.id = p_task
$$;
grant execute on function public.my_task_rights(uuid) to authenticated;

-- ---------- tasks: who may see / create / change ----------
drop policy if exists "Any authenticated user can update tasks" on public.tasks;
drop policy if exists "Any authenticated user can delete tasks" on public.tasks;
drop policy if exists "Any authenticated user can insert tasks" on public.tasks;
drop policy if exists tasks_insert_scoped on public.tasks;
create policy tasks_insert_scoped on public.tasks for insert to authenticated
  with check (created_by = auth.uid() and (
    (project_id is null and client_id is null)                       -- personal task
    or public.has_perm_on('tasks.create', project_id, client_id)));
drop policy if exists tasks_select_scoped on public.tasks;
create policy tasks_select_scoped on public.tasks for select to authenticated
  using (public.has_perm_on('tasks.view', project_id, client_id));      -- in addition to the existing member/assignee/creator rules
drop policy if exists tasks_update_scoped on public.tasks;
create policy tasks_update_scoped on public.tasks for update to authenticated
  using (created_by = auth.uid() or public.is_task_assignee(id)
         or public.has_perm_on('tasks.edit', project_id, client_id) or public.has_perm_on('tasks.delete', project_id, client_id));
-- (no DELETE policy → permanent deletion is blocked for everyone signed in)

-- Field-by-field check on every change.
create or replace function public.tg_task_update_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); is_creator boolean; is_assignee boolean; can_edit boolean; can_delete boolean;
  structural boolean; progress boolean;
begin
  if me is null then return new; end if;                                   -- automations / server
  is_creator  := old.created_by = me;
  is_assignee := public.is_task_assignee(old.id);
  can_edit    := public.has_perm_on('tasks.edit', old.project_id, old.client_id);
  can_delete  := public.has_perm_on('tasks.delete', old.project_id, old.client_id);

  if new.created_by is distinct from old.created_by then raise exception 'The task creator can''t be changed.'; end if;

  -- delete (soft) or restore
  if new.deleted_at is distinct from old.deleted_at then
    if not can_delete then raise exception 'You don''t have permission to delete or restore this task.'; end if;
    if new.deleted_at is not null then new.deleted_by := me; else new.deleted_by := null; new.deleted_with_project := null; end if;
    return new;
  end if;
  if old.deleted_at is not null then raise exception 'Restore this task before changing it.'; end if;

  structural := new.name is distinct from old.name or new.priority is distinct from old.priority
             or new.project_id is distinct from old.project_id or new.client_id is distinct from old.client_id;
  progress   := new.status is distinct from old.status or new.notes is distinct from old.notes
             or new.drive_link is distinct from old.drive_link or new.due_date is distinct from old.due_date;

  if structural and not (can_edit or is_creator) then
    raise exception 'You can update progress on this task, but not its name, priority, project or client.';
  end if;
  if progress and not (can_edit or is_creator or is_assignee) then
    raise exception 'You don''t have permission to edit this task.';
  end if;
  -- moving it: must be allowed to put tasks in the new project/client too
  if (new.project_id is distinct from old.project_id or new.client_id is distinct from old.client_id)
     and (new.project_id is not null or new.client_id is not null)
     and not public.has_perm_on('tasks.create', new.project_id, new.client_id)
     and not public.has_perm_on('tasks.edit', new.project_id, new.client_id) then
    raise exception 'You can''t move this task into a project or client outside your access.';
  end if;
  -- creators edit their own tasks only while still inside their scope
  if structural and is_creator and not can_edit and (old.project_id is not null or old.client_id is not null)
     and not public.has_perm_on('tasks.view', old.project_id, old.client_id) then
    raise exception 'This task is outside your current access.';
  end if;
  return new;
end $$;
drop trigger if exists trg_task_update_guard on public.tasks;
create trigger trg_task_update_guard before update on public.tasks for each row execute function public.tg_task_update_guard();

-- ---------- assignees: adding/removing people = editing the task ----------
-- Helpers read tasks directly, so the tasks ↔ task_assignees rules can't loop.
create or replace function public.task_visible(p_task uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.tasks t where t.id = p_task and (
      t.created_by = auth.uid()
      or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.profile_id = auth.uid())
      or exists (select 1 from public.project_members m where m.project_id = t.project_id and m.profile_id = auth.uid())
      or coalesce((select is_admin from public.profiles where id = auth.uid()), false)
      or public.has_perm_on('tasks.view', t.project_id, t.client_id)))
$$;
create or replace function public.task_can_edit_all(p_task uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.tasks t where t.id = p_task and t.deleted_at is null
    and (t.created_by = auth.uid() or public.has_perm_on('tasks.edit', t.project_id, t.client_id)))
$$;
grant execute on function public.task_visible(uuid), public.task_can_edit_all(uuid) to authenticated;
drop policy if exists "Any authenticated user can manage task assignees" on public.task_assignees;
drop policy if exists task_assignees_read on public.task_assignees;
create policy task_assignees_read on public.task_assignees for select to authenticated using (public.task_visible(task_id));
drop policy if exists task_assignees_write on public.task_assignees;
create policy task_assignees_write on public.task_assignees for all to authenticated
  using (public.task_can_edit_all(task_id)) with check (public.task_can_edit_all(task_id));

-- ---------- projects: edit/delete/restore need tasks.manage; deletion is recoverable ----------
drop policy if exists "Any authenticated user can update projects" on public.projects;
drop policy if exists "Admins or owner can delete projects" on public.projects;
drop policy if exists projects_update_scoped on public.projects;
create policy projects_update_scoped on public.projects for update to authenticated
  using (public.has_perm_on('tasks.manage', id, client_id)) with check (public.has_perm_on('tasks.manage', id, client_id));
drop policy if exists projects_select_scoped on public.projects;
create policy projects_select_scoped on public.projects for select to authenticated
  using (public.has_perm_on('tasks.view', id, client_id));
drop policy if exists "Any authenticated user can insert projects" on public.projects;
drop policy if exists projects_insert_scoped on public.projects;
create policy projects_insert_scoped on public.projects for insert to authenticated
  with check (created_by = auth.uid() and public.has_perm_on('tasks.manage', null, client_id));

create or replace function public.soft_delete_project(p_project uuid) returns int
language plpgsql security definer set search_path to 'public' as $$
declare p record; n int;
begin
  select * into p from public.projects where id = p_project;
  if p is null then raise exception 'Project not found.'; end if;
  if p.deleted_at is not null then return 0; end if;
  if not public.has_perm_on('tasks.manage', p.id, p.client_id) or not public.has_perm_on('tasks.delete', p.id, p.client_id) then
    raise exception 'You don''t have permission to delete this project.'; end if;
  update public.projects set deleted_at = now(), deleted_by = auth.uid() where id = p_project;
  -- its tasks go with it (marked, so restoring the project brings exactly these back)
  update public.tasks set deleted_at = now(), deleted_by = auth.uid(), deleted_with_project = p_project
   where project_id = p_project and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function public.restore_project(p_project uuid) returns int
language plpgsql security definer set search_path to 'public' as $$
declare p record; n int;
begin
  select * into p from public.projects where id = p_project;
  if p is null then raise exception 'Project not found.'; end if;
  if not public.has_perm_on('tasks.manage', p.id, p.client_id) or not public.has_perm_on('tasks.delete', p.id, p.client_id) then
    raise exception 'You don''t have permission to restore this project.'; end if;
  update public.projects set deleted_at = null, deleted_by = null where id = p_project;
  update public.tasks set deleted_at = null, deleted_by = null, deleted_with_project = null where deleted_with_project = p_project;
  get diagnostics n = row_count;
  return n;
end $$;
-- Recently deleted: what I'm allowed to restore
create or replace function public.my_recently_deleted() returns table (kind text, id uuid, name text, project_name text, deleted_at timestamptz, deleted_by_name text, task_count int)
language sql stable security definer set search_path to 'public' as $$
  select 'project', p.id, p.name, null, p.deleted_at, (select full_name from profiles where id = p.deleted_by),
         (select count(*)::int from tasks t where t.deleted_with_project = p.id)
    from projects p where p.deleted_at is not null and public.has_perm_on('tasks.delete', p.id, p.client_id) and public.has_perm_on('tasks.manage', p.id, p.client_id)
  union all
  select 'task', t.id, t.name, (select name from projects where id = t.project_id), t.deleted_at, (select full_name from profiles where id = t.deleted_by), null
    from tasks t where t.deleted_at is not null and t.deleted_with_project is null and public.has_perm_on('tasks.delete', t.project_id, t.client_id)
  order by 5 desc
  limit 300
$$;
grant execute on function public.soft_delete_project(uuid), public.restore_project(uuid), public.my_recently_deleted() to authenticated;
