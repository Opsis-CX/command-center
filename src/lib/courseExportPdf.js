import { sanitizeHtml } from './sanitize'
import { safeUrl, videoLink, fmtSize } from './courseExport'

// ============================================================
// COURSE PDF (2026-11-13): a real PDF file that downloads with one click (no print window).
// Built in the browser with pdfmake. The libraries are loaded ONLY when someone clicks Download, so the rest of the
// app never pays for them. Same content and the same safety rules as the print version in courseExport.js:
// lesson text goes through the same sanitizer, unsafe links and images are dropped, quiz answers only when asked for.
// ============================================================

const PAGE_W = 612, MARGIN = 50, CONTENT_W = PAGE_W - MARGIN * 2   // US Letter, in points
const WIDTHS = { small: 0.3, medium: 0.55, large: 0.8, full: 1 }
const TEAL = '#015974', INK = '#17252B', SOFT = '#4A5C63', LINK = '#0B6E99'
const TONES = {
  info: { label: 'INFO', bg: '#E8F4FA', fg: '#0B6E99' },
  tip: { label: 'TIP', bg: '#E7F5EC', fg: '#1F8A53' },
  warning: { label: 'IMPORTANT', bg: '#FDECEC', fg: '#C0392B' },
}
const BORDER = { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => '#C9D5DA', vLineColor: () => '#C9D5DA', paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 }

// The PDF's built-in font draws normal text and punctuation but NOT arrows, check marks, stars, circles, triangles or emoji
// (a missing symbol prints as a blank). Common ones are swapped for readable stand-ins, and the rest are removed.
const SYMBOL_SWAPS = [
  [/[\u2192\u27A1\u27A4\u2794\u279C]/g, '->'], [/\u2190/g, '<-'], [/\u2191/g, '^'], [/\u2193/g, 'v'], [/\u21D2/g, '=>'],
  [/[\u2713\u2714\u2611\u2705]/g, '[x]'], [/[\u2717\u2718\u274C\u274E]/g, '[ ]'],
  [/[\u25CF\u25AA\u25E6]/g, '-'], [/\u25CB/g, 'o'], [/[\u2605\u2B50]/g, '*'], [/[\u25B6\u25BA\u25B8]/g, '>'], [/\u26A0/g, '!'],
]
export function stripEmoji(s) {
  let t = String(s ?? '')
  for (const [re, to] of SYMBOL_SWAPS) t = t.replace(re, to)
  return t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
}
export function fileSafeName(title) {
  const s = String(title || 'Course').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)
  return (s || 'Course') + '.pdf'
}

// ---- images ---------------------------------------------------------------------------------------------------
// PDFs only take JPEG and PNG. Fetch each image, keep JPEG/PNG as they are (shrinking very large ones), and convert
// anything else (WebP, GIF…) through a canvas. An image that cannot be read (blocked by the other site, deleted)
// becomes a short note instead of breaking the whole download.
export async function fetchImageAsDataUrl(url, { maxWidth = 1400, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const blob = await res.blob()
    const bmp = await createImageBitmap(blob)
    const keep = (blob.type === 'image/png' || blob.type === 'image/jpeg') && bmp.width <= maxWidth
    if (keep) return await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob) })
    const scale = Math.min(1, maxWidth / bmp.width)
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.88)
  } catch { return null } finally { clearTimeout(timer) }
}

function makeImageLoader(fetchImage) {
  const cache = new Map()
  return (url) => { if (!cache.has(url)) cache.set(url, Promise.resolve(fetchImage(url)).catch(() => null)); return cache.get(url) }
}

