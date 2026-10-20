// Opsis QA client portal (2026-10-20) — the new look for garageco.opsiscx.com.
// Renders the vanilla app in ./opsisQaApp.js (same UI as the Opsis QA preview Rob saw) and
// feeds it real data through the authenticated edge function `opsis-qa-portal`, which scopes
// every call to the signed-in login's client and brand (portal_brand) and enforces the portal
// role (profiles.portal_role: admin / manager / viewer).
//
// Who sees it:
//   - client logins, when their client has clients.portal_v2 = true (ClientPortal in App.jsx)
//   - Opsis admins/QA staff at /opsis-qa (admin preview — they act as an account admin)
// The CSR scorecards page mounts the existing <CsrScorecard> inside the new shell.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from '../lib/supabase'
import CsrScorecard from './CsrScorecard'
import { mountOpsisQA } from './opsisQaApp'

async function invoke(body) {
  // Reporting (call export + scorecard reports) is served by its own read-only function.
  const fn = ['export', 'scorecards', 'money', 'excused', 'billing', 'jobvalues', 'invoices'].includes(body?.action) ? 'opsis-qa-reports' : 'opsis-qa-portal'
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    let msg = 'Something went wrong loading that.'
    const status = error.context?.status
    try { const j = await error.context.json(); if (j?.error) msg = j.error } catch { /* not JSON */ }
    const e = new Error(msg); e.status = status; throw e
  }
  return data
}

export default function OpsisQAPortal({ clientId = null, logo, hasCsrs = false, csrMode = 'manager', onSignOut, onClassic, staff = false }) {
  const ref = useRef(null)
  const [me, setMe] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let active = true
    invoke(clientId ? { action: 'me', client_id: clientId } : { action: 'me' })
      .then((m) => { if (active) setMe(m) })
      .catch((e) => { if (active) setErr(e.message || 'Could not load your account.') })
    return () => { active = false }
  }, [clientId])

  useEffect(() => {
    if (!me || !ref.current) return
    const destroy = mountOpsisQA(ref.current, {
      invoke,
      clientId,
      role: me.role,
      brandLock: me.brand_lock,
      clientName: me.client_name,
      staff: staff || me.staff,
      userName: me.name,
      email: me.email,
      logo,
      hasCsrs,
      phone: me.client === 'c7c50cda-92a6-4665-baa3-3e207f853326',
      onSignOut,
      onClassic,
      mountCsr: (el) => {
        const root = createRoot(el)
        root.render(<CsrScorecard supabase={supabase} mode={csrMode} accent="#14302A" />)
        return () => setTimeout(() => root.unmount(), 0)
      },
    })
    return destroy
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F3EE', fontFamily: 'Montserrat, Arial, sans-serif', padding: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #E8E4DC', borderRadius: 14, padding: 24, maxWidth: 420, color: '#1C2421' }}>
          <b>We couldn’t open your call quality portal.</b>
          <p style={{ fontSize: 13, color: '#5F6763', lineHeight: 1.5 }}>{err} If this keeps happening, contact the Opsis CX Support team.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.location.reload()} style={{ border: '1px solid #14302A', background: '#14302A', color: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }}>Try again</button>
            {onClassic && <button onClick={onClassic} style={{ border: '1px solid #E1DCD2', background: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }}>Classic view</button>}
            {onSignOut && <button onClick={onSignOut} style={{ border: '1px solid #E1DCD2', background: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }}>Sign out</button>}
          </div>
        </div>
      </div>
    )
  }
  if (!me) return <div className="loading-screen">Loading…</div>
  return <div ref={ref} />
}
