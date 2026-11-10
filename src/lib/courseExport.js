import { sanitizeHtml } from './sanitize'

// ============================================================
// COURSE EXPORT (2026-11-10): download a certification course as a PDF.
// For admins and course builders only (the database enforces it: course_log_export() refuses everyone else, and quiz
// answers are only readable by course authors). Every download is recorded in course_export_log.
//
// How it works: build a clean, print-ready document, open it in a hidden frame and open the browser's print window,
// where "Save as PDF" makes the file. The browser does the page layout, so long lessons, images and tables paginate properly.
// Lessons are always included. The quiz (with the correct answers marked) is only included when asked for.
// ============================================================

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const WIDTHS = { small: '30%', medium: '55%', large: '80%', full: '100%' }
// print-friendly fixed colours (a white page, not the app theme)
const TONES = {
  info: { icon: '💡', label: 'Info', bg: '#E8F4FA', fg: '#0B6E99' },
  tip: { icon: '✅', label: 'Tip', bg: '#E7F5EC', fg: '#1F8A53' },
  warning: { icon: '⚠️', label: 'Important', bg: '#FDECEC', fg: '#C0392B' },
}

export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// only ordinary web links go into the document
export function safeUrl(u) {
  const s = String(u || '').trim()
  return /^https?:\/\//i.test(s) ? s : ''
}

// a video block stores an embed address; in a document a person needs a normal link they can open
export function videoLink(embed) {
  const u = safeUrl(embed)
  if (!u) return ''
  let m = u.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/i); if (m) return `https://www.youtube.com/watch?v=${m[1]}`
  m = u.match(/player\.vimeo\.com\/video\/(\d+)/i); if (m) return `https://vimeo.com/${m[1]}`
  m = u.match(/loom\.com\/embed\/([\w-]+)/i); if (m) return `https://www.loom.com/share/${m[1]}`
  return u
}

function blockHtml(b, origin) {
  if (!b) return ''
  if (b.type === 'heading') {
    if (!b.text) return ''
    return (b.level || 2) === 2 ? `<h3 class="bh">${esc(b.text)}</h3>` : `<h4 class="bh">${esc(b.text)}</h4>`
  }
  if (b.type === 'text') return `<div class="rich">${sanitizeHtml(b.html || '')}</div>`
  if (b.type === 'callout') {
    const t = TONES[b.tone] || TONES.info
    return `<div class="callout" style="border-left-color:${t.fg};background:${t.bg}"><div class="callout-label" style="color:${t.fg}">${t.icon} ${esc(t.label)}</div><div class="rich">${sanitizeHtml(b.html || '')}</div></div>`
  }
  if (b.type === 'image') {
    const src = safeUrl(b.url)
    if (!src) return ''
    const justify = b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left'
    return `<div class="img" style="text-align:${justify}"><img src="${esc(src)}" alt="" style="width:${WIDTHS[b.width || 'full'] || '100%'}"></div>`
  }
  if (b.type === 'video') {
    const link = videoLink(b.embed)
    if (!link) return ''
    return `<div class="card"><b>▶ Video</b> (watch online): <a href="${esc(link)}">${esc(link)}</a></div>`
  }
  if (b.type === 'file') {
    const link = safeUrl(b.url)
    if (!link) return ''
    return `<div class="card"><b>📎 Attached file:</b> ${esc(b.name || 'File')}${b.size ? ` (${esc(fmtSize(b.size))})` : ''}<br><a href="${esc(link)}">${esc(link)}</a></div>`
  }
  if (b.type === 'kb' && b.article_id) {
    const link = `${origin || ''}/knowledge?view=article&id=${encodeURIComponent(b.article_id)}`
    return `<div class="card"><b>📚 Knowledge Base article:</b> ${esc(b.title || 'Article')}${b.note ? `<div class="note">${esc(b.note)}</div>` : ''}<a href="${esc(link)}">${esc(link)}</a></div>`
  }
  return ''
}

