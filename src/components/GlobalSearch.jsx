import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getNavIndex } from './Sidebar'

// ============================================================
// Universal search (2026-10-30) — top bar, every page. Ctrl/⌘+K or "/" opens it.
// Searches pages (only ones in the person's own menu), people, tasks, projects, chat
// messages, Knowledge Base articles, meetings, My Notes and clients. Every query runs as
// the signed-in person, so the database's access rules decide what can come back —
// nobody sees a result they couldn't open anyway.
// ============================================================

const CSS = `
.gs-btn { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: var(--canvas); color: var(--ink-soft);
  border-radius: 9px; padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer; min-width: 190px; }
.gs-btn:hover { border-color: var(--accent); color: var(--ink); }
.gs-btn kbd { margin-left: auto; font-size: 11px; border: 1px solid var(--line); border-radius: 5px; padding: 0 5px; background: var(--surface); color: var(--ink-soft); font-family: inherit; }
@media (max-width: 900px) { .gs-btn { min-width: 0; padding: 6px 9px; } .gs-btn .gs-label, .gs-btn kbd { display: none; } }
.gs-back { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 9px; padding: 5px 10px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.gs-back:hover { border-color: var(--accent); color: var(--accent); }
@media (max-width: 640px) { .gs-back .gs-back-label { display: none; } }
.gs-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.35); z-index: 4000; display: flex; justify-content: center; align-items: flex-start; padding: 9vh 12px 12px; }
.gs-box { width: min(680px, 100%); max-height: min(72vh, 640px); background: var(--surface); color: var(--ink); border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.25); display: flex; flex-direction: column; overflow: hidden; }
.gs-input { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.gs-input input { flex: 1; border: 0; outline: 0; font: inherit; font-size: 16px; background: transparent; color: var(--ink); }
.gs-results { overflow-y: auto; padding: 6px 0 10px; }
.gs-group { padding: 10px 16px 4px; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
.gs-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 16px; cursor: pointer; font: inherit; color: var(--ink); }
.gs-item.on { background: var(--accent-bg, rgba(0,119,182,.09)); }
.gs-item .gs-ic { width: 26px; height: 26px; border-radius: 7px; background: var(--canvas); display: grid; place-items: center; font-size: 14px; flex: none; }
.gs-item .gs-main { flex: 1; min-width: 0; }
.gs-item .gs-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gs-item .gs-sub { font-size: 12px; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gs-hint { padding: 18px 16px; font-size: 13px; color: var(--ink-soft); }
.gs-foot { border-top: 1px solid var(--line); padding: 8px 16px; font-size: 11.5px; color: var(--ink-soft); display: flex; gap: 14px; flex-wrap: wrap; }
`

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
function snippet(text, q) {
  const t = strip(text), i = t.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return t.slice(0, 90)
  const s = Math.max(0, i - 30)
  return (s > 0 ? '…' : '') + t.slice(s, s + 100) + (s + 100 < t.length ? '…' : '')
}
const when = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

