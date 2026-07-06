import { stripHtml, statusLabel, formatDuration } from './projectHelpers'

// ============================================================
// CSV export helpers for the Projects module.
// buildTaskRows/exportTasks etc. take the loaded data arrays
// (passed in) so they stay pure and reusable.
// ============================================================

function csvEscape(val) {
  if (val === null || val === undefined) return ''
  const s = String(val).replace(/"/g, '""')
  return /[",\n]/.test(s) ? `"${s}"` : s
}

export function downloadCSV(filename, rows) {
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const today = () => new Date().toISOString().slice(0, 10)

function assigneeNames(taskId, taskAssignees, profiles) {
  return taskAssignees.filter(a => a.task_id === taskId)
    .map(a => profiles.find(p => p.id === a.profile_id)?.full_name)
    .filter(Boolean).join('; ')
}
function loggedHours(taskId, timeEntries) {
  const mins = timeEntries.filter(e => e.task_id === taskId && e.duration_minutes).reduce((s, e) => s + e.duration_minutes, 0)
  return formatDuration(mins)
}

// Dashboard export — a list of tasks (already filtered by the caller)
export function exportTasks(tasks, { projects, clients, profiles, taskAssignees, timeEntries }) {
  const header = ['Task', 'Project', 'Client', 'Status', 'Priority', 'Due Date', 'Assigned To', 'Time Tracked (hrs)', 'Notes', 'Created']
  const rows = tasks.map(t => {
    const proj = projects.find(p => p.id === t.project_id)
    const cl = clients.find(c => c.id === t.client_id)
    return [t.name, proj?.name || '', cl?.name || '', statusLabel(t.status), t.priority || '', t.due_date || '',
      assigneeNames(t.id, taskAssignees, profiles), loggedHours(t.id, timeEntries), stripHtml(t.notes),
      t.created_at ? new Date(t.created_at).toLocaleDateString() : '']
  })
  downloadCSV(`tasks-export-${today()}.csv`, [header, ...rows])
}

// Single-project export
export function exportProject(project, allTasks, ctx) {
  const tasks = allTasks.filter(t => t.project_id === project.id)
  const { clients, profiles, taskAssignees, timeEntries } = ctx
  const header = ['Task', 'Client', 'Status', 'Priority', 'Due Date', 'Assigned To', 'Time Tracked (hrs)', 'Notes']
  const rows = tasks.map(t => {
    const cl = clients.find(c => c.id === t.client_id)
    return [t.name, cl?.name || '', statusLabel(t.status), t.priority || '', t.due_date || '',
      assigneeNames(t.id, taskAssignees, profiles), loggedHours(t.id, timeEntries), stripHtml(t.notes)]
  })
  const safe = (project.name || 'project').replace(/[^a-z0-9]/gi, '-')
  downloadCSV(`${safe}-export-${today()}.csv`, [header, ...rows])
}

// My Day export — the current user's open assigned tasks, bucketed
export function exportMyDay(myTasks, personName, ctx) {
  const { projects, clients, profiles, taskAssignees, timeEntries } = ctx
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const header = ['Task', 'Project', 'Client', 'Bucket', 'Status', 'Priority', 'Due Date', 'Time Tracked (hrs)', 'Notes']
  const rows = [...myTasks].sort((a, b) => {
    const ad = a.due_date ? new Date(a.due_date) : new Date('2999-01-01')
    const bd = b.due_date ? new Date(b.due_date) : new Date('2999-01-01')
    return ad - bd
  }).map(t => {
    const proj = projects.find(p => p.id === t.project_id)
    const cl = clients.find(c => c.id === t.client_id)
    let bucket = 'No due date'
    if (t.due_date) {
      const dt = new Date(t.due_date + 'T00:00:00')
      if (dt < now) bucket = 'Overdue'
      else if (dt.toDateString() === now.toDateString()) bucket = 'Due today'
      else bucket = 'Upcoming'
    }
    return [t.name, proj?.name || '', cl?.name || '', bucket, statusLabel(t.status), t.priority || '', t.due_date || '',
      loggedHours(t.id, timeEntries), stripHtml(t.notes)]
  })
  const safe = (personName || 'my-day').replace(/[^a-z0-9]/gi, '-')
  downloadCSV(`${safe}-tasks-${today()}.csv`, [header, ...rows])
}
