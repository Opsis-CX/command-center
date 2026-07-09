import React, { useEffect, useRef } from 'react'
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

import { sanitizeHtml, htmlToText, isEmptyHtml } from './sanitize'

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
  chat: ['bold', 'italic', 'strike', 'code', '|', 'bullet', 'ordered', '|', 'link', 'color', 'highlight'],
  // Certification / documents: the lot.
  full: ['bold', 'italic', 'strike', 'code', '|', 'h1', 'h2', 'h3', '|',
         'bullet', 'ordered', 'quote', '|', 'link', 'color', 'highlight', '|', 'table'],
}

const SWATCHES = ['#0d1518', '#c0392b', '#d97706', '#1f8a53', '#0077b6', '#7c3aed', '#db2777']
const HIGHLIGHTS = ['#fff3a3', '#c6f6d5', '#bee3f8', '#fed7d7', '#e9d8fd']

function Btn({ active, disabled, onClick, title, children, width }) {
  return (
    <button type="button" title={title} disabled={disabled}
      // onMouseDown/preventDefault: clicking the toolbar must not blur the
      // editor, or the selection is lost and the command applies to nothing.
      onMouseDown={e => { e.preventDefault(); if (!disabled) onClick() }}
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

function Toolbar({ editor, items }) {
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
  autofocus = false, disabled = false,
}) {
  const submitRef = useRef(onSubmit)
  useEffect(() => { submitRef.current = onSubmit }, [onSubmit])

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
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editorProps: {
      attributes: { class: 're-content', style: `min-height:${minHeight}px; max-height:${maxHeight}px` },
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
        if (files.length && onPasteFiles) { event.preventDefault(); onPasteFiles(files); return true }
        return false
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML()
      onChange?.(html, htmlToText(html))
    },
  }, [variant, disabled])

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

  return (
    <div className={'re-wrap' + (disabled ? ' disabled' : '')}>
      <Toolbar editor={editor} items={TOOLBARS[variant] || TOOLBARS.full} />
      <EditorContent editor={editor} />
    </div>
  )
}

/**
 * RichContent — render stored HTML. ALWAYS sanitizes, never trusts the source.
 * `highlight` optionally wraps @here / @update.
 */
export function RichContent({ html, className = '', style, highlightMentions = false }) {
  let out = sanitizeHtml(html)
  if (highlightMentions) {
    // Safe: our span carries no user content, and everything around it is
    // already sanitized. Doing this BEFORE sanitizing would let a user smuggle
    // tags in by typing them.
    out = out.replace(/(@here|@update)\b/gi, '<span class="chat-mention">$1</span>')
  }
  return <div className={'re-rendered ' + className} style={style} dangerouslySetInnerHTML={{ __html: out }} />
}

export { sanitizeHtml, htmlToText, isEmptyHtml }
