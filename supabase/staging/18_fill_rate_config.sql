-- ============================================================
-- SCHEDULE → FILL RATE TAB: configurable + permissioned (staging 2026-11-05). Run after 17.
--  • Checkbox schedule.fill_rate "See the Fill Rate tab" (client/project-scoped).
--  • get_fill_rate_by_client: only schedules the person may see, only schedules that count
--    toward fill rate (Configuration → Dashboard), and locked spots aren't listed as open.
--  • schedule_settings: who "Copy update" tags + which lines it includes.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('schedule.fill_rate', 'schedule_team', 'Schedule — team & intervals', 'My work', 'special', 'See the Fill Rate tab', true, 139, 'manager')
on conflict (key) do update set label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level;
insert into public.access_role_permissions (role_id, perm_key) select r.id, 'schedule.fill_rate' from public.access_roles r where r.is_starter and r.sort in (2, 3) on conflict do nothing;

alter table public.schedule_settings add column if not exists fill_mentions uuid[] not null default '{}';
alter table public.schedule_settings add column if not exists fill_lines jsonb not null default '{"staffed": true, "coverage": true, "open": true, "tiers": true}';

do $$ declare d text; begin
  d := pg_get_functiondef('public.get_fill_rate_by_client(date)'::regprocedure);
  if position('schedule.fill_rate' in d) = 0 then
    d := replace(d, 'if not public.is_internal_staff() then', 'if not (public.is_access_owner() or public.has_perm(''schedule.fill_rate'')) then');
    d := replace(d, 'select b.id, s.client_id,', 'select b.id, b.locked_at, s.client_id,');
    d := regexp_replace(d, 'where b\.block_date = d(\s*)\)', 'where b.block_date = d and public.sched_can(''schedule.fill_rate'', s.id) and public.dash_counts_fill(s.client_id, s.counts_toward_fill)\1)');
    d := replace(d, 'filter (where total_spots - claims > 0)', 'filter (where total_spots - claims > 0 and locked_at is null)');
    if position('schedule.fill_rate'')) then' in d) = 0 or position('dash_counts_fill' in d) = 0 or position('locked_at is null' in d) = 0 then
      raise exception 'get_fill_rate_by_client not updated (text did not match)'; end if;
    execute d;
  end if;
end $$;

-- Fill Rate tab color cutoffs (its own — stricter than the Dashboard's; defaults match today's 95 / 90)
alter table public.schedule_settings add column if not exists fill_good int not null default 95 check (fill_good between 1 and 100);
alter table public.schedule_settings add column if not exists fill_warn int not null default 90 check (fill_warn between 0 and 100);
