// Permissions matrix — generated from the Command Center Roles sheet (updated Jul 2026).
// Each key is page or page.capability; value lists which roles have it.
// Roles: agent, asc (Agent Support Coordinator), support, certification, quality, marketing, sales, admin
export const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'asc', label: 'Agent Support Coordinator' },
  { key: 'support', label: 'Support' },
  { key: 'certification', label: 'Certification' },
  { key: 'quality', label: 'Quality' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'sales', label: 'Sales' },
  { key: 'agent', label: 'Agent' },
]
// "Everyone except agents and clients." Written ONCE and reused below, so a
// page that follows this rule can never drift out of step with the others.
// The database mirror of this list is public.is_staff(); if you change one,
// change the other. (Clients never appear in ROLES at all - the portal is
// gated separately - so STAFF is simply every role except 'agent'.)
const STAFF = ['asc', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin']

// For each permission, the set of roles that have it.
const MATRIX = {
  'dashboard': ['asc', 'support', 'certification', 'quality', 'marketing', 'admin'],
  'weekly_sync': ['asc', 'certification', 'quality', 'marketing', 'admin'],
  'service_performance_scorecard': ['agent'],
  // Quality Audit isn't on the roles sheet — left as-is. Confirm whether the new
  // "quality" role should be added here (and to is_qa_auditor() in Supabase).
  'quality_audit': ['certification', 'admin'],
  'quality_audit.enter_audits': ['certification', 'admin'],
  'quality_audit.view_own': ['certification', 'admin'],
  // Call QA (AI) and the Quality page. STAFF ONLY — no agent.
  //
  // 2026-08-30: an agent signed in and got the full Call QA portfolio, including
  // the Rubric, Settings and Import tabs. 'agent' had been on this key since it
  // was created, and this ONE key gates four things: the /call-qa route, the
  // /quality route, and both sidebar links. Row security limited the call data
  // they could see to their own, so no other agent's calls leaked — but the page,
  // the rubric and the QA configuration were all reachable.
  //
  // Agents see their own scores on the Scorecard page instead. If they should
  // ever read their own call reviews, that needs its own agent-facing view and
  // its own key — not this one.
  'quality_audit.call_reviews': STAFF,
  'service_performance_scorecard.view_personal_scorecard': ['agent', 'admin'],
  'service_performance_scorecard.view_all_scorecards': ['asc', 'certification', 'quality', 'marketing', 'admin'],
  'service_performance_scorecard.edit_scorecard': ['admin'],
  'chat.all': ['admin'],
  'chat.invited_channels_dms_only': ['agent', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  'chat.create_channels': ['admin'],
  'chat.create_dms': ['asc', 'certification', 'quality', 'marketing', 'admin'],
  'hiring.all': ['certification', 'admin'],
  'hiring.view_stage_only': ['marketing', 'admin'],
  // Sales pipeline: everyone except agents and clients (Becky, 2026-08-30).
  // DB mirror: public.is_staff(), via can_see_sales_pipeline().
  'sales.all': STAFF,
  'sales.view_only': STAFF,
  // Website chat inbox (opsiscx.com). Same audience as Sales, since a website
  // visitor is a prospect. 'web_chat.reply' also includes support so someone can
  // cover chat without seeing the rest of the sales pipeline — drop it if chat
  // should stay purely sales.
  //
  // NOTE: the database gate on web_conversations / web_messages is
  // can_see_sales_pipeline() AND NOT is_portal_client(), the same as deals. If a
  // role is granted 'web_chat' here but excluded by that gate, the page renders
  // and the queries come back empty. Keep the two in step.
  'web_chat.all': ['marketing', 'admin'],
  'web_chat.reply': ['marketing', 'admin', 'support'],
  'certifications.all': ['certification', 'admin'],
  'certifications.builder': ['certification', 'admin'],
  // certification is here so course authors can take (and preview) their own
  // quizzes end-to-end, exactly as an agent would see them.
  'certifications.assigned_to_complete': ['agent', 'asc', 'support', 'quality', 'marketing', 'sales', 'certification', 'admin'],
  'certifications.view_personal_score_and_content_assigned': ['agent', 'asc', 'support', 'quality', 'marketing', 'sales', 'admin'],
  'certifications.view_content_and_scores_only_of_agents': ['asc', 'quality', 'marketing', 'admin'],
  'schedule.all': ['admin'],
  'schedule.create_schedules': ['admin'],
  'schedule.view_only_projects_assigned_to': ['asc', 'quality', 'admin'],
  // Insights limited to schedules the person is assigned to (audience membership).
  'schedule.view_insights_assigned': ['asc', 'admin'],
  // No release times or rolling-window lock: schedules/intervals on their
  // assigned schedules are ALWAYS fully available. Only agents are locked
  // to the 14-day rolling release window (and cert-gated).
  'schedule.no_release_times': ['asc', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  'schedule.ability_to_assign_intervals_to_agents': ['asc', 'admin'],
  'schedule.accept_and_release_intervals_on_an_assigned_schedule': ['agent', 'asc', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  'schedule.ability_to_assign_agents_to_schedules': ['certification', 'admin'],
  'schedule.view_my_schedule': ['agent', 'asc', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  // Not on the roles sheet — left as-is.
  'schedule.view_all_schedules': ['certification', 'admin'],
  'reporting': ['asc', 'certification', 'quality', 'marketing', 'admin'],
  'people_and_tags.view_only': ['asc', 'quality', 'admin'],
  'people_and_tags.edit': ['certification', 'admin'],
  // Deleting a tag is destructive (it can affect certification assignments), so
  // it's kept strictly at the admin level.
  'people_and_tags.delete': ['admin'],
  'clients.view_only': ['certification', 'quality', 'marketing', 'admin'],
  'clients.edit': ['admin'],
  'positions.view_only': ['admin'],
  'positions.edit': ['admin'],
  'project_management.all': ['admin'],
  'project_management.create_projects': ['certification', 'quality', 'marketing', 'admin'],
  'project_management.add_tasks_to_projects_assigned_to': ['asc', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  // Tokens / rewards — every employee has a wallet and can redeem; awarding is
  // budget-limited to managers (enforced in Tokens.jsx + SECURITY DEFINER RPCs),
  // and the Awards Log (ledger) is manager-only.
  'tokens': ['agent', 'asc', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  'tokens.ledger': ['asc', 'certification', 'quality', 'marketing', 'admin'],
  // Coaching — agents book sessions with their ASC; ASCs/admins manage. (Agent
  // vs ASC vs admin behavior is decided inside Coaching.jsx by role.)
  // quality = read-only "All sessions" oversight view inside Coaching.jsx.
  'coaching': ['agent', 'asc', 'quality', 'admin'],
  // Meetings (notetaker captures + summaries) — all staff EXCEPT agents; clients
  // never see the sidebar at all. Row visibility inside is governed by RLS.
  'meetings': ['asc', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  // Who's On (live check-ins + team presence) — everyone EXCEPT agents, support
  // (and clients, who have no sidebar). Also read by LiveStatus.jsx internally.
  'live_status': ['asc', 'certification', 'quality', 'marketing', 'sales', 'admin'],
}
// can(role, "schedule.create_schedules") -> boolean
export function can(role, perm) {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'admin') return true            // admin always passes
  const allowed = MATRIX[perm]
  if (!allowed) return false
  return allowed.includes(r)
}
// Convenience: does this role have ANY capability under a page prefix?
// Used for nav gating (show the page if they can do anything on it).
export function canAny(role, pagePrefix) {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'admin') return true
  return Object.keys(MATRIX).some(k => (k === pagePrefix || k.startsWith(pagePrefix + ".")) && MATRIX[k].includes(r))
}
export const ALL_PERMS = Object.keys(MATRIX)
