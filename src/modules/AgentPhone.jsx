// ============================================================
//  AgentPhone — "My phone", the agent's whole call screen on one page (Becky's merged mockup,
//  "Agent · Phone", 11/25 — staging).
//
//  On a call:  Current call (caller, history, controls) · Live transcript · Assist + Checklist + Up next,
//              with the guided call screen (script + disposition + notes) right under it.
//  Between calls: the agent's phone (log in for the day, Ready / Not ready, dial pad, lines, today,
//              recent calls, tasks, calls from your lists) with Up next beside it.
//
//  Built from pieces that already exist and keep working the same everywhere else:
//   • CsrPhone (csr_phone_get / csr_day_* / csr_set_status / csr_manual_dial, guided call screen)
//   • the CX engine live feed (csr_cx_my_call, csr_cx_live, csr_cx_customer, cx-control, cx-transcript)
//     — the floating live-call panel stays hidden while this page is open, so nothing shows twice.
//   • agent_up_next() — outbound work waiting in the agent's lists.
//  Live transcript / Assist only exist on lines and campaigns switched to the Advanced engine.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useVoice } from '../lib/voice'
import { cxControl, cxAssistNow, cxWrapNow } from '../lib/cx'
import { PHONE_PAGE, TransferBox } from '../components/CxCallPanel'
import CsrPhone from './CsrPhone'

