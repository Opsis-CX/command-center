import React, { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import { ReactRenderer } from '@tiptap/react'

// ============================================================
// mentionSuggestion.js — the "@" autocomplete for RichEditor.
//
// DESIGN NOTE, and it matters:
//
// TipTap's Mention extension normally inserts a node that serialises to
//   <span data-type="mention" data-id="uuid">@Ann</span>
//
// sanitize.js strips every data-* attribute, so that span would come back from
// the database as bare text and the mention would look broken. We could widen
// the sanitizer to allow data-type/data-id on spans — but nothing downstream
// reads them. extractMentions() scans the PLAIN TEXT for "@Full Name", and the
// whole notification pipeline is built on that.
//
// So: the popup exists purely as a typing aid. What it inserts is plain text,
// "@Full Name ", exactly what a person would have typed by hand. Stored HTML
// stays clean, the sanitizer stays strict, and mentions keep working.
// ============================================================

function initials(name) {
  const p = (name || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

function avatarColor(name) {
  const colors = ['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']
  let h = 0; for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}

const MentionList = forwardRef(function MentionList({ items, command }, ref) {
  const [hi, setHi] = useState(0)
  useEffect(() => setHi(0), [items])

  const pick = (i) => { const item = items[i]; if (item) command(item) }

  // TipTap calls this for every keypress while the popup is open. Returning
  // true swallows the key; false lets it reach the editor.
  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (event.key === 'ArrowUp')   { setHi(h => (h + items.length - 1) % items.length); return true }
      if (event.key === 'ArrowDown') { setHi(h => (h + 1) % items.length); return true }
      if (event.key === 'Enter' || event.key === 'Tab') { pick(hi); return true }
      if (event.key === 'Escape')    { return false }
      return false
    },
  }), [items, hi])

  if (!items.length) return null

  return (
    <div className="re-mention-list">
      {items.map((p, i) => (
        <button key={p.id} type="button"
          className={'re-mention-item' + (i === hi ? ' on' : '')}
          onMouseEnter={() => setHi(i)}
          onMouseDown={e => { e.preventDefault(); pick(i) }}>
          <span className="re-mention-av" style={{ background: avatarColor(p.full_name) }}>
            {initials(p.full_name)}
          </span>
          {p.full_name}
        </button>
      ))}
    </div>
  )
})

/**
 * Build the `suggestion` config for the Mention extension.
 * @param getProfiles () => [{ id, full_name }]
 */
export function mentionSuggestion(getProfiles) {
  return {
    char: '@',
    // Don't fire mid-word: "email@example.com" should not open the popup.
    allowedPrefixes: [' ', '\n'],
    startOfLine: false,

    items: ({ query }) => {
      const q = (query || '').toLowerCase()
      return (getProfiles() || [])
        .filter(p => p.full_name?.toLowerCase().includes(q))
        .slice(0, 6)
    },

    // Replace the "@query" range with plain text. `insertContentAt` with a
    // string (not a node) is what keeps this out of the sanitizer's way.
    command: ({ editor, range, props }) => {
      editor.chain().focus()
        .insertContentAt(range, `@${props.full_name} `)
        .run()
    },

    render: () => {
      let component
      let el
      let getRect

      const position = () => {
        if (!el || !getRect) return
        const rect = getRect()
        if (!rect) return
        // Anchor above the caret, clamped to the viewport so it never opens
        // off-screen at the top of a short composer.
        const top = rect.top - el.offsetHeight - 6
        el.style.left = `${Math.max(8, rect.left)}px`
        el.style.top = `${top < 8 ? rect.bottom + 6 : top}px`
      }

      return {
        onStart: (props) => {
          if (!props.clientRect) return
          getRect = props.clientRect
          component = new ReactRenderer(MentionList, { props, editor: props.editor })
          el = document.createElement('div')
          el.className = 're-mention-popup'
          el.appendChild(component.element)
          document.body.appendChild(el)
          position()
        },
        onUpdate: (props) => {
          getRect = props.clientRect || getRect
          component?.updateProps(props)
          position()
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            el?.remove(); el = null
            return true
          }
          return component?.ref?.onKeyDown(props) ?? false
        },
        onExit: () => {
          el?.remove(); el = null
          getRect = null
          component?.destroy(); component = null
        },
      }
    },
  }
}
