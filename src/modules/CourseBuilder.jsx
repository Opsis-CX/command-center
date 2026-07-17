import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { RichEditor, RichContent } from '../lib/RichEditor'

// Blocks live in a JSONB array with no ids of their own. Assign a client-side
// id on load so React can key by identity — otherwise deleting block 0 makes
// block 1 inherit its editor instance, and its content.
let blockSeq = 0
const nextBlockId = () => `b${Date.now().toString(36)}${(blockSeq++).toString(36)}`
const withIds = (blocks) => (blocks || []).map(b => b._id ? b : { ...b, _id: nextBlockId() })
const stripIds = (blocks) => (blocks || []).map(({ _id, ...rest }) => rest)

// Helpers for the file/attachment block.
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

// Callout ("insight") tones. Backward-compatible: an existing callout with no
// tone falls back to 'info', which is the original accent styling. Used by both
// the editor and the shared learner renderer so they never drift.
const CALLOUT_TONES = {
  info:    { label: 'Info',      icon: '💡', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  tip:     { label: 'Tip',       icon: '✅', bg: 'var(--passed-bg)', fg: 'var(--passed)' },
  warning: { label: 'Important', icon: '⚠️', bg: 'var(--failed-bg)', fg: 'var(--failed)' },
}
const calloutTone = (t) => CALLOUT_TONES[t] || CALLOUT_TONES.info

// Detect phone-width viewport; updates on resize.
function useIsMobile(breakpoint = 700) {
  const [mobile, setMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false)
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= breakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])
  return mobile
}

// Tracks whether a scrollable element has been scrolled to (near) its bottom.
// Re-arms whenever `resetKey` changes. If the content doesn't overflow, it
// counts as read immediately. A ResizeObserver re-checks after images and
// video iframes settle, since those change height well after mount.
export function useScrolledToBottom(ref, resetKey, slack = 24) {
  const [atBottom, setAtBottom] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setAtBottom(false)

    // Only unlock when the learner has actually reached the end. Images have
    // zero height until they download, so an early check can wrongly conclude
    // "nothing to scroll" — or, worse, measure a short page and then never
    // re-evaluate once the images make it tall. So: re-check on every growth
    // (ResizeObserver on the CONTENT, not just the box) and on each image load.
    const check = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const scrollable = scrollHeight - clientHeight > slack
      setAtBottom(!scrollable || scrollTop + clientHeight >= scrollHeight - slack)
    }

    const t = setTimeout(check, 50)
    el.addEventListener('scroll', check, { passive: true })

    // Observe the container AND its children — the container's own box often
    // doesn't change size while its contents grow.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    Array.from(el.children).forEach(c => ro.observe(c))

    // Images settle well after mount; re-measure as each one lands.
    const imgs = Array.from(el.querySelectorAll('img'))
    imgs.forEach(img => {
      if (!img.complete) {
        img.addEventListener('load', check)
        img.addEventListener('error', check)
      }
    })

    // Safety net for anything that resizes without notifying us (fonts,
    // late-loading iframes): a couple of delayed re-checks.
    const t2 = setTimeout(check, 600)
    const t3 = setTimeout(check, 1800)

    return () => {
      clearTimeout(t); clearTimeout(t2); clearTimeout(t3)
      el.removeEventListener('scroll', check)
      imgs.forEach(img => { img.removeEventListener('load', check); img.removeEventListener('error', check) })
      ro.disconnect()
    }
  }, [ref, resetKey, slack])
  return atBottom
}

