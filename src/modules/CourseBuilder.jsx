import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import RichContent from './RichContent'

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
              <button key={l.id} onClick={() => setActiveLesson(l.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: l.id === activeLesson ? 'var(--accent-bg)' : 'transparent', color: l.id === activeLesson ? 'var(--accent)' : 'var(--ink)', padding: '9px 10px', borderRadius: 8, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', marginBottom: 2, fontFamily: 'inherit' }}>
                {i + 1}. {l.title || 'Untitled'}
              </button>
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
// Keeps all editing state LOCAL so typing never re-renders the parent
// (that's what caused the cursor to jump). Reports up only on Save.
function LessonBody({ lesson, onSave }) {
  const [title, setTitle] = useState(lesson.title)
  const [blocks, setBlocks] = useState(lesson.content_blocks || [])
  function addBlock(type) {
    const b = type === 'text' ? { type: 'text', html: '' }
      : type === 'image' ? { type: 'image', url: '' }
      : type === 'video' ? { type: 'video', embed: '' }
      : { type: 'callout', tone: 'info', html: '' }
    setBlocks(bs => [...bs, b])
  }
  function setBlock(i, patch) { setBlocks(bs => bs.map((b, j) => j === i ? { ...b, ...patch } : b)) }
  function delBlock(i) { setBlocks(bs => bs.filter((_, j) => j !== i)) }
  function toEmbed(url) {
    const yt = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/); if (yt) return `https://www.youtube.com/embed/${yt[1]}`
    const vm = url.match(/vimeo\.com\/(\d+)/); if (vm) return `https://player.vimeo.com/video/${vm[1]}`
    return url
  }
  function exec(cmd, val) { document.execCommand(cmd, false, val || null) }
  async function uploadImage(file, i) {
    try {
      const ext = file.name.split('.').pop()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('course-media').upload(path, file)
      if (upErr) throw upErr
      const { data } = supabase.storage.from('course-media').getPublicUrl(path)
      setBlock(i, { url: data.publicUrl })
    } catch (e) { alert('Upload failed: ' + e.message) }
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          style={{ border: 0, fontSize: 17, fontWeight: 600, outline: 'none', flex: 1, fontFamily: 'inherit', color: 'var(--ink)' }} />
        <button className="btn btn-primary" onClick={() => onSave({ ...lesson, title, content_blocks: blocks })}>Save lesson</button>
      </div>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line-soft)', display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', background: '#fbfcfd' }}>
        <TB onClick={() => exec('bold')}><b>B</b></TB>
        <TB onClick={() => exec('italic')}><i>I</i></TB>
        <TB onClick={() => exec('underline')}><u>U</u></TB>
        <Divider />
        <TB onClick={() => exec('insertUnorderedList')}>• ≡</TB>
        <TB onClick={() => exec('outdent')}>⇤</TB>
        <TB onClick={() => exec('indent')}>⇥</TB>
        <Divider />
        {['#0d1518', '#0077B6', '#00E6E6', '#1f8a53', '#c0392b', '#245866'].map(c =>
          <span key={c} onMouseDown={e => e.preventDefault()} onClick={() => exec('foreColor', c)}
            style={{ width: 18, height: 18, borderRadius: 4, background: c, cursor: 'pointer', border: '1px solid rgba(0,0,0,.1)' }} />)}
        <Divider />
        <AddBtn onClick={() => addBlock('text')}>¶ Text</AddBtn>
        <AddBtn onClick={() => addBlock('image')}>🖼 Image</AddBtn>
        <AddBtn onClick={() => addBlock('video')}>▶ Video</AddBtn>
        <AddBtn onClick={() => addBlock('callout')}>💡 Callout</AddBtn>
      </div>
      <div style={{ padding: '20px 22px', minHeight: 260 }}>
        {blocks.map((b, i) => (
          <div key={i} style={{ position: 'relative', margin: '6px 0' }}>
            <button onClick={() => delBlock(i)} title="Delete"
              style={{ position: 'absolute', right: -6, top: 2, border: 0, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 13 }}>✕</button>
            {(b.type === 'text' || b.type === 'callout') && (
              <EditableBlock initialHtml={b.html || ''} isCallout={b.type === 'callout'}
                onChange={html => setBlock(i, { html })} />
            )}
            {b.type === 'image' && (b.url
              ? <ImageBlock block={b} onChange={patch => setBlock(i, patch)} />
              : <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 20, textAlign: 'center', background: 'var(--canvas)' }}>
                  <div className="page-sub" style={{ marginBottom: 8 }}>Upload an image from your computer</div>
                  <input type="file" accept="image/*"
                    onChange={e => { if (e.target.files[0]) uploadImage(e.target.files[0], i) }} />
                </div>)}
            {b.type === 'video' && (b.embed
              ? <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
                <iframe src={b.embed} allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 8 }} /></div>
              : <input placeholder="Paste video link (YouTube, Vimeo)" onChange={e => setBlock(i, { embed: toEmbed(e.target.value) })}
                style={{ width: '100%', padding: 9, border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit' }} />)}
          </div>
        ))}
        {blocks.length === 0 && <p className="page-sub">Use the toolbar to add text, images, or video.</p>}
      </div>
    </div>
  )
}
// Editable rich-text block. Sets its HTML ONCE on mount, then lets the browser
// own the DOM while typing — so the cursor never jumps.
function EditableBlock({ initialHtml, isCallout, onChange }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml
  }, [])
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={e => onChange(e.currentTarget.innerHTML)}
      style={{ outline: 'none', fontSize: 15, lineHeight: 1.65, padding: isCallout ? '12px 14px' : '4px 2px', borderRadius: isCallout ? 8 : 0, background: isCallout ? 'var(--accent-bg)' : 'transparent', minHeight: 26 }}
    />
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
    if (b.type === 'text' || b.type === 'callout') {
          return <RichContent key={i} html={b.html}
            style={{ fontSize: 15.5, lineHeight: 1.7, margin: '12px 0', padding: b.type === 'callout' ? '13px 15px' : 0, borderRadius: b.type === 'callout' ? 8 : 0, background: b.type === 'callout' ? 'var(--accent-bg)' : 'transparent' }} />
        }
        if (b.type === 'image' && b.url) {
          const justify = b.align === 'center' ? 'center' : b.align === 'right' ? 'flex-end' : 'flex-start'
          return <div key={i} style={{ display: 'flex', justifyContent: justify, margin: '14px 0' }}>
            <img src={b.url} alt="" style={{ width: widths[b.width || 'full'], maxWidth: '100%', borderRadius: 10 }} />
          </div>
        }
        if (b.type === 'video' && b.embed) {
          return <div key={i} style={{ position: 'relative', paddingBottom: '56.25%', height: 0, margin: '14px 0' }}>
            <iframe src={b.embed} allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 10 }} />
          </div>
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
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" disabled={idx === 0} onClick={() => setIdx(i => Math.max(0, i - 1))}>← Back</button>
            {idx < total - 1
              ? <button className="btn btn-primary" onClick={() => setIdx(i => Math.min(total - 1, i + 1))}>Next →</button>
              : <span className="page-sub" style={{ alignSelf: 'center' }}>End of lessons — quiz comes next for agents</span>}
          </div>
        )}
      </div>
    </div>
  )
}
const TB = ({ children, onClick }) => (
  <button onMouseDown={e => e.preventDefault()} onClick={onClick}
    style={{ border: 0, background: 'transparent', width: 30, height: 30, borderRadius: 6, cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 14 }}>{children}</button>
)
const Divider = () => <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '4px 4px' }} />
const AddBtn = ({ children, onClick }) => (
  <button onClick={onClick} style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', fontSize: 12.5, fontWeight: 600, padding: '6px 9px', borderRadius: 6, cursor: 'pointer' }}>{children}</button>
)
// ============ QUIZ EDITOR ============
function QuizEditor({ courseId }) {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { load() }, [courseId])
  async function load() {
    setLoading(true)
    try {
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
  return (
    <div>
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
