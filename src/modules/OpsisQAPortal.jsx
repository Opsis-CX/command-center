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
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import CsrScorecard from './CsrScorecard'
import { mountOpsisQA } from './opsisQaApp'
import Workforce, { portalWfmData } from './Workforce'
import AiSpeedToLead, { portalS2lData } from './AiSpeedToLead'
// Supervisor tools (2026-11-10): Wallboard + the phone for RMs, GMs, admins and Opsis staff.
import { MemoryRouter } from 'react-router-dom'
import SupervisorDashboard from './SupervisorDashboard'
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
import { VoiceProvider, RingBounce } from '../lib/voice'
import { loadAccounts, switchAccount } from '../components/AccountSwitcher'
// Self-serve setup (Becky 11/23): a company with no scoring checklist yet gets the setup interview first.
import QaSetupInterview from '../components/QaSetupInterview'

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
  // { needs_setup, can_edit, company } from RPC qa_setup_status; null while checking
  const [setup, setSetup] = useState(null)
  useEffect(() => { let on = true; loadAccounts().then(a => { if (on) setAccounts(a) }); return () => { on = false } }, [])
  useEffect(() => {
    let active = true
    if (csrSelf) { setSup(false); return }
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id
      if (!uid) { if (active) setSup(false); return }
      supabase.from('profiles').select('role, portal_role, portal_location').eq('id', uid).maybeSingle()
        .then(({ data: p }) => { if (active) setProle(String(p?.portal_role || '').toLowerCase() || null); if (active) setPloc(p?.portal_location || null); if (active) setProfRole(String(p?.role || '').toLowerCase() || null); if (active) setSup(!!p && (String(p.role || '').toLowerCase() !== 'client' || ['admin', 'manager', 'rm', 'gm', 'coach'].includes(p.portal_role || 'manager'))) })
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
    let active = true
    if (!me || csrSelf) { if (csrSelf) setSetup({ needs_setup: false }); return }
    const cid = clientId || me.client
    if (!cid) { setSetup({ needs_setup: false }); return }
    supabase.rpc('qa_setup_status', { p_client: cid })
      .then(({ data, error }) => { if (active) setSetup(error ? { needs_setup: false } : (data || { needs_setup: false })) })
    return () => { active = false }
  }, [me, clientId, csrSelf])
  const needsSetup = !!(setup?.needs_setup && setup?.can_edit)

  // The phone lives for the whole portal visit, not just the Phone page (Becky 11/22): a Ready CSR / RM / GM
  // stays Ready and keeps ringing whatever page they click to, and a ringing call jumps them to the Phone page
  // (guided call screen + script). CsrPhone renders into phoneEl, which is parked off-screen and moved into the
  // Phone page while it's open, so the phone never unmounts.
  const phoneRef = useRef(null)
  useEffect(() => {
    // No phone on the setup interview (Becky 11/23): it mounts once setup is done.
    if (!sup || csrSelf || setup === null || needsSetup) return
    const phoneEl = document.createElement('div')
    Object.entries(PORTAL_THEME).forEach(([k, v]) => { if (k.startsWith('--')) phoneEl.style.setProperty(k, v); else phoneEl.style[k] = v })
    const parking = document.createElement('div'); parking.style.display = 'none'; parking.appendChild(phoneEl)
    const host = document.createElement('div')
    document.body.appendChild(parking); document.body.appendChild(host)
    const toPhone = () => {
      if (/(^#|&)v=myphone(&|$)/.test(location.hash)) return
      const rest = location.hash.replace(/^#/, '').split('&').filter(p => p && !p.startsWith('v='))
      location.hash = ['v=myphone', ...rest].join('&')
    }
    const root = createRoot(host)
    root.render(
      <div style={PORTAL_THEME}>
        <MemoryRouter>
          <VoiceProvider canCallPeople={false} canDialNumbers={false}>
            {createPortal(<CsrPhone accent="#14302A" />, phoneEl)}
            <Softphone />
            <RingBounce onRing={toPhone} />
          </VoiceProvider>
        </MemoryRouter>
      </div>
    )
    phoneRef.current = { show: (el) => el.appendChild(phoneEl), park: () => parking.appendChild(phoneEl) }
    return () => { phoneRef.current = null; setTimeout(() => { root.unmount(); parking.remove(); host.remove() }, 0) }
  }, [sup, csrSelf, setup === null, needsSetup]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!me || !ref.current || sup === null || accounts === null || setup === null || needsSetup) return
    const destroy = mountOpsisQA(ref.current, {
      supervisor: !!sup,
      portalRole: prole,
      portalLocation: ploc,
      // Coach mode is off by default for everyone (Becky 11/19: Kerri & Chelsea are testing — don't change what they see).
      coachDefault: false,
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
      // Tasks (Becky 11/20): customer follow-ups with an owner and an outcome. cx_task_* RPCs with the user's own session.
      tasks: csrSelf ? null : (() => {
        const cid = clientId || me.client
        const rpc = async (fn, args, msg) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw new Error(error.message || msg); return data }
        return {
          list: ({ view, brands, locations, mine }) => rpc('cx_task_list', { p_client: cid, p_view: view || 'open', p_brands: brands && brands.length ? brands : null, p_locations: locations && locations.length ? locations : null, p_mine: !!mine }, 'Could not load tasks.'),
          set: ({ id, status, outcome, assign, unassign }) => rpc('cx_task_set', { p_id: id, p_status: status || null, p_outcome: outcome || null, p_assign: assign || null, p_unassign: !!unassign }, 'Could not save the task.'),
          settings: () => rpc('cx_task_settings', { p_client: cid }, 'Could not load task settings.'),
          ruleSet: ({ brand, location, kind, assignee }) => rpc('cx_task_rule_set', { p_client: cid, p_brand: brand, p_location: location || null, p_kind: kind || null, p_assignee: assignee || null }, 'Could not save.'),
          dueSet: ({ kind, minutes, business_hours }) => rpc('cx_task_due_set', { p_client: cid, p_kind: kind, p_minutes: minutes, p_business_hours: business_hours }, 'Could not save.'),
        }
      })(),
      // Team & access (Becky 11/20): real roles admin / rm / gm / coach / viewer, read and set with the user's own session.
      teamList: csrSelf ? null : async () => {
        const { data, error } = await supabase.rpc('qa_team_list', { p_client: clientId || me.client })
        if (error) throw new Error(error.message || 'Could not load the team.')
        return data
      },
      teamSet: csrSelf ? null : async ({ id, role, brand, location, brands }) => {
        const { data, error } = await supabase.rpc('qa_team_set', { p_client: clientId || me.client, p_id: id, p_role: role, p_brand: brand || null, p_location: location || null, p_brands: brands && brands.length ? brands : null })
        if (error) throw new Error(error.message || 'Could not change access.')
        return data
      },
      // Multi-brand coach (Becky 11/20): the brands this login may switch between, and the switch itself.
      myBrands: csrSelf ? null : async () => {
        const { data, error } = await supabase.rpc('my_portal_brands')
        if (error) return null
        return data
      },
      pickBrand: csrSelf ? null : async (brand) => {
        const { error } = await supabase.rpc('coach_pick_brand', { p_brand: brand })
        if (error) throw new Error(error.message || 'Could not switch brands.')
      },
      csrNoteDelete: csrSelf ? null : async (id) => {
        const { error } = await supabase.rpc('qa_csr_note_delete', { p_client: clientId || me.client, p_id: id })
        if (error) throw new Error(error.message || 'Could not delete the note.')
      },
      // Business reviews (Becky 11/19): WBR/MBR/QBR/Annual + Scorecard/Booking/Containment. Admins + Opsis staff (checked in the RPCs).
      bizReview: csrSelf ? null : async ({ start, end, grain, trend, brands, prevStart, prevEnd }) => {
        const { data, error } = await supabase.rpc('qa_biz_review', { p_client: clientId || me.client, p_start: start, p_end: end, p_grain: grain, p_trend_start: trend, p_brands: brands && brands.length ? brands : null, p_prev_start: prevStart || null, p_prev_end: prevEnd || null })
        if (error) { const e = new Error(error.message || 'Could not load the review.'); e.status = 400; throw e }
        return data
      },
      bizDetail: csrSelf ? null : async ({ start, end, trend, brands }) => {
        const { data, error } = await supabase.rpc('qa_biz_detail', { p_client: clientId || me.client, p_start: start, p_end: end, p_trend_start: trend, p_brands: brands && brands.length ? brands : null })
        if (error) { const e = new Error(error.message || 'Could not load the review details.'); e.status = 400; throw e }
        return data
      },
      // AI CSR dashboard (Becky 11/19): live AI CSR phone calls for the range + previous period, brand lock applied in the RPC.
      recepDash: csrSelf ? null : async ({ start, end, brands }) => {
        const { data, error } = await supabase.rpc('qa_recep_dash', { p_client: clientId || me.client, p_start: start, p_end: end, p_brands: brands && brands.length ? brands : null })
        if (error) { const e = new Error(error.message || 'Could not load the AI CSR dashboard.'); e.status = 400; throw e }
        return data
      },
      // Recapture (Becky 11/16, rebuilt 11/23): per-client on/off switch + the "recaptured" line under the Overview numbers.
      recapSettings: csrSelf ? null : async () => {
        const { data, error } = await supabase.rpc('qa_client_settings_get', { p_client: clientId || me.client })
        if (error) throw new Error(error.message || 'Could not load the recapture setting.')
        return data
      },
      recapSave: csrSelf ? null : async ({ on, days }) => {
        const { data, error } = await supabase.rpc('qa_client_settings_set', { p_client: clientId || me.client, p_recapture: !!on, p_days: days || 7 })
        if (error) throw new Error(error.message || 'Could not save the recapture setting.')
        return data
      },
      recapture: csrSelf ? null : async ({ start, end, brands }) => {
        const { data, error } = await supabase.rpc('qa_recapture', { p_client: clientId || me.client, p_start: start, p_end: end, p_brands: brands && brands.length ? brands : null })
        if (error) throw new Error(error.message || 'Could not load recapture.')
        return data
      },
      // Connect your calls (Becky 11/23): upload recordings or save a phone system API key (stored in Vault).
      callSources: csrSelf ? null : async () => {
        const { data, error } = await supabase.rpc('qa_sources_list', { p_client: clientId || me.client })
        if (error) throw new Error(error.message || 'Could not load your call connections.')
        return data
      },
      callSourceSave: csrSelf ? null : async ({ provider, config, secret, label }) => {
        const { data, error } = await supabase.rpc('qa_source_save', { p_client: clientId || me.client, p_provider: provider, p_config: config || {}, p_secret: secret, p_label: label || null })
        if (error) throw new Error(error.message || 'Could not save that connection.')
        return data
      },
      callSourceRemove: csrSelf ? null : async (id) => {
        const { error } = await supabase.rpc('qa_source_remove', { p_client: clientId || me.client, p_id: id })
        if (error) throw new Error(error.message || 'Could not disconnect.')
      },
      // Getting-started checklist (Becky 11/23)
      onboarding: csrSelf ? null : async () => {
        const { data, error } = await supabase.rpc('qa_onboarding_status', { p_client: clientId || me.client })
        if (error) throw new Error(error.message)
        return data
      },
      onboardingSet: csrSelf ? null : async (key, value) => {
        const { error } = await supabase.rpc('qa_onboarding_set', { p_client: clientId || me.client, p_key: key, p_value: !!value })
        if (error) throw new Error(error.message)
      },
      callSourceTest: csrSelf ? null : async (id) => {
        const { data, error } = await supabase.functions.invoke('callsrc-pull', { body: { source_id: id, test: true } })
        if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m } catch { /* keep */ } throw new Error(m || 'Could not reach your phone system.') }
        return data
      },
      callUpload: csrSelf ? null : async ({ file, agent, date }) => {
        const cid = clientId || me.client
        const safe = String(file.name || 'call').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
        const path = `upload/${cid}/${crypto.randomUUID()}-${safe}`
        const up = await supabase.storage.from('qa-recordings').upload(path, file, { contentType: file.type || 'audio/mpeg', upsert: false })
        if (up.error) throw new Error(up.error.message || 'Upload failed.')
        const { data, error } = await supabase.rpc('qa_upload_register', { p_client: cid, p_path: path, p_agent: agent || null, p_started_at: date ? `${date}T12:00:00-05:00` : null })
        if (error) throw new Error(error.message || 'Could not queue that call.')
        return data
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
      mountExt: (kind, el, pick = {}) => {
        if (kind === 'myphone' && phoneRef.current) { const ph = phoneRef.current; ph.show(el); return () => ph.park() }
        const root = createRoot(el)
        const scoped = (b) => invoke(clientId ? { ...b, client_id: clientId } : b)
        root.render(
          <div style={PORTAL_THEME}>
            {kind === 'supervisor' ? <SupervisorDashboard clientId={clientId} brands={pick.brands} locations={pick.locations} />
              : kind === 'wallboard' ? <SupervisorWallboard clientId={clientId} brands={pick.brands} locations={pick.locations} />
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
  }, [me, sup, accounts, setup]) // eslint-disable-line react-hooks/exhaustive-deps

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
  if (!me || setup === null) return <div className="loading-screen">Loading…</div>
  if (needsSetup) {
    return <QaSetupInterview clientId={clientId || me.client} company={setup.company}
      onDone={() => setSetup({ ...setup, needs_setup: false })} />
  }
  return <div ref={ref} />
}
