import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
// TableKit bundles Table + TableRow + TableCell + TableHeader.
// These are NAMED exports in TipTap 3 — `import Table from '@tiptap/extension-table'`
// silently yields undefined, and the editor throws at construction.
import { TableKit } from '@tiptap/extension-table'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import Image from '@tiptap/extension-image'

import { sanitizeHtml, htmlToText, isEmptyHtml } from './sanitize'
import { mentionSuggestion } from './mentionSuggestion'

// ============================================================
// RichEditor / RichContent — one editor, used by Chat and Certification.
//
// Built on TipTap (ProseMirror). The old composer used document.execCommand,
// which is deprecated, differs across browsers, and produces junk HTML. More
// to the point: there is no execCommand for tables. Cell navigation, row and
// column insertion, merges, and backspace-at-cell-edge are months of work on
// raw contentEditable. ProseMirror has already done it.
//
// STORAGE FORMAT: HTML. TipTap can emit JSON, which is cleaner, but your
// existing messages are HTML and you'd have to handle both formats forever.
//
// SECURITY: everything goes through sanitize.js on the way in AND on the way
// out. See that file — the attribute rules are where the real risk lives.
// ============================================================

const TOOLBARS = {
  // Chat: compact. No headings — they look absurd in a message bubble.
  chat: ['bold', 'italic', 'strike', 'code', '|', 'bullet', 'ordered', '|', 'link', 'color', 'highlight', '|', 'spell'],
  // Certification / documents: the lot.
  full: ['bold', 'italic', 'strike', 'code', '|', 'h1', 'h2', 'h3', '|',
         'bullet', 'ordered', 'quote', '|', 'link', 'color', 'highlight', '|', 'table', '|', 'spell'],
  // My Notes (2026-10-27): the full set plus undo/redo, paragraph style, underline, image,
  // code block and divider. Other editors keep their toolbars unchanged.
  notes: ['undo', 'redo', '|', 'para', '|', 'bold', 'italic', 'underline', 'strike', '|', 'h1', 'h2', 'h3', '|',
          'bullet', 'ordered', 'quote', '|', 'image', 'table', 'codeblock', 'hr', '|', 'link', 'color', 'highlight', '|', 'spell'],
}

const SWATCHES = ['#0d1518', '#c0392b', '#d97706', '#1f8a53', '#0077b6', '#7c3aed', '#db2777']
const HIGHLIGHTS = ['#fff3a3', '#c6f6d5', '#bee3f8', '#fed7d7', '#e9d8fd']

// ============================================================
// SPELL CHECK
//
// Our own checker, so it works even when the browser's right-click menu is
// blocked. The dictionary + checker load from the jsDelivr CDN the FIRST time
// someone right-clicks or presses ✓ — nothing extra in the app bundle and no
// package.json change. Cached for the rest of the session.
//
//  • Right-click a misspelled word in any editor → suggestions menu.
//    Right-click anything else → the normal browser menu (copy/paste).
//  • ✓ on the toolbar → lists every misspelling with one-click fixes.
//  • "Add to dictionary" is saved per person in this browser.
// ============================================================

const NSPELL_URL = 'https://cdn.jsdelivr.net/npm/nspell@2.1.5/+esm'
const DICT_BASE = 'https://cdn.jsdelivr.net/npm/dictionary-en@4.0.0/'

// Words the dictionary doesn't know but we use every day. Lowercase.
const TEAM_WORDS = [
  'opsis', 'opsiscx', 'garageco', 'turritopsis', 'turri', 'five9', 'callqa', 'opsisqa',
  'pdq', 'csr', 'csrs', 'asc', 'ascs', 'qa', 'lsa', 'lsas', 'kpi', 'kpis', 'wfm',
  'ok', 'okay', 'cheney', 'cunningham', 'supabase', 'hubspot', 'rippling', 'broccoli',
  'dispo', 'dispos', 'upsell', 'upsells', 'callback', 'callbacks', 'voicemails',
  'onboarding', 'offboarding', 'scorecard', 'scorecards', 'recap', 'recaps',
]

// Common slips a dictionary alone ranks badly.
const QUICK_FIXES = {
  dont: "don't", cant: "can't", wont: "won't", didnt: "didn't", doesnt: "doesn't",
  isnt: "isn't", wasnt: "wasn't", arent: "aren't", werent: "weren't", couldnt: "couldn't",
  shouldnt: "shouldn't", wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't",
  im: "I'm", ive: "I've", youre: "you're", theyre: "they're", thats: "that's",
  whats: "what's", lets: "let's", alot: 'a lot', teh: 'the', thier: 'their',
}

