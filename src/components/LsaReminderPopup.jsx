import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ============================================================
// LSA FOLLOW-UP REMINDER — a full-screen alert you can't scroll past.
//
// Driven by unread `lsa_followup` rows in `notifications`, which
// public.fire_lsa_followups() inserts (one per LSA channel member) each time
// an open lead crosses its next follow-up interval (15m, 30m, 3h, 24h, 72h,
// 120h, 168h). Mirrors MeetingReminder: polls, catches up on tab focus, and
// shows one alert at a time.
//
// Dismiss and Open both mark the notification read (read_at), so it won't fire
// again on the next poll or a refresh. Open also routes to the LSA channel.
// ============================================================

const POLL_MS = 30_000

export default function LsaReminderPopup() {
  const [due, setDue] = useState(null)          // a notifications row
  const navigate = useNavigate()
  const busyRef = useRef(false)

  const check = useCallback(async () => {
    // Don't stack a new alert on top of one still on screen.
    if (due) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.from('notifications')
      .select('id, title, body, link, created_at')
      .eq('recipient_id', user.id)
      .eq('type', 'lsa_followup')
      .is('read_at', null)
      .is('dismissed_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
    if (error || !Array.isArray(data) || data.length === 0) return
    setDue(data[0])
  }, [due])

  useEffect(() => {
    check()
    const id = setInterval(check, POLL_MS)
    // catch up immediately when the laptop wakes or the tab comes back
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [check])

  // Mark the current notification read so it won't fire again, then clear it.
  const resolve = useCallback(async () => {
    if (!due || busyRef.current) return null
    busyRef.current = true
    const link = due.link
    try {
      await supabase.from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', due.id)
    } catch { /* best-effort; never trap the user behind the modal */ }
    setDue(null)
    busyRef.current = false
    return link
  }, [due])

  async function dismiss() { await resolve() }

  async function open() {
    const link = await resolve()
    navigate(link || '/chat')
  }

  // Esc closes it — it's a big modal, not a hostage situation.
  useEffect(() => {
    if (!due) return
    const onKey = (e) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [due]) // eslint-disable-line

  if (!due) return null
  const accent = '#DC2626'

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="LSA lead needs follow-up"
      style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        background: 'rgba(15,23,42,.75)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        width: 'min(560px, 100%)', background: 'var(--surface, #fff)', color: 'var(--ink, #0f172a)',
        borderRadius: 18, borderTop: `8px solid ${accent}`,
        boxShadow: '0 24px 64px rgba(0,0,0,.35)', padding: '30px 32px 26px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', color: accent }}>
          💬 LSA follow-up due
        </div>

        <div style={{ fontSize: 23, fontWeight: 800, margin: '18px 0 6px', lineHeight: 1.25 }}>
          {due.title || 'An LSA lead needs a follow-up'}
        </div>
        {due.body && (
          <div style={{ fontSize: 15, color: 'var(--ink-soft, #64748b)', marginBottom: 26, whiteSpace: 'pre-wrap' }}>
            {due.body}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: due.body ? 0 : 20 }}>
          <button onClick={open} style={{
            background: accent, color: '#fff', border: 'none', fontWeight: 800,
            padding: '14px 30px', borderRadius: 10, fontSize: 16, cursor: 'pointer',
          }}>
            Open the LSA channel
          </button>
          <button onClick={dismiss} style={{
            background: 'transparent', color: 'var(--ink-soft, #64748b)',
            border: '1px solid var(--line, #e2e8f0)', fontWeight: 700,
            padding: '14px 26px', borderRadius: 10, fontSize: 15, cursor: 'pointer',
          }}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
