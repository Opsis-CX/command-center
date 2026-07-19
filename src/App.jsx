import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichEditor, sanitizeHtml, htmlToText } from '../lib/RichEditor'

// ============================================================
// NOTE PAD — a private notebook for each person.
//
// Notes are private by default. A note can be shared to one or more TEAM tags:
// everyone on that team can then READ it, but only the owner edits or deletes.
// Editing autosaves (debounced) so nothing is ever lost to a missed "Save".
// ============================================================

export default function Notes() {
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [teams, setTeams] = useState([])
  const [names, setNames] = useState({})       // owner_id -> full_name (for shared notes)
  const [selId, setSelId] = useState(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('notes').select('*').is('deleted_at', null)
      .order('pinned', { ascending: false }).order('updated_at', { ascending: false })
    const list = data || []
    setNotes(list)
    // names for notes shared TO me by others
    const otherOwners = [...new Set(list.filter(n => n.owner_id !== user?.id).map(n => n.owner_id))]
    if (otherOwners.length) {
      const { data: pr } = await supabase.from('profiles').select('id, full_name').in('id', otherOwners)
      const m = {}; (pr || []).forEach(p => m[p.id] = p.full_name); setNames(m)
    }
    setLoading(false)
  }, [user?.id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('tags').select('id, name').eq('namespace', 'team').order('name')
      .then(({ data }) => setTeams(data || []))
  }, [])

  const mine = useMemo(() => notes.filter(n => n.owner_id === user?.id), [notes, user?.id])
  const shared = useMemo(() => notes.filter(n => n.owner_id !== user?.id), [notes, user?.id])
  const selected = notes.find(n => n.id === selId) || null
  const canEdit = selected && selected.owner_id === user?.id

  const filt = (arr) => {
    const n = q.trim().toLowerCase()
    if (!n) return arr
    return arr.filter(x => (x.title || '').toLowerCase().includes(n) || htmlToText(x.body || '').toLowerCase().includes(n))
  }

  async function newNote() {
    const { data, error } = await supabase.from('notes')
      .insert({ owner_id: user.id, title: '', body: null }).select().single()
    if (error) return
    setNotes(prev => [data, ...prev])
    setSelId(data.id)
  }

  // Patch a note locally + in the DB.
  const patch = useCallback(async (id, fields) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...fields } : n))
    setSaving(true)
    await supabase.from('notes').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
    setSaving(false)
  }, [])

  async function togglePin(n) { await patch(n.id, { pinned: !n.pinned }) }
  async function remove(n) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    setNotes(prev => prev.filter(x => x.id !== n.id))
    if (selId === n.id) setSelId(null)
    await supabase.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', n.id)
  }

  if (loading) return <div className="page"><p className="page-sub">Loading your notes…</p></div>

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <style>{`
        .np-wrap{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start;}
        @media(max-width:820px){.np-wrap{grid-template-columns:1fr;}}
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>My Notes 📝</h1>
          <p className="page-sub" style={{ marginTop: 2 }}>Private to you. Share a note with a team to let them read it.</p>
        </div>
        <button className="btn btn-primary" onClick={newNote}>+ New note</button>
      </div>

      <div className="np-wrap">
        {/* list */}
        <div className="card" style={{ padding: 12 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search notes…"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', marginBottom: 10 }} />

          {filt(mine).length === 0 && <div className="page-sub" style={{ fontSize: 12.5, padding: '6px 4px' }}>{q ? 'No matches.' : 'No notes yet — create one.'}</div>}
          {filt(mine).map(n => <NoteRow key={n.id} n={n} active={n.id === selId} onClick={() => setSelId(n.id)} />)}

          {filt(shared).length > 0 && (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', margin: '14px 4px 6px', opacity: .7 }}>Shared with me</div>
              {filt(shared).map(n => <NoteRow key={n.id} n={n} active={n.id === selId} onClick={() => setSelId(n.id)} by={names[n.owner_id]} />)}
            </>
          )}
        </div>

        {/* editor / viewer */}
        <div className="card" style={{ padding: 18, minHeight: 360 }}>
          {!selected ? (
            <div className="page-sub" style={{ textAlign: 'center', padding: 60 }}>Select a note, or create a new one.</div>
          ) : canEdit ? (
            <Editor key={selected.id} note={selected} teams={teams} saving={saving}
              onTitle={(v) => patch(selected.id, { title: v })}
              onBody={(html) => patch(selected.id, { body: html })}
              onShare={(tags) => patch(selected.id, { shared_tags: tags })}
              onPin={() => togglePin(selected)}
              onDelete={() => remove(selected)} />
          ) : (
            <ReadOnly note={selected} by={names[selected.owner_id]} />
          )}
        </div>
      </div>
    </div>
  )
}

function NoteRow({ n, active, onClick, by }) {
  const snippet = htmlToText(n.body || '')
  return (
    <div onClick={onClick} style={{
      padding: '9px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 3,
      background: active ? 'var(--accent-bg)' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {n.pinned && <span style={{ fontSize: 11 }}>📌</span>}
        <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title?.trim() || 'Untitled'}</span>
        {n.shared_tags?.length > 0 && !by && <span title="Shared with a team" style={{ fontSize: 11 }}>👥</span>}
      </div>
      {(snippet || by) && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{by ? `From ${by?.split(' ')[0]}` : snippet}</div>}
    </div>
  )
}

function Editor({ note, teams, saving, onTitle, onBody, onShare, onPin, onDelete }) {
  const [title, setTitle] = useState(note.title || '')
  const [shareOpen, setShareOpen] = useState(false)
  const bodyTimer = useRef(null)
  const titleTimer = useRef(null)
  const shared = note.shared_tags || []

  function handleTitle(v) {
    setTitle(v)
    clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => onTitle(v), 600)
  }
  function handleBody(html) {
    clearTimeout(bodyTimer.current)
    bodyTimer.current = setTimeout(() => onBody(sanitizeHtml(html)), 700)
  }
  function toggleShare(id) {
    const next = shared.includes(id) ? shared.filter(x => x !== id) : [...shared, id]
    onShare(next)
  }
  useEffect(() => () => { clearTimeout(bodyTimer.current); clearTimeout(titleTimer.current) }, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input value={title} onChange={e => handleTitle(e.target.value)} placeholder="Note title"
          style={{ flex: 1, fontSize: 17, fontWeight: 700, border: 0, outline: 'none', background: 'transparent', color: 'var(--ink)', fontFamily: 'inherit' }} />
        <span style={{ fontSize: 11, color: 'var(--ink-soft)', minWidth: 44, textAlign: 'right' }}>{saving ? 'Saving…' : 'Saved'}</span>
        <button className="btn btn-ghost" title={note.pinned ? 'Unpin' : 'Pin'} style={{ fontSize: 13, padding: '4px 9px' }} onClick={onPin}>📌</button>
        <button className="btn btn-ghost" title="Delete" style={{ fontSize: 13, padding: '4px 9px', color: 'var(--failed)' }} onClick={onDelete}>🗑</button>
      </div>

      {/* share control */}
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setShareOpen(o => !o)}>
          👥 {shared.length ? `Shared with ${shared.length} team${shared.length > 1 ? 's' : ''}` : 'Private — share with a team'}
        </button>
        {shareOpen && (
          <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {teams.length === 0 && <span className="page-sub" style={{ fontSize: 12 }}>No teams set up yet.</span>}
            {teams.map(t => {
              const on = shared.includes(t.id)
              return (
                <button key={t.id} onClick={() => toggleShare(t.id)}
                  style={{ fontSize: 12, padding: '5px 11px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                    background: on ? 'var(--accent)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-soft)' }}>
                  {on ? '✓ ' : ''}{t.name}
                </button>
              )
            })}
            <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Shared notes are read-only for the team — only you can edit or delete.</div>
          </div>
        )}
      </div>

      <RichEditor variant="full" value={note.body || ''} onChange={handleBody} placeholder="Start writing…" minHeight={280} />
    </div>
  )
}

function ReadOnly({ note, by }) {
  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{note.title?.trim() || 'Untitled'}</div>
      <div className="page-sub" style={{ fontSize: 12, marginBottom: 12 }}>Shared by {by || 'a teammate'} · read-only</div>
      <div className="re-rendered" dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.body || '') }} />
    </div>
  )
}