const LS_KEY = 'cc:spellWords'
function loadPersonalWords() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')) } catch { return new Set() }
}
const personalWords = loadPersonalWords()
const ignoredWords = new Set()   // "Ignore" — this session only
function addPersonalWord(w) {
  personalWords.add(w.toLowerCase())
  try { localStorage.setItem(LS_KEY, JSON.stringify([...personalWords])) } catch { /* ignore */ }
}

let _speller = null
let _spellerPromise = null
function loadSpeller() {
  if (_speller) return Promise.resolve(_speller)
  if (!_spellerPromise) {
    _spellerPromise = (async () => {
      const get = (f) => fetch(DICT_BASE + f).then(r => { if (!r.ok) throw new Error('dictionary ' + r.status); return r.text() })
      const [mod, aff, dic] = await Promise.all([import(/* @vite-ignore */ NSPELL_URL), get('index.aff'), get('index.dic')])
      const nspell = mod.default || mod
      const sp = nspell(aff, dic)
      // Stems, bucketed by length, for a fallback suggester: nspell gives up on
      // words two letters off (questionairre → nothing).
      const byLen = new Map()
      dic.split('\n').slice(1).forEach(line => {
        const w = line.split('/')[0].trim()
        if (!w || /[^a-z']/i.test(w)) return
        const lw = w.toLowerCase()
        if (!byLen.has(lw.length)) byLen.set(lw.length, [])
        byLen.get(lw.length).push(w)
      })
      _speller = { sp, byLen, cache: new Map() }
      return _speller
    })().catch(e => { _spellerPromise = null; throw e })
  }
  return _spellerPromise
}

// Damerau-Levenshtein (adjacent swaps count as 1), capped for speed.
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const d = []
  for (let i = 0; i <= a.length; i++) { d[i] = [i] }
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > cap) return cap + 1
  }
  return d[a.length][b.length]
}

function matchCase(src, s) {
  if (src === src.toUpperCase() && src.length > 1) return s.toUpperCase()
  if (src[0] === src[0].toUpperCase()) return s[0].toUpperCase() + s.slice(1)
  return s
}

const norm = (w) => w.replace(/[’‘]/g, "'").replace(/^'+|'+$/g, '')

// Should this word be skipped entirely?
function skipWord(w, extraWords) {
  if (w.length < 2) return true
  if (/\d/.test(w)) return true
  if (w.length > 1 && w === w.toUpperCase()) return true      // acronyms: PDQ, ASAP
  if (/[a-z][A-Z]/.test(w)) return true                         // CamelCase: GarageCo, VanEpps
  const lw = w.toLowerCase()
  return personalWords.has(lw) || ignoredWords.has(lw) || extraWords.has(lw)
}

function isMisspelled(speller, raw, extraWords) {
  const w = norm(raw)
  if (!w || skipWord(w, extraWords)) return false
  const key = w
  if (speller.cache.has(key)) return speller.cache.get(key)
  let bad = !speller.sp.correct(w)
  // "agents'" / "Becky's" — accept when the base word is fine.
  if (bad && /'s?$/i.test(w)) bad = !speller.sp.correct(w.replace(/'s?$/i, ''))
  speller.cache.set(key, bad)
  return bad
}

function suggestFor(speller, raw) {
  const w = norm(raw)
  const lw = w.toLowerCase()
  const out = []
  if (QUICK_FIXES[lw]) out.push(QUICK_FIXES[lw] === "I'm" || QUICK_FIXES[lw] === "I've" ? QUICK_FIXES[lw] : matchCase(w, QUICK_FIXES[lw]))
  const ns = speller.sp.suggest(w).slice(0, 8)
  const fallback = []
  for (let len = lw.length - 2; len <= lw.length + 2; len++) {
    for (const cand of speller.byLen.get(len) || []) {
      const lc = cand.toLowerCase()
      if (lc[0] !== lw[0]) continue
      const dist = editDistance(lw, lc, 2)
      if (dist <= 2) fallback.push({ s: cand, dist })
    }
  }
  const scored = [
    ...ns.map((s, i) => ({ s, dist: editDistance(lw, s.toLowerCase(), 3), rank: i })),
    ...fallback.map(f => ({ ...f, rank: 50 })),
  ].sort((a, b) => a.dist - b.dist || a.rank - b.rank)
  for (const { s } of scored) {
    const fixed = s === s.toLowerCase() ? matchCase(w, s) : s
    if (!out.some(o => o.toLowerCase() === fixed.toLowerCase())) out.push(fixed)
    if (out.length >= 5) break
  }
  return out
}