// ============ COURSE BUILDER ============
export default function CourseBuilder() {
  const [courses, setCourses] = useState([])
  const [certs, setCerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [cRes, certRes] = await Promise.all([
        supabase.from('courses').select('*').order('created_at', { ascending: false }),
        supabase.from('certifications').select('id, name').eq('active', true).order('name'),
      ])
      if (cRes.error) throw cRes.error
      setCourses(cRes.data || [])
      setCerts(certRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  async function deleteCourse(id, title) {
    if (!window.confirm(`Delete the course "${title}"? Its lessons and quiz will be removed. This cannot be undone.`)) return
    try {
      const { error } = await supabase.from('courses').delete().eq('id', id)
      if (error) throw error
      load()
    } catch (e) { setErr(e.message) }
  }

  if (editingId) {
    return <LessonEditor courseId={editingId} onBack={() => { setEditingId(null); load() }} />
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Course builder</h1>
          <p className="page-sub">Build the lessons and quiz agents complete to earn a certification.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New course</button>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}>
        <b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      {loading ? <p className="page-sub">Loading…</p> : (
        <div className="cards">
          {courses.length === 0 && <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 20 }}>No courses yet. Create one to start building content.</div></div>}
          {courses.map(c => (
            <div className="card" key={c.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{c.title}</h3>
                <span className="badge" style={{ background: c.status === 'published' ? 'var(--passed-bg)' : 'var(--needed-bg)', color: c.status === 'published' ? 'var(--passed)' : 'var(--needed)' }}>
                  {c.status}
                </span>
              </div>
              {c.description && <p className="page-sub" style={{ marginTop: 5 }}>{c.description}</p>}
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setEditingId(c.id)}>Edit content</button>
                <button className="btn btn-ghost" style={{ color: 'var(--failed)', borderColor: 'var(--failed-bg)' }} onClick={() => deleteCourse(c.id, c.title)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <NewCourseModal certs={certs} onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); load(); setEditingId(id) }} />}
    </div>
  )
}

function NewCourseModal({ certs, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [certId, setCertId] = useState('')
  const [passThreshold, setPassThreshold] = useState(80)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!title.trim()) { setErr('Give the course a title.'); return }
    setSaving(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('courses').insert({
        title: title.trim(),
        description: description.trim() || null,
        certification_id: certId || null,
        pass_threshold: passThreshold,
        status: 'draft',
        created_by: user?.id ?? null,
      }).select().single()
      if (error) throw error
      onCreated(data.id)
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>New course</h3>
        <p className="page-sub" style={{ marginBottom: 18 }}>Tie it to a certification so passing the quiz certifies the agent.</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}
        <div className="field"><label>Course title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="GarageCo Appointment Setter Course" autoFocus /></div>
        <div className="field"><label>Description <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>
        <div className="field"><label>Grants which certification?</label>
          <select value={certId} onChange={e => setCertId(e.target.value)}>
            <option value="">None (standalone course)</option>
            {certs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="field"><label>Pass mark (%)</label>
          <input type="number" min="0" max="100" value={passThreshold} onChange={e => setPassThreshold(+e.target.value)} style={{ width: 100 }} /></div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create & build'}</button>
        </div>
      </div>
    </div>
  )
}

// ============ LESSON EDITOR ============
function LessonEditor({ courseId, onBack }) {
  const [course, setCourse] = useState(null)
  const [lessons, setLessons] = useState([])
  const [activeLesson, setActiveLesson] = useState(null)
  const [tab, setTab] = useState('lessons')
  const [previewing, setPreviewing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const isMobile = useIsMobile()

  useEffect(() => { load() }, [courseId])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [coRes, leRes] = await Promise.all([
        supabase.from('courses').select('*').eq('id', courseId).single(),
        supabase.from('lessons').select('*').eq('course_id', courseId).order('sort_order'),
      ])
      if (coRes.error) throw coRes.error
      setCourse(coRes.data)
      setLessons(leRes.data || [])
      if ((leRes.data || []).length && !activeLesson) setActiveLesson(leRes.data[0].id)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  async function addLesson() {
    try {
      const { data, error } = await supabase.from('lessons').insert({
        course_id: courseId, title: 'New lesson', sort_order: lessons.length,
        content_blocks: [{ type: 'text', html: '' }],
      }).select().single()
      if (error) throw error
      setLessons(l => [...l, data]); setActiveLesson(data.id); setTab('lessons')
    } catch (e) { setErr(e.message) }
  }

  // Delete a lesson and renumber the rest so ordering stays 0..n-1.
  async function deleteLesson(l) {
    if (!window.confirm(`Delete the lesson "${l.title || 'Untitled'}"? This cannot be undone.`)) return
    try {
      const { error } = await supabase.from('lessons').delete().eq('id', l.id)
      if (error) throw error
      const rest = lessons.filter(x => x.id !== l.id)
      await Promise.all(rest.map((x, idx) =>
        x.sort_order === idx ? null : supabase.from('lessons').update({ sort_order: idx }).eq('id', x.id)
      ).filter(Boolean))
      setLessons(rest.map((x, idx) => ({ ...x, sort_order: idx })))
      if (activeLesson === l.id) setActiveLesson(rest[0]?.id || null)
    } catch (e) { setErr(e.message) }
  }

  async function saveLesson(lesson) {
    try {
      const { error } = await supabase.from('lessons')
        .update({ title: lesson.title, content_blocks: lesson.content_blocks, updated_at: new Date().toISOString() })
        .eq('id', lesson.id)
      if (error) throw error
      setLessons(ls => ls.map(l => l.id === lesson.id ? lesson : l))
      flash('Lesson saved')
    } catch (e) { setErr(e.message) }
  }

  async function publish() {
    try {
      const next = course.status === 'published' ? 'draft' : 'published'
      const { error } = await supabase.from('courses').update({ status: next }).eq('id', courseId)
      if (error) throw error
      setCourse(c => ({ ...c, status: next }))
      flash(next === 'published' ? 'Published' : 'Unpublished')
    } catch (e) { setErr(e.message) }
  }

  function flash(m) { setSaveMsg(m); setTimeout(() => setSaveMsg(''), 2000) }

  if (loading) return <p className="page-sub">Loading course…</p>

  const lesson = lessons.find(l => l.id === activeLesson)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 8 }}>← All courses</button>
          <h1 className="page-title" style={{ fontSize: 20 }}>{course?.title}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveMsg && <span className="page-sub" style={{ color: 'var(--passed)' }}>{saveMsg}</span>}
          <button className="btn btn-ghost" onClick={() => setPreviewing(true)}>Preview</button>
          <button className="btn btn-cta" onClick={publish}>{course?.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      {previewing && <CoursePreview course={course} lessons={lessons} onClose={() => setPreviewing(false)} />}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={'btn ' + (tab === 'lessons' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('lessons')}>Lessons</button>
        <button className={'btn ' + (tab === 'quiz' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('quiz')}>Quiz &amp; scoring</button>
      </div>

      {tab === 'lessons' ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr', gap: 16 }}>
          <div className="card" style={{ padding: 12, height: 'fit-content' }}>
            {lessons.map((l, i) => (
              <div key={l.id} className="lesson-row"
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: l.id === activeLesson ? 'var(--accent-bg)' : 'transparent', borderRadius: 8, marginBottom: 2 }}>
                <button onClick={() => setActiveLesson(l.id)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'transparent', color: l.id === activeLesson ? 'var(--accent)' : 'var(--ink)', padding: '9px 10px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i + 1}. {l.title || 'Untitled'}
                </button>
                <button className="lesson-del" title="Delete lesson" onClick={() => deleteLesson(l)}
                  style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, padding: '4px 8px', borderRadius: 6, fontFamily: 'inherit' }}>✕</button>
              </div>
            ))}
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={addLesson}>+ Add lesson</button>
          </div>
          {lesson ? <LessonBody key={lesson.id} lesson={lesson} onSave={saveLesson} />
            : <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>Add a lesson to start.</div></div>}
        </div>
      ) : (
        <QuizEditor courseId={courseId} />
      )}
    </div>
  )
}