// Back button: previous screen inside the app, or Home if there's nowhere to go back to.
export function BackButton() {
  const navigate = useNavigate()
  const location = useLocation()
  if (location.pathname === '/') return null
  return (
    <button className="gs-back" onClick={() => (location.key && location.key !== 'default') ? navigate(-1) : navigate('/')} title="Back" aria-label="Back">
      <span aria-hidden="true">←</span><span className="gs-back-label">Back</span>
    </button>
  )
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setOpen(o => !o) }
      else if (e.key === '/' && !typing && !open) { e.preventDefault(); setOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <>
      <style>{CSS}</style>
      <button className="gs-btn" onClick={() => setOpen(true)} aria-label="Search everything" title={`Search everything (${isMac ? '⌘' : 'Ctrl'}+K)`}>
        <span aria-hidden="true">🔍</span><span className="gs-label">Search…</span><kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchPalette({ onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState([])     // [{ title, items: [{ ic, title, sub, to }] }]
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const reqId = useRef(0)
  const listRef = useRef(null)

  const run = useCallback(async (term) => {
    const t = term.trim()
    const pages = getNavIndex()
      .filter(p => !t || p.label.toLowerCase().includes(t.toLowerCase()) || (p.group || '').toLowerCase().includes(t.toLowerCase()))
      .slice(0, t ? 6 : 8)
      .map(p => ({ ic: p.ic || '📄', title: p.label, sub: p.group ? `Page · ${p.group}` : 'Page', to: p.to }))
    if (t.length < 2) { setGroups(pages.length ? [{ title: t ? 'Pages' : 'Jump to a page', items: pages }] : []); setLoading(false); return }
    const id = ++reqId.current
    setLoading(true)
    const like = `%${t.replace(/[%_]/g, m => '\\' + m)}%`
    const safe = (p) => p.then(r => r.data || []).catch(() => [])
    const [people, tasks, projects, msgs, kb, meetings, notes, clients] = await Promise.all([
      safe(supabase.from('profiles').select('id, full_name, job_title').ilike('full_name', like).eq('is_active', true).limit(5)),
      safe(supabase.from('tasks').select('id, name, status, due_date').ilike('name', like).is('deleted_at', null).limit(6)),
      safe(supabase.from('projects').select('id, name').ilike('name', like).limit(4)),
      safe(supabase.from('messages').select('id, body, channel_id, created_at, sender:profiles!messages_sender_id_fkey(full_name), channel:channels(name, is_dm)').ilike('body', like).is('deleted_at', null).order('created_at', { ascending: false }).limit(6)),
      safe(supabase.from('kb_articles').select('id, title, folder_id, status').ilike('title', like).limit(5)),
      safe(supabase.from('meetings').select('id, title, started_at').ilike('title', like).order('started_at', { ascending: false }).limit(5)),
      safe(supabase.from('notes').select('id, title, updated_at').ilike('title', like).is('deleted_at', null).limit(5)),
      safe(supabase.from('clients').select('id, name').ilike('name', like).limit(4)),
    ])
    if (id !== reqId.current) return   // a newer search started — drop this one
    const out = []
    if (pages.length) out.push({ title: 'Pages', items: pages })
    if (people.length) out.push({ title: 'People', items: people.map(p => ({ ic: '👤', title: p.full_name, sub: p.job_title || 'Profile', to: `/profile/${p.id}` })) })
    if (tasks.length) out.push({ title: 'Tasks', items: tasks.map(x => ({ ic: x.status === 'done' ? '✅' : '☑️', title: x.name, sub: `Task${x.due_date ? ' · due ' + when(x.due_date + 'T12:00:00') : ''}${x.status === 'done' ? ' · done' : ''}`, to: `/projects?task=${x.id}` })) })
    if (projects.length) out.push({ title: 'Projects', items: projects.map(x => ({ ic: '📁', title: x.name, sub: 'Project', to: '/projects' })) })
    if (msgs.length) out.push({ title: 'Chat messages', items: msgs.map(m => ({ ic: '💬', title: snippet(m.body, t), sub: `${m.sender?.full_name || 'Someone'} · ${m.channel?.is_dm ? 'Direct message' : '#' + (m.channel?.name || 'channel')} · ${when(m.created_at)}`, to: `/chat?channel=${m.channel_id}&message=${m.id}` })) })
    const kbLive = kb.filter(a => !/trash|deleted|archiv/i.test(a.status || ''))
    if (kbLive.length) out.push({ title: 'Knowledge Base', items: kbLive.map(a => ({ ic: '📚', title: a.title, sub: 'Article', to: `/knowledge?view=article&id=${a.id}${a.folder_id ? '&folder=' + a.folder_id : ''}` })) })
    if (meetings.length) out.push({ title: 'Meetings', items: meetings.map(m => ({ ic: '🎥', title: m.title || 'Meeting', sub: `Meeting${m.started_at ? ' · ' + when(m.started_at) : ''}`, to: `/meetings?meeting=${m.id}` })) })
    if (notes.length) out.push({ title: 'My Notes', items: notes.map(n => ({ ic: '📝', title: n.title || 'Untitled note', sub: `Note · edited ${when(n.updated_at)}`, to: `/notes?note=${n.id}` })) })
    if (clients.length) out.push({ title: 'Clients', items: clients.map(c => ({ ic: '🏢', title: c.name, sub: 'Client', to: '/clients' })) })
    setGroups(out); setActive(0); setLoading(false)
  }, [])

  useEffect(() => { const h = setTimeout(() => run(q), q.trim().length < 2 ? 0 : 250); return () => clearTimeout(h) }, [q, run])

  const flat = groups.flatMap(g => g.items)
  const go = (item) => { if (!item) return; onClose(); navigate(item.to) }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]) }
  }
  useEffect(() => { listRef.current?.querySelector('.gs-item.on')?.scrollIntoView({ block: 'nearest' }) }, [active])

  let idx = -1
  return createPortal(
    <div className="gs-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="gs-box" role="dialog" aria-label="Search everything">
        <div className="gs-input">
          <span aria-hidden="true" style={{ fontSize: 18 }}>🔍</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search people, tasks, messages, articles, pages…" aria-label="Search" />
          {loading && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Searching…</span>}
        </div>
        <div className="gs-results" ref={listRef}>
          {groups.length === 0 && !loading && (
            <div className="gs-hint">{q.trim().length < 2 ? 'Type at least 2 letters to search everything you have access to.' : `No results for “${q.trim()}”.`}</div>
          )}
          {groups.map(g => (
            <div key={g.title}>
              <div className="gs-group">{g.title}</div>
              {g.items.map(item => { idx++; const me = idx; return (
                <button key={g.title + me} className={'gs-item' + (me === active ? ' on' : '')} onMouseEnter={() => setActive(me)} onClick={() => go(item)}>
                  <span className="gs-ic">{item.ic}</span>
                  <span className="gs-main"><div className="gs-title">{item.title}</div><div className="gs-sub">{item.sub}</div></span>
                </button>
              ) })}
            </div>
          ))}
        </div>
        <div className="gs-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span><span style={{ marginLeft: 'auto' }}>Only shows what you have access to</span></div>
      </div>
    </div>, document.body)
}
