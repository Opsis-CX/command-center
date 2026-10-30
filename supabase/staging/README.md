[README.md](https://github.com/user-attachments/files/34159894/README.md)
# Staging setup scripts

Run these in the **staging** database (Supabase → command-center-staging → SQL editor),
in order, after the "Sync staging database structure" job — the sync rebuilds the main
database section from live and removes anything that only exists in staging.

1. `01_roles_permissions.sql` — self-service roles & permissions (tables, the checkbox
   catalog, `has_perm()`, safety rules, the 4 starter roles). Safe to run more than once.

Ask Claude to re-add the demo company (fictional people, projects, chat) afterwards.
