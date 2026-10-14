import React, { useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { Avatar } from './projectBits'

// ============================================================
// SUBTASKS — a checklist inside a task (one level only).
// Drops into the task detail panel. Each subtask has a name, a done
// checkbox, and an optional assignee + due date.
//
// - Who can see / change a task's subtasks is decided by the database
//   (they follow the parent task), so there is no permission logic here.
// - Nothing here notifies anyone, and the parent task's status is never
//   changed: it only shows progress ("3 of 5 done").
// - SubtaskProgress is the small "☑ 3/5" badge shown on task cards.
// ============================================================

const labelStyle = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)' }
const fieldStyle = { border: '1px solid var(--line)', borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }
const iconBtn = { border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: '2px 5px' }

const shortDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const todayIso = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local

// Small "☑ 3/5" badge for task cards and rows. Renders nothing if the task has no subtasks.
export function SubtaskProgress({ taskId, small }) {
  const { subtaskCounts } = useProjectsData()
  const c = subtaskCounts?.[taskId]
  if (!c || !c.total) return null
  const all = c.done === c.total
  return (
    <span
      title={`${c.done} of ${c.total} subtasks done`}
      style={{ fontSize: small ? 11 : 12, fontWeight: 500, whiteSpace: 'nowrap', color: all ? 'var(--passed)' : 'var(--ink-soft)' }}
    >
      ☑ {c.done}/{c.total}
    </span>
  )
}

