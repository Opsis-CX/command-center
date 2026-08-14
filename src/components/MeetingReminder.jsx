import React, { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// MEETING REMINDER — a full-screen alert you can't scroll past.
//
// Fires twice for every meeting: at T-10 and again at T-2.
// Sources come from my_upcoming_events() — in-app calendar events (owner or
// invitee), the user's synced Google calendar, and coaching / mock calls on
// either side of the table. Timezone maths is done server-side.
//
// Dismissals are remembered per (event, threshold) in localStorage, so closing
// the 10-minute warning doesn't stop the 2-minute one, and a page refresh two
// minutes later doesn't re-open something you already dealt with.
// ============================================================

const POLL_MS = 30_000
const THRESHOLDS = [
  // fire when minutes_until is inside the window; the 2-minute one wins
  { key: '2', label: '2 minutes', min: -2, max: 2.5, urgent: true },
  { key: '10', label: '10 minutes', min: 2.5, max: 10.5, urgent: false },
]
const DISMISS_KEY = 'cc_meeting_reminders_dismissed'

function loadDismissed() {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}')
    // drop anything older than a day so this can't grow forever
    const cutoff = Date.now() - 864e5
    const kept = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v > cutoff) kept[k] = v
    return kept
  } catch { return {} }
}
function saveDismissed(map) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(map)) } catch { /* private mode */ }
}

function fmtClock(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    })
  } catch { return '' }
}

const SOURCE_LABEL = {
  coaching: '🎯 Coaching',
  mock_call: '🎧 Mock call',
  google: '📅 Calendar',
  calendar: '📅 Calendar',
}

export default function MeetingReminder() {
  const [due, setDue] = useState(null)          // { event, threshold }
  const dismissedRef = useRef(loadDismissed())

  const check = useCallback(async () => {
    // Don't stack a new alert on top of one still on screen.
    if (due) return
    const { data, error } = await supabase.rpc('my_upcoming_events', { p_within_min: 11 })
    if (error || !Array.isArray(data)) return
    for (const ev of data) {
      const mins = Number(ev.minutes_until)
      if (!isFinite(mins)) continue
      const t = THRESHOLDS.find(x => mins > x.min && mins <= x.max)
      if (!t) continue
      const key = `${ev.id}|${t.key}`
      if (dismissedRef.current[key]) continue
      setDue({ event: ev, threshold: t })
      return
    }
  }, [due])

  useEffect(() => {
    check()
    const id = setInterval(check, POLL_MS)
    // catch up immediately when the laptop wakes or the tab comes back
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [check])

  function dismiss() {
    if (!due) return
    const key = `${due.event.id}|${due.threshold.key}`
    dismissedRef.current = { ...dismissedRef.current, [key]: Date.now() }
    saveDismissed(dismissedRef.current)
    setDue(null)
  }

  // Esc closes it — it's a big modal, not a hostage situation.
  useEffect(() => {
    if (!due) return
    const onKey = (e) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [due]) // eslint-disable-line

  if (!due) return null
  const { event, threshold } = due
  const urgent = threshold.urgent
  const accent = urgent ? '#DC2626' : '#0077B6'
  const mins = Math.max(0, Math.round(Number(event.minutes_until)))

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`Meeting starting in ${threshold.label}`}
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
          {SOURCE_LABEL[event.source] || '📅 Calendar'}
        </div>

        <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1.05, margin: '14px 0 2px', color: accent }}>
          {mins <= 0 ? 'Starting now' : `${mins} min`}
        </div>
        {mins > 0 && (
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-soft, #64748b)' }}>
            until this starts
          </div>
        )}

        <div style={{ fontSize: 23, fontWeight: 800, margin: '20px 0 6px', lineHeight: 1.25 }}>
          {event.title || 'Meeting'}
        </div>
        <div style={{ fontSize: 15, color: 'var(--ink-soft, #64748b)', marginBottom: 26 }}>
          {fmtClock(event.starts_at)} Eastern
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {event.meeting_url && (
            <a href={event.meeting_url} target="_blank" rel="noreferrer" onClick={dismiss}
              style={{
                background: accent, color: '#fff', textDecoration: 'none', fontWeight: 800,
                padding: '14px 30px', borderRadius: 10, fontSize: 16,
              }}>
              Join now
            </a>
          )}
          <button onClick={dismiss} style={{
            background: 'transparent', color: 'var(--ink-soft, #64748b)',
            border: '1px solid var(--line, #e2e8f0)', fontWeight: 700,
            padding: '14px 26px', borderRadius: 10, fontSize: 15, cursor: 'pointer',
          }}>
            Dismiss
          </button>
        </div>

        {!urgent && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)', marginTop: 16 }}>
            You'll get one more nudge 2 minutes before it starts.
          </div>
        )}
      </div>
    </div>
  )
}
