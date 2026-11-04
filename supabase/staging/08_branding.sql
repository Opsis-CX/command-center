-- ============================================================
-- BRANDING (staging, 2026-11-04). Run after 01–07.
--  • org_branding: the company's own branding for Command Center (one row): name, logos
--    (main, dark-mode, square icon), brand + sidebar colors. Edited with "Change company
--    settings and branding" (Administrator level). Readable by everyone (incl. the login page).
--  • Client branding reuses the columns the client portal already uses (portal_name,
--    portal_logo_url, portal_accent, portal_sidebar, portal_profile) + two switches:
--    brand_portal (their portal) and brand_reports (their reports). Edited with "Edit client details".
--  • Logos live in the public portal-assets bucket: company/… and <client_id>/…
-- ============================================================
create table if not exists public.org_branding (
  id boolean primary key default true check (id),
  company_name text,
  logo_url text, logo_dark_url text, icon_url text,
  primary_color text check (primary_color is null or primary_color ~* '^#[0-9a-f]{6}$'),
  sidebar_color text check (sidebar_color is null or sidebar_color ~* '^#[0-9a-f]{6}$'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now());
insert into public.org_branding (id) values (true) on conflict do nothing;
alter table public.org_branding enable row level security;
drop policy if exists org_branding_read on public.org_branding;
create policy org_branding_read on public.org_branding for select to anon, authenticated using (true);
drop policy if exists org_branding_write on public.org_branding;
create policy org_branding_write on public.org_branding for update to authenticated
  using (public.has_perm('admin.settings')) with check (public.has_perm('admin.settings'));

alter table public.clients add column if not exists portal_sidebar text;
alter table public.clients add column if not exists portal_profile jsonb not null default '{}'::jsonb;
alter table public.clients add column if not exists brand_portal boolean not null default true;
alter table public.clients add column if not exists brand_reports boolean not null default false;

-- uploads: company logos (company settings) and client logos (client editors)
drop policy if exists "branding company logos" on storage.objects;
create policy "branding company logos" on storage.objects for all to authenticated
  using (bucket_id = 'portal-assets' and (storage.foldername(name))[1] = 'company' and public.has_perm('admin.settings'))
  with check (bucket_id = 'portal-assets' and (storage.foldername(name))[1] = 'company' and public.has_perm('admin.settings'));
drop policy if exists "branding client logos" on storage.objects;
create policy "branding client logos" on storage.objects for all to authenticated
  using (bucket_id = 'portal-assets' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and (public.has_perm('clients.edit', ((storage.foldername(name))[1])::uuid) or public.has_perm('clients.manage')))
  with check (bucket_id = 'portal-assets' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and (public.has_perm('clients.edit', ((storage.foldername(name))[1])::uuid) or public.has_perm('clients.manage')));

-- "Edit client details" can save client edits (name, settings, branding) in its scope;
-- archiving/restoring still needs "Add and remove clients".
drop policy if exists clients_update_manage on public.clients;
create policy clients_update_manage on public.clients for update to authenticated
  using (public.has_perm('clients.manage') or public.has_perm('clients.edit', id))
  with check (public.has_perm('clients.manage') or public.has_perm('clients.edit', id));
create or replace function public.tg_clients_archive_needs_manage() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and new.archived_at is distinct from old.archived_at and not public.has_perm('clients.manage') then
    raise exception 'Archiving or restoring needs "Add and remove clients".'; end if;
  return new;
end $$;
drop trigger if exists trg_clients_archive_needs_manage on public.clients;
create trigger trg_clients_archive_needs_manage before update on public.clients for each row execute function public.tg_clients_archive_needs_manage();
