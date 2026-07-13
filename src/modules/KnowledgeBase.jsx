import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { RichEditor, RichContent, isEmptyHtml, htmlToText } from '../lib/RichEditor'
import { ROLES } from '../lib/permissions'

// ============================================================
// KNOWLEDGE BASE
// - Everyone reads what's shared with them (RLS-enforced).
// - certification + admin roles author/edit.
// - Categories (with role/tag audiences) + tags + full-text search.
// The database is the source of truth for access: the client simply
// renders whatever RLS lets it read.
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
  if (m.includes('pdf')) return '📄'
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return '📊'
  if (m.includes('word') || m.includes('document')) return '📝'
  if (m.includes('presentation') || m.includes('powerpoint')) return '📽'
  if (m.startsWith('image/')) return '🖼'
  if (m.startsWith('video/')) return '🎬'
  if (m.includes('zip') || m.includes('compressed')) return '🗜'
  return '📎'
}

// Upload a File to the private kb-files bucket and create the metadata row.
// meta = { article_id } or { category_id, audience_roles, override_audience, status }
async function uploadKbFile(file, meta, uploaderId) {
  const safe = file.name.replace(/[^\w.\- ]+/g, '_')
  const path = `${crypto.randomUUID()}/${safe}`
  const { error: upErr } = await supabase.storage.from('kb-files').upload(path, file, {
    contentType: file.type || undefined, upsert: false,
  })
  if (upErr) throw new Error(upErr.message)
  const row = {
    name: file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size,
    uploaded_by: uploaderId, ...meta,
  }
  const { data, error } = await supabase.from('kb_files').insert(row).select('*').single()
  if (error) {
    // roll back the orphaned object if the metadata insert failed
    await supabase.storage.from('kb-files').remove([path])
    throw new Error(error.message)
  }
  return data
}

// Ask the Edge Function for a signed URL (access-checked) and trigger download.
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
      <span style={{ fontSize: 18, flex: 'none' }}>{fileIcon(f.mime_type)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{fmtSize(f.size_bytes)}{err && <span style={{ color: 'var(--failed)' }}> · {err}</span>}</div>
      </div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, flex: 'none' }} onClick={grab} disabled={busy}>{busy ? '…' : '⬇ Download'}</button>
      {onDelete && <button className="btn btn-ghost" style={{ fontSize: 12.5, color: 'var(--failed)', flex: 'none' }} onClick={() => onDelete(f)}>Remove</button>}
    </div>
  )
}

export default function KnowledgeBase() {
  const { appRole } = useAuth()
  const canAuthor = isAuthorRole(appRole)
  const [params, setParams] = useSearchParams()
  const view = params.get('view') || 'browse'          // browse | article | edit | new
  const articleId = params.get('id') || null

  const go = (next) => setParams(next, { replace: false })

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-sub">Guides, processes, and answers — organized by topic.</p>
        </div>
        {canAuthor && view === 'browse' && (
          <button className="btn btn-primary" onClick={() => go({ view: 'new' })}>+ New article</button>
        )}
      </div>

      {view === 'browse' && <Browse canAuthor={canAuthor} onOpen={(id) => go({ view: 'article', id })} onManageCats={() => go({ view: 'categories' })} />}
      {view === 'article' && <ArticleReader id={articleId} canAuthor={canAuthor} onBack={() => go({ view: 'browse' })} onEdit={(id) => go({ view: 'edit', id })} />}
      {(view === 'edit' || view === 'new') && (
        <ArticleEditor id={view === 'edit' ? articleId : null} onDone={(id) => go(id ? { view: 'article', id } : { view: 'browse' })} onCancel={() => go(articleId ? { view: 'article', id: articleId } : { view: 'browse' })} />
      )}
      {view === 'categories' && <CategoryManager onBack={() => go({ view: 'browse' })} />}
    </div>
  )
}

