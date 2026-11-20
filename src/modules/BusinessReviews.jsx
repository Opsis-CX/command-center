import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// BUSINESS REVIEWS (internal, Opsis CX) — Becky 11/19
// WBR / MBR / QBR / Annual for running Opsis CX itself. Separate from the GarageCo portal's reviews.
// Admins only (RPC opsis_biz_review checks is_admin_user()).
// Sources: Five9 calls + login hours, Opsis QA, hiring, sales, tracked time, GarageCo results.
// ============================================================

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DATA0 = '2026-06-01'
const G = '#2F7D5B', GD = '#1F5A41', BAD = '#B4432F'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const add = (ds, n) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const days = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5)
const monAdd = (ds, n) => { const d = new Date(ds.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
const fd = (ds) => { if (!ds) return ''; const p = String(ds).slice(0, 10).split('-'); return MONTHS[+p[1] - 1] + ' ' + (+p[2]) }
const fdl = (ds) => fd(ds) + ', ' + String(ds).slice(0, 4)
const fmt = (n) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US'))
const pct = (a, b) => (b ? (100 * a) / b : null)
const p1 = (v) => (v == null ? '—' : v.toFixed(1) + '%')
const money = (v) => (v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? '$' + Math.round(v / 1e3) + 'K' : '$' + fmt(Math.round(v)))

function periods(kind) {
  const t = today(), out = []
  const mk = (k, label, start, end, ps, pe, grain, trend, cmp) => out.push({ k, label, start, end, ps, pe, grain, trend, cmp })
  if (kind === 'wbr') {
    const mon = add(t, -((new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7))
    for (let i = 0; i < 16; i++) { const m = add(mon, -7 * i), e = i === 0 ? t : add(m, 6); if (e < DATA0) break; const len = days(m, e)
      mk(m, i === 0 ? 'This week (so far)' : 'Week of ' + fd(m), m, e, add(m, -7), add(m, -7 + len), 'week', add(m, -77), i === 0 ? 'the same days last week' : 'the week before') }
  } else if (kind === 'mbr') {
    const m0 = t.slice(0, 7) + '-01'
    for (let j = 0; j < 12; j++) { const ms = monAdd(m0, -j), me = j === 0 ? t : add(monAdd(ms, 1), -1); if (me < DATA0) break; const pm = monAdd(ms, -1)
      const pme = j === 0 ? add(pm, Math.min(days(ms, me), days(pm, add(ms, -1)))) : add(ms, -1)
      mk(ms, MONTHS[+ms.slice(5, 7) - 1] + ' ' + ms.slice(0, 4) + (j === 0 ? ' (so far)' : ''), ms, me, pm, pme, 'month', monAdd(ms, -11), j === 0 ? 'the same point last month' : MONTHS[+pm.slice(5, 7) - 1]) }
  } else if (kind === 'qbr') {
    const q0 = t.slice(0, 5) + String(Math.floor((+t.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0') + '-01'
    for (let q = 0; q < 6; q++) { const qs = monAdd(q0, -3 * q), qe = q === 0 ? t : add(monAdd(qs, 3), -1); if (qe < DATA0) break; const pq = monAdd(qs, -3), qn = Math.floor((+qs.slice(5, 7) - 1) / 3) + 1
      mk(qs, 'Q' + qn + ' ' + qs.slice(0, 4) + (q === 0 ? ' (so far)' : ''), qs, qe, pq, q === 0 ? add(pq, days(qs, qe)) : add(qs, -1), 'month', monAdd(qs, -9), q === 0 ? 'the same point last quarter' : 'Q' + (qn === 1 ? 4 : qn - 1)) }
  } else {
    const y = +t.slice(0, 4)
    for (let yy = y; yy >= 2026; yy--) { const ys = yy + '-01-01', ye = yy === y ? t : yy + '-12-31'
      mk(ys, yy + (yy === y ? ' (so far)' : ''), ys, ye, yy - 1 + '-01-01', yy - 1 + ye.slice(4), 'month', ys, 'the year before') }
  }
  return out
}
function defaultPeriod(kind, list) { if (kind === 'wbr' || kind === 'mbr') return list[1] || list[0]; if (kind === 'qbr') return days(list[0].start, list[0].end) >= 29 || !list[1] ? list[0] : list[1]; return list[0] }

// derived metrics, so totals, buckets and agents all compute them the same way
function derive(x) {
  if (!x) return {}
  return { ...x, dials: x.calls, contact_rate: pct(x.contacts, x.outbound), book_rate: pct(x.booked, x.contacts), stl_contact: pct(x.stl_contacts, x.stl_calls), stl_book: pct(x.stl_booked, x.stl_contacts),
    nr_pct: pct(x.nr_h, x.login_h), per_hr: x.login_h ? x.calls / x.login_h : null }
}
const RATE = { contact_rate: 1, book_rate: 1, stl_contact: 1, stl_book: 1, nr_pct: 1, qa_conv: 1 }
const LOWER = { nr_pct: 1 }
const GROUP = { calls: 'five9', booked: 'five9', contacts: 'five9', contact_rate: 'five9', book_rate: 'five9', stl_book: 'five9', stl_contact: 'five9', talk_h: 'five9', login_h: 'hours', nr_pct: 'hours', per_hr: 'hours', qa: 'qa', qa_conv: 'qa', apps: 'hiring', hires: 'hiring', deals_new: 'sales', meetings: 'sales', emails: 'sales', tracked_h: 'time' }
function valStr(k, v) { if (v == null || isNaN(v)) return '—'; if (RATE[k]) return p1(v); if (k === 'qa') return v.toFixed(1); if (/_h$/.test(k)) return fmt(Math.round(v)); if (k === 'per_hr') return v.toFixed(1); return fmt(v) }

function Delta({ d, k, cur, prev }) {
  const since = (d.data_since || {})[GROUP[k] || 'five9']
  const fair = since && d.range.prev_start >= since
  if (!fair || cur == null || prev == null) return <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{fair ? 'no earlier data' : 'no comparison yet'}</span>
  const isRate = RATE[k] || k === 'qa'
  const dd = isRate ? cur - prev : prev ? (100 * (cur - prev)) / prev : null
  if (dd == null) return <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>new</span>
  if (Math.abs(dd) < (isRate ? 0.05 : 0.5)) return <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>flat</span>
  const up = dd > 0, good = LOWER[k] ? !up : up
  return <span style={{ fontSize: 11.5, fontWeight: 600, color: good ? G : BAD }}>{up ? '▲ ' : '▼ '}{isRate ? Math.abs(dd).toFixed(1) + ' pts' : Math.abs(dd).toFixed(0) + '%'}</span>
}

const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #E8E4DC)', borderRadius: 14, padding: '16px 18px' }
const cap = { fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }

function Sec({ n, t, h, children }) {
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', color: G }}>{n} {t.toUpperCase()}</span><span style={{ flex: 1, height: 1, background: 'var(--border, #E8E4DC)' }} /></div>
      <h2 style={{ fontSize: 20, fontWeight: 650, margin: '6px 0 12px' }}>{h}</h2>
      {children}
    </section>
  )
}
function Bar({ label, v, max, txt, color }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) 80px', gap: 10, alignItems: 'center', fontSize: 12.5, padding: '5px 0' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ height: 6, background: 'var(--surface-2, #F1EEE8)', borderRadius: 3 }}><span style={{ display: 'block', height: 6, borderRadius: 3, background: color || G, width: (max ? Math.max(v ? 2 : 0, (100 * v) / max) : 0) + '%' }} /></span>
      <b style={{ textAlign: 'right' }}>{txt}</b>
    </div>
  )
}
function Hero({ title, big, sub, children, foot }) {
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
      <div style={cap}>{title}</div>
      <div style={{ fontSize: 42, fontWeight: 700, margin: '8px 0 2px', letterSpacing: '-.02em' }}>{big}</div>
      <div style={{ marginBottom: 10 }}>{sub}</div>
      <div style={{ borderTop: '1px solid var(--border, #E8E4DC)', paddingTop: 8, flex: 1 }}>{children}</div>
      {foot && <div style={{ marginTop: 8 }}>{foot}</div>}
    </div>
  )
}
const Pill = ({ children, tone }) => <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: tone === 'bad' ? 'rgba(180,67,47,.12)' : tone === 'mut' ? 'var(--surface-2, #F3F1EC)' : 'rgba(47,125,91,.13)', color: tone === 'bad' ? BAD : tone === 'mut' ? 'var(--muted)' : GD }}>{children}</span>

function Trend({ d, metric, p }) {
  const since = (d.data_since || {})[GROUP[metric] || 'five9']
  const bk = (d.buckets || []).map((b) => derive(b)).filter((b) => since && add(b.k, d.range.grain === 'week' ? 6 : 31) >= since)
  if (!bk.length) return <p style={{ color: 'var(--muted)' }}>No data for this measure yet.</p>
  const W = 900, H = 240, pl = 46, pb = 26, n = bk.length, step = (W - pl) / n, bw = Math.min(60, step * 0.62)
  const vals = bk.map((b) => (b[metric] == null ? null : +b[metric]))
  const mx = Math.max(0, ...vals.filter((v) => v != null))
  const top = RATE[metric] ? Math.min(100, Math.ceil(mx / 10) * 10 || 10) : metric === 'qa' ? 100 : (() => { const m = mx || 1, e = Math.pow(10, Math.floor(Math.log10(m))), f = m / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e })()
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 10 }} role="img" aria-label="Trend">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const y = H - pb - f * (H - pb - 22); return <g key={f}><line x1={pl} x2={W} y1={y} y2={y} stroke="var(--border, #EEEBE4)" strokeDasharray={f ? '3 4' : undefined} /><text x={pl - 8} y={y} fontSize="10.5" fill="currentColor" opacity=".55" textAnchor="end" dominantBaseline="middle">{valStr(metric, top * f).replace(/\.0(?=%|$)/, '')}</text></g> })}
      {bk.map((b, i) => {
        const v = vals[i], x = pl + i * step + (step - bw) / 2, hh = v == null ? 0 : Math.max(1, (v / top) * (H - pb - 22)), y = H - pb - hh
        const inP = b.k <= p.end && b.k >= p.start.slice(0, d.range.grain === 'week' ? 10 : 7)
        const lab = d.range.grain === 'week' ? fd(b.k) : MONTHS[+b.k.slice(5, 7) - 1] + ' ’' + b.k.slice(2, 4)
        return (
          <g key={b.k}><title>{lab + ': ' + valStr(metric, v)}</title>
            {v != null && <><rect x={x} y={y} width={bw} height={hh} rx="4" fill={inP ? GD : '#7FB59B'} /><text x={x + bw / 2} y={y - 6} fontSize="11" fontWeight="600" fill="currentColor" textAnchor="middle">{valStr(metric, v)}</text></>}
            <text x={x + bw / 2} y={H - 8} fontSize="10.5" fill="currentColor" opacity=".55" textAnchor="middle">{lab}</text>
          </g>
        )
      })}
    </svg>
  )
}

