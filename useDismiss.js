import { useEffect } from 'react'

// Close a pop-over when the person clicks outside it or presses Escape.
// `ref` wraps both the trigger and the panel, so clicking the trigger again is left to its own handler.
export default function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [ref, open, onClose])
}