const A = '#0089A6'
const mmss = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`
const ago = t => { const s = Math.round((Date.now() - new Date(t).getTime()) / 1000); return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const KIND = { missed: 'Missed calls', s2l: 'Speed to lead', speed_to_lead: 'Speed to lead', callback: 'Callbacks', callbacks: 'Callbacks', quote: 'Open quotes', quotes: 'Open quotes' }

function Info({ text }) { return <span className="ap-i" title={text} aria-label={text} role="img">i</span> }

// Live feed for the agent's current Advanced-engine call (same RPCs as the floating panel).
function useCxCall(voice) {
  const [iid, setIid] = useState(null)
  const [live, setLive] = useState(null)
  const [lines, setLines] = useState([])
  const [cust, setCust] = useState(null)
  const [ended, setEnded] = useState(false)
  const [err, setErr] = useState('')
  const lastId = useRef(0)
  const active = !!(voice && (voice.busy || voice.inboundCall || voice.incoming))
  useEffect(() => {
    let alive = true
    const run = async () => {
      const { data } = await supabase.rpc('csr_cx_my_call')
      if (!alive) return
      if (data?.interaction_id && data.status === 'connected' && data.interaction_id !== iid) {
        setIid(data.interaction_id); setLines([]); lastId.current = 0; setLive(null); setCust(null); setEnded(false)
      }
    }
    run()
    const t = setInterval(run, active ? 2500 : 10000)
    return () => { alive = false; clearInterval(t) }
  }, [active, iid])
  const load = useCallback(async () => {
    if (!iid) return
    const { data, error } = await supabase.rpc('csr_cx_live', { p_interaction: iid, p_after: lastId.current })
    if (error) { setErr(error.message); return }
    setErr(''); setLive(data)
    const add = data?.transcript || []
    if (add.length) { lastId.current = add[add.length - 1].id; setLines(l => [...l, ...add].slice(-400)) }
    if (['ended', 'survey', 'callback', 'abandoned'].includes(data?.interaction?.status)) setEnded(true)
  }, [iid])
  useEffect(() => { if (!iid) return; load(); const t = setInterval(load, ended ? 6000 : 1500); return () => clearInterval(t) }, [iid, load, ended])
  useEffect(() => { if (!iid) return; supabase.rpc('csr_cx_customer', { p_interaction: iid }).then(({ data }) => setCust(data || null)) }, [iid])
  const clear = () => { setIid(null); setLive(null); setLines([]); setCust(null); setEnded(false) }
  return { iid, live, lines, cust, ended, err, setErr, load, clear }
}

export default function AgentPhone() {
  const voice = useVoice()
  const navigate = useNavigate()
  const cx = useCxCall(voice)
  const [upNext, setUpNext] = useState(null)
  const [busy, setBusy] = useState('')
  const [xfer, setXfer] = useState(false)
  const [, tick] = useState(0)
  const trBox = useRef(null)

  // the floating live-call panel stays out of the way while this page is open
  useEffect(() => { PHONE_PAGE.on = true; return () => { PHONE_PAGE.on = false } }, [])
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    let on = true
    const run = () => supabase.rpc('agent_up_next').then(({ data }) => { if (on) setUpNext(data || []) })
    run(); const t = setInterval(run, 30000)
    return () => { on = false; clearInterval(t) }
  }, [])
  useEffect(() => { const b = trBox.current; if (b) b.scrollTop = b.scrollHeight }, [cx.lines])

  const i = cx.live?.interaction
  const parts = cx.live?.participants || []
  const customer = parts.find(p => p.kind === 'customer' && !p.left_at)
  const assist = useMemo(() => [...(cx.live?.assist || [])].reverse().find(a => a.kind === 'assist')?.payload || null, [cx.live])
  const alerts = useMemo(() => (cx.live?.assist || []).filter(a => a.kind === 'alert').slice(-2).reverse(), [cx.live])
  const wrap = useMemo(() => [...(cx.live?.assist || [])].reverse().find(a => a.kind === 'wrap')?.payload || i?.ai_wrap || null, [cx.live, i])
  const liveNow = !!(i && ['connected', 'held'].includes(i.status))
  const showCall = !!(i && (liveNow || cx.ended))
  const talk = i?.answered_at ? Math.round((Date.now() - new Date(i.answered_at).getTime()) / 1000) : 0
  const plainCall = !showCall && voice?.busy   // a call on the standard engine (no transcript / assist)

  async function act(action, extra = {}, label = action) {
    setBusy(label); cx.setErr('')
    try { await cxControl(action, cx.iid, extra); await cx.load() } catch (e) { cx.setErr(e.message) } finally { setBusy('') }
  }
  async function raiseHand() {
    setBusy('hand')
    const { error } = await supabase.rpc('csr_cx_raise_hand', { p_interaction: cx.iid, p_note: null })
    setBusy(''); cx.setErr(error ? error.message : 'Your supervisor was notified.')
  }

  const pill = liveNow
    ? <span className="ap-pill ap-live"><i />{i.status === 'held' ? 'Caller on hold' : 'On a call'} · {mmss(talk)}</span>
    : plainCall ? <span className="ap-pill ap-live"><i />On a call · {mmss(voice.seconds || 0)}</span>
      : cx.ended && i ? <span className="ap-pill ap-wrap"><i />Call ended · wrap up</span> : null

  const upNextCard = (
    <div className="ap-card">
      <h2>Up next<Info text="Outbound work waiting in your lists, in the order your admin set. It comes to you between calls when you're Ready." /></h2>
      {upNext === null && <p className="ap-mut">Loading…</p>}
      {upNext && upNext.length === 0 && <p className="ap-mut">Nothing waiting in your lists.</p>}
      {(upNext || []).map(q => (
        <div key={q.kind + q.name} className="ap-qrow">
          <span>{KIND[q.kind] || q.name}{KIND[q.kind] && q.name ? <small> · {q.name}</small> : null}</span>
          <b title={`${q.due} due now of ${q.n} waiting`}>{q.due}{q.n > q.due ? <small> / {q.n}</small> : null}</b>
        </div>
      ))}
    </div>
  )

  return (
    <div className="ap">
      <header className="ap-head">
        <div className="ap-title"><h1>Phone</h1>{pill}</div>
        <div className="ap-tools">
          <button className="ap-btn" onClick={() => navigate('/knowledge')}>Knowledge base</button>
          <button className="ap-btn" onClick={() => navigate('/schedule')}>My schedule</button>
        </div>
      </header>

      {showCall && (
        <div className="ap-grid">
          {/* ---- current call ---- */}
          <section className="ap-card" aria-label="Current call">
            <div className="ap-callhead">
              <div>
                <div className="ap-cap">{i.direction === 'in' ? 'Inbound' : 'Outbound'}{i.line_name || i.campaign_name ? ` · ${i.line_name || i.campaign_name}` : ''}</div>
                <div className="ap-name">{i.customer_name || cust?.name || 'Caller'}</div>
                <div className="ap-mut">{cust?.phone ? `…${String(cust.phone).slice(-4)}` : ''}{[i.brand, i.location].filter(Boolean).length ? ` · ${[i.brand, i.location].filter(Boolean).join(' · ')}` : ''}</div>
              </div>
              {(cust?.history || []).length > 0
                ? <span className="ap-tag">Returning caller</span>
                : cust ? <span className="ap-tag ap-tag-new">First call</span> : null}
            </div>
            <div className="ap-two">
              <div className="ap-mini"><div className="ap-cap">{cust?.lead ? 'Lead' : 'Last contact'}</div>
                {cust?.lead ? <><b>{cust.lead.reason || '—'}</b><span>{[cust.lead.source, cust.lead.list].filter(Boolean).join(' · ')}</span></>
                  : (cust?.history || [])[0] ? <><b>{cust.history[0].kind}{cust.history[0].status ? ` · ${cust.history[0].status}` : ''}</b><span>{cust.history[0].at ? ago(cust.history[0].at) : ''}{cust.history[0].who ? ` · ${cust.history[0].who}` : ''}</span></>
                    : <><b>None</b><span>New to us</span></>}
              </div>
              <div className="ap-mini"><div className="ap-cap">Past contacts</div>
                <b>{(cust?.history || []).length}</b>
                <span>{(cust?.history || [])[0]?.summary ? String(cust.history[0].summary).slice(0, 60) : 'calls and messages'}</span>
              </div>
            </div>
            {liveNow && (
              <div className="ap-ctl">
                <button className="ap-btn" disabled={!!busy || !voice} onClick={() => voice.toggleMute()}>{voice?.muted ? 'Unmute' : 'Mute'}</button>
                <button className="ap-btn" disabled={!!busy || !customer} onClick={() => act(i.status === 'held' ? 'unhold' : 'hold', {}, 'hold')}>{i.status === 'held' ? 'Resume' : 'Hold'}</button>
                <button className="ap-btn" disabled={!!busy || !i.recording_sid} title="Pause while the customer reads card details" onClick={() => act(i.recording_paused ? 'resume_recording' : 'pause_recording', {}, 'rec')}>{i.recording_paused ? 'Resume rec' : 'Pause rec'}</button>
                <button className="ap-btn ap-red" disabled={!!busy} onClick={() => { if (window.confirm('End this call?')) act('end', {}, 'end') }}>End call</button>
                <button className="ap-btn" disabled={!!busy || i.needs_help} onClick={raiseHand}>{i.needs_help ? 'Help asked' : 'Need help'}</button>
                <button className="ap-btn" disabled={!!busy} onClick={() => setXfer(x => !x)}>Transfer</button>
              </div>
            )}
            {xfer && liveNow && <TransferBox iid={cx.iid} inbound={i.direction === 'in'} onErr={cx.setErr} onDone={() => { setXfer(false); cx.load() }} />}
            {liveNow && parts.filter(p => ['transfer', 'external'].includes(p.kind) && !p.left_at).map(p => (
              <div key={p.id} className="ap-note" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span><b>{p.label}</b> · {p.status === 'ringing' ? 'ringing…' : 'on the line'}</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {p.status === 'connected' && <button className="ap-btn ap-sm" disabled={!!busy} onClick={() => act('complete_transfer', {}, 'done')}>Complete transfer</button>}
                  <button className="ap-btn ap-sm" disabled={!!busy} onClick={() => act('cancel_transfer', { participant_id: p.id }, 'cancel')}>{p.status === 'connected' ? 'Drop them' : 'Cancel'}</button>
                </span>
              </div>
            ))}
            {cx.err && <div className={'ap-note' + (/notified/.test(cx.err) ? ' ap-ok' : '')}>{cx.err}</div>}
            {alerts.length > 0 && liveNow && <div className="ap-alert">⚠ {alerts[0].payload?.text}</div>}
            {!liveNow && (
              <div className="ap-wrapbox">
                <div className="ap-cap">AI summary</div>
                {wrap ? (<>
                  <p>{wrap.summary}</p>
                  {wrap.disposition && <p>Suggested disposition: <b>{wrap.disposition}</b> (pick it on the call screen below).</p>}
                  {(wrap.follow_ups || []).map((f, n) => <p key={n}>• {f}</p>)}
                  {wrap.notes && <button className="ap-btn ap-sm" onClick={() => navigator.clipboard?.writeText(wrap.notes)}>Copy notes</button>}
                  {wrap.coaching && <p className="ap-mut">Coach's note: {wrap.coaching}</p>}
                </>) : (<>
                  <p className="ap-mut">{cx.lines.length ? 'Writing the summary…' : 'No transcript on this call, so there is no AI summary.'}</p>
                  {cx.lines.length > 0 && <button className="ap-btn ap-sm" onClick={() => cxWrapNow(cx.iid).then(cx.load).catch(e => cx.setErr(e.message))}>Build it now</button>}
                </>)}
                <button className="ap-btn ap-sm" style={{ marginTop: 6 }} onClick={cx.clear}>Done</button>
              </div>
            )}
          </section>

          {/* ---- live transcript ---- */}
          <section className="ap-card" aria-label="Live transcript">
            <div className="ap-rowhead">
              <h2>Live transcript<Info text="Words from the call as they're spoken, transcribed in real time. Saved with the call for AI QA." /></h2>
              {liveNow && (i.transcribing ? <span className="ap-mut" style={{ fontSize: 12 }}>{i.recording_paused ? 'Recording paused' : 'Recording'}</span>
                : <button className="ap-btn ap-sm" onClick={() => act('transcribe_on', {}, 'tr')}>Turn on</button>)}
            </div>
            <div className="ap-tr" ref={trBox}>
              {cx.lines.length === 0 && <p className="ap-mut">{i.transcribing ? 'Listening…' : 'Live transcript is off for this call.'}</p>}
              {cx.lines.map(l => (
                <div key={l.id} className={'ap-line ' + (l.speaker === 'customer' ? 'them' : 'me')}>
                  <span>{l.speaker === 'customer' ? (i.customer_name || 'Caller') : 'You'}</span>
                  <p>{l.text}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ---- assist, checklist, up next ---- */}
          <section className="ap-col">
            <div className="ap-card ap-assist">
              <h2>Assist<Info text="AI suggestions from what's said on the call and your knowledge base. Only you can see these." /></h2>
              {!liveNow ? <p className="ap-mut">Assist runs during the call.</p> : assist ? (<>
                <div className="ap-tip"><b>Do this now:</b> {assist.next}</div>
                {assist.say && <div className="ap-tip"><b>Try saying:</b> “{assist.say}”</div>}
                <div className="ap-chips">
                  {assist.intent && <span>{String(assist.intent).replace(/_/g, ' ')}</span>}
                  {Number.isFinite(Number(assist.booking_likelihood)) && <span>Booking chance {assist.booking_likelihood}%</span>}
                  {assist.objection && <span>Objection: {assist.objection}</span>}
                </div>
                {(assist.facts || []).map((f, n) => <div key={n} className="ap-fact"><b>{f.label}:</b> {f.value}</div>)}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="ap-btn ap-sm" onClick={() => cxAssistNow(cx.iid).then(cx.load).catch(e => cx.setErr(e.message))}>Refresh</button>
                  <button className="ap-btn ap-sm" onClick={() => window.open('/knowledge', '_blank', 'noopener')}>Search knowledge base</button>
                </div>
              </>) : <p className="ap-mut">{i.transcribing ? 'Suggestions appear a few seconds after the caller starts talking.' : 'Turn on live transcript to get suggestions.'}</p>}
            </div>
            <div className="ap-card">
              <h2>Checklist<Info text="Your QA call-flow steps. They tick on their own as the AI hears each one." /></h2>
              {(assist?.checklist || []).length === 0
                ? <p className="ap-mut">{liveNow ? 'Shows once the AI starts listening.' : '—'}</p>
                : assist.checklist.map(c => (
                  <div key={c.key || c.label} className="ap-step"><span className={c.done ? 'done' : ''}>{c.done ? '✓' : ''}</span>{c.label}</div>
                ))}
            </div>
            {upNextCard}
          </section>
        </div>
      )}

      {plainCall && (
        <div className="ap-banner">This call is on the standard phone engine, so there is no live transcript or Assist. Turn on the Advanced engine for this line or campaign in Phone setup to get them.</div>
      )}

      <div className={showCall ? '' : 'ap-home'}>
        <div className="ap-phone"><CsrPhone accent="#021116" /></div>
        {!showCall && <aside className="ap-col">{upNextCard}
          <div className="ap-card">
            <h2>Get better between calls</h2>
            <button className="ov-link" onClick={() => navigate('/my-call-reviews')}>My call reviews →</button>
            <button className="ov-link" onClick={() => navigate('/scorecard')}>My scorecard →</button>
            <button className="ov-link" onClick={() => navigate('/coaching')}>Coaching →</button>
          </div>
        </aside>}
      </div>
    </div>
  )
}
