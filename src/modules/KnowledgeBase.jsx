import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichEditor, RichContent, isEmptyHtml } from '../lib/RichEditor'
import { ROLES } from '../lib/permissions'

// ============================================================
// KNOWLEDGE BASE — folder tree (Drive-style, unlimited nesting)
// Access is enforced by RLS (kb_can_read_folder / _article / _file).
// certification + admin author; everyone else reads what's shared.
// ============================================================

function isAuthorRole(appRole) {
  return ['certification', 'admin'].includes(String(appRole || 'agent').trim().toLowerCase())
}
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
  if (m.includes('pdf')) return '\u{1F4C4}'
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return '\u{1F4CA}'
  if (m.includes('word') || m.includes('document')) return '\u{1F4DD}'
  if (m.includes('presentation') || m.includes('powerpoint')) return '\u{1F4FD}'
  if (m.startsWith('image/')) return '\u{1F5BC}'
  if (m.startsWith('video/')) return '\u{1F3AC}'
  if (m.includes('zip') || m.includes('compressed')) return '\u{1F5DC}'
  return '\u{1F4CE}'
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

function FileRow({ f, onDelete }) {
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
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{fmtSize(f.size_bytes)}{err && <span style={{ color: 'var(--failed)' }}> \u00b7 {err}</span>}</div>
      </div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, flex: 'none' }} onClick={grab} disabled={busy}>{busy ? '\u2026' : '\u2b07 Download'}</button>
      {onDelete && <button className="btn btn-ghost" style={{ fontSize: 12.5, color: 'var(--failed)', flex: 'none' }} onClick={() => onDelete(f)}>Remove</button>}
    </div>
  )
}

export default function KnowledgeBase() {
  const { appRole } = useAuth()
  const canAuthor = isAuthorRole(appRole)
  const [params, setParams] = useSearchParams()
  const view = params.get('view') || 'browse'
  const folderId = params.get('folder') || null
  const articleId = params.get('id') || null
  const go = (next) => setParams(next, { replace: false })

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-sub">Guides, processes, and files \u2014 organized in folders.</p>
        </div>
      </div>

      {view === 'browse' && <Browse folderId={folderId} canAuthor={canAuthor}
        onOpenFolder={(fid) => go(fid ? { view: 'browse', folder: fid } : { view: 'browse' })}
        onOpenArticle={(aid) => go({ view: 'article', id: aid, ...(folderId ? { folder: folderId } : {}) })}
        onNewArticle={() => go({ view: 'new', ...(folderId ? { folder: folderId } : {}) })} />}

      {view === 'article' && <ArticleReader id={articleId} canAuthor={canAuthor}
        onBack={() => go(folderId ? { view: 'browse', folder: folderId } : { view: 'browse' })}
        onEdit={(aid) => go({ view: 'edit', id: aid, ...(folderId ? { folder: folderId } : {}) })} />}

      {(view === 'edit' || view === 'new') && <ArticleEditor id={view === 'edit' ? articleId : null} folderId={folderId}
        onDone={(aid) => go(aid ? { view: 'article', id: aid, ...(folderId ? { folder: folderId } : {}) } : { view: 'browse' })}
        onCancel={() => go(articleId ? { view: 'article', id: articleId } : (folderId ? { view: 'browse', folder: folderId } : { view: 'browse' }))} />}
    </div>
  )
}