// ---- rich text -------------------------------------------------------------------------------------------------
// Turn a lesson's HTML into PDF content: sanitize, bring in images, convert, then tidy what the converter produces so
// nothing runs off the page (images fitted to the page width, table columns shared out evenly).
async function richNodes(html, ctx) {
  const clean = sanitizeHtml(html || '')
  const doc = new ctx.window.DOMParser().parseFromString('<body>' + clean + '</body>', 'text/html')
  for (const img of [...doc.body.querySelectorAll('img')]) {
    const src = safeUrl(img.getAttribute('src'))
    const data = src ? await ctx.loadImage(src) : null
    if (data) { img.setAttribute('src', data); img.removeAttribute('width'); img.removeAttribute('height'); img.removeAttribute('style') }
    else { const note = doc.createElement('p'); note.textContent = '[An image in this lesson could not be included. View it in Command Center.]'; img.replaceWith(note) }
  }
  const out = ctx.htmlToPdfmake(stripEmoji(doc.body.innerHTML), {
    window: ctx.window, tableAutoSize: true,
    defaultStyles: { a: { color: LINK, decoration: 'underline' }, b: { bold: true }, strong: { bold: true }, p: { margin: [0, 0, 0, 5] }, li: { margin: [0, 1, 0, 1] }, h1: { fontSize: 13, bold: true, margin: [0, 10, 0, 4] }, h2: { fontSize: 13, bold: true, margin: [0, 10, 0, 4] }, h3: { fontSize: 11.5, bold: true, margin: [0, 8, 0, 3] }, blockquote: { italics: true, color: SOFT, margin: [14, 4, 0, 6] }, code: { background: '#F1F5F7' }, pre: { background: '#F1F5F7', margin: [0, 4, 0, 6], preserveLeadingSpaces: true }, th: { bold: true, fillColor: '#EEF3F5' } },
  })
  const nodes = Array.isArray(out) ? out : [out]
  tidy(nodes)
  return nodes
}

function tidy(nodes) {
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    if (n.image) { const w = Number.isFinite(+n.width) && +n.width > 0 ? Math.min(+n.width, CONTENT_W) : CONTENT_W; n.fit = [w, 560]; delete n.width; delete n.height; n.margin = n.margin || [0, 4, 0, 6] }
    if (n.table) {
      const body = n.table.body || []
      const cols = Math.max(1, ...body.map(r => r.reduce((a, c) => a + ((c && c.colSpan) || 1), 0)))
      if (!n.table.widths) n.table.widths = Array(cols).fill('*')
      n.layout = n.layout || BORDER
      n.margin = n.margin || [0, 4, 0, 8]
      for (const row of body) for (const cell of row) if (cell) { if (Array.isArray(cell)) tidy(cell); else tidy([cell]) }
    }
    for (const k of ['stack', 'ul', 'ol', 'text']) if (Array.isArray(n[k])) tidy(n[k])
    if (Array.isArray(n.table && n.table.body)) { /* handled above */ }
  }
}

