
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichEditor, sanitizeHtml, htmlToText } from '../lib/RichEditor'

// ============================================================
// MY NOTES — redesign (Brittney, 2026-10-27). Same `notes` table and editor as before;
// nothing existing is removed. Adds:
//  • Sidebar: All / Pinned / Shared with me / Recently edited / Recently deleted (30 days,
//    restore) / custom Folders (note_folders) / Templates (built-in + note_templates).
//  • Page style per note (notes.page_style): background color, plain/lined/grid/dotted
//    paper, line spacing, margin line, handwriting font.
//  • Meeting details: date, time, attendees, tags.
//  • Two-column Notes | Tasks layout (notes.layout = 'two_col'): each task has a title,
//    Due By, Project, Client; "Push to Project Management" → rpc push_note_tasks, which
//    creates real tasks once and updates them on later pushes (no duplicates).
//  • Sharing with specific people, Can view / Can edit (shared_with + shared_editors,
//    enforced in the database). Team sharing (read-only) is kept.
//  • Autosave as before (debounced), now also flushed when you switch notes.
// ============================================================

const NOTE_COLORS = [
  { key: '', label: 'None' }, { key: '#ef4444', label: 'Red' }, { key: '#f59e0b', label: 'Orange' },
  { key: '#eab308', label: 'Yellow' }, { key: '#22c55e', label: 'Green' }, { key: '#3b82f6', label: 'Blue' }, { key: '#a855f7', label: 'Purple' },
]
const PAGE_BGS = [
  { key: '', label: 'White' }, { key: '#FDF1F3', label: 'Blush' }, { key: '#FFF1E6', label: 'Peach' }, { key: '#FFFBEA', label: 'Cream' },
  { key: '#ECFBF3', label: 'Mint' }, { key: '#EAF5FF', label: 'Sky' }, { key: '#F3EEFF', label: 'Lavender' },
]
const LINE_H = { narrow: 26, normal: 32, wide: 40 }
const FOLDER_COLORS = ['#F59E0B', '#3B82F6', '#6366F1', '#0EA5E9', '#EC4899', '#22C55E', '#8B5CF6', '#14B8A6', '#EF4444']
// choices in the folder color picker (click a folder's square)
const FOLDER_SWATCHES = ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#14B8A6', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#64748B', '#1F2937']
const newKey = () => Math.random().toString(36).slice(2, 10)
const blankTasks = (n) => Array.from({ length: n }, () => ({ key: newKey(), title: '', due: '', project_id: '', client_id: '' }))
const todayISO = () => new Date().toLocaleDateString('en-CA')

const BUILT_IN_TEMPLATES = [
  { id: 'meeting', name: 'Meeting Notes', description: 'Two-column notes and tasks layout', icon: '📋', layout: 'two_col', meeting: true,
    body: '<h2>Notes</h2><ul><li></li></ul><h3>Key Takeaways:</h3><ul><li></li></ul><h3>Next Meeting:</h3><ul><li></li></ul>',
    page_style: { paper: 'lined', bg: '#FFFBEA', margin: true, spacing: 'normal' }, tasks: 3 },
  { id: 'blank', name: 'Blank Note', description: 'Start with a clean page', icon: '📄', layout: 'single', body: '', page_style: {}, tasks: 0 },
  { id: 'planning', name: 'Project Planning', description: 'Goals, tasks and next steps', icon: '🗂️', layout: 'two_col',
    body: '<h2>Goals</h2><ul><li></li></ul><h3>Scope</h3><ul><li></li></ul><h3>Next Steps</h3><ul><li></li></ul>', page_style: { paper: 'grid' }, tasks: 3 },
  { id: 'coaching', name: 'Coaching Session', description: 'Discussion points and action items', icon: '🎯', layout: 'two_col', meeting: true,
    body: '<h2>Discussion Points</h2><ul><li></li></ul><h3>Wins</h3><ul><li></li></ul><h3>Focus Areas</h3><ul><li></li></ul>', page_style: { paper: 'lined', bg: '#F3EEFF' }, tasks: 2 },
  { id: 'callreview', name: 'Call Review', description: 'Take notes and track follow ups', icon: '📞', layout: 'two_col',
    body: '<h2>Call Details</h2><ul><li>Caller:</li><li>Brand:</li><li>Date/time:</li></ul><h3>What went well</h3><ul><li></li></ul><h3>Coaching notes</h3><ul><li></li></ul>', page_style: { paper: 'lined', bg: '#EAF5FF' }, tasks: 2 },
]

