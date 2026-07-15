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
  'service_performance_scorecard.view_personal_scorecard': ['agent', 'admin'],
  'service_performance_scorecard.view_all_scorecards': ['asc', 'certification', 'quality', 'marketing', 'admin'],
  'service_performance_scorecard.edit_scorecard': ['admin'],
  'chat.all': ['admin'],
  'chat.invited_channels_dms_only': ['agent', 'support', 'certification', 'quality', 'marketing', 'sales', 'admin'],
  'chat.create_channels': ['admin'],
  'chat.create_dms': ['asc', 'certification', 'quality', 'marketing', 'admin'],
  'hiring.all': ['certification', 'admin'],
  'hiring.view_stage_only': ['marketing', 'admin'],
  // Sales page isn't on the roles sheet — left as-is.
  'sales.all': ['marketing', 'admin'],
  'sales.view_only': ['marketing', 'admin'],
  'certifications.all': ['certification', 'admin'],
  'certifications.builder': ['certification', 'admin'],
  'certifications.assigned_to_complete': ['agent', 'asc', 'support', 'quality', 'marketing', 'sales', 'admin'],
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
  'schedule.accept_and_release_intervals_on_an_assigned_schedule': ['agent', 'asc', 'support', 'quality', 'marketing', 'sales', 'admin'],
  'schedule.ability_to_assign_agents_to_schedules': ['certification', 'admin'],
  'schedule.view_my_schedule': ['agent', 'asc', 'support', 'quality', 'marketing', 'sales', 'admin'],
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
