import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ============================================================
// NOTIFICATION BELL — top bar. Unread badge, dropdown list,
// mark-read, click-through. Updates live via Realtime.
// ============================================================

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [meId, setMeId] = useState(null)
  const wrapRef = useRef(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMeId(user.id)
    const { data } = await supabase.from('notifications')
      .select('*').eq('recipient_id', user.id)
      .order('created_at', { ascending: false }).limit(50)
    setItems(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  // realtime: new notifications for me
  useEffect(() => {
    if (!meId) return
    const ch = supabase.channel(`notif:${meId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${meId}` },
        (payload) => setItems(prev => prev.some(x => x.id === payload.new.id) ? prev : [payload.new, ...prev]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [meId])

  // close on outside click
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
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} aria-label="Notifications"
        style={{ position: 'relative', border: 0, background: 'transparent', cursor: 'pointer', padding: 6, fontSize: 18, lineHeight: 1, color: 'var(--ink)' }}>
        🔔
        {unread > 0 && <span style={{ position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--failed)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', lineHeight: 1 }}>{unread > 9 ? '9+' : unread}</span>}
      </button>

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
        </div>
      )}
    </div>
  )
}
