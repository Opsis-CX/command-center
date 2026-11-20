// 2026-11-16: passes portalRole (rm/gm → manager sidebar) and brandDash (RPC qa_brand_dash) for the new Dashboard page.
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
// Phone setup (2026-11-10): clients build their own inbound lines + outbound campaigns
import PhoneSetup from './PhoneSetup'
import CsrPhone from './CsrPhone'
// Call trends, coaching clips, intraday staffing and the call flow builder (2026-11-15)
import CxTrends from '../components/CxTrends'
import { CoachingDesk, CoachingInbox } from '../components/Coaching'
import WfmIntraday from '../components/WfmIntraday'
import CallFlowBuilder from '../components/CallFlowBuilder'
import Softphone from '../components/Softphone'
import { VoiceProvider } from '../lib/voice'
import { loadAccounts, switchAccount } from '../components/AccountSwitcher'

// Portal palette for the mounted Command Center pages (they read these CSS variables).
const PORTAL_THEME = {
  '--accent': '#2F7D5B', '--accent-bg': '#E6F0EA', '--accent-ink': '#FFFFFF', '--ink': '#1C2421', '--ink-soft': '#5F6763',
  '--line': '#E8E4DC', '--line-soft': '#F1EEE8', '--surface': '#FFFFFF', '--canvas': '#F5F3EE', '--bg-soft': '#F7F5F0',
  '--passed': '#2F7D5B', '--passed-bg': '#E6F0EA', '--failed': '#A8441A', '--failed-bg': '#FCEBDD',
  fontFamily: 'Montserrat, Arial, sans-serif', color: 'light-dark(#1C2421, #e8eef0)',
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
  // portal_role of the signed-in login (rm / gm get a short, manager-only sidebar — Becky 11/16)
  const [prole, setProle] = useState(null)
  const [ploc, setPloc] = useState(null)
  const [profRole, setProfRole] = useState(null)
  // "View as" Admin / RM / GM / CSR — your own +rm/+gm/+csr logins (2026-11-10)
  const [accounts, setAccounts] = useState(null)
  useEffect(() => { let on = true; loadAccounts().then(a => { if (on) setAccounts(a) }); return () => { on = false } }, [])
  useEffect(() => {
    let active = true
    if (csrSelf) { setSup(false); return }
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id
      if (!uid) { if (active) setSup(false); return }
      supabase.from('profiles').select('role, portal_role, portal_location').eq('id', uid).maybeSingle()
        .then(({ data: p }) => { if (active) setProle(String(p?.portal_role || '').toLowerCase() || null); if (active) setPloc(p?.portal_location || null); if (active) setProfRole(String(p?.role || '').toLowerCase() || null); if (active) setSup(!!p && (String(p.role || '').toLowerCase() !== 'client' || ['admin', 'manager', 'rm', 'gm'].includes(p.portal_role || 'manager'))) })
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
    if (!me || !ref.current || sup === null || accounts === null) return
    const destroy = mountOpsisQA(ref.current, {
      supervisor: !!sup,
      portalRole: prole,
      portalLocation: ploc,
      // Coach view lands first for Opsis coaches (staff who aren't app admins) — Becky 11/19
      coachDefault: !csrSelf && !!(staff || me.staff) && !['admin', 'owner'].includes(profRole || ''),
      accounts,
      onSwitchAccount: switchAccount,
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
      // Brand Dashboard (2026-11-16): reads RPC qa_brand_dash with the signed-in user's own session, so the database
      // applies the login's access and brand lock. CSR logins don't get the page.
      brandDash: csrSelf ? null : async ({ start, end, brands, locations }) => {
        const { data, error } = await supabase.rpc('qa_brand_dash', { p_client: clientId || me.client, p_start: start, p_end: end, p_brands: brands && brands.length ? brands : null, p_locations: locations && locations.length ? locations : null })
        if (error) { const e = new Error(error.message || 'Could not load the dashboard.'); e.status = 400; throw e }
        return data
      },
      // Coaching Notes on the CSR page (Becky 11/19): RPC qa_csr_coaching_notes with the user's own session (brand lock applies).
      csrNotes: csrSelf ? null : async (agent) => {
        const { data, error } = await supabase.rpc('qa_csr_coaching_notes', { p_client: clientId || me.client, p_agent: agent })
        if (error) { const e = new Error(error.message || 'Could not load coaching notes.'); e.status = 400; throw e }
        return data || []
      },
      // Add / edit / delete coaching notes (Becky 11/19): Opsis staff only, enforced in the RPCs.
      csrNoteSave: csrSelf ? null : async ({ agent, id, date, attended, ask_rate, title, note }) => {
        const { data, error } = await supabase.rpc('qa_csr_note_save', { p_client: clientId || me.client, p_agent: agent, p_id: id, p_date: date, p_attended: attended, p_ask_rate: ask_rate, p_title: title, p_note: note })
        if (error) throw new Error(error.message || 'Could not save the note.')
        return data
      },
      csrNoteDelete: csrSelf ? null : async (id) => {
        const { error } = await supabase.rpc('qa_csr_note_delete', { p_client: clientId || me.client, p_id: id })
        if (error) throw new Error(error.message || 'Could not delete the note.')
      },
      // Coach view (Becky 11/19): coaching history per CSR for the signed-in login's scope.
      coachHistory: csrSelf ? null : async () => {
        const { data, error } = await supabase.rpc('qa_coach_history', { p_client: clientId || me.client })
        if (error) throw new Error(error.message || 'Could not load coaching history.')
        return data || []
      },
      // Coaching Hub location filter (Becky 11/18): which location each CSR works at (RPC qa_csr_locations, same access + brand lock).
      csrLocations: csrSelf ? null : async () => {
        const { data, error } = await supabase.rpc('qa_csr_locations', { p_client: clientId || me.client })
        if (error) { const e = new Error(error.message || 'Could not load CSR locations.'); e.status = 400; throw e }
        return data
      },
      // Booking lead time (Rob 11/17): RPC qa_lead_time_report with the user's own session (same access + brand lock).
      leadTime: csrSelf ? null : async ({ start, end, brands }) => {
        const { data, error } = await supabase.rpc('qa_lead_time_report', { p_client: clientId || me.client, p_start: start, p_end: end, p_brands: brands && brands.length ? brands : null })
        if (error) { const e = new Error(error.message || 'Could not load booking lead time.'); e.status = 400; throw e }
        return data
      },
      // Workforce (Erlang C) and AI Speed to Lead, scoped to this login's client through opsis-portal-ops.
      mountExt: (kind, el) => {
        const root = createRoot(el)
        const scoped = (b) => invoke(clientId ? { ...b, client_id: clientId } : b)
        root.render(
          <div style={PORTAL_THEME}>
            {kind === 'wallboard' ? <SupervisorWallboard clientId={clientId} />
              : kind === 'phonesetup' ? <PhoneSetup clientId={clientId} />
              : kind === 'trends' ? <CxTrends clientId={clientId} />
              : kind === 'coachclips' ? <CoachingDesk />
              : kind === 'mycoach' ? <CoachingInbox />
              : kind === 'intraday' ? <WfmIntraday clientId={clientId} />
              : kind === 'callflow' ? <CallFlowBuilder clientId={clientId} />
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
  }, [me, sup, accounts]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'light-dark(#F5F3EE, #1b2327)', fontFamily: 'Montserrat, Arial, sans-serif', padding: 16 }}>
        <div style={{ background: 'light-dark(#fff, #161d21)', border: '1px solid light-dark(#E8E4DC, #2a3439)', borderRadius: 14, padding: 24, maxWidth: 420, color: 'light-dark(#1C2421, #e8eef0)' }}>
          <b>{csrSelf ? 'We couldn’t open your Coaching Hub.' : 'We couldn’t open your call quality portal.'}</b>
          <p style={{ fontSize: 13, color: 'light-dark(#5F6763, #b3c1c7)', lineHeight: 1.5 }}>{err} If this keeps happening, contact the Opsis CX Support team.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.location.reload()} style={{ border: '1px solid #14302A', background: '#14302A', color: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }}>Try again</button>
            {onClassic && <button onClick={onClassic} style={{ border: '1px solid light-dark(#E1DCD2, #2a3439)', background: 'light-dark(#fff, #161d21)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }}>Classic view</button>}
            {onSignOut && <button onClick={onSignOut} style={{ border: '1px solid light-dark(#E1DCD2, #2a3439)', background: 'light-dark(#fff, #161d21)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }}>Sign out</button>}
          </div>
        </div>
      </div>
    )
  }
  if (!me) return <div className="loading-screen">Loading…</div>
  return <div ref={ref} />
}