const TABS = [['wbr', 'WBR'], ['mbr', 'MBR'], ['qbr', 'QBR'], ['annual', 'Annual']]
const METRICS = [['calls', 'Calls'], ['booked', 'Booked'], ['contact_rate', 'Contact rate'], ['book_rate', 'Booking rate'], ['qa', 'QA score'], ['login_h', 'Login hours'], ['apps', 'Applicants'], ['tracked_h', 'Tracked hours']]

export default function BusinessReviews() {
  const [tab, setTab] = useState('wbr')
  const [pick, setPick] = useState({})
  const [metric, setMetric] = useState('calls')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState({})
  const list = useMemo(() => periods(tab), [tab])
  const p = list.find((x) => x.k === pick[tab]) || defaultPeriod(tab, list)

  useEffect(() => {
    let on = true
    setData(null); setErr('')
    supabase.rpc('opsis_biz_review', { p_start: p.start, p_end: p.end, p_grain: p.grain, p_trend_start: p.trend, p_prev_start: p.ps, p_prev_end: p.pe })
      .then(({ data: d, error }) => { if (!on) return; if (error) setErr(error.message || 'Could not load the review.'); else setData(d) })
    return () => { on = false }
  }, [p.start, p.end, p.ps, p.pe, p.grain, p.trend])

  const name = { wbr: 'week', mbr: 'month', qbr: 'quarter', annual: 'year' }[tab]
  return (
    <div style={{ padding: '20px 24px 40px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2, #EFECE6)', padding: 4, borderRadius: 12 }}>
          {TABS.map(([k, l]) => <button key={k} className="btn" onClick={() => setTab(k)} style={{ border: 'none', minHeight: 34, padding: '6px 16px', background: tab === k ? GD : 'transparent', color: tab === k ? '#fff' : 'inherit', fontWeight: 600 }}>{l}</button>)}
        </div>
        <label style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>Period
          <select value={p.k} onChange={(e) => setPick({ ...pick, [tab]: e.target.value })} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border, #E1DCD2)', background: 'var(--card, #fff)', color: 'inherit', minWidth: 200 }}>
            {list.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...cap, color: G }}>{{ wbr: 'Weekly', mbr: 'Monthly', qbr: 'Quarterly', annual: 'Annual' }[tab]} business review · internal</div>
          <h1 style={{ fontSize: 30, margin: '2px 0 6px', letterSpacing: '-.02em' }}>Opsis CX · {p.label}</h1>
          <Pill tone="mut">{fdl(p.start)} – {fdl(p.end)}</Pill> <Pill tone="mut">compared with {p.cmp}</Pill>
        </div>
        <button className="btn btn-ghost" onClick={() => window.print()}>Print / PDF</button>
      </div>
      {err && <div style={{ ...card, marginTop: 16, color: BAD }}>{err}</div>}
      {!data && !err && <div style={{ ...card, marginTop: 16, color: 'var(--muted)' }}>Loading…</div>}
      {data && <Review d={data} p={p} name={name} metric={metric} setMetric={setMetric} open={open} setOpen={setOpen} />}
    </div>
  )
}

