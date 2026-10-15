// ============================================================
//  Dialer (/dialer) — the agent's calling workspace.
//
//  Flow: pick a campaign → Ready → the next contact pops up (name, reason,
//  details, script — never the full phone number) → Call (preview mode) or
//  auto-dial after a short countdown (progressive mode) → when the call ends,
//  pick a disposition → next contact.
//
//  Everything that matters is enforced in the database:
//    dialer_next()        hands out one contact at a time, locked to this agent,
//                         only inside the customer's calling hours, skipping DNC
//    voice-twiml          looks up the number server-side, checks DNC + hours again,
//                         uses the campaign caller ID, records + plays the notice
//    dialer_disposition() guardrails (no "No answer"/"Voicemail" after 20s of talk,
//                         no blanks, callback needs a time) + schedules the retry
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useVoice } from '../lib/voice'

const LS_KEY = 'dialer_campaign'
const POLL_MS = 15000

function lsGet() { try { return localStorage.getItem(LS_KEY) || '' } catch { return '' } }
function lsSet(v) { try { localStorage.setItem(LS_KEY, v) } catch { /* ignore */ } }
function mmss(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function fillScript(script, contact) {
  if (!script) return ''
  const first = (contact?.contact_name || '').split(' ')[0] || 'there'
  return script.replace(/\{\{\s*first_name\s*\}\}/gi, first).replace(/\{\{\s*name\s*\}\}/gi, contact?.contact_name || 'there')
}
// datetime-local value for "now + n minutes" in the agent's own time
function localInputValue(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Dialer() {
  const voice = useVoice()
  const [campaigns, setCampaigns] = useState(null)       // null = loading
  const [campaignId, setCampaignId] = useState(lsGet())
  const [agentState, setAgentState] = useState('not_ready') // not_ready | ready
  const [contact, setContact] = useState(null)
  const [phase, setPhase] = useState('idle')               // idle | preview | countdown | calling | dispo
  const [countdown, setCountdown] = useState(0)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [dispo, setDispo] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastTalk, setLastTalk] = useState(0)
  const callStarted = useRef(false)

  const campaign = (campaigns || []).find(c => c.id === campaignId) || null

  const loadCampaigns = useCallback(async () => {
    const { data, error } = await supabase.rpc('dialer_my_campaigns')
    if (error) { setErr(error.message); setCampaigns([]); return }
    setCampaigns(data || [])
    if (data?.length && !data.some(c => c.id === campaignId)) setCampaignId(data[0].id)
  }, [campaignId])
  useEffect(() => { loadCampaigns() }, []) // eslint-disable-line
  useEffect(() => { if (campaignId) lsSet(campaignId) }, [campaignId])

  // Leaving the page = offline (and hand back a contact we never called).
  const contactRef = useRef(null)
  const phaseRef = useRef('idle')
  useEffect(() => { contactRef.current = contact; phaseRef.current = phase }, [contact, phase])
  useEffect(() => () => {
    if (contactRef.current && ['preview', 'countdown'].includes(phaseRef.current)) supabase.rpc('dialer_skip', { p_queue: contactRef.current.queue_id })
    supabase.rpc('dialer_set_state', { p_state: 'offline' })
  }, [])

  const setState = useCallback(async (state) => {
    const { error } = await supabase.rpc('dialer_set_state', { p_state: state, p_campaign: campaignId || null })
    if (error) setErr(error.message)
  }, [campaignId])

  const fetchNext = useCallback(async () => {
    if (!campaignId) return
    setErr(''); setMsg('')
    const { data, error } = await supabase.rpc('dialer_next', { p_campaign: campaignId })
    if (error) { setErr(error.message); return }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) { setContact(null); setPhase('idle'); setMsg('No one to call right now. Checking again every few seconds…'); return }
    setContact(row); setDispo(''); setNotes(''); setCallbackAt(''); callStarted.current = false
    if (campaign?.mode === 'progressive') {
      setPhase('countdown'); setCountdown(campaign.progressive_delay_sec ?? 3)
    } else setPhase('preview')
  }, [campaignId, campaign])

  // Poll for work while Ready with nothing on screen.
  useEffect(() => {
    if (agentState !== 'ready' || contact || phase !== 'idle') return
    const t = setInterval(fetchNext, POLL_MS)
    return () => clearInterval(t)
  }, [agentState, contact, phase, fetchNext])

  // Progressive countdown → auto-dial.
  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) { placeCall(); return }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, countdown]) // eslint-disable-line

  // Call finished → disposition.
  useEffect(() => {
    if (!voice || phase !== 'calling') return
    if (voice.status === 'in-call') setLastTalk(voice.seconds)
    if ((voice.status === 'ended' || voice.status === 'error') && callStarted.current) {
      setPhase('dispo'); setState('wrap')
    }
  }, [voice?.status, voice?.seconds, phase]) // eslint-disable-line

  function placeCall() {
    if (!voice || !contact) return
    callStarted.current = true
    setLastTalk(0)
    setPhase('calling')
    voice.callQueue(contact.queue_id, contact.contact_name || 'Customer')
  }

  async function goReady() {
    if (!campaignId) return
    setAgentState('ready'); await setState('ready')
    if (!contact) fetchNext()
  }
  async function goNotReady() {
    setAgentState('not_ready'); await setState('not_ready')
    if (contact && ['preview', 'countdown'].includes(phase)) {
      await supabase.rpc('dialer_skip', { p_queue: contact.queue_id })
      setContact(null); setPhase('idle')
    }
    setMsg('')
  }
  async function skip() {
    if (!contact) return
    await supabase.rpc('dialer_skip', { p_queue: contact.queue_id })
    setContact(null); setPhase('idle')
    if (agentState === 'ready') fetchNext()
  }

  async function saveDispo(retryCount = 0) {
    if (!contact) return
    const d = (campaign?.dispositions || []).find(x => x.code === dispo)
    setSaving(true); setErr('')
    const { error } = await supabase.rpc('dialer_disposition', {
      p_queue: contact.queue_id, p_code: dispo,
      p_callback_at: d?.outcome === 'callback' && callbackAt ? new Date(callbackAt).toISOString() : null,
      p_notes: notes || null,
    })
    if (error) {
      // Twilio's call record lands a moment after hang-up — retry quietly a few times.
      if (/Still finishing the call record/.test(error.message) && retryCount < 4) {
        setTimeout(() => saveDispo(retryCount + 1), 1500); return
      }
      setSaving(false); setErr(error.message); return
    }
    setSaving(false)
    voice?.reset()
    setContact(null); setPhase('idle'); setMsg('Saved.')
    if (agentState === 'ready') { await setState('ready'); fetchNext() }
    else await setState('not_ready')
    loadCampaigns()
  }

  // ---------- render ----------
  if (!voice) return <div className="card">Calling isn't available for your login.</div>
  if (campaigns === null) return <p className="page-sub">Loading…</p>

  const dispoDef = (campaign?.dispositions || []).find(x => x.code === dispo)
  const dataEntries = Object.entries(contact?.data || {}).filter(([, v]) => v != null && v !== '')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Dialer</h1>
          <p className="page-sub">Go Ready to get your next contact. Use a headset — your browser will ask for microphone access the first time.</p>
        </div>
        {campaigns.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={campaignId} onChange={e => setCampaignId(e.target.value)} disabled={agentState === 'ready' || phase !== 'idle'} style={S.select}>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.brand ? ` · ${c.brand}` : ''} ({c.ready_now} ready)</option>)}
            </select>
            {agentState === 'ready'
              ? <button onClick={goNotReady} style={{ ...S.stateBtn, background: '#16a34a' }}>● Ready</button>
              : <button onClick={goReady} style={{ ...S.stateBtn, background: '#64748b' }}>○ Not ready — go Ready</button>}
          </div>
        )}
      </div>

      {campaigns.length === 0 && (
        <div className="card"><p className="page-sub" style={{ margin: 0 }}>You're not on any active calling campaigns yet. A manager adds you on the Campaigns page.</p></div>
      )}

      {err && <div style={S.error}>{err}</div>}

      {campaign && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {/* ---- contact card ---- */}
          <div className="card" style={{ minHeight: 220 }}>
            {!contact ? (
              <div style={{ textAlign: 'center', padding: '40px 10px' }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                  {agentState === 'ready' ? 'Waiting for the next contact…' : 'You’re Not Ready'}
                </div>
                <div className="page-sub" style={{ margin: 0 }}>
                  {agentState === 'ready' ? (msg || 'Looking…') : `Go Ready to start calling. ${campaign.ready_now} contact${campaign.ready_now === 1 ? '' : 's'} ready now, ${campaign.pending_total} queued.`}
                </div>
                {agentState === 'ready' && <button onClick={fetchNext} style={{ ...S.btn, marginTop: 14 }}>Check now</button>}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{contact.contact_name || 'Unknown name'}</div>
                    <div style={S.small}>Phone ending {contact.phone_last4} · their time {contact.customer_local_time}</div>
                  </div>
                  <span style={S.pill}>Attempt {contact.attempts + (phase === 'preview' || phase === 'countdown' ? 1 : 0)}</span>
                </div>
                {contact.reason && <div style={{ marginTop: 10, fontWeight: 600 }}>{contact.reason}</div>}
                {contact.last_disposition && <div style={{ ...S.small, marginTop: 4 }}>Last result: {(campaign.dispositions.find(d => d.code === contact.last_disposition) || {}).label || contact.last_disposition}</div>}
                {dataEntries.length > 0 && (
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}>
                    {dataEntries.map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <span style={{ opacity: 0.6, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                        <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* actions */}
                <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {phase === 'preview' && <>
                    <button onClick={placeCall} style={S.callBtn}>📞 Call</button>
                    <button onClick={skip} style={S.btn}>Skip</button>
                  </>}
                  {phase === 'countdown' && <>
                    <button onClick={placeCall} style={S.callBtn}>📞 Dialing in {countdown}…</button>
                    <button onClick={() => setPhase('preview')} style={S.btn}>Pause</button>
                    <button onClick={skip} style={S.btn}>Skip</button>
                  </>}
                  {phase === 'calling' && (
                    <div style={{ fontWeight: 700, color: voice.status === 'in-call' ? '#16a34a' : 'inherit' }}>
                      {voice.status === 'connecting' ? 'Connecting…' : voice.status === 'ringing' ? 'Ringing…' : voice.status === 'in-call' ? `On call · ${mmss(voice.seconds)}` : 'Ending…'}
                      <button onClick={voice.hangUp} style={{ ...S.btn, marginLeft: 12, background: '#dc2626', color: '#fff', borderColor: '#dc2626' }}>Hang up</button>
                    </div>
                  )}
                </div>

                {/* disposition */}
                {phase === 'dispo' && (
                  <div style={{ marginTop: 16, borderTop: '1px solid rgba(100,116,139,0.2)', paddingTop: 14 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>How did it go?{lastTalk ? <span style={S.small}> · talked {mmss(lastTalk)}</span> : null}</div>
                    {voice.status === 'error' && voice.error && <div style={{ ...S.small, marginBottom: 8 }}>Call ended: {voice.error}</div>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {campaign.dispositions.map(d => (
                        <button key={d.code} onClick={() => setDispo(d.code)}
                          style={{ ...S.chip, ...(dispo === d.code ? S.chipOn : {}) }}>{d.label}</button>
                      ))}
                    </div>
                    {dispoDef?.outcome === 'callback' && (
                      <div style={{ marginTop: 10 }}>
                        <label style={S.label}>Callback time (your time — they're at {contact.customer_local_time} now)</label>
                        <input type="datetime-local" value={callbackAt} min={localInputValue(new Date())}
                          onChange={e => setCallbackAt(e.target.value)} style={S.input} />
                      </div>
                    )}
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
                      style={{ ...S.input, width: '100%', marginTop: 10, resize: 'vertical', boxSizing: 'border-box' }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => saveDispo()} disabled={!dispo || saving} style={{ ...S.callBtn, background: '#0891b2', opacity: !dispo || saving ? 0.6 : 1 }}>
                        {saving ? 'Saving…' : agentState === 'ready' ? 'Save & next' : 'Save'}
                      </button>
                      <button onClick={placeCall} style={S.btn} title="Call again (e.g. dropped call) — counts as another attempt">Redial</button>
                      {voice.status === 'error' && <button onClick={() => { voice.reset(); skip() }} style={S.btn} title="The call never went through — put this contact back in the queue">Skip</button>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---- script ---- */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.6, marginBottom: 8 }}>Script</div>
            {campaign.script
              ? <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 14 }}>{fillScript(campaign.script, contact)}</div>
              : <div className="page-sub" style={{ margin: 0 }}>No script for this campaign yet.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

const S = {
  select: { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14, maxWidth: 340 },
  stateBtn: { padding: '8px 14px', borderRadius: 999, border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btn: { padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  callBtn: { padding: '9px 18px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  chip: { padding: '7px 12px', borderRadius: 999, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  chipOn: { background: '#0891b2', borderColor: '#0891b2', color: '#fff' },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 14, fontFamily: 'inherit' },
  label: { display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 },
  small: { fontSize: 12.5, opacity: 0.65 },
  pill: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(8,145,178,0.12)', color: '#0891b2', whiteSpace: 'nowrap' },
  error: { marginBottom: 12, padding: '10px 12px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)', color: '#b91c1c', borderRadius: 10, fontSize: 13.5 },
}
