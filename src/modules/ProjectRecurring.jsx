import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { Avatar } from './projectBits'
import { PRIORITIES } from './projectHelpers'

// ============================================================
// RECURRING TASKS — list of templates + create/edit modal.
// Auto-generation itself is handled by the DB function
// generate_recurring_tasks (already running); this manages templates.
// ============================================================

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function describe(r) {
  if (r.frequency === 'daily') return 'Daily'
  if (r.frequency === 'weekly') return `Weekly · ${DAY_LABELS[r.weekly_day]}`
  if (r.frequency === 'custom_days') {
    const sel = (r.custom_days || []).slice().sort().map(d => DAY_LABELS[d])
    return sel.length ? sel.join('/') : 'Custom (no days set)'
  }
  if (r.frequency === 'monthly') return `Monthly · day ${r.monthly_day}`
  if (r.frequency === 'yearly') return `Yearly · ${MONTHS[r.yearly_month - 1]} ${r.yearly_day}`
  return r.frequency
}

export default function ProjectRecurring() {
  const { recurring, projects, clients, profiles } = useProjectsData()
  const [modalId, setModalId] = useState(undefined) // undefined=closed, null=new, id=edit

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Recurring Tasks</h2>
          <p className="page-sub" style={{ marginTop: 2, maxWidth: 620 }}>
            These automatically create a new task on their schedule — daily, weekly, monthly, or yearly — even if nobody opens the app that day.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalId(null)}>+ New recurring task</button>
      </div>

      {recurring.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>No recurring tasks yet</h3>
          <p style={{ fontSize: 13 }}>Set one up to automatically create a task on a schedule.</p>
        </div>
      ) : recurring.map(r => {
        const proj = projects.find(p => p.id === r.project_id)
        const cl = clients.find(c => c.id === r.client_id)
        const names = (r.assignee_ids || []).map(id => profiles.find(p => p.id === id)?.full_name?.split(' ')[0]).filter(Boolean).join(', ')
        return (
          <div key={r.id} className="card" style={{ padding: '16px 18px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, opacity: r.is_active ? 1 : 0.55 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-bg)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{describe(r)}</span>
                {!r.is_active && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-soft, #eee)', color: 'var(--ink-soft)' }}>Paused</span>}
                {proj && <span>{proj.name}</span>}
                {cl && <span>{cl.name}</span>}
                {names && <span>Assigned: {names}</span>}
                {r.last_generated_date
                  ? <span>Last created: {new Date(r.last_generated_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  : <span>Not yet generated</span>}
              </div>
            </div>
            <button onClick={() => setModalId(r.id)} title="Edit"
              style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 14, flexShrink: 0 }}>✎</button>
          </div>
        )
      })}

      {modalId !== undefined && (
        <RecurringModal recurringId={modalId} onClose={() => setModalId(undefined)} />
      )}
    </div>
  )
}

