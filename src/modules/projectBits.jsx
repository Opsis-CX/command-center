import React from 'react'
import { STATUS_COLORS, PRIORITY_COLORS, DUE_COLORS, STATUSES, statusLabel, initials, dueCls, dueLabel, AVATAR_COLORS } from './projectHelpers'

// ============================================================
// Shared presentational bits for the Projects module:
// status badge, priority badge, due label, avatar stack.
// ============================================================

export function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.todo
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }} />
      {statusLabel(status)}
    </span>
  )
}

// clickable status dropdown (used in tables) — calls onChange(newStatus)
export function StatusSelect({ status, onChange }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.todo
  return (
    <select value={status} onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
      style={{ appearance: 'none', border: 0, borderRadius: 20, padding: '3px 8px', fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg, cursor: 'pointer', fontFamily: 'inherit', outline: 'none' }}>
      {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  )
}

export function PriorityBadge({ priority, small }) {
  const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
  return (
    <span style={{ display: 'inline-block', padding: small ? '1px 5px' : '2px 7px', borderRadius: 4, fontSize: small ? 10 : 11, fontWeight: 600, background: c.bg, color: c.fg }}>
      {priority || 'medium'}
    </span>
  )
}

export function DueLabel({ task, small }) {
  const cls = dueCls(task)
  const color = DUE_COLORS[cls] || DUE_COLORS.none
  return (
    <span style={{ fontSize: small ? 11 : 12, fontWeight: cls === 'overdue' ? 600 : 500, color, whiteSpace: 'nowrap' }}>
      {dueLabel(task)}
    </span>
  )
}

export function Avatar({ profile, size = 24 }) {
  if (!profile) return null
  const color = profile.color || AVATAR_COLORS[0]
  return (
    <span title={profile.full_name}
      style={{ width: size, height: size, borderRadius: '50%', background: color + '22', color, fontSize: Math.round(size * 0.37), fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials(profile.full_name)}
    </span>
  )
}

export function AvatarStack({ ids, profiles, size = 24 }) {
  const shown = ids.slice(0, 3)
  const extra = ids.length > 3 ? ids.length - 3 : 0
  return (
    <div style={{ display: 'flex' }}>
      {shown.map((id, i) => {
        const p = profiles.find(x => x.id === id)
        if (!p) return null
        return (
          <span key={id} title={p.full_name}
            style={{ width: size, height: size, borderRadius: '50%', background: (p.color || AVATAR_COLORS[0]) + '22', color: p.color || AVATAR_COLORS[0], fontSize: Math.round(size * 0.37), fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)', marginLeft: i === 0 ? 0 : -6, flexShrink: 0 }}>
            {initials(p.full_name)}
          </span>
        )
      })}
      {extra > 0 && (
        <span style={{ width: size, height: size, borderRadius: '50%', background: 'var(--bg-soft, #eee)', color: 'var(--ink-soft)', fontSize: Math.round(size * 0.37), fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)', marginLeft: -6 }}>
          +{extra}
        </span>
      )}
    </div>
  )
}

// Shared search input for the project sub-views (My Day, Kanban, Projects).
export function SearchBox({ value, onChange, placeholder = 'Search…', style }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--ink-soft)', pointerEvents: 'none' }}>🔍</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 30px 8px 30px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)' }} />
      {value && (
        <button onClick={() => onChange('')} title="Clear"
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: 4 }}>✕</button>
      )}
    </div>
  )
}
