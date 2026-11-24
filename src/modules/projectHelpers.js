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
  todo:       { bg: 'light-dark(#EFEEEA, #222c31)', fg: 'light-dark(#6B6860, #b3c1c7)', dot: '#C8C5BB' },
  inprogress: { bg: 'light-dark(#EFF6FF, #1b2327)', fg: 'light-dark(#1D4ED8, #7090eb)', dot: '#2563EB' },
  review:     { bg: 'light-dark(#F5F3FF, #1a1339)', fg: 'light-dark(#6D28D9, #a87fe8)', dot: '#7C3AED' },
  blocked:    { bg: 'light-dark(#FEF2F2, #391313)', fg: 'light-dark(#B91C1C, #e86464)', dot: '#DC2626' },
  done:       { bg: 'light-dark(#F0FDF4, #13391f)', fg: 'light-dark(#15803D, #20c55e)', dot: '#16A34A' },
}

export const PRIORITY_COLORS = {
  low:      { bg: 'light-dark(#F0FDF4, #13391f)', fg: 'light-dark(#15803D, #20c55e)' },
  medium:   { bg: 'light-dark(#FFFBEB, #393213)', fg: 'light-dark(#B45309, #e07524)' },
  high:     { bg: 'light-dark(#FFFBEB, #393213)', fg: 'light-dark(#B91C1C, #e86464)' },
  critical: { bg: 'light-dark(#FEF2F2, #391313)', fg: 'light-dark(#B91C1C, #e86464)' },
}

export const DUE_COLORS = {
  ok: '#16A34A', soon: '#D97706', overdue: '#DC2626', none: '#A09D96',
}

// Extract @mentioned profiles from HTML (mention spans) or plain text.
// Returns array of profile ids that match names found after '@'.
export function extractMentionedIds(htmlOrText, profiles) {
  if (!htmlOrText) return []
  const text = stripHtml(htmlOrText)
  const matches = text.match(/@([A-Za-z]+(?:\s[A-Za-z]+)?)/g) || []
  const names = matches.map(m => m.slice(1).trim().toLowerCase())
  const ids = []
  for (const name of names) {
    const p = profiles.find(x => {
      const full = x.full_name.toLowerCase()
      return full === name || full.startsWith(name) || full.split(' ')[0] === name
    })
    if (p && !ids.includes(p.id)) ids.push(p.id)
  }
  return ids
}
