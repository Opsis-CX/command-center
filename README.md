[README (2).md](https://github.com/user-attachments/files/34200183/README.2.md)
# Staging setup scripts

Run these in the **staging** database (Supabase → command-center-staging → SQL editor),
in order, after the "Sync staging database structure" job — the sync rebuilds the main
database section from live and removes anything that only exists in staging.

1. `01_roles_permissions.sql` — self-service roles & permissions (tables, the checkbox
   catalog, `has_perm()`, safety rules, the 4 starter roles).
2. `02_per_person_adjustments.sql` — per-person ➕/➖ adjustments on top of roles.
3. `03_task_permissions.sql` — Client → Project, task edit/delete rules (creator / assignee
   progress / explicit Edit & Delete), recoverable project deletion, Recently deleted.

All are safe to run more than once. Ask Claude to re-add the demo company afterwards.