const CSS = `
@page { size: Letter; margin: 0.7in 0.7in 0.85in; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.55; color: #17252B; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 25pt; line-height: 1.2; margin: 0 0 6pt; color: #015974; }
.sub { font-size: 12pt; color: #4A5C63; margin: 0 0 10pt; }
.meta { font-size: 10pt; color: #4A5C63; margin: 0 0 4pt; }
.cover { padding-bottom: 14pt; margin-bottom: 14pt; border-bottom: 2px solid #15B8CF; }
.toc { margin: 0 0 18pt; padding: 0; list-style: none; columns: 1; }
.toc li { padding: 2pt 0; font-size: 10.5pt; }
.toc-title { font-size: 13pt; font-weight: 700; margin: 0 0 6pt; color: #015974; }
.lesson { margin: 0 0 22pt; }
.kicker { font-size: 9pt; letter-spacing: .06em; text-transform: uppercase; color: #6B7C83; font-weight: 600; }
h2 { font-size: 16pt; line-height: 1.3; margin: 2pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #D5DEE2; break-after: avoid; page-break-after: avoid; color: #0E1B20; }
.bh { margin: 14pt 0 4pt; break-after: avoid; page-break-after: avoid; }
h3.bh { font-size: 13pt; } h4.bh { font-size: 11.5pt; }
.rich { margin: 8pt 0; }
.rich p { margin: 0 0 7pt; } .rich ul, .rich ol { margin: 0 0 8pt; padding-left: 20pt; } .rich li { margin: 2pt 0; }
.rich h1, .rich h2, .rich h3 { font-size: 13pt; margin: 12pt 0 4pt; border: 0; padding: 0; }
.rich blockquote { margin: 8pt 0; padding: 4pt 12pt; border-left: 3px solid #C9D5DA; color: #3B4B52; }
.rich table { border-collapse: collapse; margin: 8pt 0; width: 100%; }
.rich td, .rich th { border: 1px solid #C9D5DA; padding: 4pt 7pt; vertical-align: top; }
.rich pre, .rich code { font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; background: #F1F5F7; border-radius: 3px; } .rich pre { padding: 7pt; white-space: pre-wrap; }
.rich img, .img img { max-width: 100%; height: auto; border-radius: 6px; }
.img { margin: 10pt 0; break-inside: avoid; page-break-inside: avoid; }
a { color: #0B6E99; word-break: break-all; }
.callout { margin: 10pt 0; padding: 8pt 12pt; border-left: 4px solid; border-radius: 4px; break-inside: avoid; page-break-inside: avoid; }
.callout-label { font-size: 9pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.callout .rich { margin: 3pt 0 0; }
.card { margin: 10pt 0; padding: 8pt 12pt; border: 1px solid #D5DEE2; border-radius: 6px; font-size: 10pt; break-inside: avoid; page-break-inside: avoid; }
.card .note { color: #4A5C63; margin: 2pt 0; }
.quiz { break-before: page; page-break-before: always; }
.q { margin: 0 0 12pt; break-inside: avoid; page-break-inside: avoid; }
.q-text { font-weight: 600; } .q-hint { font-size: 9.5pt; color: #6B7C83; font-weight: 400; }
.opts { list-style: none; margin: 4pt 0 0; padding: 0; } .opts li { padding: 2pt 0 2pt 18pt; position: relative; }
.opts li::before { content: '○'; position: absolute; left: 2pt; color: #6B7C83; }
.opts li.correct { font-weight: 700; color: #1F8A53; } .opts li.correct::before { content: '✓'; color: #1F8A53; }
.keynote { margin: 0 0 12pt; padding: 8pt 12pt; background: #FFF7E6; border: 1px solid #F0D9A8; border-radius: 6px; font-size: 10pt; }
.foot { position: fixed; left: 0; right: 0; bottom: 0; font-size: 8pt; color: #7A8A91; border-top: 1px solid #D5DEE2; padding-top: 4pt; background: #fff; }
@media screen { body { max-width: 780px; margin: 24px auto; padding: 0 20px 60px; } .foot { position: static; margin-top: 30px; } }
`