// ============ LESSON BODY (block editor) ============
// Each text/callout block owns a RichEditor instance. Editing state stays
// local; the parent hears about it only on Save.
function LessonBody({ lesson, onSave }) {
  const [title, setTitle] = useState(lesson.title)
  const [blocks, setBlocks] = useState(() => withIds(lesson.content_blocks))

  // addBlock(type, atIndex): insert a new block. Omit atIndex (or pass null) to
  // append to the end; pass an index to drop it *between* existing blocks.
  function addBlock(type, atIndex) {
    const base = type === 'text' ? { type: 'text', html: '' }
      : type === 'heading' ? { type: 'heading', text: '', level: 2 }
      : type === 'image' ? { type: 'image', url: '' }
      : type === 'video' ? { type: 'video', embed: '' }
      : type === 'file' ? { type: 'file', url: '', name: '', size: 0, mime: '' }
      : { type: 'callout', tone: 'info', html: '' }
    const block = { ...base, _id: nextBlockId() }
    setBlocks(bs => {
      if (atIndex == null || atIndex >= bs.length) return [...bs, block]
      const copy = bs.slice()
      copy.splice(Math.max(0, atIndex), 0, block)
      return copy
    })
  }

  // Move a block one slot up (dir -1) or down (dir +1).
  function moveBlock(id, dir) {
    setBlocks(bs => {
      const i = bs.findIndex(b => b._id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= bs.length) return bs
      const copy = bs.slice()
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  }

  const setBlock = (id, patch) => setBlocks(bs => bs.map(b => b._id === id ? { ...b, ...patch } : b))
  const delBlock = (id) => setBlocks(bs => bs.filter(b => b._id !== id))

  function toEmbed(url) {
    const yt = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/); if (yt) return `https://www.youtube.com/embed/${yt[1]}`
    const vm = url.match(/vimeo\.com\/(\d+)/); if (vm) return `https://player.vimeo.com/video/${vm[1]}`
    return url
  }

  async function uploadImage(file, id) {
    try {
      const ext = file.name.split('.').pop()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('course-media').upload(path, file)
      if (upErr) throw upErr
      const { data } = supabase.storage.from('course-media').getPublicUrl(path)
      setBlock(id, { url: data.publicUrl })
    } catch (e) { alert('Upload failed: ' + e.message) }
  }

  async function uploadFile(file, id) {
    try {
      const safe = file.name.replace(/[^\w.\- ]+/g, '_')
      const path = `files/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`
      const { error: upErr } = await supabase.storage.from('course-media').upload(path, file, { contentType: file.type || undefined })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('course-media').getPublicUrl(path)
      setBlock(id, { url: data.publicUrl, name: file.name, size: file.size, mime: file.type || '' })
    } catch (e) { alert('Upload failed: ' + e.message) }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          style={{ border: 0, fontSize: 17, fontWeight: 600, outline: 'none', flex: 1, fontFamily: 'inherit', color: 'var(--ink)' }} />
        <button className="btn btn-primary"
          onClick={() => onSave({ ...lesson, title, content_blocks: stripIds(blocks) })}>Save lesson</button>
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line-soft)', display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap', background: '#fbfcfd' }}>
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 600, marginRight: 4 }}>Add to end:</span>
        <AddBtn onClick={() => addBlock('heading')}>▤ Heading</AddBtn>
        <AddBtn onClick={() => addBlock('text')}>¶ Text</AddBtn>
        <AddBtn onClick={() => addBlock('image')}>🖼 Image</AddBtn>
        <AddBtn onClick={() => addBlock('video')}>▶ Video</AddBtn>
        <AddBtn onClick={() => addBlock('file')}>📎 File</AddBtn>
        <AddBtn onClick={() => addBlock('callout')}>💡 Insight</AddBtn>
      </div>

      <div style={{ padding: '20px 22px', minHeight: 260 }}>
        {blocks.map((b, i) => (
          <div key={b._id}>
            {/* Insert point ABOVE this block — drop any block type between sections */}
            <InsertBar onAdd={(type) => addBlock(type, i)} />

            <div style={{ position: 'relative', margin: '4px 0' }}>
              <div style={{ position: 'absolute', right: -6, top: 2, zIndex: 2, display: 'flex', gap: 1 }}>
                <IconBtn title="Move up" disabled={i === 0} onClick={() => moveBlock(b._id, -1)}>↑</IconBtn>
                <IconBtn title="Move down" disabled={i === blocks.length - 1} onClick={() => moveBlock(b._id, 1)}>↓</IconBtn>
                <IconBtn title="Delete" onClick={() => delBlock(b._id)}>✕</IconBtn>
              </div>

            {b.type === 'heading' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 60 }}>
                <select value={b.level || 2} onChange={e => setBlock(b._id, { level: +e.target.value })}
                  style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 6px', fontSize: 12, fontFamily: 'inherit', flex: 'none' }}>
                  <option value={2}>Heading</option>
                  <option value={3}>Subheading</option>
                </select>
                <input value={b.text || ''} onChange={e => setBlock(b._id, { text: e.target.value })}
                  placeholder="Section heading…"
                  style={{ flex: 1, border: 0, borderBottom: '2px solid var(--line-soft)', fontSize: (b.level || 2) === 2 ? 21 : 17, fontWeight: 700, padding: '4px 0', outline: 'none', fontFamily: 'inherit', color: 'var(--ink)' }} />
              </div>
            )}

            {(b.type === 'text' || b.type === 'callout') && (
              <div style={{
                padding: b.type === 'callout' ? '10px 14px' : 0,
                borderRadius: b.type === 'callout' ? 8 : 0,
                borderLeft: b.type === 'callout' ? `3px solid ${calloutTone(b.tone).fg}` : 'none',
                background: b.type === 'callout' ? calloutTone(b.tone).bg : 'transparent',
              }}>
                {b.type === 'callout' && (
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                    {Object.entries(CALLOUT_TONES).map(([key, t]) => (
                      <button key={key} onClick={() => setBlock(b._id, { tone: key })}
                        style={{ border: '1px solid ' + ((b.tone || 'info') === key ? t.fg : 'var(--line)'), background: (b.tone || 'info') === key ? t.fg : 'transparent', color: (b.tone || 'info') === key ? '#fff' : 'var(--ink-soft)', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 12, cursor: 'pointer' }}>
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </div>
                )}
                <RichEditor
                  variant="full"
                  value={b.html || ''}
                  onChange={html => setBlock(b._id, { html })}
                  placeholder={b.type === 'callout' ? 'Insight text…' : 'Write the lesson…'}
                  minHeight={80}
                  maxHeight={2000}
                />
              </div>
            )}

            {b.type === 'image' && (b.url
              ? <ImageBlock block={b} onChange={patch => setBlock(b._id, patch)} />
              : <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 20, textAlign: 'center', background: 'var(--canvas)' }}>
                  <div className="page-sub" style={{ marginBottom: 8 }}>Upload an image from your computer</div>
                  <input type="file" accept="image/*"
                    onChange={e => { if (e.target.files[0]) uploadImage(e.target.files[0], b._id) }} />
                </div>)}

            {b.type === 'video' && (b.embed
              ? <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
                  <iframe src={b.embed} allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                    referrerPolicy="no-referrer"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 8 }} />
                </div>
              : <input placeholder="Paste video link (YouTube, Vimeo)" onChange={e => setBlock(b._id, { embed: toEmbed(e.target.value) })}
                  style={{ width: '100%', padding: 9, border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit' }} />)}

            {b.type === 'file' && (b.url
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 22, flex: 'none' }}>{fileIcon(b.mime)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || 'File'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{fmtSize(b.size)}</div>
                  </div>
                  <label className="btn btn-ghost" style={{ fontSize: 12.5, cursor: 'pointer', flex: 'none' }}>
                    Replace
                    <input type="file" hidden onChange={e => { if (e.target.files[0]) uploadFile(e.target.files[0], b._id) }} />
                  </label>
                </div>
              : <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 20, textAlign: 'center', background: 'var(--canvas)' }}>
                  <div className="page-sub" style={{ marginBottom: 8 }}>Upload a file for learners to download (PDF, doc, sheet, anything)</div>
                  <input type="file" onChange={e => { if (e.target.files[0]) uploadFile(e.target.files[0], b._id) }} />
                </div>)}
            </div>
          </div>
        ))}
        {/* Insert point at the very end */}
        {blocks.length > 0 && <InsertBar onAdd={(type) => addBlock(type, blocks.length)} />}
        {blocks.length === 0 && <p className="page-sub">Use the toolbar above to add a heading, text, image, video, file, or insight.</p>}
      </div>
    </div>
  )
}