export default function Subtasks({ taskId }) {
  const { subtasks, setSubtasks, profiles, taskAssignees, userId } = useProjectsData()

  const items = useMemo(
    () => subtasks
      .filter(s => s.task_id === taskId)
      .sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || ''))),
    [subtasks, taskId]
  )
  const doneCount = items.filter(s => s.done).length
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editId, setEditId] = useState(null)
  const [edit, setEdit] = useState({ name: '', assignee_id: '', due_date: '' })
  const inputRef = useRef(null)
  const today = todayIso()

  // Who a subtask can be given to: the people on the parent task (they can see it).
  // If nobody is assigned to the task yet, offer all active staff. Agents, clients and
  // client-portal CSR logins never appear (they can't open Project Management).
  const eligible = profiles.filter(p => !['agent', 'client', 'csr'].includes(p.role) && p.is_active !== false)
  const onTask = taskAssignees.filter(a => a.task_id === taskId).map(a => a.profile_id)
  const baseChoices = onTask.length ? eligible.filter(p => onTask.includes(p.id)) : eligible
  const choicesFor = (currentId) => {
    if (currentId && !baseChoices.some(p => p.id === currentId)) {
      const cur = profiles.find(p => p.id === currentId)
      if (cur) return [...baseChoices, cur]
    }
    return baseChoices
  }

  async function add() {
    const name = draft.trim()
    if (!name || busy) return
    setBusy(true); setErr('')
    const sort_order = items.length ? Math.max(...items.map(s => s.sort_order || 0)) + 1 : 0
    const { data, error } = await supabase.from('task_subtasks')
      .insert({ task_id: taskId, name, sort_order, created_by: userId })
      .select().single()
    setBusy(false)
    if (error || !data) { setErr("Couldn't add that subtask. Please try again."); return }
    setSubtasks(prev => [...prev, data])
    setDraft('')
    inputRef.current?.focus()
  }

  async function toggle(s) {
    setErr('')
    const { data, error } = await supabase.from('task_subtasks')
      .update({ done: !s.done }).eq('id', s.id).select().single()
    if (error || !data) { setErr("Couldn't update that subtask. Please try again."); return }
    setSubtasks(prev => prev.map(x => x.id === s.id ? data : x))
  }

  function startEdit(s) {
    setErr('')
    setEditId(s.id)
    setEdit({ name: s.name || '', assignee_id: s.assignee_id || '', due_date: s.due_date || '' })
  }

  async function saveEdit(s) {
    const name = edit.name.trim()
    if (!name) { setErr('A subtask needs a name.'); return }
    const { data, error } = await supabase.from('task_subtasks')
      .update({ name, assignee_id: edit.assignee_id || null, due_date: edit.due_date || null })
      .eq('id', s.id).select().single()
    if (error || !data) { setErr("Couldn't save your changes. Please try again."); return }
    setSubtasks(prev => prev.map(x => x.id === s.id ? data : x))
    setEditId(null); setErr('')
  }

  async function remove(s) {
    if (!window.confirm('Delete this subtask?')) return
    setErr('')
    // .select() so a row the database refused to delete (no access) is noticed instead of silently ignored
    const { data, error } = await supabase.from('task_subtasks').delete().eq('id', s.id).select('id')
    if (error || !data || data.length === 0) { setErr("Couldn't delete that subtask. Please try again."); return }
    setSubtasks(prev => prev.filter(x => x.id !== s.id))
    if (editId === s.id) setEditId(null)
  }

  return (
    <div style={{ marginBottom: 20 }} data-testid="subtasks">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <div style={labelStyle}>Subtasks</div>
        {items.length > 0 && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{doneCount} of {items.length} done</span>}
      </div>

      {items.length > 0 && (
        <div style={{ height: 4, background: 'var(--line)', borderRadius: 2, marginBottom: 6, overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: 'var(--passed)', transition: 'width .2s' }} />
        </div>
      )}

      {items.map(s => {
        if (editId === s.id) {
          return (
            <div key={s.id} style={{ padding: '8px 4px', borderTop: '1px solid var(--line)', background: 'var(--accent-bg)', borderRadius: 6 }}>
              <input
                autoFocus
                value={edit.name}
                onChange={e => setEdit(v => ({ ...v, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(s) } else if (e.key === 'Escape') setEditId(null) }}
                style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box' }}
                aria-label="Subtask name"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <select
                  value={edit.assignee_id}
                  onChange={e => setEdit(v => ({ ...v, assignee_id: e.target.value }))}
                  style={{ ...fieldStyle, fontSize: 12 }}
                  aria-label="Assign to"
                >
                  <option value="">Unassigned</option>
                  {choicesFor(s.assignee_id).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <input
                  type="date"
                  value={edit.due_date}
                  onChange={e => setEdit(v => ({ ...v, due_date: e.target.value }))}
                  style={{ ...fieldStyle, fontSize: 12 }}
                  aria-label="Due date"
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => saveEdit(s)}>Save</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditId(null); setErr('') }}>Cancel</button>
              </div>
            </div>
          )
        }

        const assignee = s.assignee_id ? profiles.find(p => p.id === s.assignee_id) : null
        const overdue = !!s.due_date && !s.done && s.due_date < today
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderTop: '1px solid var(--line)' }}>
            <input
              type="checkbox"
              checked={!!s.done}
              onChange={() => toggle(s)}
              aria-label={`Mark "${s.name}" ${s.done ? 'not done' : 'done'}`}
              style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, wordBreak: 'break-word', textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--ink-soft)' : 'var(--ink)' }}>{s.name}</div>
              {(assignee || s.due_date) && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 2, fontSize: 11, color: 'var(--ink-soft)' }}>
                  {assignee && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Avatar profile={assignee} size={16} />{(assignee.full_name || '').split(' ')[0]}
                    </span>
                  )}
                  {s.due_date && <span style={{ color: overdue ? 'var(--failed)' : undefined, fontWeight: overdue ? 600 : 400 }}>Due {shortDate(s.due_date)}</span>}
                </div>
              )}
            </div>
            <button style={iconBtn} onClick={() => startEdit(s)} title="Edit" aria-label="Edit subtask">✎</button>
            <button style={iconBtn} onClick={() => remove(s)} title="Delete" aria-label="Delete subtask">✕</button>
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: items.length ? 8 : 0 }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add a subtask…"
          style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
          aria-label="Add a subtask"
        />
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={add} disabled={busy || !draft.trim()}>Add</button>
      </div>

      {err && <div role="alert" style={{ fontSize: 12, color: 'var(--failed)', marginTop: 6 }}>{err}</div>}
    </div>
  )
}
