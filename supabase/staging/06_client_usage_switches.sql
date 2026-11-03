-- ============================================================
-- "WHERE THIS CLIENT IS USED" — custom switches (staging, 2026-10-30). Run after 01–05.
-- Built in: Task management (clients.show_in_tasks) and Invoicing (finance profile).
-- Admins can add their own switches (e.g. "Sales deals", "Scheduling") — self-service.
--  • client_usage_types: the switches (company settings → Administrators)
--  • client_usage: which clients have each switch on (client editors)
-- ============================================================
create table if not exists public.client_usage_types (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  description text,
  sort int not null default 100,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz);
create unique index if not exists client_usage_types_label on public.client_usage_types (lower(label)) where archived_at is null;
create table if not exists public.client_usage (
  client_id uuid not null references public.clients(id) on delete cascade,
  type_id uuid not null references public.client_usage_types(id) on delete cascade,
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (client_id, type_id));
alter table public.client_usage_types enable row level security;
alter table public.client_usage enable row level security;
drop policy if exists client_usage_types_read on public.client_usage_types;
create policy client_usage_types_read on public.client_usage_types for select to authenticated using (true);
drop policy if exists client_usage_types_write on public.client_usage_types;
create policy client_usage_types_write on public.client_usage_types for all to authenticated
  using (public.has_perm('admin.settings')) with check (public.has_perm('admin.settings'));
drop policy if exists client_usage_read on public.client_usage;
create policy client_usage_read on public.client_usage for select to authenticated using (true);
drop policy if exists client_usage_write on public.client_usage;
create policy client_usage_write on public.client_usage for all to authenticated
  using (public.has_perm('clients.edit', client_id) or public.has_perm('clients.manage'))
  with check (public.has_perm('clients.edit', client_id) or public.has_perm('clients.manage'));
