// Permissions matrix — generated from the Command Center Roles sheet.
// Each key is page or page.capability; value lists which roles have it.
// Roles: agent, asc (Agent Support Coordinator), support, certification, marketing, admin

export const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'asc', label: 'Agent Support Coordinator' },
  { key: 'support', label: 'Support' },
  { key: 'certification', label: 'Certification' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'agent', label: 'Agent' },
]

// For each permission, the set of roles that have it.
const MATRIX = {
  'dashboard': ['asc', 'support', 'certification', 'marketing', 'admin'],
  'weekly_sync': ['asc', 'certification', 'marketing', 'admin'],
  'service_performance_scorecard': ['agent'],
  'service_performance_scorecard.view_personal_scorecard': ['agent', 'admin'],
  'service_performance_scorecard.view_all_scorecards': ['asc', 'certification', 'marketing', 'admin'],
  'service_performance_scorecard.edit_scorecard': ['admin'],
  'chat.all': ['admin'],
  'chat.invited_channels_dms_only': ['agent', 'support', 'certification', 'marketing', 'admin'],
  'chat.create_channels': ['asc', 'certification', 'marketing', 'admin'],
  'chat.create_dms': ['asc', 'certification', 'marketing', 'admin'],
  'hiring.all': ['certification', 'marketing', 'admin'],
  'hiring.view_stage_only': ['asc', 'admin'],
  'certifications.all': ['certification', 'admin'],
  'certifications.builder': ['certification', 'admin'],
  'certifications.assigned_to_complete': ['agent', 'asc', 'support', 'admin'],
  'certifications.view_personal_score_and_content_assigned': ['agent', 'asc', 'support', 'admin'],
  'certifications.view_content_and_scores_only_of_agents': ['asc', 'marketing', 'admin'],
  'schedule.all': ['admin'],
  'schedule.create_schedules': ['admin'],
  'schedule.view_only_projects_assigned_to': ['asc', 'admin'],
  'schedule.ability_to_assign_intervals_to_agents': ['asc', 'admin'],
  'schedule.accept_and_release_intervals_on_an_assigned_schedule': ['agent', 'asc', 'support', 'admin'],
  'schedule.ability_to_assign_agents_to_schedules': ['certification', 'marketing', 'admin'],
  'schedule.view_my_schedule': ['agent', 'asc', 'support', 'admin'],
  'reporting': ['asc', 'certification', 'marketing', 'admin'],
  'people_and_tags.view_only': ['asc', 'admin'],
  'people_and_tags.edit': ['certification', 'marketing', 'admin'],
  'clients.view_only': ['asc', 'certification', 'marketing', 'admin'],
  'clients.edit': ['admin'],
  'positions.view_only': ['asc', 'certification', 'marketing', 'admin'],
  'positions.edit': ['admin'],
  'project_management.all': ['admin'],
  'project_management.create_projects': ['certification', 'marketing', 'admin'],
  'project_management.add_tasks_to_projects_assigned_to': ['asc', 'support', 'certification', 'marketing', 'admin'],
}

// can(role, "schedule.create_schedules") -> boolean
export function can(role, perm) {
  const allowed = MATRIX[perm]
  if (!allowed) return false
  return allowed.includes(role)
}

// Convenience: does this role have ANY capability under a page prefix?
// Used for nav gating (show the page if they can do anything on it).
export function canAny(role, pagePrefix) {
  return Object.keys(MATRIX).some(k => (k === pagePrefix || k.startsWith(pagePrefix + ".")) && MATRIX[k].includes(role))
}

export const ALL_PERMS = Object.keys(MATRIX)
