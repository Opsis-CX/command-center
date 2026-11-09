import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// AI SPEED TO LEAD (2026-11-09)
// A new lead arrives → the AI agent calls in seconds (any hour, inside the lead's legal calling window),
// confirms the need, books on the calendar, warm-transfers to a live Opsis CX agent when a person is needed,
// leaves a voicemail and re-dials when nobody answers. Whatever the AI doesn't resolve drops into the live
// dialer queue with the AI's summary attached.
//
// Backend: edge function s2l-ai (settings, test calls, sweep) + RPCs s2l_ai_feed / s2l_ai_stats.
// Leads come from lead-intake (sources with ai_first = true) or the "Test the AI" form here.
//
// Two homes (2026-11-09): Command Center (/ai-speed-to-lead, staff) and the client portal (garageco.opsiscx.com →
// AI Speed to Lead), where data goes through opsis-portal-ops scoped to the login's client/brand. Portal viewers
// can only look; managers can run test calls; portal admins can also change Settings.
// ============================================================

const OUTCOME = {
  booked: { l: 'Booked', c: 'var(--passed)', bg: 'var(--passed-bg)' },
  transferred: { l: 'Live transfer', c: 'var(--accent)', bg: 'var(--accent-bg)' },
  callback: { l: 'Callback set', c: '#8a5a00', bg: '#fff3d6' },
  question_answered: { l: 'Answered', c: 'var(--accent)', bg: 'var(--accent-bg)' },
  voicemail: { l: 'Voicemail left', c: 'var(--ink-soft)', bg: 'var(--canvas)' },
  no_answer: { l: 'No answer', c: 'var(--ink-soft)', bg: 'var(--canvas)' },
  busy: { l: 'Busy', c: 'var(--ink-soft)', bg: 'var(--canvas)' },
  not_interested: { l: 'Not interested', c: 'var(--failed)', bg: 'var(--failed-bg)' },
  wrong_number: { l: 'Wrong number', c: 'var(--failed)', bg: 'var(--failed-bg)' },
  do_not_call: { l: 'Opted out', c: 'var(--failed)', bg: 'var(--failed-bg)' },
  already_handled: { l: 'Already handled', c: 'var(--ink-soft)', bg: 'var(--canvas)' },
  failed: { l: 'Call failed', c: 'var(--failed)', bg: 'var(--failed-bg)' },
}
const SRC = { yelp: 'Yelp', angi: 'Angi', thumbtack: 'Thumbtack', meta: 'Facebook', nextdoor: 'Nextdoor', modernize: 'Modernize', google_lsa: 'Google LSA', website: 'Website', other: 'Other' }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const fmtSec = s => (s == null ? '—' : s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${(s / 3600).toFixed(1)}h`)
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const time = t => (t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '')
const when = t => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

const S = {
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
  kpi: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' },
  kpiN: { fontSize: 28, fontWeight: 700, lineHeight: 1.1 },
  kpiL: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 },
  tab: on => ({ padding: '9px 14px', border: 'none', borderBottom: `3px solid ${on ? 'var(--accent)' : 'transparent'}`, background: 'none', color: on ? 'var(--ink)' : 'var(--ink-soft)', fontWeight: on ? 700 : 500, cursor: 'pointer', font: 'inherit', fontSize: 14 }),
  chip: on => ({ padding: '5px 11px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-bg)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--ink)', fontSize: 13, cursor: 'pointer', font: 'inherit' }),
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', font: 'inherit', fontSize: 14 },
  note: { fontSize: 12, color: 'var(--ink-soft)' },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--line-soft)', verticalAlign: 'top' },
}
function Kpi({ n, l, tone }) { return <div style={S.kpi}><div style={{ ...S.kpiN, color: tone || 'var(--ink)' }}>{n}</div><div style={S.kpiL}>{l}</div></div> }
function Pill({ o }) { const x = OUTCOME[o] || { l: o || 'In progress', c: 'var(--ink-soft)', bg: 'var(--canvas)' }; return <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: x.c, background: x.bg, whiteSpace: 'nowrap' }}>{x.l}</span> }
function Card({ title, right, children, pad = 16 }) {
  return <div className="card" style={{ padding: pad, display: 'flex', flexDirection: 'column', gap: 12 }}>
    {(title || right) && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>{right}</div>}
    {children}
  </div>
}
async function callFn(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('s2l-ai', { body: { action, ...body } })
  if (error) {
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* keep message */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// Command Center: s2l-ai + RPCs (RLS / can_manage_dialer()).
const supabaseData = {
  call: callFn,
  feed: a => supabase.rpc('s2l_ai_feed', { p_brand: a.brand || null, p_limit: 60, p_tests: a.tests }).then(r => { if (r.error) throw r.error; return r.data || [] }),
  stats: a => supabase.rpc('s2l_ai_stats', { p_brand: a.brand || null, p_days: a.days, p_tests: a.tests }).then(r => r.data || null),
}
// Client portal: through opsis-portal-ops (pass the portal's invoke()).
export function portalS2lData(invoke) {
  return {
    call: (op, body = {}) => invoke({ action: 'ps2l', op, ...body }),
    feed: a => invoke({ action: 'ps2l', op: 'feed', brands: a.brand ? [a.brand] : null, limit: 60 }),
    stats: a => invoke({ action: 'ps2l', op: 'stats', brands: a.brand ? [a.brand] : null, days: a.days }),
  }
}
const DataCtx = createContext(supabaseData)
const useCall = () => useContext(DataCtx).call

export default function AiSpeedToLead({ data = supabaseData, portal = false }) {
  const call = data.call
  const [tab, setTab] = useState('live')
  const [brand, setBrand] = useState('')
  const [days, setDays] = useState(30)
  const [tests, setTests] = useState(true)
  const [cfg, setCfg] = useState(null)
  const [feed, setFeed] = useState([])
  const [stats, setStats] = useState(null)
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')

  const loadCfg = useCallback(() => call('settings_get').then(setCfg).catch(e => setErr(e.message)), [])
  const load = useCallback(async () => {
    try {
      const [f, st] = await Promise.all([data.feed({ brand, tests }), data.stats({ brand, days, tests })])
      setFeed(f || []); setStats(st || null)
    } catch (e) { setErr(e.message || 'Could not load the feed.') }
  }, [brand, days, tests, data])
  useEffect(() => { loadCfg() }, [loadCfg])
  useEffect(() => { load() }, [load])
  // live: refresh while any call is in flight; realtime isn't on these tables, so poll gently
  const live = feed.some(l => (l.calls || []).some(c => ['scheduled', 'dialing', 'in_progress'].includes(c.status)))
  useEffect(() => { const t = setInterval(() => { if (live) call('sweep').catch(() => {}).finally(load); else load() }, live ? 5000 : 30000); return () => clearInterval(t) }, [live, load])

  const st = stats || {}
  const reached = st.reached || 0

  return (
    <DataCtx.Provider value={data}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">AI Speed to Lead</h1>
          <p className="page-sub">Every new lead gets a natural-sounding AI call in seconds, day or night. It books the job, hands off to a live Opsis CX agent when a person is needed, and leaves a voicemail and tries again when nobody answers.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={S.input} value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {(cfg?.brands || []).map(b => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
          </select>
          <select style={S.input} value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}</select>
          {!portal && <label style={{ ...S.note, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={tests} onChange={e => setTests(e.target.checked)} />Include test leads</label>}
        </div>
      </div>

      {err && <div className="card" style={{ padding: 12, color: 'var(--failed)', background: 'var(--failed-bg)' }} onClick={() => setErr('')}>{err}</div>}

      <div style={S.kpis}>
        <Kpi n={fmtSec(st.median_sec_to_dial)} l="Median time to first call" tone="var(--accent)" />
        <Kpi n={st.leads ?? '—'} l={`Leads · ${pct(st.ai_called || 0, st.leads)} called by the AI`} />
        <Kpi n={pct(reached, st.ai_called)} l={`Reached a person · ${reached} leads`} />
        <Kpi n={pct(st.booked || 0, reached)} l={`Booked of reached · ${st.booked || 0} jobs`} tone="var(--passed)" />
        <Kpi n={st.transferred ?? 0} l="Warm transfers to a live agent" />
        <Kpi n={st.after_hours ?? 0} l="After-hours & weekend leads covered" />
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        {[['live', 'Live feed'], ['perf', 'Performance']].concat(cfg?.can_test === false ? [] : [['test', 'Test the AI']]).concat(cfg?.can_edit === false ? [] : [['settings', 'Settings']]).map(([k, l]) => <button key={k} style={S.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'live' && <Feed feed={feed} onOpen={setOpen} live={live} />}
      {tab === 'perf' && <Performance st={st} days={days} />}
      {tab === 'test' && <TestAi cfg={cfg} brand={brand} onStarted={() => { setTab('live'); setTimeout(load, 1500) }} />}
      {tab === 'settings' && <Settings cfg={cfg} brand={brand} onSaved={loadCfg} />}
      {open && <LeadDrawer lead={open} canRetry={cfg?.can_test !== false} onClose={() => setOpen(null)} onRetry={async () => { try { await call('retry', { lead_id: open.id }); setOpen(null); load() } catch (e) { setErr(e.message) } }} />}
    </div>
    </DataCtx.Provider>
  )
}

// ---------------- live feed ----------------
function Timeline({ l }) {
  const calls = l.calls || []
  const first = calls.find(c => c.placed_at)
  const last = calls[calls.length - 1]
  const steps = [{ t: l.received_at, label: `Lead in · ${SRC[l.source] || l.source || 'Web'}` }]
  if (first) steps.push({ t: first.placed_at, label: `AI dialed in ${fmtSec(first.seconds_to_dial)}`, hi: true })
  calls.filter(c => c.attempt > 1 && c.placed_at).forEach(c => steps.push({ t: c.placed_at, label: `Re-dial #${c.attempt}` }))
  if (last?.outcome) steps.push({ t: last.ended_at, label: (OUTCOME[last.outcome] || {}).l || last.outcome, outcome: last.outcome })
  if (l.handed_off_at) steps.push({ t: l.handed_off_at, label: 'To live agent' })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: 'var(--line)' }}>→</span>}
          <span title={when(s.t)} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: s.hi ? 'var(--accent-bg)' : s.outcome ? (OUTCOME[s.outcome]?.bg || 'var(--canvas)') : 'var(--canvas)', color: s.hi ? 'var(--accent)' : s.outcome ? (OUTCOME[s.outcome]?.c || 'var(--ink)') : 'var(--ink)', fontWeight: s.hi || s.outcome ? 600 : 500 }}>{s.label}</span>
        </React.Fragment>
      ))}
      {calls.some(c => ['scheduled', 'dialing', 'in_progress'].includes(c.status)) && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>● on the call</span>}
    </div>
  )
}
function Feed({ feed, onOpen, live }) {
  if (!feed.length) return <Card><p className="page-sub" style={{ margin: 0 }}>No AI-touched leads yet. Turn the AI on for a brand in Settings, or place a test call from "Test the AI".</p></Card>
  return (
    <Card pad={0} title={null}>
      <div style={{ padding: '12px 16px 0', ...S.note }}>{live ? 'Live: refreshing every few seconds while a call is in progress.' : 'Newest first.'}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={S.th}>Received</th><th style={S.th}>Lead</th><th style={S.th}>Brand · request</th><th style={S.th}>What happened</th><th style={S.th}>Result</th></tr></thead>
          <tbody>{feed.map(l => {
            const last = (l.calls || []).slice(-1)[0]
            return (
              <tr key={l.id} onClick={() => onOpen(l)} style={{ cursor: 'pointer' }}>
                <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{when(l.received_at)}{l.is_test && <div style={S.note}>test</div>}</td>
                <td style={S.td}><b>{l.name || 'Unknown'}</b><div style={S.note}>•••{l.phone_last4} · {[l.city, l.state].filter(Boolean).join(', ')}</div></td>
                <td style={S.td}>{l.brand}<div style={S.note}>{l.service}</div></td>
                <td style={S.td}><Timeline l={l} />{l.ai_summary && <div style={{ ...S.note, marginTop: 6, maxWidth: 560 }}>{l.ai_summary.slice(0, 180)}{l.ai_summary.length > 180 ? '…' : ''}</div>}</td>
                <td style={S.td}>{last?.outcome ? <Pill o={last.outcome} /> : last ? <Pill o={null} /> : <span style={S.note}>Not called</span>}
                  {last?.appointment?.day && <div style={{ ...S.note, marginTop: 4 }}>{new Date(last.appointment.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {last.appointment.window}</div>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </Card>
  )
}
function LeadDrawer({ lead, onClose, onRetry, canRetry = true }) {
  const calls = lead.calls || []
  return (
    <div className="modal-back" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(620px, 100%)', height: '100%', background: 'var(--surface)', overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div><h2 style={{ margin: 0 }}>{lead.name || 'Unknown'}</h2><div style={S.note}>{lead.brand} · {SRC[lead.source] || lead.source} · {when(lead.received_at)} · •••{lead.phone_last4}</div></div>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div style={{ fontSize: 14 }}><b>Request:</b> {lead.service}{lead.message ? ` — ${lead.message}` : ''}</div>
        <Timeline l={lead} />
        {calls.map(c => (
          <div key={c.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <b>Call {c.attempt}{c.placed_at ? ` · ${time(c.placed_at)}` : ''}{c.duration_secs ? ` · ${fmtSec(c.duration_secs)}` : ''}</b>
              <Pill o={c.outcome || (['scheduled', 'dialing', 'in_progress'].includes(c.status) ? null : c.status)} />
            </div>
            {c.error && <div style={{ color: 'var(--failed)', fontSize: 13 }}>{c.error}</div>}
            {c.summary && <div style={{ fontSize: 14, lineHeight: 1.5 }}>{c.summary}</div>}
            {c.data && Object.keys(c.data).length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '4px 12px', fontSize: 13 }}>
                {Object.entries(c.data).filter(([k]) => k !== 'outcome').map(([k, v]) => <React.Fragment key={k}><span style={{ color: 'var(--ink-soft)' }}>{k.replace(/_/g, ' ')}</span><span>{String(v)}</span></React.Fragment>)}
              </div>
            )}
            {(c.transcript || []).length > 0 && (
              <details><summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--accent)' }}>Transcript ({c.transcript.length} turns)</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {c.transcript.map((t, i) => (
                    <div key={i} style={{ alignSelf: t.role === 'agent' ? 'flex-start' : 'flex-end', maxWidth: '85%', background: t.role === 'agent' ? 'var(--accent-bg)' : 'var(--canvas)', borderRadius: 10, padding: '6px 10px', fontSize: 13 }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{t.role === 'agent' ? 'AI' : 'Lead'}{t.t != null ? ` · ${fmtSec(t.t)}` : ''}{t.tools?.length ? ` · ${t.tools.join(', ')}` : ''}</div>{t.text}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
        {canRetry && <div><button className="btn" onClick={onRetry}>Have the AI call again</button></div>}
      </div>
    </div>
  )
}

// ---------------- performance ----------------
function Performance({ st, days }) {
  const outs = Object.entries(st.outcomes || {}).sort((a, b) => b[1] - a[1])
  const tot = outs.reduce((a, [, n]) => a + n, 0) || 1
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
      <Card title={`Speed (last ${days} days)`}>
        <div style={S.kpis}>
          <Kpi n={fmtSec(st.median_sec_to_dial)} l="Median lead → first ring" tone="var(--accent)" />
          <Kpi n={fmtSec(st.p90_sec_to_dial)} l="90% of leads called within" />
        </div>
        <div style={S.note}>Measured from the moment the lead reaches Opsis to the moment the AI's call is placed. Leads that arrive outside the lead's legal calling window are called when it opens.</div>
      </Card>
      <Card title="How AI calls ended">
        {outs.length ? outs.map(([o, n]) => (
          <div key={o} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 44px', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <span>{(OUTCOME[o] || {}).l || o}</span>
            <div style={{ height: 12, background: 'var(--canvas)', borderRadius: 6 }}><div style={{ width: `${(n / tot) * 100}%`, height: '100%', background: (OUTCOME[o] || {}).c || 'var(--accent)', borderRadius: 6, opacity: .8 }} /></div>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
          </div>
        )) : <span style={S.note}>No finished calls yet.</span>}
        <div style={S.note}>{st.calls || 0} calls · {st.talk_minutes || 0} talk minutes · {st.handed_off || 0} leads handed to live agents</div>
      </Card>
      <Card title="By lead source" pad={0}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={S.th}>Source</th><th style={S.th}>Leads</th><th style={S.th}>Reached</th><th style={S.th}>Booked</th></tr></thead>
          <tbody>{(st.by_source || []).map(r => <tr key={r.source}><td style={S.td}>{SRC[r.source] || r.source}</td><td style={S.td}>{r.leads}</td><td style={S.td}>{pct(r.reached, r.leads)}</td><td style={S.td}>{pct(r.booked, r.reached)}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card title="Built in">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
          <li>Calls within seconds of the lead, 24/7, inside each lead's local calling window</li>
          <li>Natural ElevenLabs voice; says it's a virtual assistant up front</li>
          <li>Books real appointments on the client's calendar during the call</li>
          <li>Warm transfer to a live, U.S.-based Opsis CX agent mid-call</li>
          <li>Voicemail drop and automatic re-dial when nobody answers</li>
          <li>Unresolved leads go to the live dialer with the AI's notes</li>
          <li>Opt-outs go straight to Do Not Call; DNC numbers are never dialed</li>
        </ul>
      </Card>
    </div>
  )
}

// ---------------- test ----------------
function TestAi({ cfg, brand, onStarted }) {
  const call = useCall()
  const brands = cfg?.brands || []
  const [f, setF] = useState({ brand: '', name: '', phone: '', state: 'FL', city: '', zip: '', service: 'Garage door repair', message: 'Door makes a loud bang and will not open', source: 'website', consent: false })
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { if (!f.brand && brands.length) setF(x => ({ ...x, brand: brand || (brands.find(b => /opsis/i.test(b.brand)) || brands[0]).brand })) }, [brands.length, brand])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const go = async () => {
    setBusy(true); setErr(''); setRes(null)
    try { const r = await call('test_call', f); setRes(r); if (!r.error && !r.skipped) setTimeout(onStarted, 1200) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Card title="Send yourself a test lead">
      <p style={{ margin: 0, fontSize: 14 }}>Fill this in like a customer would. The AI calls the number in seconds, exactly as it would call a real lead, and the result shows up in the Live feed.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label style={S.label}>Brand<select style={S.input} value={f.brand} onChange={e => set('brand', e.target.value)}>{brands.map(b => <option key={b.brand}>{b.brand}</option>)}</select></label>
        <label style={S.label}>Your name<input style={S.input} value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label style={S.label}>Your mobile<input style={S.input} value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 555-5555" /></label>
        <label style={S.label}>Lead source<select style={S.input} value={f.source} onChange={e => set('source', e.target.value)}>{Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label style={S.label}>City<input style={S.input} value={f.city} onChange={e => set('city', e.target.value)} /></label>
        <label style={S.label}>State<input style={S.input} value={f.state} maxLength={2} onChange={e => set('state', e.target.value.toUpperCase())} /></label>
        <label style={S.label}>Zip<input style={S.input} value={f.zip} onChange={e => set('zip', e.target.value)} /></label>
        <label style={S.label}>Service<input style={S.input} value={f.service} onChange={e => set('service', e.target.value)} /></label>
      </div>
      <label style={S.label}>Message<textarea style={{ ...S.input, minHeight: 60 }} value={f.message} onChange={e => set('message', e.target.value)} /></label>
      <label style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'flex-start' }}><input type="checkbox" checked={f.consent} onChange={e => set('consent', e.target.checked)} />I agree to receive an automated AI phone call at this number for this test.</label>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? 'Calling…' : 'Send test lead'}</button>
        {res && !res.error && !res.skipped && <span style={{ color: 'var(--passed)', fontWeight: 600 }}>✓ AI dialing{res.seconds_to_dial != null ? ` ${res.seconds_to_dial}s after the lead came in` : ''}. Answer your phone.</span>}
        {res?.skipped && <span style={{ color: '#8a5a00' }}>{res.skipped}</span>}
        {res?.error && <span style={{ color: 'var(--failed)' }}>{res.error}</span>}
        {err && <span style={{ color: 'var(--failed)' }}>{err}</span>}
      </div>
    </Card>
  )
}

// ---------------- settings ----------------
const L = ({ l, children, wide }) => <label style={{ ...S.label, gridColumn: wide ? '1 / -1' : undefined }}>{l}{children}</label>
function Settings({ cfg, brand: pickBrand, onSaved }) {
  const call = useCall()
  const brands = cfg?.brands || []
  const [b, setB] = useState('')
  const cur = useMemo(() => brands.find(x => x.brand === b), [brands, b])
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!b && brands.length) setB(pickBrand || (brands.find(x => /opsis/i.test(x.brand)) || brands[0]).brand) }, [brands.length, pickBrand])
  useEffect(() => { if (cur) setF({ enabled: cur.enabled, consent_ok: cur.consent_ok, client_id: cur.client_id, ...cur.settings }) }, [cur])
  if (!cfg) return <p className="page-sub">Loading…</p>
  if (!f) return null
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const setW = (i, k, v) => setF(x => ({ ...x, windows: x.windows.map((w, j) => (j === i ? { ...w, [k]: v } : w)) }))
  const save = async () => {
    setBusy(true); setMsg('')
    const { enabled, consent_ok, client_id, ...settings } = f
    try { await call('settings_save', { brand: b, enabled, consent_ok, client_id, settings }); setMsg('Saved. The AI agent was updated.'); onSaved() } catch (e) { setMsg('⚠ ' + e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Brand" right={<select style={S.input} value={b} onChange={e => setB(e.target.value)}>{brands.map(x => <option key={x.brand}>{x.brand}</option>)}</select>}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><input type="checkbox" checked={f.enabled} onChange={e => set('enabled', e.target.checked)} />AI calls new leads for this brand</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.consent_ok} onChange={e => set('consent_ok', e.target.checked)} />This brand's lead forms include consent to automated / AI calls</label>
        </div>
        {f.enabled && !f.consent_ok && <div style={{ fontSize: 13, color: '#8a5a00' }}>The AI won't call real leads until consent is confirmed (TCPA: AI-voice calls need prior express written consent). Test calls still work.</div>}
        <div style={S.note}>Sources feeding this brand: {(cur?.sources || []).map(s => `${s.label || SRC[s.source] || s.source}${s.ai_first ? ' (AI first)' : ''}`).join(', ') || 'none yet'}{cur?.updated_by_name ? ` · last saved by ${cur.updated_by_name}` : ''}</div>
      </Card>
      <Card title="Voice and script">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <L l="AI name"><input style={S.input} value={f.agent_name} onChange={e => set('agent_name', e.target.value)} /></L>
          <L l="Company name (as spoken)"><input style={S.input} value={f.company_name} onChange={e => set('company_name', e.target.value)} /></L>
          <L l="Voice"><select style={S.input} value={f.voice} onChange={e => set('voice', e.target.value)}><option value="female">Female</option><option value="male">Male</option></select></L>
          <L l="Time zone"><select style={S.input} value={f.timezone} onChange={e => set('timezone', e.target.value)}>{['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles'].map(t => <option key={t}>{t}</option>)}</select></L>
          <L l="Opening line (optional)" wide><input style={S.input} value={f.opening} placeholder="Hi, is this {{lead_first_name}}? This is {agent}, a virtual assistant with {company}…" onChange={e => set('opening', e.target.value)} /></L>
          <L l="Voicemail message (optional)" wide><input style={S.input} value={f.voicemail} onChange={e => set('voicemail', e.target.value)} /></L>
          <L l="Services" wide><input style={S.input} value={f.services} onChange={e => set('services', e.target.value)} /></L>
          <L l="Company facts (pricing wording, hours, policies)" wide><textarea style={{ ...S.input, minHeight: 80 }} value={f.facts} onChange={e => set('facts', e.target.value)} /></L>
          <L l="Extra instructions" wide><textarea style={{ ...S.input, minHeight: 60 }} value={f.notes} onChange={e => set('notes', e.target.value)} /></L>
        </div>
      </Card>
      <Card title="Calling rules">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <L l="Call leads from (their time)"><input type="time" style={S.input} value={f.call_from} onChange={e => set('call_from', e.target.value)} /></L>
          <L l="Until"><input type="time" style={S.input} value={f.call_to} onChange={e => set('call_to', e.target.value)} /></L>
          <L l="AI attempts"><select style={S.input} value={f.attempts} onChange={e => set('attempts', Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></L>
          <L l="Re-dial after (seconds)"><input type="number" style={S.input} value={f.retry_secs} onChange={e => set('retry_secs', Number(e.target.value))} /></L>
          <L l="Hold from live agents (min)"><input type="number" style={S.input} value={f.hold_minutes} onChange={e => set('hold_minutes', Number(e.target.value))} /></L>
          <L l="Live transfer number"><input style={S.input} value={f.handoff_number} placeholder="Opsis CX agent line" onChange={e => set('handoff_number', e.target.value)} /></L>
          <L l="Calls from (AI phone line)"><select style={S.input} value={f.el_phone_id} onChange={e => set('el_phone_id', e.target.value)}><option value="">Brand default</option>{(cfg.lines || []).map(l => <option key={l.el_phone_id} value={l.el_phone_id}>{l.label} · {l.number}</option>)}</select></L>
          {cfg.staff !== false && <L l="Live dialer campaign (hand-offs)"><select style={S.input} value={f.campaign_id} onChange={e => set('campaign_id', e.target.value)}><option value="">(lead source's campaign)</option>{(cfg.campaigns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></L>}
        </div>
      </Card>
      <Card title="Booking">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['brand_calendar', "Brand's booking calendar", cur?.has_brand_calendar], ['opsis_calendar', 'Opsis calendar (built in)', true], ['request', 'Take a request; team confirms', true]].map(([k, l, ok]) => ok && <button key={k} style={S.chip(f.booking === k)} onClick={() => set('booking', k)}>{l}</button>)}
        </div>
        {f.booking === 'brand_calendar' && <div style={S.note}>Uses the same LeadConnector calendar, wait rules and booking switch as this brand's AI CSR.</div>}
        {f.booking !== 'brand_calendar' && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><span style={S.note}>Days:</span>{DAYS.map(d => <button key={d} style={S.chip(f.days.includes(d))} onClick={() => set('days', f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d])}>{d}</button>)}</div>
            {f.windows.map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <L l="Window"><input style={{ ...S.input, width: 120 }} value={w.label} onChange={e => setW(i, 'label', e.target.value)} /></L>
                <L l="From"><input type="time" style={S.input} value={w.from} onChange={e => setW(i, 'from', e.target.value)} /></L>
                <L l="To"><input type="time" style={S.input} value={w.to} onChange={e => setW(i, 'to', e.target.value)} /></L>
                {f.booking === 'opsis_calendar' && <L l="Jobs per window"><input type="number" style={{ ...S.input, width: 90 }} value={w.cap} onChange={e => setW(i, 'cap', Number(e.target.value))} /></L>}
              </div>
            ))}
          </>
        )}
      </Card>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save and update the AI'}</button>
        {msg && <span style={{ fontSize: 14, color: msg.startsWith('⚠') ? 'var(--failed)' : 'var(--passed)' }}>{msg}</span>}
      </div>
    </div>
  )
}
