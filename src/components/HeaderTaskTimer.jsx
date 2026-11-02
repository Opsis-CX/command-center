import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { canAny } from '../lib/permissions'
import useDismiss from '../lib/useDismiss'
import { TimerIcon, CaretIcon, PlayIcon, PencilIcon } from './HeaderIcons'

// ============================================================
// TASK TIMER (top "work" bar, 2026-11-02)
// Idle: a compact "Start task ▾" button. Open it to describe the task (or pick an existing one), choose a project and
// client, and press Start. Running: a compact pill with the task name, the running timer, Stop, and a ▾ that opens the
// task's details. Separate from shift check-in/out (HeaderShiftControls); neither depends on the other.
// Who gets it: the same people as before: everyone except plain agents and external clients.
// ============================================================

function Elapsed({ startedAt }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [])
  const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const pad = n => String(n).padStart(2, '0')
  return <span className="wb-elapsed" aria-label="Time on this task">{`${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`}</span>
}

export default function HeaderTaskTimer() {
  const { isAdmin, appRole, isClientPortal, user } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id || null
  // The task timer is for coordinators: everyone who isn't a plain agent (or an external client). Roles can be
  // comma-separated (e.g. "asc,marketing"), so someone counts as support if ANY role is a non-agent role. Decoupled from
  // the admin flag on purpose, so locking admin down never strips coordinators of their timer.
  const roles = String(appRole || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
  const isSupport = !isClientPortal && (isAdmin || roles.some(r => r && r !== 'agent'))
  const canEditTasks = canAny(appRole, 'project_management')

  const [tasks, setTasks] = useState([])
  const [assignees, setAssignees] = useState([])
  const [running, setRunning] = useState(null)       // the open time entry, if any
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [names, setNames] = useState({})             // names looked up for a running task's client when it is hidden from the pick-list
  const [open, setOpen] = useState(null)             // null | 'start' | 'details'
  const [pos, setPos] = useState(null)               // fixed placement on small screens
  const [form, setForm] = useState({ name: '', project: '', client: '', picked: '' })
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)
  const nameRef = useRef(null)

  const load = useCallback(async () => {
    if (!userId || !isSupport) return
    const [taskRes, taRes, timeRes, projRes, cliRes] = await Promise.all([
      fetchAllRows(() => supabase.from('tasks').select('id, name, status, project_id, client_id').is('deleted_at', null).order('id')),
      supabase.from('task_assignees').select('task_id, profile_id').eq('profile_id', userId),
      // only the open entry matters here (the running timer), not a person's whole history
      supabase.from('time_entries').select('id, task_id, user_id, client_id, started_at, ended_at').eq('user_id', userId).is('ended_at', null),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('clients').select('id, name').eq('show_in_tasks', true).order('name'),
    ])
    // a failed read keeps what we already had, so a blip never hides a running timer
    if (!taskRes.error) setTasks(taskRes.data || [])
    if (!taRes.error) setAssignees(taRes.data || [])
    if (!timeRes.error) setRunning((timeRes.data || []).find(e => e.started_at && !e.ended_at) || null)
    if (!projRes.error) setProjects(projRes.data || [])
    if (!cliRes.error) setClients(cliRes.data || [])
  }, [userId, isSupport])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = () => load()           // header ↻ button: re-read quietly, leave any open form and the timer alone
    window.addEventListener('cc:refresh', h)
    return () => window.removeEventListener('cc:refresh', h)
  }, [load])

  const close = useCallback(() => setOpen(null), [])
  useDismiss(wrapRef, !!open, close)
  useEffect(() => { if (open === 'start' && nameRef.current) nameRef.current.focus() }, [open])
  // on phones the panel sits under the bar, full width
  useEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      if (window.innerWidth > 640 || !wrapRef.current) return setPos(null)
      const r = wrapRef.current.getBoundingClientRect()
      setPos({ position: 'fixed', top: Math.round(r.bottom + 8), left: 12, right: 12, width: 'auto' })
    }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  const runningTask = running ? (tasks.find(t => t.id === running.task_id) || null) : null
  const clientId = runningTask?.client_id || running?.client_id || null
  const clientName = clientId ? ((clients.find(c => c.id === clientId) || {}).name || names[clientId] || '') : ''
  const projectName = runningTask?.project_id ? ((projects.find(p => p.id === runningTask.project_id) || {}).name || '') : ''
  // a client hidden from the task pick-list can still be the client of a running task: look its name up
  useEffect(() => {
    if (!clientId || clientName || names[clientId] !== undefined) return
    let alive = true
    supabase.from('clients').select('name').eq('id', clientId).maybeSingle()
      .then(({ data }) => { if (alive) setNames(n => ({ ...n, [clientId]: (data && data.name) || '' })) })
    return () => { alive = false }
  }, [clientId, clientName, names])

  if (!userId || !isSupport) return null

  const myTaskIds = new Set(assignees.map(a => a.task_id))
  const openTasks = tasks.filter(t => t.status !== 'done' && myTaskIds.has(t.id))
  const typed = form.name.trim()
  const canStart = !!(form.picked || typed)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function stopRunning() {
    if (!running) return
    const endedAt = new Date()
    const mins = Math.max(1, Math.round((endedAt - new Date(running.started_at)) / 60000))
    await supabase.from('time_entries').update({ ended_at: endedAt.toISOString(), duration_minutes: mins }).eq('id', running.id)
    setOpen(null); load()
  }

  async function startTimer() {
    if (busy || !canStart) return
    setBusy(true)
    try {
      let taskId = form.picked
      // An existing task wins. Otherwise a typed description becomes a new task (with the chosen project/client),
      // assigned to me, and time is tracked on it.
      if (!taskId) {
        const id = crypto.randomUUID()
        const { error } = await supabase.from('tasks').insert({ id, name: typed, status: 'todo', project_id: form.project || null, client_id: form.client || null, created_by: userId })
        if (error) { window.alert('Could not create task: ' + error.message); return }
        await supabase.from('task_assignees').insert({ task_id: id, profile_id: userId })
        taskId = id
      }
      if (running) await stopRunning()
      await supabase.from('time_entries').insert({ task_id: taskId, user_id: userId, client_id: (!form.picked ? (form.client || null) : null), started_at: new Date().toISOString(), is_manual: false })
      setForm({ name: '', project: '', client: '', picked: '' })
      setOpen(null)
      await load()
    } finally { setBusy(false) }
  }

  const panelStyle = pos || undefined

  return (
    <div ref={wrapRef} className="wb-task">
      {!running ? (
        <>
          <button type="button" className="wb-btn wb-start" onClick={() => setOpen(o => o === 'start' ? null : 'start')} aria-haspopup="dialog" aria-expanded={open === 'start'} title="Start a task timer">
            <TimerIcon /> <span>Start task</span> <CaretIcon />
          </button>
          {open === 'start' && (
            <div className="hd-pop hd-pop-start" role="dialog" aria-label="Start a task" style={panelStyle}
              onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON' && canStart) { e.preventDefault(); startTimer() } }}>
              <div className="hd-pop-title">Start a Task</div>
              <div className="hd-field">
                <label htmlFor="tt-name">What are you working on?</label>
                <input id="tt-name" ref={nameRef} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Describe the task…" disabled={!!form.picked} maxLength={200} />
              </div>
              <div className="hd-row2">
                <div className="hd-field">
                  <label htmlFor="tt-project">Project</label>
                  <select id="tt-project" value={form.project} onChange={e => set('project', e.target.value)} disabled={!!form.picked}>
                    <option value="">Select project…</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="hd-field">
                  <label htmlFor="tt-client">Client</label>
                  <select id="tt-client" value={form.client} onChange={e => set('client', e.target.value)} disabled={!!form.picked}>
                    <option value="">Select client…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="hd-field">
                <label htmlFor="tt-existing">Existing task <span className="hd-opt">(optional)</span></label>
                <select id="tt-existing" value={form.picked} onChange={e => set('picked', e.target.value)}>
                  <option value="">Select a task…</option>
                  {openTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {form.picked && <div className="hd-hint">Tracking time on this task. Its description, project and client stay as they are.</div>}
              </div>
              <div className="hd-actions">
                <button type="button" className="btn btn-primary hd-startbtn" onClick={startTimer} disabled={!canStart || busy}><PlayIcon /> Start</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="wb-running" role="group" aria-label="Running task">
            <span className="wb-dot" aria-hidden="true" />
            <span className="wb-taskname" title={runningTask ? runningTask.name : 'Task in progress'}>{runningTask ? runningTask.name : 'Task in progress'}</span>
            <Elapsed startedAt={running.started_at} />
            <button type="button" className="wb-stop" onClick={stopRunning} title="Stop the timer">Stop</button>
            <button type="button" className="wb-caret" onClick={() => setOpen(o => o === 'details' ? null : 'details')} aria-haspopup="dialog" aria-expanded={open === 'details'} aria-label="Task details" title="Task details"><CaretIcon /></button>
          </div>
          {open === 'details' && (
            <div className="hd-pop hd-pop-details" role="dialog" aria-label="Task details" style={panelStyle}>
              <div className="hd-pop-title">Task Details</div>
              <dl className="hd-dl">
                <dt>Task</dt><dd>{runningTask ? runningTask.name : 'Task in progress'}</dd>
                <dt>Client</dt><dd>{clientName || '—'}</dd>
                <dt>Project</dt><dd>{projectName || '—'}</dd>
              </dl>
              {runningTask && canEditTasks && (
                <button type="button" className="hd-link" onClick={() => { setOpen(null); navigate(`/projects?task=${encodeURIComponent(runningTask.id)}`) }}><PencilIcon /> Edit task…</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
