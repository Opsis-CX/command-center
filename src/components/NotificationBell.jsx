import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { categoryForType } from '../lib/notify'
import { loadNotifPrefs, allowsSound, allowsInApp } from '../lib/notif_prefs'
import { primeAudio, loadSoundPrefs, playForNotification } from '../lib/sounds'

// ============================================================
// NOTIFICATION BELL — unread badge, dropdown, realtime,
// plus a soft chime on new notifications and a mute toggle.
// ============================================================

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Which new notifications get a pop-up box under the bell.
// Skipped: types that already have their own pop-up (reminders, LSA follow-ups, calls),
// categories the person turned off in-app, and messages in the chat they're looking at right now.
const OWN_POPUP_TYPES = new Set(['reminder_due', 'reminder_assigned', 'lsa_followup', 'incoming_call', 'meeting_reminder'])
function shouldToast(n, prefs) {
  if (!n || OWN_POPUP_TYPES.has(n.type)) return false
  if (!allowsInApp(prefs, categoryForType(n.type))) return false
  const ch = /[?&]channel=([0-9a-f-]{36})/i.exec(n.link || '')?.[1]
  if (ch && document.visibilityState === 'visible' && window.location.pathname === '/chat'
      && window.__ccOpenChannel === ch) return false
  return true
}

export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [meId, setMeId] = useState(null)
  const [prefs, setPrefs] = useState(null)
  const prefsRef = useRef(null)   // always holds latest prefs for the realtime chime
  const wrapRef = useRef(null)
  const navigate = useNavigate()
  // Pop-up box under the bell for each new notification (Brittney, 2026-10-27), so a new
  // notification is noticed even when the badge number change isn't.
  const [toasts, setToasts] = useState([])
  const toastTimers = useRef({})
  const dismissToast = useCallback((id) => {
    clearTimeout(toastTimers.current[id]); delete toastTimers.current[id]
    setToasts(t => t.filter(x => x.id !== id))
  }, [])
  const armToast = useCallback((id, ms = 7000) => {
    clearTimeout(toastTimers.current[id])
    toastTimers.current[id] = setTimeout(() => dismissToast(id), ms)
  }, [dismissToast])
  useEffect(() => () => Object.values(toastTimers.current).forEach(clearTimeout), [])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMeId(user.id)
    loadNotifPrefs(user.id).then(p => { setPrefs(p); prefsRef.current = p })
    loadSoundPrefs(user.id)
    const { data } = await supabase.from('notifications')
      .select('*').eq('recipient_id', user.id)
      .order('created_at', { ascending: false }).limit(50)
    setItems(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  // Re-read prefs when the tab regains focus, so a change made on the
  // Settings page takes effect here without needing a full reload.
  useEffect(() => {
    async function refresh() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const p = await loadNotifPrefs(user.id)
      setPrefs(p); prefsRef.current = p
      loadSoundPrefs(user.id)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  // Unlock audio on user interaction (browsers only allow sound after a gesture).
  useEffect(() => {
    window.addEventListener('pointerdown', primeAudio, { passive: true })
    window.addEventListener('keydown', primeAudio)
    return () => { window.removeEventListener('pointerdown', primeAudio); window.removeEventListener('keydown', primeAudio) }
  }, [])

  // The service worker asks this page to play the sound for a push (so a
  // background pop-up can stay silent and you hear YOUR sound, once).
  // We answer { played } — if we couldn't play, the pop-up uses the system sound.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    async function onMsg(e) {
      const d = e.data
      if (!d || d.kind !== 'cc-push-sound') return
      let played = false
      if (allowsSound(prefsRef.current, categoryForType(d.type))) {
        played = await playForNotification(d.id, d.type)
      } else {
        played = true // sound is off for this category — keep the pop-up quiet too
      }
      try { e.ports && e.ports[0] && e.ports[0].postMessage({ played }) } catch { /* ignore */ }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  // realtime: new notifications for me → add + chime
  useEffect(() => {
    if (!meId) return
    const ch = supabase.channel(`notif:${meId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${meId}` },
        (payload) => {
          setItems(prev => {
            if (prev.some(x => x.id === payload.new.id)) return prev
            if (allowsSound(prefsRef.current, categoryForType(payload.new.type))) playForNotification(payload.new.id, payload.new.type)
            if (shouldToast(payload.new, prefsRef.current)) {
              setToasts(t => [payload.new, ...t.filter(x => x.id !== payload.new.id)].slice(0, 3))
              armToast(payload.new.id)
            }
            return [payload.new, ...prev]
          })
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [meId, armToast])

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const unread = items.filter(n => !n.read_at).length


  async function markAllRead() {
    const ids = items.filter(n => !n.read_at).map(n => n.id)
    if (!ids.length) return
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
  }

  async function openItem(n) {
    if (!n.read_at) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  async function clearAll() {
    const ids = items.map(n => n.id)
    setItems([])
    if (ids.length) await supabase.from('notifications').delete().in('id', ids)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
      <button onClick={() => setOpen(o => !o)} aria-label="Notifications"
        style={{ position: 'relative', border: 0, background: 'transparent', cursor: 'pointer', padding: 6, fontSize: 18, lineHeight: 1, color: 'var(--ink)' }}>
        🔔
        {unread > 0 && <span style={{ position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--failed)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', lineHeight: 1 }}>{unread > 9 ? '9+' : unread}</span>}
      </button>

      {!open && toasts.length > 0 && (
        <div aria-live="polite" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340, maxWidth: 'calc(100vw - 24px)', zIndex: 2900, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <style>{'@keyframes ccToastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}'}</style>
          {toasts.map(n => (
            <div key={n.id} role="status"
              onMouseEnter={() => clearTimeout(toastTimers.current[n.id])}
              onMouseLeave={() => armToast(n.id, 4000)}
              style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: '4px solid var(--accent)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.18)', animation: 'ccToastIn .2s ease' }}>
              <button onClick={() => { dismissToast(n.id); openItem(n) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '11px 34px 11px 14px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{n.body}</div>}
              </button>
              <button onClick={() => dismissToast(n.id)} aria-label="Dismiss" title="Dismiss"
                style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340, maxHeight: 440, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.15)', zIndex: 3000, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b style={{ fontSize: 14 }}>Notifications</b>
            <div style={{ display: 'flex', gap: 8 }}>
              {unread > 0 && <button onClick={markAllRead} style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Mark all read</button>}
              {items.length > 0 && <button onClick={clearAll} style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', fontSize: 12, cursor: 'pointer' }}>Clear</button>}
            </div>
          </div>
          <div style={{ overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>You're all caught up 🎉</div>
            ) : items.map(n => (
              <button key={n.id} onClick={() => openItem(n)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line-soft)', background: n.read_at ? 'transparent' : 'var(--accent-bg)', padding: '11px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {!n.read_at && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginTop: 5, flex: 'none' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 1 }}>{n.body}</div>}
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); navigate('/notifications') }}
            style={{ border: 0, borderTop: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '10px 14px', fontFamily: 'inherit', textAlign: 'center' }}>
            See all notifications
          </button>
        </div>
      )}
    </div>
  )
}
