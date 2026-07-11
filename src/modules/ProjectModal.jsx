import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { Avatar } from './projectBits'
import { PROJECT_COLORS } from './projectHelpers'

// ============================================================
// PROJECT MODAL — create or edit a project.
// Fields: name, description, color, members.
// Props: projectId (null = new), onClose(saved)
// ============================================================

export default function ProjectModal({ projectId, onClose }) {
  const { projects, projectMembers, profiles, userId, refresh } = useProjectsData()
  const existing = projectId ? projects.find(p => p.id === projectId) : null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])
  const [members, setMembers] = useState([])
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState(false)

  useEffect(() => {
    if (existing) {
      setName(existing.name || '')
      setDescription(existing.description || '')
      setColor(existing.color || PROJECT_COLORS[0])
      setMembers(projectMembers.filter(m => m.project_id === projectId).map(m => m.profile_id))
    } else {
      // default: creator is a member
      setMembers(userId ? [userId] : [])
    }
  }, [projectId]) // eslint-disable-line

  function toggleMember(pid) {
    setMembers(prev => prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid])
  }

  async function save() {
    if (!name.trim()) { setNameError(true); return }
    setBusy(true)
    const data = { name: name.trim(), description: description.trim() || null, color }

    let id = projectId
    if (projectId) {
      const { error } = await supabase.from('projects').update(data).eq('id', projectId)
      if (error) { window.alert('Error: ' + error.message); setBusy(false); return }
    } else {
      id = crypto.randomUUID()
      const { error } = await supabase.from('projects').insert({ id, ...data, created_by: userId })
      if (error) { window.alert('Error: ' + error.message); setBusy(false); return }
    }

    // sync members — always include the creator so they never lose their own project
    const memberSet = new Set(members)
    if (userId) memberSet.add(userId)
    const finalMembers = [...memberSet]
    await supabase.from('project_members').delete().eq('project_id', id)
    if (finalMembers.length) {
      await supabase.from('project_members').insert(finalMembers.map(pid => ({ project_id: id, profile_id: pid })))
    }

    setBusy(false)
    await refresh()
    onClose(true)
  }

  async function del() {
    if (!projectId) return
    const warn = 'Delete this project? Tasks in it will be kept but no longer grouped under a project. This cannot be undone.'
    if (!window.confirm(warn)) return
    setBusy(true)
    // detach tasks, then remove members + project
    await supabase.from('tasks').update({ project_id: null }).eq('project_id', projectId)
    await supabase.from('project_members').delete().eq('project_id', projectId)
    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) { window.alert('Error: ' + error.message); setBusy(false); return }
    setBusy(false); await refresh(); onClose(true)
  }

  return (
    <>
      <div onClick={() => onClose(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, pointerEvents: 'none' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.2)', pointerEvents: 'auto' }}>
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{projectId ? 'Edit project' : 'New project'}</div>
            <button onClick={() => onClose(false)} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--ink-soft)' }}>✕</button>
          </div>

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lbl}>Project name *</label>
              <input value={name} onChange={e => { setName(e.target.value); setNameError(false) }} placeholder="e.g. Website Redesign" autoFocus
                style={{ ...inp, borderColor: nameError ? 'var(--failed)' : 'var(--line)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lbl}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this project about? (optional)"
                style={{ ...inp, minHeight: 64, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={lbl}>Color</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PROJECT_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setColor(c)}
                    style={{ width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer',
                      border: color === c ? '3px solid var(--ink)' : '2px solid var(--line)', outline: 'none' }} />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lbl}>Members</label>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>Members can see and work on this project\u2019s tasks.</div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 6, maxHeight: 220, overflowY: 'auto' }}>
                {profiles.map(p => {
                  const sel = members.includes(p.id)
                  return (
                    <div key={p.id} onClick={() => toggleMember(p.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', background: sel ? 'var(--accent-bg)' : 'transparent' }}>
                      <span style={{ width: 18, height: 18, borderRadius: 4, border: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: 11 }}>{sel ? '✓' : ''}</span>
                      <Avatar profile={p} size={26} />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{p.full_name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            {projectId && <button onClick={del} className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--failed)' }}>Delete project</button>}
            <button onClick={() => onClose(false)} className="btn btn-ghost">Cancel</button>
            <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save project'}</button>
          </div>
        </div>
      </div>
    </>
  )
}

const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: '100%', background: 'var(--surface)', color: 'var(--ink)' }
const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }
