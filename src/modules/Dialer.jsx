// ============================================================
//  Dialer (/dialer) — the agent workspace. One screen for every call:
//
//  • INBOUND: answering a call anywhere in Command Center opens it here with the
//    guided script for the menu option the caller picked (Inbound → Settings sets
//    which script each option uses), the caller's details, AI notes, past calls,
//    and the disposition. Saving the disposition puts you back to Ready.
//  • OUTBOUND: while you're Ready and no inbound call is waiting, the Dialer hands you
//    the next contact from your campaigns ("All my campaigns" or one you pick).
//    Preview → Call (or auto-dial after a countdown in progressive mode) → disposition.
//
//  One status for both: Ready / Not ready (reason) / Offline (components/AgentStatus).
//  Phone, email and address appear only once you're on the call (rpc call_contact_info,
//  logged). Everything that matters is enforced in the database:
//    dialer_next / dialer_disposition / dialer_save_fields — outbound
//    inbound_call_context / inbound_disposition            — inbound
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useVoice } from '../lib/voice'
import CallScreen, { prettyPhone } from '../components/CallScreen'
import AgentStatus from '../components/AgentStatus'

const LS_KEY = 'dialer_campaign'
const POLL_MS = 15000
const AUTO_POLL_MS = 4000   // auto-dial (speed-to-lead) campaigns look for new leads every 4s
// Auto-dial = progressive with a 0-second countdown: calls go out as soon as a lead is handed over.
const isAutoDial = c => !!c && c.mode === 'progressive' && Number(c.progressive_delay_sec) === 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
function lsGet() { try { return localStorage.getItem(LS_KEY) || 'all' } catch { return 'all' } }
function lsSet(v) { try { localStorage.setItem(LS_KEY, v) } catch { /* ignore */ } }
function mmss(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function fmt(ts) { return ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' }
const TYPE_LABEL = { team: 'Team member', applicant: 'Job applicant', campaign_contact: 'Campaign contact', unknown: 'New caller' }

// A campaign that only has the old plain-text script still gets a usable screen.
function scriptFor(campaign) {
  if (campaign?.script_config && Object.keys(campaign.script_config).length) return campaign.script_config
  return {
    eyebrow: campaign?.brand ? `Call script · ${campaign.brand}` : 'Call script', title: campaign?.name || 'Call',
    steps: [{ title: 'Script', blocks: campaign?.script ? [{ type: 'say', text: campaign.script }] : [{ type: 'note', text: 'No script yet — assign one on the Scripts page.' }] }],
  }
}

export default function Dialer() {
  const voice = useVoice()
  const [me, setMe] = useState({ name: '', first: '' })
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data?.user?.id
      if (!uid) return
      const { data: p } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle()
      const name = p?.full_name || data.user.email || ''
      setMe({ name, first: name.split(' ')[0] })
    })
  }, [])

  if (!voice) return <div className="card">Calling isn't available for your login.</div>
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>Agent workspace</h1>
          <p className="page-sub" style={{ margin: 0 }}>Set yourself Ready — inbound calls ring you first, and the Dialer feeds you outbound contacts in between.</p>
        </div>
        <AgentStatus />
      </div>
      {voice.inboundCall
        ? <InboundWork key={voice.inboundCall.id || voice.inboundCall.answeredAt} call={voice.inboundCall} me={me} />
        : <OutboundWork me={me} />}
    </div>
  )
}