function ImageBlock({ block, onChange }) {
  const widths = { small: '30%', medium: '55%', large: '80%', full: '100%' }
  const w = block.width || 'full'
  const align = block.align || 'left'
  const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'

  const Btn = ({ label, active, onClick }) => (
    <button onClick={onClick} style={{ border: '1px solid var(--line)', background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink-soft)', fontSize: 11.5, fontWeight: 600, padding: '4px 9px', borderRadius: 6, cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: justify }}>
        <img src={block.url} alt="" style={{ width: widths[w], maxWidth: '100%', borderRadius: 8, display: 'block' }} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginRight: 2 }}>Size</span>
        <Btn label="S" active={w === 'small'} onClick={() => onChange({ width: 'small' })} />
        <Btn label="M" active={w === 'medium'} onClick={() => onChange({ width: 'medium' })} />
        <Btn label="L" active={w === 'large'} onClick={() => onChange({ width: 'large' })} />
        <Btn label="Full" active={w === 'full'} onClick={() => onChange({ width: 'full' })} />
        <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
        <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginRight: 2 }}>Align</span>
        <Btn label="Left" active={align === 'left'} onClick={() => onChange({ align: 'left' })} />
        <Btn label="Center" active={align === 'center'} onClick={() => onChange({ align: 'center' })} />
        <Btn label="Right" active={align === 'right'} onClick={() => onChange({ align: 'right' })} />
      </div>
    </div>
  )
}

