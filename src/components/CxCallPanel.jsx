// ============================================================
//  CxCallPanel — the live call side panel for CX-engine calls (2026-11-13).
//  Rendered once by <Softphone/>, so it follows the CSR across pages.
//  Shows: caller + timer, call controls (hold, transfer warm/cold/conference/queue,
//  pause recording for card details, raise hand, end), AGENT ASSIST (next best action,
//  what to say, call-flow checklist, facts, alerts, booking likelihood, sentiment),
//  LIVE TRANSCRIPT, caller history (screen pop), and the AI wrap-up after the call.
//  Only appears for calls on lines / campaigns switched to the Advanced engine.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useVoice } from '../lib/voice'
import { cxControl, cxAssistNow, cxWrapNow } from '../lib/cx'

const G = '#14302A'
const GT = 'light-dark(#14302A, #9fd6bd)'  // brand green for text/lines: lighter in dark mode
const mmss = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`
const ago = t => { const s = Math.round((Date.now() - new Date(t).getTime()) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString() }

export default function CxCallPanel() {
  const voice = useVoice()
  const [mine, setMine] = useState(null)           // csr_cx_my_call
  const [iid, setIid] = useState(null)
  const [live, setLive] = useState(null)           // interaction + participants + assist
  const [lines, setLines] = useState([])           // transcript
  const [cust, setCust] = useState(null)
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState('check')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [xfer, setXfer] = useState(false)
  const [ended, setEnded] = useState(null)         // interaction id we show the wrap-up for
  const [, tick] = useState(0)
  const lastId = useRef(0)
  const trBox = useRef(null)

  // 1) find my active CX call
  const active = !!(voice && (voice.busy || voice.inboundCall || voice.incoming))
  useEffect(() => {
    if (!voice) return
    let alive = true
    const run = async () => {
      const { data } = await supabase.rpc('csr_cx_my_call')
      if (!alive) return
      setMine(data || null)
      if (data?.interaction_id && data.status === 'connected') {
        if (data.interaction_id !== iid) { setIid(data.interaction_id); setLines([]); lastId.current = 0; setLive(null); setCust(null); setEnded(null); setOpen(true); setTab('check') }
      }
    }
    run()
    const t = setInterval(run, active ? 2500 : 12000)
    return () => { alive = false; clearInterval(t) }
  }, [voice, active, iid])

  // 2) live feed for the call (and for a few minutes after, for the wrap-up)
  const load = useCallback(async () => {
    if (!iid) return
    const { data, error } = await supabase.rpc('csr_cx_live', { p_interaction: iid, p_after: lastId.current })
    if (error) { setErr(error.message); return }
    setErr('')
    setLive(data)
    const add = data?.transcript || []
    if (add.length) { lastId.current = add[add.length - 1].id; setLines(l => [...l, ...add].slice(-400)) }
    const st = data?.interaction?.status
    if (st && ['ended', 'survey', 'callback', 'abandoned'].includes(st)) setEnded(iid)
  }, [iid])
  useEffect(() => {
    if (!iid) return
    load()
    const t = setInterval(load, ended ? 6000 : 1000)
    return () => clearInterval(t)
  }, [iid, load, ended])
  useEffect(() => { if (!iid) return; supabase.rpc('csr_cx_customer', { p_interaction: iid }).then(({ data }) => setCust(data || null)) }, [iid])
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { const b = trBox.current; if (b && tab === 'transcript') b.scrollTop = b.scrollHeight }, [lines, tab])

  const i = live?.interaction
  const parts = live?.participants || []
  const customer = parts.find(p => p.kind === 'customer' && !p.left_at)
  const pending = parts.filter(p => ['transfer', 'external'].includes(p.kind) && !p.left_at)
  const assist = useMemo(() => [...(live?.assist || [])].reverse().find(a => a.kind === 'assist')?.payload || null, [live])
  const alerts = useMemo(() => (live?.assist || []).filter(a => a.kind === 'alert').slice(-3).reverse(), [live])
  const wrap = useMemo(() => [...(live?.assist || [])].reverse().find(a => a.kind === 'wrap')?.payload || i?.ai_wrap || null, [live, i])
  const liveNow = i && ['connected', 'held'].includes(i.status)

  // 11/25: while the panel is open it is docked as the right column; the call screen makes room (body.cx-docked)
  const showing = !!(voice && iid && i && open && (liveNow || ended))
  useEffect(() => {
    document.body.classList.toggle('cx-docked', showing)
    return () => document.body.classList.remove('cx-docked')
  }, [showing])

  if (!voice || !iid || !i) return null
  if (!liveNow && !ended) return null

  async function act(action, extra = {}, label = action) {
    setBusy(label); setErr('')
    try { await cxControl(action, iid, extra); await load() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  async function raiseHand() {
    setBusy('hand')
    const { error } = await supabase.rpc('csr_cx_raise_hand', { p_interaction: iid, p_note: null })
    setBusy(''); if (error) setErr(error.message); else setErr('Your supervisor was notified.')
  }
  async function reportSpam() {
    if (!window.confirm('Block this number as spam and end the call?')) return
    setBusy('spam')
    const { error } = await supabase.rpc('cx_block_from_call', { p_interaction: iid, p_reason: null })
    if (error) { setBusy(''); setErr(error.message); return }
    try { await cxControl('end', iid, {}) } catch { /* already ended */ }
    setBusy(''); setErr('Number blocked for 30 days.'); load()
  }
  const talk = i.answered_at ? Math.round((Date.now() - new Date(i.answered_at).getTime()) / 1000) : 0
  const holdSecs = i.hold_started_at ? Math.round((Date.now() - new Date(i.hold_started_at).getTime()) / 1000) : 0

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...S.tab, background: i.needs_help ? '#b45309' : G }}>
        {liveNow ? `● Live call · ${mmss(talk)}` : 'Call summary'}{alerts.length && liveNow ? ' · ⚠' : ''}
      </button>
    )
  }

  return (
    <aside style={S.panel} aria-label="Live call">
      <div style={S.head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.6 }}>{liveNow ? (i.status === 'held' ? 'On hold' : 'Live call') : 'Call ended'} · {i.direction === 'in' ? 'Inbound' : 'Outbound'}</div>
          <div style={{ fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.customer_name || cust?.name || 'Caller'}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{[i.line_name || i.campaign_name, i.queue].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {liveNow && <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            {Number.isFinite(Number(assist?.sentiment)) && <span title="Caller mood" style={{ fontSize: 16 }}>{assist.sentiment >= 0.3 ? '🙂' : assist.sentiment <= -0.3 ? '🙁' : '😐'}</span>}
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 18 }}>{mmss(talk)}</span>
          </div>}
          <button onClick={() => setOpen(false)} style={S.min} aria-label="Minimize">–</button>
          {!liveNow && <button onClick={() => { setIid(null); setEnded(null); setLive(null) }} style={S.min} aria-label="Close">×</button>}
        </div>
      </div>

      {liveNow && (
        <div style={S.badges}>
          {i.recording_paused ? <span style={{ ...S.badge, background: 'light-dark(#fef3c7, #393213)', color: 'light-dark(#92400e, #e1712d)' }}>⏸ Recording paused</span> : i.recording_sid ? <span style={S.badge}>● Recording</span> : null}
          {i.transcribing ? <span style={S.badge}>Live transcript on</span> : <button style={S.badgeBtn} onClick={() => act('transcribe_on', {}, 'tr')}>Turn on live transcript</button>}
          {i.status === 'held' && <span style={{ ...S.badge, background: 'light-dark(#fee2e2, #391313)', color: 'light-dark(#991b1b, #e46767)' }}>Caller on hold {mmss(holdSecs)}</span>}
          {/^machine|^fax/.test(i.pending?.answered_by || '') && <span style={{ ...S.badge, background: 'light-dark(#e0f2fe, #132a39)', color: 'light-dark(#075985, #1f99db)' }}>{i.pending?.vm_dropped ? '📼 Voicemail left' : '📼 Answering machine'}</span>}
          {i.pending?.answered_by === 'human' && <span style={{ ...S.badge, background: 'light-dark(#dcfce7, #133920)', color: 'light-dark(#166534, #29bc61)' }}>Live person</span>}
          {parts.filter(p => p.kind === 'supervisor' && !p.left_at && p.mode !== 'listen').map(p => <span key={p.id} style={{ ...S.badge, background: 'light-dark(#ede9fe, #1a1339)', color: 'light-dark(#5b21b6, #a479e7)' }}>{p.label} {p.mode === 'whisper' ? 'is coaching you' : 'joined'}</span>)}
        </div>
      )}

      {liveNow && (
        <div style={S.controls}>
          <button onClick={() => voice.toggleMute()} style={{ ...S.ctl, ...(voice.muted ? { background: '#fef3c7', color: '#92400e', borderColor: '#f59e0b' } : {}) }}>{voice.muted ? '🔇 Unmute' : '🎙 Mute'}</button>
          <button disabled={!!busy || !customer} onClick={() => act(i.status === 'held' ? 'unhold' : 'hold', {}, 'hold')} style={S.ctl}>{i.status === 'held' ? '▶ Resume' : '⏸ Hold'}</button>
          <button disabled={!!busy} onClick={() => setXfer(x => !x)} style={S.ctl}>⇄ Transfer</button>
          <button disabled={!!busy || !i.recording_sid} onClick={() => act(i.recording_paused ? 'resume_recording' : 'pause_recording', {}, 'rec')} style={S.ctl} title="Pause while the customer reads card details">{i.recording_paused ? '● Resume rec' : '💳 Pause rec'}</button>
          <button disabled={!!busy || i.needs_help} onClick={raiseHand} style={S.ctl}>✋ {i.needs_help ? 'Help asked' : 'Need help'}</button>
          {i.direction === 'out' && <button disabled={!!busy || i.pending?.vm_dropped} onClick={() => act('vm_drop', {}, 'vm')} style={S.ctl} title="Plays the campaign’s voicemail message to the machine and frees you for the next call">📼 Leave voicemail</button>}
          {i.direction === 'in' && <button disabled={!!busy} onClick={reportSpam} style={S.ctl} title="Block this number and end the call">🚫 Spam</button>}
          <button disabled={!!busy} onClick={() => { if (window.confirm('End this call for everyone?')) act('end', {}, 'end') }} style={{ ...S.ctl, background: '#dc2626', color: '#fff', borderColor: '#dc2626' }}>End</button>
        </div>
      )}
      {liveNow && pending.length > 0 && (
        <div style={S.pending}>
          {pending.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <span><b>{p.label}</b> · {p.status === 'ringing' ? 'ringing…' : 'on the line'}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {p.status === 'connected' && <button style={S.small} disabled={!!busy} onClick={() => act('complete_transfer', {}, 'done')}>Complete transfer</button>}
                <button style={S.small} disabled={!!busy} onClick={() => act('cancel_transfer', { participant_id: p.id }, 'cancel')}>{p.status === 'connected' ? 'Drop them' : 'Cancel'}</button>
              </span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 4 }}>Warm transfer: talk first, then Complete transfer. The caller hears hold music until then.</div>
        </div>
      )}
      {xfer && liveNow && <TransferBox iid={iid} onDone={() => { setXfer(false); load() }} onErr={setErr} inbound={i.direction === 'in'} />}
      {err && <div style={{ ...S.note, color: /notified|blocked/.test(err) ? 'light-dark(#166534, #29bc61)' : 'light-dark(#b91c1c, #e86464)' }}>{err}</div>}

      {alerts.length > 0 && liveNow && (
        <div style={S.alert}>⚠ {alerts[0].payload?.text}</div>
      )}

      {liveNow && (
        <div style={{ margin: '0 14px 10px' }}>
          {assist ? (
            <div style={S.next}>
              <div style={S.cap}>Next</div>
              <div>{assist.next}</div>
              {assist.say && <div style={{ fontWeight: 500, fontSize: 13.5, marginTop: 6, color: 'light-dark(#0f172a, #e8eef0)' }}>“{assist.say}”</div>}
              <button style={{ ...S.small, marginTop: 8, fontSize: 11.5, padding: '3px 8px' }} onClick={() => cxAssistNow(iid).then(load).catch(e => setErr(e.message))}>Refresh</button>
            </div>
          ) : (
            <div style={S.empty}>{i.transcribing ? 'Suggestions appear a few seconds after the caller starts talking.' : 'Turn on live transcript to get suggestions while you talk.'}</div>
          )}
        </div>
      )}

      <div style={S.tabs}>
        {(liveNow ? [['check', `Checklist${(assist?.checklist || []).length ? ` · ${assist.checklist.filter(c => c.done).length} of ${assist.checklist.length}` : ''}`], ['transcript', 'Transcript'], ['facts', 'Facts'], ['customer', 'History']] : [['wrap', 'Wrap-up'], ['transcript', 'Transcript'], ['customer', 'Caller']]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tabBtn, ...((tab === k || (!liveNow && ['assist', 'check', 'facts'].includes(tab) && k === 'wrap')) ? S.tabOn : {}) }}>{l}</button>
        ))}
      </div>

      <div style={S.body}>
        {(tab === 'check' && liveNow) && (
          (assist?.checklist || []).length > 0 ? (
            <div>
              {assist.checklist.map(c => (
                <div key={c.key || c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid light-dark(#f1f5f9, #222c31)' }}>
                  <span style={{ width: 16, height: 16, flex: 'none', borderRadius: '50%', boxSizing: 'border-box', ...(c.done ? { background: '#16a34a' } : { border: '2px solid light-dark(#cbd5e1, #3a464c)' }) }} />
                  <span style={{ fontSize: 13.5, color: c.done ? 'light-dark(#64748b, #9fb4bb)' : 'inherit' }}>{c.label}</span>
                </div>
              ))}
            </div>
          ) : <div style={S.empty}>The checklist fills in once the caller starts talking.</div>
        )}

        {(tab === 'facts' && liveNow) && (
          (assist?.facts || []).length > 0
            ? <div>{assist.facts.map((f, n) => <div key={n} style={{ fontSize: 13, padding: '4px 0' }}><b>{f.label}:</b> {f.value}</div>)}</div>
            : <div style={S.empty}>No facts needed yet.</div>
        )}

        {tab === 'transcript' && (
          <div ref={trBox} style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 6 }}>
            {lines.length === 0 && <div style={S.empty}>{i.transcribing ? 'Listening…' : 'No transcript for this call.'}</div>}
            {lines.map(l => (
              <div key={l.id} style={{ display: 'flex', justifyContent: l.speaker === 'customer' ? 'flex-start' : 'flex-end' }}>
                <div style={{ ...S.bubble, background: l.speaker === 'customer' ? 'light-dark(#f1f5f9, #222c31)' : 'light-dark(#E6F0EA, #1d3a2e)', color: 'light-dark(#0f172a, #e8eef0)' }}>
                  <div style={{ fontSize: 10.5, opacity: 0.6, marginBottom: 2 }}>{l.speaker === 'customer' ? 'Caller' : 'You'}</div>{l.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'customer' && (
          <div style={{ display: 'grid', gap: 8 }}>
            {!cust ? <div style={S.empty}>Loading…</div> : (
              <>
                <div style={{ fontSize: 13 }}><b>{cust.name || 'Unknown caller'}</b>{cust.phone ? ` · …${String(cust.phone).slice(-4)}` : ''}</div>
                {cust.lead && (
                  <div style={S.box}>
                    <div style={S.cap}>Lead</div>
                    <div style={{ fontSize: 13 }}>{cust.lead.reason || '—'}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{[cust.lead.source, cust.lead.list, cust.lead.attempts ? `${cust.lead.attempts} attempts` : null, cust.lead.last_disposition].filter(Boolean).join(' · ')}</div>
                  </div>
                )}
                <div style={S.cap}>History</div>
                {(cust.history || []).length === 0 && <div style={S.empty}>First time we’ve talked to this number.</div>}
                {(cust.history || []).slice(0, 12).map((h, n) => (
                  <div key={n} style={S.box}>
                    <div style={{ fontSize: 12.5 }}><b>{h.kind}</b> · {h.at ? ago(h.at) : ''}{h.who ? ` · ${h.who}` : ''}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{[h.status, h.brand, h.secs ? `${Math.round(h.secs / 60)} min` : null].filter(Boolean).join(' · ')}</div>
                    {h.summary && <div style={{ fontSize: 12.5, marginTop: 3 }}>{h.summary}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {(!liveNow && ['wrap', 'assist', 'check', 'facts'].includes(tab)) && (
          wrap ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={S.next}><div style={S.cap}>AI summary</div>{wrap.summary}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {wrap.disposition && <span style={{ ...S.chip, background: wrap.booked ? 'light-dark(#dcfce7, #133920)' : 'light-dark(#f1f5f9, #1b2327)' }}>Suggested disposition: <b>{wrap.disposition}</b></span>}
              </div>
              {(wrap.follow_ups || []).length > 0 && <div><div style={S.cap}>Follow-ups</div>{wrap.follow_ups.map((f, n) => <div key={n} style={{ fontSize: 13 }}>• {f}</div>)}</div>}
              {wrap.notes && (
                <div><div style={S.cap}>Notes</div><div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{wrap.notes}</div>
                  <button style={{ ...S.small, marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(wrap.notes)}>Copy notes</button></div>
              )}
              {wrap.coaching && <div style={S.say}><div style={S.cap}>Coach’s note</div>{wrap.coaching}</div>}
              <div style={{ fontSize: 11.5, opacity: 0.7 }}>Pick the disposition on the call screen — the AI only suggests it.</div>
            </div>
          ) : (
            <div style={S.empty}>
              {lines.length ? 'Writing the summary…' : 'No transcript on this call, so there is no AI summary.'}
              {lines.length > 0 && <div><button style={{ ...S.small, marginTop: 8 }} onClick={() => cxWrapNow(iid).then(load).catch(e => setErr(e.message))}>Build it now</button></div>}
            </div>
          )
        )}
      </div>
      {mine?.kind === 'transfer' && liveNow && <div style={S.note}>This call was transferred to you.</div>}
    </aside>
  )
}

function TransferBox({ iid, onDone, onErr, inbound }) {
  const [dir, setDir] = useState(null)
  const [type, setType] = useState('warm')
  const [num, setNum] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.rpc('csr_cx_directory', { p_interaction: iid }).then(({ data, error }) => { if (error) onErr(error.message); else setDir(data) }) }, [iid, onErr])
  async function go(target) {
    setBusy(true)
    try { await cxControl('transfer', iid, { type, target }); onDone() } catch (e) { onErr(e.message) } finally { setBusy(false) }
  }
  const people = (dir?.people || []).filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={S.xfer}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[['warm', 'Warm (talk first)'], ['cold', 'Cold (send now)'], ['conference', 'Add to call']].map(([k, l]) => (
          <button key={k} onClick={() => setType(k)} style={{ ...S.tabBtn, ...(type === k ? S.tabOn : {}), flex: 1, fontSize: 11.5 }}>{l}</button>
        ))}
      </div>
      {!dir ? <div style={S.empty}>Loading…</div> : (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a teammate…" style={S.input} />
          <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
            {people.map(p => (
              <button key={p.id} disabled={busy} onClick={() => go({ profile_id: p.id })} style={S.row}>
                <span>{p.name}{p.location ? <span style={{ opacity: 0.6 }}> · {p.location}</span> : null}</span>
                <span style={{ fontSize: 11, color: p.state === 'ready' ? '#15803d' : '#64748b' }}>{p.state === 'ready' ? 'Ready' : p.state === 'on_call' ? 'On a call' : p.state === 'not_ready' ? (p.reason || 'Not ready') : 'Offline'}</span>
              </button>
            ))}
            {people.length === 0 && <div style={S.empty}>Nobody found.</div>}
          </div>
          {inbound && (dir.queues || []).length > 0 && (
            <>
              <div style={{ ...S.cap, marginTop: 8 }}>Send back to a queue</div>
              {dir.queues.map(x => <button key={x.line_id + x.queue} disabled={busy} onClick={() => go({ line_id: x.line_id, queue: x.queue })} style={S.row}><span>{x.label}</span><span style={{ fontSize: 11, opacity: 0.6 }}>{x.line}</span></button>)}
            </>
          )}
          {(dir.numbers || []).length > 0 && (
            <>
              <div style={{ ...S.cap, marginTop: 8 }}>Outside numbers</div>
              {dir.numbers.map((x, n) => <button key={n} disabled={busy} onClick={() => go({ number: x.number, label: x.label })} style={S.row}><span>{x.label}</span><span style={{ fontSize: 11, opacity: 0.6 }}>…{String(x.number).slice(-4)}</span></button>)}
            </>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input value={num} onChange={e => setNum(e.target.value)} placeholder="Other number (admins)" inputMode="tel" style={{ ...S.input, flex: 1 }} />
            <button disabled={busy || num.replace(/\D/g, '').length < 10} onClick={() => go({ number: num })} style={S.small}>Call</button>
          </div>
        </>
      )}
    </div>
  )
}

const S = {
  panel: { position: 'fixed', top: 72, right: 16, bottom: 16, zIndex: 999, width: 380, maxWidth: 'calc(100vw - 32px)', overflowY: 'auto', background: 'light-dark(#fff, #161d21)', color: 'light-dark(#0f172a, #e8eef0)', borderRadius: 16, border: '1px solid rgba(20,48,42,0.15)', boxShadow: '0 16px 48px rgba(0,0,0,0.22)', fontFamily: 'inherit' },
  head: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: G, color: '#fff', borderRadius: '16px 16px 0 0' },
  min: { background: 'transparent', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', padding: '0 4px', opacity: 0.85 },
  tab: { position: 'fixed', top: 72, right: 16, zIndex: 999, color: '#fff', border: 'none', borderRadius: 999, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' },
  badges: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 14px 0' },
  badge: { fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'light-dark(#E6F0EA, #222c31)', color: GT },
  badgeBtn: { fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'light-dark(#fff, #161d21)', color: GT, border: `1px dashed ${GT}`, cursor: 'pointer' },
  controls: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, padding: '10px 14px' },
  ctl: { padding: '8px 2px', fontSize: 11.5, fontWeight: 700, borderRadius: 10, border: '1px solid rgba(100,116,139,0.35)', background: 'light-dark(#fff, #161d21)', color: 'light-dark(#0f172a, #e8eef0)', cursor: 'pointer' },
  pending: { margin: '0 14px 8px', padding: 10, borderRadius: 10, background: 'light-dark(#f8fafc, #161d21)', border: '1px solid light-dark(#e2e8f0, #2a3439)', fontSize: 13, display: 'grid', gap: 6 },
  xfer: { margin: '0 14px 8px', padding: 10, borderRadius: 10, background: 'light-dark(#f8fafc, #161d21)', border: '1px solid light-dark(#e2e8f0, #2a3439)' },
  alert: { margin: '0 14px 8px', padding: '8px 10px', borderRadius: 10, background: 'light-dark(#fff7ed, #392813)', color: 'light-dark(#9a3412, #e56f48)', fontSize: 13, fontWeight: 600, border: '1px solid light-dark(#fed7aa, #64492b)' },
  note: { margin: '0 14px 8px', fontSize: 12.5 },
  tabs: { display: 'flex', gap: 4, padding: '0 14px', borderBottom: '1px solid light-dark(#e2e8f0, #2a3439)' },
  tabBtn: { padding: '8px 10px', fontSize: 12.5, fontWeight: 700, border: 'none', background: 'transparent', color: 'light-dark(#64748b, #9fb4bb)', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabOn: { color: GT, borderBottom: `2px solid ${GT}` },
  body: { padding: 14 },
  cap: { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'light-dark(#64748b, #9fb4bb)', marginBottom: 4 },
  next: { padding: 10, borderRadius: 12, background: 'light-dark(#E6F0EA, #222c31)', color: GT, fontWeight: 700, fontSize: 14, lineHeight: 1.4 },
  say: { padding: 10, borderRadius: 12, background: 'light-dark(#f8fafc, #161d21)', border: '1px solid light-dark(#e2e8f0, #2a3439)', fontSize: 13.5, lineHeight: 1.45 },
  chip: { fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'light-dark(#f1f5f9, #1b2327)', color: 'light-dark(#334155, #b3c1c7)' },
  empty: { fontSize: 13, color: 'light-dark(#64748b, #9fb4bb)', padding: '6px 0' },
  bubble: { maxWidth: '85%', padding: '6px 10px', borderRadius: 12, fontSize: 13, lineHeight: 1.4 },
  box: { padding: 8, borderRadius: 10, background: 'light-dark(#f8fafc, #161d21)', border: '1px solid light-dark(#e2e8f0, #2a3439)' },
  small: { padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'light-dark(#fff, #161d21)', cursor: 'pointer', color: 'light-dark(#0f172a, #e8eef0)' },
  input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid light-dark(#cbd5e1, #3a464c)' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '7px 8px', fontSize: 13, border: 'none', borderBottom: '1px solid light-dark(#eef2f7, #2a3439)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'light-dark(#0f172a, #e8eef0)' },
}
