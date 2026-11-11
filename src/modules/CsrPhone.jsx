// ============================================================
//  CsrPhone — the GarageCo CSR's phone, inside the CSR portal (2026-11-10, Becky).
//
//  • Log in for the day (csr_day_start → Ready) / Log out for the day (csr_day_end → Offline).
//    Every log-in, log-out and status change is saved (csr_workdays, agent_status_log)
//    for supervisors' wallboards and reports.
//  • Ready / Not ready (with a reason) — only while logged in for the day.
//  • TAKE calls: while Ready, calls to their location's line ring here (Softphone).
//    Answering opens the guided call screen (the Dialer component's inbound screen).
//  • MAKE calls: type a customer's number → csr_manual_dial puts it through the dialer
//    guardrails (do-not-call, calling hours, caller ID, recording) → disposition.
//  • Dispositions are two-level (gc_csr_dispositions): Sales / Service / No contact,
//    which is what Rob's intent rate and booking rates are built on.
//  Everything is enforced in the database; CSR logins can only reach csr_* and the
//  phone RPCs (api_pre_request).
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useVoice } from '../lib/voice'
import CallScreen from '../components/CallScreen'
import Dialer from './Dialer'

const REASONS = ['Break', 'Lunch', 'Meeting', 'Training', 'Coaching', 'Other']
const sleep = ms => new Promise(r => setTimeout(r, ms))
const mmss = s => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, '0')}`
const hhmm = s => { const h = Math.floor((s || 0) / 3600), m = Math.floor(((s || 0) % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m` }
const tme = ts => (ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')
const fmtPhone = v => { const d = String(v || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : v }
const STATE_LOOK = {
  ready: { label: 'Ready', color: '#16a34a', bg: '#dcfce7' },
  not_ready: { label: 'Not ready', color: '#b45309', bg: '#fef3c7' },
  on_call: { label: 'On a call', color: '#0e7490', bg: '#cffafe' },
  wrap: { label: 'Wrapping up', color: '#7c3aed', bg: '#ede9fe' },
  offline: { label: 'Logged out', color: '#64748b', bg: '#f1f5f9' },
}

export default function CsrPhone({ accent = '#14302A' }) {
  const voice = useVoice()
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [num, setNum] = useState('')
  const [name, setName] = useState('')
  const [call, setCall] = useState(null)       // manual call: {queue_id, dispositions, script, name, last4, brand}
  const [phase, setPhase] = useState('idle')   // idle | calling | dispo
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [now, setNow] = useState(Date.now())
  const started = useRef(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('csr_phone_get')
    if (error) setErr(error.message); else { setD(data); setErr('') }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t) }, [load])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  // keep the softphone's own status in step with ours
  useEffect(() => { voice?.refreshStatus?.() }, [d?.status?.state]) // eslint-disable-line

  async function act(rpc, args) {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc(rpc, args || {})
    setBusy(false)
    if (error) { setErr(error.message); return null }
    setD(data); voice?.refreshStatus?.()
    return data
  }

  // ---------- manual call ----------
  async function dial() {
    if (voice?.busy || voice?.incoming || voice?.inboundCall) { setErr('Finish the current call first.'); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('csr_manual_dial', { p_phone: num, p_name: name || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setCall(data); setPhase('calling'); started.current = true
    voice.callQueue(data.queue_id, data.name || `…${data.last4}`)
  }
  useEffect(() => {
    if (phase !== 'calling' || !started.current) return
    if (voice.status === 'ended' || voice.status === 'error') {
      started.current = false
      setPhase('dispo')
      supabase.rpc('dialer_set_state', { p_state: 'wrap', p_campaign: call?.campaign_id || null })
    }
  }, [voice?.status, phase]) // eslint-disable-line

  async function saveDispo({ code, notes, fields, callbackAt }) {
    if (!call) return
    setSaving(true); setSaveErr('')
    let error = null
    for (let i = 0; i < 6; i++) {
      ;({ error } = await supabase.rpc('dialer_disposition', { p_queue: call.queue_id, p_code: code, p_callback_at: callbackAt, p_notes: notes || null }))
      if (!error || !/Still finishing the call record/.test(error.message)) break
      await sleep(1500)
    }
    if (error) { setSaving(false); setSaveErr(error.message); return }
    if (fields && Object.keys(fields).length) await supabase.rpc('dialer_save_fields', { p_queue: call.queue_id, p_fields: fields })
    setSaving(false); voice.reset(); setCall(null); setPhase('idle'); setNum(''); setName('')
    await act('csr_set_status', { p_state: 'ready' })
  }

  if (!d) return <div style={S.wrap}><div style={S.card}>{err || 'Loading your phone…'}</div></div>

  const st = d.status?.state || 'offline'
  const loggedIn = !!d.day
  const look = STATE_LOOK[voice?.busy ? 'on_call' : st] || STATE_LOOK.offline
  const since = d.status?.since ? Math.max(0, Math.floor((now - new Date(d.status.since).getTime()) / 1000)) : 0
  const dayLen = d.day ? Math.max(0, Math.floor((now - new Date(d.day.started_at).getTime()) / 1000)) : 0
  const onInbound = !!(voice?.inboundCall || voice?.incoming)

  // ---------- an answered inbound call: the guided call screen ----------
  if (onInbound && phase === 'idle') {
    return <div style={S.wrap}><StatusBar {...{ d, look, since, dayLen, loggedIn, busy, act, accent }} /><div style={{ marginTop: 12 }}><Dialer /></div></div>
  }

  // ---------- a manual call in progress / wrapping up ----------
  if (call && phase !== 'idle') {
    const live = ['connecting', 'ringing', 'in-call'].includes(voice.status)
    const callBar = (
      <div>
        <div style={{ fontWeight: 800, fontSize: 17 }}>{call.name || 'Customer'} <span style={{ fontWeight: 500, opacity: 0.6, fontSize: 13 }}>…{call.last4}</span></div>
        <div style={{ marginTop: 4, fontSize: 14, color: voice.status === 'in-call' ? '#16a34a' : '#475569' }}>
          {voice.status === 'in-call' ? `Connected · ${mmss(voice.seconds)}` : voice.status === 'ringing' ? 'Ringing…' : voice.status === 'connecting' ? 'Connecting…' : 'Call ended — save the disposition'}
        </div>
        {live && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => voice.toggleMute()} style={S.btn}>{voice.muted ? 'Unmute' : 'Mute'}</button>
            <button onClick={() => voice.hangUp()} style={{ ...S.btn, background: '#dc2626', color: '#fff', borderColor: '#dc2626' }}>Hang up</button>
          </div>
        )}
        {voice.error && <div style={S.error}>{voice.error}</div>}
      </div>
    )
    return (
      <div style={S.wrap}>
        <StatusBar {...{ d, look, since, dayLen, loggedIn, busy, act, accent }} />
        <div style={{ marginTop: 12 }}>
          <CallScreen script={call.script} ctx={{ first_name: (call.name || '').split(' ')[0] || '', brand: call.brand || '' }}
            context={[{ label: 'Calling', value: `${call.name || 'Customer'} · …${call.last4}` }, { label: 'Brand', value: call.brand }]}
            contact={null} contactNote="You typed this number." callBar={callBar}
            dispositions={call.dispositions || []} canSave={phase === 'dispo'} onSave={saveDispo} saving={saving} error={saveErr}
            saveHint="pick now, save when the call ends" />
        </div>
      </div>
    )
  }

  // ---------- home ----------
  const t = d.today || {}
  return (
    <div style={S.wrap}>
      <StatusBar {...{ d, look, since, dayLen, loggedIn, busy, act, accent }} />
      {err && <div style={{ ...S.error, marginTop: 10 }}>{err}</div>}

      {!loggedIn ? (
        <div style={{ ...S.card, marginTop: 12, textAlign: 'center', padding: '36px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: accent }}>Good to see you{d.me?.name ? `, ${d.me.name.split(' ')[0]}` : ''}.</div>
          <p style={{ color: '#475569', margin: '8px 0 18px' }}>Log in for the day when you're at your desk. Calls will start ringing here, and you can make calls.</p>
          <button disabled={busy} onClick={() => act('csr_day_start')} style={{ ...S.big, background: accent }}>Log in for the day</button>
          <p style={{ fontSize: 12.5, color: '#64748b', marginTop: 14 }}>Use a headset. Your browser will ask to use the microphone the first time.</p>
        </div>
      ) : (
        <div style={S.grid}>
          <div style={S.card}>
            <div style={S.h}>Make a call</div>
            {!d.manual ? <p style={S.mut}>You're not set up to make calls yet. Ask your manager.</p> : (
              <>
                <label style={S.lbl}>Phone number
                  <input value={num} onChange={e => setNum(e.target.value)} placeholder="(785) 555-0123" inputMode="tel" style={S.input}
                    onKeyDown={e => { if (e.key === 'Enter' && num) dial() }} />
                </label>
                <label style={S.lbl}>Customer name (optional)
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kerri Smith" style={S.input} />
                </label>
                <div style={S.pad}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k === '' ? <span key={i} /> : (
                    <button key={i} style={S.key} onClick={() => setNum(n => k === '⌫' ? n.slice(0, -1) : (n + k).slice(0, 14))}>{k}</button>
                  ))}
                </div>
                <button disabled={busy || !num.replace(/\D/g, '')} onClick={dial} style={{ ...S.big, width: '100%', background: '#16a34a', opacity: busy || !num.replace(/\D/g, '') ? 0.5 : 1 }}>
                  ☎ Call {num ? fmtPhone(num) : ''}
                </button>
                <p style={{ ...S.mut, marginTop: 8 }}>Calls are recorded. Numbers on the do-not-call list and calls outside calling hours are blocked.</p>
              </>
            )}
          </div>

          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            {d.inbound_only && <div style={{ ...S.card, background: '#FFF8E8', borderColor: '#F0DDB0' }}><b>Inbound only.</b> <span style={S.mut}>Your manager has you taking incoming calls only right now, so no list calls will come to you.</span></div>}
            <div style={S.card}>
              <div style={S.h}>Taking calls</div>
              {(d.lines || []).length === 0 ? <p style={S.mut}>No phone line is assigned to you yet.</p> : (d.lines || []).map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: i ? '1px solid #eef2f6' : 'none' }}>
                  <span style={{ fontWeight: 600 }}>{l.name}</span>
                  <span style={{ fontSize: 12.5, color: l.live ? '#16a34a' : '#b45309' }}>{l.live ? (l.number ? fmtPhone(l.number) : 'Live') : 'Not connected yet (test)'}</span>
                </div>
              ))}
              <p style={{ ...S.mut, marginTop: 8 }}>{st === 'ready' ? 'You’re Ready — calls will ring here. Click Answer when one comes in.' : 'Set yourself to Ready to get calls.'}</p>
            </div>
            <div style={S.card}>
              <div style={S.h}>Today</div>
              <div style={S.stats}>
                <Stat label="Calls in" value={t.inbound || 0} />
                <Stat label="Calls out" value={t.outbound || 0} />
                <Stat label="Talk time" value={hhmm((t.talk_secs || 0) + (t.inbound_talk || 0))} />
                <Stat label="Logged in" value={hhmm(dayLen)} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.h}>My recent calls</div>
              {(d.recent || []).length === 0 ? <p style={S.mut}>No calls yet.</p> : (
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}><tbody>
                  {(d.recent || []).slice(0, 12).map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #eef2f6' }}>
                      <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{r.kind === 'in' ? '↘ In' : '↗ Out'}</td>
                      <td style={{ padding: '6px 4px' }}>{r.name || 'Customer'} <span style={{ opacity: 0.55 }}>…{r.last4}</span></td>
                      <td style={{ padding: '6px 4px', whiteSpace: 'nowrap', color: '#475569' }}>{r.disposition || r.status || ''}</td>
                      <td style={{ padding: '6px 4px', whiteSpace: 'nowrap', textAlign: 'right', color: '#64748b' }}>{mmss(r.secs)} · {tme(r.at)}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Calls from your lists (2026-11-10): blended outbound — next contact comes in the location's order
          (missed calls, speed to lead, callbacks…), paused while a customer is waiting on your line. */}
      {loggedIn && (d.queue_campaigns || 0) > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...S.h, margin: '4px 2px 8px' }}>Calls from your lists</div>
          <Dialer />
        </div>
      )}
    </div>
  )
}

