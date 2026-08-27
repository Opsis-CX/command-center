import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { RichEditor, sanitizeHtml, htmlToText } from '../lib/RichEditor'

// ============================================================
// PROJECT NOTES sub-view — a notepad that lives with a project.
//
// Same `notes` table as the personal notepad, but with project_id set.
// A note attached to a project is visible to everyone who can see that
// project (members, the creator, anyone with a task on it, admins) and
// editable by them too — it's a shared working pad, not private thinking.
// Only the person who wrote a note can delete it.
//
// Personal notes (project_id null) never show up here, and project notes
// are filtered out of the personal notepad, so the two don't bleed.
// ============================================================

export default function ProjectNotes({ activeProject, setActiveProject }) {
  const { myVisibleProjects, profiles, userId, isAdmin } = useProjectsData()
  const myProjects = myVisibleProjects()

  const [notes, setNotes] = useState([])
  const [selId, setSelId] = useState(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('notes').select('*')
      .is('deleted_at', null).not('project_id', 'is', null)
      .order('pinned', { ascending: false }).order('updated_at', { ascending: false })
    setNotes(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const nameOf = useCallback((id) => profiles.find(p => p.id === id)?.full_name || 'Someone', [profiles])

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase()
    return notes
      .filter(x => activeProject === 'all' || x.project_id === activeProject)
      .filter(x => !n || (x.title || '').toLowerCase().includes(n) || htmlToText(x.body || '').toLowerCase().includes(n))
  }, [notes, activeProject, q])

  const selected = visible.find(n => n.id === selId) || null

  async function newNote() {
    const projectId = activeProject === 'all' ? (myProjects[0]?.id || null) : activeProject
    if (!projectId) return
    const { data, error } = await supabase.from('notes')
      .insert({ owner_id: userId, project_id: projectId, title: '', body: null }).select().single()
    if (error) { window.alert("Couldn't create the note: " + error.message); return }
    setNotes(prev => [data, ...prev])
    setSelId(data.id)
    if (activeProject === 'all') setActiveProject(projectId)
  }

  const patch = useCallback(async (id, fields) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...fields } : n))
    setSaving(true)
    await supabase.from('notes').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
    setSaving(false)
  }, [])

  async function remove(n) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    setNotes(prev => prev.filter(x => x.id !== n.id))
    if (selId === n.id) setSelId(null)
    await supabase.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', n.id)
  }

  return (
    <div>
      <style>{`
        .pn-wrap{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start;}
        @media(max-width:820px){.pn-wrap{grid-template-columns:1fr;}}
      `}</style>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search notes…"
          style={{ maxWidth: 340, flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }} />
        <span className="page-sub" style={{ fontSize: 12 }}>
          Notes here are visible to everyone on the project.
        </span>
      </div>

      {/* project filter pills — same shape as the Kanban board */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <Pill active={activeProject === 'all'} onClick={() => setActiveProject('all')}>All projects</Pill>
        {myProjects.map(p => (
          <Pill key={p.id} active={activeProject === p.id} onClick={() => setActiveProject(p.id)}>{p.name}</Pill>
        ))}
        <button onClick={newNote} className="btn btn-primary" style={{ marginLeft: 'auto' }}>+ New note</button>
      </div>

      {loading ? <p className="page-sub">Loading notes…</p> : (
        <div className="pn-wrap">
          <div className="card" style={{ padding: 12 }}>
            {visible.length === 0 && (
              <div className="page-sub" style={{ fontSize: 12.5, padding: '6px 4px' }}>
                {q ? 'No matches.' : 'No notes on this project yet — create one.'}
              </div>
            )}
            {visible.map(n => (
              <NoteRow key={n.id} n={n} active={n.id === selId} onClick={() => setSelId(n.id)}
                project={myProjects.find(p => p.id === n.project_id)}
                showProject={activeProject === 'all'}
                by={n.owner_id === userId ? null : nameOf(n.owner_id)} />
            ))}
          </div>

          <div className="card" style={{ padding: 18, minHeight: 360 }}>
            {!selected ? (
              <div className="page-sub" style={{ textAlign: 'center', padding: 60 }}>Select a note, or create a new one.</div>
            ) : (
              <Editor key={selected.id} note={selected} saving={saving}
                projects={myProjects}
                byLine={selected.owner_id === userId ? null : nameOf(selected.owner_id)}
                canDelete={selected.owner_id === userId || isAdmin}
                onTitle={(v) => patch(selected.id, { title: v })}
                onBody={(html) => patch(selected.id, { body: html })}
                onColor={(c) => patch(selected.id, { color: c })}
                onProject={(pid) => patch(selected.id, { project_id: pid })}
                onPin={() => patch(selected.id, { pinned: !selected.pinned })}
                onDelete={() => remove(selected)} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Pill({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--line)'),
        background: active ? 'var(--accent)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--ink-soft)',
      }}>
      {children}
    </button>
  )
}

const NOTE_COLORS = [
  { key: '', label: 'None' },
  { key: '#ef4444', label: 'Red' },
  { key: '#f59e0b', label: 'Orange' },
  { key: '#eab308', label: 'Yellow' },
  { key: '#22c55e', label: 'Green' },
  { key: '#3b82f6', label: 'Blue' },
  { key: '#a855f7', label: 'Purple' },
]

function NoteRow({ n, active, onClick, project, showProject, by }) {
  const snippet = htmlToText(n.body || '')
  const sub = [showProject && project?.name, by && `by ${by.split(' ')[0]}`].filter(Boolean).join(' · ')
  return (
    <div onClick={onClick} style={{
      padding: '9px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 3,
      background: active ? 'var(--accent-bg)' : 'transparent',
      borderLeft: '3px solid ' + (n.color || 'transparent'),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {n.pinned && <span style={{ fontSize: 11 }}>📌</span>}
        <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title?.trim() || 'Untitled'}</span>
      </div>
      {(sub || snippet) && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub || snippet}
        </div>
      )}
    </div>
  )
}

function Editor({ note, saving, projects, byLine, canDelete, onTitle, onBody, onColor, onProject, onPin, onDelete }) {
  const [title, setTitle] = useState(note.title || '')
  const bodyTimer = useRef(null)
  const titleTimer = useRef(null)

  function handleTitle(v) {
    setTitle(v)
    clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => onTitle(v), 600)
  }
  function handleBody(html) {
    clearTimeout(bodyTimer.current)
    bodyTimer.current = setTimeout(() => onBody(sanitizeHtml(html)), 700)
  }
  useEffect(() => () => { clearTimeout(bodyTimer.current); clearTimeout(titleTimer.current) }, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input value={title} onChange={e => handleTitle(e.target.value)} placeholder="Note title"
          style={{ flex: 1, fontSize: 17, fontWeight: 700, border: 0, outline: 'none', background: 'transparent', color: 'var(--ink)', fontFamily: 'inherit' }} />
        <span style={{ fontSize: 11, color: 'var(--ink-soft)', minWidth: 44, textAlign: 'right' }}>{saving ? 'Saving…' : 'Saved'}</span>
        <button className="btn btn-ghost" title={note.pinned ? 'Unpin' : 'Pin'} style={{ fontSize: 13, padding: '4px 9px' }} onClick={onPin}>📌</button>
        {canDelete && (
          <button className="btn btn-ghost" title="Delete" style={{ fontSize: 13, padding: '4px 9px', color: 'var(--failed)' }} onClick={onDelete}>🗑</button>
        )}
      </div>

      {byLine && <div className="page-sub" style={{ fontSize: 12, marginBottom: 10 }}>Written by {byLine} · anyone on the project can edit</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-soft)' }}>
          Project
          <select value={note.project_id || ''} onChange={e => onProject(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginLeft: 4 }}>Color</span>
        {NOTE_COLORS.map(c => {
          const on = (note.color || '') === c.key
          return (
            <button key={c.key || 'none'} title={c.label} onClick={() => onColor(c.key)}
              style={{
                width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', padding: 0,
                background: c.key || 'var(--surface)',
                border: c.key ? (on ? '2px solid var(--ink)' : '1px solid rgba(0,0,0,.15)')
                              : (on ? '2px solid var(--ink)' : '1px solid var(--line)'),
                position: 'relative',
              }}>
              {!c.key && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>∅</span>}
            </button>
          )
        })}
      </div>

      <RichEditor variant="full" value={note.body || ''} onChange={handleBody} placeholder="Where you're landing, what you need from the team, meeting prep…" minHeight={280} />
    </div>
  )
}
