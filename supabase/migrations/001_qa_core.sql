-- ============================================================
-- QUALITY AUDIT — core schema
-- Moves QA off the Google Form into the Command Center, native.
--
-- Layers:
--   qa_questions  — the scorecard definition (data-driven form)
--   qa_audits     — one row per completed audit (replaces the Form)
--   sc_quality    — converted from a seeded TABLE to a VIEW that
--                   rolls audits up per agent_name, feeding the
--                   existing sc_scorecard view unchanged.
--
-- The QA call FEED (which calls need auditing) is still supplied by
-- BigQuery and lands in qa_call_queue; only the SCORING moves native.
--
-- Auto-fail policy: an auto-failed audit forces clean_qa_score = 0
-- for that call (matching the "Clean QA Score" concept) AND is kept
-- as a separate boolean so auto-fails can be counted independently.
-- To change this, see clean_qa_score handling in the app + the view.
-- ============================================================

-- ---------- 1. QUESTION DEFINITIONS ----------
create table if not exists public.qa_questions (
  id            uuid primary key default gen_random_uuid(),
  audit_type    text    not null,             -- conversation | voicemail | no_answer | disposition
  sort_order    int     not null default 0,
  label         text    not null,
  points        numeric not null default 0,   -- weight toward the 100-pt clean score
  is_auto_fail  boolean not null default false, -- missing this question auto-fails the call
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Seed: Conversation - Lavin Leads (100 points, exact weights from the tracker)
insert into public.qa_questions (audit_type, sort_order, label, points) values
  ('conversation', 1,  'Did the agent place the outbound call within the approved calling window?', 10),
  ('conversation', 2,  'Did the agent confidently open the call and state the purpose?', 8),
  ('conversation', 3,  'Did the agent confirm installation vs repair?', 5),
  ('conversation', 4,  'If repair: did the agent properly transfer the call?', 7),
  ('conversation', 5,  'Did the agent verify they are speaking with the homeowner?', 8),
  ('conversation', 6,  'Did the agent verify customer phone number and email?', 10),
  ('conversation', 7,  'Did the agent guide the call toward booking using rebuttals?', 13),
  ('conversation', 8,  'Did the agent avoid discussing pricing?', 5),
  ('conversation', 9,  'Agent professionalism', 8),
  ('conversation', 10, 'Did the agent set expectations for next steps?', 8),
  ('conversation', 11, 'Did the agent properly close the call?', 8),
  ('conversation', 12, 'Did the agent document the call accurately?', 10);

-- Seed: Voicemail audit (pass/fail style — points sum to 100 across the checks)
insert into public.qa_questions (audit_type, sort_order, label, points) values
  ('voicemail', 1, 'Was a voicemail left when one was warranted?', 50),
  ('voicemail', 2, 'Was the correct disposition applied?', 50);

-- Seed: No Answer / Missed audit
insert into public.qa_questions (audit_type, sort_order, label, points) values
  ('no_answer', 1, 'Was the no-answer / missed-call policy followed?', 50),
  ('no_answer', 2, 'Was the correct disposition applied?', 50);

-- Seed: Disposition Correction audit (documentation-only; scored by correctness)
insert into public.qa_questions (audit_type, sort_order, label, points) values
  ('disposition', 1, 'Does the current disposition match the correct disposition?', 100);


-- ---------- 2. AUDIT SUBMISSIONS ----------
create table if not exists public.qa_audits (
  id                  uuid primary key default gen_random_uuid(),
  agent_name          text not null,                 -- join key to sc_agents / sc_quality
  profile_id          uuid references public.profiles(id),
  auditor_id          uuid references public.profiles(id),
  audit_type          text not null default 'conversation',
  source              text not null default 'manual', -- manual | ai  (AI phase later)
  call_id             text,
  call_date           date,
  recording_link      text,
  brand               text,
  answers             jsonb not null default '{}'::jsonb, -- { question_id: true|false|null }
  earned_points       numeric,
  max_points          numeric,
  clean_qa_score      numeric,                       -- 0-100 (%). Auto-fail => 0.
  auto_fail           boolean not null default false,
  current_disposition text,
  correct_disposition text,
  feedback            text,
  transcript          text,                          -- reserved for the AI phase
  created_at          timestamptz not null default now()
);

create index if not exists qa_audits_agent_idx   on public.qa_audits (agent_name);
create index if not exists qa_audits_created_idx  on public.qa_audits (created_at);
create index if not exists qa_audits_type_idx      on public.qa_audits (audit_type);


-- ---------- 3. CALL QUEUE (BQ-fed) ----------
-- Populated by the BigQuery "QA Call Feed - Hourly" connection.
-- The audit form reads unaudited calls from here.
create table if not exists public.qa_call_queue (
  call_id             text primary key,
  call_date           date,
  recording_link      text,
  agent_name          text,
  agent_email         text,
  brand               text,
  customer_first_name text,
  customer_last_name  text,
  customer_email      text,
  customer_state      text,
  customer_number     text,
  disposition         text,
  source              text,
  synced_at           timestamptz not null default now()
);
create index if not exists qa_call_queue_agent_idx on public.qa_call_queue (agent_name);
create index if not exists qa_call_queue_date_idx   on public.qa_call_queue (call_date);


-- ---------- 4. sc_quality: TABLE -> VIEW over audits ----------
-- The sc_scorecard view LEFT JOINs sc_quality USING (agent_name) and reads:
--   avg_clean_qa_score_last_30_days, avg_clean_qa_score_last_7_days,
--   qa_reviews_last_30_days, qa_reviews_last_7_days, coaching_focus_last_*.
-- We drop the seeded table and recreate it as a view with identical columns,
-- so sc_scorecard keeps working with zero changes.
--
-- Only "conversation" audits carry a 0-100 clean score into the scorecard;
-- the lighter audit types are operational checks, not weighted quality score.

drop table if exists public.sc_quality cascade;

create or replace view public.sc_quality as
with conv as (
  select *
  from public.qa_audits
  where audit_type = 'conversation'
),
w30 as (
  select agent_name,
         round(avg(clean_qa_score) / 100.0, 4) as avg_clean_qa_score_last_30_days,
         count(*)                              as qa_reviews_last_30_days
  from conv
  where created_at >= now() - interval '30 days'
  group by agent_name
),
w7 as (
  select agent_name,
         round(avg(clean_qa_score) / 100.0, 4) as avg_clean_qa_score_last_7_days,
         count(*)                              as qa_reviews_last_7_days
  from conv
  where created_at >= now() - interval '7 days'
  group by agent_name
),
-- coaching focus (30d): the question label missed most often, by weight
miss as (
  select a.agent_name,
         q.label,
         q.points,
         count(*) as misses
  from conv a
  cross join lateral jsonb_each(a.answers) as ans(qid, val)
  join public.qa_questions q on q.id = ans.qid::uuid
  where a.created_at >= now() - interval '30 days'
    and ans.val = 'false'::jsonb
  group by a.agent_name, q.label, q.points
),
focus30 as (
  select distinct on (agent_name)
         agent_name,
         label as coaching_focus_last_30_days
  from miss
  order by agent_name, (misses * points) desc, misses desc
),
miss7 as (
  select a.agent_name, q.label, q.points, count(*) as misses
  from conv a
  cross join lateral jsonb_each(a.answers) as ans(qid, val)
  join public.qa_questions q on q.id = ans.qid::uuid
  where a.created_at >= now() - interval '7 days'
    and ans.val = 'false'::jsonb
  group by a.agent_name, q.label, q.points
),
focus7 as (
  select distinct on (agent_name)
         agent_name,
         label as coaching_focus_last_7_days
  from miss7
  order by agent_name, (misses * points) desc, misses desc
),
agents as (
  select distinct agent_name from conv
)
select
  ag.agent_name,
  w30.avg_clean_qa_score_last_30_days,
  coalesce(w30.qa_reviews_last_30_days, 0) as qa_reviews_last_30_days,
  f30.coaching_focus_last_30_days,
  w7.avg_clean_qa_score_last_7_days,
  coalesce(w7.qa_reviews_last_7_days, 0)   as qa_reviews_last_7_days,
  f7.coaching_focus_last_7_days,
  now() as updated_at
from agents ag
left join w30 on w30.agent_name = ag.agent_name
left join w7  on w7.agent_name  = ag.agent_name
left join focus30 f30 on f30.agent_name = ag.agent_name
left join focus7  f7  on f7.agent_name  = ag.agent_name;


-- ---------- 5. RLS ----------
alter table public.qa_audits     enable row level security;
alter table public.qa_questions  enable row level security;
alter table public.qa_call_queue enable row level security;

-- Helper: is the current user a manager/auditor?
-- Managers = admins + asc/certification/marketing (mirrors app permissions).
create or replace function public.is_qa_auditor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true
           or lower(coalesce(p.role,'')) in ('asc','certification','marketing','admin'))
  );