// ---- blocks ----------------------------------------------------------------------------------------------------
async function blockNodes(b, ctx) {
  if (!b) return []
  if (b.type === 'heading') return b.text ? [{ text: stripEmoji(b.text), fontSize: (b.level || 2) === 2 ? 13 : 11.5, bold: true, margin: [0, 10, 0, 3], color: INK }] : []
  if (b.type === 'text') return richNodes(b.html, ctx)
  if (b.type === 'callout') {
    const t = TONES[b.tone] || TONES.info
    const inner = await richNodes(b.html, ctx)
    return [{ table: { widths: ['*'], dontBreakRows: true, body: [[{ stack: [{ text: t.label, bold: true, fontSize: 7.5, color: t.fg, margin: [0, 0, 0, 3] }, ...inner], fillColor: t.bg, margin: [8, 5, 8, 3] }]] }, layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => t.fg, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 }, margin: [0, 6, 0, 8] }]
  }
  if (b.type === 'image') {
    const src = safeUrl(b.url); if (!src) return []
    const data = await ctx.loadImage(src)
    if (!data) return [{ text: '[An image in this lesson could not be included. View it in Command Center.]', italics: true, color: SOFT, margin: [0, 4, 0, 6] }]
    return [{ image: data, fit: [CONTENT_W * (WIDTHS[b.width || 'full'] || 1), 560], alignment: b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left', margin: [0, 6, 0, 8] }]
  }
  if (b.type === 'video') {
    const link = videoLink(b.embed); if (!link) return []
    return [card([{ text: 'Video (watch online): ', bold: true }, { text: link, link, color: LINK, decoration: 'underline' }])]
  }
  if (b.type === 'file') {
    const link = safeUrl(b.url); if (!link) return []
    return [card([{ text: 'Attached file: ', bold: true }, { text: stripEmoji(b.name || 'File') + (b.size ? ' (' + fmtSize(b.size) + ')' : '') + '\n' }, { text: link, link, color: LINK, decoration: 'underline' }])]
  }
  if (b.type === 'kb' && b.article_id) {
    const link = `${ctx.origin || ''}/knowledge?view=article&id=${encodeURIComponent(b.article_id)}`
    return [card([{ text: 'Knowledge Base article: ', bold: true }, { text: stripEmoji(b.title || 'Article') + '\n' }, ...(b.note ? [{ text: stripEmoji(b.note) + '\n', color: SOFT }] : []), { text: link, link, color: LINK, decoration: 'underline' }])]
  }
  return []
}
function card(text) { return { table: { widths: ['*'], body: [[{ text, fontSize: 9.5, margin: [6, 4, 6, 4] }]] }, layout: BORDER, margin: [0, 6, 0, 8], dontBreakRows: true } }

// ---- the whole document ------------------------------------------------------------------------------------------
export async function buildCoursePdfDoc({ course, certName = '', lessons = [], questions = [], withQuiz = false, origin = '', generatedBy = '', generatedAt = new Date(), htmlToPdfmake, window: win, fetchImage = fetchImageAsDataUrl }) {
  const ctx = { htmlToPdfmake, window: win, origin, loadImage: makeImageLoader(fetchImage) }
  const when = generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const ls = [...lessons].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const qs = [...questions].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const typing = course.course_type === 'typing_test'
  const meta = []
  meta.push(certName ? 'Grants: ' + certName : 'Standalone course (grants no certification)')
  if (typing) meta.push(`Typing test: ${course.typing_min_wpm ?? 35} WPM / ${course.typing_min_accuracy ?? 95}% accuracy in ${course.typing_duration_seconds ?? 60} seconds`)
  else if (course.quiz_required === false) meta.push('No quiz (informational)')
  else meta.push(`Pass mark ${course.pass_threshold ?? 80}%`)
  if (course.course_type === 'timed_quiz' && course.time_limit_seconds) meta.push(`Timed: ${Math.round(course.time_limit_seconds / 60)} minutes`)

  const content = [
    { text: 'CERTIFICATION COURSE', fontSize: 8.5, bold: true, color: '#6B7C83', characterSpacing: 1 },
    { text: stripEmoji(course.title || 'Course'), fontSize: 24, bold: true, color: TEAL, margin: [0, 2, 0, 6] },
    ...(course.description ? [{ text: stripEmoji(course.description), fontSize: 12, color: SOFT, margin: [0, 0, 0, 8] }] : []),
    { text: meta.join('   |   '), fontSize: 9.5, color: SOFT, margin: [0, 0, 0, 3] },
    { text: `${ls.length} lesson${ls.length === 1 ? '' : 's'}${withQuiz ? `   |   ${qs.length} quiz question${qs.length === 1 ? '' : 's'} (answer key included)` : ''}`, fontSize: 9.5, color: SOFT, margin: [0, 0, 0, 8] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 2, lineColor: '#15B8CF' }], margin: [0, 0, 0, 14] },
  ]
  if (ls.length > 1) content.push({ text: 'Contents', fontSize: 13, bold: true, color: TEAL, margin: [0, 0, 0, 5] }, { ol: ls.map(l => ({ text: stripEmoji(l.title || 'Untitled lesson'), margin: [0, 1, 0, 1] })), fontSize: 10.5, margin: [0, 0, 0, 14] })

  if (ls.length === 0) content.push({ text: 'This course has no lessons yet.', italics: true, color: SOFT })
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]
    content.push({ text: `LESSON ${i + 1} OF ${ls.length}`, fontSize: 8, bold: true, color: '#6B7C83', characterSpacing: 0.8, margin: [0, i === 0 ? 0 : 12, 0, 0], headlineLevel: 1 })
    content.push({ text: stripEmoji(l.title || 'Untitled lesson'), fontSize: 16, bold: true, color: INK, margin: [0, 2, 0, 3], headlineLevel: 1 })
    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.7, lineColor: '#D5DEE2' }], margin: [0, 0, 0, 6] })
    for (const b of (Array.isArray(l.content_blocks) ? l.content_blocks : [])) content.push(...await blockNodes(b, ctx))
  }

  if (withQuiz) {
    content.push({ text: 'Quiz and answer key', fontSize: 16, bold: true, color: INK, pageBreak: 'before', margin: [0, 0, 0, 4] })
    content.push({ table: { widths: ['*'], body: [[{ text: 'Answer key. Do not share with learners. The correct answers are marked.', bold: true, fontSize: 9.5, margin: [6, 4, 6, 4], fillColor: '#FFF7E6' }]] },
