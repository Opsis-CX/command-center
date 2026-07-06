import React, { useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { initials, AVATAR_COLORS } from './projectHelpers'

// ============================================================
// RICH TEXT EDITOR — contenteditable with a small formatting
// toolbar (bold/italic/lists) and @mention autocomplete.
// Ported from the standalone app's RTE + mention system.
//
// Ref API: getHtml(), getText(), clear(), setHtml(html)
// Props: profiles, placeholder, minHeight, onMention(profile)
// ============================================================

function sanitize(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(el => el.remove())
  div.querySelectorAll('*').forEach(el => {
    ;[...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name) || (attr.name === 'href' && /^javascript:/i.test(attr.value))) el.removeAttribute(attr.name)
    })
  })
  return div.innerHTML
}

const RichTextEditor = forwardRef(function RichTextEditor(
  { profiles = [], placeholder = '', minHeight = 80, onEnter, className }, ref
) {
  const editorRef = useRef(null)
  const [dropdown, setDropdown] = useState({ open: false, matches: [], index: 0 })
  // stable snapshot of the caret's mention context (text node + offset)
  const mentionCtx = useRef(null)

  useImperativeHandle(ref, () => ({
    getHtml: () => sanitize(editorRef.current?.innerHTML || ''),
    getText: () => editorRef.current?.innerText || '',
    clear: () => { if (editorRef.current) editorRef.current.innerHTML = '' },
    setHtml: (html) => { if (editorRef.current) editorRef.current.innerHTML = html || '' },
    focus: () => editorRef.current?.focus(),
  }))

  function cmd(command) {
    editorRef.current?.focus()
    document.execCommand(command, false, null)
  }

  // detect "@query" immediately before the caret
  function caretMentionQuery() {
    const sel = window.getSelection()
    if (!sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (!editorRef.current?.contains(node) || node.nodeType !== Node.TEXT_NODE) return null
    const offset = range.startOffset
    const before = node.textContent.slice(0, offset)
    const m = before.match(/@([A-Za-z]*)$/)
    return m ? { query: m[1], node, offset } : null
  }

  function handleInput() {
    const found = caretMentionQuery()
    if (!found) { mentionCtx.current = null; setDropdown(d => ({ ...d, open: false })); return }
    mentionCtx.current = found
    const matches = profiles.filter(p => p.full_name.toLowerCase().includes(found.query.toLowerCase()))
    if (!matches.length) { setDropdown(d => ({ ...d, open: false })); return }
    setDropdown({ open: true, matches, index: 0 })
  }

  function handleKeyDown(e) {
    if (dropdown.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setDropdown(d => ({ ...d, index: Math.min(d.index + 1, d.matches.length - 1) })); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setDropdown(d => ({ ...d, index: Math.max(d.index - 1, 0) })); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(dropdown.matches[dropdown.index]); return }
      if (e.key === 'Escape') { setDropdown(d => ({ ...d, open: false })); return }
    }
    // Ctrl/Cmd+Enter sends; plain Enter behaves normally (new line / new bullet)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onEnter && !dropdown.open) {
      e.preventDefault(); onEnter()
    }
  }

  function pickMention(person) {
    if (!person) return
    const found = mentionCtx.current || caretMentionQuery()
    if (!found) { setDropdown(d => ({ ...d, open: false })); return }
    const { node } = found
    const fullText = node.textContent
    let offset = Math.min(found.offset, fullText.length)
    let matchStart = fullText.slice(0, offset).search(/@[A-Za-z]*$/)
    if (matchStart === -1) {
      const m = fullText.match(/@[A-Za-z]*(?![\s\S]*@[A-Za-z]*)/)
      if (m) { matchStart = m.index; offset = m.index + m[0].length }
    }
    if (matchStart === -1) { setDropdown(d => ({ ...d, open: false })); return }
    const before = fullText.slice(0, matchStart)
    const after = fullText.slice(offset)
    const parent = node.parentNode
    if (!parent) { setDropdown(d => ({ ...d, open: false })); return }

    const beforeNode = document.createTextNode(before)
    const span = document.createElement('span')
    span.className = 'pm-mention'
    span.textContent = '@' + person.full_name
    span.setAttribute('contenteditable', 'false')
    span.style.color = 'var(--accent)'
    span.style.fontWeight = '600'
    const space = document.createTextNode('\u00A0')
    const afterNode = document.createTextNode(after)

    parent.insertBefore(beforeNode, node)
    parent.insertBefore(span, node)
    parent.insertBefore(space, node)
    parent.insertBefore(afterNode, node)
    parent.removeChild(node)

    // caret after the space
    const r = document.createRange()
    r.setStartAfter(space); r.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(r)
    editorRef.current?.focus()
    mentionCtx.current = null
    setDropdown(d => ({ ...d, open: false }))
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 6 }}>
        <TB onClick={() => cmd('bold')} title="Bold"><b>B</b></TB>
        <TB onClick={() => cmd('italic')} title="Italic"><i>I</i></TB>
        <span style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }} />
        <TB onClick={() => cmd('insertUnorderedList')} title="Bullet list">•≡</TB>
        <TB onClick={() => cmd('insertOrderedList')} title="Numbered list">1≡</TB>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className={'pm-rte ' + (className || '')}
        style={{ minHeight, outline: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 1.5, background: 'var(--bg-soft, #f7f7f5)', overflowY: 'auto' }}
      />
      {dropdown.open && (
        <div style={{ position: 'absolute', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 160, overflowY: 'auto', zIndex: 50 }}>
          {dropdown.matches.map((p, i) => (
            <div key={p.id}
              onMouseDown={e => { e.preventDefault(); pickMention(p) }}
              onMouseEnter={() => setDropdown(d => ({ ...d, index: i }))}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', background: i === dropdown.index ? 'var(--bg-soft, #f0f0ee)' : 'transparent' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: (p.color || AVATAR_COLORS[0]) + '22', color: p.color || AVATAR_COLORS[0], fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(p.full_name)}</span>
              <span style={{ fontSize: 13 }}>{p.full_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

function TB({ onClick, title, children }) {
  return (
    <button type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-soft)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>
      {children}
    </button>
  )
}

export default RichTextEditor