$$;

-- questions: everyone signed in can read; only auditors can modify
drop policy if exists qa_questions_read on public.qa_questions;
create policy qa_questions_read on public.qa_questions
  for select using (auth.uid() is not null);
drop policy if exists qa_questions_write on public.qa_questions;
create policy qa_questions_write on public.qa_questions
  for all using (public.is_qa_auditor()) with check (public.is_qa_auditor());

-- audits: auditors see/insert/update all; agents can read only their own
drop policy if exists qa_audits_auditor_all on public.qa_audits;
create policy qa_audits_auditor_all on public.qa_audits
  for all using (public.is_qa_auditor()) with check (public.is_qa_auditor());

drop policy if exists qa_audits_agent_read on public.qa_audits;
create policy qa_audits_agent_read on public.qa_audits
  for select using (
    profile_id = auth.uid()
    or agent_name in (select agent_name from public.sc_agents where profile_id = auth.uid())
  );

-- call queue: auditors only
drop policy if exists qa_call_queue_auditor on public.qa_call_queue;
create policy qa_call_queue_auditor on public.qa_call_queue
  for all using (public.is_qa_auditor()) with check (public.is_qa_auditor());

-- sc_quality is a view; it inherits base-table RLS. Grant read to authenticated.
grant select on public.sc_quality to authenticated;
grant select on public.qa_questions to authenticated;
grant select, insert, update on public.qa_audits to authenticated;
grant select, insert, update, delete on public.qa_call_queue to authenticated;