// ---------------- BROWSE / LANDING ----------------
function Browse({ canAuthor, onOpen, onManageCats }) {
  const { user } = useAuth()
  const [cats, setCats] = useState([])
  const [articles, setArticles] = useState([])
  const [sfiles, setSfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [uploadCat, setUploadCat] = useState(null)   // category id currently uploading to

  const load = useCallback(async () => {
    setLoading(true)
    const [cRes, aRes, fRes] = await Promise.all([
      supabase.from('kb_categories').select('*').order('sort_order').order('name'),
      supabase.from('kb_articles').select('id, title, category_id, status, updated_at, view_count').order('updated_at', { ascending: false }),
      // standalone files only (attached ones live under their article)
      supabase.from('kb_files').select('*').is('article_id', null).order('created_at', { ascending: false }),
    ])
    setCats(cRes.data || [])
    setArticles(aRes.data || [])
    setSfiles(fRes.data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // debounced full-text search via the kb_search RPC (RLS-respecting)
  useEffect(() => {
    if (!q.trim()) { setResults(null); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('kb_search', { q: q.trim() })
      setResults(data || [])
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const visible = canAuthor ? articles : articles.filter(a => a.status === 'published')
  const byCat = (catId) => visible.filter(a => a.category_id === catId)
  const uncategorized = visible.filter(a => !a.category_id)
  const filesInCat = (catId) => sfiles.filter(f => f.category_id === catId && (canAuthor || f.status === 'published'))

  async function uploadStandalone(e, categoryId) {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    if (!picked.length) return
    setUploadCat(categoryId)
    try {
      for (const file of picked) {
        await uploadKbFile(file, { category_id: categoryId, article_id: null, status: 'published' }, user?.id)
      }
      await load()
    } catch (err) { alert('Upload failed: ' + err.message) }
    finally { setUploadCat(null) }
  }
  async function removeStandalone(f) {
    if (!window.confirm(`Remove ${f.name}?`)) return
    await supabase.storage.from('kb-files').remove([f.storage_path])
    await supabase.from('kb_files').delete().eq('id', f.id)
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search the knowledge base…"
          style={{ flex: 1, maxWidth: 480, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)' }}
        />
        {canAuthor && <button className="btn btn-ghost" onClick={onManageCats}>Manage categories</button>}
      </div>

      {results !== null ? (
        <SearchResults results={results} searching={searching} cats={cats} onOpen={onOpen} onClear={() => setQ('')} />
      ) : loading ? (
        <p className="page-sub">Loading…</p>
      ) : cats.length === 0 && visible.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Nothing here yet</h3>
          <p style={{ fontSize: 13 }}>{canAuthor ? 'Create your first category and article to get started.' : 'Articles will appear here once they’re shared with you.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {cats.map(c => {
            const arts = byCat(c.id)
            const cfiles = filesInCat(c.id)
            if (arts.length === 0 && cfiles.length === 0 && !canAuthor) return null
            return (
              <div key={c.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{c.icon || '📁'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                    {c.description && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.description}</div>}
                  </div>
                  {canAuthor && (
                    <label className="btn btn-ghost" style={{ fontSize: 12, cursor: 'pointer', flex: 'none' }}>
                      {uploadCat === c.id ? 'Uploading…' : '+ File'}
                      <input type="file" multiple hidden onChange={(e) => uploadStandalone(e, c.id)} disabled={uploadCat === c.id} />
                    </label>
                  )}
                </div>
                {arts.length === 0 && cfiles.length === 0 ? (
                  <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--ink-soft)' }}>Nothing here yet.</div>
                ) : (
                  <>
                    {arts.map(a => (
                      <button key={a.id} onClick={() => onOpen(a.id)}
                        style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: 0, borderBottom: '1px solid var(--line-soft)', background: 'transparent', padding: '12px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <span style={{ fontSize: 14, color: 'var(--ink)' }}>
                          {a.title}
                          {a.status === 'draft' && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--line-soft)', borderRadius: 4, padding: '1px 6px' }}>DRAFT</span>}
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', flex: 'none' }}>{fmtDate(a.updated_at)}</span>
                      </button>
                    ))}
                    {cfiles.length > 0 && (
                      <div style={{ padding: '4px 18px 10px' }}>
                        {cfiles.map(f => <FileRow key={f.id} f={f} onDelete={canAuthor ? removeStandalone : null} />)}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}

          {uncategorized.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-soft)', fontWeight: 700, fontSize: 15 }}>Uncategorized</div>
              {uncategorized.map(a => (
                <button key={a.id} onClick={() => onOpen(a.id)}
                  style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: 0, borderBottom: '1px solid var(--line-soft)', background: 'transparent', padding: '12px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ fontSize: 14 }}>{a.title}{a.status === 'draft' && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--line-soft)', borderRadius: 4, padding: '1px 6px' }}>DRAFT</span>}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', flex: 'none' }}>{fmtDate(a.updated_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SearchResults({ results, searching, cats, onOpen, onClear }) {
  const catName = (id) => (cats.find(c => c.id === id) || {}).name || ''
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="page-sub" style={{ fontSize: 13 }}>{searching ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`}</span>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={onClear}>Clear</button>
      </div>
      {!searching && results.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>No matches. Try different words.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {results.map(r => (
            <button key={r.id} onClick={() => onOpen(r.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line-soft)', background: 'transparent', padding: '13px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                {r.title}
                {r.category_id && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-soft)', fontWeight: 400 }}>· {catName(r.category_id)}</span>}
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

// ---------------- ARTICLE READER ----------------
function ArticleReader({ id, canAuthor, onBack, onEdit }) {
  const { user } = useAuth()
  const [article, setArticle] = useState(undefined) // undefined=loading, null=not found/no access
  const [cat, setCat] = useState(null)
  const [tags, setTags] = useState([])
  const [myFeedback, setMyFeedback] = useState(null)
  const [files, setFiles] = useState([])
  const countedRef = useRef(false)

  useEffect(() => { (async () => {
    countedRef.current = false
    const { data: a } = await supabase.from('kb_articles').select('*').eq('id', id).maybeSingle()
    if (!a) { setArticle(null); return }
    setArticle(a)
    if (a.category_id) supabase.from('kb_categories').select('*').eq('id', a.category_id).maybeSingle().then(({ data }) => setCat(data))
    supabase.from('kb_article_tags').select('tag_id, tags(name)').eq('article_id', id).eq('is_audience', false)
      .then(({ data }) => setTags((data || []).map(x => x.tags?.name).filter(Boolean)))
    if (user) supabase.from('kb_feedback').select('helpful').eq('article_id', id).eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => setMyFeedback(data ? data.helpful : null))
    supabase.from('kb_files').select('*').eq('article_id', id).order('created_at')
      .then(({ data }) => setFiles(data || []))
    // increment view count once per open
    if (!countedRef.current) {
      countedRef.current = true
      supabase.rpc('kb_increment_view', { article: id }).then(() => {})
    }
  })() }, [id, user])

  async function sendFeedback(helpful) {
    setMyFeedback(helpful)
    await supabase.from('kb_feedback').upsert(
      { article_id: id, profile_id: user.id, helpful },
      { onConflict: 'article_id,profile_id' }
    )
  }

  if (article === undefined) return <p className="page-sub">Loading…</p>
  if (article === null) return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Article not available</h3>
      <p style={{ fontSize: 13 }}>It may be unpublished, or not shared with you.</p>
      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={onBack}>← Back to Knowledge Base</button>
    </div>
  )

  return (
    <div style={{ maxWidth: 760 }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16, fontSize: 13 }} onClick={onBack}>← Back</button>
      <div className="card" style={{ padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{article.title}</h1>
          {canAuthor && <button className="btn btn-ghost" style={{ flex: 'none' }} onClick={() => onEdit(article.id)}>Edit</button>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          {cat && <span>{cat.icon || '📁'} {cat.name}</span>}
          <span>Updated {fmtDate(article.updated_at)}</span>
          {article.status === 'draft' && <span style={{ fontWeight: 700, color: 'var(--accent)' }}>DRAFT</span>}
          {tags.map(t => <span key={t} style={{ background: 'var(--line-soft)', borderRadius: 4, padding: '1px 7px' }}>{t}</span>)}
        </div>
        <div style={{ marginTop: 20, fontSize: 15, lineHeight: 1.7 }}>
          {isEmptyHtml(article.body || '') ? <p style={{ color: 'var(--ink-soft)' }}>This article has no content yet.</p> : <RichContent html={article.body} />}
        </div>
        {files.length > 0 && (
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6 }}>Attachments</div>
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

// ---------------- ARTICLE EDITOR (authors) ----------------
function ArticleEditor({ id, onDone, onCancel }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(!!id)
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('draft')
  const [cats, setCats] = useState([])
  const [allTags, setAllTags] = useState([])
  const [topicTagIds, setTopicTagIds] = useState([])
  const [audienceRoles, setAudienceRoles] = useState([])
  const [audienceTagIds, setAudienceTagIds] = useState([])
  const [overrideAudience, setOverrideAudience] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const bodyRef = useRef('')
  const createdIdRef = useRef(null)   // set if attachments forced an early create

  useEffect(() => { (async () => {
    const [cRes, tRes] = await Promise.all([
      supabase.from('kb_categories').select('*').order('sort_order').order('name'),
      supabase.from('tags').select('id, name').order('name'),
    ])
    setCats(cRes.data || [])
    setAllTags(tRes.data || [])
    if (id) {
      const { data: a } = await supabase.from('kb_articles').select('*').eq('id', id).maybeSingle()
      if (a) {
        setTitle(a.title || ''); setCategoryId(a.category_id || ''); setStatus(a.status || 'draft')
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

  function toggle(list, setList, val) {
    setList(list.includes(val) ? list.filter(x => x !== val) : [...list, val])
  }

  // Attachments require the article to exist (needs article_id). If this is a
  // brand-new unsaved article, save a draft first so we have an id to attach to.
  async function ensureSavedId() {
    if (id) return id
    if (createdIdRef.current) return createdIdRef.current
    const row = {
      title: title.trim() || 'Untitled', body: isEmptyHtml(bodyRef.current) ? null : bodyRef.current,
      category_id: categoryId || null, status: 'draft', audience_roles: audienceRoles,
      override_audience: overrideAudience, author_id: user?.id, updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('kb_articles').insert(row).select('id').single()
    if (error) throw new Error(error.message)
    createdIdRef.current = data.id
    return data.id
  }
  async function onPickFiles(e) {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    if (!picked.length) return
    setUploading(true); setErr('')
    try {
      const aid = await ensureSavedId()
      for (const file of picked) {
        const rec = await uploadKbFile(file, { article_id: aid, category_id: null }, user?.id)
        setFiles(prev => [...prev, rec])
      }
    } catch (e2) { setErr('Upload failed: ' + e2.message) }
    finally { setUploading(false) }
  }
  async function removeFile(f) {
    setFiles(prev => prev.filter(x => x.id !== f.id))
    await supabase.storage.from('kb-files').remove([f.storage_path])
    await supabase.from('kb_files').delete().eq('id', f.id)
  }

  async function save(publish) {
    if (!title.trim()) { setErr('Give the article a title.'); return }
    setBusy(true); setErr('')
    const row = {
      title: title.trim(),
      body: isEmptyHtml(bodyRef.current) ? null : bodyRef.current,
      category_id: categoryId || null,
      status: publish ? 'published' : (status === 'published' ? 'published' : 'draft'),
      audience_roles: audienceRoles,
      override_audience: overrideAudience,
      author_id: user?.id,
      updated_at: new Date().toISOString(),
    }
    if (publish) row.published_at = new Date().toISOString()

    let savedId = id || createdIdRef.current
    if (savedId) {
      const { error } = await supabase.from('kb_articles').update(row).eq('id', savedId)
      if (error) { setErr(error.message); setBusy(false); return }
      // revision snapshot
      await supabase.from('kb_revisions').insert({ article_id: savedId, title: row.title, body: row.body, edited_by: user?.id })
    } else {
      const { data, error } = await supabase.from('kb_articles').insert(row).select('id').single()
      if (error) { setErr(error.message); setBusy(false); return }
      savedId = data.id
    }

    // sync tags: delete all, reinsert topic + audience
    await supabase.from('kb_article_tags').delete().eq('article_id', savedId)
    const tagRows = [
      ...topicTagIds.map(tid => ({ article_id: savedId, tag_id: tid, is_audience: false })),
      ...audienceTagIds.map(tid => ({ article_id: savedId, tag_id: tid, is_audience: true })),
    ]
    if (tagRows.length) await supabase.from('kb_article_tags').insert(tagRows)

    setBusy(false)
    onDone(savedId)
  }

  if (loading) return <p className="page-sub">Loading…</p>

  const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--canvas)' }

  return (
    <div style={{ maxWidth: 760 }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16, fontSize: 13 }} onClick={onCancel}>← Cancel</button>
      {err && <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'var(--failed)', color: 'var(--failed)', fontSize: 13 }}>{err}</div>}

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title" style={{ ...inputStyle, marginTop: 6, fontSize: 16, fontWeight: 600 }} />

        <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Category</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}>
              <option value="">— Uncategorized —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginBottom: 8 }}>Content</label>
        <RichEditor value={bodyRef.current} variant="full" minHeight={260} placeholder="Write the article…" onChange={(html) => { bodyRef.current = html }} />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Topic tags</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {allTags.length === 0 ? <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No tags exist yet. Create them in People &amp; tags.</span> :
            allTags.map(t => (
              <button key={t.id} onClick={() => toggle(topicTagIds, setTopicTagIds, t.id)}
                style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                  background: topicTagIds.includes(t.id) ? 'var(--accent)' : 'var(--surface)', color: topicTagIds.includes(t.id) ? '#fff' : 'var(--ink-soft)' }}>
                {t.name}
              </button>
            ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Attachments</label>
          <label className="btn btn-ghost" style={{ fontSize: 12.5, cursor: 'pointer' }}>
            {uploading ? 'Uploading…' : '+ Add files'}
            <input type="file" multiple hidden onChange={onPickFiles} disabled={uploading} />
          </label>
        </div>
        {files.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No files attached. Add PDFs, docs, or anything else readers should be able to download.</div>
        ) : files.map(f => <FileRow key={f.id} f={f} onDelete={removeFile} />)}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Who can see this</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={overrideAudience} onChange={e => setOverrideAudience(e.target.checked)} />
          Override the category’s audience for this article
        </label>
        {overrideAudience ? (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>Share with these roles and/or tags. Authors and admins always have access.</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Roles</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {ROLES.map(r => (
                <button key={r.key} onClick={() => toggle(audienceRoles, setAudienceRoles, r.key)}
                  style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                    background: audienceRoles.includes(r.key) ? 'var(--accent)' : 'var(--surface)', color: audienceRoles.includes(r.key) ? '#fff' : 'var(--ink-soft)' }}>
                  {r.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Tags</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {allTags.map(t => (
                <button key={t.id} onClick={() => toggle(audienceTagIds, setAudienceTagIds, t.id)}
                  style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                    background: audienceTagIds.includes(t.id) ? 'var(--accent)' : 'var(--surface)', color: audienceTagIds.includes(t.id) ? '#fff' : 'var(--ink-soft)' }}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>This article inherits its category’s audience. Choose a category, or override above.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, position: 'sticky', bottom: 0, background: 'var(--canvas)', padding: '12px 0' }}>
        <button className="btn btn-ghost" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
        <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>Publish</button>
      </div>
    </div>
  )
}

// ---------------- CATEGORY MANAGER (authors) ----------------
function CategoryManager({ onBack }) {
  const [cats, setCats] = useState([])
  const [allTags, setAllTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // category object or 'new'

  const load = useCallback(async () => {
    setLoading(true)
    const [cRes, tRes] = await Promise.all([
      supabase.from('kb_categories').select('*').order('sort_order').order('name'),
      supabase.from('tags').select('id, name').order('name'),
    ])
    setCats(cRes.data || [])
    setAllTags(tRes.data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New category</button>
      </div>
      {editing && <CategoryEditor category={editing === 'new' ? null : editing} allTags={allTags} onDone={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />}
      {loading ? <p className="page-sub">Loading…</p> : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {cats.length === 0 ? <div style={{ padding: 24, color: 'var(--ink-soft)', fontSize: 13 }}>No categories yet.</div> :
            cats.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{c.icon || '📁'}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                      {(c.audience_roles || []).length ? `Roles: ${c.audience_roles.join(', ')}` : 'No role audience'}
                    </div>
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setEditing(c)}>Edit</button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function CategoryEditor({ category, allTags, onDone, onCancel }) {
  const { user } = useAuth()
  const [name, setName] = useState(category?.name || '')
  const [description, setDescription] = useState(category?.description || '')
  const [icon, setIcon] = useState(category?.icon || '📁')
  const [roles, setRoles] = useState(category?.audience_roles || [])
  const [tagIds, setTagIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (category?.id) supabase.from('kb_category_tags').select('tag_id').eq('category_id', category.id)
      .then(({ data }) => setTagIds((data || []).map(x => x.tag_id)))
  }, [category])

  function toggle(list, setList, v) { setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]) }

  async function save() {
    if (!name.trim()) { setErr('Name is required.'); return }
    setBusy(true); setErr('')
    const row = { name: name.trim(), description: description.trim() || null, icon: icon || '📁', audience_roles: roles, updated_at: new Date().toISOString() }
    let catId = category?.id
    if (catId) {
      const { error } = await supabase.from('kb_categories').update(row).eq('id', catId)
      if (error) { setErr(error.message); setBusy(false); return }
    } else {
      row.created_by = user?.id
      const { data, error } = await supabase.from('kb_categories').insert(row).select('id').single()
      if (error) { setErr(error.message); setBusy(false); return }
      catId = data.id
    }
    await supabase.from('kb_category_tags').delete().eq('category_id', catId)
    if (tagIds.length) await supabase.from('kb_category_tags').insert(tagIds.map(tid => ({ category_id: catId, tag_id: tid })))
    setBusy(false); onDone()
  }

  const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--canvas)' }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{category ? 'Edit category' : 'New category'}</div>
      {err && <div style={{ color: 'var(--failed)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={2} style={{ ...inputStyle, width: 56, textAlign: 'center', fontSize: 18 }} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name" style={inputStyle} />
      </div>
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (optional)" style={{ ...inputStyle, marginBottom: 12 }} />
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6 }}>Who can see this category — Roles</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {ROLES.map(r => (
          <button key={r.key} onClick={() => toggle(roles, setRoles, r.key)}
            style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
              background: roles.includes(r.key) ? 'var(--accent)' : 'var(--surface)', color: roles.includes(r.key) ? '#fff' : 'var(--ink-soft)' }}>
            {r.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6 }}>Tags</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {allTags.length === 0 ? <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No tags exist yet.</span> :
          allTags.map(t => (
            <button key={t.id} onClick={() => toggle(tagIds, setTagIds, t.id)}
              style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                background: tagIds.includes(t.id) ? 'var(--accent)' : 'var(--surface)', color: tagIds.includes(t.id) ? '#fff' : 'var(--ink-soft)' }}>
              {t.name}
            </button>
          ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save category'}</button>
      </div>
    </div>
  )
}
