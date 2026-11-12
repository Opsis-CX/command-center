-- ============================================================
-- KNOWLEDGE BASE: precise client/project access (staging 2026-11-12). Run after 25.
--  • Folders linked to a client or project are seen only by people WORKING ON IT:
--      on that client's/project's schedules · assigned its tasks · or their role is scoped to it.
--    (Plus anyone with the new "See every client's and project's resources" checkbox — nobody by default.)
--  • Explicit sharing (⋯ → Manage access) still works as an exception.
--  • "Full control of the Knowledge Base" is no longer given to Administrators by default (Owner only).
-- Company-wide folders (no client/project) are unchanged. People without roles (live today) unchanged.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level)
select 'kb.all_clients', 'kb', module_label, module_group, 'special', 'See every client''s and project''s resources (not just the ones they work on)', false, 511, 'manager'
from public.perm_catalog where key = 'kb.view'
on conflict (key) do update set label = excluded.label, sort = excluded.sort, min_level = excluded.min_level;
delete from public.access_role_permissions
where perm_key = 'kb.manage' and role_id in (select id from public.access_roles where is_starter and sort = 2);

-- is this person working on this client / project?
create or replace function public.kb_works_on(p_client uuid, p_project uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select (p_client is not null and public.kb_principal_match('client', p_client::text))
      or (p_project is not null and public.kb_principal_match('project', p_project::text))
      or exists (select 1 from public.access_assignments a where a.profile_id = auth.uid()
                  and ((p_client is not null and p_client = any (coalesce(a.client_ids, '{}'))) or (p_project is not null and p_project = any (coalesce(a.project_ids, '{}')))))
$$;

do $$ declare d text; begin
  d := pg_get_functiondef('public.kb_can(text,text,uuid)'::regprocedure);
  if position('kb_works_on' in d) = 0 then
    d := replace(d, '  return public.kb_baseline(case p_action when ''manage_permissions'' then ''kb.permissions'' else ''kb.'' || p_action end, v_client, v_project);',
'  -- a project''s client counts as the content''s client too
  if v_client is null and v_project is not null then v_client := (select client_id from public.projects where id = v_project); end if;
  -- client/project content: only people working on it (or with "See every client''s and project''s resources")
  if (v_client is not null or v_project is not null)
     and not public.has_perm(''kb.all_clients'', ''00000000-0000-0000-0000-000000000000''::uuid)
     and not public.kb_works_on(v_client, v_project) then
    return false;
  end if;
  return public.kb_baseline(case p_action when ''manage_permissions'' then ''kb.permissions'' else ''kb.'' || p_action end, v_client, v_project);');
    if position('kb_works_on' in d) = 0 then raise exception 'kb_can not updated (text did not match)'; end if;
    execute d;
  end if;
end $$;
