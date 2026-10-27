import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ============================================================
// NEW UPDATE POP-UP (2026-10-26, Brittney)
// When an update meant for you is posted (everyone, or one of your teams), a box pops up:
// "New update — click to view", with ✕ to dismiss. Live via realtime on `announcements`,
// re-checked on focus and every 5 minutes as a fallback.
// Viewing or dismissing hides the pop-up for that update on this device. It never marks the
// update read: confirming you've read it stays a deliberate step on the Updates page.
// Only updates from the last 14 days pop up.
// ============================================================

const KEY = 'cc.updatePopup.seen'
const seenIds = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) } catch { return new Set() } }
const remember = (ids) => {
  try { const all = [...seenIds(), ...ids].slice(-300); localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* ignore */ }
}

export default function UpdatePopup() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [items, setItems] = useState([])
  const timer = useRef(null)

  const check = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_unread_updates')
    if (error) return
    const since = Date.now() - 14 * 864e5
    const seen = seenIds()
    setItems((data || []).filter(u => !seen.has(u.id) && new Date(u.created_at).getTime() >= since))
  }, [])

  useEffect(() => {
    check()
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    window.addEventListener('cc:updates-read', onFocus)
    timer.current = setInterval(check, 5 * 60 * 1000)
    const ch = supabase.channel('update-popup')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => setTimeout(check, 1500))
      .subscribe()
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('cc:updates-read', onFocus)
      clearInterval(timer.current)
      supabase.removeChannel(ch)
    }
  }, [check])

  if (!items.length || pathname.startsWith('/updates')) return null
  const top = items[0]
  const dismiss = () => { remember(items.map(i => i.id)); setItems([]) }
  const view = () => { remember(items.map(i => i.id)); setItems([]); navigate('/updates') }

  return (
    <div role="alertdialog" aria-labelledby="upd-pop-t" aria-describedby="upd-pop-d"
      style={{ position: 'fixed', right: 20, bottom: 96, zIndex: 90, width: 'min(340px, calc(100vw - 32px))', background: 'var(--surface)',
        border: '1px solid var(--line)', borderLeft: '4px solid var(--accent)', borderRadius: 14, boxShadow: '0 18px 44px rgba(0,0,0,.22)', padding: '14px 16px', animation: 'updPopIn .25s ease' }}>
      <style>{'@keyframes updPopIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'}</style>
      <button onClick={dismiss} aria-label="Dismiss" title="Not now"
        style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingRight: 22 }}>
        <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">📣</span>
        <div style={{ minWidth: 0 }}>
          <div id="upd-pop-t" style={{ fontWeight: 700, fontSize: 15 }}>{items.length > 1 ? `${items.length} new updates` : 'New update'}</div>
          <div id="upd-pop-d" style={{ fontSize: 13.5, marginTop: 3, overflowWrap: 'anywhere' }}>
            <b style={{ fontWeight: 600 }}>{top.title}</b>
            {top.author_name && <span style={{ color: 'var(--ink-soft)' }}> · {top.author_name}</span>}
          </div>
        </div>
      </div>
      <button className="btn btn-primary" onClick={view} style={{ width: '100%', marginTop: 12 }} autoFocus>Click now to view</button>
    </div>
  )
}
