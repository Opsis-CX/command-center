import React, { useEffect, useMemo, useState, useCallback, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { staffInterval, performance, sensitivity, outboundWork, pct, secs, slotLabel } from '../lib/erlang'

// ============================================================
// WORKFORCE MANAGEMENT (2026-11-09)
// Forecast → Erlang C staffing → schedule fit, for inbound, outbound and speed to lead.
//
// Data:
//   wfm_brands / wfm_history / wfm_daily   call history from ai_qa_calls (every call the QA pipeline ingests:
//                                           LightSpeed, Five9, CallRail…), first legs only, per brand + direction
//   wfm_scheduled                          agents scheduled per 30-min interval (shift_blocks + shift_claims)
//   wfm_plans                              saved plans (staff only, RLS)
// The math lives in lib/erlang.js. Nothing here writes call data.
//
// Two homes (2026-11-09): Command Center (/workforce, data straight from Supabase with RLS) and the client portal
// (garageco.opsiscx.com → Workforce, data through the opsis-portal-ops edge function, scoped to the login's
// client/brand). The `data` prop picks the source; see portalWfmData() below.
// ============================================================

const unwrap = r => { if (r.error) throw r.error; return r.data || [] }
// Command Center: straight to Supabase (RLS + is_staff()).
const supabaseData = {
  brands: weeks => supabase.rpc('wfm_brands', { p_weeks: weeks }).then(unwrap),
  history: a => supabase.rpc('wfm_history', { p_brands: a.brands, p_direction: a.direction || 'inbound', p_weeks: a.weeks, p_tz: a.tz }).then(unwrap),
  scheduled: (client, week) => supabase.rpc('wfm_scheduled', { p_client: client, p_week_start: week }).then(unwrap),
  clients: () => supabase.from('clients').select('id, name').order('name').then(unwrap),
  plans: () => supabase.from('wfm_plans').select('*').order('updated_at', { ascending: false }).then(unwrap),
  savePlan: row => supabase.from('wfm_plans').insert(row).then(r => { if (r.error) throw r.error }),
  deletePlan: id => supabase.from('wfm_plans').delete().eq('id', id).then(r => { if (r.error) throw r.error }),
}
// Client portal: same calls through opsis-portal-ops (pass the portal's invoke()).
export function portalWfmData(invoke) {
  const q = (op, body = {}) => invoke({ action: 'pwfm', op, ...body })
  return {
    brands: weeks => q('brands', { weeks }),
    history: a => q('history', a),
    scheduled: (_client, week) => q('scheduled', { week_start: week }),
    clients: () => q('clients'),
    plans: () => q('plans'),
    savePlan: row => q('plan_save', row),
    deletePlan: id => q('plan_delete', { id }),
  }
}
const DataCtx = createContext(supabaseData)

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TZS = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles']
const TABS = [
  ['inbound', 'Inbound forecast'],
  ['outbound', 'Outbound capacity'],
  ['s2l', 'Speed to lead'],
  ['calc', 'Erlang C calculator'],
  ['plans', 'Saved plans'],
]
const n0 = v => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString())
const n1 = v => (v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString())
const num = (v, d = 0) => { const x = Number(v); return isFinite(x) ? x : d }

// A realistic contact-center arrival curve for prospects without history ("plug in your volumes").
const DEMO_DAY_SHARE = [0.04, 0.21, 0.19, 0.17, 0.17, 0.15, 0.07]
function demoCurve(slot) {
  const h = slot / 2
  const g = (mu, s, w) => w * Math.exp(-((h - mu) ** 2) / (2 * s * s))
  return g(10.5, 1.3, 1) + g(14, 1.6, 0.85) + g(17.5, 1.2, 0.35) + 0.04
}
function demoHistory(weekly, aht) {
  const rows = []
  for (let d = 0; d < 7; d++) {
    const weights = Array.from({ length: 48 }, (_, s) => (s >= 14 && s < 42 ? demoCurve(s) : 0))
    const tot = weights.reduce((a, b) => a + b, 0)
    weights.forEach((w, s) => { if (w > 0) rows.push({ dow: d, slot: s, calls: (weekly * DEMO_DAY_SHARE[d] * w) / tot, aht_sec: aht * (0.92 + 0.16 * Math.sin(s)) }) })
  }
  return rows
}
function mondayOf(d = new Date()) {
  const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0)
  return x.toISOString().slice(0, 10)
}

