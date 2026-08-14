import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// MOCK CALL SCHEDULER
//
// Two ways in, one component:
//  1. embedded  — the "Schedule my mock call" tab inside the new-hire
//     onboarding shell (App.jsx → TraineePortal). This is the normal path:
//     candidates already have a Command Center login by the mock-call stage,
//     so they book here the same way they do their certification. The
//     application is resolved from the signed-in user via
//     get_my_mock_application() — no id needed in a link.
//  2. public /mock-call/:appId — kept as a fallback for anyone who somehow
//     has no login. Pass appId explicitly.
//
// Availability comes straight from the mock-call provider's (Breanna's)
// claimed intervals on the Schedule board — no accepted interval → no
// availability. A Recall notetaker is attached automatically on booking.
// Backend: get_my_mock_application / get_mock_context / get_mock_availability
// / book_mock_call.
// ============================================================

const SLOT_MIN = 30

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function fmtDate(ds) {
  if (!ds) return ''
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
function todayET() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const pageWrap = { minHeight: '100vh', background: '#f3f4f6', display: 'flex', justifyContent: 'center', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }
const cardW = { width: '100%', maxWidth: 620 }
const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }
const slotBtn = { padding: '8px 12px', margin: '0 8px 8px 0', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }

export default function MockCallScheduler({ appId: appIdProp, embedded = false }) {
  const [ctx, setCtx] = useState(null)      // {ok, applicant_name, provider_name, status}
  const [appId, setAppId] = useState(appIdProp || null)
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(null)   // {date, start}
  const [err, setErr] = useState('')

  // Shell — full page when standalone, plain block when it's a portal tab.
  const Shell = useCallback(({ children }) => (
    embedded ? <div>{children}</div> : <div style={pageWrap}><div style={cardW}>{children}</div></div>
  ), [embedded])

  const loadSlots = useCallback(async (id) => {
    if (!id) return
    const to = new Date(); to.setDate(to.getDate() + 21)
    const toStr = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`
    const { data } = await supabase.rpc('get_mock_availability', { p_application_id: id, p_from: todayET(), p_to: toStr, p_slot_min: SLOT_MIN })
    setSlots(data || [])
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      let id = appIdProp || null
      let c = null
      if (id) {
        // public link — look the application up by id
        const { data } = await supabase.rpc('get_mock_context', { p_application_id: id })
        c = Array.isArray(data) ? data[0] : data
      } else {
        // signed in — resolve the candidate's own application
        const { data } = await supabase.rpc('get_my_mock_application')
        c = data || { ok: false }
        id = c?.application_id || null
        // already booked? show the confirmation rather than the picker
        if (c?.booked?.date) setConfirmed({ date: c.booked.date, start: c.booked.start, meeting_url: c.booked.meeting_url })
      }
      if (!active) return
      setCtx(c || { ok: false })
      setAppId(id)
      if (c?.ok && id && !c?.booked?.date) await loadSlots(id)
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [appIdProp, loadSlots])

  const byDate = useMemo(() => {
    const g = {}
    for (const s of slots) (g[s.session_date] ||= []).push(s)
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
  }, [slots])

  async function book(s) {
    if (busy || !appId) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('book_mock_call', { p_application_id: appId, p_date: s.session_date, p_start: s.start_time, p_slot_min: SLOT_MIN })
    setBusy(false)
    if (error) { setErr(error.message); loadSlots(appId); return }
    setConfirmed({ date: s.session_date, start: s.start_time })
  }

  if (loading) return <Shell><div style={card}>Loading…</div></Shell>

  if (!ctx?.ok) {
    return (
      <Shell>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>Mock call scheduling</h2>
          <p style={{ color: '#6b7280' }}>
            There’s no mock call to book right now{ctx?.status ? ` (status: ${ctx.status})` : ''}. If you believe this is a mistake,
            email <a href="mailto:onboarding@opsiscx.com" style={{ color: '#1d4ed8', fontWeight: 600 }}>onboarding@opsiscx.com</a> and we’ll help you get scheduled.
          </p>
        </div>
      </Shell>
    )
  }

  if (confirmed) {
    return (
      <Shell>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>You’re booked! 🎉</h2>
          <p style={{ fontSize: 16 }}>
            Your mock call with <b>{ctx.provider_name}</b> is set for<br />
            <b>{fmtDate(confirmed.date)} at {fmtTime(confirmed.start)} (Eastern)</b>.
          </p>
          {confirmed.meeting_url && (
            <p style={{ margin: '16px 0' }}>
              <a href={confirmed.meeting_url} target="_blank" rel="noreferrer" style={{ background: '#0077B6', color: '#fff', textDecoration: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 700, display: 'inline-block' }}>Join the call</a>
            </p>
          )}
          <p style={{ color: '#6b7280', marginBottom: 0 }}>
            You’ll also receive the video link by email. The session is recorded so your coach can give you feedback.
            Need to change it? Email <a href="mailto:onboarding@opsiscx.com" style={{ color: '#1d4ed8', fontWeight: 600 }}>onboarding@opsiscx.com</a>.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div style={card}>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>Schedule your mock call</h2>
        <p style={{ color: '#6b7280', marginTop: 0 }}>
          Hi {ctx.applicant_name || 'there'} — pick a time below to meet with <b>{ctx.provider_name}</b> for your mock call.
          All times are Eastern. The session is recorded for coaching feedback.
        </p>
        {err && <div style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div>}
      </div>

      {byDate.length === 0 ? (
        <div style={card}>
          <b>No open times right now.</b>
          <p style={{ color: '#6b7280', marginBottom: 0 }}>
            {ctx.provider_name} hasn’t opened any mock-call times yet, or they’re all taken. Please check back a little later.
          </p>
        </div>
      ) : byDate.map(([date, list]) => (
        <div key={date} style={card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{fmtDate(date)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {list.map(s => (
              <button key={s.start_time} style={slotBtn} disabled={busy} onClick={() => book(s)}>
                {fmtTime(s.start_time)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Shell>
  )
}
