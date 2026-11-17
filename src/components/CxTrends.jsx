// ============================================================
//  CxTrends — "Call trends" (2026-11-15). What callers are calling about, across every scored call
//  (LightSpeed, Five9 and the phone engine): topics rising or falling this week vs the brand's normal,
//  top topics. (11/16: weekly lines, objections, not-booked reasons and booking rate by week removed — repeated the dashboard.)
//  Data: cx_trends(p_days, p_brand, p_client) — scoped to the login's client / brand.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const G = '#14302A', UP = '#A8441A', DOWN = '#2F7D5B', BAR = '#2F7D5B', MUTE = '#94a3b8'
const fmtWeek = d => new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })

export default function CxTrends({ clientId = null }) {
  const [days, setDays] = useState(28)
  const [brand, setBrand] = useState('')
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('cx_trends', { p_days: days, p_brand: brand || null, ...(clientId ? { p_client: clientId } : {}) })
    setBusy(false)
    if (error) setErr(error.message); else { setD(data); setErr('') }
  }, [days, brand, clientId])
  useEffect(() => { load() }, [load])

  const weekly = useMemo(() => {
    const by = {}
    for (const w of d?.weekly || []) { (by[w.topic] = by[w.topic] || {})[w.week] = w.n }
    const weeks = [...new Set((d?.weekly || []).map(w => w.week))].sort()
    return { weeks, rows: Object.entries(by).map(([topic, m]) => ({ topic, vals: weeks.map(k => m[k] || 0) })) }
  }, [d])

  if (err && !d) return <div style={S.card}><b>Couldn’t load call trends.</b><p style={S.mut}>{err}</p></div>
  if (!d) return <div style={S.card}>Loading…</div>
  const maxTop = Math.max(1, ...(d.top || []).map(t => t.total))

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={S.h2}>Call trends</div>
          <div style={S.mut}>{(d.calls || 0).toLocaleString()} scored calls in the last {d.days} days. “This week” = the last 7 days, compared with the weekly average before that.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(d.brands || []).length > 1 && (
            <select value={brand} onChange={e => setBrand(e.target.value)} style={S.input}>
              <option value="">All brands</option>{d.brands.map(b => <option key={b}>{b}</option>)}
            </select>
          )}
          <select value={days} onChange={e => setDays(Number(e.target.value))} style={S.input}>
            {[14, 28, 56, 90].map(n => <option key={n} value={n}>Last {n} days</option>)}
          </select>
          {busy && <span style={S.mut}>Updating…</span>}
        </div>
      </div>

      <div style={S.cols}>
        <div style={S.card}>
          <div style={S.h3}>Rising this week</div>
          {(d.spikes || []).length === 0 && <div style={S.mut}>Nothing unusual — every topic is within its normal range.</div>}
          {(d.spikes || []).map(s => <Move key={s.topic} s={s} up />)}
        </div>
        <div style={S.card}>
          <div style={S.h3}>Falling this week</div>
          {(d.drops || []).length === 0 && <div style={S.mut}>No topic dropped sharply.</div>}
          {(d.drops || []).map(s => <Move key={s.topic} s={s} />)}
        </div>
      </div>

      <div style={S.card}>
        <div style={S.h3}>Top reasons people call</div>
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          {(d.top || []).map(t => (
            <div key={t.topic} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 90px', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.topic}>{t.topic}</span>
              <span style={{ background: '#f1f5f9', borderRadius: 6, height: 14, position: 'relative' }}>
                <span style={{ position: 'absolute', inset: 0, width: `${(100 * t.total) / maxTop}%`, background: BAR, borderRadius: 6, opacity: 0.85 }} />
              </span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{t.total}</b> <span style={S.mut}>· {t.this_wk} this wk</span></span>
            </div>
          ))}
        </div>
      </div>
      {/* 11/16 (Becky): week-by-week topics, top objections, why calls didn't book and booking rate by week
          removed here; they repeat the dashboard and its drill-downs. */}
    </div>
  )
}

function Move({ s, up }) {
  const pct = s.pct == null ? 'new' : `${s.pct > 0 ? '+' : ''}${s.pct}%`
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid #f1f5f9', fontSize: 13 }}>
      <span><b>{s.topic}</b><div style={S.mut}>{s.this_wk} this week · usually {s.avg_wk}/week</div></span>
      <span style={{ fontWeight: 800, color: up ? UP : DOWN, whiteSpace: 'nowrap' }}>{up ? '▲' : '▼'} {pct}</span>
    </div>
  )
}

function Spark({ title, vals, weeks }) {
  const w = 200, h = 50, max = Math.max(1, ...vals)
  const pts = vals.map((v, k) => [vals.length === 1 ? w / 2 : (k * w) / (vals.length - 1), h - 4 - ((h - 8) * v) / max])
  const last = vals[vals.length - 1], prev = vals[vals.length - 2] ?? last
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={title}>{title}</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${title} by week`}>
        <polyline fill="none" stroke={BAR} strokeWidth="2" points={pts.map(p => p.join(',')).join(' ')} />
        {pts.map((p, k) => <circle key={k} cx={p[0]} cy={p[1]} r="2.5" fill={BAR}><title>{`Week of ${fmtWeek(weeks[k])}: ${vals[k]}`}</title></circle>)}
      </svg>
      <div style={S.mut}>Latest week {last} {last > prev ? '▲' : last < prev ? '▼' : ''} · week of {fmtWeek(weeks[weeks.length - 1])}</div>
    </div>
  )
}

function List({ title, rows }) {
  const max = Math.max(1, ...(rows || []).map(r => r.n))
  return (
    <div style={S.card}>
      <div style={S.h3}>{title}</div>
      {(rows || []).length === 0 && <div style={S.mut}>None in this period.</div>}
      {(rows || []).map(r => (
        <div key={r.label} style={{ fontSize: 13, padding: '4px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{r.label}</span><b>{r.n}</b></div>
          <div style={{ height: 6, background: '#f1f5f9', borderRadius: 4 }}><div style={{ width: `${(100 * r.n) / max}%`, height: 6, background: MUTE, borderRadius: 4 }} /></div>
        </div>
      ))}
    </div>
  )
}

function Booked({ rows }) {
  return (
    <div style={S.card}>
      <div style={S.h3}>Booking rate by week</div>
      <div style={S.mut}>Booked ÷ calls with a chance to book.</div>
      {(rows || []).map(r => {
        const pct = r.opps ? Math.round((100 * r.booked) / r.opps) : 0
        return (
          <div key={r.week} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
            <span>{fmtWeek(r.week)}</span>
            <span style={{ height: 10, background: '#f1f5f9', borderRadius: 5 }}><span style={{ display: 'block', width: `${pct}%`, height: 10, background: BAR, borderRadius: 5 }} /></span>
            <span style={{ textAlign: 'right' }}><b>{pct}%</b> <span style={S.mut}>{r.booked}/{r.opps}</span></span>
          </div>
        )
      })}
    </div>
  )
}

const S = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 },
  h2: { fontSize: 17, fontWeight: 800, color: G, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: 800, color: G, marginBottom: 4 },
  mut: { fontSize: 12.5, color: '#64748b' },
  cols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 },
  input: { padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid #cbd5e1' },
}
