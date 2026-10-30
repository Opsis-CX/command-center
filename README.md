[README (1).md](https://github.com/user-attachments/files/34191473/README.1.md)
# Staging setup scripts

Run these in the **staging** database (Supabase → command-center-staging → SQL editor),
in order, after the "Sync staging database structure" job — the sync rebuilds the main
database section from live and removes anything that only exists in staging.

1. `01_roles_permissions.sql` — self-service roles & permissions (tables, the checkbox
   catalog, `has_perm()`, safety rules, the 4 starter roles).
2. `02_per_person_adjustments.sql` — per-person ➕/➖ adjustments on top of roles.

Both are safe to run more than once. Ask Claude to re-add the demo company afterwards.