// ============ COURSE PREVIEW (reusable lesson renderer) ============
export function LessonView({ blocks }) {
  const widths = { small: '30%', medium: '55%', large: '80%', full: '100%' }
  return (
    <div>
      {(blocks || []).map((b, i) => {
        if (b.type === 'heading') {
          if (!b.text) return null
          const big = (b.level || 2) === 2
          return <div key={i} style={{ fontSize: big ? 22 : 18, fontWeight: 700, lineHeight: 1.3, color: 'var(--ink)', margin: big ? '26px 0 10px' : '20px 0 6px', paddingBottom: big ? 6 : 0, borderBottom: big ? '2px solid var(--line)' : 'none' }}>{b.text}</div>
        }
        if (b.type === 'callout') {
          const t = calloutTone(b.tone)
          return <RichContent key={i} html={b.html}
            style={{ fontSize: 15.5, lineHeight: 1.7, margin: '12px 0', padding: '13px 15px', borderRadius: 8, borderLeft: `3px solid ${t.fg}`, background: t.bg }} />
        }
        if (b.type === 'text') {
          return <RichContent key={i} html={b.html}
            style={{ fontSize: 15.5, lineHeight: 1.7, margin: '12px 0' }} />
        }
        if (b.type === 'image' && b.url) {
          const justify = b.align === 'center' ? 'center' : b.align === 'right' ? 'flex-end' : 'flex-start'
          return <div key={i} style={{ display: 'flex', justifyContent: justify, margin: '14px 0' }}>
            <img src={b.url} alt="" style={{ width: widths[b.width || 'full'], maxWidth: '100%', borderRadius: 10 }} />
          </div>
        }
        if (b.type === 'video' && b.embed) {
          return <div key={i} style={{ position: 'relative', paddingBottom: '56.25%', height: 0, margin: '14px 0' }}>
            <iframe src={b.embed} allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              referrerPolicy="no-referrer"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 10 }} />
          </div>
        }
        if (b.type === 'file' && b.url) {
          return <a key={i} href={b.url} target="_blank" rel="noreferrer" download={b.name || undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', margin: '14px 0', textDecoration: 'none', color: 'inherit', background: 'var(--surface)' }}>
            <span style={{ fontSize: 22, flex: 'none' }}>{fileIcon(b.mime)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || 'Download file'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{fmtSize(b.size)}</div>
            </div>
            <span className="btn btn-ghost" style={{ fontSize: 12.5, flex: 'none' }}>⬇ Download</span>
          </a>
        }
        return null
      })}
    </div>
  )
}

