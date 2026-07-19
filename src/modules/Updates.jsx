import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichEditor, RichContent, sanitizeHtml, isEmptyHtml } from '../lib/RichEditor'

// ============================================================
// UPDATES / ANNOUNCEMENTS HUB
// One place to broadcast: Command Center changes, client updates, and
// operational/shift notes (e.g. "Five9 has X issue"). Each post can target
// Everyone or specific roles ("layers"), so it only reaches who it concerns.
// Anyone can post; admins can pin and moderate.
// ============================================================

const CATS = [
  { key: 'general', label: 'General', color: '#6b7280' },
  { key: 'command_center', label: 'Command Center', color: '#0077b6' },
  { key: 'client', label: 'Client', color: '#1f8a53' },
  { key: 'operational', label: 'Operational', color: '#b45309' },
]
const catMeta = (k) => CATS.find(c => c.key === k) || CATS[0]
const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const inputStyle = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)', boxSizing: 'border-box' }
const chip = (active, color) => ({ fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 999, cursor: 'pointer', border: '1px solid ' + (active ? (color || 'var(--accent)') : 'var(--line)'), background: active ? (color || 'var(--accent)') : 'transparent', color: active ? '#fff' : 'var(--ink-soft)' })

export default function Updates() {
  const { user, isAdmin } = useAuth()
  const [items, setItems] = useState(null)
  const [teams, setTeams] = useState([])
  const [names, setNames] = useState({})
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')
  const [composing, setComposing] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    const [aRes, rRes] = await Promise.all([
      supabase.from('announcements').select('*').is('deleted_at', null).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('tags').select('id, name').eq('namespace', 'team').order('name'),
    ])
    if (aRes.error) { setErr(aRes.error.message); setItems([]); return }
    const list = aRes.data || []
    setItems(list)
    setTeams(rRes.data || [])
    const ids = [...new Set(list.map(a => a.author_id).filter(Boolean))]
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      setNames(Object.fromEntries((profs || []).map(p => [p.id, p.full_name])))
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function togglePin(a) {
    const next = !a.pinned
    setItems(cur => cur.map(x => x.id === a.id ? { ...x, pinned: next } : x))
    const { error } = await supabase.from('announcements').update({ pinned: next, updated_at: new Date().toISOString() }).eq('id', a.id)
    if (error) { setErr(error.message); load() } else { load() }
  }
  async function remove(a) {
    if (!window.confirm('Delete this update for everyone?')) return
    setItems(cur => cur.filter(x => x.id !== a.id))
    const { error } = await supabase.from('announcements').update({ deleted_at: new Date().toISOString() }).eq('id', a.id)
    if (error) { setErr(error.message); load() }
  }

  const teamName = (id) => teams.find(t => t.id === id)?.name || 'team'
  const audienceLabel = (a) => (!a.audience_tags || a.audience_tags.length === 0) ? 'Everyone' : a.audience_tags.map(teamName).join(', ')
  const visible = (items || []).filter(a => filter === 'all' || a.category === filter)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Updates</h1>
          <p className="page-sub">Command Center changes, client updates, and anything from your shift others should know. Post reaches Everyone — or just the roles it concerns.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setComposing(c => !c)}>{composing ? 'Close' : '＋ New update'}</button>
      </div>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      {composing && <Composer user={user} teams={teams} onPosted={() => { setComposing(false); load() }} />}

      {/* category filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <span style={chip(filter === 'all')} onClick={() => setFilter('all')}>All</span>
        {CATS.map(c => <span key={c.key} style={chip(filter === c.key, c.color)} onClick={() => setFilter(c.key)}>{c.label}</span>)}
      </div>

      {items === null ? <p className="page-sub">Loading…</p>
        : visible.length === 0 ? <div className="card" style={{ textAlign: 'center', padding: 34 }}><p className="page-sub" style={{ margin: 0 }}>No updates yet. Post the first one.</p></div>
          : (
            <div style={{ display: 'grid', gap: 12 }}>
              {visible.map(a => {
                const cm = catMeta(a.category)
                const mine = a.author_id === user?.id
                const targeted = a.audience_tags && a.audience_tags.length > 0
                return (
                  <div key={a.id} className="card" style={{ borderLeft: '3px solid ' + cm.color }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                      {a.pinned && <span title="Pinned" style={{ fontSize: 13 }}>📌</span>}
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#fff', background: cm.color, borderRadius: 999, padding: '2px 9px' }}>{cm.label}</span>
                      <span style={{ fontWeight: 700, fontSize: 15.5 }}>{a.title}</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 8px' }} onClick={() => togglePin(a)}>{a.pinned ? 'Unpin' : 'Pin'}</button>}
                        {(mine || isAdmin) && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 8px', color: 'var(--failed)' }} onClick={() => remove(a)}>Delete</button>}
                      </span>
                    </div>
                    {a.body && <RichContent html={a.body} />}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 11.5, color: 'var(--ink-soft)' }}>
                      <span>{names[a.author_id] || 'Someone'}</span>
                      <span>·</span>
                      <span>{when(a.created_at)}</span>
                      <span>·</span>
                      <span title="Who can see this">{targeted ? '👁 ' + audienceLabel(a) : '👁 Everyone'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}

function Composer({ user, teams, onPosted }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('general')
  const [audience, setAudience] = useState([])   // team tag ids; empty = Everyone
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const editorRef = useRef(null)
  const htmlRef = useRef('')

  function toggleTag(id) {
    setAudience(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id])
  }

  async function post() {
    setErr('')
    if (!title.trim()) { setErr('Give it a title.'); return }
    const body = sanitizeHtml(htmlRef.current || '')
    setBusy(true)
    const { error } = await supabase.from('announcements').insert({
      author_id: user?.id, title: title.trim(),
      body: isEmptyHtml(body) ? null : body,
      category, audience_tags: audience,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onPosted()
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'grid', gap: 12 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Update title…" style={{ ...inputStyle, fontSize: 15, fontWeight: 600 }} />

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 6 }}>Category</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATS.map(c => <span key={c.key} style={chip(category === c.key, c.color)} onClick={() => setCategory(c.key)}>{c.label}</span>)}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 6 }}>
            Which team(s) should see this? <span style={{ fontWeight: 400, textTransform: 'none' }}>— none selected = Everyone</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={chip(audience.length === 0)} onClick={() => setAudience([])}>Everyone</span>
            {teams.map(t => <span key={t.id} style={chip(audience.includes(t.id))} onClick={() => toggleTag(t.id)}>{t.name}</span>)}
          </div>
          {teams.length === 0 && <p className="page-sub" style={{ fontSize: 11.5, marginTop: 6 }}>No teams set up yet — posts go to Everyone. Create team tags in People &amp; tags to target specific teams.</p>}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 6 }}>Details</div>
          <RichEditor variant="full" editorRef={editorRef} onChange={(html) => { htmlRef.current = html }} placeholder="What's the update? (optional)" />
        </div>

        {err && <div style={{ color: 'var(--failed)', fontSize: 12.5 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={post} disabled={busy}>{busy ? 'Posting…' : 'Post update'}</button>
        </div>
      </div>
    </div>
  )
}