// The whole printable document, as one HTML string.
export function buildCourseHtml({ course, certName = '', lessons = [], questions = [], withQuiz = false, origin = '', generatedBy = '', generatedAt = new Date() }) {
  const when = generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const ls = [...lessons].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const qs = [...questions].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const typing = course.course_type === 'typing_test'
  const metaBits = []
  if (certName) metaBits.push(`Grants: <b>${esc(certName)}</b>`)
  else metaBits.push('Standalone course (grants no certification)')
  if (typing) metaBits.push(`Typing test: ${esc(course.typing_min_wpm ?? 35)} WPM / ${esc(course.typing_min_accuracy ?? 95)}% accuracy in ${esc(course.typing_duration_seconds ?? 60)} seconds`)
  else if (course.quiz_required === false) metaBits.push('No quiz (informational)')
  else metaBits.push(`Pass mark ${esc(course.pass_threshold ?? 80)}%`)
  if (course.course_type === 'timed_quiz' && course.time_limit_seconds) metaBits.push(`Timed: ${Math.round(course.time_limit_seconds / 60)} minutes`)
  const foot = `Internal training material, Opsis CX. Downloaded${generatedBy ? ' by ' + esc(generatedBy) : ''} on ${esc(when)}. Please don't share outside the company.`

  const lessonHtml = ls.length === 0
    ? '<p class="sub">This course has no lessons yet.</p>'
    : ls.map((l, i) => `<section class="lesson"><div class="kicker">Lesson ${i + 1} of ${ls.length}</div><h2>${esc(l.title || 'Untitled lesson')}</h2>${(Array.isArray(l.content_blocks) ? l.content_blocks : []).map(b => blockHtml(b, origin)).join('')}</section>`).join('')

  let quizHtml = ''
  if (withQuiz) {
    quizHtml = `<section class="quiz"><h2>Quiz and answer key</h2><div class="keynote"><b>Answer key. Do not share with learners.</b> Correct answers are marked with a check.</div>` + (qs.length === 0
      ? '<p class="sub">This course has no quiz questions.</p>'
      : qs.map((q, i) => {
          const opts = [...(q.options || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          const hint = q.kind === 'single' || !q.kind ? 'choose one' : 'select all that apply'
          return `<div class="q"><div class="q-text">${i + 1}. ${esc(q.prompt)} <span class="q-hint">(${esc(hint)}${q.points ? ', ' + esc(q.points) + ' pt' + (q.points === 1 ? '' : 's') : ''})</span></div><ul class="opts">${opts.map(o => `<li class="${o.is_correct ? 'correct' : ''}">${esc(o.label)}</li>`).join('')}</ul></div>`
        }).join('')) + '</section>'
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(course.title)}${withQuiz ? ' (with quiz answers)' : ''}</title><style>${CSS}</style></head><body>
<div class="cover"><div class="kicker">Certification course</div><h1>${esc(course.title)}</h1>${course.description ? `<p class="sub">${esc(course.description)}</p>` : ''}<p class="meta">${metaBits.join(' &nbsp;·&nbsp; ')}</p><p class="meta">${ls.length} lesson${ls.length === 1 ? '' : 's'}${withQuiz ? ` &nbsp;·&nbsp; ${qs.length} quiz question${qs.length === 1 ? '' : 's'} (answer key included)` : ''}</p></div>
${ls.length > 1 ? `<div class="toc-title">Contents</div><ol class="toc">${ls.map((l, i) => `<li>${i + 1}. ${esc(l.title || 'Untitled lesson')}</li>`).join('')}</ol>` : ''}
${lessonHtml}${quizHtml}
<div class="foot">${foot}</div></body></html>`
}

// Read what the document needs. The quiz and its answers are only fetched when asked for (and the database only
// returns the answers to course authors).
export async function loadCourseForExport(supabase, courseId, withQuiz) {
  const lr = await supabase.from('lessons').select('id, title, sort_order, content_blocks').eq('course_id', courseId).order('sort_order')
  if (lr.error) throw new Error('Could not read the lessons: ' + lr.error.message)
  let questions = []
  if (withQuiz) {
    const qr = await supabase.from('quiz_questions').select('id, prompt, kind, sort_order, points').eq('course_id', courseId).order('sort_order')
    if (qr.error) throw new Error('Could not read the quiz: ' + qr.error.message)
    questions = qr.data || []
    if (questions.length) {
      const or = await supabase.from('quiz_options').select('id, question_id, label, is_correct, sort_order').in('question_id', questions.map(q => q.id)).order('sort_order')
      if (or.error) throw new Error('Could not read the quiz answers: ' + or.error.message)
      questions = questions.map(q => ({ ...q, options: (or.data || []).filter(o => o.question_id === q.id) }))
    }
  }
  return { lessons: lr.data || [], questions }
}

// Open the browser's print window for a finished document (choose "Save as PDF" there).
// A hidden frame is used so nothing pops up and the app page itself is never printed.
export function printHtml(html, title) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    const prevTitle = document.title
    let finished = false
    const cleanup = () => { if (finished) return; finished = true; document.title = prevTitle; setTimeout(() => iframe.remove(), 800); resolve() }
    iframe.onload = async () => {
      try {
        const w = iframe.contentWindow, d = iframe.contentDocument
        // give the images time to load first (but never wait forever)
        const waits = [...d.images].filter(im => !im.complete).map(im => new Promise(r => { im.onload = im.onerror = r }))
        await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 12000))])
        document.title = title   // suggests the file name in the Save dialog
        w.focus()
        w.addEventListener('afterprint', cleanup)
        w.print()
        setTimeout(cleanup, 180000)
      } catch (e) { cleanup(); reject(e) }
    }
    document.body.appendChild(iframe)
    iframe.srcdoc = html
  })
}

// The whole download: record it, read the course, build the document, open the print window.
export async function exportCoursePdf({ supabase, course, certName = '', withQuiz = false, origin = (typeof window !== 'undefined' ? window.location.origin : ''), generatedBy = '', print = printHtml, now = new Date() }) {
  // log first: it also refuses anyone who is not a course author, so nothing is produced for them
  const { error } = await supabase.rpc('course_log_export', { p_course: course.id, p_with_quiz: !!withQuiz })
  if (error) throw new Error(error.message)
  const { lessons, questions } = await loadCourseForExport(supabase, course.id, withQuiz)
  const html = buildCourseHtml({ course, certName, lessons, questions, withQuiz, origin, generatedBy, generatedAt: now })
  await print(html, `${course.title}${withQuiz ? ' (with quiz answers)' : ''}`)
  return { lessons: lessons.length, questions: questions.length }
}
