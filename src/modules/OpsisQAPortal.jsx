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
// Coaching Hub (2026-10-21): actions starting with "hub" go to the edge function opsis-coaching-hub.
// Calibration (2026-10-22): actions starting with "calib" go to the edge function opsis-qa-calibration;
// "qaextras" (first contact resolution + sentiment on the Overview) goes to opsis-qa-insights.
// csrSelf = a CSR login: the portal shows only their own Coaching Hub (Home / Ask my coach / My wins).
// Workforce + AI Speed to Lead (2026-11-09): the same Command Center pages, mounted inside the portal shell
// (mountExt) in portal colors. Their data actions ("pwfm", "ps2l") go to the edge function opsis-portal-ops,
// which scopes everything to the login's client and brand.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from '../lib/supabase'
import CsrScorecard from './CsrScorecard'
import { mountOpsisQA } from './opsisQaApp'
import Workforce, { portalWfmData } from './Workforce'
import AiSpeedToLead, { portalS2lData } from './AiSpeedToLead'
// Supervisor tools (2026-11-10): Wallboard + the phone for RMs, GMs, admins and Opsis staff.
import { MemoryRouter } from 'react-router-dom'
import SupervisorWallboard from './SupervisorWallboard'
import CsrPhone from './CsrPhone'
import Softphone from '../components/Softphone'
import { VoiceProvider } from '../lib/voice'

// Portal palette for the mounted Command Center pages (they read these CSS variables).
const PORTAL_THEME = {
  '--accent': '#2F7D5B', '--accent-bg': '#E6F0EA', '--accent-ink': '#FFFFFF', '--ink': '#1C2421', '--ink-soft': '#5F6763',
  '--line': '#E8E4DC', '--line-soft': '#F1EEE8', '--surface': '#FFFFFF', '--canvas': '#F5F3EE', '--bg-soft': '#F7F5F0',
  '--passed': '#2F7D5B', '--passed-bg': '#E6F0EA', '--failed': '#A8441A', '--failed-bg': '#FCEBDD',
  fontFamily: 'Montserrat, Arial, sans-serif', color: '#1C2421',
}

async function invoke(body) {
  // Reporting (call export + scorecard reports) is served by its own read-only function.
  const fn = (body?.action === 'pwfm' || body?.action === 'ps2l') ? 'opsis-portal-ops' : body?.action === 'qaextras' ? 'opsis-qa-insights' : String(body?.action || '').startsWith('calib') ? 'opsis-qa-calibration' : String(body?.action || '').startsWith('hub') ? 'opsis-coaching-hub' : ['export', 'scorecards', 'money', 'excused', 'billing', 'jobvalues', 'invoices', 'bucketcalls', 'callchat', 'scorereq', 'xfercalls', 'factcalls', 'rubric', 'teaminvite', 'calledit', 'callmetrics'].includes(body?.action) ? 'opsis-qa-reports' : 'opsis-qa-portal'
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    let msg = 'Something went wrong loading that.'
    const status = error.context?.status
    try { const j = await error.context.json(); if (j?.error) msg = j.error } catch { /* not JSON */ }
    const e = new Error(msg); e.status = status; throw e
  }
  return data
}

export default function OpsisQAPortal({ clientId = null, logo, hasCsrs = false, csrMode = 'manager', onSignOut, onClassic, staff = false, csrSelf = false }) {
  const ref = useRef(null)
  const [me, setMe] = useState(null)
  const [err, setErr] = useState('')
  // portal_role rm / gm / admin / manager (client logins) or Opsis staff → supervisor tools
  const [sup, setSup] = useState(null)
  useEffect(() => {
    let active = true
    if (csrSelf) { setSup(false); return }
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id
      if (!uid) { if (active) setSup(false); return }
      supabase.from('profiles').select('role, portal_role').eq('id', uid).maybeSingle()
        .then(({ data: p }) => { if (active) setSup(!!p && (String(p.role || '').toLowerCase() !== 'client' || ['admin', 'manager', 'rm', 'gm'].includes(p.portal_role || 'manager'))) })
        .catch(() => { if (active) setSup(false) })
    })
    return () => { active = false }
  }, [csrSelf])

  useEffect(() => {
    let active = true
    invoke(csrSelf ? { action: 'hubme' } : clientId ? { action: 'me', client_id: clientId } : { action: 'me' })
      .then((m) => { if (active) setMe(m) })
      .catch((e) => { if (active) setErr(e.message || 'Could not load your account.') })
    return () => { active = false }
  }, [clientId])

  useEffect(() => {
    if (!me || !ref.current || sup === null) return
    const destroy = mountOpsisQA(ref.current, {
      supervisor: !!sup,
      invoke,
      clientId,
      role: csrSelf ? 'csr' : me.role,
      brandLock: csrSelf ? me.brand : me.brand_lock,
      clientName: me.client_name,
      csrSelf,
      userFirst: me.first || (me.name || '').split(' ')[0],
      staff: staff || me.staff,
      userName: me.name,
      email: me.email,
      logo: logo || (csrSelf ? me.logo || undefined : undefined),
      hasCsrs,
      phone: !csrSelf && me.client === 'c7c50cda-92a6-4665-baa3-3e207f853326',
      onSignOut,
      onClassic,
      // Workforce (Erlang C) and AI Speed to Lead, scoped to this login's client through opsis-portal-ops.
      mountExt: (kind, el) => {
        const root = createRoot(el)
        const scoped = (b) => invoke(clientId ? { ...b, client_id: clientId } : b)
        root.render(
          <div style={PORTAL_THEME}>
            {kind === 'wallboard' ? <SupervisorWallboard clientId={clientId} />
              : kind === 'myphone' ? (
                <MemoryRouter>
                  <VoiceProvider canCallPeople={false} canDialNumbers={false}><CsrPhone accent="#14302A" /><Softphone /></VoiceProvider>
                </MemoryRouter>)
              : kind === 'wfm' ? <Workforce data={portalWfmData(scoped)} portal /> : <AiSpeedToLead data={portalS2lData(scoped)} portal />}
          </div>
        )
        return () => setTimeout(() => root.unmount(), 0)
      },
      mountCsr: (el) => {
        const root = createRoot(el)
        root.render(<CsrScorecard supabase={supabase} mode={csrMode} accent="#14302A" />)
        return () => setTimeout(() => root.unmount(), 0)
      },
    })
    return destroy
  }, [me, sup]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F3EE', fontFamily: 'Montserrat, Arial, sans-serif', padding: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #E8E4DC', borderRadius: 14, padding: 24, maxWidth: 420, color: '#1C2421' }}>
          <b>{csrSelf ? 'We couldn’t open your Coaching Hub.' : 'We couldn’t open your call quality portal.'}</b>
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
