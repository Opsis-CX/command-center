-- ============================================================
-- PERMISSION GAPS from the audit (staging 2026-11-10). Run after 22.
--  1. "Pick up open intervals for themselves" (schedule.claim) is now ENFORCED when someone claims.
--     Only for people who have been given roles (the new system); anyone without roles keeps
--     today's behavior, so nothing breaks before roles are rolled out on live.
--  2. Configuration → Dashboard gets its own checkbox (admin.dashboard_settings) instead of
--     sharing the general "Change settings" one.
-- ============================================================
do $$ declare d text; begin
  d := pg_get_functiondef('public.enforce_claim_rules'::regproc);
  if position('schedule.claim' in d) = 0 then
    d := replace(d, '-- RULE E (2026-11-05): people claiming for themselves must be on the schedule and hold the gating cert',
      '-- RULE P (2026-11-10): picking up intervals for yourself needs "Pick up open intervals" (people on the new roles system)
  if auth.uid() is not null and auth.uid() = new.profile_id and coalesce(current_setting(''cc.lock_bypass'', true), '''') <> ''1''
     and exists (select 1 from public.access_assignments aa where aa.profile_id = auth.uid())
     and not public.is_access_owner() and not public.has_perm(''schedule.claim'') then
    raise exception ''You don''''t have permission to pick up intervals.'';
  end if;
  -- RULE E (2026-11-05): people claiming for themselves must be on the schedule and hold the gating cert');
    if position('schedule.claim' in d) = 0 then raise exception 'enforce_claim_rules not updated'; end if;
    execute d;
  end if;
end $$;

insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('admin.dashboard_settings', 'admin', 'Administration', 'Administration', 'manage', 'Change Dashboard settings (Configuration → Dashboard)', false, 906, 'administrator')
on conflict (key) do update set label = excluded.label, min_level = excluded.min_level, module = excluded.module, module_group = excluded.module_group;
insert into public.access_role_permissions (role_id, perm_key) select r.id, 'admin.dashboard_settings' from public.access_roles r where r.is_starter and r.sort = 2 on conflict do nothing;
-- anyone who could change these through "Change settings" keeps that ability
insert into public.access_role_permissions (role_id, perm_key) select distinct rp.role_id, 'admin.dashboard_settings' from public.access_role_permissions rp where rp.perm_key = 'admin.settings' on conflict do nothing;

drop policy if exists dashboard_settings_write on public.dashboard_settings;
create policy dashboard_settings_write on public.dashboard_settings for update to authenticated
  using (public.is_access_owner() or public.has_perm('admin.dashboard_settings')) with check (public.is_access_owner() or public.has_perm('admin.dashboard_settings'));
do $$ declare d text; begin
  d := pg_get_functiondef('public.dash_set_fill_override(uuid,boolean)'::regprocedure);
  d := replace(d, 'if not public.has_perm(''admin.settings'')', 'if not (public.is_access_owner() or public.has_perm(''admin.dashboard_settings''))');
  if position('admin.dashboard_settings' in d) = 0 then raise exception 'dash_set_fill_override not updated'; end if;
  execute d;
  d := pg_get_functiondef('public.dash_fill_schedule_list()'::regprocedure);
  d := replace(d, 'and public.has_perm(''admin.settings'')', 'and (public.is_access_owner() or public.has_perm(''admin.dashboard_settings''))');
  if position('admin.dashboard_settings' in d) = 0 then raise exception 'dash_fill_schedule_list not updated'; end if;
  execute d;
end $$;
