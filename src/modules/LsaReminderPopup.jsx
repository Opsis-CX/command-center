import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// Full-screen pop-up for a due LSA follow-up — mirrors MeetingReminder, but is
// driven by the notifications table. The fire_lsa_followups() cron inserts one
// 'lsa_followup' notification per GarageCo LSA Chat Team member when a lead's
// reminder comes due; this shows the oldest unread one and marks it read on close.

const POLL_MS = 30_000

export default function LsaReminderPopup() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [due, setDue] = useState(null)
  const busy = useRef(false)

  const check = useCallback(async () => {
    if (!user?.id || due) return
    const { data, error } = await supabase.from('notifications')
      .select('id,title,body,link,created_at')
      .eq('recipient_id', user.id).eq('type', 'lsa_followup')
      .is('read_at', null).is('dismissed_at', null)
      .order('created_at', { ascending: true }).limit(1)
    if (error || !Array.isArray(data) || data.length === 0) return
    setDue(data[0])
  }, [user, due])

  useEffect(() => {
    check()
    const id = setInterval(check, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [check])

  const markRead = useCallback(async () => {
    if (!due || busy.current) return
    busy.current = true
    const id = due.id
    setDue(null)
    try { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id) }
    finally { busy.current = false }
  }, [due])

  async function openChannel() {
    const link = due?.link
    await markRead()
    if (link) navigate(link)
  }

  useEffect(() => {
    if (!due) return
    const onKey = (e) => { if (e.key === 'Escape') markRead() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [due, markRead])

  if (!due) return null
  const accent = '#0d9488'
  return (
    <div role="alertdialog" aria-modal="true" aria-label="LSA follow-up due"
      style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(15,23,42,.75)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(520px, 100%)', background: 'var(--surface, #fff)', color: 'var(--ink, #0f172a)', borderRadius: 18, borderTop: `8px solid ${accent}`, boxShadow: '0 24px 64px rgba(0,0,0,.35)', padding: '30px 32px 26px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', color: accent }}>⏰ LSA follow-up due</div>
        <div style={{ fontSize: 23, fontWeight: 800, margin: '18px 0 6px', lineHeight: 1.3 }}>{due.body || 'A lead needs follow-up'}</div>
        <div style={{ fontSize: 14, color: 'var(--ink-soft, #64748b)', marginBottom: 26 }}>Reach out, then update the lead's status in the LSA Tracker.</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={openChannel} style={{ background: accent, color: '#fff', border: 'none', fontWeight: 800, padding: '14px 30px', borderRadius: 10, fontSize: 16, cursor: 'pointer' }}>Open LSA channel</button>
          <button onClick={markRead} style={{ background: 'transparent', color: 'var(--ink-soft, #64748b)', border: '1px solid var(--line, #e2e8f0)', fontWeight: 700, padding: '14px 26px', borderRadius: 10, fontSize: 15, cursor: 'pointer' }}>Dismiss</button>
        </div>
      </div>
    </div>
  )
}
