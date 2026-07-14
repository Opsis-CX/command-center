import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { COMPANY_TZ, companyTimeToInstant } from '../lib/tz'

// interpret a company-zone wall time (date + "HH:MM") as a true instant (robust)
function companyInstant(dateStr, timeStr) {
  return companyTimeToInstant(dateStr, (timeStr || '00:00').slice(0, 5))
}

// Persistent control in the app's top header.
// - Non-agents ("support"/admins): task timer (pick a task, start/stop, live counter).
// - Everyone: check in / check out when they have an interval active right now.
// Mirrors the Schedule module's check-in/out and the project tool's time tracking.

function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
const GRACE_MIN = 15

export default function HeaderTaskBar() {
  const { isAdmin, user } = useAuth()
  const userId = user?.id || null
  const isSupport = isAdmin   // everyone who isn't an agent is treated as support

  const [tasks, setTasks] = useState([])
  const [assignees, setAssignees] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [claims, setClaims] = useState([])
  const [blocks, setBlocks] = useState([])
  const [picked, setPicked] = useState('')
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    if (!userId) return
    const [taskRes, taRes, timeRes, clmRes, blkRes] = await Promise.all([
      supabase.from('tasks').select('id, name, status').is('deleted_at', null),
      supabase.from('task_assignees').select('task_id, profile_id').eq('profile_id', userId),
      supabase.from('time_entries').select('id, task_id, user_id, started_at, ended_at').eq('user_id', userId),
      supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at, checked_out_at').eq('profile_id', userId),
      supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role'),
    ])
    setTasks(taskRes.data || [])
    setAssignees(taRes.data || [])
    setTimeEntries(timeRes.data || [])
    setClaims(clmRes.data || [])
    setBlocks(blkRes.data || [])
  }, [userId])

  useEffect(() => { load() }, [load])

  // live ticking while a timer runs
  const runningEntry = timeEntries.find(e => e.started_at && !e.ended_at)
  useEffect(() => {
    if (!runningEntry) return
    const t = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [runningEntry])

  if (!userId) return null

  // ---------- check in / out: find an interval active right now ----------
  const myTaskIds = new Set(assignees.map(a => a.task_id))
  const now = new Date()   // real instant; compare against company-tz instants
  const activeClaim = claims.map(c => ({ c, b: blocks.find(b => b.id === c.shift_block_id) }))
    .filter(({ c, b }) => {
      if (!b || c.status === 'no_show' || c.checked_out_at) return false
      const start = companyInstant(b.block_date, b.start_time)
      const end = companyInstant(b.block_date, b.end_time)
      return now >= new Date(start.getTime() - GRACE_MIN * 60000) && now <= new Date(end.getTime() + GRACE_MIN * 60000)
    })[0]

  async function checkIn() {
    if (!activeClaim) return
    await supabase.from('shift_claims').update({ checked_in_at: new Date().toISOString(), status: 'checked_in' }).eq('id', activeClaim.c.id)
    load()
  }
  async function checkOut() {
    if (!activeClaim) return
    const b = activeClaim.b
    const end = companyInstant(b.block_date, b.end_time)
    const outOfWindow = Math.abs((new Date() - end) / 60000) > GRACE_MIN
    let note = ''
    if (outOfWindow) { note = window.prompt("You're outside your scheduled time. Add a note (required):") || ''; if (!note.trim()) return }
    const payload = { checked_out_at: new Date().toISOString(), status: outOfWindow ? 'pending_review' : 'completed' }
    if (note.trim()) payload.checkout_note = note.trim()
    await supabase.from('shift_claims').update(payload).eq('id', activeClaim.c.id)
    load()
  }

  // ---------- task timer (support only) ----------
  const openTasks = tasks.filter(t => t.status !== 'done' && myTaskIds.has(t.id))
  const runningTask = runningEntry ? tasks.find(t => t.id === runningEntry.task_id) : null

  async function startTimer() {
    const t = openTasks.find(x => x.id === picked)
    if (!t) return
    if (runningEntry) await stopRunning()
    await supabase.from('time_entries').insert({ task_id: t.id, user_id: userId, started_at: new Date().toISOString(), is_manual: false })
    setPicked(''); load()
  }
  async function stopRunning() {
    if (!runningEntry) return
    const endedAt = new Date()
    const mins = Math.max(1, Math.round((endedAt - new Date(runningEntry.started_at)) / 60000))
    await supabase.from('time_entries').update({ ended_at: endedAt.toISOString(), duration_minutes: mins }).eq('id', runningEntry.id)
    load()
  }

  const elapsed = () => {
    if (!runningEntry) return ''
    const s = Math.floor((Date.now() - new Date(runningEntry.started_at).getTime()) / 1000)
    const pad = n => String(n).padStart(2, '0')
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  }

  const chip = { display: 'flex', alignItems: 'center', gap: 8 }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      {/* Check in / out — shown for everyone when an interval is active now */}
      {activeClaim && (
        !activeClaim.c.checked_in_at ? (
          <button onClick={checkIn} style={{ border: 'none', background: '#16A34A', color: '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            I'm here — check in
          </button>
        ) : (
          <div style={chip}>
            <span style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>✓ Checked in</span>
            <button onClick={checkOut} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer' }}>Check out</button>
          </div>
        )
      )}

      {/* Task timer — support/admins only */}
      {isSupport && (
        runningTask ? (
          <div style={{ ...chip, background: 'rgba(22,163,74,.08)', border: '1px solid #16A34A', borderRadius: 8, padding: '5px 10px' }}>
            <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 700 }}>●</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{runningTask.name}</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#16A34A' }}>{elapsed()}</span>
            <button onClick={stopRunning} style={{ border: 'none', background: '#DC2626', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>Stop</button>
          </div>
        ) : (
          <div style={chip}>
            <select value={picked} onChange={e => setPicked(e.target.value)}
              style={{ fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line, #ddd)', maxWidth: 200 }}>
              <option value="">Start a task timer…</option>
              {openTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button disabled={!picked} onClick={startTimer}
              style={{ border: 'none', background: picked ? '#16A34A' : '#c3bfb5', color: '#fff', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, cursor: picked ? 'pointer' : 'default' }}>▶ Start</button>
          </div>
        )
      )}
    </div>
  )
}