function Browse({ folderId, canAuthor, onOpenFolder, onOpenArticle, onNewArticle }) {
  const { user } = useAuth()
  const [folder, setFolder] = useState(null)
  const [crumbs, setCrumbs] = useState([])
  const [subfolders, setSubfolders] = useState([])
  const [articles, setArticles] = useState([])
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editingFolder, setEditingFolder] = useState(null)
  const [busyMsg, setBusyMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let chain = []
    let cur = null
    if (folderId) {
      const { data: f } = await supabase.from('kb_folders').select('*').eq('id', folderId).maybeSingle()
      cur = f || null
      let walkId = f?.parent_id
      const seen = new Set()
      while (walkId && !seen.has(walkId)) {
        seen.add(walkId)
        const { data: p } = await supabase.from('kb_folders').select('id, name, parent_id').eq('id', walkId).maybeSingle()
        if (!p) break
        chain.unshift(p); walkId = p.parent_id
      }
    }
    setFolder(cur); setCrumbs(chain)

    const [sfRes, aRes, fRes] = await Promise.all([
      folderId
        ? supabase.from('kb_folders').select('*').eq('parent_id', folderId).order('sort_order').order('name')
        : supabase.from('kb_folders').select('*').is('parent_id', null).order('sort_order').order('name'),
      folderId
        ? supabase.from('kb_articles').select('id, title, status, updated_at, folder_id').eq('folder_id', folderId).order('updated_at', { ascending: false })
        : supabase.from('kb_articles').select('id, title, status, updated_at, folder_id').is('folder_id', null).order('updated_at', { ascending: false }),
      folderId
        ? supabase.from('kb_files').select('*').is('article_id', null).eq('folder_id', folderId).order('created_at', { ascending: false })
        : supabase.from('kb_files').select('*').is('article_id', null).is('folder_id', null).order('created_at', { ascending: false }),
    ])
    setSubfolders(sfRes.data || [])
    setArticles(aRes.data || [])
    setFiles(fRes.data || [])
    setLoading(false)
  }, [folderId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!q.trim()) { setResults(null); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('kb_search', { q: q.trim() })
      setResults(data || []); setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const visibleArticles = canAuthor ? articles : articles.filter(a => a.status === 'published')
  const visibleFiles = canAuthor ? files : files.filter(f => f.status === 'published')

  async function uploadHere(e) {
    const picked = Array.from(e.target.files || []); e.target.value = ''
    if (!picked.length) return
    setUploading(true); setBusyMsg('')
    try {
      for (const file of picked) await uploadKbFile(file, { folder_id: folderId || null, article_id: null, category_id: null, status: 'published' }, user?.id)
      await load()
    } catch (err) { setBusyMsg('Upload failed: ' + err.message) }
    finally { setUploading(false) }
  }
  async function removeFile(f) {
    if (!window.confirm('Remove ' + f.name + '?')) return
    await supabase.storage.from('kb-files').remove([f.storage_path])
    await supabase.from('kb_files').delete().eq('id', f.id)
    load()
  }
  async function deleteFolder(f) {
    if (!window.confirm('Delete folder "' + f.name + '" and everything inside it? This cannot be undone.')) return
    await supabase.from('kb_folders').delete().eq('id', f.id)
    load()
  }

  if (results !== null) {
    return (
      <div>
        <SearchBar q={q} setQ={setQ} />
        <SearchResults results={results} searching={searching} onOpen={onOpenArticle} onClear={() => setQ('')} />
      </div>
    )
  }

  return (
    <div>
      <SearchBar q={q} setQ={setQ} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14, fontSize: 13 }}>
        <button className="btn btn-ghost" style={{ fontSize: 13, padding: '4px 8px' }} onClick={() => onOpenFolder(null)}>📚 Home</button>
        {crumbs.map(c => (
          <React.Fragment key={c.id}>
            <span style={{ color: 'var(--ink-soft)' }}>/</span>
            <button className="btn btn-ghost" style={{ fontSize: 13, padding: '4px 8px' }} onClick={() => onOpenFolder(c.id)}>{c.name}</button>
          </React.Fragment>
        ))}
        {folder && <><span style={{ color: 'var(--ink-soft)' }}>/</span><span style={{ fontWeight: 700 }}>{folder.icon || '\u{1F4C1}'} {folder.name}</span></>}
      </div>

      {canAuthor && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <button className="btn btn-ghost" onClick={() => setEditingFolder('new')}>+ New folder</button>
          <button className="btn btn-ghost" onClick={onNewArticle}>+ New article</button>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            {uploading ? 'Uploading\u2026' : '+ Upload file'}
            <input type="file" multiple hidden onChange={uploadHere} disabled={uploading} />
          </label>
          {folder && <button className="btn btn-ghost" onClick={() => setEditingFolder(folder)}>Folder settings</button>}
        </div>
      )}
      {busyMsg && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 12 }}>{busyMsg}</div>}
      {editingFolder && (
        <FolderEditor folder={editingFolder === 'new' ? null : editingFolder} parentId={folderId}
          onDone={() => { setEditingFolder(null); load() }} onCancel={() => setEditingFolder(null)} />
      )}

      {loading ? <p className="page-sub">Loading\u2026</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {subfolders.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {subfolders.map(sf => (
                <div key={sf.id} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => onOpenFolder(sf.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', minWidth: 0 }}>
                    <span style={{ fontSize: 24, flex: 'none' }}>{sf.icon || '\u{1F4C1}'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sf.name}</div>
                      {sf.description && <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sf.description}</div>}
                    </div>
                  </button>
                  {canAuthor && <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px', flex: 'none', color: 'var(--failed)' }} onClick={() => deleteFolder(sf)}>\u2715</button>}
                </div>
              ))}
            </div>
          )}

          {(visibleArticles.length > 0 || visibleFiles.length > 0) ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {visibleArticles.map(a => (
                <button key={a.id} onClick={() => onOpenArticle(a.id)}
                  style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: 0, borderBottom: '1px solid var(--line-soft)', background: 'transparent', padding: '12px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ fontSize: 14 }}>📄 {a.title}
                    {a.status === 'draft' && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--line-soft)', borderRadius: 4, padding: '1px 6px' }}>DRAFT</span>}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', flex: 'none' }}>{fmtDate(a.updated_at)}</span>
                </button>
              ))}
              {visibleFiles.map(f => <FileRow key={f.id} f={f} onDelete={canAuthor ? removeFile : null} />)}
            </div>
          ) : subfolders.length === 0 && (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
              <h3 style={{ fontSize: 15, marginBottom: 6 }}>{folder ? 'This folder is empty' : 'Nothing here yet'}</h3>
              <p style={{ fontSize: 13 }}>{canAuthor ? 'Add a folder, article, or file to get started.' : 'Content will appear here once it is shared with you.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SearchBar({ q, setQ }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the knowledge base\u2026"
        style={{ width: '100%', maxWidth: 480, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)' }} />
    </div>
  )
}

function SearchResults({ results, searching, onOpen, onClear }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="page-sub" style={{ fontSize: 13 }}>{searching ? 'Searching\u2026' : results.length + ' result' + (results.length === 1 ? '' : 's')}</span>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={onClear}>Clear</button>
      </div>
      {!searching && results.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>No matches. Try different words.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {results.map(r => (
            <button key={r.id} onClick={() => onOpen(r.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line-soft)', background: 'transparent', padding: '13px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>📄 {r.title}
                {r.status === 'draft' && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--line-soft)', borderRadius: 4, padding: '1px 6px' }}>DRAFT</span>}
              </div>
              {r.snippet && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FolderEditor({ folder, parentId, onDone, onCancel }) {
  const { user } = useAuth()
  const [name, setName] = useState(folder?.name || '')
  const [description, setDescription] = useState(folder?.description || '')
  const [icon, setIcon] = useState(folder?.icon || '\u{1F4C1}')
  const [hasOwn, setHasOwn] = useState(folder?.has_own_audience ?? (!parentId))
  const [roles, setRoles] = useState(folder?.audience_roles || [])
  const [tagIds, setTagIds] = useState([])
  const [allTags, setAllTags] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('tags').select('id, name').order('name').then(({ data }) => setAllTags(data || []))
    if (folder?.id) supabase.from('kb_folder_tags').select('tag_id').eq('folder_id', folder.id).then(({ data }) => setTagIds((data || []).map(x => x.tag_id)))
  }, [folder])

  function toggle(list, setList, v) { setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]) }

  async function save() {
    if (!name.trim()) { setErr('Name is required.'); return }
    setBusy(true); setErr('')
    const row = { name: name.trim(), description: description.trim() || null, icon: icon || '\u{1F4C1}',
      audience_roles: hasOwn ? roles : [], has_own_audience: hasOwn, updated_at: new Date().toISOString() }
    let fid = folder?.id
    if (fid) {
      const { error } = await supabase.from('kb_folders').update(row).eq('id', fid)
      if (error) { setErr(error.message); setBusy(false); return }
    } else {
      row.parent_id = parentId || null; row.created_by = user?.id
      const { data, error } = await supabase.from('kb_folders').insert(row).select('id').single()
      if (error) { setErr(error.message); setBusy(false); return }
      fid = data.id
    }
    await supabase.from('kb_folder_tags').delete().eq('folder_id', fid)
    if (hasOwn && tagIds.length) await supabase.from('kb_folder_tags').insert(tagIds.map(tid => ({ folder_id: fid, tag_id: tid })))
    setBusy(false); onDone()
  }

  const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--canvas)' }
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{folder ? 'Folder settings' : 'New folder'}</div>
      {err && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={2} style={{ ...inputStyle, width: 56, textAlign: 'center', fontSize: 18 }} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Folder name" style={inputStyle} />
      </div>
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" style={{ ...inputStyle, marginBottom: 14 }} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>
        <input type="checkbox" checked={hasOwn} onChange={e => setHasOwn(e.target.checked)} />
        Set who can see this folder here {parentId && <span style={{ color: 'var(--ink-soft)' }}>(otherwise it inherits from the folder above)</span>}
      </label>

      {hasOwn ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Roles</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {ROLES.map(r => (
              <button key={r.key} onClick={() => toggle(roles, setRoles, r.key)}
                style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', background: roles.includes(r.key) ? 'var(--accent)' : 'var(--surface)', color: roles.includes(r.key) ? '#fff' : 'var(--ink-soft)' }}>{r.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Tags</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {allTags.length === 0 ? <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No tags exist yet.</span> :
              allTags.map(t => (
                <button key={t.id} onClick={() => toggle(tagIds, setTagIds, t.id)}
                  style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', background: tagIds.includes(t.id) ? 'var(--accent)' : 'var(--surface)', color: tagIds.includes(t.id) ? '#fff' : 'var(--ink-soft)' }}>{t.name}</button>
              ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 16 }}>This folder inherits access from the folder above it. Authors and admins always have access.</div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving\u2026' : 'Save folder'}</button>
      </div>
    </div>
  )
}

function ArticleReader({ id, canAuthor, onBack, onEdit }) {
  const { user } = useAuth()
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
    supabase.from('kb_article_tags').select('tag_id, tags(name)').eq('article_id', id).eq('is_audience', false)
      .then(({ data }) => setTags((data || []).map(x => x.tags?.name).filter(Boolean)))
    supabase.from('kb_files').select('*').eq('article_id', id).order('created_at').then(({ data }) => setFiles(data || []))
    if (user) supabase.from('kb_feedback').select('helpful').eq('article_id', id).eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => setMyFeedback(data ? data.helpful : null))
    if (!countedRef.current) { countedRef.current = true; supabase.rpc('kb_increment_view', { article: id }).then(() => {}) }
  })() }, [id, user])

  async function sendFeedback(helpful) {
    setMyFeedback(helpful)
    await supabase.from('kb_feedback').upsert({ article_id: id, profile_id: user.id, helpful }, { onConflict: 'article_id,profile_id' })
  }

  if (article === undefined) return <p className="page-sub">Loading\u2026</p>
  if (article === null) return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Article not available</h3>
      <p style={{ fontSize: 13 }}>It may be unpublished, or not shared with you.</p>
      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={onBack}>\u2190 Back</button>
    </div>
  )

  return (
    <div style={{ maxWidth: 760 }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16, fontSize: 13 }} onClick={onBack}>\u2190 Back</button>
      <div className="card" style={{ padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{article.title}</h1>
          {canAuthor && <button className="btn btn-ghost" style={{ flex: 'none' }} onClick={() => onEdit(article.id)}>Edit</button>}
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
            {files.map(f => <FileRow key={f.id} f={f} />)}
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

function ArticleEditor({ id, folderId, onDone, onCancel }) {
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

  useEffect(() => { (async () => {
    const [fRes, tRes] = await Promise.all([
      supabase.from('kb_folders').select('id, name, parent_id').order('name'),
      supabase.from('tags').select('id, name').order('name'),
    ])
    setFolders(fRes.data || [])
    setAllTags(tRes.data || [])
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
    const row = { title: title.trim() || 'Untitled', body: isEmptyHtml(bodyRef.current) ? null : bodyRef.current,
      folder_id: chosenFolder || null, status: 'draft', audience_roles: audienceRoles, override_audience: overrideAudience, author_id: user?.id, updated_at: new Date().toISOString() }
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
    await supabase.storage.from('kb-files').remove([f.storage_path])
    await supabase.from('kb_files').delete().eq('id', f.id)
  }

  async function save(publish) {
    if (!title.trim()) { setErr('Give the article a title.'); return }
    setBusy(true); setErr('')
    const row = { title: title.trim(), body: isEmptyHtml(bodyRef.current) ? null : bodyRef.current,
      folder_id: chosenFolder || null, status: publish ? 'published' : (status === 'published' ? 'published' : 'draft'),
      audience_roles: audienceRoles, override_audience: overrideAudience, author_id: user?.id, updated_at: new Date().toISOString() }
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
    await supabase.from('kb_article_tags').delete().eq('article_id', savedId)
    const tagRows = [
      ...topicTagIds.map(tid => ({ article_id: savedId, tag_id: tid, is_audience: false })),
      ...audienceTagIds.map(tid => ({ article_id: savedId, tag_id: tid, is_audience: true })),
    ]
    if (tagRows.length) await supabase.from('kb_article_tags').insert(tagRows)
    setBusy(false); onDone(savedId)
  }

  if (loading) return <p className="page-sub">Loading\u2026</p>
  const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--canvas)' }

  return (
    <div style={{ maxWidth: 760 }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16, fontSize: 13 }} onClick={onCancel}>\u2190 Cancel</button>
      {err && <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'var(--failed)', color: 'var(--failed)', fontSize: 13 }}>{err}</div>}

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title" style={{ ...inputStyle, marginTop: 6, fontSize: 16, fontWeight: 600 }} />
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Folder</label>
          <select value={chosenFolder} onChange={e => setChosenFolder(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}>
            <option value="">\u2014 Top level \u2014</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginBottom: 8 }}>Content</label>
        <RichEditor value={bodyRef.current} variant="full" minHeight={260} placeholder="Write the article\u2026" onChange={(html) => { bodyRef.current = html }} />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Attachments</label>
          <label className="btn btn-ghost" style={{ fontSize: 12.5, cursor: 'pointer' }}>
            {uploading ? 'Uploading\u2026' : '+ Add files'}
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

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Who can see this</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={overrideAudience} onChange={e => setOverrideAudience(e.target.checked)} />
          Override the folder\u2019s audience for this article
        </label>
        {overrideAudience ? (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>Share with these roles and/or tags. Authors and admins always have access.</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Roles</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {ROLES.map(r => (
                <button key={r.key} onClick={() => toggle(audienceRoles, setAudienceRoles, r.key)}
                  style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', background: audienceRoles.includes(r.key) ? 'var(--accent)' : 'var(--surface)', color: audienceRoles.includes(r.key) ? '#fff' : 'var(--ink-soft)' }}>{r.label}</button>
              ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Tags</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {allTags.map(t => (
                <button key={t.id} onClick={() => toggle(audienceTagIds, setAudienceTagIds, t.id)}
                  style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', background: audienceTagIds.includes(t.id) ? 'var(--accent)' : 'var(--surface)', color: audienceTagIds.includes(t.id) ? '#fff' : 'var(--ink-soft)' }}>{t.name}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>This article inherits its folder\u2019s audience.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, position: 'sticky', bottom: 0, background: 'var(--canvas)', padding: '12px 0' }}>
        <button className="btn btn-ghost" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving\u2026' : 'Save draft'}</button>
        <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>Publish</button>
      </div>
    </div>
  )
}
