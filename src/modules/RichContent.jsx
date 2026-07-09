import React from 'react'
import DOMPurify from 'dompurify'

const CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4',
    'ul', 'ol', 'li', 'blockquote', 'hr',
    'a', 'span', 'font',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'style', 'color'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
}

// Keep only colour from inline styles. Blocks pasted layout and the
// 1px hidden containers that swallowed three team bios.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.hasAttribute('style')) {
    const kept = node.getAttribute('style')
      .split(';')
      .map(d => d.trim())
      .filter(d => /^(color|background-color)\s*:/i.test(d))
      .join('; ')
    kept ? node.setAttribute('style', kept) : node.removeAttribute('style')
  }
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

export default function RichContent({ html, className = '', style }) {
  const clean = React.useMemo(() => DOMPurify.sanitize(html || '', CONFIG), [html])
  return (
    <div
      className={`rich rich-full ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