function StatusBar({ d, look, since, dayLen, loggedIn, busy, act, accent }) {
  const [reason, setReason] = useState('Break')
  const st = d.status?.state || 'offline'
  return (
    <div style={{ ...S.card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...S.pill, color: look.color, background: look.bg }}><span style={{ ...S.dot, background: look.color }} />{look.label}{st === 'not_ready' && d.status?.reason ? ` · ${d.status.reason}` : ''}</span>
        {loggedIn && <span style={S.mut}>for {mmss(since)} · logged in since {tme(d.day.started_at)} ({Math.floor(dayLen / 3600)}h {Math.floor((dayLen % 3600) / 60)}m)</span>}
        {d.me?.location && <span style={S.mut}>{d.me.brand} · {d.me.location}</span>}
      </div>
      {loggedIn && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {st !== 'ready' && <button disabled={busy} onClick={() => act('csr_set_status', { p_state: 'ready' })} style={{ ...S.btn, background: '#16a34a', color: '#fff', borderColor: '#16a34a' }}>Ready</button>}
          {st === 'ready' && (<>
            <select value={reason} onChange={e => setReason(e.target.value)} style={{ ...S.input, width: 'auto', marginTop: 0 }}>{REASONS.map(r => <option key={r}>{r}</option>)}</select>
            <button disabled={busy} onClick={() => act('csr_set_status', { p_state: 'not_ready', p_reason: reason })} style={S.btn}>Not ready</button>
          </>)}
          <button disabled={busy} onClick={() => { if (window.confirm('Log out for the day? Calls will stop ringing for you.')) act('csr_day_end') }} style={{ ...S.btn, borderColor: accent, color: accent }}>Log out for the day</button>
        </div>
      )}
    </div>
  )
}
function Stat({ label, value }) { return <div><div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div><div style={{ fontSize: 12, color: '#64748b' }}>{label}</div></div> }

const S = {
  wrap: { maxWidth: 1180, margin: '0 auto', padding: '16px 16px 8px' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 },
  h: { fontWeight: 800, fontSize: 15, marginBottom: 10 },
  mut: { fontSize: 12.5, color: '#64748b', margin: 0 },
  lbl: { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 8 },
  input: { display: 'block', width: '100%', marginTop: 4, padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' },
  pad: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, margin: '6px 0 10px' },
  key: { padding: '10px 0', fontSize: 18, fontWeight: 700, borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer' },
  big: { padding: '12px 22px', fontSize: 16, fontWeight: 800, color: '#fff', border: 'none', borderRadius: 11, cursor: 'pointer' },
  btn: { padding: '8px 14px', fontSize: 13.5, fontWeight: 700, border: '1px solid #cbd5e1', borderRadius: 9, background: '#fff', cursor: 'pointer' },
  pill: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, fontWeight: 800, fontSize: 14 },
  dot: { width: 9, height: 9, borderRadius: 999, display: 'inline-block' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 },
  error: { color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '8px 10px', fontSize: 13 },
}
