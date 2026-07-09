// ============================================================
// sanitize.js — the security boundary for all rich text.
//
// Everything the editor produces passes through here before it is stored, and
// again before it is rendered. Both directions, deliberately: content already
// in the database predates this file, and a bug on the write path shouldn't
// become a permanent XSS.
//
// The previous version allowed ZERO attributes, which made it trivially safe.
// Links, colors and tables all need attributes, so the rules got real:
//
//   href      -> must be http/https/mailto. `javascript:` is the classic XSS.
//   style     -> only color/background-color, only safe color syntax.
//   colspan   -> digits only, capped.
//
// Anything not explicitly allowed is dropped. Allowlist, never blocklist.
// ============================================================

// Tags kept as-is. Anything else is UNWRAPPED (children survive, tag dies).
const ALLOWED_TAGS = new Set([
  // inline
  'B', 'STRONG', 'I', 'EM', 'S', 'STRIKE', 'DEL', 'U', 'CODE', 'MARK', 'SPAN', 'BR', 'A',
  // block
  'P', 'DIV', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE', 'HR',
  'UL', 'OL', 'LI',
  // tables
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'COLGROUP', 'COL',
])

// Tags whose CONTENTS are also destroyed. Keeping the text of a <script> would
// dump code into the message body.
const DROP_CONTENT_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT',
  'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT',
])

// Which attributes may survive, per tag. Everything else is stripped.
const ALLOWED_ATTRS = {
  A:     ['href', 'target', 'rel'],
  SPAN:  ['style'],
  MARK:  ['style'],
  TD:    ['colspan', 'rowspan', 'colwidth', 'style'],
  TH:    ['colspan', 'rowspan', 'colwidth', 'style'],
  COL:   ['style'],
  TABLE: ['style'],
  P: [], DIV: [], H1: [], H2: [], H3: [],
}

// ---- href ----------------------------------------------------------------
// The danger is any scheme that executes: javascript:, data:, vbscript:.
// Note `\s` in the strip: `java\tscript:` and `java\nscript:` are parsed as
// javascript: by browsers. Control characters likewise.
function safeHref(raw) {
  if (!raw) return null
  const v = String(raw).replace(/[\s\u0000-\u001F\u007F-\u009F]/g, '').toLowerCase()

  // Relative and anchor links are fine and can't carry a scheme.
  if (v.startsWith('/') || v.startsWith('#')) return String(raw).trim()

  // Everything else must declare an allowed scheme up front.
  if (/^(https?:|mailto:)/.test(v)) return String(raw).trim()

  // A bare domain like "example.com" — assume https.
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$|\?|#)/.test(v)) return 'https://' + String(raw).trim()

  return null   // javascript:, data:, vbscript:, file:, anything unknown
}

// ---- style ---------------------------------------------------------------
// Only color and background-color, and only in syntax that cannot smuggle a
// url() or an expression(). Hex, rgb/rgba, hsl/hsla, or a plain colour word.
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]+)$/i
const ALLOWED_STYLE_PROPS = new Set(['color', 'background-color', 'background'])

function safeStyle(raw) {
  if (!raw) return null
  const out = []
  for (const decl of String(raw).split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const val = decl.slice(i + 1).trim()
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue
    // Reject anything containing a function call we didn't allow, or an escape.
    if (/url\s*\(|expression|javascript|@import|\\/i.test(val)) continue
    if (!COLOR_VALUE.test(val)) continue
    out.push(`${prop}: ${val}`)
  }
  return out.length ? out.join('; ') : null
}

// ---- numeric attrs -------------------------------------------------------
// Strict: the WHOLE value must be digits. parseInt("1 onmouseover=x") returns 1,
// which happens to be safe here, but relying on that is relying on luck.
function safeInt(raw, max) {
  const v = String(raw).trim()
  if (!/^\d{1,3}$/.test(v)) return null
  const n = parseInt(v, 10)
  if (n < 1 || n > max) return null
  return String(n)
}

// colwidth is TipTap's own, a comma-separated list of pixel widths.
function safeColwidth(raw) {
  const parts = String(raw).split(',').map(s => s.trim())
  if (!parts.every(p => /^\d{1,4}$/.test(p))) return null
  return parts.join(',')
}

function scrubAttributes(el) {
  const tag = el.tagName.toUpperCase()
  const allowed = ALLOWED_ATTRS[tag] || []

  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase()

    // Nothing starting with `on` ever survives, belt and braces — the allowlist
    // below would already drop it.
    if (!allowed.includes(name)) { el.removeAttribute(attr.name); continue }

    let clean = null
    if (name === 'href')          clean = safeHref(attr.value)
    else if (name === 'style')    clean = safeStyle(attr.value)
    else if (name === 'colspan')  clean = safeInt(attr.value, 100)
    else if (name === 'rowspan')  clean = safeInt(attr.value, 100)
    else if (name === 'colwidth') clean = safeColwidth(attr.value)
    else if (name === 'target')   clean = attr.value === '_blank' ? '_blank' : null
    else if (name === 'rel')      clean = null   // we set this ourselves, below

    if (clean === null) el.removeAttribute(attr.name)
    else el.setAttribute(attr.name, clean)
  }

  // A link that survived and points off-site opens in a new tab, and MUST carry
  // rel=noopener — without it the opened page can rewrite window.opener.location
  // and phish the user. This is why `rel` is force-set rather than passed through.
  if (tag === 'A') {
    const href = el.getAttribute('href')
    if (!href) {
      el.removeAttribute('target'); el.removeAttribute('rel')
    } else if (/^https?:/i.test(href)) {
      // External http(s) only. A new tab for `/docs` or `mailto:` is wrong,
      // and rel=nofollow on a mailto is meaningless.
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer nofollow')
    } else {
      el.removeAttribute('target'); el.removeAttribute('rel')
    }
  }
}

function scrubNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue
    if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue }

    const tag = child.tagName.toUpperCase()

    if (DROP_CONTENT_TAGS.has(tag)) { child.remove(); continue }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: promote the children, delete the tag.
      scrubNode(child)
      while (child.firstChild) node.insertBefore(child.firstChild, child)
      child.remove()
      continue
    }

    scrubAttributes(child)
    scrubNode(child)
  }
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Parse into an INERT document. Inert means the browser builds the node tree
// but never runs scripts, never loads images, never fires handlers — so an
// `<img src=x onerror=alert(1)>` in the input is a dead node we then delete.
// This is precisely why we never use innerHTML on a live element to do this.
export function sanitizeHtml(dirty) {
  const src = String(dirty || '')
  if (!src) return ''
  if (typeof window === 'undefined' || !window.DOMParser) {
    return escapeHtml(src.replace(/<[^>]*>/g, ''))   // SSR: fail closed
  }
  const doc = new DOMParser().parseFromString(`<body>${src}</body>`, 'text/html')
  scrubNode(doc.body)
  return doc.body.innerHTML
}

// Plain text, for previews, search, notification bodies, and keyword matching.
// Never feed HTML to a keyword matcher — "div" would match every message.
export function htmlToText(html) {
  const src = String(html || '')
  if (!src) return ''
  if (typeof window === 'undefined' || !window.DOMParser) return src.replace(/<[^>]*>/g, ' ')
  const doc = new DOMParser().parseFromString(`<body>${src}</body>`, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

// Is there anything here besides empty tags?
export function isEmptyHtml(html) {
  return htmlToText(html).length === 0 && !/<(img|table|hr)\b/i.test(String(html || ''))
}
