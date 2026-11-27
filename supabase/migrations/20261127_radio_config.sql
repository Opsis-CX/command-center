-- Opsis Radio (2026-11-27): one row holding the YouTube playlist link and who can see the radio.
-- Admins edit it from the gear inside the radio player (no code change to swap playlists).
create table if not exists public.radio_config (
  id int primary key default 1 check (id = 1),
  playlist_url text,
  visibility text not null default 'owner' check (visibility in ('owner','team')),
  allowed_profile_ids uuid[] not null default '{}',
  updated_at timestamptz default now(),
  updated_by uuid
);
insert into public.radio_config(id, allowed_profile_ids)
values (1, array['16624091-32ea-4d1f-8262-643368a6e4e7']::uuid[])
on conflict (id) do nothing;
alter table public.radio_config enable row level security;
drop policy if exists radio_config_read on public.radio_config;
create policy radio_config_read on public.radio_config for select to authenticated using (true);
drop policy if exists radio_config_admin_update on public.radio_config;
create policy radio_config_admin_update on public.radio_config for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or lower(p.role) in ('owner','admin'))))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or lower(p.role) in ('owner','admin'))));