// =====================================================================
//  INBOUND
// =====================================================================
function InboundWork({ call, me }) {
  const voice = useVoice()
  const [ctx, setCtx] = useState(null)
  const [err, setErr] = useState('')
  const [contact, setContact] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [talk, setTalk] = useState(0)

  useEffect(() => {
    if (!call.id) return
    let alive = true
    ;(async () => {
      for (let i = 0; i < 4 && alive; i++) {
        const { data, error } = await supabase.rpc('inbound_call_context', { p_call: call.id })
        if (!error && data) { setCtx(data); setErr(''); return }
        setErr(error?.message || 'Loading the call…')
        await sleep(1500)
      }
    })()
    return () => { alive = false }
  }, [call.id])

  // contact details once connected (answered_by can lag a second behind)
  useEffect(() => {
    if (!call.id || contact || !['in-call', 'ended'].includes(voice.status)) return
    let alive = true
    ;(async () => {
      for (let i = 0; i < 5 && alive; i++) {
        const { data, error } = await supabase.rpc('call_contact_info', { p_kind: 'inbound', p_ref: call.id })
        if (!error && data) { setContact(data); return }
        await sleep(1500)
      }
    })()
    return () => { alive = false }
  }, [call.id, voice.status, contact])

  useEffect(() => { if (voice.status === 'in-call') setTalk(voice.seconds) }, [voice.status, voice.seconds])

  const script = ctx?.script || null
  const f = ctx?.ai_fields || {}
  const name = ctx?.caller_name || (call.callerName || '').replace(/\s*\(.*\)$/, '') || ''
  const mctx = useMemo(() => ({
    first_name: name.split(' ')[0] || '', last_name: name.split(' ').slice(1).join(' '), customer_name: name,
    agent_name: me.name, agent_first: me.first, brand: ctx?.brand || 'Opsis CX',
    callback_number: script?.callback_number || '', menu_option: ctx?.menu_choice || call.queueLabel,
    reason: f.reason || '', company: f.company || '',
  }), [name, me, ctx, script, f.reason, f.company, call.queueLabel])

  const context = [
    { label: 'Caller', value: name || 'Unknown caller' },
    { label: 'Who they are', value: TYPE_LABEL[ctx?.caller_type] || 'New caller' },
    { label: 'Menu option', value: ctx?.menu_choice || call.queueLabel },
    { label: 'Line', value: ctx?.line || call.lineName },
    { label: 'Agent', value: me.name },
    { label: 'Callback number — brand', value: script?.callback_number ? prettyPhone(script.callback_number) : '' },
  ]

  async function save({ code, notes, fields, callbackAt }) {
    setSaving(true); setSaveErr('')
    const { error } = await supabase.rpc('inbound_disposition', {
      p_call: call.id, p_code: code, p_notes: notes || null, p_fields: fields || {}, p_callback_at: callbackAt,
    })
    setSaving(false)
    if (error) { setSaveErr(error.message); return }
    await voice.clearInbound()
  }

  const live = voice.busy
  const callBar = (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#d97706' }}>Inbound call</div>
      <div style={{ fontSize: 19, fontWeight: 800, marginTop: 2 }}>{name || 'Caller'}</div>
      <div style={{ fontSize: 13, opacity: 0.7 }}>{[call.queueLabel, ctx?.after_hours ? 'after hours' : ''].filter(Boolean).join(' · ')}</div>
      <div style={{ marginTop: 8, fontWeight: 700, color: voice.status === 'in-call' ? '#16a34a' : 'inherit' }}>
        {voice.status === 'in-call' ? `On call · ${mmss(voice.seconds)}` : voice.status === 'connecting' ? 'Connecting…' : live ? 'Connecting…' : `Call ended${talk ? ` · talked ${mmss(talk)}` : ''} — save the disposition`}
      </div>
      {live && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={voice.toggleMute} style={{ ...S.btn, flex: 1, background: voice.muted ? 'rgba(234,179,8,0.25)' : 'transparent' }}>{voice.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={voice.hangUp} style={{ ...S.btn, flex: 1, background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>Hang up</button>
        </div>
      )}
      {err && !ctx && <div style={{ ...S.small, marginTop: 8 }}>{err}</div>}
    </div>
  )

  const extra = (
    <>
      {(ctx?.ai_summary || f.callback_time || f.urgency) && (
        <div style={S.card}>
          <div style={S.cardTitle}>AI assistant notes</div>
          {ctx?.ai_summary && <div style={{ fontSize: 14 }}>{ctx.ai_summary}</div>}
          {f.callback_time && <div style={{ ...S.small, marginTop: 6 }}>Best time: {f.callback_time}</div>}
          {f.urgency && <div style={{ ...S.small, marginTop: 2 }}>Urgency: {f.urgency}</div>}
        </div>
      )}
      {(ctx?.history || []).length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>Earlier calls from this caller</div>
          {ctx.history.map((h, i) => (
            <div key={i} style={{ padding: '6px 0', borderTop: i ? '1px solid rgba(100,116,139,0.15)' : 'none', fontSize: 13 }}>
              <div style={{ fontWeight: 700 }}>{fmt(h.at)} · {h.menu || '—'}</div>
              <div style={{ opacity: 0.8 }}>{h.disposition || h.status}{h.summary ? ` — ${h.summary}` : ''}{h.notes ? ` — ${h.notes}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )

  if (!call.id) {
    return <div className="card">This call came in without its call record. Finish the call from the phone panel; a refresh of the inbound setup fixes it for the next call.
      <div style={{ marginTop: 10 }}><button style={S.btn} onClick={() => voice.clearInbound()}>Done</button></div></div>
  }

  return (
    <CallScreen
      script={script} ctx={mctx} context={context} contact={contact}
      contactNote="Shows once the call connects."
      callBar={callBar} extra={extra}
      dispositions={ctx?.dispositions || []}
      canSave={!live} saveHint="pick now, save after you hang up"
      onSave={save} saving={saving} error={saveErr}
      saveLabel={voice.agent.state === 'not_ready' ? 'Save' : 'Save & go Ready'}
      showVoicemail={false}
    />
  )
}

// =====================================================================
//  OUTBOUND
// =====================================================================
function OutboundWork({ me }) {
  const voice = useVoice()
  const [campaigns, setCampaigns] = useState(null)
  const [sel, setSel] = useState(lsGet())
  const [contact, setContact] = useState(null)        // dialer_next row + campaign_id
  const [phase, setPhase] = useState('idle')            // idle | preview | countdown | calling | dispo
  const [countdown, setCountdown] = useState(0)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [lastTalk, setLastTalk] = useState(0)
  const [info, setInfo] = useState(null)
  const callStarted = useRef(false)
  const wasReady = useRef(false)
  const busyFetch = useRef(false)

  const ready = voice.agent.state === 'ready'
  const campaign = (campaigns || []).find(c => c.id === (contact?.campaign_id || sel)) || null

  const loadCampaigns = useCallback(async () => {
    const { data, error } = await supabase.rpc('dialer_my_campaigns_v2')
    if (error) { setErr(error.message); setCampaigns([]); return }
    setCampaigns(data || [])
  }, [])
  useEffect(() => { loadCampaigns() }, [loadCampaigns])
  useEffect(() => { lsSet(sel) }, [sel])

  // Leaving the page hands back a contact we never called.
  const contactRef = useRef(null); const phaseRef = useRef('idle')
  useEffect(() => { contactRef.current = contact; phaseRef.current = phase }, [contact, phase])
  useEffect(() => () => {
    if (contactRef.current && ['preview', 'countdown'].includes(phaseRef.current)) supabase.rpc('dialer_skip', { p_queue: contactRef.current.queue_id })
  }, [])

  const fetchNext = useCallback(async () => {
    if (!campaigns?.length || busyFetch.current) return
    busyFetch.current = true
    setErr(''); setMsg('')
    try {
      const list = sel === 'all' ? [...campaigns].sort((a, b) => b.ready_now - a.ready_now) : campaigns.filter(c => c.id === sel)
      for (const c of list) {
        const { data, error } = await supabase.rpc('dialer_next', { p_campaign: c.id })
        if (error) continue
        const row = Array.isArray(data) ? data[0] : data
        if (row) {
          setContact({ ...row, campaign_id: c.id }); setInfo(null); callStarted.current = false
          // Progressive with a 0-second countdown = auto-dial: the call goes out the moment the
          // lead is handed over — no Call, Pause or Skip for the agent.
          if (c.mode === 'progressive') { setPhase('countdown'); setCountdown(Number(c.progressive_delay_sec ?? 3)) } else setPhase('preview')
          return
        }
      }
      setContact(null); setPhase('idle'); setMsg('No one to call right now. Checking again every few seconds…')
    } finally { busyFetch.current = false }
  }, [campaigns, sel])

  const free = !voice.incoming && !voice.inboundCall
  // Ready with nothing on screen → get work (now, then poll).
  useEffect(() => {
    if (!ready || contact || phase !== 'idle' || !free || !campaigns?.length) return
    fetchNext()
    const auto = campaigns.some(c => isAutoDial(c) && (sel === 'all' || c.id === sel))
    const t = setInterval(fetchNext, auto ? AUTO_POLL_MS : POLL_MS)
    return () => clearInterval(t)
  }, [ready, contact, phase, free, campaigns, fetchNext, sel])

  // Not ready (or an inbound call came in) while previewing → hand the contact back / pause.
  useEffect(() => {
    if (!contact) return
    if (!ready && ['preview', 'countdown'].includes(phase) && voice.agent.state !== 'on_call') {
      supabase.rpc('dialer_skip', { p_queue: contact.queue_id }); setContact(null); setPhase('idle')
    }
    if (voice.incoming && phase === 'countdown' && !isAutoDial(campaign)) setPhase('preview')
  }, [ready, voice.incoming, phase, contact, voice.agent.state]) // eslint-disable-line

  // Progressive countdown → auto-dial.
  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) { placeCall(); return }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, countdown]) // eslint-disable-line

  // Contact details once the call is placed (the attempt record must exist first).
  useEffect(() => {
    if (phase !== 'calling' || info || !contact || !['ringing', 'in-call'].includes(voice.status)) return
    let alive = true
    ;(async () => {
      for (let i = 0; i < 4 && alive; i++) {
        const { data, error } = await supabase.rpc('call_contact_info', { p_kind: 'queue', p_ref: contact.queue_id })
        if (!error && data) { setInfo(data); return }
        await sleep(1500)
      }
    })()
    return () => { alive = false }
  }, [phase, voice.status, info, contact])

  // Call finished → disposition.
  useEffect(() => {
    if (phase !== 'calling') return
    if (voice.status === 'in-call') setLastTalk(voice.seconds)
    if ((voice.status === 'ended' || voice.status === 'error') && callStarted.current) {
      setPhase('dispo')
      supabase.rpc('dialer_set_state', { p_state: 'wrap', p_campaign: contact?.campaign_id || null })
    }
  }, [voice.status, voice.seconds, phase]) // eslint-disable-line

  function placeCall() {
    if (!contact) return
    // An inbound call is ringing / on screen: hold the auto-dial and retry in a moment
    // instead of dropping the agent into a manual preview.
    if (voice.incoming || voice.inboundCall) {
      if (isAutoDial(campaign)) { setCountdown(2); return }
      setPhase('preview'); return
    }
    wasReady.current = wasReady.current || voice.agent.state === 'ready'
    callStarted.current = true
    setLastTalk(0)
    setPhase('calling')
    voice.callQueue(contact.queue_id, contact.contact_name || 'Customer')
  }
  async function skip() {
    if (!contact) return
    await supabase.rpc('dialer_skip', { p_queue: contact.queue_id })
    setContact(null); setPhase('idle'); voice.reset()
  }

  async function save({ code, notes, fields, callbackAt }) {
    if (!contact) return
    setSaving(true); setSaveErr('')
    let error = null
    for (let i = 0; i < 5; i++) {
      ;({ error } = await supabase.rpc('dialer_disposition', { p_queue: contact.queue_id, p_code: code, p_callback_at: callbackAt, p_notes: notes || null }))
      if (!error || !/Still finishing the call record/.test(error.message)) break
      await sleep(1500)
    }
    if (error) { setSaving(false); setSaveErr(error.message); return }
    if (fields && Object.keys(fields).length) await supabase.rpc('dialer_save_fields', { p_queue: contact.queue_id, p_fields: fields })
    setSaving(false)
    voice.reset()
    setContact(null); setPhase('idle'); setInfo(null); setMsg('Saved.')
    const back = wasReady.current
    wasReady.current = false
    await voice.setStatus(back ? 'ready' : 'not_ready', back ? null : 'Other')
    loadCampaigns()
  }

  if (campaigns === null) return <p className="page-sub">Loading…</p>

  const totalReady = campaigns.reduce((n, c) => n + (c.ready_now || 0), 0)
  if (!contact) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '40px 16px' }}>
        {err && <div style={S.error}>{err}</div>}
        {campaigns.length === 0 ? (
          <div className="page-sub" style={{ margin: 0 }}>
            You're not on any active calling campaigns. {voice.agent.inbound_member ? 'Set yourself Ready and inbound calls will ring you here.' : 'The Opsis CX Support team adds you on the Campaigns page.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{ready ? 'Waiting for your next call…' : "You're not Ready"}</div>
            <div className="page-sub" style={{ margin: '6px 0 14px' }}>
              {ready ? (msg || 'Looking…') : `Set yourself Ready (top right) to start. ${totalReady} contact${totalReady === 1 ? '' : 's'} ready to call now.`}
            </div>
            <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span style={S.small}>Outbound from</span>
              <select value={sel} onChange={e => setSel(e.target.value)} style={S.select}>
                <option value="all">All my campaigns ({totalReady} ready)</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.brand ? ` · ${c.brand}` : ''} ({c.ready_now} ready)</option>)}
              </select>
              {ready && <button onClick={fetchNext} style={S.btn}>Check now</button>}
            </div>
          </>
        )}
      </div>
    )
  }

  const script = scriptFor(campaign)
  const d = contact.data || {}
  const first = (contact.contact_name || '').split(' ')[0] || ''
  const flat = Object.fromEntries(Object.entries(d).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => [k, String(v)]))
  const mctx = {
    ...flat, first_name: first, last_name: (contact.contact_name || '').split(' ').slice(1).join(' '), customer_name: contact.contact_name || '',
    agent_name: me.name, agent_first: me.first, brand: campaign?.brand || '',
    callback_number: script.callback_number || '', reason: contact.reason || d.service || d.message || '',
    lead_source: d.lead_source || d.source || '', company: d.company || '',
  }
  const context = [
    { label: 'Customer', value: contact.contact_name },
    { label: 'Agent', value: me.name },
    { label: 'Brand', value: campaign?.brand },
    { label: 'Lead source', value: mctx.lead_source },
    { label: 'What they asked about', value: mctx.reason },
    { label: 'Callback number — brand', value: script.callback_number ? prettyPhone(script.callback_number) : '' },
    { label: 'Their local time', value: contact.customer_local_time },
    { label: 'Attempt', value: String((contact.attempts || 0) + (['preview', 'countdown'].includes(phase) ? 1 : 0)) },
  ]

  const callBar = (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#0e7490' }}>{campaign?.name}</div>
      <div style={{ fontSize: 19, fontWeight: 800, marginTop: 2 }}>{contact.contact_name || 'Unknown name'}</div>
      <div style={S.small}>{info?.phone ? prettyPhone(info.phone) : `Phone ending ${contact.phone_last4}`} · their time {contact.customer_local_time}</div>
      {contact.last_disposition && <div style={{ ...S.small, marginTop: 2 }}>Last result: {(campaign?.dispositions || []).find(x => x.code === contact.last_disposition)?.label || contact.last_disposition}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {phase === 'preview' && <>
          <button onClick={placeCall} disabled={voice.incoming} style={{ ...S.callBtn, flex: 2 }}>📞 Call</button>
          <button onClick={skip} style={{ ...S.btn, flex: 1 }}>Skip</button>
        </>}
        {phase === 'countdown' && isAutoDial(campaign) && (
          <div style={{ width: '100%', fontWeight: 700 }}>📞 Auto-dialing…</div>
        )}
        {phase === 'countdown' && !isAutoDial(campaign) && <>
          <button onClick={placeCall} style={{ ...S.callBtn, flex: 2 }}>📞 Dialing in {countdown}…</button>
          <button onClick={() => setPhase('preview')} style={S.btn}>Pause</button>
          <button onClick={skip} style={S.btn}>Skip</button>
        </>}
        {phase === 'calling' && <>
          <div style={{ width: '100%', fontWeight: 700, color: voice.status === 'in-call' ? '#16a34a' : 'inherit' }}>
            {voice.status === 'connecting' ? 'Connecting…' : voice.status === 'ringing' ? 'Ringing…' : voice.status === 'in-call' ? `On call · ${mmss(voice.seconds)}` : 'Ending…'}
          </div>
          <button onClick={voice.toggleMute} disabled={voice.status !== 'in-call'} style={{ ...S.btn, flex: 1, background: voice.muted ? 'rgba(234,179,8,0.25)' : 'transparent' }}>{voice.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={voice.hangUp} style={{ ...S.btn, flex: 1, background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>Hang up</button>
        </>}
        {phase === 'dispo' && <>
          <div style={{ width: '100%', fontWeight: 700 }}>Call ended{lastTalk ? ` · talked ${mmss(lastTalk)}` : ''}</div>
          {voice.status === 'error' && voice.error && <div style={{ ...S.small, width: '100%' }}>{voice.error}</div>}
          <button onClick={placeCall} style={{ ...S.btn, flex: 1 }} title="Call again (e.g. dropped call) — counts as another attempt">Redial</button>
          {voice.status === 'error' && <button onClick={() => { voice.reset(); skip() }} style={{ ...S.btn, flex: 1 }} title="The call never went through — put this contact back in the queue">Skip</button>}
        </>}
      </div>
    </div>
  )

  return (
    <CallScreen
      key={contact.queue_id}
      script={script} ctx={mctx} context={context} contact={info}
      contactNote="Shows once you place the call."
      callBar={callBar}
      dispositions={campaign?.dispositions || []}
      canSave={phase === 'dispo'} saveHint={phase === 'dispo' ? '' : 'pick now, save after the call'}
      onSave={save} saving={saving} error={saveErr}
      saveLabel={wasReady.current || ready ? 'Save & next' : 'Save'}
      showVoicemail
    />
  )
}

const S = {
  card: { padding: 14, borderRadius: 14, border: '1px solid rgba(100,116,139,0.22)', background: 'var(--card, #fff)' },
  cardTitle: { fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#0e7490', marginBottom: 8 },
  select: { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14, maxWidth: 360 },
  btn: { padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  callBtn: { padding: '9px 14px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  small: { fontSize: 12.5, opacity: 0.7 },
  error: { marginBottom: 12, padding: '10px 12px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)', color: '#b91c1c', borderRadius: 10, fontSize: 13.5 },
}
