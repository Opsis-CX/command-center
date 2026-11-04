-- ============================================================
-- BACKEND: Daily Quotes library + Spotlight (staging, 2026-11-04). Run after 01–06.
--  • Two new checkboxes (Backend group): "Manage daily quotes", "Post the weekly spotlight".
--  • quote_library: as many quotes as you like; one is shown per day automatically
--    (pinned-to-today first, then the one shown longest ago / never), via rotate_daily_quote().
--    The shown quote is written to weekly_picks (kind 'quote') — Opsis Weekly reads it as before.
--  • weekly_picks: quote/spotlight rows can also be managed by people with those checkboxes.
-- ============================================================
insert into public.perm_catalog (key, module, module_label, module_group, action, label, scopeable, sort, min_level) values
 ('content.quotes', 'content', 'Daily quotes & spotlight', 'Backend', 'manage', 'Manage daily quotes', false, 600, 'manager'),
 ('content.spotlight', 'content', 'Daily quotes & spotlight', 'Backend', 'create', 'Post the weekly spotlight', false, 601, 'manager')
on conflict (key) do update set module = excluded.module, module_label = excluded.module_label, module_group = excluded.module_group,
  action = excluded.action, label = excluded.label, scopeable = excluded.scopeable, sort = excluded.sort, min_level = excluded.min_level;
-- the Administrator starter role gets every checkbox, including these
insert into public.access_role_permissions (role_id, perm_key)
select r.id, k from public.access_roles r, unnest(array['content.quotes','content.spotlight']) k
 where r.is_starter and r.sort = 2 on conflict do nothing;

-- ---------- quote library ----------
create table if not exists public.quote_library (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(btrim(body)) between 3 and 600),
  author text,
  active boolean not null default true,          -- paused quotes are never picked
  pinned_on date,                                -- show on this exact day
  times_shown int not null default 0,
  last_shown_on date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now());
create unique index if not exists quote_library_unique_body on public.quote_library (lower(btrim(body)));
create table if not exists public.quote_rotation_log (
  shown_on date primary key,
  quote_id uuid references public.quote_library(id) on delete set null,
  picked_by uuid references public.profiles(id) on delete set null,
  picked_at timestamptz not null default now());
alter table public.quote_library enable row level security;
alter table public.quote_rotation_log enable row level security;
drop policy if exists quote_library_rw on public.quote_library;
create policy quote_library_rw on public.quote_library for all to authenticated
  using (public.has_perm('content.quotes')) with check (public.has_perm('content.quotes'));
drop policy if exists quote_rotation_log_read on public.quote_rotation_log;
create policy quote_rotation_log_read on public.quote_rotation_log for select to authenticated using (public.has_perm('content.quotes'));

-- the quote that would be picked for a given day
create or replace function public.next_daily_quote(p_day date) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select id from public.quote_library
   where active and (pinned_on is null or pinned_on = p_day)
   order by (pinned_on = p_day) desc nulls last, last_shown_on nulls first, times_shown, random()
   limit 1
$$;

-- Put a quote up for today. p_quote = null → the next one in line. p_force → replace today's.
create or replace function public.rotate_daily_quote(p_quote uuid default null, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare today date := (now() at time zone 'America/New_York')::date; q record; chosen uuid;
begin
  if auth.uid() is not null and not public.has_perm('content.quotes') then raise exception 'You don''t have permission to change the daily quote.'; end if;
  if not p_force and p_quote is null and exists (select 1 from public.quote_rotation_log where shown_on = today) then
    return jsonb_build_object('changed', false, 'reason', 'already picked today');
  end if;
  chosen := coalesce(p_quote, public.next_daily_quote(today));
  if chosen is null then return jsonb_build_object('changed', false, 'reason', 'no quotes in the library'); end if;
  select * into q from public.quote_library where id = chosen;
  update public.weekly_picks set active = false where kind = 'quote' and active;
  insert into public.weekly_picks (kind, active, body, author, audience_tags, updated_by) values ('quote', true, q.body, q.author, '{}', auth.uid());
  update public.quote_library set times_shown = times_shown + 1, last_shown_on = today where id = chosen;
  insert into public.quote_rotation_log (shown_on, quote_id, picked_by) values (today, chosen, auth.uid())
  on conflict (shown_on) do update set quote_id = excluded.quote_id, picked_by = excluded.picked_by, picked_at = now();
  return jsonb_build_object('changed', true, 'quote_id', chosen, 'body', q.body, 'author', q.author);
end $$;
grant execute on function public.rotate_daily_quote(uuid, boolean), public.next_daily_quote(date) to authenticated;

-- every morning ~5 AM Eastern
select cron.unschedule(jobid) from cron.job where jobname = 'daily-quote-rotate';
select cron.schedule('daily-quote-rotate', '5 9 * * *', $$select public.rotate_daily_quote(null, false)$$);

-- ---------- weekly_picks: let the new checkboxes manage quotes / spotlights ----------
drop policy if exists weekly_picks_content_ins on public.weekly_picks;
create policy weekly_picks_content_ins on public.weekly_picks for insert to authenticated
  with check ((kind = 'quote' and public.has_perm('content.quotes')) or (kind = 'spotlight' and public.has_perm('content.spotlight')));
drop policy if exists weekly_picks_content_upd on public.weekly_picks;
create policy weekly_picks_content_upd on public.weekly_picks for update to authenticated
  using ((kind = 'quote' and public.has_perm('content.quotes')) or (kind = 'spotlight' and public.has_perm('content.spotlight')))
  with check ((kind = 'quote' and public.has_perm('content.quotes')) or (kind = 'spotlight' and public.has_perm('content.spotlight')));
drop policy if exists weekly_picks_content_sel on public.weekly_picks;
create policy weekly_picks_content_sel on public.weekly_picks for select to authenticated
  using ((kind = 'quote' and public.has_perm('content.quotes')) or (kind = 'spotlight' and public.has_perm('content.spotlight')));
