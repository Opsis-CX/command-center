import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { StatusBadge, PriorityBadge, Avatar } from './projectBits'
import { esc, stripHtml, statusLabel, initials, formatCommentTime, AVATAR_COLORS, STATUSES, PRIORITIES, extractMentionedIds } from './projectHelpers'
import { notifyTaskAssigned, notifyTaskCompleted, notifyTaskMention } from '../lib/notify'
import TimeTracking from './TimeTracking'
import Attachments from './Attachments'
import RichTextEditor from './RichTextEditor'

// ============================================================
// TASK DETAIL PANEL — slides in from the right.
// Core features: inline edit (status/priority/due/client),
// assignee add/remove, notes, comments.
// Time tracking, attachments, @mentions arrive in later stages.
// ============================================================

export default function TaskDetail({ taskId, onClose, onEdit }) {
  const {
    tasks, projects, clients, profiles, taskAssignees, comments, userId, me,
    setTasks, setTaskAssignees, setComments, logActivity, refresh,
  } = useProjectsData()

  const task = tasks.find(t => t.id === taskId)
  const notesRef = useRef(null)
  const commentRef = useRef(null)
  const [assigneeEditorOpen, setAssigneeEditorOpen] = useState(false)

  useEffect(() => {
    if (task && notesRef.current) notesRef.current.setHtml(task.notes || '')
  }, [taskId]) // eslint-disable-line

  if (!task) return null

  const proj = projects.find(p => p.id === task.project_id)
  const aIds = taskAssignees.filter(a => a.task_id === taskId).map(a => a.profile_id)
  const taskComments = comments.filter(c => c.task_id === taskId)

  async function updateField(field, value) {
    const oldValue = task[field]
    const v = value || null
    const { error } = await supabase.from('tasks').update({ [field]: v }).eq('id', taskId)
    if (error) return
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: v } : t))
    if (field === 'status' && oldValue !== v) {
      if (v === 'done') {
        logActivity('completed', taskId, task.name, task.project_id, proj?.name)
        if (task.created_by) notifyTaskCompleted({ recipientId: task.created_by, actorId: userId, actorName: me?.full_name, taskName: task.name, projectName: proj?.name, taskId })
      } else logActivity('status_changed', taskId, task.name, task.project_id, proj?.name, `Moved to ${statusLabel(v)}`)
    }
  }

  async function toggleAssignee(pid) {
    const exists = taskAssignees.find(a => a.task_id === taskId && a.profile_id === pid)
    if (exists) {
      await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('profile_id', pid)
      setTaskAssignees(prev => prev.filter(a => !(a.task_id === taskId && a.profile_id === pid)))
    } else {
      await supabase.from('task_assignees').insert({ task_id: taskId, profile_id: pid })
      setTaskAssignees(prev => [...prev, { task_id: taskId, profile_id: pid }])
      const person = profiles.find(p => p.id === pid)
      logActivity('assigned', taskId, task.name, task.project_id, proj?.name, `Assigned to ${person?.full_name || ''}`)
      notifyTaskAssigned({ recipientIds: [pid], actorId: userId, actorName: me?.full_name, taskName: task.name, projectName: proj?.name, taskId })
    }
  }

  async function saveNotes() {
    const html = notesRef.current?.getHtml() || ''
    await supabase.from('tasks').update({ notes: html }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, notes: html } : t))
    await handleMentions(html, 'notes')
  }

  // notify mentioned people + auto-add them as collaborators
  async function handleMentions(html, where) {
    const ids = extractMentionedIds(html, profiles).filter(id => id !== userId)
    if (!ids.length) return
    const already = taskAssignees.filter(a => a.task_id === taskId).map(a => a.profile_id)
    const toAdd = ids.filter(id => !already.includes(id))
    if (toAdd.length) {
      await supabase.from('task_assignees').insert(toAdd.map(pid => ({ task_id: taskId, profile_id: pid })))
      setTaskAssignees(prev => [...prev, ...toAdd.map(pid => ({ task_id: taskId, profile_id: pid }))])
    }
    notifyTaskMention({ recipientIds: ids, actorId: userId, actorName: me?.full_name, taskName: task.name, where, taskId })
  }

  async function postComment() {
    const text = commentRef.current?.getText().trim() || ''
    if (!text) return
    const html = commentRef.current?.getHtml() || ''
    const { data, error } = await supabase.from('task_comments').insert({
      task_id: taskId, author_id: userId, text: html,
    }).select().single()
    if (error) return
    setComments(prev => [...prev, data])
    commentRef.current?.clear()
    logActivity('commented', taskId, task.name, task.project_id, proj?.name, text.slice(0, 80))
    await handleMentions(html, 'a comment')
  }

  async function deleteComment(id) {
    if (!window.confirm('Delete this comment?')) return
    await supabase.from('task_comments').delete().eq('id', id)
    setComments(prev => prev.filter(c => c.id !== id))
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 900 }} />
      <aside style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(480px, 100%)', background: 'var(--surface)', boxShadow: '-4px 0 24px rgba(0,0,0,.12)', zIndex: 901, overflowY: 'auto' }}>
        {/* header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3, marginBottom: 7 }}>{task.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <StatusBadge status={task.status} /> <PriorityBadge priority={task.priority} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {onEdit && <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => onEdit(taskId)}>Edit</button>}
              <button onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--ink-soft)' }}>✕</button>
            </div>
          </div>
        </div>

        <div style={{ padding: '18px 20px' }}>
          {/* fields grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <Field label="Project">
              {proj ? <span style={{ fontSize: 13 }}><span style={{ color: proj.color }}>● </span>{proj.name}</span> : <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>—</span>}
            </Field>
            <Field label="Client">
              <select value={task.client_id || ''} onChange={e => updateField('client_id', e.target.value)} style={inlineSel}>
                <option value="">— No client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" value={task.due_date || ''} onChange={e => updateField('due_date', e.target.value)} style={inlineSel} />
            </Field>
            <Field label="Priority">
              <select value={task.priority || 'medium'} onChange={e => updateField('priority', e.target.value)} style={inlineSel}>
                {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={task.status || 'todo'} onChange={e => updateField('status', e.target.value)} style={inlineSel}>
                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Created by">
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                {(profiles.find(p => p.id === task.created_by) || {}).full_name || 'Unknown'}
              </span>
            </Field>
          </div>

          {/* assignees */}
          <Section label="Assigned to">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {aIds.length === 0 ? <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Unassigned</span> :
                aIds.map(id => {
                  const p = profiles.find(x => x.id === id)
                  if (!p) return null
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar profile={p} size={28} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{p.full_name}</div>
                        {p.role && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{p.role}</div>}
                      </div>
                    </div>
                  )
                })}
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setAssigneeEditorOpen(o => !o)}>+ Edit assignees</button>
            {assigneeEditorOpen && (
              <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 8, padding: 6, maxHeight: 220, overflowY: 'auto' }}>
                {profiles.map(p => {
                  const sel = aIds.includes(p.id)
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
            )}
          </Section>

          {/* time tracking */}
          <TimeTracking taskId={taskId} />

          {/* attachments + drive link */}
          <Attachments taskId={taskId} />

          {/* notes */}
          <Section label="Notes">
            <RichTextEditor ref={notesRef} profiles={profiles} placeholder="Add notes, context, links… use @ to mention someone" minHeight={90} />
            <button className="btn btn-ghost" style={{ marginTop: 7, fontSize: 12 }} onClick={saveNotes}>Save notes</button>
          </Section>

          {/* comments */}
          <Section label="Comments">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
              {taskComments.length === 0 ? <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>No comments yet.</span> :
                taskComments.map(c => {
                  const author = profiles.find(p => p.id === c.author_id)
                  const canDelete = c.author_id === userId
                  return (
                    <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Avatar profile={author} size={26} />
                      <div style={{ flex: 1, background: 'var(--bg-soft, #f7f7f5)', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                          {author?.full_name || 'Unknown'} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>{formatCommentTime(c.created_at)}</span>
                        </div>
                        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: c.text }} />
                        {canDelete && <button onClick={() => deleteComment(c.id)} style={{ fontSize: 11, color: 'var(--ink-soft)', background: 'none', border: 0, cursor: 'pointer', padding: '2px 0', marginTop: 2 }}>Delete</button>}
                      </div>
                    </div>
                  )
                })}
            </div>
            <RichTextEditor ref={commentRef} profiles={profiles} placeholder="Write a comment… use @ to mention someone" minHeight={60} onEnter={postComment} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7 }}>
              <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={postComment}>Post comment</button>
              <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Ctrl/⌘ + Enter to post</span>
            </div>
          </Section>
        </div>
      </aside>
    </>
  )
}

const inlineSel = { border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', width: '100%' }

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  )
}