function CoursePreview({ course, lessons, onClose }) {
  const [idx, setIdx] = React.useState(0)
  const scrollRef = React.useRef(null)
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [idx])

  // Gate: Next stays disabled until the lesson has been scrolled to the bottom.
  const readToEnd = useScrolledToBottom(scrollRef, idx)

  const total = lessons.length
  const lesson = lessons[idx]
  const pct = total ? Math.round(((idx + 1) / total) * 100) : 0

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 720, maxWidth: '100%', padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>PREVIEW</div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{course?.title}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Close preview</button>
        </div>

        <div style={{ height: 5, background: 'var(--line-soft)' }}>
          <div style={{ height: '100%', width: pct + '%', background: 'var(--cta)', transition: 'width .2s' }} />
        </div>

        <div ref={scrollRef} style={{ padding: '22px 26px', overflow: 'auto', flex: 1 }}>
          {total === 0 ? <p className="page-sub">No lessons yet.</p> : (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 4 }}>Lesson {idx + 1} of {total}</div>
              <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>{lesson?.title}</h2>
              <LessonView blocks={lesson?.content_blocks} />
            </>
          )}
        </div>

        {total > 0 && (
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-ghost" disabled={idx === 0} onClick={() => setIdx(i => Math.max(0, i - 1))}>← Back</button>
            {!readToEnd && idx < total - 1 && (
              <span className="page-sub" style={{ fontSize: 12.5 }}>Scroll to the bottom to continue</span>
            )}
            {idx < total - 1
              ? <button className="btn btn-primary" disabled={!readToEnd}
                  style={!readToEnd ? { opacity: .45, cursor: 'not-allowed' } : undefined}
                  onClick={() => setIdx(i => Math.min(total - 1, i + 1))}>Next →</button>
              : <span className="page-sub" style={{ alignSelf: 'center' }}>End of lessons — quiz comes next for agents</span>}
          </div>
        )}
      </div>
    </div>
  )
}