const NP_CSS = `
.np { container-type: inline-size; }
.np-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.np-grid { display: grid; grid-template-columns: 230px 270px minmax(0, 1fr); grid-template-areas: "nav list editor" "tpl list editor"; gap: 14px; align-items: start; }
.np-a-nav { grid-area: nav; } .np-a-tpl { grid-area: tpl; } .np-list { grid-area: list; } .np-editor { grid-area: editor; }
/* narrower (e.g. the panel on My Profile): sidebar + note list on the left, the note beside them */
@container (max-width: 1180px) { .np-grid { grid-template-columns: 250px minmax(0, 1fr); grid-template-areas: "nav editor" "list editor" "tpl editor"; } .np-list { max-height: 340px !important; } }
@container (max-width: 700px) { .np-grid { grid-template-columns: 1fr; grid-template-areas: "nav" "list" "editor" "tpl"; } }
.np-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
.np-nav { padding: 10px; display: flex; flex-direction: column; gap: 2px; }
.np-nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 13.5px; color: var(--ink); text-align: left; width: 100%; }
.np-nav-item:hover { background: var(--canvas); }
.np-nav-item.on { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.np-nav-item .ct { margin-left: auto; font-size: 12px; color: var(--ink-soft); }
.np-sec { display: flex; align-items: center; justify-content: space-between; padding: 12px 10px 4px; font-size: 13px; font-weight: 700; }
.np-plus { border: 0; background: transparent; cursor: pointer; font-size: 18px; line-height: 1; color: var(--ink-soft); padding: 2px 6px; border-radius: 6px; }
.np-plus:hover { background: var(--canvas); color: var(--ink); }
.np-row { padding: 9px 10px; border-radius: 10px; cursor: pointer; border-left: 3px solid transparent; }
.np-row:hover { background: var(--canvas); }
.np-row.on { background: var(--accent-bg); }
.np-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 9px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.np-btn:hover { background: var(--canvas); }
.np-btn.on { border-color: #FCA5A5; color: #DC2626; background: #FEF2F2; }
.np-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px; font-size: 12.5px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
.np-chip button { border: 0; background: transparent; cursor: pointer; color: var(--ink-soft); padding: 0; font-size: 12px; }
.np-pop { position: absolute; z-index: 50; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 14px 36px rgba(0,0,0,.16); padding: 14px; }
.np-menu button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 7px; font: inherit; font-size: 13px; cursor: pointer; color: var(--ink); }
.np-menu button:hover { background: var(--canvas); }
.np-paper { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--paper-bg, var(--surface)); }
.np-paper .re-wrap { background: transparent !important; border: 0 !important; border-radius: 0 !important; }
.np-tbrow { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 10px; flex-wrap: wrap; }
.np-tb { flex: 1 1 420px; min-width: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.np-tb:empty { display: none; }
.np-tb .re-toolbar { border: 0 !important; background: transparent !important; }
.np-paper .re-content { background-color: transparent !important; line-height: var(--lh) !important; font-size: 15px; padding-top: 6px !important; padding-left: var(--pad-l, 18px) !important;
  background-image: var(--pimg, none); background-size: var(--psize, auto); background-position: 0 6px; background-attachment: local; font-family: var(--paper-font, inherit); }
.np-paper .re-content p, .np-paper .re-content li { margin: 0; }
.np-paper .re-content ul, .np-paper .re-content ol { margin: 0; padding-left: 24px; }
.np-paper .re-content h1, .np-paper .re-content h2, .np-paper .re-content h3 { margin: 0; line-height: var(--lh); }
.np-two { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
@container (max-width: 900px) { .np-two { grid-template-columns: 1fr; } }
.np-tasks { border-left: 1px dashed var(--line); padding: 14px 16px; background-image: var(--pimg-t, none); background-size: var(--psize-t, auto); background-position: 0 6px; }
.np-task { padding: 6px 2px 12px; border-bottom: 1px dashed rgba(15,23,42,.14); }
.np-task.done { opacity: .6; }
.np-task .ttl { border: 0; background: transparent; font-family: var(--paper-font, inherit); font-size: 17px; font-weight: 700; color: var(--ink); outline: none; width: 100%; padding: 2px 0; }
.np-task .ttl::placeholder { color: rgba(100,116,139,.7); font-weight: 600; }
.np-task .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin: 4px 0 0 27px; font-size: 12px; color: var(--ink-soft); }
.np-task .fld { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.np-task .fld .lbl { white-space: nowrap; }
.np-task .fld input, .np-task .fld select { border: 0; border-bottom: 1.5px solid rgba(100,116,139,.45); border-radius: 0; background: transparent; font: inherit; font-size: 12px; color: var(--ink); padding: 1px 2px; max-width: 150px; outline: none; cursor: pointer; }
.np-task .fld input:focus, .np-task .fld select:focus { border-bottom-color: var(--accent); }
.np-task .fld input[type=date] { width: 118px; }
.np-task .linked { display: inline-flex; align-items: center; gap: 4px; margin: 6px 0 0 27px; font-size: 11.5px; font-weight: 700; color: #047857; text-decoration: none; }
.np-tasks-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.np-push { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 12px; padding: 11px 18px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
  background: linear-gradient(120deg, #CFFAFE, #A7F3D0); color: #065F46; box-shadow: 0 6px 18px -8px rgba(16,185,129,.6); }
.np-push:disabled { opacity: .6; cursor: default; }
`

// paper look from a page_style object → CSS variables (layers + matching sizes)
function paperLayers(paper, lh) {
  const line = 'rgba(59,130,246,.18)'
  if (paper === 'lined') return [[`repeating-linear-gradient(to bottom, transparent 0, transparent ${lh - 1}px, ${line} ${lh - 1}px, ${line} ${lh}px)`, 'auto']]
  if (paper === 'grid') return [[`linear-gradient(to right, ${line} 1px, transparent 1px)`, `${lh}px ${lh}px`], [`linear-gradient(to bottom, ${line} 1px, transparent 1px)`, `${lh}px ${lh}px`]]
  if (paper === 'dotted') return [[`radial-gradient(circle, rgba(100,116,139,.45) 1.1px, transparent 1.6px)`, `${lh}px ${lh}px`]]
  return []
}
function paperVars(ps = {}) {
  const lh = LINE_H[ps.spacing] || LINE_H.normal
  const layers = paperLayers(ps.paper, lh)
  const withMargin = ps.margin ? [['linear-gradient(to right, transparent 46px, rgba(239,68,68,.45) 46px, rgba(239,68,68,.45) 48px, transparent 48px)', 'auto'], ...layers] : layers
  const img = (ls) => ls.length ? ls.map(l => l[0]).join(', ') : 'none'
  const size = (ls) => ls.length ? ls.map(l => l[1]).join(', ') : 'auto'
  return {
    '--lh': lh + 'px', '--paper-bg': ps.bg || 'var(--surface)',
    '--pimg': img(withMargin), '--psize': size(withMargin),
    '--pimg-t': img(layers), '--psize-t': size(layers),
    '--pad-l': ps.margin ? '62px' : '18px',
    '--paper-font': ps.font === 'hand' ? "'Caveat', 'Segoe Print', cursive" : 'inherit',
  }
}
function useHandFont(on) {
  useEffect(() => {
    if (!on || document.getElementById('np-caveat')) return
    const l = document.createElement('link'); l.id = 'np-caveat'; l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap'
    document.head.appendChild(l)
  }, [on])
}