// ---------------- small UI bits ----------------
const S = {
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 },
  input: { width: 110, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', font: 'inherit', fontSize: 14 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 },
  kpi: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' },
  kpiN: { fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: 'var(--ink)' },
  kpiL: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 },
  th: { textAlign: 'right', padding: '7px 10px', fontSize: 12, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--surface)' },
  td: { textAlign: 'right', padding: '6px 10px', fontSize: 13, borderBottom: '1px solid var(--line-soft)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  chip: on => ({ padding: '5px 11px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-bg)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--ink)', fontSize: 13, cursor: 'pointer', font: 'inherit' }),
  tab: on => ({ padding: '9px 14px', border: 'none', borderBottom: `3px solid ${on ? 'var(--accent)' : 'transparent'}`, background: 'none', color: on ? 'var(--ink)' : 'var(--ink-soft)', fontWeight: on ? 700 : 500, cursor: 'pointer', font: 'inherit', fontSize: 14 }),
  note: { fontSize: 12, color: 'var(--ink-soft)' },
}
function Field({ label, children, hint }) {
  return <label style={S.label} title={hint || ''}>{label}{children}</label>
}
function NumIn({ value, onChange, step = 1, min = 0, max, width }) {
  return <input type="number" style={{ ...S.input, width: width || S.input.width }} value={value} step={step} min={min} max={max} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
}
function Kpi({ n, l, tone }) {
  return <div style={S.kpi}><div style={{ ...S.kpiN, color: tone || S.kpiN.color }}>{n}</div><div style={S.kpiL}>{l}</div></div>
}
function Card({ title, right, children, pad = 16 }) {
  return (
    <div className="card" style={{ padding: pad, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(title || right) && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>{right}
      </div>}
      {children}
    </div>
  )
}
const slColor = (sl, target) => (sl >= target ? 'var(--passed)' : sl >= target - 0.1 ? '#c98a12' : 'var(--failed)')

// Heat cell colour: 0 → canvas, max → accent.
function heat(v, max) {
  if (!v || !max) return 'var(--canvas)'
  const t = Math.min(1, v / max)
  return `color-mix(in srgb, var(--accent) ${Math.round(8 + t * 72)}%, transparent)`
}

// Calls (bars) + required agents (line) + scheduled agents (step) for one day.
function DayChart({ rows, target }) {
  if (!rows.length) return null
  const W = 980, H = 270, P = { l: 44, r: 44, t: 30, b: 34 }
  const maxCalls = Math.max(1, ...rows.map(r => r.calls))
  const maxAg = Math.max(1, ...rows.map(r => Math.max(r.need.scheduled, r.sched ?? 0)))
  const bw = (W - P.l - P.r) / rows.length
  const x = i => P.l + i * bw + bw / 2
  const yC = v => H - P.b - (v / maxCalls) * (H - P.t - P.b)
  const yA = v => H - P.b - (v / maxAg) * (H - P.t - P.b)
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${yA(r.need.scheduled)}`).join(' ')
  const hasSched = rows.some(r => r.sched != null)
  const step = hasSched ? rows.map((r, i) => `${i ? 'L' : 'M'}${P.l + i * bw},${yA(r.sched || 0)} L${P.l + (i + 1) * bw},${yA(r.sched || 0)}`).join(' ') : ''
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Calls and agents by interval">
      {[0, 0.25, 0.5, 0.75, 1].map(t => <line key={t} x1={P.l} x2={W - P.r} y1={P.t + t * (H - P.t - P.b)} y2={P.t + t * (H - P.t - P.b)} stroke="var(--line-soft)" />)}
      {rows.map((r, i) => <rect key={r.slot} x={P.l + i * bw + 2} y={yC(r.calls)} width={Math.max(1, bw - 4)} height={H - P.b - yC(r.calls)} rx="3" fill="var(--accent-bg)" stroke="var(--accent)" strokeOpacity=".35" />)}
      {hasSched && <path d={step} fill="none" stroke="#c98a12" strokeWidth="2.5" strokeDasharray="6 4" />}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="3" />
      {rows.map((r, i) => <circle key={'c' + r.slot} cx={x(i)} cy={yA(r.need.scheduled)} r="3.5" fill="var(--accent)" />)}
      {rows.map((r, i) => (i % 2 === 0 ? <text key={'t' + r.slot} x={x(i)} y={H - 12} fontSize="11" textAnchor="middle" fill="var(--ink-soft)">{slotLabel(r.slot, true)}</text> : null))}
      <text x={4} y={14} fontSize="11" fill="var(--ink-soft)">calls</text>
      <text x={W - 4} y={14} fontSize="11" textAnchor="end" fill="var(--accent)">agents</text>
      <text x={P.l - 8} y={yC(maxCalls) + 4} fontSize="11" textAnchor="end" fill="var(--ink-soft)">{Math.round(maxCalls)}</text>
      <text x={W - P.r + 8} y={yA(maxAg) + 4} fontSize="11" fill="var(--accent)">{Math.round(maxAg)}</text>
    </svg>
  )
}

// ============================================================
export default function Workforce({ data = supabaseData, portal = false }) {
  const { session } = useAuth() || {}
  const [tab, setTab] = useState('inbound')
  const [brands, setBrands] = useState([])
  const [clients, setClients] = useState([])
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [loadPlan, setLoadPlan] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const [b, c] = await Promise.all([data.brands(6), data.clients()])
        setBrands(b || []); setClients(c || [])
      } catch (e) { setErr(e.message || 'Could not load call history.') }
    })()
  }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) } }, [toast])

  const savePlan = useCallback(async (kind, name, params, summary, planBrands = [], clientId = null) => {
    const who = session?.user?.user_metadata?.full_name || session?.user?.email || null
    try { await data.savePlan({ kind, name, params, summary, brands: planBrands, client_id: clientId, created_by_name: who }); setToast('Plan saved') }
    catch (e) { setErr(e.message || 'Could not save the plan.') }
  }, [session, data])

  return (
    <DataCtx.Provider value={data}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Workforce management</h1>
          <p className="page-sub">Forecast volume, staff every interval with Erlang C, and check the schedule against it, for inbound, outbound and speed to lead.</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} style={S.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {err && <div className="card" style={{ padding: 12, color: 'var(--failed)', background: 'var(--failed-bg)' }}>{err}</div>}
      {toast && <div style={{ position: 'fixed', right: 24, bottom: 24, background: 'var(--ink)', color: 'var(--surface)', padding: '10px 16px', borderRadius: 10, zIndex: 50 }}>{toast}</div>}
      {tab === 'inbound' && <InboundPlanner brands={brands} clients={clients} onSave={savePlan} preset={loadPlan?.kind === 'inbound' ? loadPlan : null} />}
      {tab === 'outbound' && <OutboundPlanner brands={brands} onSave={savePlan} preset={loadPlan?.kind === 'outbound' ? loadPlan : null} />}
      {tab === 's2l' && <SpeedToLeadPlanner onSave={savePlan} preset={loadPlan?.kind === 'speed_to_lead' ? loadPlan : null} />}
      {tab === 'calc' && <Calculator />}
      {tab === 'plans' && <Plans onOpen={p => { setLoadPlan({ ...p, _t: Date.now() }); setTab(p.kind === 'speed_to_lead' ? 's2l' : p.kind) }} />}
    </div>
    </DataCtx.Provider>
  )
}

// ============================================================
// INBOUND — history (or demo profile) → forecast → Erlang C per interval → schedule fit
// ============================================================
const IN_DEFAULTS = { mode: 'history', brands: [], weeks: 6, tz: 'America/New_York', growth: 0, slPct: 80, slSec: 30, wrap: 30, ahtOverride: '', shrink: 30, maxOcc: 85, patience: 90, open: 16, close: 40, minAgents: 1, demoWeekly: 6000, demoAht: 240, days: [1, 2, 3, 4, 5, 6] }

function InboundPlanner({ brands, clients, onSave, preset }) {
  const data = useContext(DataCtx)
  const [p, setP] = useState(IN_DEFAULTS)
  const set = (k, v) => setP(x => ({ ...x, [k]: v }))
  const [hist, setHist] = useState([])
  const [loading, setLoading] = useState(false)
  const [day, setDay] = useState(2)
  const [metric, setMetric] = useState('agents')
  const [schedClient, setSchedClient] = useState('')
  const [weekStart, setWeekStart] = useState(mondayOf())
  const [sched, setSched] = useState([])

  useEffect(() => { if (preset) setP({ ...IN_DEFAULTS, ...preset.params }) }, [preset])
  const inboundBrands = brands.filter(b => b.direction === 'inbound')
  useEffect(() => { if (!p.brands.length && inboundBrands.length && p.mode === 'history') set('brands', [inboundBrands[0].brand]) }, [inboundBrands.length])

  useEffect(() => {
    if (p.mode !== 'history' || !p.brands.length) return
    let live = true
    setLoading(true)
    data.history({ brands: p.brands, direction: 'inbound', weeks: p.weeks, tz: p.tz }).then(rows => { if (live) { setHist(rows || []); setLoading(false) } }).catch(() => { if (live) { setHist([]); setLoading(false) } })
    return () => { live = false }
  }, [p.mode, p.brands.join('|'), p.weeks, p.tz])

  useEffect(() => {
    if (!schedClient) { setSched([]); return }
    data.scheduled(schedClient, weekStart).then(rows => setSched(rows || [])).catch(() => setSched([]))
  }, [schedClient, weekStart])

  const source = p.mode === 'demo' ? demoHistory(num(p.demoWeekly), num(p.demoAht)) : hist
  // scheduled agents by dow+slot for the chosen week
  const schedMap = useMemo(() => {
    const m = {}
    for (const r of sched) { const d = new Date(r.day + 'T12:00:00').getDay(); m[`${d}-${r.slot}`] = r.scheduled }
    return m
  }, [sched])

  const grid = useMemo(() => {
    const g = num(p.growth) / 100
    const out = {}
    let outside = 0, total = 0
    for (const r of source) {
      const calls = num(r.calls) * (1 + g)
      total += calls
      const open = p.days.includes(r.dow) && r.slot >= p.open && r.slot < p.close
      if (!open) { outside += calls; continue }
      const baseAht = p.ahtOverride !== '' && p.ahtOverride != null ? num(p.ahtOverride) : num(r.aht_sec, 180)
      out[`${r.dow}-${r.slot}`] = { calls, aht: baseAht + num(p.wrap) }
    }
    const rows = {}
    for (let d = 0; d < 7; d++) {
      rows[d] = []
      if (!p.days.includes(d)) continue
      for (let s = p.open; s < p.close; s++) {
        const c = out[`${d}-${s}`] || { calls: 0, aht: (p.ahtOverride !== '' ? num(p.ahtOverride) : 180) + num(p.wrap) }
        const need = staffInterval({ calls: c.calls, aht: c.aht, slPct: num(p.slPct) / 100, slSec: num(p.slSec), maxOcc: num(p.maxOcc) / 100, shrink: num(p.shrink) / 100, patience: num(p.patience), minAgents: num(p.minAgents) })
        const sch = schedClient ? (schedMap[`${d}-${s}`] ?? 0) : null
        const perf = sch != null ? performance({ calls: c.calls, aht: c.aht, N: Math.floor(sch * (1 - num(p.shrink) / 100)), slSec: num(p.slSec), patience: num(p.patience) }) : null
        rows[d].push({ slot: s, calls: c.calls, aht: c.aht, need, sched: sch, perf })
      }
    }
    return { rows, outside, total }
  }, [source, p, schedMap, schedClient])

  const all = Object.values(grid.rows).flat()
  const weekCalls = all.reduce((a, r) => a + r.calls, 0)
  const wAht = weekCalls ? all.reduce((a, r) => a + r.calls * r.aht, 0) / weekCalls : 0
  const peak = all.reduce((m, r) => Math.max(m, r.need.scheduled), 0)
  const agentHours = all.reduce((a, r) => a + r.need.scheduled * 0.5, 0)
  const slW = weekCalls ? all.reduce((a, r) => a + r.calls * r.need.sl, 0) / weekCalls : 1
  const schedHours = schedClient ? all.reduce((a, r) => a + (r.sched || 0) * 0.5, 0) : null
  const under = schedClient ? all.filter(r => r.calls > 0 && (r.sched || 0) < r.need.scheduled).length : null
  const slAtSched = schedClient && weekCalls ? all.reduce((a, r) => a + r.calls * (r.perf?.sl ?? 0), 0) / weekCalls : null
  const maxCell = Math.max(1, ...all.map(r => (metric === 'calls' ? r.calls : metric === 'gap' ? Math.abs((r.sched || 0) - r.need.scheduled) : r.need.scheduled)))
  const slots = Array.from({ length: Math.max(0, p.close - p.open) }, (_, i) => p.open + i)
  const dayRows = grid.rows[day] || []
  const target = num(p.slPct) / 100

  const toggleBrand = b => set('brands', p.brands.includes(b) ? p.brands.filter(x => x !== b) : [...p.brands, b])
  const toggleDay = d => set('days', p.days.includes(d) ? p.days.filter(x => x !== d) : [...p.days, d].sort())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Forecast source" right={
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.chip(p.mode === 'history')} onClick={() => set('mode', 'history')}>Call history</button>
          <button style={S.chip(p.mode === 'demo')} onClick={() => set('mode', 'demo')}>Enter volumes</button>
        </div>}>
        {p.mode === 'history' ? (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {inboundBrands.map(b => <button key={b.brand} style={S.chip(p.brands.includes(b.brand))} onClick={() => toggleBrand(b.brand)}>{b.brand} <span style={{ opacity: .6 }}>· {n0(b.calls / 6)}/wk</span></button>)}
              {!inboundBrands.length && <span style={S.note}>No inbound call history yet.</span>}
            </div>
            <div style={S.row}>
              <Field label="History"><select style={S.input} value={p.weeks} onChange={e => set('weeks', Number(e.target.value))}>{[4, 6, 8, 12].map(w => <option key={w} value={w}>{w} weeks</option>)}</select></Field>
              <Field label="Time zone"><select style={{ ...S.input, width: 190 }} value={p.tz} onChange={e => set('tz', e.target.value)}>{TZS.map(t => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Growth %" hint="Seasonal lift or a new program ramp"><NumIn value={p.growth} onChange={v => set('growth', v)} min={-90} /></Field>
              <Field label="AHT override (s)" hint="Leave blank to use each interval's own talk time"><NumIn value={p.ahtOverride} onChange={v => set('ahtOverride', v)} /></Field>
              {loading && <span style={S.note}>Loading history…</span>}
            </div>
          </>
        ) : (
          <div style={S.row}>
            <Field label="Calls per week"><NumIn value={p.demoWeekly} onChange={v => set('demoWeekly', v)} step={100} /></Field>
            <Field label="Talk time (s)"><NumIn value={p.demoAht} onChange={v => set('demoAht', v)} step={10} /></Field>
            <Field label="Growth %"><NumIn value={p.growth} onChange={v => set('growth', v)} min={-90} /></Field>
            <span style={S.note}>Spread across a typical home-services arrival pattern (morning and early-afternoon peaks, light weekends).</span>
          </div>
        )}
      </Card>

      <Card title="Service goals and staffing rules">
        <div style={S.row}>
          <Field label="Service level %"><NumIn value={p.slPct} onChange={v => set('slPct', v)} max={99} /></Field>
          <Field label="Answered within (s)"><NumIn value={p.slSec} onChange={v => set('slSec', v)} /></Field>
          <Field label="Wrap-up (s)" hint="After-call work added to talk time"><NumIn value={p.wrap} onChange={v => set('wrap', v)} /></Field>
          <Field label="Shrinkage %" hint="Breaks, coaching, absence: paid time not on the phones"><NumIn value={p.shrink} onChange={v => set('shrink', v)} max={80} /></Field>
          <Field label="Max occupancy %"><NumIn value={p.maxOcc} onChange={v => set('maxOcc', v)} max={98} /></Field>
          <Field label="Caller patience (s)"><NumIn value={p.patience} onChange={v => set('patience', v)} /></Field>
          <Field label="Min agents open"><NumIn value={p.minAgents} onChange={v => set('minAgents', v)} /></Field>
          <Field label="Open"><select style={S.input} value={p.open} onChange={e => set('open', Number(e.target.value))}>{Array.from({ length: 48 }, (_, s) => <option key={s} value={s}>{slotLabel(s)}</option>)}</select></Field>
          <Field label="Close"><select style={S.input} value={p.close} onChange={e => set('close', Number(e.target.value))}>{Array.from({ length: 48 }, (_, s) => <option key={s + 1} value={s + 1}>{slotLabel((s + 1) % 48)}</option>)}</select></Field>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={S.note}>Days open:</span>
          {DAYS.map((d, i) => <button key={d} style={S.chip(p.days.includes(i))} onClick={() => toggleDay(i)}>{d}</button>)}
        </div>
      </Card>

      <div style={S.kpis}>
        <Kpi n={n0(weekCalls)} l="Forecast calls / week" />
        <Kpi n={secs(wAht)} l="Avg handle time (talk + wrap)" />
        <Kpi n={n0(peak)} l="Peak agents scheduled (incl. shrinkage)" tone="var(--accent)" />
        <Kpi n={n0(agentHours)} l={`Agent hours / week · ${n1(agentHours / 40)} FTE`} />
        <Kpi n={pct(slW)} l={`Planned service level (${p.slPct}/${p.slSec})`} tone={slColor(slW, target)} />
        {schedClient && <Kpi n={pct(slAtSched)} l={`SL with today's schedule · ${under} short intervals`} tone={slColor(slAtSched, target)} />}
      </div>
      {grid.total > 0 && grid.outside / grid.total > 0.03 && <div style={S.note}>⚠ {pct(grid.outside / grid.total)} of forecast calls fall outside the open hours above and aren't staffed.</div>}

      <Card title="Week at a glance" right={
        <div style={{ display: 'flex', gap: 6 }}>
          {[['agents', 'Agents needed'], ['calls', 'Calls'], ...(schedClient ? [['gap', 'Gap vs schedule']] : [])].map(([k, l]) => <button key={k} style={S.chip(metric === k)} onClick={() => setMetric(k)}>{l}</button>)}
        </div>}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 3, width: '100%' }}>
            <thead><tr><th style={{ ...S.th, textAlign: 'left' }}></th>{DAYS.map((d, i) => <th key={d} style={{ ...S.th, textAlign: 'center', cursor: 'pointer', color: day === i ? 'var(--accent)' : S.th.color }} onClick={() => setDay(i)}>{d}</th>)}</tr></thead>
            <tbody>
              {slots.map(s => (
                <tr key={s}>
                  <td style={{ ...S.td, textAlign: 'left', color: 'var(--ink-soft)', fontSize: 11, padding: '0 8px', border: 'none' }}>{slotLabel(s, true)}</td>
                  {DAYS.map((_, d) => {
                    const r = (grid.rows[d] || []).find(x => x.slot === s)
                    if (!r) return <td key={d} style={{ background: 'var(--line-soft)', borderRadius: 4 }} />
                    const gap = (r.sched || 0) - r.need.scheduled
                    const v = metric === 'calls' ? r.calls : metric === 'gap' ? gap : r.need.scheduled
                    const bg = metric === 'gap' ? (r.calls <= 0 ? 'var(--canvas)' : gap < 0 ? `rgba(192,57,43,${0.15 + Math.min(1, -gap / maxCell) * 0.65})` : `rgba(31,138,83,${0.12 + Math.min(1, gap / maxCell) * 0.5})`) : heat(v, maxCell)
                    const dark = metric !== 'gap' && v / maxCell > 0.55
                    return <td key={d} onClick={() => setDay(d)} title={`${DAYS[d]} ${slotLabel(s)} · ${n1(r.calls)} calls · ${r.need.scheduled} agents${r.sched != null ? ` · ${r.sched} scheduled` : ''}`}
                      style={{ background: bg, color: dark ? '#fff' : 'var(--ink)', textAlign: 'center', fontSize: 12, padding: '4px 0', borderRadius: 4, cursor: 'pointer', outline: day === d ? '1px solid var(--accent)' : 'none', fontVariantNumeric: 'tabular-nums' }}>
                      {metric === 'calls' ? (r.calls >= 0.5 ? Math.round(r.calls) : '') : metric === 'gap' ? (r.calls > 0 ? (gap > 0 ? '+' + gap : gap) : '') : r.need.scheduled || ''}
                    </td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`${DAYS[day]}: interval plan`} right={
        <div style={{ ...S.row, gap: 8 }}>
          <Field label="Compare to schedule"><select style={{ ...S.input, width: 190 }} value={schedClient} onChange={e => setSchedClient(e.target.value)}><option value="">(none)</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          {schedClient && <Field label="Week of"><input type="date" style={{ ...S.input, width: 150 }} value={weekStart} onChange={e => setWeekStart(mondayOf(new Date(e.target.value + 'T12:00:00')))} /></Field>}
          <button className="btn btn-primary" onClick={() => onSave('inbound', prompt('Name this plan', `${p.mode === 'demo' ? 'Volume plan' : p.brands.join(' + ')} · ${p.slPct}/${p.slSec}`) || 'Inbound plan', p, { weekCalls, wAht, peak, agentHours, sl: slW }, p.brands, schedClient || null)}>Save plan</button>
        </div>}>
        <DayChart rows={dayRows} target={target} />
        <div style={{ display: 'flex', gap: 16, ...S.note }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 3, verticalAlign: -2 }} /> Calls</span>
          <span><span style={{ display: 'inline-block', width: 14, height: 3, background: 'var(--accent)', verticalAlign: 3 }} /> Agents to schedule (Erlang C + shrinkage)</span>
          {schedClient && <span><span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px dashed #c98a12', verticalAlign: 3 }} /> Scheduled</span>}
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 520 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={{ ...S.th, textAlign: 'left' }}>Interval</th><th style={S.th}>Calls</th><th style={S.th}>AHT</th><th style={S.th}>Erlangs</th>
              <th style={S.th}>On phones</th><th style={S.th}>To schedule</th><th style={S.th}>Service level</th><th style={S.th}>ASA</th><th style={S.th}>Occupancy</th><th style={S.th}>Est. abandon</th>
              {schedClient && <><th style={S.th}>Scheduled</th><th style={S.th}>Gap</th><th style={S.th}>SL as scheduled</th></>}
            </tr></thead>
            <tbody>
              {dayRows.map(r => {
                const gap = (r.sched || 0) - r.need.scheduled
                return (
                  <tr key={r.slot}>
                    <td style={{ ...S.td, textAlign: 'left', fontWeight: 600 }}>{slotLabel(r.slot)}</td>
                    <td style={S.td}>{n1(r.calls)}</td><td style={S.td}>{secs(r.aht)}</td><td style={S.td}>{r.need.A.toFixed(2)}</td>
                    <td style={S.td}>{r.need.N}</td><td style={{ ...S.td, fontWeight: 700, color: 'var(--accent)' }}>{r.need.scheduled}</td>
                    <td style={{ ...S.td, color: slColor(r.need.sl, target) }}>{pct(r.need.sl, 1)}</td><td style={S.td}>{secs(r.need.asa)}</td>
                    <td style={S.td}>{pct(r.need.occ)}</td><td style={S.td}>{pct(r.need.abandon, 1)}</td>
                    {schedClient && <><td style={S.td}>{r.sched}</td><td style={{ ...S.td, fontWeight: 700, color: gap < 0 ? 'var(--failed)' : gap > 1 ? '#c98a12' : 'var(--passed)' }}>{gap > 0 ? '+' + gap : gap}</td>
                      <td style={{ ...S.td, color: slColor(r.perf?.sl ?? 0, target) }}>{r.calls > 0 ? pct(r.perf?.sl, 0) : '—'}</td></>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={S.note}>Erlang C assumes callers wait in queue and calls arrive at random within each 30-minute interval. "To schedule" divides agents on the phones by (1 − shrinkage). Scheduled agents come from claimed intervals in Schedule (no-shows excluded).</div>
      </Card>
    </div>
  )
}

// ============================================================
// OUTBOUND — campaign workload → agent hours → agents per day / days to finish
// ============================================================
const MODES = { preview: { label: 'Preview', eff: 0.72, preview: 15 }, progressive: { label: 'Progressive', eff: 0.85, preview: 0 }, predictive: { label: 'Predictive', eff: 0.92, preview: 0 } }
const OUT_DEFAULTS = { records: 5000, days: 10, hoursPerDay: 9, attempts: 2.5, connect: 30, talk: 150, wrap: 45, ring: 25, mode: 'progressive', shrink: 25, agentsHave: 8, contactGoal: 60 }

function OutboundPlanner({ brands, onSave, preset }) {
  const [p, setP] = useState(OUT_DEFAULTS)
  const set = (k, v) => setP(x => ({ ...x, [k]: v }))
  useEffect(() => { if (preset) setP({ ...OUT_DEFAULTS, ...preset.params }) }, [preset])
  const outBrands = brands.filter(b => b.direction === 'outbound')
  const m = MODES[p.mode]
  const w = outboundWork({ records: num(p.records), attemptsPerRec: num(p.attempts), connectRate: num(p.connect) / 100, talk: num(p.talk), wrap: num(p.wrap), ringSec: num(p.ring), previewSec: m.preview, efficiency: m.eff, shrink: num(p.shrink) / 100 })
  const hoursAvail = num(p.days) * num(p.hoursPerDay)
  const agentsNeeded = hoursAvail > 0 ? w.paidHours / hoursAvail : 0
  const daysWithHave = num(p.agentsHave) > 0 ? w.paidHours / (num(p.agentsHave) * num(p.hoursPerDay)) : Infinity
  const reached = Math.min(num(p.records), w.connects) // upper bound: one live connect per record
  const reachRate = 1 - Math.pow(1 - num(p.connect) / 100, num(p.attempts))
  // scenario table: attempts per record 1..5
  const scen = [1, 2, 3, 4, 5].map(a => {
    const x = outboundWork({ records: num(p.records), attemptsPerRec: a, connectRate: num(p.connect) / 100, talk: num(p.talk), wrap: num(p.wrap), ringSec: num(p.ring), previewSec: m.preview, efficiency: m.eff, shrink: num(p.shrink) / 100 })
    return { a, reach: 1 - Math.pow(1 - num(p.connect) / 100, a), hours: x.paidHours, agents: hoursAvail ? x.paidHours / hoursAvail : 0 }
  })
  const fill = b => setP(x => ({ ...x, talk: Math.round(num(b.aht_sec, 150)) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Campaign" right={outBrands.length ? <span style={S.note}>Use real talk time from: {outBrands.slice(0, 6).map(b => <button key={b.brand} style={{ ...S.chip(false), marginLeft: 4, padding: '3px 9px' }} onClick={() => fill(b)}>{b.brand} ({secs(b.aht_sec)})</button>)}</span> : null}>
        <div style={S.row}>
          <Field label="Records to work"><NumIn value={p.records} onChange={v => set('records', v)} step={100} /></Field>
          <Field label="Campaign days"><NumIn value={p.days} onChange={v => set('days', v)} /></Field>
          <Field label="Dial hours / day"><NumIn value={p.hoursPerDay} onChange={v => set('hoursPerDay', v)} /></Field>
          <Field label="Attempts / record"><NumIn value={p.attempts} onChange={v => set('attempts', v)} step={0.5} /></Field>
          <Field label="Connect rate %" hint="Attempts that reach a live person"><NumIn value={p.connect} onChange={v => set('connect', v)} max={100} /></Field>
          <Field label="Talk (s)"><NumIn value={p.talk} onChange={v => set('talk', v)} step={10} /></Field>
          <Field label="Wrap (s)"><NumIn value={p.wrap} onChange={v => set('wrap', v)} step={5} /></Field>
          <Field label="No-connect time (s)" hint="Ring, voicemail detection and disposition per attempt that doesn't connect"><NumIn value={p.ring} onChange={v => set('ring', v)} /></Field>
          <Field label="Shrinkage %"><NumIn value={p.shrink} onChange={v => set('shrink', v)} max={80} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={S.note}>Dialer mode:</span>
          {Object.entries(MODES).map(([k, v]) => <button key={k} style={S.chip(p.mode === k)} onClick={() => set('mode', k)}>{v.label} · {pct(v.eff)} productive</button>)}
        </div>
      </Card>
      <div style={S.kpis}>
        <Kpi n={n0(w.attempts)} l="Dial attempts" />
        <Kpi n={n0(reached)} l={`Live connects · ${pct(reachRate)} of records reached`} />
        <Kpi n={n0(w.paidHours)} l="Paid agent hours (incl. shrinkage)" />
        <Kpi n={n1(agentsNeeded)} l={`Agents to finish in ${p.days} days`} tone="var(--accent)" />
        <Kpi n={n1(w.contactsPerHour)} l="Live contacts per productive hour" />
      </div>
      <Card title="Have a team already?">
        <div style={S.row}>
          <Field label="Agents available"><NumIn value={p.agentsHave} onChange={v => set('agentsHave', v)} /></Field>
          <div style={{ fontSize: 15 }}>With <b>{p.agentsHave}</b> agents at {p.hoursPerDay} hours a day, this list takes <b style={{ color: 'var(--accent)' }}>{isFinite(daysWithHave) ? n1(daysWithHave) : '—'} days</b> ({n0(w.paidHours / Math.max(1, num(p.agentsHave)))} hours per agent).</div>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => onSave('outbound', prompt('Name this plan', `Outbound · ${n0(p.records)} records`) || 'Outbound plan', p, { attempts: w.attempts, connects: w.connects, paidHours: w.paidHours, agentsNeeded })}>Save plan</button>
        </div>
      </Card>
      <Card title="Attempts vs reach vs cost">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={{ ...S.th, textAlign: 'left' }}>Attempts / record</th><th style={S.th}>Records reached</th><th style={S.th}>Paid hours</th><th style={S.th}>Agents for {p.days} days</th><th style={S.th}>Hours per extra contact</th></tr></thead>
          <tbody>{scen.map((s, i) => {
            const prev = scen[i - 1]
            const marg = prev ? (s.hours - prev.hours) / Math.max(1, (s.reach - prev.reach) * num(p.records)) : s.hours / Math.max(1, s.reach * num(p.records))
            return <tr key={s.a} style={{ background: Math.round(num(p.attempts)) === s.a ? 'var(--accent-bg)' : 'transparent' }}>
              <td style={{ ...S.td, textAlign: 'left', fontWeight: 600 }}>{s.a}</td><td style={S.td}>{pct(s.reach)}</td><td style={S.td}>{n0(s.hours)}</td><td style={S.td}>{n1(s.agents)}</td><td style={S.td}>{marg.toFixed(2)}</td>
            </tr>
          })}</tbody>
        </table>
        <div style={S.note}>Each extra attempt reaches fewer new people for the same effort. "Hours per extra contact" shows where more attempts stop paying off.</div>
      </Card>
    </div>
  )
}

// ============================================================
// SPEED TO LEAD — leads arrive at random; Erlang C sizes the team so X% are dialed within T seconds.
// With the AI Speed-to-Lead agent, every lead is called instantly and only the leads it doesn't
// resolve go to a live agent.
// ============================================================
const S2L_DEFAULTS = { leadsDay: 120, open: 16, close: 40, target: 90, within: 60, dial: 30, talk: 240, wrap: 60, shrink: 25, aiOn: true, aiResolve: 45 }

function SpeedToLeadPlanner({ onSave, preset }) {
  const [p, setP] = useState(S2L_DEFAULTS)
  const set = (k, v) => setP(x => ({ ...x, [k]: v }))
  useEffect(() => { if (preset) setP({ ...S2L_DEFAULTS, ...preset.params }) }, [preset])
  const slots = Array.from({ length: Math.max(0, p.close - p.open) }, (_, i) => p.open + i)
  const weights = slots.map(s => demoCurve(s) + 0.15)
  const tot = weights.reduce((a, b) => a + b, 0) || 1
  const aht = num(p.dial) + num(p.talk) * 0.55 + num(p.wrap) // first attempt: ~55% connect on a fresh lead
  const rows = slots.map((s, i) => {
    const leads = (num(p.leadsDay) * weights[i]) / tot
    const human = staffInterval({ calls: leads, aht, slPct: num(p.target) / 100, slSec: num(p.within), maxOcc: 0.8, shrink: num(p.shrink) / 100, minAgents: 1 })
    const hand = leads * (1 - num(p.aiResolve) / 100)
    const withAi = staffInterval({ calls: hand, aht: aht + 20, slPct: num(p.target) / 100, slSec: 300, maxOcc: 0.85, shrink: num(p.shrink) / 100, minAgents: 1 })
    return { slot: s, leads, human, withAi, hand }
  })
  const hoursHuman = rows.reduce((a, r) => a + r.human.scheduled * 0.5, 0)
  const hoursAi = rows.reduce((a, r) => a + r.withAi.scheduled * 0.5, 0)
  const peakH = Math.max(0, ...rows.map(r => r.human.scheduled)), peakA = Math.max(0, ...rows.map(r => r.withAi.scheduled))
  const med = rows.length ? rows.reduce((a, r) => a + r.leads * r.human.asa, 0) / Math.max(1, num(p.leadsDay)) : 0
  const W = 980, H = 220, P = { l: 40, r: 20, t: 14, b: 30 }
  const maxA = Math.max(1, peakH)
  const bw = (W - P.l - P.r) / Math.max(1, rows.length)
  const y = v => H - P.b - (v / maxA) * (H - P.t - P.b)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Lead flow and speed goal">
        <div style={S.row}>
          <Field label="Leads per day"><NumIn value={p.leadsDay} onChange={v => set('leadsDay', v)} step={10} /></Field>
          <Field label="Dial within (s)"><NumIn value={p.within} onChange={v => set('within', v)} step={5} /></Field>
          <Field label="For % of leads"><NumIn value={p.target} onChange={v => set('target', v)} max={99} /></Field>
          <Field label="Dial + ring (s)"><NumIn value={p.dial} onChange={v => set('dial', v)} /></Field>
          <Field label="Talk when reached (s)"><NumIn value={p.talk} onChange={v => set('talk', v)} step={10} /></Field>
          <Field label="Wrap (s)"><NumIn value={p.wrap} onChange={v => set('wrap', v)} step={5} /></Field>
          <Field label="Shrinkage %"><NumIn value={p.shrink} onChange={v => set('shrink', v)} /></Field>
          <Field label="Lead hours from"><select style={S.input} value={p.open} onChange={e => set('open', Number(e.target.value))}>{Array.from({ length: 48 }, (_, s) => <option key={s} value={s}>{slotLabel(s)}</option>)}</select></Field>
          <Field label="to"><select style={S.input} value={p.close} onChange={e => set('close', Number(e.target.value))}>{Array.from({ length: 48 }, (_, s) => <option key={s + 1} value={s + 1}>{slotLabel((s + 1) % 48)}</option>)}</select></Field>
        </div>
        <div style={{ ...S.row, alignItems: 'center' }}>
          <button style={S.chip(p.aiOn)} onClick={() => set('aiOn', !p.aiOn)}>{p.aiOn ? '✓ ' : ''}AI Speed-to-Lead agent calls first</button>
          {p.aiOn && <Field label="AI resolves % (books, answers, or rules out)"><NumIn value={p.aiResolve} onChange={v => set('aiResolve', v)} max={100} /></Field>}
          <span style={S.note}>With the AI agent, every lead is called in seconds, 24/7. Live agents only work what the AI hands off, and those can wait minutes instead of seconds.</span>
        </div>
      </Card>
      <div style={S.kpis}>
        <Kpi n={n0(peakH)} l={`Peak agents, live-only (${p.target}% in ${p.within}s)`} />
        <Kpi n={n0(hoursHuman)} l="Agent hours / day, live-only" />
        <Kpi n={secs(med)} l="Average wait before first dial, live-only" />
        {p.aiOn && <Kpi n={n0(peakA)} l="Peak agents with AI first touch" tone="var(--accent)" />}
        {p.aiOn && <Kpi n={n0(hoursAi)} l={`Agent hours / day with AI · ${pct(1 - hoursAi / Math.max(1, hoursHuman))} fewer`} tone="var(--passed)" />}
        {p.aiOn && <Kpi n="< 10s" l="AI time to first call, any hour" tone="var(--passed)" />}
      </div>
      <Card title="Agents needed through the day" right={<button className="btn btn-primary" onClick={() => onSave('speed_to_lead', prompt('Name this plan', `Speed to lead · ${p.leadsDay} leads/day`) || 'Speed-to-lead plan', p, { peakH, peakA, hoursHuman, hoursAi })}>Save plan</button>}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Agents by interval, live-only vs with AI">
          {rows.map((r, i) => <g key={r.slot}>
            <rect x={P.l + i * bw + 2} y={y(r.human.scheduled)} width={Math.max(1, (bw - 6) / (p.aiOn ? 2 : 1))} height={H - P.b - y(r.human.scheduled)} rx="2" fill="var(--line)" />
            {p.aiOn && <rect x={P.l + i * bw + 2 + (bw - 6) / 2} y={y(r.withAi.scheduled)} width={Math.max(1, (bw - 6) / 2)} height={H - P.b - y(r.withAi.scheduled)} rx="2" fill="var(--accent)" />}
            {i % 2 === 0 && <text x={P.l + i * bw + bw / 2} y={H - 10} fontSize="11" textAnchor="middle" fill="var(--ink-soft)">{slotLabel(r.slot, true)}</text>}
          </g>)}
          <text x={6} y={P.t + 8} fontSize="11" fill="var(--ink-soft)">{maxA}</text>
        </svg>
        <div style={{ display: 'flex', gap: 16, ...S.note }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--line)', borderRadius: 3, verticalAlign: -2 }} /> Live agents only</span>
          {p.aiOn && <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--accent)', borderRadius: 3, verticalAlign: -2 }} /> With AI first touch</span>}
        </div>
      </Card>
    </div>
  )
}

// ============================================================
// ERLANG C CALCULATOR — one interval, with a sensitivity table (great for client conversations)
// ============================================================
function Calculator() {
  const [c, setC] = useState({ calls: 120, interval: 30, aht: 240, slPct: 80, slSec: 30, patience: 90, shrink: 30, maxOcc: 85 })
  const set = (k, v) => setC(x => ({ ...x, [k]: v }))
  const iv = num(c.interval) * 60
  const need = staffInterval({ calls: num(c.calls), aht: num(c.aht), intervalSec: iv, slPct: num(c.slPct) / 100, slSec: num(c.slSec), maxOcc: num(c.maxOcc) / 100, shrink: num(c.shrink) / 100, patience: num(c.patience) })
  const rows = sensitivity({ calls: num(c.calls), aht: num(c.aht), intervalSec: iv, slSec: num(c.slSec), patience: num(c.patience), from: Math.max(1, need.N - 3), count: 9 })
  const target = num(c.slPct) / 100
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="One interval">
        <div style={S.row}>
          <Field label="Calls"><NumIn value={c.calls} onChange={v => set('calls', v)} /></Field>
          <Field label="Interval (min)"><select style={S.input} value={c.interval} onChange={e => set('interval', Number(e.target.value))}>{[15, 30, 60].map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
          <Field label="AHT (s)"><NumIn value={c.aht} onChange={v => set('aht', v)} step={10} /></Field>
          <Field label="Service level %"><NumIn value={c.slPct} onChange={v => set('slPct', v)} /></Field>
          <Field label="Within (s)"><NumIn value={c.slSec} onChange={v => set('slSec', v)} /></Field>
          <Field label="Max occupancy %"><NumIn value={c.maxOcc} onChange={v => set('maxOcc', v)} /></Field>
          <Field label="Shrinkage %"><NumIn value={c.shrink} onChange={v => set('shrink', v)} /></Field>
          <Field label="Patience (s)"><NumIn value={c.patience} onChange={v => set('patience', v)} /></Field>
        </div>
      </Card>
      <div style={S.kpis}>
        <Kpi n={need.A.toFixed(2)} l="Traffic (Erlangs)" />
        <Kpi n={need.N} l="Agents on the phones" tone="var(--accent)" />
        <Kpi n={need.scheduled} l="Agents to schedule (with shrinkage)" />
        <Kpi n={pct(need.sl, 1)} l={`Service level (${c.slPct}/${c.slSec})`} tone={slColor(need.sl, target)} />
        <Kpi n={secs(need.asa)} l="Average speed of answer" />
        <Kpi n={pct(need.occ)} l="Occupancy" />
      </div>
      <Card title="What one more (or one less) agent does">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={{ ...S.th, textAlign: 'left' }}>Agents</th><th style={S.th}>Service level</th><th style={S.th}>ASA</th><th style={S.th}>Calls that wait</th><th style={S.th}>Occupancy</th><th style={S.th}>Est. abandon</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.N} style={{ background: r.N === need.N ? 'var(--accent-bg)' : 'transparent' }}>
              <td style={{ ...S.td, textAlign: 'left', fontWeight: 700 }}>{r.N}{r.N === need.N ? '  ← recommended' : ''}</td>
              <td style={{ ...S.td, color: slColor(r.sl, target) }}>{pct(r.sl, 1)}</td><td style={S.td}>{secs(r.asa)}</td><td style={S.td}>{pct(r.pWait)}</td><td style={S.td}>{pct(r.occ)}</td><td style={S.td}>{pct(r.abandon, 1)}</td>
            </tr>))}</tbody>
        </table>
      </Card>
    </div>
  )
}

// ============================================================
function Plans({ onOpen }) {
  const data = useContext(DataCtx)
  const [rows, setRows] = useState(null)
  const load = () => data.plans().then(r => setRows(r || [])).catch(() => setRows([]))
  useEffect(() => { load() }, [])
  const del = async id => { if (!confirm('Delete this plan?')) return; try { await data.deletePlan(id) } catch { /* shown on reload */ } load() }
  if (!rows) return <p className="page-sub">Loading…</p>
  if (!rows.length) return <Card><p className="page-sub" style={{ margin: 0 }}>No saved plans yet. Build one on any tab and click Save plan.</p></Card>
  const kindL = { inbound: 'Inbound', outbound: 'Outbound', speed_to_lead: 'Speed to lead' }
  return (
    <Card pad={0}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th style={{ ...S.th, textAlign: 'left' }}>Plan</th><th style={{ ...S.th, textAlign: 'left' }}>Type</th><th style={S.th}>Key numbers</th><th style={{ ...S.th, textAlign: 'left' }}>By</th><th style={S.th}>Saved</th><th style={S.th}></th></tr></thead>
        <tbody>{rows.map(r => {
          const s = r.summary || {}
          const key = r.kind === 'inbound' ? `${n0(s.weekCalls)} calls/wk · peak ${n0(s.peak)} · ${n0(s.agentHours)} hrs` : r.kind === 'outbound' ? `${n0(s.paidHours)} hrs · ${n1(s.agentsNeeded)} agents` : `peak ${n0(s.peakH)} → ${n0(s.peakA)} with AI`
          return <tr key={r.id}>
            <td style={{ ...S.td, textAlign: 'left', fontWeight: 600 }}>{r.name}</td><td style={{ ...S.td, textAlign: 'left' }}>{kindL[r.kind]}</td><td style={S.td}>{key}</td>
            <td style={{ ...S.td, textAlign: 'left' }}>{r.created_by_name || ''}</td><td style={S.td}>{new Date(r.updated_at).toLocaleDateString()}</td>
            <td style={S.td}><button className="btn" onClick={() => onOpen(r)}>Open</button> <button className="btn btn-ghost" onClick={() => del(r.id)}>Delete</button></td>
          </tr>
        })}</tbody>
      </table>
    </Card>
  )
}
