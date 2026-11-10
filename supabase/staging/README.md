[README (25).md](https://github.com/user-attachments/files/34651928/README.25.md)
[README (24).md](https://github.com/user-attachments/files/34595605/README.24.md)
[README (21).md](https://github.com/user-attachments/files/34585844/README.21.md)
[README (19).md](https://github.com/user-attachments/files/34448460/README.19.md)
# Staging setup scripts

Run these in the **staging** database (Supabase → command-center-staging → SQL editor),
in order, after the "Sync staging database structure" job — the sync rebuilds the main
database section from live and removes anything that only exists in staging.

1. `01_roles_permissions.sql` — self-service roles & permissions (tables, the checkbox
   catalog, `has_perm()`, safety rules, the 4 starter roles).
2. `02_per_person_adjustments.sql` — per-person ➕/➖ adjustments on top of roles.
3. `03_task_permissions.sql` — Client → Project, task edit/delete rules (creator / assignee
   progress / explicit Edit & Delete), recoverable project deletion, Recently deleted.
4. `04_access_levels_delegation.sql` — access levels as a ceiling (Owner / Administrator /
   Manager / User), delegated role assignment ("Can assign"), clearer history.
5. `05_clients_projects.sql` — Clients → Projects setup (archive/restore, unique names),
   and "your words" (what the company calls a client / a project). Archiving a client
   takes its projects with it; restoring brings them back.
6. `06_client_usage_switches.sql` — "Where this client is used": custom switches admins add.

9. `09_team_updates.sql` — Team Updates checkboxes (Weekly Sync, submit / view end-of-day reports).
10. `10_calendars.sql` — shared calendars (people/teams, view or add) + each person's Customize choices.
11. `11_dashboard.sql` — Dashboard: project on schedules, dashboard checkboxes, and the secure dash_* functions.
12. `12_dashboard_actions.sql` — nudge people who haven't checked in; alert available people about open intervals.
13. `13_alert_settings.sql` — Configuration → Alerts: wording, cooldowns, automatic nudges/alerts (cron every 5 min), availability rules.
14. `14_dashboard_settings.sql` — Configuration → Dashboard: what counts toward fill rate (internal default + per schedule), colors, needs-attention, default range.
15. `15_schedule_team_view.sql` — Schedule Team/Internal view, interval locking, granular schedule permissions, server-side eligibility.
16. `16_schedule_attendance.sql` — Check people in/out and mark/clear no-shows from Interval details (own permissions).
17. `17_schedule_config.sql` — Configuration → Schedule: colors, layout, and custom schedule views (who sees each).
18. `18_fill_rate_config.sql` — Schedule → Fill Rate tab: own permission (client-scoped), follows Dashboard's what-counts rules, configurable colors + Copy update.
19. `19_schedule_rules.sql` — Configuration → Schedule rules: release schedule, release waves, weekly cap, commitment lock, check-out grace & auto check-out (each with its own permission).
20. `20_schedule_rules_per_schedule.sql` — Schedule rules per schedule: any schedule can override whole sections of the company rules.
21. `21_release_wave_conditions.sql` — Release waves built from each company's own data (tiers, teams, certifications, hours, people), any/all, top-to-bottom.
22. `22_dashboard_whos_on_by_hour.sql` — Dashboard: "Who's on" view (Who's On + Time combined) and Schedule → By hour + Mix.

All are safe to run more than once. (Staging also has fictional @demo.test people + sample schedules for testing.) Ask Claude to re-add the demo company afterwards.