function usePop() {
  const [open, setOpen] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    // close on a click anywhere outside the open pop-up (its own trigger button toggles it)
    const out = (e) => { if (!e.target.closest('.np-pop, [data-poptrigger]')) setOpen(null) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  return [open, setOpen, ref]
}

export default function Notes() {
  const { user } = useAuth()
  const me = user?.id
  const [notes, setNotes] = useState([])
  const [folders, setFolders] = useState([])
  const [myTemplates, setMyTemplates] = useState([])
  const [people, setPeople] = useState([])
  const [teams, setTeams] = useState([])
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [view, setView] = useState('all')
  const [selId, setSelId] = useState(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newOpen, setNewOpen, newRef] = usePop()
  const [colorFor, setColorFor] = usePop()     // folder id whose color picker is open

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }

  const load = useCallback(async () => {
    if (!me) return
    const [n, f, t, p, tg, pr, cl] = await Promise.all([
      supabase.from('notes').select('*').is('project_id', null).order('updated_at', { ascending: false }),
      supabase.from('note_folders').select('*').eq('owner_id', me).order('created_at'),
      supabase.from('note_templates').select('*').eq('owner_id', me).order('created_at'),
      supabase.from('profiles').select('id, full_name, avatar_url').eq('is_active', true).is('client_id', null).order('full_name'),
      supabase.from('tags').select('id, name').eq('namespace', 'team').order('name'),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('clients').select('id, name').order('name'),
    ])
    setNotes(n.data || []); setFolders(f.data || []); setMyTemplates(t.data || [])
    setPeople((p.data || []).filter(x => !/\btest$/i.test((x.full_name || '').trim())))
    setTeams(tg.data || []); setProjects(pr.data || []); setClients(cl.data || [])
    setLoading(false)
  }, [me])
  useEffect(() => { load() }, [load])
  // ?note=<id> (from "Copy link")
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('note'); if (id) setSelId(id) }, [])

  const nameOf = useMemo(() => Object.fromEntries(people.map(p => [p.id, p.full_name])), [people])
  const live = notes.filter(n => !n.deleted_at)
  const mine = live.filter(n => n.owner_id === me)
  const sharedWithMe = live.filter(n => n.owner_id !== me)
  const deleted = notes.filter(n => n.deleted_at && n.owner_id === me)
  const weekAgo = Date.now() - 7 * 864e5
  const recent = live.filter(n => new Date(n.updated_at).getTime() >= weekAgo)
  const counts = { all: live.length, pinned: mine.filter(n => n.pinned).length, shared: sharedWithMe.length, recent: recent.length, deleted: deleted.length }

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    let base = view === 'all' ? live : view === 'pinned' ? mine.filter(n => n.pinned) : view === 'shared' ? sharedWithMe
      : view === 'recent' ? recent : view === 'deleted' ? deleted
      : view.startsWith('folder:') ? mine.filter(n => n.folder_id === view.slice(7)) : live
    if (t) base = (view === 'deleted' ? deleted : live).filter(n => (n.title || '').toLowerCase().includes(t)
      || htmlToText(n.body || '').toLowerCase().includes(t) || (n.tags || []).some(g => g.toLowerCase().includes(t)))
    return [...base].sort((a, b) => (b.pinned && b.owner_id === me) - (a.pinned && a.owner_id === me) || String(b.updated_at).localeCompare(String(a.updated_at)))
  }, [notes, view, q, me]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = notes.find(n => n.id === selId) || null

  const patch = useCallback(async (id, fields) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...fields, updated_at: new Date().toISOString() } : n))
    setSaving(true)
    const { error } = await supabase.from('notes').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
    setSaving(false)
    if (error) flash('Couldn’t save: ' + error.message)
  }, [])

  async function createNote(tpl) {
    setNewOpen(null)
    const t = tpl || BUILT_IN_TEMPLATES[1]
    const rowTasks = Array.isArray(t.meeting_tasks) && t.meeting_tasks.length
      ? t.meeting_tasks.map(x => ({ ...x, key: newKey(), task_id: undefined })) : blankTasks(t.tasks || 0)
    const row = {
      owner_id: me, title: '', body: t.body || null, layout: t.layout || 'single', page_style: t.page_style || {},
      meeting_tasks: (t.layout === 'two_col' && !rowTasks.length) ? blankTasks(1) : rowTasks,
      template_name: t.id === 'blank' ? null : t.name,
      ...(t.meeting ? { meeting_date: todayISO() } : {}),
      ...(view.startsWith('folder:') ? { folder_id: view.slice(7) } : {}),
    }
    const { data, error } = await supabase.from('notes').insert(row).select().single()
    if (error) return flash(error.message)
    setNotes(prev => [data, ...prev]); setSelId(data.id)
    if (view === 'deleted' || view === 'shared') setView('all')
  }
  async function duplicate(n) {
    const { id, created_at, updated_at, deleted_at, shared_with, shared_editors, shared_tags, owner_id, ...rest } = n
    const { data, error } = await supabase.from('notes').insert({ ...rest, owner_id: me, title: (n.title || 'Untitled') + ' (copy)', pinned: false,
      meeting_tasks: (n.meeting_tasks || []).map(t => ({ ...t, key: newKey(), task_id: undefined })) }).select().single()
    if (error) return flash(error.message)
    setNotes(prev => [data, ...prev]); setSelId(data.id); flash('Duplicated')
  }
  async function trash(n) {
    if (!window.confirm('Move this note to Recently Deleted? You can restore it for 30 days.')) return
    await patch(n.id, { deleted_at: new Date().toISOString(), pinned: false })
    setSelId(null)
  }
  async function restore(n) { await patch(n.id, { deleted_at: null }); flash('Restored'); setView('all'); setSelId(n.id) }
  async function forever(n) {
    if (!window.confirm('Delete this note for good? This can’t be undone.')) return
    const { error } = await supabase.from('notes').delete().eq('id', n.id)
    if (error) return flash(error.message)
    setNotes(prev => prev.filter(x => x.id !== n.id)); setSelId(null)
  }
  async function addFolder() {
    const name = window.prompt('New folder name')
    if (!name?.trim()) return
    const { data, error } = await supabase.from('note_folders').insert({ owner_id: me, name: name.trim(), color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length] }).select().single()
    if (error) return flash(error.message)
    setFolders(f => [...f, data]); setView('folder:' + data.id)
  }
  async function renameFolder(f) {
    const name = window.prompt('Rename folder', f.name)
    if (!name?.trim()) return
    await supabase.from('note_folders').update({ name: name.trim() }).eq('id', f.id)
    setFolders(fs => fs.map(x => x.id === f.id ? { ...x, name: name.trim() } : x))
  }
  async function setFolderColor(f, color) {
    setFolders(fs => fs.map(x => x.id === f.id ? { ...x, color } : x))
    const { error } = await supabase.from('note_folders').update({ color }).eq('id', f.id)
    if (error) flash(error.message)
  }
  async function deleteFolder(f) {
    if (!window.confirm(`Delete the folder "${f.name}"? Its notes stay in All Notes.`)) return
    await supabase.from('notes').update({ folder_id: null }).eq('folder_id', f.id).eq('owner_id', me)
    await supabase.from('note_folders').delete().eq('id', f.id)
    setNotes(ns => ns.map(n => n.folder_id === f.id ? { ...n, folder_id: null } : n))
    setFolders(fs => fs.filter(x => x.id !== f.id)); setView('all')
  }
  async function saveAsTemplate(n) {
    const name = window.prompt('Template name', n?.title || 'My template')
    if (!name?.trim()) return
    const description = window.prompt('Short description (optional)', '') || null
    const { data, error } = await supabase.from('note_templates').insert({
      owner_id: me, name: name.trim(), description, icon: '⭐', layout: n?.layout || 'single', body: n?.body || '',
      page_style: n?.page_style || {}, meeting_tasks: (n?.meeting_tasks || []).map(t => ({ key: newKey(), title: t.title || '', due: '', project_id: t.project_id || '', client_id: t.client_id || '' })),
    }).select().single()
    if (error) return flash(error.message)
    setMyTemplates(t => [...t, data]); flash(`Template "${name.trim()}" saved`)
  }
  async function deleteTemplate(t) {
    if (!window.confirm(`Delete the template "${t.name}"? Notes made from it are not affected.`)) return
    await supabase.from('note_templates').delete().eq('id', t.id)
    setMyTemplates(ts => ts.filter(x => x.id !== t.id))
  }

  if (loading) return <div className="page"><p className="page-sub">Loading your notes…</p></div>

  const allTemplates = [...BUILT_IN_TEMPLATES, ...myTemplates.map(t => ({ ...t, mine: true }))]
  const navItem = (key, icon, label, ct) => (
    <button className={'np-nav-item' + (view === key ? ' on' : '')} onClick={() => { setView(key); setQ('') }}>
      <span style={{ width: 18, textAlign: 'center' }}>{icon}</span>{label}<span className="ct">{ct}</span>
    </button>
  )

  return (
    <div className="page np" style={{ maxWidth: 1500 }}>
      <style>{NP_CSS}</style>
      <div className="np-top">
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>My Notes 📝</h1>
          <p className="page-sub" style={{ marginTop: 2, fontSize: 12.5 }}>Private to you. Keep track of ideas, meetings, lists, and anything else. You can share with team members to read or edit.</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search notes…" aria-label="Search notes"
          style={{ width: 'min(280px, 100%)', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' }} />
        <div ref={newRef} style={{ position: 'relative', display: 'flex' }}>
          <button className="btn btn-primary" onClick={() => createNote(BUILT_IN_TEMPLATES[1])} style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>＋ New note</button>
          <button data-poptrigger className="btn btn-primary" onClick={() => setNewOpen(o => o ? null : 'menu')} aria-label="New note from a template" style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,.35)', padding: '0 10px' }}>▾</button>
          {newOpen && (
            <div className="np-pop np-menu" style={{ right: 0, top: 'calc(100% + 6px)', width: 260, padding: 6 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', padding: '4px 10px' }}>START FROM A TEMPLATE</div>
              {allTemplates.map(t => <button key={t.id} onClick={() => createNote(t)}>{t.icon || '⭐'} {t.name}</button>)}
            </div>
          )}
        </div>
      </div>
      {msg && <div className="card" style={{ marginBottom: 10, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}

      <div className="np-grid">
        {/* ---------- navigation ---------- */}
          <div className="np-card np-nav np-a-nav">
            {navItem('all', '📚', 'All Notes', counts.all)}
            {navItem('pinned', '📌', 'Pinned', counts.pinned)}
            {navItem('shared', '👥', 'Shared with Me', counts.shared)}
            {navItem('recent', '🕒', 'Recently Edited', counts.recent)}
            {navItem('deleted', '🗑️', 'Recently Deleted', counts.deleted)}
            <div className="np-sec">Folders<button className="np-plus" onClick={addFolder} title="New folder" aria-label="New folder">＋</button></div>
            {folders.length === 0 && <div className="page-sub" style={{ fontSize: 12, padding: '2px 10px 6px' }}>No folders yet.</div>}
            {folders.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                <button data-poptrigger type="button" title="Change folder color" aria-label={`Change color of ${f.name}`}
                  onClick={() => setColorFor(colorFor === f.id ? null : f.id)}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: '4px 2px 4px 8px', display: 'grid', placeItems: 'center' }}>
                  <span style={{ display: 'inline-block', width: 14, height: 12, borderRadius: 3, background: f.color || '#F59E0B', boxShadow: colorFor === f.id ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)' : 'none' }} />
                </button>
                {colorFor === f.id && (
                  <div className="np-pop" style={{ left: 0, top: 'calc(100% + 4px)', width: 214, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <b style={{ flex: 1, fontSize: 13 }}>Folder color</b>
                      <button className="np-plus" style={{ fontSize: 13 }} onClick={() => setColorFor(null)} aria-label="Close">✕</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                      {FOLDER_SWATCHES.map(c => (
                        <button key={c} title={c} aria-label={`Color ${c}`} onClick={() => { setFolderColor(f, c); setColorFor(null) }}
                          style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                            border: (f.color || '').toLowerCase() === c.toLowerCase() ? '2px solid var(--ink)' : '2px solid transparent', boxShadow: '0 0 0 1px rgba(0,0,0,.06)' }} />
                      ))}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-soft)' }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1.5px dashed var(--ink-soft)', display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>＋
                        <input type="color" value={/^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : '#F59E0B'} onChange={e => setFolderColor(f, e.target.value)}
                          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} aria-label="Pick any color" />
                      </span>
                      Pick any color
                    </label>
                  </div>
                )}
                <button className={'np-nav-item' + (view === 'folder:' + f.id ? ' on' : '')} style={{ paddingLeft: 6 }} onClick={() => { setView('folder:' + f.id); setQ('') }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span className="ct">{mine.filter(n => n.folder_id === f.id).length}</span>
                </button>
                {view === 'folder:' + f.id && <>
                  <button className="np-plus" style={{ fontSize: 12 }} title="Rename folder" onClick={() => renameFolder(f)}>✎</button>
                  <button className="np-plus" style={{ fontSize: 12 }} title="Delete folder" onClick={() => deleteFolder(f)}>✕</button>
                </>}
              </div>
            ))}
          </div>
          <div className="np-card np-nav np-a-tpl">
            <div className="np-sec" style={{ paddingTop: 4 }}>Note Templates<button className="np-plus" title="Save the open note as a template" onClick={() => saveAsTemplate(selected)} disabled={!selected}>＋</button></div>
            {allTemplates.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button className="np-nav-item" onClick={() => createNote(t)} title={`New note from "${t.name}"`} style={{ alignItems: 'flex-start' }}>
                  <span style={{ width: 18, textAlign: 'center' }}>{t.icon || '⭐'}</span>
                  <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                    {t.description && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-soft)' }}>{t.description}</span>}</span>
                </button>
                {t.mine && <button className="np-plus" style={{ fontSize: 12 }} title="Delete template" onClick={() => deleteTemplate(t)}>✕</button>}
              </div>
            ))}
            <button className="np-nav-item" style={{ color: 'var(--accent)', fontWeight: 600 }} disabled={!selected} onClick={() => saveAsTemplate(selected)}
              title={selected ? 'Save the open note as a reusable template' : 'Open a note first, then save it as a template'}>＋ Create a new template</button>
          </div>

        {/* ---------- list ---------- */}
        <div className="np-card np-list" style={{ padding: 8, maxHeight: 'calc(100vh - 170px)', overflowY: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', padding: '6px 8px' }}>
            {q ? `Search results (${list.length})` : view === 'deleted' ? 'Removed for good after 30 days' : `${list.length} note${list.length === 1 ? '' : 's'}`}
          </div>
          {list.length === 0 && <div className="page-sub" style={{ padding: '10px 8px', fontSize: 13 }}>{view === 'deleted' ? 'Nothing here.' : 'No notes yet.'}</div>}
          {list.map(n => {
            const by = n.owner_id !== me ? nameOf[n.owner_id] : null
            const folder = folders.find(f => f.id === n.folder_id)
            return (
              <div key={n.id} className={'np-row' + (selId === n.id ? ' on' : '')} style={{ borderLeftColor: n.color || 'transparent' }} onClick={() => setSelId(n.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {n.pinned && n.owner_id === me && <span style={{ fontSize: 11 }}>📌</span>}
                  <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title?.trim() || 'Untitled'}</span>
                  {(n.shared_with?.length > 0 || n.shared_tags?.length > 0) && n.owner_id === me && <span title="Shared" style={{ fontSize: 11 }}>👥</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {by ? `From ${by.split(' ')[0]} · ` : ''}{folder ? `${folder.name} · ` : ''}{new Date(n.deleted_at || n.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {htmlToText(n.body || '').slice(0, 60) || 'Empty'}
                </div>
              </div>
            )
          })}
        </div>

        {/* ---------- editor ---------- */}
        <div className="np-editor" style={{ minWidth: 0 }}>
          {!selected ? (
            <div className="np-card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
              <div style={{ fontSize: 34 }}>📝</div>
              <div style={{ fontWeight: 700, color: 'var(--ink)', marginTop: 6 }}>Pick a note, or start a new one</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Try <b>Meeting Notes</b> for the two-column notes + tasks layout.</div>
            </div>
          ) : selected.deleted_at ? (
            <div className="np-card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.title?.trim() || 'Untitled'}</div>
              <p className="page-sub" style={{ fontSize: 13 }}>Deleted {new Date(selected.deleted_at).toLocaleDateString()} — removed for good after 30 days.</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button className="btn btn-primary" onClick={() => restore(selected)}>Restore</button>
                <button className="btn btn-ghost" style={{ color: 'var(--failed)' }} onClick={() => forever(selected)}>Delete for good</button>
              </div>
              <div className="re-rendered" style={{ opacity: .75 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.body || '') }} />
            </div>
          ) : (
            <NoteEditor key={selected.id} note={selected} me={me} people={people} nameOf={nameOf} teams={teams}
              folders={folders} projects={projects} clients={clients} saving={saving}
              patch={(f) => patch(selected.id, f)} onDuplicate={() => duplicate(selected)} onTrash={() => trash(selected)}
              onSaveTemplate={() => saveAsTemplate(selected)} flash={flash} reload={load} />
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// ONE NOTE
// ============================================================
function NoteEditor({ note, me, people, nameOf, teams, folders, projects, clients, saving, patch, onDuplicate, onTrash, onSaveTemplate, flash, reload }) {
  const isOwner = note.owner_id === me
  const canEdit = isOwner || (note.shared_editors || []).includes(me)
  const ps = note.page_style || {}
  useHandFont(ps.font === 'hand')
  const [title, setTitle] = useState(note.title || '')
  const [tasks, setTasks] = useState(() => (note.meeting_tasks || []).map(t => ({ key: t.key || newKey(), ...t })))
  const [pop, setPop] = usePop()
  const [tbEl, setTbEl] = useState(null)   // the toolbar is drawn into this, above the notepad
  const [pushing, setPushing] = useState(false)
  // pending autosaves, flushed on unmount so switching notes never loses typing
  const pending = useRef({})
  const timers = useRef({})
  const queue = useCallback((field, value, ms) => {
    pending.current[field] = value
    clearTimeout(timers.current[field])
    timers.current[field] = setTimeout(() => { const v = pending.current[field]; delete pending.current[field]; patch({ [field]: v }) }, ms)
  }, [patch])
  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout)
    const left = { ...pending.current }
    if (Object.keys(left).length) patch(left)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setTasksSave = (next) => { setTasks(next); queue('meeting_tasks', next, 600) }
  const updTask = (key, f) => setTasksSave(tasks.map(t => t.key === key ? { ...t, ...f } : t))
  const twoCol = note.layout === 'two_col'

  async function push() {
    if (!tasks.some(t => (t.title || '').trim())) return flash('Add a task title first.')
    setPushing(true)
    // save any pending task edits first
    clearTimeout(timers.current.meeting_tasks); delete pending.current.meeting_tasks
    const { error: sErr } = await supabase.from('notes').update({ meeting_tasks: tasks, updated_at: new Date().toISOString() }).eq('id', note.id)
    if (sErr) { setPushing(false); return flash(sErr.message) }
    const { data, error } = await supabase.rpc('push_note_tasks', { p_note: note.id })
    setPushing(false)
    if (error) return flash('Couldn’t push: ' + error.message)
    setTasks(data.tasks || tasks)
    flash(`Project Management: ${data.created} new task${data.created === 1 ? '' : 's'} created${data.updated ? `, ${data.updated} updated` : ''}. ✓`)
    reload()
  }

  const attendees = note.attendees || []
  const tags = note.tags || []
  const folder = folders.find(f => f.id === note.folder_id)
  const sharedCount = (note.shared_with || []).length + (note.shared_tags || []).length
  const paperStyle = paperVars(ps)
  const btn = (label, onClick, extra = {}) => <button className="np-btn" onClick={onClick} {...extra}>{label}</button>

  return (
    <div className="np-card" style={{ padding: 16 }}>
      {/* title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input value={title} disabled={!canEdit} onChange={e => { setTitle(e.target.value); queue('title', e.target.value, 600) }} placeholder="Note title" aria-label="Note title"
              style={{ flex: 1, minWidth: 0, fontSize: 24, fontWeight: 800, border: 0, outline: 'none', background: 'transparent', color: 'var(--ink)', fontFamily: 'inherit' }} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{canEdit ? (saving ? 'Saving…' : 'Saved') : 'View only'}</span>
          </div>
          {/* meeting details */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
            <label title="Date">📅 <input type="date" disabled={!canEdit} value={note.meeting_date || ''} onChange={e => patch({ meeting_date: e.target.value || null })}
              style={{ border: 0, background: 'transparent', font: 'inherit', color: 'var(--ink)' }} /></label>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', position: 'relative' }}>👥
              {attendees.map(id => <span key={id} className="np-chip" style={{ padding: '2px 8px' }}>{nameOf[id] || 'Someone'}{canEdit && <button onClick={() => patch({ attendees: attendees.filter(x => x !== id) })} aria-label="Remove attendee">✕</button>}</span>)}
              {canEdit && <button data-poptrigger className="np-plus" style={{ fontSize: 13, color: 'var(--accent)' }} onClick={() => setPop(pop === 'att' ? null : 'att')}>＋ Add attendees</button>}
              {pop === 'att' && <PeoplePicker people={people.filter(p => !attendees.includes(p.id))} onPick={(id) => patch({ attendees: [...attendees, id] })} style={{ left: 0, top: 26 }} />}
            </span>
          </div>
          {/* chips: template, folder, tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {note.template_name && <span className="np-chip" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'transparent' }}>📋 {note.template_name}</span>}
            {isOwner ? (
              <select value={note.folder_id || ''} onChange={e => patch({ folder_id: e.target.value || null })} aria-label="Folder" className="np-chip" style={{ cursor: 'pointer' }}>
                <option value="">📁 No folder</option>
                {folders.map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
              </select>
            ) : folder ? <span className="np-chip">📁 {folder.name}</span> : null}
            {tags.map(t => <span key={t} className="np-chip">🏷️ {t}{canEdit && <button onClick={() => patch({ tags: tags.filter(x => x !== t) })} aria-label={`Remove tag ${t}`}>✕</button>}</span>)}
            {canEdit && <button className="np-chip" style={{ cursor: 'pointer' }} onClick={() => { const t = window.prompt('Add a tag'); if (t?.trim() && !tags.includes(t.trim())) patch({ tags: [...tags, t.trim()] }) }}>＋ Add tag</button>}
          </div>
        </div>
        {/* actions */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
          {isOwner && btn(note.pinned ? '📌 Pinned' : '📌 Pin', () => patch({ pinned: !note.pinned }), { className: 'np-btn' + (note.pinned ? ' on' : '') })}
          <span className="np-btn" style={{ cursor: 'default' }}>{sharedCount ? '👥 Shared' : '🔒 Private'}</span>
          {isOwner && btn('↗ Share', () => setPop(pop === 'share' ? null : 'share'), { style: { color: 'var(--accent)' }, 'data-poptrigger': true })}
          {btn('⋮', () => setPop(pop === 'more' ? null : 'more'), { 'aria-label': 'More options', 'data-poptrigger': true })}
          {pop === 'more' && (
            <div className="np-pop np-menu" style={{ right: 0, top: 'calc(100% + 6px)', width: 220, padding: 6 }}>
              {canEdit && <button data-poptrigger onClick={() => setPop('style')}>🎨 Page style…</button>}
              {canEdit && <button onClick={() => { setPop(null); const nx = twoCol ? 'single' : 'two_col'; patch({ layout: nx }); if (nx === 'two_col' && !tasks.length) setTasksSave(blankTasks(1)) }}>{twoCol ? '▭ Remove tasks column' : '▥ Add tasks column'}</button>}
              <button onClick={() => { setPop(null); onDuplicate() }}>⧉ Duplicate</button>
              <button onClick={() => { setPop(null); exportNote(note) }}>⬇ Export (.html)</button>
              <button onClick={() => { setPop(null); onSaveTemplate() }}>⭐ Save as template</button>
              {isOwner && <div style={{ padding: '6px 10px 2px', fontSize: 11.5, color: 'var(--ink-soft)' }}>Note color</div>}
              {isOwner && <div style={{ display: 'flex', gap: 6, padding: '4px 10px 8px' }}>
                {NOTE_COLORS.map(c => <span key={c.key || 'none'} title={c.label} onClick={() => patch({ color: c.key || null })}
                  style={{ width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', background: c.key || 'var(--surface)', border: (note.color || '') === c.key ? '2px solid var(--ink)' : '1px solid var(--line)', fontSize: 11, display: 'grid', placeItems: 'center' }}>{c.key ? '' : '∅'}</span>)}
              </div>}
              {isOwner && <button style={{ color: 'var(--failed)' }} onClick={() => { setPop(null); onTrash() }}>🗑 Delete</button>}
            </div>
          )}
          {pop === 'share' && <SharePanel note={note} people={people.filter(p => p.id !== me)} nameOf={nameOf} teams={teams} patch={patch} flash={flash} onClose={() => setPop(null)} />}
        </div>
      </div>

      {/* formatting toolbar + paper controls, above the notepad */}
      {canEdit && (
        <div className="np-tbrow">
          <div ref={setTbEl} className="np-tb" />
          <div style={{ display: 'flex', gap: 6, position: 'relative', alignSelf: 'center' }}>
            <button data-poptrigger className="np-btn" style={{ fontSize: 12.5, padding: '4px 10px' }} onClick={() => setPop(pop === 'style' ? null : 'style')}>
              📄 {({ plain: 'Plain', lined: 'Lined', grid: 'Grid', dotted: 'Dotted' })[ps.paper || 'plain']} paper ▾</button>
            <button data-poptrigger className="np-btn" style={{ fontSize: 12.5, padding: '4px 10px' }} onClick={() => setPop(pop === 'style' ? null : 'style')} aria-label="Page style">🎨 ▾</button>
            {pop === 'style' && <PageStylePanel ps={ps} onChange={(next) => patch({ page_style: next })} onClose={() => setPop(null)} />}
          </div>
        </div>
      )}

      {/* the page */}
      <div className="np-paper" style={paperStyle}>
        <div className={twoCol ? 'np-two' : ''}>
          <div style={{ minWidth: 0 }}>
            {canEdit
              ? <RichEditor variant="notes" value={note.body || ''} onChange={(html) => queue('body', sanitizeHtml(html), 700)} placeholder="Start writing…" minHeight={460} maxHeight={100000} toolbarTarget={tbEl} />
              : <div className="re-content" style={{ minHeight: 300, padding: 14 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.body || '') }} />}
          </div>
          {twoCol && (
            <div className="np-tasks">
              <div className="np-tasks-head">
                <span style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--paper-font, inherit)' }}>Tasks</span>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{tasks.filter(t => (t.title || '').trim()).length} task{tasks.filter(t => (t.title || '').trim()).length === 1 ? '' : 's'}</span>
              </div>
              {tasks.map(t => (
                <div key={t.key} className={'np-task' + (t.done ? ' done' : '')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <input type="checkbox" checked={!!t.done} disabled={!canEdit} onChange={e => updTask(t.key, { done: e.target.checked })} aria-label="Done" style={{ width: 17, height: 17, accentColor: 'var(--accent)', flex: 'none' }} />
                    <input className="ttl" value={t.title || ''} disabled={!canEdit} onChange={e => updTask(t.key, { title: e.target.value })} placeholder="Task title" aria-label="Task title"
                      style={{ textDecoration: t.done ? 'line-through' : 'none' }} />
                    {canEdit && <button className="np-plus" style={{ fontSize: 12 }} title="Remove from this note (a task already in Project Management stays there)" onClick={() => setTasksSave(tasks.filter(x => x.key !== t.key))}>✕</button>}
                  </div>
                  <div className="meta">
                    <label className="fld"><span className="lbl">📅 Due By:</span><input type="date" disabled={!canEdit} value={t.due || ''} onChange={e => updTask(t.key, { due: e.target.value })} /></label>
                    <label className="fld"><span className="lbl">📁 Project:</span><select disabled={!canEdit} value={t.project_id || ''} onChange={e => updTask(t.key, { project_id: e.target.value })}>
                      <option value="">______</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    <label className="fld"><span className="lbl">👤 Client:</span><select disabled={!canEdit} value={t.client_id || ''} onChange={e => updTask(t.key, { client_id: e.target.value })}>
                      <option value="">______</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  </div>
                  {t.task_id && <a className="linked" href={`/projects?task=${t.task_id}`}>✓ In Project Management ↗</a>}
                </div>
              ))}
              {canEdit && <button className="np-plus" style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600, margin: '10px 0' }} onClick={() => setTasksSave([...tasks, ...blankTasks(1)])}>＋ Add another task</button>}
              {canEdit && (
                <div style={{ marginTop: 14 }}>
                  <button className="np-push" style={{ width: '100%', justifyContent: 'center' }} disabled={pushing} onClick={push}>☑ {pushing ? 'Pushing…' : 'Push to Project Management'} ›</button>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>Creates real tasks assigned to you. Pushing again updates them, never duplicates.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {!canEdit && <div className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>Shared by {nameOf[note.owner_id] || 'a teammate'} · view only</div>}
    </div>
  )
}

function exportNote(note) {
  const html = `<!doctype html><meta charset="utf-8"><title>${(note.title || 'Note').replace(/[<>&]/g, '')}</title><h1>${(note.title || 'Untitled').replace(/[<>&]/g, '')}</h1>${sanitizeHtml(note.body || '')}` +
    ((note.meeting_tasks || []).length ? '<h2>Tasks</h2><ul>' + note.meeting_tasks.map(t => `<li>${String(t.title || '').replace(/[<>&]/g, '')}${t.due ? ' — due ' + t.due : ''}</li>`).join('') + '</ul>' : '')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  a.download = (note.title || 'note').replace(/[^\w -]+/g, '').trim().slice(0, 60) + '.html'
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function PeoplePicker({ people, onPick, style }) {
  const [q, setQ] = useState('')
  const list = people.filter(p => (p.full_name || '').toLowerCase().includes(q.toLowerCase())).slice(0, 40)
  return (
    <div className="np-pop" style={{ width: 240, padding: 8, ...style }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search team members…" style={{ width: '100%', padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, marginBottom: 6 }} />
      <div className="np-menu" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {list.map(p => <button key={p.id} onClick={() => onPick(p.id)}>{p.full_name}</button>)}
        {!list.length && <div className="page-sub" style={{ fontSize: 12, padding: 6 }}>No matches</div>}
      </div>
    </div>
  )
}

function PageStylePanel({ ps, onChange, onClose }) {
  const set = (k, v) => onChange({ ...ps, [k]: v })
  const box = (on) => ({ border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--accent-bg)' : 'var(--surface)', borderRadius: 8, cursor: 'pointer', padding: 6, fontFamily: 'inherit', fontSize: 11.5, color: 'var(--ink)' })
  const thumb = (paper) => { const ls = paperLayers(paper, 10); return { width: 46, height: 40, borderRadius: 4, border: '1px solid var(--line)', backgroundColor: '#fff',
    backgroundImage: ls.length ? ls.map(l => l[0]).join(', ') : 'none', backgroundSize: ls.length ? ls.map(l => l[1]).join(', ') : 'auto' } }
  return (
    <div className="np-pop" style={{ right: 0, top: 'calc(100% + 6px)', width: 300 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><b style={{ flex: 1 }}>Page Style</b><button className="np-plus" style={{ fontSize: 14 }} onClick={onClose} aria-label="Close">✕</button></div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Background Color</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {PAGE_BGS.map(b => <button key={b.key || 'w'} title={b.label} onClick={() => set('bg', b.key)}
          style={{ width: 26, height: 26, borderRadius: '50%', background: b.key || '#fff', cursor: 'pointer', border: (ps.bg || '') === b.key ? '2px solid var(--accent)' : '1px solid var(--line)' }} />)}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Paper Style</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
        {['plain', 'lined', 'grid', 'dotted'].map(p => (
          <button key={p} style={box((ps.paper || 'plain') === p)} onClick={() => set('paper', p)}>
            <div style={{ ...thumb(p), margin: '0 auto 4px' }} />{p[0].toUpperCase() + p.slice(1)}
          </button>))}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Line Spacing</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
        {['narrow', 'normal', 'wide'].map(s => <button key={s} style={box((ps.spacing || 'normal') === s)} onClick={() => set('spacing', s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Font</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 12 }}>
        <button style={box(ps.font !== 'hand')} onClick={() => set('font', '')}>Standard</button>
        <button style={{ ...box(ps.font === 'hand'), fontFamily: "'Caveat', cursive", fontSize: 15 }} onClick={() => set('font', 'hand')}>Handwriting</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Show margin line <input type="checkbox" checked={!!ps.margin} onChange={e => set('margin', e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
      </label>
    </div>
  )
}

function SharePanel({ note, people, nameOf, teams, patch, flash, onClose }) {
  const shared = note.shared_with || []
  const editors = note.shared_editors || []
  const [q, setQ] = useState('')
  const [addRole, setAddRole] = useState('view')
  const teamIds = note.shared_tags || []
  const matches = q.trim() ? people.filter(p => !shared.includes(p.id) && (p.full_name || '').toLowerCase().includes(q.toLowerCase())).slice(0, 6) : []
  const add = (id) => { patch({ shared_with: [...shared, id], shared_editors: addRole === 'edit' ? [...editors, id] : editors }); setQ('') }
  const setRole = (id, role) => patch({ shared_editors: role === 'edit' ? [...new Set([...editors, id])] : editors.filter(x => x !== id) })
  const remove = (id) => patch({ shared_with: shared.filter(x => x !== id), shared_editors: editors.filter(x => x !== id) })
  const initials = (n) => (n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const colors = ['#0EA5E9', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899']
  return (
    <div className="np-pop" style={{ right: 0, top: 'calc(100% + 6px)', width: 'min(370px, 92vw)' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}><b style={{ flex: 1 }}>Share Note</b><button className="np-plus" style={{ fontSize: 14 }} onClick={onClose} aria-label="Close">✕</button></div>
      <div className="page-sub" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>Share “{note.title?.trim() || 'Untitled'}”</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search team members…" style={{ flex: 1, padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13 }} />
        <select value={addRole} onChange={e => setAddRole(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 12.5 }}>
          <option value="view">Can view</option><option value="edit">Can edit</option></select>
      </div>
      {matches.length > 0 && <div className="np-menu" style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }}>
        {matches.map(p => <button key={p.id} onClick={() => add(p.id)}>＋ {p.full_name}</button>)}</div>}
      <div style={{ marginTop: 10 }}>
        {shared.length === 0 && <div className="page-sub" style={{ fontSize: 12.5 }}>🔒 Private — only you can see this note.</div>}
        {shared.map((id, i) => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: colors[i % colors.length], color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{initials(nameOf[id])}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{nameOf[id] || 'Someone'}</span>
            <select value={editors.includes(id) ? 'edit' : 'view'} onChange={e => setRole(id, e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 7, fontFamily: 'inherit', fontSize: 12 }}>
              <option value="view">Can view</option><option value="edit">Can edit</option></select>
            <button className="np-plus" style={{ fontSize: 12 }} onClick={() => remove(id)} aria-label="Stop sharing">✕</button>
          </div>
        ))}
      </div>
      {teams.length > 0 && <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-soft)' }}>Share with a whole team (view only){teamIds.length ? ` · ${teamIds.length}` : ''}</summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {teams.map(t => { const on = teamIds.includes(t.id); return (
            <button key={t.id} onClick={() => patch({ shared_tags: on ? teamIds.filter(x => x !== t.id) : [...teamIds, t.id] })}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--accent)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-soft)' }}>{on ? '✓ ' : ''}{t.name}</button>) })}
        </div>
      </details>}
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 8 }}>
        <button className="np-plus" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}
          onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/notes?note=${note.id}`); flash('Link copied — only people you share with can open it.') }}>🔗 Copy link</button>
        <div className="page-sub" style={{ fontSize: 11.5 }}>Only people you share with can access this note.</div>
      </div>
    </div>
  )
}