function Review({ d, p, name, metric, setMetric, open, setOpen }) {
  const c = derive(d.cur), pv = derive(d.prev), ds = d.data_since || {}
  const D = (k) => <Delta d={d} k={k} cur={c[k]} prev={pv[k]} />

  // programs
  const progs = {}
  ;(d.programs || []).forEach((r) => {
    const k = r.program; progs[k] = progs[k] || { program: k, cur: { calls: 0, contacts: 0, booked: 0, talk_h: 0 }, prev: { calls: 0, contacts: 0, booked: 0, talk_h: 0 }, brands: {} }
    const t = r.cur ? progs[k].cur : progs[k].prev
    t.calls += r.calls; t.contacts += r.contacts; t.booked += r.booked; t.talk_h += +r.talk_h || 0
    if (r.brand && r.cur) progs[k].brands[r.brand] = r
  })
  const P = Object.values(progs).sort((a, b) => b.cur.calls - a.cur.calls)

  // what changed
  const notes = []
  const fair = (g) => ds[g] && d.range.prev_start >= ds[g]
  if (fair('five9') && pv.calls) { const ch = pct(c.calls - pv.calls, pv.calls); if (Math.abs(ch) >= 5) notes.push([ch > 0 ? 'good' : 'bad', <>Calls {ch > 0 ? 'up' : 'down'} <b>{Math.abs(ch).toFixed(0)}%</b> to {fmt(c.calls)}.</>]) }
  if (fair('five9') && c.book_rate != null && pv.book_rate != null && Math.abs(c.book_rate - pv.book_rate) >= 2) notes.push([c.book_rate > pv.book_rate ? 'good' : 'bad', <>Booking rate on contacts {c.book_rate > pv.book_rate ? 'up' : 'down'} <b>{Math.abs(c.book_rate - pv.book_rate).toFixed(1)} pts</b> to {p1(c.book_rate)}.</>])
  const stl = P.find((x) => x.program === 'Speed to Lead')
  if (stl && stl.cur.calls) notes.push(['good', <>Speed to Lead: <b>{fmt(stl.cur.booked)}</b> booked from {fmt(stl.cur.calls)} dials ({p1(pct(stl.cur.contacts, stl.cur.calls))} reached).</>])
  if (c.nr_pct != null && c.nr_pct >= 20) notes.push(['watch', <>Not-ready time is <b>{p1(c.nr_pct)}</b> of login hours.</>])
  if (c.qa != null) notes.push([c.qa >= 85 ? 'good' : 'watch', <>Opsis QA score <b>{c.qa.toFixed(1)}</b> on {fmt(c.qa_n)} scored calls.</>])
  if (c.apps || c.hires) notes.push(['good', <>Hiring: <b>{fmt(c.apps)}</b> applicants, <b>{fmt(c.hires)}</b> hired.</>])
  const gc = (d.garageco || {}).cur, gp = (d.garageco || {}).prev
  if (gc && gc.conv != null) notes.push(['good', <>GarageCo booking rate <b>{p1(gc.conv)}</b>{gp && gp.conv != null ? <> ({gc.conv >= gp.conv ? '+' : ''}{(gc.conv - gp.conv).toFixed(1)} pts)</> : null}, card ask rate <b>{p1(gc.card_rate)}</b>.</>])
  const IC = { good: [G, '▲'], bad: [BAD, '▼'], watch: ['#B7791F', '!'] }

  const agents = (d.agents || []).map((a) => ({ ...a, nr_pct: pct(a.nr_h, a.login_h), per_hr: a.login_h ? (a.calls || 0) / a.login_h : null, book_rate: pct(a.booked, a.contacts) }))
  const te = {}; (d.time_by_client || []).forEach((r) => { te[r.client] = te[r.client] || { client: r.client, cur: 0, prev: 0 }; te[r.client][r.cur ? 'cur' : 'prev'] += +r.h || 0 })
  const T = Object.values(te).filter((x) => x.cur || x.prev).sort((a, b) => b.cur - a.cur)
  const tmax = Math.max(1, ...T.map((x) => Math.max(x.cur, x.prev)))
  const F = d.hiring_funnel || {}
  const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', padding: '0 10px 8px', whiteSpace: 'nowrap' }
  const td = { padding: '9px 10px', borderTop: '1px solid var(--border, #F1EEE8)', fontSize: 13 }
  const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

  return (
    <>
      <Sec n="01" t="Headline metrics" h={`What Opsis CX delivered this ${name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
          <Hero title="Calls handled" big={fmt(c.calls)} sub={<>{D('calls')} <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>vs {p.cmp}</span></>}
            foot={<Pill>{fmt(c.agents)} agents on the phones</Pill>}>
            <Bar label="Outbound dials" v={c.outbound} max={c.calls} txt={fmt(c.outbound)} />
            <Bar label="Inbound" v={c.inbound} max={c.calls} txt={fmt(c.inbound)} color="#3474C9" />
            <Bar label="Reached a person" v={c.contacts} max={c.calls} txt={fmt(c.contacts)} color="#9B59C9" />
          </Hero>
          <Hero title="Appointments booked" big={fmt(c.booked)} sub={<>{D('booked')} <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p1(c.book_rate)} of people reached</span></>}
            foot={<Pill>{fmt(c.transferred)} transferred to a brand</Pill>}>
            {P.filter((x) => x.cur.booked).slice(0, 4).map((x) => <Bar key={x.program} label={x.program} v={x.cur.booked} max={Math.max(1, ...P.map((y) => y.cur.booked))} txt={fmt(x.cur.booked)} />)}
            {!P.some((x) => x.cur.booked) && <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>No bookings this {name}.</p>}
          </Hero>
          <Hero title="Hours worked" big={fmt(Math.round((c.login_h || 0) + (c.tracked_h || 0)))} sub={<span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Five9 login hours + time tracked in Command Center</span>}
            foot={<Pill tone={c.nr_pct >= 20 ? 'bad' : undefined}>{p1(c.nr_pct)} not ready · {c.per_hr != null ? c.per_hr.toFixed(1) : '—'} calls per login hour</Pill>}>
            <Bar label="Five9 login" v={c.login_h || 0} max={Math.max(c.login_h || 0, c.tracked_h || 0)} txt={fmt(Math.round(c.login_h || 0)) + ' h'} />
            <Bar label="Talk time" v={c.talk_h || 0} max={Math.max(c.login_h || 0, c.tracked_h || 0)} txt={fmt(Math.round(c.talk_h || 0)) + ' h'} color="#3474C9" />
            <Bar label="Tracked (staff)" v={c.tracked_h || 0} max={Math.max(c.login_h || 0, c.tracked_h || 0)} txt={fmt(Math.round(c.tracked_h || 0)) + ' h'} color="#9B59C9" />
          </Hero>
        </div>
        <div style={{ ...card, marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '6px 14px' }}>
          {[['contact_rate', 'Contact rate', 'Outbound dials that reached a person'], ['book_rate', 'Booking rate', 'Booked ÷ people reached'], ['stl_book', 'Speed to Lead booking', 'Speed to Lead booked ÷ people reached'], ['qa', 'QA score', 'Opsis CX calls, AI-scored'], ['nr_pct', 'Not ready', 'Not-ready hours ÷ Five9 login hours'], ['per_hr', 'Calls per login hour', 'All Five9 calls ÷ login hours']].map(([k, l, tip]) => (
            <div key={k} title={tip}><div style={cap}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, margin: '2px 0' }}>{valStr(k, c[k])}</div>{D(k)}</div>
          ))}
        </div>
      </Sec>

      <Sec n="02" t="What changed" h={notes.length ? `The ${Math.min(notes.length, 7)} things worth knowing` : `Nothing unusual this ${name}`}>
        {!!notes.length && <div style={card}>{notes.slice(0, 7).map((n, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i ? '1px solid var(--border, #F1EEE8)' : 'none', fontSize: 14, lineHeight: 1.5 }}>
            <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 10, background: IC[n[0]][0] + '22', color: IC[n[0]][0], fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>{IC[n[0]][1]}</span><span>{n[1]}</span>
          </div>))}</div>}
      </Sec>

      <Sec n="03" t="Programs" h="How each program did · click Speed to Lead for brands">
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr><th style={th}>Program</th><th style={{ ...th, textAlign: 'right' }}>Calls</th><th style={{ ...th, textAlign: 'right' }}>Reached</th><th style={{ ...th, textAlign: 'right' }}>Contact rate</th><th style={{ ...th, textAlign: 'right' }}>Booked</th><th style={{ ...th, textAlign: 'right' }}>Booking rate</th><th style={{ ...th, textAlign: 'right' }}>Talk hours</th></tr></thead>
            <tbody>{P.filter((x) => x.cur.calls || x.prev.calls).map((x) => {
              const br = Object.values(x.brands).sort((a, b) => b.calls - a.calls), op = open[x.program]
              const cr = pct(x.cur.contacts, x.cur.calls), bkr = pct(x.cur.booked, x.cur.contacts)
              return (
                <React.Fragment key={x.program}>
                  <tr onClick={() => br.length && setOpen({ ...open, [x.program]: !op })} style={{ cursor: br.length ? 'pointer' : 'default' }}>
                    <td style={td}><b>{br.length ? (op ? '▾ ' : '▸ ') : ''}{x.program}</b></td>
                    <td style={num}>{fmt(x.cur.calls)}<div><Delta d={d} k="calls" cur={x.cur.calls} prev={x.prev.calls} /></div></td>
                    <td style={num}>{fmt(x.cur.contacts)}</td>
                    <td style={num}>{p1(cr)}<div><Delta d={d} k="contact_rate" cur={cr} prev={pct(x.prev.contacts, x.prev.calls)} /></div></td>
                    <td style={num}>{fmt(x.cur.booked)}<div><Delta d={d} k="booked" cur={x.cur.booked} prev={x.prev.booked} /></div></td>
                    <td style={num}>{p1(bkr)}</td>
                    <td style={num}>{fmt(Math.round(x.cur.talk_h))}</td>
                  </tr>
                  {op && br.map((b) => <tr key={b.brand} style={{ background: 'var(--surface-2, #FAF9F6)' }}><td style={{ ...td, paddingLeft: 34, color: 'var(--muted)' }}>{b.brand}</td><td style={num}>{fmt(b.calls)}</td><td style={num}>{fmt(b.contacts)}</td><td style={num}>{p1(pct(b.contacts, b.calls))}</td><td style={num}>{fmt(b.booked)}</td><td style={num}>{p1(pct(b.booked, b.contacts))}</td><td style={num}>{fmt(Math.round(b.talk_h))}</td></tr>)}
                </React.Fragment>
              )
            })}</tbody>
          </table>
        </div>
      </Sec>

      <Sec n="04" t="Performance over time" h={`${METRICS.find((m) => m[0] === metric)[1]} by ${d.range.grain}`}>
        <div style={card}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--surface-2, #EFECE6)', padding: 3, borderRadius: 10, width: 'fit-content' }}>
            {METRICS.map(([k, l]) => <button key={k} className="btn" onClick={() => setMetric(k)} style={{ border: 'none', minHeight: 30, padding: '4px 10px', fontSize: 12, background: metric === k ? GD : 'transparent', color: metric === k ? '#fff' : 'inherit' }}>{l}</button>)}
          </div>
          <Trend d={d} metric={metric} p={p} />
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{d.range.grain === 'week' ? 'Weeks start Monday' : 'Calendar months'} · the latest {d.range.grain} is partial · dark bars are inside this {name}</div>
        </div>
      </Sec>

      <Sec n="05" t="Agents" h={`${agents.length} agents this ${name}`}>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>{['Agent', 'Calls', 'Reached', 'Booked', 'Booking rate', 'Talk hrs', 'Login hrs', 'Not ready', 'Calls / login hr', 'QA'].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>{agents.map((a) => (
              <tr key={a.agent}><td style={td}><b>{a.agent}</b></td><td style={num}>{fmt(a.calls)}</td><td style={num}>{fmt(a.contacts)}</td><td style={num}>{fmt(a.booked)}</td><td style={num}>{p1(a.book_rate)}</td><td style={num}>{a.talk_h != null ? (+a.talk_h).toFixed(1) : '—'}</td><td style={num}>{a.login_h != null ? (+a.login_h).toFixed(1) : '—'}</td>
                <td style={{ ...num, color: a.nr_pct >= 20 ? BAD : 'inherit' }}>{p1(a.nr_pct)}</td><td style={num}>{a.per_hr != null ? a.per_hr.toFixed(1) : '—'}</td><td style={num}>{a.qa != null ? (+a.qa).toFixed(1) : '—'}{a.qa_n ? <span style={{ color: 'var(--muted)', fontSize: 11 }}> ({a.qa_n})</span> : null}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Sec>

      <Sec n="06" t="Growth" h="Hiring and sales">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
          <div style={card}>
            <div style={cap}>Hiring</div>
            <div style={{ display: 'flex', gap: 28, margin: '8px 0 12px' }}>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(c.apps)}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>applicants</div>{D('apps')}</div>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(c.hires)}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>hired</div>{D('hires')}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Pipeline moves this {name}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{Object.entries(F).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Pill key={k} tone={/denied|withdrawn|failed|out_of_area/.test(k) ? 'mut' : undefined}>{k.replace(/_/g, ' ')} · {v}</Pill>)}{!Object.keys(F).length && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>No moves.</span>}</div>
          </div>
          <div style={card}>
            <div style={cap}>Sales</div>
            <div style={{ display: 'flex', gap: 28, margin: '8px 0 12px' }}>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(c.deals_new)}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>new prospects</div>{D('deals_new')}</div>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(c.emails)}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>emails sent</div>{D('emails')}</div>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(c.meetings)}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>meetings</div>{D('meetings')}</div>
            </div>
          </div>
        </div>
      </Sec>

      <Sec n="07" t="Clients" h="Client results and where the team’s time went">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
          <div style={card}>
            <div style={cap}>GarageCo</div>
            {gc ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginTop: 10 }}>
              {[['Booking rate', p1(gc.conv), gp && gp.conv != null ? gc.conv - gp.conv : null], ['Card ask rate', p1(gc.card_rate), gp && gp.card_rate != null ? gc.card_rate - gp.card_rate : null], ['Revenue from booked calls', money(gc.revenue), null], ['Calls QA’d', fmt(gc.scored), null], ['QA score', gc.qa != null ? gc.qa.toFixed(1) : '—', gp && gp.qa != null ? gc.qa - gp.qa : null], ['AI CSR calls', fmt(gc.ai_calls), null]].map(([l, v, dd]) => (
                <div key={l}><div style={{ fontSize: 12, color: 'var(--muted)' }}>{l}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>{dd != null && d.range.prev_start >= '2026-07-16' && <span style={{ fontSize: 11.5, fontWeight: 600, color: dd >= 0 ? G : BAD }}>{dd >= 0 ? '▲ ' : '▼ '}{Math.abs(dd).toFixed(1)} pts</span>}</div>
              ))}
            </div> : <p style={{ color: 'var(--muted)' }}>No GarageCo data this {name}.</p>}
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>The full client review is in the GarageCo portal under Business reviews.</div>
          </div>
          <div style={card}>
            <div style={cap}>Time tracked by client</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>Command Center time entries · this {name} (dark) vs {p.cmp} (light)</div>
            {T.slice(0, 10).map((x) => (
              <div key={x.client} style={{ display: 'grid', gridTemplateColumns: '170px minmax(0,1fr) 70px', gap: '2px 10px', alignItems: 'center', fontSize: 12.5, padding: '4px 0' }}>
                <span style={{ gridRow: 'span 2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.client}</span>
                <span style={{ height: 6, background: 'var(--surface-2, #F1EEE8)', borderRadius: 3 }}><span style={{ display: 'block', height: 6, borderRadius: 3, background: GD, width: (100 * x.cur) / tmax + '%' }} /></span><b style={{ textAlign: 'right' }}>{x.cur.toFixed(1)} h</b>
                <span style={{ height: 6, background: 'var(--surface-2, #F1EEE8)', borderRadius: 3 }}><span style={{ display: 'block', height: 6, borderRadius: 3, background: '#9CC6B2', width: (100 * x.prev) / tmax + '%' }} /></span><span style={{ textAlign: 'right', color: 'var(--muted)' }}>{x.prev.toFixed(1)} h</span>
              </div>
            ))}
            {!T.length && <p style={{ color: 'var(--muted)' }}>No time tracked.</p>}
          </div>
        </div>
      </Sec>
      <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 20, lineHeight: 1.6 }}>
        Data starts: Five9 calls {fd(ds.five9)} · login hours {fd(ds.hours)} · Opsis QA {fd(ds.qa)} · hiring {fd(ds.hiring)} · sales {fd(ds.sales)} · time tracking {fd(ds.time)}. Changes are only shown when the earlier period has full data. Reached = a real conversation (not voicemail, no answer, busy or a failed call).
      </p>
    </>
  )
}
