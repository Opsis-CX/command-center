import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { categoryForType } from '../lib/notify'
import { loadNotifPrefs, allowsSound } from '../lib/notif_prefs'

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

// Soft two-note chime via Web Audio (no file needed).
function makeChime() {
  let ctx = null
  function prime() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch (e) { ctx = null } }
    if (ctx && ctx.state === 'suspended') ctx.resume()
  }
  function play() {
    if (!ctx) prime()
    if (!ctx) return
    const now = ctx.currentTime
    const notes = [ [880, 0], [1174.66, 0.11] ] // A5 then D6
    notes.forEach(([freq, offset]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      osc.connect(gain); gain.connect(ctx.destination)
      const t = now + offset
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.14, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      osc.start(t); osc.stop(t + 0.4)
    })
  }
  return { prime, play }
}

export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [meId, setMeId] = useState(null)
  const [prefs, setPrefs] = useState(null)
  const prefsRef = useRef(null)   // always holds latest prefs for the realtime chime
  const wrapRef = useRef(null)
  const chimeRef = useRef(null)
  const navigate = useNavigate()

  if (!chimeRef.current) chimeRef.current = makeChime()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMeId(user.id)
    loadNotifPrefs(user.id).then(p => { setPrefs(p); prefsRef.current = p })
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
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  // prime audio on first user interaction anywhere (browsers require this)
  useEffect(() => {
    const prime = () => { chimeRef.current?.prime() }
    window.addEventListener('click', prime, { once: true })
    window.addEventListener('keydown', prime, { once: true })
    return () => { window.removeEventListener('click', prime); window.removeEventListener('keydown', prime) }
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
            if (allowsSound(prefsRef.current, categoryForType(payload.new.type))) chimeRef.current?.play()
            return [payload.new, ...prev]
          })
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [meId])

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
