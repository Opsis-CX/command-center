// ============================================================================
//  SALES DASHBOARD — all-time. Grows with every call, email and stage move.
//  Same counting as the Sprint Scorecard (public.sales_activity_daily), just
//  over the whole history, plus what only the pipeline itself can tell you:
//  how the prospect base splits by tier and how far each tier gets.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { S, Tile, TierChip, TIERS, loadActivity, sumRows, todayET, addDays, dayOfWeek, fmtDate, fmtMoney, pct } from '../lib/salesShared.jsx'

const START = '2026-01-01'
const PAST_NEW_LEAD = ['email_1_sent', 'call_1_made', 'email_2_sent', 'call_2_made', 'drip_campaign', 'contact_made',
  'discovery_call', 'proposal_sent', 'negotiations', 'contract_sent', 'contract_signed', 'won']
const MEETING_PLUS = ['discovery_call', 'proposal_sent', 'negotiations', 'contract_sent', 'contract_signed', 'won']

function weekStart(iso) { // Monday-anchored week
  const dow = dayOfWeek(iso)
  return addDays(iso, dow === 0 ? -6 : 1 - dow)
}

export default function SalesAllTime() {
  const [rows, setRows] = useState(null)
  const [deals, setDeals] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    Promise.all([
      loadActivity(START, todayET()),
      supabase.from('deals').select('id, status, tier, industry, researched_at').eq('pipeline', 'sales'),
    ]).then(([a, d]) => {
      if (off) return
      if (d.error) throw d.error
      setRows(a); setDeals(d.data || [])
    }).catch(e => { if (!off) { setErr(e.message || String(e)); setRows([]); setDeals([]) } })
    return () => { off = true }
  }, [])

  const all = rows ? sumRows(rows) : null

  const weeks = useMemo(() => {
    if (!rows) return []
    const m = new Map()
    for (const r of rows) {
      const w = weekStart(r.day)
      if (!m.has(w)) m.set(w, { w, dials: 0, connections: 0, booked: 0 })
      const o = m.get(w); o.dials += r.dials; o.connections += r.connections; o.booked += r.booked
    }
    return [...m.values()].sort((a, b) => a.w.localeCompare(b.w)).slice(-12)
  }, [rows])

  const people = useMemo(() => {
    if (!rows) return []
    const m = new Map()
    for (const r of rows) {
      const k = r.person_id || r.person_name || 'Unassigned'
      if (!m.has(k)) m.set(k, { name: r.person_name || 'Unassigned', rows: [] })
      m.get(k).rows.push(r)
    }
    return [...m.values()].map(p => ({ name: p.name, t: sumRows(p.rows) }))
      .filter(p => p.t.dials || p.t.emails || p.t.booked || p.t.won || p.t.connections)
      .sort((a, b) => b.t.dials - a.t.dials || b.t.emails - a.t.emails)
  }, [rows])

  const tiers = useMemo(() => {
    if (!deals) return []
    return [...TIERS, null].map(t => {
      const ds = deals.filter(d => (d.tier || null) === t)
      return {
        tier: t, total: ds.length,
        worked: ds.filter(d => PAST_NEW_LEAD.includes(d.status)).length,
        meetings: ds.filter(d => MEETING_PLUS.includes(d.status)).length,
        won: ds.filter(d => ['contract_signed', 'won'].includes(d.status)).length,
      }
    }).filter(r => r.total)
  }, [deals])

  if (!rows) return <p className="page-sub" style={{ padding: 20 }}>Loading dashboard…</p>

  const maxW = Math.max(1, ...weeks.map(w => w.dials))
  const maxB = Math.max(1, ...weeks.map(w => w.booked))
  const W = 560, H = 190, padL = 34, padB = 26, bw = weeks.length ? Math.min(34, (W - padL - 10) / weeks.length - 8) : 0
  const x = i => padL + 8 + i * ((W - padL - 10) / Math.max(1, weeks.length))
  const y = v => H - padB - (v / maxW) * (H - padB - 14)
  const researched = deals.filter(d => d.researched_at).length

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={S.h1}>Sales Dashboard</h1>
        <p className="page-sub" style={S.sub}>All-time performance · updates as calls, emails and stage moves happen</p>
      </div>
      {err && <div style={S.err}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="Prospects" value={deals.length} hint={`${researched.toLocaleString()} researched`} />
        <Tile label="Dials" value={all.dials} hint={`${all.connections.toLocaleString()} connections · ${pct(all.connections, all.dials)}`} />
        <Tile label="Emails sent" value={all.emails} />
        <Tile label="Callbacks" value={all.callbacks} />
        <Tile label="Meetings booked" value={all.booked} hint={`${all.held} held · ${all.no_show} no-show`} />
        <Tile label="Proposals sent" value={all.proposals} />
        <Tile label="Contracts won" value={all.won} hint={`Close rate ${pct(all.won, all.held)}`} />
        <Tile label="New monthly revenue" value={fmtMoney(all.won_value)} hint={`${all.won_hours.toLocaleString()} recurring hours`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Weekly activity</h2>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'inline-flex', gap: 12 }}>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, marginRight: 4 }} />Dials</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#1f8a53', borderRadius: 2, marginRight: 4 }} />Connections</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 3, background: '#e08a00', marginRight: 4, verticalAlign: 'middle' }} />Meetings</span>
            </span>
          </div>
          {weeks.length === 0 ? <p className="page-sub">No activity yet.</p> : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Weekly dials, connections and meetings">
              {[0, 0.5, 1].map(f => (
                <g key={f}>
                  <line x1={padL} x2={W - 4} y1={y(maxW * f)} y2={y(maxW * f)} stroke="var(--line)" strokeWidth="1" />
                  <text x={padL - 6} y={y(maxW * f) + 4} fontSize="10" textAnchor="end" fill="var(--ink-soft)">{Math.round(maxW * f)}</text>
                </g>
              ))}
              {weeks.map((w, i) => (
                <g key={w.w}>
                  <rect x={x(i)} y={y(w.dials)} width={bw} height={H - padB - y(w.dials)} rx="3" fill="var(--accent)" opacity=".85" />
                  <rect x={x(i) + bw * 0.25} y={y(w.connections)} width={bw * 0.5} height={H - padB - y(w.connections)} rx="2" fill="#1f8a53" />
                  {(i % Math.ceil(weeks.length / 6) === 0 || i === weeks.length - 1) &&
                    <text x={x(i) + bw / 2} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--ink-soft)">{fmtDate(w.w)}</text>}
                </g>
              ))}
              <polyline fill="none" stroke="#e08a00" strokeWidth="2"
                points={weeks.map((w, i) => `${x(i) + bw / 2},${H - padB - (w.booked / maxB) * (H - padB - 14)}`).join(' ')} />
            </svg>
          )}
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '6px 0 0' }}>Last 12 weeks, Monday-anchored. The meetings line is drawn on its own scale so it stays visible next to dial volume.</p>
        </div>

        <div style={S.card}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>Funnel, all time</h2>
          {[
            ['Prospects researched', researched],
            ['Dials', all.dials],
            ['Connections', all.connections],
            ['Meetings booked', all.booked],
            ['Meetings held', all.held],
            ['Proposals sent', all.proposals],
            ['Contracts won', all.won],
          ].map(([label, v], i, arr) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-soft)' }}>
                  <b style={{ color: 'var(--ink)' }}>{v.toLocaleString()}</b>{i > 0 ? ` · ${pct(v, arr[i - 1][1])}` : ''}
                </span>
              </div>
              <div style={{ height: 7, background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 99, overflow: 'hidden', marginTop: 3 }}>
                <div style={{ width: Math.max(v ? 1.5 : 0, (v / Math.max(1, arr[0][1])) * 100) + '%', height: '100%', background: 'var(--accent)' }} />
              </div>
            </div>
          ))}
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: 0 }}>Each percentage is against the step above it.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div style={{ ...S.card, padding: '12px 6px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 10px 8px' }}>By person, all time</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                {['Person', 'Dials', 'Connections', 'Callbacks', 'Emails', 'Booked', 'Held', 'Won'].map((h, i) =>
                  <th key={h} style={{ ...S.th, ...(i ? S.num : {}) }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {people.map(p => (
                  <tr key={p.name}>
                    <td style={S.td}>{p.name}</td>
                    {['dials', 'connections', 'callbacks', 'emails', 'booked', 'held', 'won'].map(k =>
                      <td key={k} style={{ ...S.td, ...S.num }}>{p.t[k].toLocaleString()}</td>)}
                  </tr>
                ))}
                {people.length === 0 && <tr><td style={S.td} colSpan={8}>No activity yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ ...S.card, padding: '12px 6px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 10px 2px' }}>By tier</h2>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 10px 8px' }}>Is the A–D ranking predicting who books?</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                {['Tier', 'Prospects', 'Worked', 'Meeting+', 'Won'].map((h, i) => <th key={h} style={{ ...S.th, ...(i ? S.num : {}) }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {tiers.map(t => (
                  <tr key={t.tier || 'none'}>
                    <td style={S.td}>{t.tier ? <TierChip tier={t.tier} /> : <span style={{ color: 'var(--ink-soft)' }}>No tier</span>}</td>
                    <td style={{ ...S.td, ...S.num }}>{t.total}</td>
                    <td style={{ ...S.td, ...S.num }}>{t.worked} <span style={{ color: 'var(--ink-soft)' }}>({pct(t.worked, t.total)})</span></td>
                    <td style={{ ...S.td, ...S.num }}>{t.meetings}</td>
                    <td style={{ ...S.td, ...S.num }}>{t.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '8px 10px 0' }}>"Worked" = moved past New Lead. "Meeting+" = reached Discovery Call or later.</p>
        </div>
      </div>
    </div>
  )
}