const AddBtn = ({ children, onClick }) => (
  <button onClick={onClick} style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', fontSize: 12.5, fontWeight: 600, padding: '6px 9px', borderRadius: 6, cursor: 'pointer' }}>{children}</button>
)

// Small square icon button used for per-block move/delete controls.
const IconBtn = ({ children, onClick, title, disabled }) => (
  <button onClick={onClick} title={title} disabled={disabled}
    style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', cursor: disabled ? 'default' : 'pointer', fontSize: 13, lineHeight: 1, width: 20, height: 20, borderRadius: 5, opacity: disabled ? 0.25 : 0.75 }}>{children}</button>
)

// A slim divider that sits between blocks. Hovering reveals a "+ Insert" pill;
// clicking it opens a compact type picker so a new block can be dropped at this
// exact position (between existing sections) rather than only at the end.
function InsertBar({ onAdd }) {
  const [hover, setHover] = useState(false)
  const [open, setOpen] = useState(false)
  const show = hover || open
  const pick = (type) => { onAdd(type); setOpen(false); setHover(false) }
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setOpen(false) }}
      style={{ margin: '2px 0' }}>
      {!open ? (
        <div onClick={() => setOpen(true)} title="Insert a block here"
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 18, cursor: 'pointer' }}>
          <div style={{ flex: 1, height: 1, background: show ? 'var(--accent)' : 'transparent' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', opacity: show ? 1 : 0, border: '1px solid var(--accent)', borderRadius: 12, padding: '1px 9px', lineHeight: '15px', background: 'var(--surface)', whiteSpace: 'nowrap' }}>+ Insert</span>
          <div style={{ flex: 1, height: 1, background: show ? 'var(--accent)' : 'transparent' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', background: '#fbfcfd', border: '1px solid var(--accent)', borderRadius: 8 }}>
          <AddBtn onClick={() => pick('heading')}>▤ Heading</AddBtn>
          <AddBtn onClick={() => pick('text')}>¶ Text</AddBtn>
          <AddBtn onClick={() => pick('image')}>🖼 Image</AddBtn>
          <AddBtn onClick={() => pick('video')}>▶ Video</AddBtn>
          <AddBtn onClick={() => pick('file')}>📎 File</AddBtn>
          <AddBtn onClick={() => pick('callout')}>💡 Insight</AddBtn>
          <button onClick={() => setOpen(false)} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
        </div>
      )}
    </div>
  )
}

