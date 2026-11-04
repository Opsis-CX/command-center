-- ============================================================
-- TEAM UPDATES (staging, 2026-11-04). Run after 01–08.
-- New checkboxes for the Team Updates section: Weekly Sync and End-of-Day reports.
-- "View the team's end-of-day reports" lets someone read everyone's submitted reports
-- (until now only admins could). People always read/write their own.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('team.weekly_sync', 'team', 'Team Updates', 'Communication', 'view', 'Use Weekly Sync', false, 260, 'user'),
 ('team.eod_submit', 'team', 'Team Updates', 'Communication', 'create', 'Submit end-of-day reports', false, 261, 'user'),
 ('team.eod_view', 'team', 'Team Updates', 'Communication', 'approve', 'View the team''s end-of-day reports', false, 262, 'manager')
on conflict (key) do update set module = excluded.module, module_label = excluded.module_label, module_group = excluded.module_group,
  action = excluded.action, label = excluded.label, sort = excluded.sort, min_level = excluded.min_level;
-- starter roles: Administrator gets all three; Manager gets all three; User gets the first two
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['team.weekly_sync','team.eod_submit','team.eod_view']) k where r.is_starter and r.sort in (2, 3)
on conflict do nothing;
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['team.weekly_sync','team.eod_submit']) k where r.is_starter and r.sort = 4
on conflict do nothing;

drop policy if exists daily_reports_view_team on public.daily_reports;
create policy daily_reports_view_team on public.daily_reports for select to authenticated using (public.has_perm('team.eod_view'));