const WORD_RE = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g

// Part of a link, email, @mention or file name? (www.site.com, a@b.com, notes.pdf)
function inTechToken(text, start, end) {
  let a = start, b = end
  while (a > 0 && !/\s/.test(text[a - 1])) a--
  while (b < text.length && !/\s/.test(text[b])) b++
  const tok = text.slice(a, b).replace(/[.,;:!?)"'’]+$/, '')
  return /[@/\\:_]|\w\.\w/.test(tok)
}

// Every misspelled word in the document, with its exact position.
function findMisspellings(speller, doc, extraWords) {
  const found = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    if (node.marks.some(m => m.type.name === 'link' || m.type.name === 'code')) return
    const text = node.text
    let m
    WORD_RE.lastIndex = 0
    while ((m = WORD_RE.exec(text))) {
      if (inTechToken(text, m.index, m.index + m[0].length)) continue
      if (isMisspelled(speller, m[0], extraWords)) found.push({ word: m[0], from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return found
}

// The word under a document position (for right-click).
function wordAt(doc, pos) {
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  let hit = null
  parent.forEach((child, offset) => {
    if (hit || !child.isText) return
    const start = $pos.start() + offset
    if (pos < start || pos > start + child.text.length) return
    if (child.marks.some(m => m.type.name === 'link' || m.type.name === 'code')) return
    let m
    WORD_RE.lastIndex = 0
    while ((m = WORD_RE.exec(child.text))) {
      const from = start + m.index, to = from + m[0].length
      if (pos >= from && pos <= to) {
        if (inTechToken(child.text, m.index, m.index + m[0].length)) return
        hit = { word: m[0], from, to }
        return
      }
    }
  })
  return hit
}

// Team members' names never count as typos.
function namesSet(profiles) {
  const s = new Set(TEAM_WORDS)
  ;(profiles || []).forEach(p => String(p?.full_name || '').split(/[\s-]+/).forEach(part => {
    const w = part.replace(/[^A-Za-z']/g, '').toLowerCase()
    if (w) s.add(w)
  }))
  return s
}

// ---- Spell check popups ----------------------------------------------------
// Fixed-position so they work inside modals, thread panels and the composer at
// the bottom of the screen. Opens upward when there isn't room below.
function SpellPopup({ at, width = 240, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const left = Math.max(8, Math.min(at.x, window.innerWidth - width - 8))
  const roomBelow = window.innerHeight - at.bottom
  const pos = roomBelow < 280 ? { bottom: window.innerHeight - at.top + 4 } : { top: at.bottom + 4 }
  return (
    <>
      <div onMouseDown={e => { e.preventDefault(); onClose() }}
        onContextMenu={e => { e.preventDefault(); onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex: 5000 }} />
      <div onMouseDown={e => e.preventDefault()}
        style={{ position: 'fixed', left, ...pos, width, maxHeight: 340, overflowY: 'auto', zIndex: 5001,
          background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,.18)', padding: '4px 0', fontSize: 13 }}>
        {children}
      </div>
    </>
  )
}

const spellItem = { display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent',
  padding: '7px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }
const hoverOn = e => { e.currentTarget.style.background = 'var(--canvas)' }
const hoverOff = e => { e.currentTarget.style.background = 'transparent' }

function SpellMenu({ ui, onPick, onAdd, onIgnore, onClose }) {
  return (
    <SpellPopup at={ui.at} width={220} onClose={onClose}>
      {ui.loading && <div style={{ padding: '8px 12px', color: 'var(--ink-soft)' }}>Checking spelling…</div>}
      {ui.error && <div style={{ padding: '8px 12px', color: 'var(--failed, #DC2626)' }}>{ui.error}</div>}
      {ui.correct && <div style={{ padding: '8px 12px', color: 'var(--ink-soft)' }}>✓ “{ui.word}” is spelled correctly</div>}
      {ui.suggestions && (<>
        {ui.suggestions.length === 0 && <div style={{ padding: '8px 12px', color: 'var(--ink-soft)' }}>No suggestions for “{ui.word}”</div>}
        {ui.suggestions.map((s, i) => (
          <button key={s} type="button" style={{ ...spellItem, fontWeight: i === 0 ? 700 : 500 }}
            onMouseEnter={hoverOn} onMouseLeave={hoverOff}
            onMouseDown={e => { e.preventDefault(); onPick(s) }}>{s}</button>
        ))}
        <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
        <button type="button" style={{ ...spellItem, color: 'var(--ink-soft)' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
          onMouseDown={e => { e.preventDefault(); onAdd(ui.word) }}>＋ Add “{ui.word}” to dictionary</button>
        <button type="button" style={{ ...spellItem, color: 'var(--ink-soft)' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
          onMouseDown={e => { e.preventDefault(); onIgnore(ui.word) }}>Ignore</button>
      </>)}
    </SpellPopup>
  )
}

function SpellPanel({ ui, onFix, onAdd, onIgnore, onClose }) {
  return (
    <SpellPopup at={ui.at} width={320} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 8px', borderBottom: '1px solid var(--line)' }}>
        <b style={{ fontSize: 13, flex: 1 }}>Spelling</b>
        <button type="button" onMouseDown={e => { e.preventDefault(); onClose() }}
          style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1 }}>✕</button>
      </div>
      {ui.loading && <div style={{ padding: '10px 12px', color: 'var(--ink-soft)' }}>Checking spelling…</div>}
      {ui.error && <div style={{ padding: '10px 12px', color: 'var(--failed, #DC2626)' }}>{ui.error}</div>}
      {ui.items && ui.items.length === 0 && (
        <div style={{ padding: '12px', color: 'var(--passed, #16A34A)', fontWeight: 600 }}>✓ No spelling mistakes found</div>
      )}
      {ui.items && ui.items.map(it => (
        <div key={it.word} style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ textDecoration: 'underline wavy #DC2626', textUnderlineOffset: 3, fontWeight: 600 }}>{it.word}</span>
            {it.count > 1 && <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}> · {it.count} times</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {it.suggestions.map(s => (
              <button key={s} type="button" onMouseDown={e => { e.preventDefault(); onFix(it.word, s) }}
                style={{ border: '1px solid var(--accent, #0077B6)', background: 'var(--accent-bg, #e6f2f8)', color: 'var(--accent, #0077B6)',
                  borderRadius: 999, padding: '2px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
            ))}
            {it.suggestions.length === 0 && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No suggestions</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <button type="button" onMouseDown={e => { e.preventDefault(); onAdd(it.word) }}
              style={{ border: 0, background: 'transparent', padding: 0, fontSize: 11.5, color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'inherit' }}>＋ Add to dictionary</button>
            <button type="button" onMouseDown={e => { e.preventDefault(); onIgnore(it.word) }}
              style={{ border: 0, background: 'transparent', padding: 0, fontSize: 11.5, color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'inherit' }}>Ignore</button>
          </div>
        </div>
      ))}
    </SpellPopup>
  )
}

function Btn({ active, disabled, onClick, title, children, width }) {
  return (
    <button type="button" title={title} disabled={disabled}
      // onMouseDown/preventDefault: clicking the toolbar must not blur the
      // editor, or the selection is lost and the command applies to nothing.
      onMouseDown={e => { e.preventDefault(); if (!disabled) onClick(e) }}
      className={'re-btn' + (active ? ' on' : '')}
      style={width ? { width } : undefined}>
      {children}
    </button>
  )
}

function Sep() { return <span className="re-sep" /> }

// Colour swatch dropdown. Opens on click, closes on pick or outside click.
function ColorMenu({ editor, kind }) {
  const [open, setOpen] = React.useState(false)
  const swatches = kind === 'highlight' ? HIGHLIGHTS : SWATCHES

  const apply = (c) => {
    if (kind === 'highlight') editor.chain().focus().toggleHighlight({ color: c }).run()
    else editor.chain().focus().setColor(c).run()
    setOpen(false)
  }
  const clear = () => {
    if (kind === 'highlight') editor.chain().focus().unsetHighlight().run()
    else editor.chain().focus().unsetColor().run()
    setOpen(false)
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <Btn title={kind === 'highlight' ? 'Highlight' : 'Text colour'}
        active={open} onClick={() => setOpen(o => !o)}>
        {kind === 'highlight' ? '🖍' : 'A'}
      </Btn>
      {open && (
        <>
          <div onMouseDown={e => { e.preventDefault(); setOpen(false) }}
            style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div className="re-popover" onMouseDown={e => e.preventDefault()}>
            <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
              {swatches.map(c => (
                <button key={c} type="button" onMouseDown={e => { e.preventDefault(); apply(c) }}
                  title={c} className="re-swatch" style={{ background: c }} />
              ))}
            </div>
            <button type="button" className="re-clear"
              onMouseDown={e => { e.preventDefault(); clear() }}>Remove</button>
          </div>
        </>
      )}
    </span>
  )
}

// Table controls. Once the caret is inside a table, the button set changes.
function TableMenu({ editor }) {
  const inTable = editor.isActive('table')
  if (!inTable) {
    return (
      <Btn title="Insert table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        ⊞
      </Btn>
    )
  }
  const c = () => editor.chain().focus()
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      <Btn title="Add column"    onClick={() => c().addColumnAfter().run()}>+│</Btn>
      <Btn title="Delete column" onClick={() => c().deleteColumn().run()}>−│</Btn>
      <Btn title="Add row"       onClick={() => c().addRowAfter().run()}>+─</Btn>
      <Btn title="Delete row"    onClick={() => c().deleteRow().run()}>−─</Btn>
      <Btn title="Merge / split" onClick={() => c().mergeOrSplit().run()}>⧉</Btn>
      <Btn title="Delete table"  onClick={() => c().deleteTable().run()}>✕⊞</Btn>
    </span>
  )
}

function Toolbar({ editor, items, onSpellCheck }) {
  if (!editor) return null
  const c = () => editor.chain().focus()

  const setLink = () => {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('Link URL', prev)
    if (url === null) return                       // cancelled
    if (url === '') { c().unsetLink().run(); return }
    // sanitize.js rejects javascript: etc. on save, but check here too so the
    // person gets told rather than silently losing the link later.
    c().setLink({ href: url }).run()
    if (!editor.getAttributes('link').href) window.alert('That link was rejected. Use http://, https://, or mailto:.')
  }

  const render = (key, i) => {
    switch (key) {
      case '|':        return <Sep key={i} />
      case 'undo':     return <Btn key={i} title="Undo (Ctrl+Z)" onClick={() => c().undo().run()}>↶</Btn>
      case 'redo':     return <Btn key={i} title="Redo (Ctrl+Y)" onClick={() => c().redo().run()}>↷</Btn>
      case 'underline':return <Btn key={i} title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}><u>U</u></Btn>
      case 'codeblock':return <Btn key={i} title="Code block" active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()}>{'{ }'}</Btn>
      case 'hr':       return <Btn key={i} title="Divider line" onClick={() => c().setHorizontalRule().run()}>―</Btn>
      case 'image':    return <Btn key={i} title="Insert image (or paste one)" onClick={() => {
          const url = window.prompt('Image web address (https://…). Tip: you can also paste or drag an image in.')
          if (url && /^https?:\/\//i.test(url)) c().setImage({ src: url }).run()
        }}>🖼</Btn>
      case 'para':     return (
          <select key={i} title="Text style" aria-label="Text style"
            value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
            onChange={(e) => { const v = e.target.value; if (v === 'p') c().setParagraph().run(); else c().setHeading({ level: Number(v[1]) }).run() }}
            style={{ height: 28, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontSize: 12.5, fontFamily: 'inherit', padding: '0 4px' }}>
            <option value="p">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
          </select>)
      case 'bold':     return <Btn key={i} title="Bold (Ctrl+B)"   active={editor.isActive('bold')}   onClick={() => c().toggleBold().run()}><b>B</b></Btn>
      case 'italic':   return <Btn key={i} title="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><i>I</i></Btn>
      case 'strike':   return <Btn key={i} title="Strikethrough"   active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><s>S</s></Btn>
      case 'code':     return <Btn key={i} title="Inline code"     active={editor.isActive('code')}   onClick={() => c().toggleCode().run()}>{'</>'}</Btn>
      case 'h1':       return <Btn key={i} title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}>H1</Btn>
      case 'h2':       return <Btn key={i} title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>H2</Btn>
      case 'h3':       return <Btn key={i} title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}>H3</Btn>
      case 'bullet':   return <Btn key={i} title="Bulleted list" active={editor.isActive('bulletList')}  onClick={() => c().toggleBulletList().run()}>•</Btn>
      case 'ordered':  return <Btn key={i} title="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>1.</Btn>
      case 'quote':    return <Btn key={i} title="Quote" active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()}>❝</Btn>
      case 'link':     return <Btn key={i} title="Link" active={editor.isActive('link')} onClick={setLink}>🔗</Btn>
      case 'color':    return <ColorMenu key={i} editor={editor} kind="color" />
      case 'highlight':return <ColorMenu key={i} editor={editor} kind="highlight" />
      case 'table':    return <TableMenu key={i} editor={editor} />
      case 'spell':    return onSpellCheck
        ? <Btn key={i} title="Check spelling" width={44} onClick={(e) => onSpellCheck(e.currentTarget.getBoundingClientRect())}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '-.02em' }}>ABC✓</span>
          </Btn>
        : null
      default:         return null
    }
  }
  return <div className="re-toolbar">{items.map(render)}</div>
}

/**
 * RichEditor
 *
 * @param value        initial HTML (uncontrolled after mount — see below)
 * @param onChange     (html, text) on every keystroke
 * @param onSubmit     called on Enter, when submitOnEnter is set
 * @param variant      'chat' | 'full'
 * @param editorRef    optional; receives { clear, focus, insertText, getHTML, isEmpty }
 * @param submitOnEnter  Enter submits, Shift+Enter is a newline (chat behaviour)
 */
export function RichEditor({
  value = '', onChange, onSubmit, onPasteFiles,
  placeholder = 'Write something…', variant = 'full',
  editorRef, submitOnEnter = false, minHeight = 120, maxHeight = 400,
  autofocus = false, disabled = false, profiles,
  // Optional: a DOM element to draw the toolbar into instead of above the text (My Notes
  // puts it above the whole notepad). Every other editor leaves this unset.
  toolbarTarget = null,
}) {
  const submitRef = useRef(onSubmit)
  useEffect(() => { submitRef.current = onSubmit }, [onSubmit])

  // The suggestion config is built once, so it must read profiles through a ref.
  // Passing the array directly would freeze it at whatever loaded first.
  const profilesRef = useRef(profiles)
  useEffect(() => { profilesRef.current = profiles }, [profiles])

  // Spell check: team names never count as typos. Read through a ref for the
  // same reason as profilesRef.
  const extraWordsRef = useRef(namesSet(profiles))
  useEffect(() => { extraWordsRef.current = namesSet(profiles) }, [profiles])
  // { kind: 'menu' | 'panel', at, ... } or null
  const [spellUi, setSpellUi] = React.useState(null)

  const editor = useEditor({
    editable: !disabled,
    autofocus,
    extensions: [
      StarterKit.configure({
        heading: variant === 'chat' ? false : { levels: [1, 2, 3] },
        // We supply our own Link so we can control validation.
        link: false,
      }),
      Link.configure({
        openOnClick: false,          // clicking in the EDITOR shouldn't navigate
        autolink: true,
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: true } }),
      // Images: full documents (KB, certifications) can hold pasted/dropped
      // images. Chat keeps files as uploaded attachments, so it skips this.
      ...(variant !== 'chat' ? [Image.configure({ allowBase64: true })] : []),
      Placeholder.configure({ placeholder }),
      // Only when a profiles list is supplied. Certification has no @mentions.
      ...(profiles ? [Mention.configure({
        // Insert plain text, not a mention node — see mentionSuggestion.jsx.
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        suggestion: mentionSuggestion(() => profilesRef.current),
      })] : []),
    ],
    content: value || '',
    // Fetch the dictionary the first time someone clicks into an editor, so
    // it's ready by the time they right-click. Errors surface later, in the menu.
    onFocus() { loadSpeller().catch(() => {}) },
    editorProps: {
      attributes: { class: 're-content', spellcheck: 'true', style: `min-height:${minHeight}px; max-height:${maxHeight}px` },
      handleDOMEvents: {
        // Right-click. On a misspelled word → our suggestions menu. Anywhere
        // else → the normal browser menu. stopPropagation keeps any page-wide
        // "no right-click" handler from swallowing the browser menu in here.
        contextmenu(view, event) {
          event.stopPropagation()
          const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const w = hit && wordAt(view.state.doc, hit.pos)
          if (!w) return false
          const at = { x: event.clientX, top: event.clientY, bottom: event.clientY }
          const show = (sp) => {
            if (!isMisspelled(sp, w.word, extraWordsRef.current)) return false
            setSpellUi({ kind: 'menu', at, ...w, suggestions: suggestFor(sp, w.word) })
            return true
          }
          if (_speller) {
            if (!show(_speller)) return false
            event.preventDefault()
            return true
          }
          // Dictionary still loading (first use) — show the menu while it arrives.
          event.preventDefault()
          setSpellUi({ kind: 'menu', at, ...w, loading: true })
          loadSpeller()
            .then(sp => { if (!show(sp)) setSpellUi({ kind: 'menu', at, ...w, correct: true }) })
            .catch(() => setSpellUi({ kind: 'menu', at, ...w, error: "Couldn't load the spell checker. Check your connection and try again." }))
          return true
        },
      },
      handleKeyDown(view, event) {
        if (!submitOnEnter) return false
        if (event.key !== 'Enter' || event.shiftKey) return false

        // Inside a list or a table, Enter must keep its normal meaning —
        // new bullet, next cell — not send the message.
        //
        // Read this from `view.state`, which ProseMirror hands us. An earlier
        // draft closed over the `editor` variable, which is still in its
        // temporal dead zone when useEditor first builds editorProps.
        const { $from } = view.state.selection
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name
          if (name === 'listItem' || name === 'bulletList' || name === 'orderedList' ||
              name === 'table' || name === 'tableRow' || name === 'tableCell' ||
              name === 'tableHeader' || name === 'codeBlock') {
            return false
          }
        }
        event.preventDefault()
        submitRef.current?.()
        return true
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files || [])
        // Pasted screenshots/images → inline image node (full variant only).
        const imgs = files.filter(f => (f.type || '').startsWith('image/'))
        if (imgs.length && view.state.schema.nodes.image) {
          event.preventDefault()
          for (const file of imgs) {
            const reader = new FileReader()
            reader.onload = () => {
              if (typeof reader.result !== 'string') return
              const node = view.state.schema.nodes.image.create({ src: reader.result })
              view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
            }
            reader.readAsDataURL(file)
          }
          return true
        }
        if (files.length && onPasteFiles) { event.preventDefault(); onPasteFiles(files); return true }
        return false
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML()
      onChange?.(html, htmlToText(html))
    },
  }, [variant, disabled])

  // ---- spell check actions ----
  // Build the ✓ panel's list: one row per misspelled word, with suggestions.
  function buildItems(sp) {
    const groups = new Map()
    for (const f of findMisspellings(sp, editor.state.doc, extraWordsRef.current)) {
      const g = groups.get(f.word)
      if (g) g.count++
      else groups.set(f.word, { word: f.word, count: 1 })
    }
    return [...groups.values()].map(g => ({ ...g, suggestions: suggestFor(sp, g.word) }))
  }
  function openSpellPanel(rect) {
    if (!editor) return
    const at = { x: rect.left, top: rect.top, bottom: rect.bottom }
    if (_speller) { setSpellUi({ kind: 'panel', at, items: buildItems(_speller) }); return }
    setSpellUi({ kind: 'panel', at, loading: true })
    loadSpeller()
      .then(sp => setSpellUi(cur => cur?.kind === 'panel' ? { kind: 'panel', at, items: buildItems(sp) } : cur))
      .catch(() => setSpellUi(cur => cur?.kind === 'panel' ? { kind: 'panel', at, error: "Couldn't load the spell checker. Check your connection and try again." } : cur))
  }
  // Swap every copy of `word` for `replacement`. Back to front, so earlier
  // positions stay valid while we edit.
  function replaceWord(word, replacement) {
    if (!editor || !_speller) return
    const hits = findMisspellings(_speller, editor.state.doc, extraWordsRef.current).filter(f => f.word === word)
    if (!hits.length) return
    let tr = editor.state.tr
    for (const h of hits.slice().reverse()) tr = tr.insertText(replacement, h.from, h.to)
    editor.view.dispatch(tr)
  }
  // After Add / Ignore, refresh whichever popup is open.
  function afterWordAccepted() {
    setSpellUi(cur => (cur?.kind === 'panel' && _speller) ? { ...cur, items: buildItems(_speller) } : null)
    editor?.commands.focus()
  }
  const closeSpell = React.useCallback(() => setSpellUi(null), [])

  // On phones the chat composer's formatting toolbar (10 icons) is clutter —
  // collapse it behind a single "Aa" toggle.
  const [narrow, setNarrow] = React.useState(() => typeof window !== 'undefined' && window.innerWidth <= 768)
  const [fmtOpen, setFmtOpen] = React.useState(false)
  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth <= 768)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])

  // Expose an imperative handle, matching the old composer's shape so callers
  // don't have to change how they clear / focus / insert emoji.
  useEffect(() => {
    if (!editorRef || !editor) return
    editorRef.current = {
      clear: () => editor.commands.clearContent(true),
      focus: () => editor.commands.focus('end'),
      insertText: (t) => editor.chain().focus().insertContent(t).run(),
      getHTML: () => editor.getHTML(),
      getText: () => htmlToText(editor.getHTML()),
      isEmpty: () => editor.isEmpty,
    }
  }, [editor, editorRef])

  useEffect(() => () => editor?.destroy(), [editor])

  if (!editor) return null

  const collapsibleToolbar = narrow && variant === 'chat'
  const toolbar = <Toolbar editor={editor} items={TOOLBARS[variant] || TOOLBARS.full} onSpellCheck={disabled ? null : openSpellPanel} />
  return (
    <div className={'re-wrap' + (disabled ? ' disabled' : '')}>
      {collapsibleToolbar ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 2px 0' }}>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setFmtOpen(o => !o)} title="Formatting"
              style={{ border: '1px solid var(--line)', background: fmtOpen ? 'var(--canvas)' : 'transparent', borderRadius: 6, fontSize: 12, fontWeight: 700, padding: '2px 9px', cursor: 'pointer', color: 'var(--ink-soft)' }}>Aa</button>
          </div>
          {fmtOpen && toolbar}
        </>
      ) : toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <EditorContent editor={editor} />

      {spellUi?.kind === 'menu' && (
        <SpellMenu ui={spellUi} onClose={closeSpell}
          onPick={(s) => {
            const { state, view } = editor
            // Only replace if the word is still where we found it.
            if (state.doc.textBetween(spellUi.from, spellUi.to) === spellUi.word) {
              view.dispatch(state.tr.insertText(s, spellUi.from, spellUi.to))
            }
            setSpellUi(null); editor.commands.focus()
          }}
          onAdd={(w) => { addPersonalWord(norm(w)); afterWordAccepted() }}
          onIgnore={(w) => { ignoredWords.add(norm(w).toLowerCase()); afterWordAccepted() }} />
      )}
      {spellUi?.kind === 'panel' && (
        <SpellPanel ui={spellUi} onClose={closeSpell}
          onFix={(word, s) => { replaceWord(word, s); setSpellUi(cur => cur ? { ...cur, items: buildItems(_speller) } : cur) }}
          onAdd={(w) => { addPersonalWord(norm(w)); afterWordAccepted() }}
          onIgnore={(w) => { ignoredWords.add(norm(w).toLowerCase()); afterWordAccepted() }} />
      )}
    </div>
  )
}

