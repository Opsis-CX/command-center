import React, { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// LIVE STATUS — who's on right now.
// Joins schedule check-ins (shift_claims) with live task timers
// (time_entries) so admins see the whole team and agents see
// themselves. Three states per person:
//   • green  — checked in (task + live elapsed if a timer runs)
//   • amber  — checked in, no running timer ("Checked in — no task")
//   • red    — scheduled for an interval happening NOW, not checked in
//
// TIME CONVENTION: interval times are Eastern, matching Schedule.jsx.
// Timers count in real elapsed time from time_entries.started_at.
//
// Refresh: realtime + a 20s poll fallback (same pattern as Schedule.jsx),
// plus a 1s local tick so running timers count up smoothly between loads.
// ============================================================

const POLL_MS = 20000

function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// Live H:MM:SS elapsed since an ISO timestamp (same shape as TimeTracking.jsx).
function elapsed(startedAt) {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const h = String(Math.floor(diff / 3600)).padStart(2, '0')
  const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0')
  const s = String(diff % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function initials(name) {
  const p = (name || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
function avatarColor(name) {
  const colors = ['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']
  let h = 0; for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}

// Is a shift block happening right now, in Eastern Time?
// block_date is a plain YYYY-MM-DD; start/end are HH:MM(:SS) with no tz.
function intervalIsNow(block, now) {
  if (block.block_date !== isoDate(now)) return false
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = block.start_time.slice(0, 5).split(':').map(Number)
  const [eh, em] = block.end_time.slice(0, 5).split(':').map(Number)
  return (sh * 60 + sm) <= nowMin && nowMin < (eh * 60 + em)
}

export default function LiveStatus() {
  const { isAdmin } = useAuth()
  const [userId, setUserId] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [blocks, setBlocks] = useState([])
  const [claims, setClaims] = useState([])
  const [running, setRunning] = useState([])   // open time_entries (ended_at null)
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [, forceTick] = useState(0)
  const tickRef = useRef(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      setUserId(user?.id || null)
      const [profRes, blkRes, clmRes, runRes, taskRes, projRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name'),
        supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role, schedule_id'),
        supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at'),
        // a running timer = started but not ended
        supabase.from('time_entries').select('id, user_id, task_id, started_at').is('ended_at', null),
        supabase.from('tasks').select('id, name, project_id'),
        supabase.from('projects').select('id, name'),
      ])
      setProfiles(profRes.data || [])
      setBlocks(blkRes.data || [])
      setClaims(clmRes.data || [])
      setRunning(runRes.data || [])
      setTasks(taskRes.data || [])
      setProjects(projRes.data || [])
    } finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const checkOut = useCallback(async (claimId) => {
    if (!claimId) return
    await supabase.from('shift_claims').update({ checked_out_at: new Date().toISOString(), status: 'completed' }).eq('id', claimId)
    load(true)
  }, [load])

  // realtime + polling fallback (matches Schedule.jsx)
  useEffect(() => {
    const ch = supabase.channel('livestatus')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_claims' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => load(true))
      .subscribe()
    const t = setInterval(() => load(true), POLL_MS)
    return () => { supabase.removeChannel(ch); clearInterval(t) }
  }, [load])

  // 1s local tick so running timers count up between loads
  useEffect(() => {
    tickRef.current = setInterval(() => forceTick(t => t + 1), 1000)
    return () => clearInterval(tickRef.current)
  }, [])

  if (loading) return <div className="card"><div className="page-sub" style={{ padding: 8 }}>Loading live status…</div></div>

  const now = etNow()
  const runningByUser = {}
  for (const r of running) runningByUser[r.user_id] = r   // one timer per user by design

  // Build one row per relevant person.
  // Relevant = checked in today, OR running a timer, OR scheduled for an
  // interval happening right now (even if not checked in — that's the red case).
  const claimById = {}
  for (const c of claims) claimById[c.id] = c

  // person -> the interval they're scheduled for right now (if any)
  const nowIntervalByPerson = {}
  for (const c of claims) {
    const b = blocks.find(x => x.id === c.shift_block_id)
    if (b && intervalIsNow(b, now)) nowIntervalByPerson[c.profile_id] = { block: b, claim: c }
  }

  // person -> are they checked in for a now-or-today interval?
  const checkedInByPerson = {}
  for (const c of claims) {
    if (c.checked_in_at && c.status === 'checked_in') {
      const b = blocks.find(x => x.id === c.shift_block_id)
      if (b && b.block_date === isoDate(now)) checkedInByPerson[c.profile_id] = { block: b, claim: c }
    }
  }

  const relevantIds = new Set([
    ...Object.keys(checkedInByPerson),
    ...Object.keys(runningByUser),
    ...Object.keys(nowIntervalByPerson),
  ])

  let rows = [...relevantIds].map(pid => {
    const profile = profiles.find(p => p.id === pid)
    const timer = runningByUser[pid] || null
    const task = timer ? tasks.find(t => t.id === timer.task_id) : null
    const project = task ? projects.find(pr => pr.id === task.project_id) : null
    const checkedIn = checkedInByPerson[pid] || null
    const scheduledNow = nowIntervalByPerson[pid] || null

    // state resolution
    let state, detail
    if (checkedIn || timer) {
      if (timer && task) {
        state = 'active'
        detail = { taskName: task.name, projectName: project?.name || null, startedAt: timer.started_at }
      } else {
        state = 'idle'   // checked in, no running timer
        detail = null
      }
    } else if (scheduledNow) {
      state = 'absent'   // scheduled now, not checked in
      detail = null
    } else {
      state = 'idle'; detail = null
    }

    const interval = checkedIn?.block || scheduledNow?.block || null
    const claimId = checkedIn?.claim?.id || null
    return { pid, name: profile?.full_name || 'Unknown', state, detail, interval, claimId }
  })

  // Agents only see themselves.
  if (!isAdmin) rows = rows.filter(r => r.pid === userId)

  // Sort: active first, then idle, then absent; alpha within each.
  const order = { active: 0, idle: 1, absent: 2 }
  rows.sort((a, b) => (order[a.state] - order[b.state]) || a.name.localeCompare(b.name))

  const onCount = rows.filter(r => r.state === 'active' || r.state === 'idle').length
  const absentCount = rows.filter(r => r.state === 'absent').length

  if (!rows.length) {
    return (
      <div className="card">
        <div className="page-sub" style={{ padding: 12, textAlign: 'center' }}>
          {isAdmin ? 'Nobody is checked in or tracking time right now.' : "You're not checked in or tracking time right now."}
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--passed)', opacity: .35, animation: 'ls-ping 1.8s cubic-bezier(0,0,.2,1) infinite' }} />
          <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: 'var(--passed)' }} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{onCount} on now</span>
        {isAdmin && absentCount > 0 && (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--failed)' }}>· {absentCount} scheduled, not here</span>
        )}
      </div>

      <div>
        {rows.map((r, i) => (
          <StatusRow key={r.pid} row={r} last={i === rows.length - 1} isAdmin={isAdmin} onCheckOut={checkOut} />
        ))}
      </div>

      <style>{`
        @keyframes ls-ping { 75%,100% { transform: scale(2.4); opacity: 0 } }
      `}</style>
    </div>
  )
}

function StatusRow({ row, last, isAdmin, onCheckOut }) {
  const dot = { active: 'var(--passed)', idle: 'var(--needed)', absent: 'var(--failed)' }[row.state]
  const bg = {
    active: 'var(--passed-bg)', idle: 'var(--needed-bg)', absent: 'var(--failed-bg)',
  }[row.state]
  // admin can check out anyone who's checked in (active or idle) and has a claim
  const canCheckOut = isAdmin && row.claimId && (row.state === 'active' || row.state === 'idle')

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 16px', fontSize: 13,
      borderBottom: last ? 'none' : '1px solid var(--line-soft)',
    }}>
      {/* status dot */}
      <span title={row.state} style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0 }} />

      {/* avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, width: 190 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarColor(row.name), color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          {initials(row.name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
          {row.interval && (
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
              {formatTime(row.interval.start_time)}–{formatTime(row.interval.end_time)}{row.interval.role ? ` · ${row.interval.role}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* task / state detail */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {row.state === 'active' ? (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.detail.taskName}</div>
            {row.detail.projectName && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{row.detail.projectName}</div>}
          </div>
        ) : row.state === 'idle' ? (
          <span style={{ fontSize: 12.5, color: 'var(--needed)', fontWeight: 600 }}>Checked in — no task</span>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--failed)', fontWeight: 600 }}>Scheduled — not checked in</span>
        )}
      </div>

      {/* right: live elapsed or status pill */}
      <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 10 }}>
        {row.state === 'active' ? (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 14, color: 'var(--passed)' }}>
            {elapsed(row.detail.startedAt)}
          </span>
        ) : (
          <span className="badge" style={{ background: bg, color: dot }}>
            {row.state === 'idle' ? 'Idle' : 'Absent'}
          </span>
        )}
        {canCheckOut && (
          <button onClick={() => onCheckOut(row.claimId)} title="Check this person out"
            style={{ border: '1px solid var(--line)', background: 'var(--canvas)', borderRadius: 6, padding: '4px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
            Check out
          </button>
        )}
      </div>
    </div>
  )
}
