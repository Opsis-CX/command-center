import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// REMINDER POP-UP (2026-10-26, Brittney)
// Shows on screen when a reminder warning fires (30 and 10 minutes before, from the
// reminder-warnings job) or when an admin sets a reminder for you. Push alerts only
// appear when the app is in the background, so this covers "app open and in front".
// Live via realtime on your own notifications; on load it also shows any warning from
// the last 15 minutes you haven't seen. ✕ or "Open reminders" marks that notification read.
// ============================================================

const TYPES = ['reminder_due', 'reminder_assigned']
const KEY = 'cc.reminderPopup.seen'
const seen = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) } catch { return new Set() } }
const remember = (ids) => { try { localStorage.setItem(KEY, JSON.stringify([...seen(), ...ids].slice(-200))) } catch { /* ignore */ } }

export default function ReminderPopup() {
  const { user } = useAuth()
  const uid = user?.id
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [queue, setQueue] = useState([])

  const add = useCallback((rows) => {
    const s = seen()
    setQueue(q => {
      const have = new Set(q.map(x => x.id))
      return [...rows.filter(r => TYPES.includes(r.type) && !s.has(r.id) && !r.read_at && !have.has(r.id)), ...q]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    })
  }, [])

  useEffect(() => {
    if (!uid) return
    supabase.from('notifications').select('id, type, title, body, created_at, read_at')
      .eq('recipient_id', uid).in('type', TYPES).is('read_at', null)
      .gte('created_at', new Date(Date.now() - 15 * 60000).toISOString())
      .order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => add(data || []))
    const ch = supabase.channel('reminder-popup-' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${uid}` },
        (payload) => add([payload.new]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, add])

  if (!queue.length) return null
  const top = queue[0]
  const close = (all) => {
    const ids = all ? queue.map(q => q.id) : [top.id]
    remember(ids)
    setQueue(q => q.filter(x => !ids.includes(x.id)))
    supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).then(() => {})
  }
  const open = () => {
    close(true)
    if (pathname === '/profile') window.dispatchEvent(new Event('cc:open-reminders'))
    else navigate('/profile#reminders')
  }

  return (
    <div role="alertdialog" aria-labelledby="rem-pop-t" aria-describedby="rem-pop-d"
      style={{ position: 'fixed', top: 76, right: 20, zIndex: 95, width: 'min(340px, calc(100vw - 32px))', background: 'var(--surface)',
        border: '1px solid var(--line)', borderLeft: '4px solid #F59E0B', borderRadius: 14, boxShadow: '0 18px 44px rgba(0,0,0,.22)', padding: '14px 16px', animation: 'remPopIn .25s ease' }}>
      <style>{'@keyframes remPopIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}'}</style>
      <button onClick={() => close(false)} aria-label="Dismiss reminder" title="Dismiss"
        style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
      <div style={{ paddingRight: 22 }}>
        <div id="rem-pop-t" style={{ fontWeight: 700, fontSize: 15 }}>{top.title}</div>
        <div id="rem-pop-d" style={{ fontSize: 13.5, marginTop: 4, overflowWrap: 'anywhere' }}>{top.body}</div>
        {queue.length > 1 && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>+{queue.length - 1} more reminder{queue.length > 2 ? 's' : ''}</div>}
      </div>
      <button className="btn btn-primary" onClick={open} style={{ width: '100%', marginTop: 12 }}>Open reminders</button>
    </div>
  )
}
