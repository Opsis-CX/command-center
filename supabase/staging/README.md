[README (8).md](https://github.com/user-attachments/files/34379184/README.8.md)
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

All are safe to run more than once. Ask Claude to re-add the demo company afterwards.