// ============ QUIZ EDITOR ============
function QuizEditor({ courseId }) {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [perAttempt, setPerAttempt] = useState('')     // '' = ask all
  const [perSaving, setPerSaving] = useState(false)
  const [perMsg, setPerMsg] = useState('')

  useEffect(() => { load() }, [courseId])

  async function load() {
    setLoading(true)
    try {
      const { data: crs } = await supabase.from('courses')
        .select('questions_per_attempt').eq('id', courseId).maybeSingle()
      setPerAttempt(crs?.questions_per_attempt ? String(crs.questions_per_attempt) : '')
      const { data: qs, error } = await supabase.from('quiz_questions')
        .select('*').eq('course_id', courseId).order('sort_order')
      if (error) throw error
      const withOpts = await Promise.all((qs || []).map(async q => {
        const { data: opts } = await supabase.from('quiz_options')
          .select('*').eq('question_id', q.id).order('sort_order')
        return { ...q, options: opts || [] }
      }))
      setQuestions(withOpts)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  async function addQuestion() {
    try {
      const { data, error } = await supabase.from('quiz_questions')
        .insert({ course_id: courseId, prompt: '', kind: 'single', sort_order: questions.length, points: 1 })
        .select().single()
      if (error) throw error
      const { data: opts } = await supabase.from('quiz_options').insert([
        { question_id: data.id, label: '', is_correct: true, sort_order: 0 },
        { question_id: data.id, label: '', is_correct: false, sort_order: 1 },
      ]).select()
      setQuestions(q => [...q, { ...data, options: opts || [] }])
    } catch (e) { setErr(e.message) }
  }

  async function saveQuestion(q) {
    try {
      await supabase.from('quiz_questions').update({ prompt: q.prompt }).eq('id', q.id)
      for (const o of q.options) {
        await supabase.from('quiz_options').update({ label: o.label, is_correct: o.is_correct }).eq('id', o.id)
      }
      flash('Saved')
    } catch (e) { setErr(e.message) }
  }

  async function addOption(q) {
    const { data } = await supabase.from('quiz_options')
      .insert({ question_id: q.id, label: '', is_correct: false, sort_order: q.options.length }).select().single()
    setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, options: [...x.options, data] } : x))
  }

  async function delOption(q, oid) {
    await supabase.from('quiz_options').delete().eq('id', oid)
    setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, options: x.options.filter(o => o.id !== oid) } : x))
  }

  function setOpt(qid, oid, patch) {
    setQuestions(qs => qs.map(q => q.id === qid ? { ...q, options: q.options.map(o => o.id === oid ? { ...o, ...patch } : o) } : q))
  }

  function markCorrect(qid, oid) {
    setQuestions(qs => qs.map(q => q.id === qid ? { ...q, options: q.options.map(o => ({ ...o, is_correct: o.id === oid })) } : q))
  }

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 1800) }

  if (loading) return <p className="page-sub">Loading quiz…</p>

  async function savePerAttempt() {
    setPerSaving(true); setPerMsg('')
    const n = perAttempt === '' ? null : Math.max(1, parseInt(perAttempt, 10) || 0) || null
    const { error } = await supabase.from('courses').update({ questions_per_attempt: n }).eq('id', courseId)
    setPerSaving(false)
    if (error) { setPerMsg('Could not save: ' + error.message); return }
    setPerAttempt(n ? String(n) : '')
    setPerMsg('Saved ✓'); setTimeout(() => setPerMsg(''), 1800)
  }

  const poolNote = (() => {
    const n = parseInt(perAttempt, 10)
    if (!perAttempt || !n) return `Every attempt asks all ${questions.length} questions, shuffled.`
    if (n >= questions.length) return `You've set ${n} but the pool only has ${questions.length} — everyone gets all of them (shuffled) until you add more.`
    return `Each attempt draws ${n} random questions from your pool of ${questions.length} — different people (and retakes) get different questions in a different order.`
  })()

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
        <b style={{ fontSize: 14 }}>🎲 Randomized question pool</b>
        <p className="page-sub" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
          Build a bigger pool than the quiz asks (e.g. 30 questions, ask 20). The server picks each attempt's
          questions at random, in random order, with shuffled answer choices — so answers can't be passed around.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Questions per attempt</label>
          <input type="number" min="1" value={perAttempt} onChange={e => setPerAttempt(e.target.value)} placeholder="all"
            style={{ width: 80, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit' }} />
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={savePerAttempt} disabled={perSaving}>{perSaving ? 'Saving…' : 'Save'}</button>
          {perMsg && <span className="page-sub" style={{ color: perMsg.startsWith('Saved') ? 'var(--passed)' : 'var(--failed)', fontSize: 12.5 }}>{perMsg}</span>}
        </div>
        <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>{poolNote}</p>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 12 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}
      {questions.map((q, qi) => (
        <div className="card" key={q.id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{qi + 1}</span>
            <input value={q.prompt} placeholder="Question prompt…"
              onChange={e => setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, prompt: e.target.value } : x))}
              style={{ flex: 1, border: 0, borderBottom: '1px solid var(--line-soft)', fontSize: 15, fontWeight: 500, padding: '5px 0', outline: 'none', fontFamily: 'inherit' }} />
          </div>
          {q.options.map(o => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
              <span onClick={() => markCorrect(q.id, o.id)} title="Mark correct"
                style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid ' + (o.is_correct ? 'var(--passed)' : 'var(--line)'), background: o.is_correct ? 'var(--passed)' : 'transparent', cursor: 'pointer', flex: 'none' }} />
              <input value={o.label} placeholder="Answer choice…" onChange={e => setOpt(q.id, o.id, { label: e.target.value })}
                style={{ flex: 1, border: 0, borderBottom: '1px solid transparent', fontSize: 14, padding: '4px 0', outline: 'none', fontFamily: 'inherit' }} />
              <button onClick={() => delOption(q, o.id)} style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', opacity: .5 }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={() => addOption(q)}>+ Add choice</button>
            <button className="btn btn-primary" onClick={() => saveQuestion(q)}>Save question</button>
            {msg && <span className="page-sub" style={{ color: 'var(--passed)', alignSelf: 'center' }}>{msg}</span>}
          </div>
        </div>
      ))}
      <button className="btn btn-cta" onClick={addQuestion}>+ Add question</button>
    </div>
  )
}