function RecurringModal({ recurringId, onClose }) {
  const { recurring, projects, clients, profiles, userId, refresh } = useProjectsData()
  const existing = recurringId ? recurring.find(r => r.id === recurringId) : null

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [clientId, setClientId] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueOffset, setDueOffset] = useState(0)
  const [frequency, setFrequency] = useState('daily')
  const [weeklyDay, setWeeklyDay] = useState(1)
  const [customDays, setCustomDays] = useState([])
  const [monthlyDay, setMonthlyDay] = useState(1)
  const [yearlyMonth, setYearlyMonth] = useState(1)
  const [yearlyDay, setYearlyDay] = useState(1)
  const [notes, setNotes] = useState('')
  const [assignees, setAssignees] = useState([])
  const [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (existing) {
      setName(existing.name || '')
      setProjectId(existing.project_id || '')
      setClientId(existing.client_id || '')
      setPriority(existing.priority || 'medium')
      setDueOffset(existing.due_offset_days ?? 0)
      setFrequency(existing.frequency || 'daily')
      setWeeklyDay(existing.weekly_day ?? 1)
      setCustomDays(existing.custom_days || [])
      setMonthlyDay(existing.monthly_day ?? 1)
      setYearlyMonth(existing.yearly_month ?? 1)
      setYearlyDay(existing.yearly_day ?? 1)
      setNotes(existing.notes || '')
      setAssignees(existing.assignee_ids || [])
      setActive(existing.is_active)
    }
  }, [recurringId]) // eslint-disable-line

  function toggleCustomDay(d) {
    setCustomDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }
  function toggleAssignee(pid) {
    setAssignees(prev => prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid])
  }

  async function save() {
    if (!name.trim()) { window.alert('Add a task name'); return }
    if (frequency === 'custom_days' && !customDays.length) { window.alert('Pick at least one day'); return }
    setBusy(true)
    const data = {
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
      is_active: active,
      created_by: userId,
    }
    if (recurringId) {
      const { error } = await supabase.from('recurring_tasks').update(data).eq('id', recurringId)
      if (error) { window.alert('Error: ' + error.message); setBusy(false); return }
    } else {
      const { error } = await supabase.from('recurring_tasks').insert({ id: crypto.randomUUID(), ...data })
      if (error) { window.alert('Error: ' + error.message); setBusy(false); return }
    }
    setBusy(false); await refresh(); onClose()
  }

  async function del() {
    if (!recurringId || !window.confirm('Delete this recurring task? Already-created tasks stay, but no new ones will be generated.')) return
    await supabase.from('recurring_tasks').delete().eq('id', recurringId)
    await refresh(); onClose()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, pointerEvents: 'none' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 580, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.2)', pointerEvents: 'auto' }}>
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{recurringId ? 'Edit recurring task' : 'New recurring task'}</div>
            <button onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--ink-soft)' }}>✕</button>
          </div>

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Grp label="Task name *">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Weekly status report" style={inp} autoFocus />
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
              <Grp label="Priority">
                <select value={priority} onChange={e => setPriority(e.target.value)} style={inp}>
                  {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </Grp>
              <Grp label="Due (days after creation)">
                <input type="number" min="0" value={dueOffset} onChange={e => setDueOffset(e.target.value)} style={inp} />
              </Grp>
            </Row>

            <Grp label="Repeats">
              <select value={frequency} onChange={e => setFrequency(e.target.value)} style={inp}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (one day)</option>
                <option value="custom_days">Custom (specific days of the week)</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Grp>

            {frequency === 'weekly' && (
              <Grp label="Day of the week">
                <select value={weeklyDay} onChange={e => setWeeklyDay(e.target.value)} style={inp}>
                  {DAY_LABELS.map((d, i) => <option key={i} value={i}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}</option>)}
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
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>Click to toggle each day (e.g. Mon–Fri for "every weekday").</div>
              </Grp>
            )}

            {frequency === 'monthly' && (
              <Grp label="Day of the month">
                <input type="number" min="1" max="31" value={monthlyDay} onChange={e => setMonthlyDay(e.target.value)} style={inp} />
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>If a month is shorter (e.g. day 31 in Feb), it runs on that month's last day.</div>
              </Grp>
            )}

            {frequency === 'yearly' && (
              <Row>
                <Grp label="Month">
                  <select value={yearlyMonth} onChange={e => setYearlyMonth(e.target.value)} style={inp}>
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{['January','February','March','April','May','June','July','August','September','October','November','December'][i]}</option>)}
                  </select>
                </Grp>
                <Grp label="Day">
                  <input type="number" min="1" max="31" value={yearlyDay} onChange={e => setYearlyDay(e.target.value)} style={inp} />
                </Grp>
              </Row>
            )}

            <Grp label="Assign to">
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
                {profiles.map(p => {
                  const sel = assignees.includes(p.id)
                  return (
                    <div key={p.id} onClick={() => toggleAssignee(p.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', background: sel ? 'var(--accent-bg)' : 'transparent' }}>
                      <span style={{ width: 18, height: 18, borderRadius: 4, border: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: 11 }}>{sel ? '✓' : ''}</span>
                      <Avatar profile={p} size={26} />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{p.full_name}</span>
                    </div>
                  )
                })}
              </div>
            </Grp>

            <Grp label="Notes (optional)">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Details to include on every generated task" style={{ ...inp, minHeight: 70, resize: 'vertical' }} />
            </Grp>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              Active (uncheck to pause without deleting)
            </label>
          </div>

          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            {recurringId && <button onClick={del} className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--failed)' }}>Delete</button>}
            <button onClick={onClose} className="btn btn-ghost">Cancel</button>
            <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </>
  )
}

const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: '100%', background: 'var(--surface)', color: 'var(--ink)' }
function Grp({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>{label}</label>{children}</div>
}
function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{children}</div>
}