// ---- readability guard ---------------------------------------------------
// The Aa toolbar lets people colour their text, and sanitize.js deliberately
// preserves inline `color` on spans. A colour picked in light mode (near-black)
// is invisible against the dark canvas, and vice versa — the message renders as
// a blank block. So at RENDER time we measure each inline colour against the
// current background and drop only the ones that collide. Deliberate reds,
// blues and greens have plenty of contrast and survive untouched.
//
// Render time, not write time: this has to follow whichever theme the READER is
// using, and the same stored message must work for both.

function parseColor(css) {
  const v = String(css || '').trim()
  let m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (m) return [+m[1], +m[2], +m[3]]
  m = v.match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    if (h.length < 6) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  return null
}

function relLuminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrastRatio(a, b) {
  const l1 = relLuminance(a), l2 = relLuminance(b)
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

const MIN_CONTRAST = 3   // below this the text is effectively invisible

function dropUnreadableColors(html) {
  if (typeof window === 'undefined' || !window.DOMParser) return html
  if (!/style\s*=/i.test(html)) return html   // fast path: nothing coloured
  let bg = null
  try {
    bg = parseColor(getComputedStyle(document.documentElement).getPropertyValue('--canvas'))
  } catch { /* ignore */ }
  if (!bg) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.body.querySelectorAll('[style]').forEach(el => {
    const st = el.style
    // An explicit text+background pair was a deliberate choice — leave it be.
    if (!st.color || st.backgroundColor) return
    const fg = parseColor(st.color)
    if (!fg) return
    if (contrastRatio(fg, bg) >= MIN_CONTRAST) return
    st.removeProperty('color')
    if (!st.length) el.removeAttribute('style')
  })
  return doc.body.innerHTML
}

/**
 * RichContent — render stored HTML. ALWAYS sanitizes, never trusts the source.
 * `highlight` optionally wraps @here / @update.
 */
export function RichContent({ html, className = '', style, highlightMentions = false }) {
  let out = dropUnreadableColors(sanitizeHtml(html))
  if (highlightMentions) {
    // Safe: our span carries no user content, and everything around it is
    // already sanitized. Doing this BEFORE sanitizing would let a user smuggle
    // tags in by typing them.
    out = out.replace(/(@here|@update)\b/gi, '<span class="chat-mention">$1</span>')
  }
  return <div className={'re-rendered ' + className} style={style} dangerouslySetInnerHTML={{ __html: out }} />
}

export { sanitizeHtml, htmlToText, isEmptyHtml }
