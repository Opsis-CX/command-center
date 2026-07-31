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
  const { isAdmin, appRole, isClientPortal, user } = useAuth()
  const userId = user?.id || null
  // The task timer is for coordinators — everyone who isn't a plain agent (or an
  // external client). Roles can be comma-separated (e.g. "asc,marketing"), so we
  // treat someone as support if ANY of their roles is a non-agent role. This is
  // decoupled from the admin flag on purpose: locking admin down to a few people
  // must not strip coordinators (ASC/Support/Quality/Marketing/Certification) of
  // their timer.
  const _roles = String(appRole || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
  const isSupport = !isClientPortal && (isAdmin || _roles.some(r => r && r !== 'agent'))

  const [tasks, setTasks] = useState([])
  const [assignees, setAssignees] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [claims, setClaims] = useState([])
  const [blocks, setBlocks] = useState([])
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [picked, setPicked] = useState('')
  // Type-in-a-new-task-to-track
  const [newTaskName, setNewTaskName] = useState('')
  const [newProject, setNewProject] = useState('')
  const [newClient, setNewClient] = useState('')
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    if (!userId) return
    const [taskRes, taRes, timeRes, clmRes, blkRes, projRes, cliRes] = await Promise.all([
      supabase.from('tasks').select('id, name, status').is('deleted_at', null),
      supabase.from('task_assignees').select('task_id, profile_id').eq('profile_id', userId),
      supabase.from('time_entries').select('id, task_id, user_id, started_at, ended_at').eq('user_id', userId),
      supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at, checked_out_at').eq('profile_id', userId),
      supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role'),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('clients').select('id, name').order('name'),
    ])
    setTasks(taskRes.data || [])
    setAssignees(taRes.data || [])
    setTimeEntries(timeRes.data || [])
    setClaims(clmRes.data || [])
    setBlocks(blkRes.data || [])
    setProjects(projRes.data || [])
    setClients(cliRes.data || [])
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
    let taskId = picked
    const typed = newTaskName.trim()
    // Typed a new task name — create it (with the chosen project/client), assign it
    // to me, then track time on it.
    if (typed) {
      const id = crypto.randomUUID()
      const { error } = await supabase.from('tasks').insert({
        id, name: typed, status: 'todo',
        project_id: newProject || null, client_id: newClient || null,
        created_by: userId,
      })
      if (error) { window.alert('Could not create task: ' + error.message); return }
      await supabase.from('task_assignees').insert({ task_id: id, profile_id: userId })
      taskId = id
    }
    if (!taskId) return
    if (runningEntry) await stopRunning()
    await supabase.from('time_entries').insert({ task_id: taskId, user_id: userId, client_id: (typed ? (newClient || null) : null), started_at: new Date().toISOString(), is_manual: false })
    setPicked(''); setNewTaskName(''); setNewProject(''); setNewClient(''); load()
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
  const selStyle = { fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line, #ddd)', maxWidth: 140 }

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
          <div style={{ ...chip, flexWrap: 'wrap' }}>
            <input value={newTaskName} onChange={e => setNewTaskName(e.target.value)} placeholder="Type a task to track…"
              onKeyDown={e => { if (e.key === 'Enter' && (newTaskName.trim() || picked)) startTimer() }}
              style={{ fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line, #ddd)', width: 160 }} />
            <select value={newProject} onChange={e => setNewProject(e.target.value)} title="Project" style={selStyle}>
              <option value="">Project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={newClient} onChange={e => setNewClient(e.target.value)} title="Client" style={selStyle}>
              <option value="">Client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>or</span>
            <select value={picked} onChange={e => setPicked(e.target.value)} title="Existing task" style={{ ...selStyle, maxWidth: 170 }}>
              <option value="">Existing task…</option>
              {openTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button disabled={!newTaskName.trim() && !picked} onClick={startTimer}
              style={{ border: 'none', background: (newTaskName.trim() || picked) ? '#16A34A' : '#c3bfb5', color: '#fff', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, cursor: (newTaskName.trim() || picked) ? 'pointer' : 'default' }}>▶ Start</button>
          </div>
        )
      )}
    </div>
  )
}
