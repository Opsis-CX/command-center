import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { Avatar } from './projectBits'
import { statusLabel, STATUSES, PRIORITIES, stripHtml } from './projectHelpers'
import { notifyTaskAssigned, notifyTaskAdded, notifyTaskCompleted } from '../lib/notify'

// ============================================================
// TASK MODAL — create a new task or edit an existing one.
// Fields: name, project, client, status, priority, due, assignees, notes.
// Attachments / Drive link come with the attachments stage.
// Props:
//   taskId        - id to edit, or null to create
//   defaultStatus - preselect a status (from Kanban column)
//   defaultProject- preselect a project (from grouped "+ Add task")
//   onClose(saved)- called after close; saved=true triggers refresh
// ============================================================

export default function TaskModal({ taskId, defaultStatus, defaultProject, onClose }) {
  const {
    tasks, projects, clients, profiles, taskAssignees, projectMembers, userId, me,
    logActivity, refresh,
  } = useProjectsData()

  const existing = taskId ? tasks.find(t => t.id === taskId) : null

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('todo')
  const [priority, setPriority] = useState('medium')
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  const [assignees, setAssignees] = useState([])
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState(false)

  // Recurring options (offered only when creating a new task)
  const [recurring, setRecurring] = useState(false)
  const [frequency, setFrequency] = useState('weekly')
  const [weeklyDay, setWeeklyDay] = useState(1)
  const [customDays, setCustomDays] = useState([])
  const [monthlyDay, setMonthlyDay] = useState(1)
  const [yearlyMonth, setYearlyMonth] = useState(1)
  const [yearlyDay, setYearlyDay] = useState(1)
  const [dueOffset, setDueOffset] = useState(0)
  const toggleCustomDay = (d) => setCustomDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])

  useEffect(() => {
    if (existing) {
      setName(existing.name || '')
      setProjectId(existing.project_id || '')
      setClientId(existing.client_id || '')
      setStatus(existing.status || 'todo')
      setPriority(existing.priority || 'medium')
      setDue(existing.due_date || '')
      setNotes(stripHtml(existing.notes) || '')
      setAssignees(taskAssignees.filter(a => a.task_id === taskId).map(a => a.profile_id))
    } else {
      setStatus(defaultStatus || 'todo')
      setProjectId(defaultProject || '')
    }
  }, [taskId]) // eslint-disable-line

  function toggleAssignee(pid) {
    setAssignees(prev => prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid])
  }

  async function save() {
    if (!name.trim()) { setNameError(true); return }
    if (recurring && frequency === 'custom_days' && !customDays.length) { window.alert('Pick at least one day for the recurring task.'); return }

    // Build a recurring_tasks definition from the current fields.
    const recurringPayload = () => ({
      id: crypto.randomUUID(),
      name: name.trim(),
      project_id: projectId || null,
      client_id: clientId || null,
      priority,
      due_offset_days: parseInt(dueOffset, 10) || 0,
      frequency,
      weekly_day: frequency === 'weekly' ? parseInt(weeklyDay, 10) : null,
      custom_days: frequency === 'custom_days' ? [...customDays].sort() : null,
      monthly_day: frequency === 'monthly' ? parseInt(monthlyDay, 10) : null,
      yearly_month: frequency === 'yearly' ? parseInt(yearlyMonth, 10) : null,
      yearly_day: frequency === 'yearly' ? parseInt(yearlyDay, 10) : null,
      notes: notes.trim() || null,
      assignee_ids: assignees,
      is_active: true,
      created_by: userId,
    })

    // NEW task + recurring: create only the recurring definition (no one-off task);
    // the scheduled generator then creates the actual task instances.
    if (!taskId && recurring) {
      setBusy(true)
      const { error } = await supabase.from('recurring_tasks').insert(recurringPayload())
      if (error) { window.alert('Could not create recurring task: ' + error.message); setBusy(false); return }
      setBusy(false); await refresh(); onClose(true); return
    }

    setBusy(true)
    const notesHtml = notes.trim()
      ? notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      : null
    const taskData = {
      name: name.trim(),
      status, priority,
      project_id: projectId || null,
      client_id: clientId || null,
      due_date: due || null,
      notes: notesHtml,
      created_by: userId,
    }

    let id = taskId
    const prevStatus = existing?.status
    const prevAssignees = taskId ? taskAssignees.filter(a => a.task_id === taskId).map(a => a.profile_id) : []

    if (taskId) {
      const { error } = await supabase.from('tasks').update(taskData).eq('id', taskId)
      if (error) { setBusy(false); return }
    } else {
      id = crypto.randomUUID()
      const { error } = await supabase.from('tasks').insert({ id, ...taskData })
      if (error) { setBusy(false); return }
    }

    // sync assignees
    await supabase.from('task_assignees').delete().eq('task_id', id)
    if (assignees.length) {
      await supabase.from('task_assignees').insert(assignees.map(pid => ({ task_id: id, profile_id: pid })))
    }

    // activity logging
    const proj = projects.find(p => p.id === (projectId || null))
    const newlyAssigned = assignees.filter(pid => !prevAssignees.includes(pid))
    if (newlyAssigned.length) {
      const names = newlyAssigned.map(pid => profiles.find(p => p.id === pid)?.full_name).filter(Boolean).join(', ')
      logActivity(taskId ? 'assigned' : 'created_and_assigned', id, taskData.name, taskData.project_id, proj?.name, names ? `Assigned to ${names}` : null)
      notifyTaskAssigned({ recipientIds: newlyAssigned, actorId: userId, actorName: me?.full_name, taskName: taskData.name, projectName: proj?.name, taskId: id })
    }
    // Alert the project's members whenever a NEW task is added to the list
    // (skip the creator and anyone already pinged as an assignee).
    if (!taskId && projectId) {
      const recipients = (projectMembers || [])
        .filter(m => m.project_id === projectId)
        .map(m => m.profile_id)
        .filter(pid => pid !== userId && !newlyAssigned.includes(pid))
      if (recipients.length) {
        notifyTaskAdded({ recipientIds: recipients, actorId: userId, actorName: me?.full_name, taskName: taskData.name, projectName: proj?.name, taskId: id })
      }
    }
    if (!taskId && !newlyAssigned.length) {
      logActivity('created', id, taskData.name, taskData.project_id, proj?.name)
    } else if (taskId && prevStatus !== status) {
      if (status === 'done') {
        logActivity('completed', id, taskData.name, taskData.project_id, proj?.name)
        if (existing?.created_by) notifyTaskCompleted({ recipientId: existing.created_by, actorId: userId, actorName: me?.full_name, taskName: taskData.name, projectName: proj?.name, taskId: id })
      } else {
        logActivity('status_changed', id, taskData.name, taskData.project_id, proj?.name, `Moved to ${statusLabel(status)}`)
      }
    }

    // EXISTING task turned recurring: also create a recurring schedule going forward.
    if (taskId && recurring) {
      const { error } = await supabase.from('recurring_tasks').insert(recurringPayload())
      if (error) window.alert('Task saved, but the recurring schedule could not be created: ' + error.message)
    }

    setBusy(false)
    await refresh()
    onClose(true)
  }

  async function del() {
    if (!taskId || !window.confirm('Delete this task?')) return
    const proj = projects.find(p => p.id === existing?.project_id)
    await supabase.from('tasks').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq('id', taskId)
    logActivity('deleted', taskId, existing?.name, existing?.project_id, proj?.name)
    await refresh()
    onClose(true)
  }

  // Assignee options: exclude agents (they have no project-management access) and
  // deactivated users. Anyone already assigned stays listed so they can be removed.
  const assignable = profiles.filter(p =>
    assignees.includes(p.id) || (p.role !== 'agent' && p.is_active !== false)
  )

  return (
    <>
      <div onClick={() => onClose(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, pointerEvents: 'none' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 580, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.2)', pointerEvents: 'auto' }}>
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{taskId ? 'Edit task' : 'New task'}</div>
            <button onClick={() => onClose(false)} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--ink-soft)' }}>✕</button>
          </div>

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Grp label="Task name *">
              <input value={name} onChange={e => { setName(e.target.value); setNameError(false) }} placeholder="What needs to get done?" autoFocus
                style={{ ...inp, borderColor: nameError ? 'var(--failed)' : 'var(--line)' }} />
            </Grp>

            <Row>
              <Grp label="Project">
                <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inp}>
                  <option value="">— No project —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Grp>
              <Grp label="Client">
                <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
                  <option value="">— No client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Grp>
            </Row>

            <Row>
              <Grp label="Status">
                <select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
                  {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Grp>
              <Grp label="Priority">
                <select value={priority} onChange={e => setPriority(e.target.value)} style={inp}>
                  {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </Grp>
            </Row>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} style={{ width: 16, height: 16 }} />
              🔁 {taskId ? 'Set this up to repeat' : 'Make this a recurring task'}
            </label>
            {taskId && recurring && (
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: -8 }}>Creates a recurring schedule going forward; this task stays as-is.</div>
            )}

            {recurring ? (
              <>
                <Row>
                  <Grp label="Repeats">
                    <select value={frequency} onChange={e => setFrequency(e.target.value)} style={inp}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly (one day)</option>
                      <option value="custom_days">Custom (specific days)</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </Grp>
                  <Grp label="Due (days after it's created)">
                    <input type="number" min="0" value={dueOffset} onChange={e => setDueOffset(e.target.value)} style={inp} />
                  </Grp>
                </Row>

                {frequency === 'weekly' && (
                  <Grp label="Day of the week">
                    <select value={weeklyDay} onChange={e => setWeeklyDay(e.target.value)} style={inp}>
                      {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </Grp>
                )}
                {frequency === 'custom_days' && (
                  <Grp label="Repeats on">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['S','M','T','W','T','F','S'].map((lbl, i) => (
                        <button key={i} type="button" onClick={() => toggleCustomDay(i)}
                          style={{ width: 40, height: 36, borderRadius: 8, border: '1px solid ' + (customDays.includes(i) ? 'var(--accent)' : 'var(--line)'), background: customDays.includes(i) ? 'var(--accent)' : 'var(--surface)', color: customDays.includes(i) ? '#fff' : 'var(--ink-soft)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>Click to toggle each day (e.g. Mon–Fri for every weekday).</div>
                  </Grp>
                )}
                {frequency === 'monthly' && (
                  <Grp label="Day of the month">
                    <input type="number" min="1" max="31" value={monthlyDay} onChange={e => setMonthlyDay(e.target.value)} style={inp} />
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>If a month is shorter, it runs on that month's last day.</div>
                  </Grp>
                )}
                {frequency === 'yearly' && (
                  <Row>
                    <Grp label="Month">
                      <select value={yearlyMonth} onChange={e => setYearlyMonth(e.target.value)} style={inp}>
                        {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                      </select>
                    </Grp>
                    <Grp label="Day">
                      <input type="number" min="1" max="31" value={yearlyDay} onChange={e => setYearlyDay(e.target.value)} style={inp} />
                    </Grp>
                  </Row>
                )}
              </>
            ) : (
              <Grp label="Due date">
                <input type="date" value={due} onChange={e => setDue(e.target.value)} style={inp} />
              </Grp>
            )}

            <Grp label="Assign to">
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
                {assignable.length === 0 ? <div style={{ fontSize: 12, color: 'var(--ink-soft)', padding: 8 }}>No team members yet.</div> :
                  assignable.map(p => {
                    const sel = assignees.includes(p.id)
                    return (
                      <div key={p.id} onClick={() => toggleAssignee(p.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', background: sel ? 'var(--accent-bg)' : 'transparent' }}>
                        <span style={{ width: 18, height: 18, borderRadius: 4, border: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: 11 }}>{sel ? '✓' : ''}</span>
                        <Avatar profile={p} size={26} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{p.full_name}</div>
                          {p.role && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{p.role}</div>}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </Grp>

            <Grp label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes, context, links…"
                style={{ ...inp, minHeight: 80, resize: 'vertical' }} />
            </Grp>
          </div>

          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            {taskId && <button onClick={del} className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--failed)' }}>Delete task</button>}
            <button onClick={() => onClose(false)} className="btn btn-ghost">Cancel</button>
            <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save task'}</button>
          </div>
        </div>
      </div>
    </>
  )
}

const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: '100%', background: 'var(--surface)', color: 'var(--ink)' }

function Grp({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>{label}</label>
      {children}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{children}</div>
}
