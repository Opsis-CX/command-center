import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichEditor, RichContent, isEmptyHtml } from '../lib/RichEditor'

// Access is enforced by the database (kb_can) — see the KNOWLEDGE BASE v2 note below.

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function fileIcon(mime) {
  const m = mime || ''
  if (m.includes('pdf')) return '📄'
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return '📊'
  if (m.includes('word') || m.includes('document')) return '📝'
  if (m.includes('presentation') || m.includes('powerpoint')) return '📽'
  if (m.startsWith('image/')) return '🖼'
  if (m.startsWith('video/')) return '🎬'
  if (m.includes('zip') || m.includes('compressed')) return '🗜'
  return '📎'
}

async function uploadKbFile(file, meta, uploaderId) {
  const safe = file.name.replace(/[^\w.\- ]+/g, '_')
  const path = crypto.randomUUID() + '/' + safe
  const { error: upErr } = await supabase.storage.from('kb-files').upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) throw new Error(upErr.message)
  const row = { name: file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size, uploaded_by: uploaderId, ...meta }
  const { data, error } = await supabase.from('kb_files').insert(row).select('*').single()
  if (error) { await supabase.storage.from('kb-files').remove([path]); throw new Error(error.message) }
  return data
}
async function downloadKbFile(fileId) {
  const { data, error } = await supabase.functions.invoke('kb-file-url', { body: { fileId } })
  if (error || !data?.url) throw new Error(data?.error || error?.message || 'Download unavailable')
  window.open(data.url, '_blank')
}

function FileRow({ f, onDelete, onMove, canDownload = true }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function grab() {
    setBusy(true); setErr('')
    try { await downloadKbFile(f.id) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--line-soft)' }}>
      <span style={{ fontSize: 18, flex: 'none' }}>{fileIcon(f.mime_type)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{fmtSize(f.size_bytes)}{err && <span style={{ color: 'var(--failed)' }}> · {err}</span>}</div>
      </div>
      {canDownload && <button className="btn btn-ghost" style={{ fontSize: 12.5, flex: 'none' }} onClick={grab} disabled={busy}>{busy ? '…' : '⬇ Download'}</button>}
      {onMove && <button className="btn btn-ghost" style={{ fontSize: 12.5, flex: 'none' }} onClick={() => onMove(f)}>Move</button>}
      {onDelete && <button className="btn btn-ghost" style={{ fontSize: 12.5, color: 'var(--failed)', flex: 'none' }} onClick={() => onDelete(f)}>Remove</button>}
    </div>
  )
}

// ============================================================
// KNOWLEDGE BASE v2 (2026-11-11) — sections → folders (client/project) → articles · files · recordings.
// Everything you see is what the server lets you view (kb_can); every button only shows when the
// server says you may do it (kb_powers / kb_admin_powers), and the server checks again on every action.
// Sections, templates and permissions are all set by each organization — nothing here is hard-coded.
// ============================================================
const KB_CSS = `
.kb-hero { display: flex; align-items: center; gap: 16px; margin: 6px 0 16px; flex-wrap: wrap; }
.kb-hero-ic { width: 64px; height: 64px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 12%, var(--surface)); display: grid; place-items: center; font-size: 30px; flex: none; }
.kb-hero h2 { margin: 0; font-size: 26px; font-weight: 800; line-height: 1.15; }
.kb-hero p { margin: 3px 0 0; color: var(--ink-soft); font-size: 14px; font-style: italic; }
.kb-crumbs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13.5px; }
.kb-crumbs button { border: 0; background: none; padding: 2px 4px; cursor: pointer; color: var(--ink-soft); font: inherit; border-radius: 6px; }
.kb-crumbs button:hover { color: var(--accent); background: var(--accent-bg); }
.kb-crumbs b { color: var(--ink); }
.kb-pill { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 8px 16px; font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
.kb-pill.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink, #fff); }
.kb-pill small { font-weight: 600; opacity: .75; }
.kb-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.kb-search { position: relative; flex: 1 1 240px; max-width: 420px; }
.kb-search input { width: 100%; box-sizing: border-box; padding: 10px 12px 10px 36px; border: 1px solid var(--line); border-radius: 12px; font: inherit; font-size: 14px; background: var(--surface); color: var(--ink); }
.kb-search span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-soft); }
.kb-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.kb-seg button { border: 0; background: var(--surface); padding: 8px 11px; cursor: pointer; color: var(--ink-soft); font-size: 14px; }
.kb-seg button.on { background: var(--accent); color: var(--accent-ink, #fff); }
.kb-h { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 800; margin: 18px 0 10px; cursor: pointer; user-select: none; }
.kb-folders { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.kb-fcard { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; cursor: pointer; text-align: left; font: inherit; color: var(--ink); box-shadow: 0 1px 2px rgba(15,23,42,.04); }
.kb-fcard:hover { border-color: var(--accent); box-shadow: 0 6px 18px rgba(15,23,42,.08); }
.kb-fcard .ic { font-size: 26px; }
.kb-fcard b { display: block; font-size: 15.5px; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-fcard small { color: var(--ink-soft); font-size: 12.5px; }
.kb-dots { position: absolute; top: 8px; right: 8px; }
.kb-table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.kb-table th { text-align: left; font-size: 12.5px; color: var(--ink-soft); font-weight: 700; padding: 10px 14px; background: color-mix(in srgb, var(--canvas) 70%, var(--surface)); }
.kb-table td { padding: 10px 14px; border-top: 1px solid var(--line); font-size: 13.5px; vertical-align: middle; }
.kb-table tr.click:hover td { background: color-mix(in srgb, var(--accent) 4%, var(--surface)); cursor: pointer; }
.kb-badge { display: inline-block; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; background: color-mix(in srgb, var(--accent) 10%, var(--surface)); color: var(--accent); }
.kb-badge.file { background: #EEF2FF; color: #3730A3; } .kb-badge.rec { background: #ECFEFF; color: #0E7490; } .kb-badge.draft { background: #FEF3C7; color: #92400E; }
.kb-star { border: 0; background: none; cursor: pointer; font-size: 18px; color: #94A3B8; padding: 2px 4px; line-height: 1; }
.kb-star.on { color: #F59E0B; }
.kb-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 60; min-width: 220px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 16px 36px rgba(15,23,42,.18); padding: 6px; text-align: left; }
.kb-mi { display: flex; align-items: center; gap: 9px; width: 100%; border: 0; background: none; padding: 8px 10px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 13.5px; color: var(--ink); text-align: left; }
.kb-mi:hover { background: var(--accent-bg); }
.kb-mi.danger { color: #B91C1C; }
.kb-mi small { display: block; color: var(--ink-soft); font-size: 11.5px; }
.kb-pager { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; flex-wrap: wrap; font-size: 13px; color: var(--ink-soft); }
.kb-lock { font-size: 12px; color: var(--ink-soft); margin-left: 4px; }
.kb-chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 700; background: var(--canvas); color: var(--ink-soft); }
.kb-in { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 14px; background: var(--surface); color: var(--ink); }
.kb-lbl { display: block; font-size: 12.5px; font-weight: 700; color: var(--ink-soft); margin: 12px 0 5px; }
@media (max-width: 700px) { .kb-hide-sm { display: none; } .kb-hero h2 { font-size: 21px; } }
/* ---------- homepage (2026-11-11, per mockup) ---------- */
.kbh-hero { position: relative; overflow: hidden; border-radius: 22px; padding: 30px 24px 34px; margin: 6px 0 18px; color: #fff; text-align: center;
  background: radial-gradient(900px 260px at 12% 0%, rgba(56,189,248,.18), transparent 60%), radial-gradient(700px 260px at 85% 40%, rgba(45,212,191,.28), transparent 60%),
              linear-gradient(115deg, #04222b 0%, #073946 32%, #0b5a66 62%, #0a6c75 80%, #063540 100%);
  box-shadow: 0 14px 34px rgba(4,34,43,.28); }
.kbh-hero h2 { position: relative; z-index: 2; margin: 0 0 16px; font-size: clamp(24px, 3.4vw, 40px); font-weight: 800; letter-spacing: -.01em; text-shadow: 0 2px 14px rgba(0,0,0,.35); }
.kbh-search { position: relative; z-index: 2; max-width: 820px; margin: 0 auto; display: flex; align-items: center; gap: 12px; background: #fff; border-radius: 999px; padding: 6px 8px 6px 20px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.kbh-search input { flex: 1; border: 0; outline: none; font: inherit; font-size: 15.5px; color: #0F2A33; background: transparent; padding: 10px 0; min-width: 0; }
.kbh-search kbd { font: inherit; font-size: 12.5px; font-weight: 700; color: #0F2A33; background: #E8F1F3; border: 1px solid #D3E3E7; border-radius: 9px; padding: 5px 10px; white-space: nowrap; }
.kbh-art { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.kbh-nav { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.kbh-tab { display: inline-flex; align-items: center; gap: 9px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 14px; padding: 10px 20px;
  font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 6px rgba(15,23,42,.05); }
.kbh-tab:hover { border-color: var(--accent); }
.kbh-tab.on { background: #0b4a57; border-color: #0b4a57; color: #fff; box-shadow: 0 6px 16px rgba(11,74,87,.28); }
.kbh-new { display: inline-flex; align-items: center; gap: 8px; border: 0; background: #0b4a57; color: #fff; border-radius: 14px; padding: 11px 20px; font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 16px rgba(11,74,87,.28); }
.kbh-sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; margin-bottom: 18px; }
.kbh-sec { position: relative; overflow: hidden; display: flex; align-items: center; gap: 18px; text-align: left; cursor: pointer; border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line));
  border-radius: 20px; padding: 20px 56px 20px 20px; min-height: 110px; color: var(--ink); font: inherit;
  background: linear-gradient(110deg, color-mix(in srgb, #2dd4bf 10%, var(--surface)) 0%, color-mix(in srgb, #0e7490 14%, var(--surface)) 100%); box-shadow: 0 4px 14px rgba(15,23,42,.06); }
.kbh-sec:hover { box-shadow: 0 10px 26px rgba(15,23,42,.12); transform: translateY(-1px); }
.kbh-sec .ic { width: 74px; height: 74px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 34px; background: color-mix(in srgb, #fff 70%, transparent); box-shadow: inset 0 0 0 1px rgba(14,116,144,.15); }
.kbh-sec b { display: block; font-size: 28px; font-weight: 800; letter-spacing: -.01em; }
.kbh-sec p { margin: 4px 0 0; font-size: 14px; line-height: 1.45; color: color-mix(in srgb, var(--ink) 80%, transparent); max-width: 520px; }
.kbh-sec .deco { position: absolute; right: 52px; top: 50%; transform: translateY(-50%); font-size: 74px; opacity: .22; filter: saturate(.6); pointer-events: none; }
.kbh-sec .chev, .kbh-fc .chev { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); font-size: 26px; color: #0b4a57; }
.kbh-card { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 18px 20px; box-shadow: 0 4px 14px rgba(15,23,42,.05); }
.kbh-hd { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.kbh-hd h3 { margin: 0; font-size: 21px; font-weight: 800; flex: 1; letter-spacing: -.01em; }
.kbh-link { border: 0; background: none; color: #0b4a57; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; font-size: 14px; }
.kbh-folders { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.kbh-fc { position: relative; display: flex; align-items: center; gap: 14px; text-align: left; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 14px;
  padding: 16px 40px 16px 16px; min-height: 72px; cursor: pointer; font: inherit; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
.kbh-fc:hover { border-color: var(--accent); box-shadow: 0 8px 20px rgba(15,23,42,.1); }
.kbh-fc b { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 15px; font-weight: 800; line-height: 1.25; overflow: hidden; overflow-wrap: anywhere; }
.kbh-fc small { color: var(--ink-soft); font-size: 13px; }
.kbh-fc .chev { font-size: 22px; right: 14px; }
.kbh-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-top: 18px; }
.kbh-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); cursor: pointer; font-size: 14px; }
.kbh-row:first-of-type { border-top: 0; }
.kbh-row:hover b { color: var(--accent); }
.kbh-row b { font-weight: 600; flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; }
.kbh-tag { font-size: 11.5px; font-weight: 800; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
.kbh-tag.up { background: #DCFCE7; color: #166534; } .kbh-tag.new { background: #EDE9FE; color: #5B21B6; }
.kbh-help-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; border: 2px solid #0b4a57; background: color-mix(in srgb, #2dd4bf 8%, var(--surface)); color: #0b4a57;
  border-radius: 16px; padding: 14px; font: inherit; font-size: 17px; font-weight: 800; cursor: pointer; margin-top: 16px; }
.kbh-help-btn:hover { background: color-mix(in srgb, #2dd4bf 18%, var(--surface)); }
.kbh-empty { color: var(--ink-soft); font-size: 13.5px; padding: 8px 0; }
/* folder view: roomier cards to match the homepage */
.kb-folders { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.kb-fcard { border-radius: 16px; padding: 18px 18px 16px; min-height: 118px; }
.kb-fcard .ic { font-size: 34px; }
.kb-fcard b { font-size: 16.5px; margin-top: 10px; }
@media (max-width: 760px) { .kbh-sections { grid-template-columns: 1fr; } .kbh-sec { padding-right: 44px; } .kbh-sec .deco { display: none; } .kbh-sec b { font-size: 22px; } .kbh-search kbd { display: none; } }
`
const fmtShort = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const shortName = (n) => { if (!n) return ''; const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] }
const typeOf = (x) => x.kind === 'article' ? (x.status === 'draft' ? ['Draft', 'draft'] : ['Article', '']) : x.kind === 'recording' ? ['Recording', 'rec']
  : [(() => { const m = x.mime_type || ''; const ext = (x.name || '').split('.').pop().toUpperCase(); return m.includes('pdf') ? 'File (PDF)' : ext && ext.length <= 4 && ext !== (x.name || '').toUpperCase() ? `File (${ext})` : 'File' })(), 'file']
