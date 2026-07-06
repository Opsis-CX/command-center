// ============================================================
// PROJECTS MODULE — shared helpers
// Ported from the standalone Opsis project-management app.
// Pure functions used across all project sub-views.
// ============================================================

export const PROJECT_COLORS = ['#2563EB','#7C3AED','#DC2626','#D97706','#16A34A','#0891B2','#DB2777','#EA580C','#65A30D','#0F766E']
export const AVATAR_COLORS  = ['#2563EB','#7C3AED','#DC2626','#D97706','#16A34A','#0891B2','#DB2777','#EA580C','#059669','#7C2D12']

export const STATUSES = [
  { key: 'todo', label: 'To do' },
  { key: 'inprogress', label: 'In progress' },
  { key: 'review', label: 'In review' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
]

export const PRIORITIES = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'critical', label: 'Critical' },
]

export function statusLabel(s) {
  return (STATUSES.find(x => x.key === s) || {}).label || s
}

export function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function stripHtml(html) {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

export function initials(fullName) {
  return (fullName || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// due-date classification for a task
export function dueCls(t) {
  if (!t.due_date || t.status === 'done') return 'ok'
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const dt = new Date(t.due_date + 'T00:00:00')
  if (dt < now) return 'overdue'
  if (dt <= new Date(now.getTime() + 2 * 86400000)) return 'soon'
  return 'ok'
}

export function dueLabel(t) {
  if (!t.due_date) return 'No due date'
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const dt = new Date(t.due_date + 'T00:00:00')
  const diff = Math.round((dt - now) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff <= 7) return `In ${diff}d`
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: dt.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

export function formatCommentTime(iso) {
  const d = new Date(iso)
  const diffMin = Math.round((Date.now() - d) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDuration(minutes) {
  return (minutes / 60).toFixed(2)
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// colors used by the status/priority badges (maps to inline styles since this
// module keeps its own palette rather than the command-center CSS vars)
export const STATUS_COLORS = {
  todo:       { bg: '#EFEEEA', fg: '#6B6860', dot: '#C8C5BB' },
  inprogress: { bg: '#EFF6FF', fg: '#1D4ED8', dot: '#2563EB' },
  review:     { bg: '#F5F3FF', fg: '#6D28D9', dot: '#7C3AED' },
  blocked:    { bg: '#FEF2F2', fg: '#B91C1C', dot: '#DC2626' },
  done:       { bg: '#F0FDF4', fg: '#15803D', dot: '#16A34A' },
}

export const PRIORITY_COLORS = {
  low:      { bg: '#F0FDF4', fg: '#15803D' },
  medium:   { bg: '#FFFBEB', fg: '#B45309' },
  high:     { bg: '#FFFBEB', fg: '#B91C1C' },
  critical: { bg: '#FEF2F2', fg: '#B91C1C' },
}

export const DUE_COLORS = {
  ok: '#16A34A', soon: '#D97706', overdue: '#DC2626', none: '#A09D96',
}