const itemIcon = (x) => x.kind === 'article' ? '📄' : x.kind === 'recording' ? '🎬' : fileIcon(x.mime_type)

// the path to a folder: [section, folder, folder, …]
async function kbPath(folderId) {
  const out = []
  let cur = folderId, guard = 0, section = null
  while (cur && guard++ < 40) {
    const { data } = await supabase.from('kb_folders').select('id, name, parent_id, section_id').eq('id', cur).maybeSingle()
    if (!data) break
    out.unshift({ type: 'folder', id: data.id, name: data.name }); section = data.section_id; cur = data.parent_id
  }
  if (section) { const { data: s } = await supabase.from('kb_sections').select('id, name').eq('id', section).maybeSingle(); if (s) out.unshift({ type: 'section', id: s.id, name: s.name }) }
  return out
}
function Crumbs({ items, onOpen, current }) {
  return (
    <nav className="kb-crumbs" aria-label="Breadcrumb">
      <button onClick={() => onOpen && onOpen(null)}>🏠 Knowledge Base</button>
      {items.map((c, i) => <React.Fragment key={c.type + c.id}><span aria-hidden="true">›</span>
        {i === items.length - 1 && !current ? <b>{c.name}</b> : <button onClick={() => onOpen && onOpen(c)}>{c.name}</button>}</React.Fragment>)}
      {current && <><span aria-hidden="true">›</span><b>{current}</b></>}
    </nav>
  )
}
// folder dropdown options grouped by section, nested names indented
function folderOptions(folders) {
  const by = {}, kids = {}
  folders.forEach(f => { (kids[f.parent_id || 'root:' + f.section_id] = kids[f.parent_id || 'root:' + f.section_id] || []).push(f) })
  const sections = [...new Map(folders.map(f => [f.section_id, f.kb_sections || { name: 'Knowledge Base', sort_order: 0 }])).entries()].sort((a, b) => (a[1].sort_order || 0) - (b[1].sort_order || 0))
  return sections.map(([sid, s]) => {
    const items = []
    const walk = (key, depth) => (kids[key] || []).sort((a, b) => a.name.localeCompare(b.name)).forEach(f => { items.push({ id: f.id, label: `${'\u00a0\u00a0\u00a0'.repeat(depth)}${depth ? '↳ ' : ''}${f.name}` }); walk(f.id, depth + 1) })
    walk('root:' + sid, 0)
    return { section: s.name, items }
  })
}
// ⭐ Favorite + 🔔 Follow (only on things you can see — the server checks)
function FavFollow({ type, id, compact = false }) {
  const { user } = useAuth()
  const [fav, setFav] = useState(false), [fol, setFol] = useState(false)
  useEffect(() => { if (!user) return
    supabase.from('kb_favorites').select('object_id').eq('profile_id', user.id).eq('object_type', type).eq('object_id', id).maybeSingle().then(({ data }) => setFav(!!data))
    supabase.from('kb_follows').select('object_id').eq('profile_id', user.id).eq('object_type', type).eq('object_id', id).maybeSingle().then(({ data }) => setFol(!!data))
  }, [type, id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const flip = async (table, on, set) => {
    set(!on)
    const q = on ? supabase.from(table).delete().eq('profile_id', user.id).eq('object_type', type).eq('object_id', id)
                 : supabase.from(table).insert({ profile_id: user.id, object_type: type, object_id: id })
    const { error } = await q; if (error) set(on)
    window.dispatchEvent(new Event('kb-favs-changed'))
  }
  return <>
    <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => flip('kb_favorites', fav, setFav)} aria-pressed={fav}>{fav ? '★' : '☆'}{compact ? '' : ' Favorite'}</button>
    <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => flip('kb_follows', fol, setFol)} aria-pressed={fol} title="Get notified when this changes">{fol ? '🔔 Following' : '🔔 Follow'}</button>
  </>
}
// a small "⋯" or "+ New" dropdown that closes on outside click
function Drop({ label, className = 'btn btn-ghost', style, children, align = 'right', onOpen }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => { if (!open) return; const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [open])
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button className={className} style={style} aria-haspopup="menu" aria-expanded={open} onClick={() => { if (!open && onOpen) onOpen(); setOpen(o => !o) }}>{label}</button>
      {open && <div className="kb-menu" role="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined} onClick={() => setOpen(false)}>{children}</div>}
    </span>
  )
}
const MI = ({ icon, children, sub, onClick, danger }) => <button className={'kb-mi' + (danger ? ' danger' : '')} role="menuitem" onClick={onClick}><span style={{ width: 20, textAlign: 'center' }}>{icon}</span><span>{children}{sub && <small>{sub}</small>}</span></button>
function KbModal({ title, onClose, children, width = 620, footer }) {
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', zIndex: 3000, display: 'grid', placeItems: 'center', padding: 14 }}>
      <div role="dialog" aria-label={title} style={{ width: `min(${width}px, 100%)`, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--line)' }}><b style={{ fontSize: 16, flex: 1 }}>{title}</b><button className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={onClose} aria-label="Close">✕</button></div>
        <div style={{ padding: '14px 20px', overflow: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>{footer}</div>}
      </div>
    </div>
  )
}

// everything this person can see, loaded once (the server filters it)
function useKb() {
  const { user } = useAuth()
  const [d, setD] = useState(null)
  const load = useCallback(async () => {
    const [s, f, a, x, fav, admin, cl, pj] = await Promise.all([
      supabase.from('kb_sections').select('*').is('archived_at', null).order('sort_order').order('created_at'),
      supabase.from('kb_folders').select('id, name, description, icon, parent_id, section_id, client_id, project_id, restricted, sort_order, updated_at, created_by'),
      supabase.from('kb_articles').select('id, title, folder_id, status, restricted, author_id, updated_at, created_at, view_count'),
      supabase.from('kb_files').select('id, name, folder_id, article_id, kind, mime_type, size_bytes, restricted, uploaded_by, created_at'),
      user ? supabase.from('kb_favorites').select('object_type, object_id, created_at').eq('profile_id', user.id) : Promise.resolve({ data: [] }),
      supabase.rpc('kb_admin_powers'),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('projects').select('id, name, client_id').is('deleted_at', null).order('name'),
    ])
    const people = [...new Set([...(a.data || []).map(r => r.author_id), ...(x.data || []).map(r => r.uploaded_by)].filter(Boolean))]
    const { data: pr } = people.length ? await supabase.from('profiles').select('id, full_name').in('id', people) : { data: [] }
    setD({ sections: s.data || [], folders: f.data || [], articles: a.data || [], files: (x.data || []).filter(r => !r.article_id), attached: (x.data || []).filter(r => r.article_id),
      favs: fav.data || [], admin: admin.data || {}, clients: cl.data || [], projects: pj.data || [], names: Object.fromEntries((pr || []).map(p => [p.id, p.full_name])),
      err: s.error?.message || f.error?.message || '' })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const h = () => load(); window.addEventListener('kb-favs-changed', h); return () => window.removeEventListener('kb-favs-changed', h) }, [load])
  return [d, load]
}

export default function KnowledgeBase() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const view = params.get('view') || (params.get('id') ? 'article' : params.get('folder') ? 'folder' : 'home')
  const folderId = params.get('folder') || null
  const articleId = params.get('id') || null
  const sectionId = params.get('section') || null
  const tab = params.get('tab')
  const go = (next) => { setParams(next, { replace: false }); window.scrollTo({ top: 0 }) }
  const [kb, reload] = useKb()
  const [modal, setModal] = useState(null)   // { kind, ...props }
  const [q, setQ] = useState(params.get('q') || '')
  const searchRef = useRef(null)
  const openNode = (c) => !c ? go({}) : c.type === 'section' ? go({ section: c.id }) : go({ view: 'folder', folder: c.id })
  const openItem = (x) => x.kind === 'article' ? go({ view: 'article', id: x.id, ...(x.folder_id ? { folder: x.folder_id } : {}) })
    : x.kind === 'folder' ? go({ view: 'folder', folder: x.id }) : x.kind === 'section' ? go({ section: x.id }) : downloadKbFile(x.id).catch(e => window.alert(e.message))
  const ctx = { kb, reload, go, navigate, openNode, openItem, setModal }
  const isHome = view === 'home' && !sectionId && !tab
  const onSearch = (text) => go({ view: 'search', q: text })
  // Ctrl K on the Knowledge Base homepage / search jumps to the big search (press again for the global search)
  useEffect(() => {
    if (!(isHome || view === 'search')) return
    const h = (e) => {
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && searchRef.current && document.activeElement !== searchRef.current) {
        e.preventDefault(); e.stopImmediatePropagation(); searchRef.current.focus(); searchRef.current.select()
      }
    }
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true)
  }, [isHome, view])
  const navActive = sectionId || tab || (view === 'folders' ? null : 'all')
  const showNav = kb && (isHome || (view === 'home' && (sectionId || tab)) || view === 'folders')

  return (
    <div>
      <style>{KB_CSS}</style>
      <div className="page-head">
        <h1 className="page-title">Knowledge Base</h1>
        <p className="page-sub">Guides, SOPs, processes, call flows, and resources — all in one place.</p>
      </div>
      {kb?.err && <div className="card" style={{ color: 'var(--failed)', marginBottom: 12 }}>{kb.err}</div>}
      {(isHome || view === 'search') && <KbHero q={q} setQ={setQ} onSearch={onSearch} inputRef={searchRef} />}
      {!kb && (view === 'home' || view === 'folder' || view === 'folders') && <p className="page-sub">Loading…</p>}
      {showNav && <KbNav ctx={ctx} active={navActive} hideNew={!!sectionId && !tab} />}

      {kb && isHome && <Home ctx={ctx} />}
      {kb && view === 'home' && sectionId && !tab && (kb.sections.some(s => s.id === sectionId)
        ? <Scope ctx={ctx} key={sectionId} type="section" id={sectionId} />
        : <div className="kbh-card" style={{ textAlign: 'center' }}>This section isn't available. <button className="kbh-link" onClick={() => go({})}>Back to the Knowledge Base</button></div>)}
      {kb && view === 'home' && tab === 'favorites' && <><div className="kbh-hd"><h3>⭐ My Favorites</h3></div><FavoritesView ctx={ctx} /></>}
      {kb && view === 'home' && tab === 'recent' && <><div className="kbh-hd"><h3>🕑 Recently Updated</h3></div><RecentView ctx={ctx} /></>}
      {kb && view === 'folders' && <AllFoldersView ctx={ctx} />}
      {kb && view === 'folder' && (kb.folders.some(f => f.id === folderId)
        ? <Scope ctx={ctx} key={folderId} type="folder" id={folderId} />
        : <div className="kbh-card" style={{ textAlign: 'center' }}>This folder doesn't exist, or isn't shared with you. <button className="kbh-link" onClick={() => go({})}>Back to the Knowledge Base</button></div>)}
      {view === 'search' && kb && <SearchView ctx={ctx} initialQ={params.get('q') || ''} onQ={setQ} hideBox />}

      {view === 'trash' && kb?.admin?.restore && <TrashView onBack={() => go({})}
        onOpenArticle={(aid, fid) => go({ view: 'article', id: aid, ...(fid ? { folder: fid } : {}) })}
        onOpenFolder={(fid) => go(fid ? { view: 'folder', folder: fid } : {})} />}
      {view === 'article' && <ArticleReader id={articleId} onOpenFolder={openNode}
        onBack={() => go(folderId ? { view: 'folder', folder: folderId } : {})}
        onEdit={(aid) => go({ view: 'edit', id: aid, ...(folderId ? { folder: folderId } : {}) })} />}
      {(view === 'edit' || view === 'new') && <ArticleEditor id={view === 'edit' ? articleId : null} folderId={folderId} templateId={params.get('template')}
        onDone={(aid) => { reload(); go(aid ? { view: 'article', id: aid, ...(folderId ? { folder: folderId } : {}) } : (folderId ? { view: 'folder', folder: folderId } : {})) }}
        onCancel={() => go(articleId ? { view: 'article', id: articleId } : (folderId ? { view: 'folder', folder: folderId } : {}))} />}

      {modal?.kind === 'folder' && <FolderModal ctx={ctx} {...modal} onClose={() => setModal(null)} />}
      {modal?.kind === 'access' && <AccessModal ctx={ctx} {...modal} onClose={() => setModal(null)} />}
      {modal?.kind === 'move' && <MoveToModal ctx={ctx} {...modal} onClose={() => setModal(null)} />}
      {modal?.kind === 'sections' && <SectionsModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal?.kind === 'templates' && <TemplatesModal ctx={ctx} onClose={() => setModal(null)} />}
      {modal?.kind === 'pickTemplate' && <PickTemplateModal ctx={ctx} {...modal} onClose={() => setModal(null)} />}
      {modal?.kind === 'pickFolder' && <PickFolderModal ctx={ctx} {...modal} onClose={() => setModal(null)} />}
      {modal?.kind === 'rename' && <RenameModal ctx={ctx} {...modal} onClose={() => setModal(null)} />}
    </div>
  )
}

// all items (articles + loose files + recordings) shaped the same way
function allItems(kb) {
  return [...kb.articles.map(a => ({ kind: 'article', id: a.id, name: a.title, folder_id: a.folder_id, status: a.status, restricted: a.restricted, updated_at: a.updated_at, by: a.author_id })),
          ...kb.files.map(f => ({ kind: f.kind, id: f.id, name: f.name, folder_id: f.folder_id, mime_type: f.mime_type, restricted: f.restricted, updated_at: f.created_at, by: f.uploaded_by }))]
}
const PAGE = 10

function Scope({ ctx, type, id }) {
  const { kb, go, setModal, reload } = ctx
  const node = type === 'section' ? kb.sections.find(s => s.id === id) : kb.folders.find(f => f.id === id)
  const [pw, setPw] = useState({})
  const [crumbs, setCrumbs] = useState([])
  const [show, setShow] = useState('all')
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('kb-layout') || 'grid' } catch { return 'grid' } })
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [openF, setOpenF] = useState(true), [openI, setOpenI] = useState(true)
  const [sort, setSort] = useState({ by: 'updated', dir: -1 })
  const fileRef = useRef(null), recRef = useRef(null)
  const [uploading, setUploading] = useState('')
  const { user } = useAuth()
  useEffect(() => { supabase.rpc('kb_powers', { p_type: type, p_id: id }).then(({ data }) => setPw(data || {})) }, [type, id])
  useEffect(() => { if (type === 'folder') kbPath(id).then(setCrumbs); else setCrumbs(node ? [{ type: 'section', id: node.id, name: node.name }] : []) }, [type, id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1) }, [show, q, id])
  if (!node) return null
  const kidsF = kb.folders.filter(f => type === 'section' ? (f.section_id === id && !f.parent_id) : f.parent_id === id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name))
  const items = type === 'folder' ? allItems(kb).filter(x => x.folder_id === id) : []
  const ql = q.trim().toLowerCase()
  const fShown = kidsF.filter(f => !ql || f.name.toLowerCase().includes(ql))
  const iShown = items.filter(x => (show === 'all' || (show === 'articles' ? x.kind === 'article' : show === 'files' ? x.kind !== 'article' : false)) && (!ql || x.name.toLowerCase().includes(ql)))
    .sort((a, b) => sort.by === 'name' ? sort.dir * a.name.localeCompare(b.name) : sort.dir * (new Date(a.updated_at) - new Date(b.updated_at)))
  const counts = { articles: items.filter(x => x.kind === 'article').length, files: items.filter(x => x.kind !== 'article').length, folders: kidsF.length }
  const countIn = (fid) => kb.folders.filter(f => f.parent_id === fid).length + allItems(kb).filter(x => x.folder_id === fid).length
  const pages = Math.max(1, Math.ceil(iShown.length / PAGE)), pg = Math.min(page, pages)
  const client = (cid) => kb.clients.find(c => c.id === cid)?.name

  async function upload(e, kind) {
    const picked = Array.from(e.target.files || []); e.target.value = ''
    if (!picked.length) return
    setUploading(`Uploading ${picked.length} file${picked.length === 1 ? '' : 's'}…`)
    try { for (const file of picked) await uploadKbFile(file, { folder_id: id, article_id: null, kind }, user?.id) ; await reload() }
    catch (err) { window.alert('Upload failed: ' + err.message) } finally { setUploading('') }
  }
  const canNewHere = type === 'folder' ? (pw.create || pw.upload) : pw.create
  return (
    <div>
      <Crumbs items={crumbs} onOpen={ctx.openNode} />
      <div className="kb-hero">
        <div className="kb-hero-ic">{type === 'folder' && (!node.icon || node.icon === '📁') ? <FolderGlyph size={38} /> : (node.icon || '📚')}</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2>{node.name}{node.restricted && <span className="kb-lock" title="Restricted — only the people in its access list">🔒</span>}</h2>
          {node.description && <p>{node.description}</p>}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {type === 'folder' && client(node.client_id) && <span className="kb-chip">🏢 {client(node.client_id)}</span>}
            {type === 'folder' && node.project_id && <span className="kb-chip">📁 {kb.projects.find(p => p.id === node.project_id)?.name || 'Project'}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <FavFollow type={type} id={id} />
          {canNewHere && (
            <Drop label={<>＋ New ▾</>} className="btn btn-primary">
              {pw.create && <MI icon="📁" onClick={() => setModal({ kind: 'folder', parentType: type, parentId: id })} sub={type === 'section' ? 'A top-level folder in this section' : 'A sub-folder here'}>Folder</MI>}
              {pw.create && type === 'folder' && <MI icon="📄" onClick={() => go({ view: 'new', folder: id })} sub="Start from a blank page">Article</MI>}
              {pw.create && type === 'folder' && <MI icon="📝" onClick={() => setModal({ kind: 'pickTemplate', folderId: id })} sub="Start from one of your templates">Article from a template</MI>}
              {pw.upload && type === 'folder' && <MI icon="⬆" onClick={() => fileRef.current?.click()} sub="PDFs, docs, images, spreadsheets…">Upload files</MI>}
              {pw.upload && type === 'folder' && <MI icon="🎬" onClick={() => recRef.current?.click()} sub="Audio or video (call examples, trainings)">Upload a recording</MI>}
              {type === 'section' && pw.create && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', padding: '6px 10px' }}>Articles, files and recordings go inside folders.</div>}
            </Drop>
          )}
          <input ref={fileRef} type="file" multiple hidden onChange={e => upload(e, 'file')} />
          <input ref={recRef} type="file" multiple hidden accept="audio/*,video/*" onChange={e => upload(e, 'recording')} />
          <NodeMenu ctx={ctx} type={type} node={node} pw={pw} />
        </div>
      </div>
      {uploading && <div className="card" style={{ padding: '8px 14px', marginBottom: 10, fontSize: 13 }}>{uploading}</div>}

      <div className="kb-bar">
        {[['all', `All Items (${counts.articles + counts.files + counts.folders})`], ['articles', `Articles (${counts.articles})`], ['files', `Files (${counts.files})`], ['folders', `Folders (${counts.folders})`]]
          .filter(([k]) => type === 'folder' || k === 'all' || k === 'folders')
          .map(([k, l]) => <button key={k} className={'kb-pill' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{l}</button>)}
        <span style={{ flex: 1 }} />
        <div className="kb-seg" role="group" aria-label="Layout">
          <button className={layout === 'grid' ? 'on' : ''} onClick={() => { setLayout('grid'); try { localStorage.setItem('kb-layout', 'grid') } catch { /* private mode */ } }} aria-label="Grid">▦</button>
          <button className={layout === 'list' ? 'on' : ''} onClick={() => { setLayout('list'); try { localStorage.setItem('kb-layout', 'list') } catch { /* private mode */ } }} aria-label="List">☰</button>
        </div>
        <div className="kb-search"><span>🔍</span><input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search in ${node.name}…`} aria-label={`Search in ${node.name}`} /></div>
      </div>

      {(show === 'all' || show === 'folders') && (
        <>
          <div className="kb-h" onClick={() => setOpenF(o => !o)}><span>{openF ? '⌄' : '›'}</span>Folders</div>
          {openF && (fShown.length === 0 ? <div className="page-sub" style={{ fontSize: 13 }}>{ql ? 'No folders match.' : 'No folders here yet.'}</div>
            : layout === 'grid' ? (
              <div className="kb-folders">{fShown.map(f => (
                <div key={f.id} className="kb-fcard" role="button" tabIndex={0} onClick={() => go({ view: 'folder', folder: f.id })} onKeyDown={e => e.key === 'Enter' && go({ view: 'folder', folder: f.id })}>
                  <span className="kb-dots"><ItemMenu ctx={ctx} item={{ kind: 'folder', ...f }} /></span>
                  <span className="ic">{f.icon && f.icon !== '📁' ? f.icon : <FolderGlyph size={40} />}</span>
                  <b title={f.name}>{f.name}{f.restricted && <span className="kb-lock">🔒</span>}</b>
                  <small>{countIn(f.id)} item{countIn(f.id) === 1 ? '' : 's'}{client(f.client_id) ? ` · ${client(f.client_id)}` : ''}</small>
                </div>))}</div>
            ) : <ItemTable ctx={ctx} rows={fShown.map(f => ({ kind: 'folder', ...f, updated_at: f.updated_at }))} countIn={countIn} />)}
        </>
      )}
      {type === 'folder' && show !== 'folders' && (
        <>
          <div className="kb-h" onClick={() => setOpenI(o => !o)}><span>{openI ? '⌄' : '›'}</span>Articles & Files</div>
          {openI && (iShown.length === 0 ? <div className="page-sub" style={{ fontSize: 13 }}>{ql ? 'Nothing matches.' : 'No articles or files here yet.'}</div> : <>
            <ItemTable ctx={ctx} rows={iShown.slice((pg - 1) * PAGE, pg * PAGE)} sort={sort} onSort={(by) => setSort(s => ({ by, dir: s.by === by ? -s.dir : (by === 'name' ? 1 : -1) }))} />
            <div className="kb-pager">
              <span>Showing {(pg - 1) * PAGE + 1}–{Math.min(pg * PAGE, iShown.length)} of {iShown.length} items</span>
              {pages > 1 && <span style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost" disabled={pg === 1} onClick={() => setPage(pg - 1)} aria-label="Previous page">‹</button>
                {Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - pg) <= 1).map((n, i, arr) => (
                  <React.Fragment key={n}>{i > 0 && n - arr[i - 1] > 1 && <span style={{ padding: '6px 4px' }}>…</span>}
                    <button className={n === pg ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPage(n)}>{n}</button></React.Fragment>))}
                <button className="btn btn-ghost" disabled={pg === pages} onClick={() => setPage(pg + 1)} aria-label="Next page">›</button>
              </span>}
            </div></>)}
        </>
      )}
    </div>
  )
}

function ItemTable({ ctx, rows, sort, onSort, countIn, showWhere }) {
  const { kb } = ctx
  const favSet = new Set(kb.favs.map(f => f.object_type + ':' + f.object_id))
  const { user } = useAuth()
  const toggleFav = async (x) => {
    const t = x.kind === 'recording' ? 'file' : x.kind, on = favSet.has(t + ':' + x.id)
    const r = on ? await supabase.from('kb_favorites').delete().eq('profile_id', user.id).eq('object_type', t).eq('object_id', x.id)
                 : await supabase.from('kb_favorites').insert({ profile_id: user.id, object_type: t, object_id: x.id })
    if (r.error) window.alert(r.error.message); else ctx.reload()
  }
  const where = (x) => { const f = kb.folders.find(ff => ff.id === (x.kind === 'folder' ? x.parent_id : x.folder_id)); const s = kb.sections.find(ss => ss.id === (f?.section_id || x.section_id)); return [s?.name, f?.name].filter(Boolean).join(' › ') }
  const arrow = (k) => sort?.by === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="kb-table">
        <thead><tr>
          <th style={{ cursor: onSort ? 'pointer' : 'default' }} onClick={() => onSort && onSort('name')}>Name{arrow('name')}</th>
          <th>Type</th>
          {showWhere && <th className="kb-hide-sm">Where</th>}
          <th style={{ cursor: onSort ? 'pointer' : 'default' }} onClick={() => onSort && onSort('updated')}>Updated{arrow('updated')}</th>
          <th className="kb-hide-sm">Updated by</th><th style={{ width: 40 }} /><th style={{ width: 40 }} />
        </tr></thead>
        <tbody>{rows.map(x => { const [tl, tc] = x.kind === 'folder' ? ['Folder', ''] : typeOf(x); const t = x.kind === 'recording' ? 'file' : x.kind
          return (
            <tr key={x.kind + x.id} className="click" onClick={() => ctx.openItem(x)}>
              <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 18 }}>{x.kind === 'folder' ? (x.icon || '📁') : itemIcon(x)}</span>
                <b style={{ fontWeight: 600 }}>{x.name}</b>{x.restricted && <span className="kb-lock" title="Restricted">🔒</span>}{x.kind === 'folder' && countIn && <small className="page-sub">· {countIn(x.id)} items</small>}</span></td>
              <td><span className={'kb-badge ' + tc}>{tl}</span></td>
              {showWhere && <td className="kb-hide-sm" style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{where(x)}</td>}
              <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(x.updated_at)}</td>
              <td className="kb-hide-sm">{shortName(kb.names[x.by] || '')}</td>
              <td onClick={e => e.stopPropagation()}><button className={'kb-star' + (favSet.has(t + ':' + x.id) ? ' on' : '')} onClick={() => toggleFav(x)} aria-label={favSet.has(t + ':' + x.id) ? 'Remove from favorites' : 'Add to favorites'}>{favSet.has(t + ':' + x.id) ? '★' : '☆'}</button></td>
              <td onClick={e => e.stopPropagation()}><ItemMenu ctx={ctx} item={x} /></td>
            </tr>) })}</tbody>
      </table>
    </div>
  )
}

// "⋯" on any folder / article / file — options come from what the server says you may do
function ItemMenu({ ctx, item }) {
  const [pw, setPw] = useState(null)
  const t = item.kind === 'recording' ? 'file' : item.kind
  const { go, setModal, reload, openItem } = ctx
  const load = () => { if (!pw) supabase.rpc('kb_powers', { p_type: t, p_id: item.id }).then(({ data }) => setPw(data || {})) }
  async function del() {
    if (t === 'folder') {
      const inside = ctx.kb.folders.some(f => f.parent_id === item.id) || allItems(ctx.kb).some(x => x.folder_id === item.id)
      if (inside) return window.alert(`"${item.name}" isn't empty. Move or delete what's inside first.`)
      if (!window.confirm(`Delete the folder "${item.name}"?`)) return
    } else if (!window.confirm(`Move "${item.name}" to Trash?\n\nIt can be restored from 🗑 Trash for 60 days.`)) return
    const { error, count } = await supabase.from(t === 'folder' ? 'kb_folders' : t === 'article' ? 'kb_articles' : 'kb_files').delete({ count: 'exact' }).eq('id', item.id)
    if (error || count === 0) window.alert(error?.message || "You don't have permission to delete this."); else reload()
  }
  return (
    <Drop label="⋯" className="btn btn-ghost" style={{ padding: '2px 9px', fontSize: 16, lineHeight: 1 }} onOpen={load}>
      {!pw ? <div style={{ padding: 10, fontSize: 13, color: 'var(--ink-soft)' }}>Loading…</div> : <>
        <MI icon={t === 'file' ? '⬇' : '↗'} onClick={() => openItem(item)}>{t === 'file' ? (pw.download ? 'Download' : 'Open') : 'Open'}</MI>
        {pw.edit && t === 'article' && <MI icon="✏️" onClick={() => go({ view: 'edit', id: item.id, ...(item.folder_id ? { folder: item.folder_id } : {}) })}>Edit</MI>}
        {pw.edit && t === 'folder' && <MI icon="✏️" onClick={() => setModal({ kind: 'folder', editId: item.id })}>Edit folder</MI>}
        {pw.edit && t === 'file' && <MI icon="✏️" onClick={() => setModal({ kind: 'rename', item })}>Rename</MI>}
        {pw.move && <MI icon="↪" onClick={() => setModal({ kind: 'move', item })}>Move…</MI>}
        {pw.manage_permissions && <MI icon="🔒" onClick={() => setModal({ kind: 'access', objType: t, objId: item.id, name: item.name })} sub="Who can view, edit, download…">Manage access</MI>}
        {pw.delete && <MI icon="🗑" danger onClick={del}>{t === 'folder' ? 'Delete folder' : 'Move to Trash'}</MI>}
        {!pw.edit && !pw.move && !pw.manage_permissions && !pw.delete && <div style={{ padding: '4px 10px 6px', fontSize: 11.5, color: 'var(--ink-soft)' }}>You can view this.</div>}
      </>}
    </Drop>
  )
}
// "⋯" for the section / folder you're in
function NodeMenu({ ctx, type, node, pw }) {
  const { setModal, kb } = ctx
  const items = [
    pw.edit && type === 'folder' && <MI key="e" icon="✏️" onClick={() => setModal({ kind: 'folder', editId: node.id })}>Edit folder</MI>,
    pw.move && type === 'folder' && <MI key="m" icon="↪" onClick={() => setModal({ kind: 'move', item: { kind: 'folder', ...node } })}>Move…</MI>,
    pw.manage_permissions && <MI key="a" icon="🔒" onClick={() => setModal({ kind: 'access', objType: type, objId: node.id, name: node.name })} sub="Who can view, edit, download…">Manage access</MI>,
    type === 'section' && kb.admin.sections && <MI key="s" icon="⚙" onClick={() => setModal({ kind: 'sections' })}>Edit sections</MI>,
  ].filter(Boolean)
  if (!items.length) return null
  return <Drop label="⋯" className="btn btn-ghost">{items}</Drop>
}

function FavoritesView({ ctx }) {
  const { kb } = ctx
  const rows = kb.favs.map(f => {
    if (f.object_type === 'folder') { const x = kb.folders.find(y => y.id === f.object_id); return x && { kind: 'folder', ...x } }
    if (f.object_type === 'section') { const x = kb.sections.find(y => y.id === f.object_id); return x && { kind: 'section', id: x.id, name: x.name, icon: x.icon, updated_at: x.updated_at } }
    return allItems(kb).find(y => y.id === f.object_id)
  }).filter(Boolean)      // only things you can still see
  return rows.length === 0 ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-soft)' }}>No favorites yet. Tap ☆ on anything to keep it here.</div>
    : <ItemTable ctx={ctx} rows={rows} showWhere />
}
function RecentView({ ctx }) {
  const rows = allItems(ctx.kb).filter(x => x.status !== 'draft').sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 30)
  return rows.length === 0 ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-soft)' }}>Nothing yet.</div> : <ItemTable ctx={ctx} rows={rows} showWhere />
}

// ---------- global search (server-filtered to what you may view) ----------
function SearchView({ ctx, initialQ, onQ, hideBox }) {
  const { kb } = ctx
  const [q, setQ] = useState(initialQ)
  const [f, setF] = useState({ section: '', client: '', project: '', type: '', folder: '' })
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async () => {
    setBusy(true)
    const types = f.type ? [f.type] : null
    const { data, error } = await supabase.rpc('kb_search2', { q: q.trim() || null, p_section: f.section || null, p_client: f.client || null, p_project: f.project || null, p_types: types, p_folder: f.folder || null, p_limit: 200 })
    setBusy(false); setRows(error ? [] : (data || []))
  }, [q, f])
  useEffect(() => { setQ(initialQ) }, [initialQ])
  useEffect(() => { if (hideBox) run() }, [initialQ]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q.trim() || Object.values(f).some(Boolean)) run(); else setRows(null) }, [f, initialQ]) // eslint-disable-line react-hooks/exhaustive-deps
  const sel = (k, label, opts) => (
    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>{label}
      <select className="kb-in" style={{ display: 'block', marginTop: 4, minWidth: 150 }} value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value, ...(k === 'client' ? { project: '' } : {}) }))}>
        <option value="">Any</option>{opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select></label>)
  const fOpts = folderOptions(kb.folders.map(x => ({ ...x, kb_sections: kb.sections.find(s => s.id === x.section_id) })))
  const results = (rows || []).map(r => ({ ...r, kind: r.kind, name: r.title, updated_at: r.updated_at, by: (kb.articles.find(a => a.id === r.id)?.author_id) || (kb.files.find(x => x.id === r.id)?.uploaded_by),
    mime_type: kb.files.find(x => x.id === r.id)?.mime_type, status: kb.articles.find(a => a.id === r.id)?.status, folder_id: r.kind === 'folder' ? undefined : r.folder_id, parent_id: r.kind === 'folder' ? r.folder_id : undefined, section_id: r.section_id }))
  return (
    <div>
      {!hideBox && <form className="kb-bar" onSubmit={e => { e.preventDefault(); onQ(q); run() }}>
        <div className="kb-search" style={{ maxWidth: 'none', flex: '1 1 320px' }}><span>🔍</span><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles, files, recordings and folders…" aria-label="Search" /></div>
        <button className="btn btn-primary" type="submit">Search</button>
      </form>}
      <div className="kb-bar" style={{ alignItems: 'flex-end' }}>
        {sel('section', 'Section', kb.sections)}
        {kb.clients.length > 0 && sel('client', 'Client', kb.clients)}
        {kb.projects.length > 0 && sel('project', 'Project', kb.projects.filter(p => !f.client || p.client_id === f.client))}
        {sel('type', 'Type', [{ id: 'article', name: 'Articles' }, { id: 'file', name: 'Files' }, { id: 'recording', name: 'Recordings' }, { id: 'folder', name: 'Folders' }])}
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>Folder
          <select className="kb-in" style={{ display: 'block', marginTop: 4, minWidth: 180 }} value={f.folder} onChange={e => setF(x => ({ ...x, folder: e.target.value }))}>
            <option value="">Any (includes sub-folders)</option>{fOpts.map(g => <optgroup key={g.section} label={g.section}>{g.items.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)}
          </select></label>
        {Object.values(f).some(Boolean) && <button className="btn btn-ghost" onClick={() => setF({ section: '', client: '', project: '', type: '', folder: '' })}>Clear filters</button>}
      </div>
      {busy ? <p className="page-sub">Searching…</p> : rows === null ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-soft)' }}>Type something to search, or pick a filter.</div>
        : results.length === 0 ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-soft)' }}>No results{q ? ` for “${q}”` : ''}.</div>
        : <><div className="page-sub" style={{ fontSize: 13, marginBottom: 8 }}>{results.length} result{results.length === 1 ? '' : 's'}</div><ItemTable ctx={ctx} rows={results} showWhere /></>}
    </div>
  )
}

// ---------- create / edit a folder ----------
function FolderModal({ ctx, parentType, parentId, editId, onClose }) {
  const { kb, reload, go } = ctx
  const ex = editId ? kb.folders.find(f => f.id === editId) : null
  const parent = parentType === 'folder' ? kb.folders.find(f => f.id === parentId) : null
  const [v, setV] = useState({ name: ex?.name || '', description: ex?.description || '', icon: ex?.icon || '📁', client_id: ex?.client_id || '', project_id: ex?.project_id || '' })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (k, x) => setV(o => ({ ...o, [k]: x }))
  async function save() {
    if (!v.name.trim()) return setErr('Name the folder.')
    setBusy(true); setErr('')
    const row = { name: v.name.trim(), description: v.description.trim() || null, icon: v.icon || '📁', client_id: v.client_id || null, project_id: v.project_id || null, updated_at: new Date().toISOString() }
    const r = ex ? await supabase.from('kb_folders').update(row).eq('id', ex.id).select('id').single()
      : await supabase.from('kb_folders').insert({ ...row, parent_id: parentType === 'folder' ? parentId : null, section_id: parentType === 'section' ? parentId : parent?.section_id, created_by: (await supabase.auth.getUser()).data.user?.id }).select('id').single()
    setBusy(false)
    if (r.error) return setErr(/row-level|policy/i.test(r.error.message) ? "You don't have permission to do that here." : r.error.message)
    await reload(); onClose(); if (!ex) go({ view: 'folder', folder: r.data.id })
  }
  const inherited = !ex && parent ? (kb.clients.find(c => c.id === parent.client_id)?.name) : null
  return (
    <KbModal title={ex ? 'Edit folder' : 'New folder'} onClose={onClose} width={520}
      footer={<><span style={{ color: '#B91C1C', fontSize: 13, marginRight: 'auto' }}>{err}</span><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : ex ? 'Save' : 'Create folder'}</button></>}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ width: 70 }}><label className="kb-lbl">Icon</label><input className="kb-in" value={v.icon} maxLength={4} onChange={e => set('icon', e.target.value)} style={{ textAlign: 'center', fontSize: 20 }} aria-label="Icon (emoji)" /></div>
        <div style={{ flex: 1 }}><label className="kb-lbl">Name</label><input className="kb-in" autoFocus value={v.name} maxLength={120} onChange={e => set('name', e.target.value)} placeholder="e.g. Web Leads" /></div>
      </div>
      <label className="kb-lbl">Description <span style={{ fontWeight: 400 }}>(optional)</span></label>
      <textarea className="kb-in" rows={2} value={v.description} onChange={e => set('description', e.target.value)} placeholder="What's in this folder?" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}><label className="kb-lbl">Client <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <select className="kb-in" value={v.client_id} onChange={e => { set('client_id', e.target.value); set('project_id', '') }}><option value="">{inherited ? `Same as parent (${inherited})` : 'None'}</option>{kb.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div style={{ flex: '1 1 200px' }}><label className="kb-lbl">Project <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <select className="kb-in" value={v.project_id} onChange={e => set('project_id', e.target.value)}><option value="">None</option>{kb.projects.filter(p => !v.client_id || p.client_id === v.client_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </div>
      <p className="page-sub" style={{ fontSize: 12, marginTop: 10 }}>Everything inside belongs to this client/project too — so client- or project-scoped roles can work here, and search can filter by it. {ex ? '' : 'New folders get the same access as where you create them; change it after with ⋯ → Manage access.'}</p>
    </KbModal>
  )
}

function RenameModal({ ctx, item, onClose }) {
  const [name, setName] = useState(item.name), [err, setErr] = useState('')
  async function save() {
    const { error, count } = await supabase.from('kb_files').update({ name: name.trim() }, { count: 'exact' }).eq('id', item.id)
    if (error || !count) return setErr(error?.message || "You don't have permission to rename this.")
    await ctx.reload(); onClose()
  }
  return <KbModal title="Rename file" onClose={onClose} width={460} footer={<><span style={{ color: '#B91C1C', fontSize: 13, marginRight: 'auto' }}>{err}</span><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Save</button></>}>
    <input className="kb-in" autoFocus value={name} onChange={e => setName(e.target.value)} aria-label="File name" />
  </KbModal>
}

// ---------- move a folder / article / file ----------
function MoveToModal({ ctx, item, onClose }) {
  const { kb, reload } = ctx
  const t = item.kind === 'recording' ? 'file' : item.kind
  const [dest, setDest] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  // can't move a folder into itself or its sub-folders
  const blocked = new Set()
  if (t === 'folder') { const walk = (id) => { blocked.add(id); kb.folders.filter(f => f.parent_id === id).forEach(f => walk(f.id)) }; walk(item.id) }
  const opts = folderOptions(kb.folders.filter(f => !blocked.has(f.id)).map(x => ({ ...x, kb_sections: kb.sections.find(s => s.id === x.section_id) })))
  async function move() {
    if (!dest) return setErr('Choose where to move it.')
    setBusy(true); setErr('')
    const [dt, did] = dest.split(':')
    const patch = t === 'folder' ? (dt === 'section' ? { parent_id: null, section_id: did } : { parent_id: did }) : { folder_id: did }
    const { error, count } = await supabase.from(t === 'folder' ? 'kb_folders' : t === 'article' ? 'kb_articles' : 'kb_files').update(patch, { count: 'exact' }).eq('id', item.id)
    setBusy(false)
    if (error || !count) return setErr(error?.message || "You don't have permission to move it there.")
    await reload(); onClose()
  }
  return (
    <KbModal title={`Move “${item.name}”`} onClose={onClose} width={520}
      footer={<><span style={{ color: '#B91C1C', fontSize: 13, marginRight: 'auto' }}>{err}</span><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !dest} onClick={move}>{busy ? 'Moving…' : 'Move here'}</button></>}>
      <label className="kb-lbl">Move to</label>
      <select className="kb-in" value={dest} onChange={e => setDest(e.target.value)} size={12} style={{ height: 'auto' }}>
        {t === 'folder' && <optgroup label="Top level of a section">{kb.sections.map(s => <option key={s.id} value={'section:' + s.id}>{s.icon} {s.name}</option>)}</optgroup>}
        {opts.map(g => <optgroup key={g.section} label={g.section}>{g.items.map(o => <option key={o.id} value={'folder:' + o.id}>{o.label}</option>)}</optgroup>)}
      </select>
      <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>Unless it has its own access list, it will follow the access of its new location.</p>
    </KbModal>
  )
}

// ---------- Manage access (inherit vs restricted, and who can do what) ----------
const ACTIONS = [['view', 'View'], ['download', 'Download'], ['create', 'Create'], ['upload', 'Upload'], ['edit', 'Edit'], ['move', 'Move'], ['delete', 'Delete'], ['restore', 'Restore'], ['manage_permissions', 'Manage access']]
const PRESETS = [['viewer', 'Can view', ['view', 'download']], ['contrib', 'Can contribute', ['view', 'download', 'create', 'upload', 'edit']],
  ['editor', 'Can edit & organize', ['view', 'download', 'create', 'upload', 'edit', 'move', 'delete', 'restore']], ['full', 'Full control', ACTIONS.map(a => a[0])]]
const presetOf = (acts) => (PRESETS.find(p => p[2].length === acts.length && p[2].every(a => acts.includes(a))) || ['custom'])[0]
const PTYPES = [['everyone', 'Everyone'], ['role', 'Role'], ['team', 'Team / tag'], ['person', 'Person'], ['client', "A client's people"], ['project', "A project's people"]]
function AccessModal({ ctx, objType, objId, name, onClose }) {
  const { kb, reload } = ctx
  const table = { section: 'kb_sections', folder: 'kb_folders', article: 'kb_articles', file: 'kb_files' }[objType]
  const [restricted, setRestricted] = useState(null), [rows, setRows] = useState(null), [orig, setOrig] = useState([])
  const [opts, setOpts] = useState({ role: [], team: [], person: [], client: [], project: [] })
  const [add, setAdd] = useState({ type: 'role', id: '', preset: 'viewer' })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [open, setOpen] = useState(null)
  useEffect(() => { (async () => {
    const [o, g, r, t, p] = await Promise.all([supabase.from(table).select('restricted').eq('id', objId).maybeSingle(), supabase.from('kb_grants').select('*').eq('object_type', objType).eq('object_id', objId),
      supabase.from('access_roles').select('id, name').is('archived_at', null).order('sort'), supabase.from('tags').select('id, name, namespace').order('namespace').order('name'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')])
    if (g.error) { setErr("You don't have permission to manage access here."); setRows([]); return }
    setRestricted(!!o.data?.restricted); setRows((g.data || []).map(x => ({ ...x }))); setOrig(g.data || [])
    setOpts({ role: (r.data || []).map(x => ({ id: x.id, name: x.name })), team: (t.data || []).map(x => ({ id: x.id, name: `${x.namespace ? x.namespace[0].toUpperCase() + x.namespace.slice(1) + ': ' : ''}${x.name}` })),
      person: (p.data || []).map(x => ({ id: x.id, name: x.full_name })), client: kb.clients, project: kb.projects })
  })() }, [objType, objId]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = (g) => g.principal_type === 'everyone' ? 'Everyone' : g.principal_type === 'legacy_role' ? `Job role: ${g.principal_id}` :
    `${PTYPES.find(x => x[0] === g.principal_type)?.[1]}: ${(opts[g.principal_type] || []).find(o => o.id === g.principal_id)?.name || '…'}`
  const parentName = objType === 'section' ? null : objType === 'folder' ? (() => { const f = kb.folders.find(x => x.id === objId); return f?.parent_id ? kb.folders.find(x => x.id === f.parent_id)?.name : kb.sections.find(s => s.id === f?.section_id)?.name })() : 'its folder'
  function addRow() {
    if (add.type !== 'everyone' && !add.id) return
    const pid = add.type === 'everyone' ? '' : add.id
    if (rows.some(r => r.principal_type === add.type && r.principal_id === pid)) return setErr('Already in the list — change their permissions below.')
    setErr(''); setRows(rs => [...rs, { principal_type: add.type, principal_id: pid, actions: PRESETS.find(p => p[0] === add.preset)[2], _new: true }]); setAdd(a => ({ ...a, id: '' }))
  }
  async function save() {
    setBusy(true); setErr('')
    if (restricted && !rows.some(r => r.actions.includes('view')) && !window.confirm('Nobody in the list can view this, so only Knowledge Base managers will see it. Continue?')) { setBusy(false); return }
    const removed = orig.filter(o => !rows.some(r => r.principal_type === o.principal_type && r.principal_id === o.principal_id))
    for (const r of removed) { const { error } = await supabase.from('kb_grants').delete().eq('id', r.id); if (error) { setBusy(false); return setErr(error.message) } }
    const up = rows.filter(r => r.actions.length).map(r => ({ object_type: objType, object_id: objId, principal_type: r.principal_type, principal_id: r.principal_id, actions: r.actions }))
    if (up.length) { const { error } = await supabase.from('kb_grants').upsert(up, { onConflict: 'object_type,object_id,principal_type,principal_id' }); if (error) { setBusy(false); return setErr(error.message) } }
    for (const r of rows.filter(r => !r.actions.length && r.id)) await supabase.from('kb_grants').delete().eq('id', r.id)
    if (restricted !== null) { const { error } = await supabase.from(table).update({ restricted }).eq('id', objId); if (error) { setBusy(false); return setErr(error.message) } }
    setBusy(false); await reload(); onClose()
  }
  return (
    <KbModal title={`Manage access · ${name}`} onClose={onClose} width={720}
      footer={<><span style={{ color: '#B91C1C', fontSize: 13, marginRight: 'auto' }}>{err}</span><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || rows === null} onClick={save}>{busy ? 'Saving…' : 'Save access'}</button></>}>
      {rows === null ? <p className="page-sub">Loading…</p> : <>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', background: !restricted ? 'var(--accent-bg)' : 'transparent' }}>
            <input type="radio" checked={!restricted} onChange={() => setRestricted(false)} style={{ marginTop: 3 }} />
            <span><b>Follow {objType === 'section' ? 'the Access & Permissions settings' : parentName ? `“${parentName}”` : 'its parent'}</b> <span className="page-sub" style={{ fontSize: 12.5 }}>(default)</span>
              <div className="page-sub" style={{ fontSize: 12.5 }}>Everyone who can access {objType === 'section' ? 'the Knowledge Base' : 'the parent'} can access this. People below get extra permissions on top.</div></span>
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', background: restricted ? 'var(--accent-bg)' : 'transparent' }}>
            <input type="radio" checked={!!restricted} onChange={() => setRestricted(true)} style={{ marginTop: 3 }} />
            <span><b>🔒 Restricted — only the people below</b>
              <div className="page-sub" style={{ fontSize: 12.5 }}>Hidden from everyone else (also in search, favorites and recent). {objType === 'folder' || objType === 'section' ? 'Everything inside follows this list unless it has its own.' : ''} Knowledge Base managers always have access.</div></span>
          </label>
        </div>
        <div style={{ fontWeight: 800, margin: '16px 0 8px' }}>People and groups</div>
        {rows.length === 0 ? <div className="page-sub" style={{ fontSize: 13, marginBottom: 8 }}>{restricted ? 'Nobody yet — add people below.' : 'No extra permissions here.'}</div> : rows.map((r, i) => (
          <div key={r.principal_type + r.principal_id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ flex: '1 1 200px', fontSize: 13.5 }}>{label(r)}</b>
              <select className="kb-in" style={{ width: 'auto' }} value={presetOf(r.actions)} onChange={e => { const p = PRESETS.find(x => x[0] === e.target.value); if (p) setRows(rs => rs.map((x, j) => j === i ? { ...x, actions: p[2] } : x)); else setOpen(i) }}>
                {PRESETS.map(p => <option key={p[0]} value={p[0]}>{p[1]}</option>)}<option value="custom">Custom…</option>
              </select>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Hide' : 'Details'}</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, color: '#B91C1C' }} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
            </div>
            {open === i && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>{ACTIONS.map(([k, l]) => (
              <label key={k} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12.5 }}><input type="checkbox" checked={r.actions.includes(k)}
                onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, actions: e.target.checked ? [...x.actions, k] : x.actions.filter(a => a !== k) } : x))} />{l}</label>))}</div>}
          </div>))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, padding: 10, background: 'var(--canvas)', borderRadius: 10 }}>
          <select className="kb-in" style={{ width: 'auto' }} value={add.type} onChange={e => setAdd({ ...add, type: e.target.value, id: '' })}>{PTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {add.type !== 'everyone' && <select className="kb-in" style={{ flex: '1 1 200px', width: 'auto' }} value={add.id} onChange={e => setAdd({ ...add, id: e.target.value })}>
            <option value="">Choose…</option>{(opts[add.type] || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          <select className="kb-in" style={{ width: 'auto' }} value={add.preset} onChange={e => setAdd({ ...add, preset: e.target.value })}>{PRESETS.map(p => <option key={p[0]} value={p[0]}>{p[1]}</option>)}</select>
          <button className="btn btn-primary" onClick={addRow}>Add</button>
        </div>
        <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>“A client's / project's people” = everyone on its schedules or assigned its tasks. Everything here is enforced by the server.</p>
      </>}
    </KbModal>
  )
}

// ---------- Sections (unlimited, rename, reorder, archive) ----------
function SectionsModal({ ctx, onClose }) {
  const { reload } = ctx
  const [list, setList] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(() => supabase.from('kb_sections').select('*').order('sort_order').order('created_at').then(({ data, error }) => { if (error) setErr(error.message); setList(data || []) }), [])
  useEffect(() => { load() }, [load])
  const upd = (i, patch) => setList(l => l.map((s, j) => j === i ? { ...s, ...patch, _dirty: true } : s))
  const mv = (i, d) => setList(l => { const j = i + d; if (j < 0 || j >= l.length) return l; const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c.map((s, k) => ({ ...s, sort_order: k + 1, _dirty: true })) })
  async function save() {
    setBusy(true); setErr('')
    for (const s of list) {
      if (!s.name?.trim()) { setBusy(false); return setErr('Every section needs a name.') }
      const row = { name: s.name.trim(), description: s.description || null, icon: s.icon || '📚', sort_order: s.sort_order, archived_at: s.archived_at || null, updated_at: new Date().toISOString() }
      const r = s.id ? (s._dirty ? await supabase.from('kb_sections').update(row).eq('id', s.id) : { error: null }) : await supabase.from('kb_sections').insert(row)
      if (r.error) { setBusy(false); return setErr(r.error.message) }
    }
    setBusy(false); await reload(); onClose()
  }
  async function archive(i) {
    const s = list[i]
    if (s.id) { const { count } = await supabase.from('kb_folders').select('id', { count: 'exact', head: true }).eq('section_id', s.id)
      if (count) return setErr(`“${s.name}” still has ${count} folder${count === 1 ? '' : 's'}. Move them to another section first.`) }
    upd(i, { archived_at: s.archived_at ? null : new Date().toISOString() })
  }
  return (
    <KbModal title="Sections" onClose={onClose} width={680}
      footer={<><span style={{ color: '#B91C1C', fontSize: 13, marginRight: 'auto' }}>{err}</span><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !list} onClick={save}>{busy ? 'Saving…' : 'Save sections'}</button></>}>
      <p className="page-sub" style={{ fontSize: 13, marginTop: 0 }}>Sections are the top level of your Knowledge Base — name them however your organization works (e.g. Agents, Internal, Training, Clients). Use ↑ ↓ to set the order.</p>
      {!list ? <p className="page-sub">Loading…</p> : list.map((s, i) => (
        <div key={s.id || 'n' + i} style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 12, padding: 8, marginBottom: 6, opacity: s.archived_at ? .55 : 1 }}>
          <input className="kb-in" style={{ width: 52, textAlign: 'center', fontSize: 18 }} value={s.icon || ''} maxLength={4} onChange={e => upd(i, { icon: e.target.value })} aria-label="Icon" />
          <div style={{ flex: 1, display: 'grid', gap: 4 }}>
            <input className="kb-in" value={s.name || ''} maxLength={80} onChange={e => upd(i, { name: e.target.value })} placeholder="Section name" aria-label="Section name" />
            <input className="kb-in" style={{ fontSize: 12.5 }} value={s.description || ''} onChange={e => upd(i, { description: e.target.value })} placeholder="Short description (optional)" aria-label="Description" />
          </div>
          <button className="btn btn-ghost" onClick={() => mv(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
          <button className="btn btn-ghost" onClick={() => mv(i, 1)} disabled={i === list.length - 1} aria-label="Move down">↓</button>
          {s.id ? <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => archive(i)}>{s.archived_at ? 'Restore' : 'Archive'}</button>
            : <button className="btn btn-ghost" style={{ color: '#B91C1C' }} onClick={() => setList(l => l.filter((_, j) => j !== i))} aria-label="Remove">✕</button>}
        </div>))}
      {list && <button className="btn btn-ghost" onClick={() => setList(l => [...l, { name: '', icon: '📚', description: '', sort_order: l.length + 1, _dirty: true }])}>＋ Add section</button>}
      <p className="page-sub" style={{ fontSize: 12 }}>Who can see a section: open it and use ⋯ → Manage access.</p>
    </KbModal>
  )
}

// ---------- Templates (your own + optional starters) ----------
function TemplatesModal({ ctx, onClose }) {
  const { kb } = ctx
  const [list, setList] = useState(null), [edit, setEdit] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const bodyRef = useRef('')
  const load = useCallback(() => supabase.from('kb_templates').select('*').order('sort_order').order('name').then(({ data }) => setList(data || [])), [])
  useEffect(() => { load() }, [load])
  async function save() {
    if (!edit.name?.trim()) return setErr('Name the template.')
    setBusy(true); setErr('')
    const row = { name: edit.name.trim(), description: edit.description || null, icon: edit.icon || '📝', body: bodyRef.current || '', section_id: edit.section_id || null, updated_at: new Date().toISOString() }
    const r = edit.id ? await supabase.from('kb_templates').update(row).eq('id', edit.id) : await supabase.from('kb_templates').insert({ ...row, sort_order: (list?.length || 0) + 1 })
    setBusy(false)
    if (r.error) return setErr(r.error.message)
    setEdit(null); load()
  }
  async function toggleArchive(t) { await supabase.from('kb_templates').update({ archived_at: t.archived_at ? null : new Date().toISOString() }).eq('id', t.id); load() }
  return (
    <KbModal title={edit ? (edit.id ? `Edit template · ${edit.name}` : 'New template') : 'Article templates'} onClose={onClose} width={edit ? 900 : 640}
      footer={edit ? <><span style={{ color: '#B91C1C', fontSize: 13, marginRight: 'auto' }}>{err}</span><button className="btn btn-ghost" onClick={() => setEdit(null)}>Back</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button></> : null}>
      {!edit ? (!list ? <p className="page-sub">Loading…</p> : <>
        <p className="page-sub" style={{ fontSize: 13, marginTop: 0 }}>Reusable starting points for new articles. Edit the starters or make your own; archived templates stop showing in ＋ New.</p>
        {list.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', marginBottom: 6, opacity: t.archived_at ? .55 : 1 }}>
            <span style={{ fontSize: 22 }}>{t.icon}</span>
            <span style={{ flex: 1 }}><b>{t.name}</b>{t.is_starter && <span className="kb-chip" style={{ marginLeft: 6 }}>Starter</span>}{t.section_id && <span className="kb-chip" style={{ marginLeft: 6 }}>{kb.sections.find(s => s.id === t.section_id)?.name}</span>}
              <div className="page-sub" style={{ fontSize: 12.5 }}>{t.description}</div></span>
            <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => { bodyRef.current = t.body || ''; setEdit({ ...t }) }}>Edit</button>
            <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => toggleArchive(t)}>{t.archived_at ? 'Restore' : 'Archive'}</button>
          </div>))}
        <button className="btn btn-primary" onClick={() => { bodyRef.current = ''; setEdit({ name: '', icon: '📝', description: '' }) }}>＋ New template</button>
      </>) : <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 70 }}><label className="kb-lbl">Icon</label><input className="kb-in" value={edit.icon} maxLength={4} onChange={e => setEdit({ ...edit, icon: e.target.value })} style={{ textAlign: 'center', fontSize: 20 }} /></div>
          <div style={{ flex: '1 1 240px' }}><label className="kb-lbl">Name</label><input className="kb-in" value={edit.name} maxLength={80} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
          <div style={{ flex: '1 1 200px' }}><label className="kb-lbl">Suggest in section</label><select className="kb-in" value={edit.section_id || ''} onChange={e => setEdit({ ...edit, section_id: e.target.value })}><option value="">All sections</option>{kb.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        </div>
        <label className="kb-lbl">Description</label><input className="kb-in" value={edit.description || ''} onChange={e => setEdit({ ...edit, description: e.target.value })} />
        <label className="kb-lbl">Template content</label>
        <RichEditor key={edit.id || 'new'} value={bodyRef.current} variant="full" minHeight={240} placeholder="Headings and prompts people will fill in…" onChange={(html) => { bodyRef.current = html }} />
      </>}
    </KbModal>
  )
}
function PickTemplateModal({ ctx, folderId, onClose }) {
  const { kb, go } = ctx
  const [list, setList] = useState(null)
  const section = kb.folders.find(f => f.id === folderId)?.section_id
  useEffect(() => { supabase.from('kb_templates').select('id, name, description, icon, section_id').is('archived_at', null).order('sort_order').order('name').then(({ data }) => setList((data || []).filter(t => !t.section_id || t.section_id === section))) }, [section])
  return (
    <KbModal title="New article from a template" onClose={onClose} width={620}>
      {!list ? <p className="page-sub">Loading…</p> : list.length === 0 ? <p className="page-sub">No templates yet.{kb.admin.templates ? ' Add some with 📝 Templates.' : ''}</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
          {list.map(t => <button key={t.id} className="kb-fcard" onClick={() => { onClose(); go({ view: 'new', folder: folderId, template: t.id }) }}>
            <span className="ic">{t.icon}</span><b>{t.name}</b><small>{t.description}</small></button>)}
        </div>)}
    </KbModal>
  )
}

// ---------- Trash ----------
function TrashView({ onBack, onOpenArticle, onOpenFolder }) {
  const [rows, setRows] = useState(null)
  const [names, setNames] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(null)
  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.from('kb_trash')
      .select('id, kind, item_id, title, parent_article_id, folder_id, deleted_by, deleted_at, purge_after')
      .order('deleted_at', { ascending: false })
    if (error) { setErr(error.message); return }
    // an article's attachments show under the article, not as separate rows
    const articleIds = new Set((data || []).filter(r => r.kind === 'article').map(r => r.item_id))
    const list = (data || []).filter(r => !(r.kind === 'file' && r.parent_article_id && articleIds.has(r.parent_article_id)))
    list.forEach(r => { r.attachments = (data || []).filter(x => x.kind === 'file' && x.parent_article_id === r.item_id && r.kind === 'article').length })
    setRows(list)
    const ids = [...new Set((data || []).map(r => r.deleted_by).filter(Boolean))]
    if (ids.length) {
      const { data: p } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      const m = {}; (p || []).forEach(x => { m[x.id] = x.full_name }); setNames(m)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function restore(r) {
    setBusy(r.id); setErr('')
    const { data, error } = await supabase.rpc('kb_trash_restore', { p_id: r.id })
    setBusy(null)
    if (error) { setErr(error.message); return }
    await load()
    if (data?.kind === 'article') onOpenArticle(data.id, data.folder_id)
  }
  async function forget(r) {
    const what = r.kind === 'article' ? `the article "${r.title}"${r.attachments ? ` and its ${r.attachments} attached file${r.attachments === 1 ? '' : 's'}` : ''}` : `"${r.title}"`
    if (!window.confirm(`Permanently delete ${what}?\n\nThis can't be undone.`)) return
    setBusy(r.id); setErr('')
    const { data: paths, error } = await supabase.rpc('kb_trash_forget', { p_id: r.id })
    if (!error && paths?.length) await supabase.storage.from('kb-files').remove(paths)
    setBusy(null)
    if (error) setErr(error.message); else load()
  }
  const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 864e5))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back to folders</button>
        <h2 style={{ margin: 0, fontSize: 18 }}>🗑 Trash</h2>
      </div>
      <p className="page-sub" style={{ margin: '0 0 14px' }}>Deleted articles and files stay here for 60 days, then they're deleted for good. Only Knowledge Base editors can see Trash.</p>
      {err && <div className="login-err" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
      {!rows ? <p className="page-sub">Loading…</p> : rows.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>Trash is empty.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {rows.map(r => {
            const left = daysLeft(r.purge_after)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18 }} aria-hidden="true">{r.kind === 'article' ? '📄' : '📎'}</span>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.title || '(untitled)'}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    {r.kind === 'article' ? 'Article' : 'File'}{r.attachments ? ` · ${r.attachments} attached file${r.attachments === 1 ? '' : 's'}` : ''}
                    {' · '}deleted {new Date(r.deleted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {r.deleted_by ? ` by ${names[r.deleted_by] || 'someone'}` : ''}
                    {' · '}<span style={{ color: left <= 7 ? 'var(--failed)' : 'inherit' }}>deleted for good in {left} day{left === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <button className="btn btn-primary" style={{ fontSize: 12.5 }} disabled={busy === r.id} onClick={() => restore(r)}>{busy === r.id ? '…' : 'Restore'}</button>
                <button className="btn btn-ghost" style={{ fontSize: 12.5, color: 'var(--failed)' }} disabled={busy === r.id} onClick={() => forget(r)}>Delete forever</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ArticleReader({ id, onBack, onEdit, onOpenFolder }) {
  const { user } = useAuth()
  const [pw, setPw] = useState({})          // what I may do here (server answers)
  const [crumbs, setCrumbs] = useState([])
  useEffect(() => { supabase.rpc('kb_powers', { p_type: 'article', p_id: id }).then(({ data }) => setPw(data || {})) }, [id])
  const [article, setArticle] = useState(undefined)
  const [tags, setTags] = useState([])
  const [files, setFiles] = useState([])
  const [myFeedback, setMyFeedback] = useState(null)
  const countedRef = useRef(false)

  useEffect(() => { (async () => {
    countedRef.current = false
    const { data: a } = await supabase.from('kb_articles').select('*').eq('id', id).maybeSingle()
    if (!a) { setArticle(null); return }
    setArticle(a)
    kbPath(a.folder_id).then(setCrumbs)
    supabase.from('kb_article_tags').select('tag_id, tags(name)').eq('article_id', id).eq('is_audience', false)
      .then(({ data }) => setTags((data || []).map(x => x.tags?.name).filter(Boolean)))
    supabase.from('kb_files').select('*').eq('article_id', id).order('created_at').then(({ data }) => setFiles(data || []))
    if (user) supabase.from('kb_feedback').select('helpful').eq('article_id', id).eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => setMyFeedback(data ? data.helpful : null))
    if (!countedRef.current) {
      countedRef.current = true
      supabase.rpc('kb_increment_view', { article: id }).then(() => {})
      // Log a per-user read for Reporting → Knowledge Base (one row per person/article).
      if (user) supabase.from('kb_article_reads').upsert({ article_id: id, profile_id: user.id, read_at: new Date().toISOString() }, { onConflict: 'article_id,profile_id' }).then(() => {})
    }
  })() }, [id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendFeedback(helpful) {
    setMyFeedback(helpful)
    await supabase.from('kb_feedback').upsert({ article_id: id, profile_id: user.id, helpful }, { onConflict: 'article_id,profile_id' })
  }

  if (article === undefined) return <p className="page-sub">Loading…</p>
  if (article === null) return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Article not available</h3>
      <p style={{ fontSize: 13 }}>It may be unpublished, or not shared with you.</p>
      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={onBack}>← Back</button>
    </div>
  )

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onBack}>← Back</button>
        <Crumbs items={crumbs} onOpen={onOpenFolder} />
      </div>
      <div className="card" style={{ padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{article.title}</h1>
          <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
            <FavFollow type="article" id={article.id} />
            {pw.edit && <button className="btn btn-ghost" onClick={() => onEdit(article.id)}>Edit</button>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          <span>Updated {fmtDate(article.updated_at)}</span>
          {article.status === 'draft' && <span style={{ fontWeight: 700, color: 'var(--accent)' }}>DRAFT</span>}
          {tags.map(t => <span key={t} style={{ background: 'var(--line-soft)', borderRadius: 4, padding: '1px 7px' }}>{t}</span>)}
        </div>
        <div style={{ marginTop: 20, fontSize: 15, lineHeight: 1.7 }}>
          {isEmptyHtml(article.body || '') ? <p style={{ color: 'var(--ink-soft)' }}>This article has no content yet.</p> : <RichContent html={article.body} />}
        </div>
        {files.length > 0 && (
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6, paddingLeft: 18 }}>Attachments</div>
            {files.map(f => <FileRow key={f.id} f={f} canDownload={pw.download !== false} />)}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: '14px 20px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Was this helpful?</span>
        <button className="btn btn-ghost" style={{ fontSize: 13, color: myFeedback === true ? 'var(--passed)' : 'var(--ink-soft)' }} onClick={() => sendFeedback(true)}>👍 Yes</button>
        <button className="btn btn-ghost" style={{ fontSize: 13, color: myFeedback === false ? 'var(--failed)' : 'var(--ink-soft)' }} onClick={() => sendFeedback(false)}>👎 No</button>
        {myFeedback !== null && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Thanks for the feedback.</span>}
      </div>
    </div>
  )
}

function ArticleEditor({ id, folderId, templateId, onDone, onCancel }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(!!id)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState('draft')
  const [chosenFolder, setChosenFolder] = useState(folderId || '')
  const [folders, setFolders] = useState([])
  const [allTags, setAllTags] = useState([])
  const [topicTagIds, setTopicTagIds] = useState([])
  const [audienceRoles, setAudienceRoles] = useState([])
  const [audienceTagIds, setAudienceTagIds] = useState([])
  const [overrideAudience, setOverrideAudience] = useState(false)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const bodyRef = useRef('')
  const createdIdRef = useRef(null)
  const [fromTemplate, setFromTemplate] = useState('')
  const [, forceBody] = useState(0)
  useEffect(() => { if (fromTemplate) forceBody(x => x + 1) }, [fromTemplate])

  useEffect(() => { (async () => {
    const [fRes, tRes] = await Promise.all([
      supabase.from('kb_folders').select('id, name, parent_id, section_id, kb_sections(name, sort_order)').order('name'),
      supabase.from('tags').select('id, name').order('name'),
    ])
    setFolders(fRes.data || [])
    setAllTags(tRes.data || [])
    // new article from a template: start with the template's body
    if (!id && templateId) {
      const { data: t } = await supabase.from('kb_templates').select('name, body').eq('id', templateId).maybeSingle()
      if (t) { bodyRef.current = t.body || ''; setFromTemplate(t.name) }
    }
    if (id) {
      const { data: a } = await supabase.from('kb_articles').select('*').eq('id', id).maybeSingle()
      if (a) {
        setTitle(a.title || ''); setStatus(a.status || 'draft'); setChosenFolder(a.folder_id || '')
        bodyRef.current = a.body || ''
        setAudienceRoles(a.audience_roles || []); setOverrideAudience(!!a.override_audience)
        const { data: atags } = await supabase.from('kb_article_tags').select('tag_id, is_audience').eq('article_id', id)
        setTopicTagIds((atags || []).filter(t => !t.is_audience).map(t => t.tag_id))
        setAudienceTagIds((atags || []).filter(t => t.is_audience).map(t => t.tag_id))
        const { data: fData } = await supabase.from('kb_files').select('*').eq('article_id', id).order('created_at')
        setFiles(fData || [])
      }
      setLoading(false)
    }
  })() }, [id])

  function toggle(list, setList, v) { setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]) }

  async function ensureSavedId() {
    if (id) return id
    if (createdIdRef.current) return createdIdRef.current
    if (!chosenFolder) throw new Error('Choose a folder first.')
    const row = { title: title.trim() || 'Untitled', body: isEmptyHtml(bodyRef.current) ? null : bodyRef.current,
      folder_id: chosenFolder || null, status: 'draft', template_id: templateId || null, author_id: user?.id, updated_at: new Date().toISOString() }
    const { data, error } = await supabase.from('kb_articles').insert(row).select('id').single()
    if (error) throw new Error(error.message)
    createdIdRef.current = data.id; return data.id
  }
  async function onPickFiles(e) {
    const picked = Array.from(e.target.files || []); e.target.value = ''
    if (!picked.length) return
    setUploading(true); setErr('')
    try {
      const aid = await ensureSavedId()
      for (const file of picked) { const rec = await uploadKbFile(file, { article_id: aid, folder_id: null, category_id: null }, user?.id); setFiles(prev => [...prev, rec]) }
    } catch (e2) { setErr('Upload failed: ' + e2.message) } finally { setUploading(false) }
  }
  async function removeFile(f) {
    setFiles(prev => prev.filter(x => x.id !== f.id))
    // goes to Trash (restorable for 60 days); the stored file is kept until Trash is emptied
    await supabase.from('kb_files').delete().eq('id', f.id)
  }

  async function save(publish) {
    if (!title.trim()) { setErr('Give the article a title.'); return }
    if (!chosenFolder) { setErr('Choose a folder for the article.'); return }
    setBusy(true); setErr('')
    const row = { title: title.trim(), body: isEmptyHtml(bodyRef.current) ? null : bodyRef.current,
      folder_id: chosenFolder || null, status: publish ? 'published' : (status === 'published' ? 'published' : 'draft'),
      updated_at: new Date().toISOString(), ...(id ? {} : { author_id: user?.id, template_id: templateId || null }) }
    if (publish) row.published_at = new Date().toISOString()
    let savedId = id || createdIdRef.current
    if (savedId) {
      const { error } = await supabase.from('kb_articles').update(row).eq('id', savedId)
      if (error) { setErr(error.message); setBusy(false); return }
      await supabase.from('kb_revisions').insert({ article_id: savedId, title: row.title, body: row.body, edited_by: user?.id })
    } else {
      const { data, error } = await supabase.from('kb_articles').insert(row).select('id').single()
      if (error) { setErr(error.message); setBusy(false); return }
      savedId = data.id
    }
    await supabase.from('kb_article_tags').delete().eq('article_id', savedId).eq('is_audience', false)
    const tagRows = topicTagIds.map(tid => ({ article_id: savedId, tag_id: tid, is_audience: false }))
    if (tagRows.length) await supabase.from('kb_article_tags').insert(tagRows)
    setBusy(false); onDone(savedId)
  }

  if (loading) return <p className="page-sub">Loading…</p>
  const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--canvas)' }

  return (
    <div style={{ maxWidth: 1100 }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16, fontSize: 13 }} onClick={onCancel}>← Cancel</button>
      {err && <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'var(--failed)', color: 'var(--failed)', fontSize: 13 }}>{err}</div>}

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title" style={{ ...inputStyle, marginTop: 6, fontSize: 16, fontWeight: 600 }} />
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Folder</label>
          <select value={chosenFolder} onChange={e => setChosenFolder(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}>
            <option value="">— Choose a folder —</option>
            {folderOptions(folders).map(g => <optgroup key={g.section} label={g.section}>{g.items.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>)}
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginBottom: 8 }}>Content</label>
        {fromTemplate && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>Started from the <b>{fromTemplate}</b> template.</div>}
        <RichEditor key={fromTemplate || 'blank'} value={bodyRef.current} variant="full" minHeight={260} placeholder="Write the article…" onChange={(html) => { bodyRef.current = html }} />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Attachments</label>
          <label className="btn btn-ghost" style={{ fontSize: 12.5, cursor: 'pointer' }}>
            {uploading ? 'Uploading…' : '+ Add files'}
            <input type="file" multiple hidden onChange={onPickFiles} disabled={uploading} />
          </label>
        </div>
        {files.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No files attached.</div> : files.map(f => <FileRow key={f.id} f={f} onDelete={removeFile} />)}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Topic tags</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {allTags.length === 0 ? <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No tags exist yet.</span> :
            allTags.map(t => (
              <button key={t.id} onClick={() => toggle(topicTagIds, setTopicTagIds, t.id)}
                style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', background: topicTagIds.includes(t.id) ? 'var(--accent)' : 'var(--surface)', color: topicTagIds.includes(t.id) ? '#fff' : 'var(--ink-soft)' }}>{t.name}</button>
            ))}
        </div>
      </div>

      <div className="card" style={{ padding: '12px 20px', marginBottom: 16, fontSize: 12.5, color: 'var(--ink-soft)' }}>
        🔒 Who can see this article follows its folder. To change it, use <b>⋯ → Manage access</b> on the article.
      </div>

      <div style={{ display: 'flex', gap: 10, position: 'sticky', bottom: 0, background: 'var(--canvas)', padding: '12px 0' }}>
        <button className="btn btn-ghost" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
        <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>Publish</button>
        {id && <button className="btn btn-ghost" style={{ marginLeft: 'auto', color: 'var(--failed)' }} disabled={busy} onClick={async () => {
          if (!window.confirm('Move this article to Trash?\n\nIts attached files go with it. Editors can restore it from 🗑 Trash for 60 days.')) return
          setBusy(true)
          const { error } = await supabase.from('kb_articles').delete().eq('id', id)
          setBusy(false)
          if (error) { window.alert('Couldn’t delete the article: ' + error.message); return }
          onDone()
        }}>Delete article</button>}
      </div>
    </div>
  )
}

// ============================================================
// HOMEPAGE (2026-11-11, per the approved mockup): banner + big search · section cards ·
// Browse by Client · Recent Updates · My Favorites · Need help. Everything shown comes from what the
// server lets this person view, and the sections are whatever the organization configured.
// ============================================================
function FolderGlyph({ size = 34 }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 48 39" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M3 6.5C3 4.6 4.6 3 6.5 3h11.2c1 0 2 .4 2.6 1.2l2.4 2.9c.7.8 1.6 1.2 2.6 1.2H41.5c1.9 0 3.5 1.6 3.5 3.5v21.7c0 1.9-1.6 3.5-3.5 3.5h-35C4.6 37 3 35.4 3 33.5v-27z" fill="#F7B53B" />
      <path d="M3 13.5c0-1.9 1.6-3.5 3.5-3.5h35c1.9 0 3.5 1.6 3.5 3.5v20c0 1.9-1.6 3.5-3.5 3.5h-35C4.6 37 3 35.4 3 33.5v-20z" fill="#FCCB5A" />
    </svg>
  )
}
// the teal jellyfish banner art (pure SVG — no images to load)
function HeroArt() {
  const dots = [[6, 30, 2], [14, 70, 1.4], [22, 20, 1.2], [31, 82, 1.6], [42, 14, 1], [55, 88, 1.3], [63, 22, 1.8], [72, 76, 1.1], [79, 12, 1.5], [91, 64, 1.2], [96, 26, 1.7], [48, 60, .9], [36, 40, 1]]
  return (
    <svg className="kbh-art" viewBox="0 0 1000 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="kbjBell" cx="45%" cy="35%" r="70%"><stop offset="0%" stopColor="#E0FFFC" stopOpacity=".95" /><stop offset="45%" stopColor="#5EEAD4" stopOpacity=".55" /><stop offset="100%" stopColor="#0E7490" stopOpacity=".05" /></radialGradient>
        <radialGradient id="kbjGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#67E8F9" stopOpacity=".55" /><stop offset="100%" stopColor="#67E8F9" stopOpacity="0" /></radialGradient>
        <linearGradient id="kbjWave" x1="0" x2="1"><stop offset="0%" stopColor="#5EEAD4" stopOpacity="0" /><stop offset="50%" stopColor="#5EEAD4" stopOpacity=".35" /><stop offset="100%" stopColor="#5EEAD4" stopOpacity="0" /></linearGradient>
      </defs>
      <path d="M0 170 C 180 120, 320 210, 520 160 S 860 110, 1000 150" fill="none" stroke="url(#kbjWave)" strokeWidth="2" />
      <path d="M0 190 C 220 150, 360 230, 560 185 S 880 140, 1000 175" fill="none" stroke="url(#kbjWave)" strokeWidth="1.2" />
      <path d="M0 60 C 160 20, 300 90, 470 50" fill="none" stroke="url(#kbjWave)" strokeWidth="1" opacity=".7" />
      <circle cx="870" cy="70" r="130" fill="url(#kbjGlow)" />
      <g transform="translate(805 18) rotate(-14 70 60)">
        <path d="M8 70 C 8 18, 132 6, 140 62 C 120 74, 98 66, 74 74 C 52 80, 30 70, 8 70 Z" fill="url(#kbjBell)" stroke="#A5F3FC" strokeOpacity=".7" strokeWidth="1.4" />
        <path d="M24 66 C 40 40, 96 30, 124 58" fill="none" stroke="#ECFEFF" strokeOpacity=".55" strokeWidth="1.2" />
        {[20, 40, 60, 80, 100, 120].map((x, i) => (
          <path key={x} d={`M${x} ${72 + (i % 2) * 3} C ${x - 14} ${110 + i * 4}, ${x + 18} ${140 + i * 3}, ${x - 6} ${190 + i * 6}`} fill="none" stroke="#99F6E4" strokeOpacity={0.55 - i * 0.05} strokeWidth={1.6 - i * 0.12} />
        ))}
      </g>
      {dots.map(([x, y, r], i) => <circle key={i} cx={x * 10} cy={y * 2.2} r={r * 2} fill="#CCFBF1" opacity={0.35 + (i % 4) * 0.12} />)}
    </svg>
  )
}
function KbHero({ q, setQ, onSearch, inputRef }) {
  return (
    <section className="kbh-hero" aria-label="Search the Knowledge Base">
      <HeroArt />
      <h2>Find what you need, fast.</h2>
      <form className="kbh-search" role="search" onSubmit={e => { e.preventDefault(); onSearch(q) }}>
        <span aria-hidden="true" style={{ fontSize: 18, color: '#0b4a57' }}>🔍</span>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search the Knowledge Base (guides, SOPs, call flows, files, and more…)" aria-label="Search the Knowledge Base" />
        <kbd>Ctrl K</kbd>
      </form>
    </section>
  )
}
// the row under the banner: All Resources · your sections · Favorites · Recently Updated · + New
function KbNav({ ctx, active, hideNew = false }) {
  const { kb, go, setModal } = ctx
  const [secPw, setSecPw] = useState({})
  useEffect(() => { kb.sections.forEach(s => supabase.rpc('kb_can', { p_action: 'create', p_type: 'section', p_id: s.id }).then(({ data }) => setSecPw(p => ({ ...p, [s.id]: !!data })))) }, [kb.sections])
  const canFolder = kb.sections.filter(s => secPw[s.id])
  const anyWrite = canFolder.length > 0 || kb.admin.sections || kb.admin.templates || kb.admin.restore || kb.folders.length > 0
  return (
    <div className="kbh-nav">
      <button className={'kbh-tab' + (active === 'all' ? ' on' : '')} onClick={() => go({})}>🗂 All Resources</button>
      {kb.sections.map(s => <button key={s.id} className={'kbh-tab' + (active === s.id ? ' on' : '')} onClick={() => go({ section: s.id })}>{s.icon} {s.name}</button>)}
      <span style={{ flex: 1 }} />
      <button className={'kbh-tab' + (active === 'favorites' ? ' on' : '')} onClick={() => go({ tab: 'favorites' })}>☆ Favorites</button>
      <button className={'kbh-tab' + (active === 'recent' ? ' on' : '')} onClick={() => go({ tab: 'recent' })}>🕑 Recently Updated</button>
      {anyWrite && !hideNew && (
        <Drop label={<>＋ New ▾</>} className="kbh-new">
          {canFolder.map(s => <MI key={s.id} icon="📁" onClick={() => setModal({ kind: 'folder', parentType: 'section', parentId: s.id })} sub={`A top-level folder in ${s.name}`}>Folder in {s.name}</MI>)}
          {kb.folders.length > 0 && <>
            <MI icon="📄" onClick={() => go({ view: 'new' })} sub="Pick the folder as you write">Article</MI>
            <MI icon="📝" onClick={() => setModal({ kind: 'pickFolder', then: 'template' })} sub="Start from one of your templates">Article from a template</MI>
            <MI icon="⬆" onClick={() => setModal({ kind: 'pickFolder', then: 'file' })} sub="PDFs, docs, images, spreadsheets…">Upload files</MI>
            <MI icon="🎬" onClick={() => setModal({ kind: 'pickFolder', then: 'recording' })} sub="Audio or video">Upload a recording</MI>
          </>}
          {(kb.admin.sections || kb.admin.templates || kb.admin.restore) && <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0', padding: '8px 10px 2px', fontSize: 11.5, fontWeight: 800, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Manage</div>}
          {kb.admin.sections && <MI icon="⚙" onClick={() => setModal({ kind: 'sections' })} sub="Add, rename, reorder">Sections</MI>}
          {kb.admin.templates && <MI icon="📝" onClick={() => setModal({ kind: 'templates' })} sub="Your article templates">Templates</MI>}
          {kb.admin.restore && <MI icon="🗑" onClick={() => go({ view: 'trash' })} sub="Restore deleted items">Trash</MI>}
        </Drop>
      )}
    </div>
  )
}
const DAY = 864e5
function Home({ ctx }) {
  const { kb, go, openItem } = ctx
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('kb-home-layout') || 'grid' } catch { return 'grid' } })
  const items = allItems(kb)
  const countIn = (fid) => kb.folders.filter(f => f.parent_id === fid).length + items.filter(x => x.folder_id === fid).length
  const tops = kb.folders.filter(f => !f.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  const recent = items.filter(x => x.status !== 'draft').sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 5)
  const favRows = kb.favs.map(f => f.object_type === 'folder' ? (() => { const x = kb.folders.find(y => y.id === f.object_id); return x && { kind: 'folder', ...x } })()
    : f.object_type === 'section' ? null : items.find(y => y.id === f.object_id)).filter(Boolean).slice(0, 5)
  const created = (x) => x.kind === 'article' ? kb.articles.find(a => a.id === x.id)?.created_at : x.updated_at
  const badge = (x) => { const c = created(x); if (c && Date.now() - new Date(c) < 7 * DAY) return <span className="kbh-tag new">New</span>
    return Date.now() - new Date(x.updated_at) < 14 * DAY ? <span className="kbh-tag up">Updated</span> : null }
  const unfav = async (x) => { const t = x.kind === 'recording' ? 'file' : x.kind; await supabase.from('kb_favorites').delete().eq('object_type', t).eq('object_id', x.id).eq('profile_id', (await supabase.auth.getUser()).data.user?.id); ctx.reload() }
  const deco = (s) => s.icon || '📚'
  return (
    <>
      {kb.sections.length > 0 && (
        <div className="kbh-sections">
          {kb.sections.map(s => (
            <button key={s.id} className="kbh-sec" onClick={() => go({ section: s.id })}>
              <span className="ic">{s.icon || '📚'}</span>
              <span><b>{s.name}</b>{s.description && <p>{s.description}</p>}</span>
              <span className="deco">{deco(s)}</span><span className="chev">›</span>
            </button>))}
        </div>
      )}
      {kb.sections.length === 0 && <div className="kbh-card" style={{ textAlign: 'center', marginBottom: 18 }}>{kb.admin.sections ? <>No sections yet. <button className="btn btn-primary" onClick={() => ctx.setModal({ kind: 'sections' })}>⚙ Create your first section</button></> : 'Nothing has been shared with you yet.'}</div>}

      {tops.length > 0 && (
        <div className="kbh-card">
          <div className="kbh-hd">
            <span style={{ fontSize: 22 }} aria-hidden="true">🗀</span><h3>Browse by Client</h3>
            <button className="kbh-link" onClick={() => go({ view: 'folders' })}>View All</button>
            <div className="kb-seg" role="group" aria-label="Layout">
              <button className={layout === 'grid' ? 'on' : ''} onClick={() => { setLayout('grid'); try { localStorage.setItem('kb-home-layout', 'grid') } catch { /* ok */ } }} aria-label="Grid">▦</button>
              <button className={layout === 'list' ? 'on' : ''} onClick={() => { setLayout('list'); try { localStorage.setItem('kb-home-layout', 'list') } catch { /* ok */ } }} aria-label="List">☰</button>
            </div>
          </div>
          {layout === 'grid' ? (
            <div className="kbh-folders">{tops.slice(0, 15).map(f => (
              <button key={f.id} className="kbh-fc" onClick={() => go({ view: 'folder', folder: f.id })} title={f.name}>
                <FolderGlyph /><span style={{ minWidth: 0 }}><b>{f.name}{f.restricted && <span className="kb-lock">🔒</span>}</b><small>{countIn(f.id)} item{countIn(f.id) === 1 ? '' : 's'}</small></span><span className="chev">›</span>
              </button>))}</div>
          ) : <ItemTable ctx={ctx} rows={tops.map(f => ({ kind: 'folder', ...f }))} countIn={countIn} showWhere />}
          {tops.length > 15 && layout === 'grid' && <div style={{ textAlign: 'center', marginTop: 10 }}><button className="kbh-link" onClick={() => go({ view: 'folders' })}>View all {tops.length} folders</button></div>}
        </div>
      )}

      <div className="kbh-panels">
        <div className="kbh-card">
          <div className="kbh-hd"><span style={{ fontSize: 22 }} aria-hidden="true">🕑</span><h3>Recent Updates</h3><button className="kbh-link" onClick={() => go({ tab: 'recent' })}>View All</button></div>
          {recent.length === 0 ? <div className="kbh-empty">Nothing yet.</div> : recent.map(x => (
            <div key={x.kind + x.id} className="kbh-row" role="button" tabIndex={0} onClick={() => openItem(x)} onKeyDown={e => e.key === 'Enter' && openItem(x)}>
              <span style={{ fontSize: 18 }}>{itemIcon(x)}</span><b title={x.name}>{x.name}</b>{badge(x)}<span style={{ color: 'var(--ink-soft)', fontSize: 13, whiteSpace: 'nowrap' }}>{fmtShort(x.updated_at)}</span>
            </div>))}
        </div>
        <div className="kbh-card">
          <div className="kbh-hd"><span style={{ fontSize: 22, color: '#F59E0B' }} aria-hidden="true">☆</span><h3>My Favorites</h3><button className="kbh-link" onClick={() => go({ tab: 'favorites' })}>View All</button></div>
          {favRows.length === 0 ? <div className="kbh-empty">Tap ☆ on any article, file or folder to keep it here.</div> : favRows.map(x => (
            <div key={x.kind + x.id} className="kbh-row" role="button" tabIndex={0} onClick={() => openItem(x)} onKeyDown={e => e.key === 'Enter' && openItem(x)}>
              <span style={{ fontSize: 18 }}>{x.kind === 'folder' ? '📁' : itemIcon(x)}</span><b title={x.name}>{x.name}</b>
              <button className="kb-star on" onClick={e => { e.stopPropagation(); unfav(x) }} aria-label="Remove from favorites">★</button>
            </div>))}
        </div>
        <div className="kbh-card">
          <div className="kbh-hd" style={{ alignItems: 'flex-start' }}><span style={{ fontSize: 26 }} aria-hidden="true">❔</span>
            <div style={{ flex: 1 }}><h3>Need Help Finding Something?</h3>
              <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)', fontSize: 14.5, lineHeight: 1.5 }}>Try a search, browse by {kb.sections.length ? 'section or client' : 'folder'}, or {kb.sections[1] ? `check the ${kb.sections[1].name} resources` : 'open a ticket'}.</p></div></div>
          <button className="kbh-help-btn" onClick={() => ctx.navigate('/help')}>💬 Open a Help Ticket</button>
        </div>
      </div>
    </>
  )
}
function AllFoldersView({ ctx }) {
  const { kb } = ctx
  const items = allItems(kb)
  const countIn = (fid) => kb.folders.filter(f => f.parent_id === fid).length + items.filter(x => x.folder_id === fid).length
  const tops = kb.folders.filter(f => !f.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  return <div className="kbh-card"><div className="kbh-hd"><span style={{ fontSize: 22 }}>🗀</span><h3>All folders</h3></div>
    <div className="kbh-folders">{tops.map(f => (
      <button key={f.id} className="kbh-fc" onClick={() => ctx.go({ view: 'folder', folder: f.id })} title={f.name}>
        <FolderGlyph /><span style={{ minWidth: 0 }}><b>{f.name}{f.restricted && <span className="kb-lock">🔒</span>}</b>
          <small>{countIn(f.id)} item{countIn(f.id) === 1 ? '' : 's'} · {kb.sections.find(s => s.id === f.section_id)?.name}</small></span><span className="chev">›</span>
      </button>))}</div></div>
}
// "+ New" from the homepage: choose the folder first
function PickFolderModal({ ctx, then, onClose }) {
  const { kb, go, setModal, reload } = ctx
  const [dest, setDest] = useState(''), [busy, setBusy] = useState('')
  const fileRef = useRef(null)
  const { user } = useAuth()
  const opts = folderOptions(kb.folders.map(x => ({ ...x, kb_sections: kb.sections.find(s => s.id === x.section_id) })))
  async function onFiles(e) {
    const picked = Array.from(e.target.files || []); e.target.value = ''
    if (!picked.length) return
    setBusy(`Uploading ${picked.length}…`)
    try { for (const f of picked) await uploadKbFile(f, { folder_id: dest, article_id: null, kind: then === 'recording' ? 'recording' : 'file' }, user?.id); await reload(); onClose(); go({ view: 'folder', folder: dest }) }
    catch (err) { setBusy(''); window.alert(/row-level|policy/i.test(err.message) ? "You can't upload to that folder." : 'Upload failed: ' + err.message) }
  }
  const next = () => { if (!dest) return; if (then === 'template') setModal({ kind: 'pickTemplate', folderId: dest }); else fileRef.current?.click() }
  return (
    <KbModal title={then === 'template' ? 'New article from a template' : then === 'recording' ? 'Upload a recording' : 'Upload files'} onClose={onClose} width={520}
      footer={<><span style={{ fontSize: 13, marginRight: 'auto' }}>{busy}</span><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!dest || !!busy} onClick={next}>{then === 'template' ? 'Next' : 'Choose files…'}</button></>}>
      <label className="kb-lbl" style={{ marginTop: 0 }}>Which folder?</label>
      <select className="kb-in" value={dest} onChange={e => setDest(e.target.value)} size={10} style={{ height: 'auto' }}>
        {opts.map(g => <optgroup key={g.section} label={g.section}>{g.items.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)}
      </select>
      <input ref={fileRef} type="file" multiple hidden accept={then === 'recording' ? 'audio/*,video/*' : undefined} onChange={onFiles} />
    </KbModal>
  )
}
