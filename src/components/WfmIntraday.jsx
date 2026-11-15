// ============================================================
//  WfmIntraday — "Intraday" (2026-11-15). Today, every 30 minutes: forecast calls (same weekday, last
//  6 weeks) vs actual, CSRs needed (Erlang C, 80% in 30s) vs CSRs who actually took calls / were logged in
//  to the portal phone, plus a re-forecast for the rest of the day from how far ahead or behind we are.
//  Below it: each portal-phone CSR's day — time Ready, On call, Wrap, Not ready, and occupancy.
//  Data: wfm_intraday(p_day, p_brand, p_client), wfm_agent_day(p_day, p_client).
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { staffInterval } from '../lib/erlang'

const G = '#14302A', FC = '#94a3b8', ACT = '#2F7D5B', NEED = '#A8441A'
const slotLabel = s => { const h = Math.floor(s / 2), m = s % 2 ? '30' : '00'; return `${((h + 11) % 12) + 1}:${m}${h < 12 ? 'a' : 'p'}` }
const hms = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m` }
const todayCentral = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

export default function WfmIntraday({ clientId = null }) {
  const [day, setDay] = useState(todayCentral())
  const [d, setD] = useState(null)
  const [agents, setAgents] = useState([])
  const [err, setErr] = useState('')
  const [sl, setSl] = useState({ pct: 80, sec: 30 })
  const load = useCallback(async () => {
    const c = clientId ? { p_client: clientId } : {}
    const [r1, r2] = await Promise.all([supabase.rpc('wfm_intraday', { p_day: day, ...c }), supabase.rpc('wfm_agent_day', { p_day: day, ...c })])
    if (r1.error) { setErr(r1.error.message); return }
    setErr(''); setD(r1.data); setAgents(r2.data || [])
  }, [day, clientId])
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])

  const rows = useMemo(() => {
    if (!d) return []
    const isToday = day === todayCentral()
    const nowSlot = isToday ? (() => { const t = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })); return t.getHours() * 2 + (t.getMinutes() >= 30 ? 1 : 0) })() : 48
    const past = d.slots.filter(s => s.slot < nowSlot)
    const fcPast = past.reduce((a, s) => a + Number(s.forecast), 0), actPast = past.reduce((a, s) => a + s.actual, 0)
    const ratio = fcPast >= 10 ? Math.min(2, Math.max(0.5, actPast / fcPast)) : 1   // re-forecast once there's enough of today
    return d.slots.map(s => {
      const reFc = s.slot >= nowSlot ? Number(s.forecast) * ratio : null
      const basis = s.slot < nowSlot ? Math.max(s.actual, 0) : reFc
      const need = staffInterval({ calls: basis, aht: s.aht, slPct: sl.pct / 100, slSec: sl.sec, shrink: 0 }).N
      return { ...s, reFc, need, past: s.slot < nowSlot, now: s.slot === nowSlot }
    }).filter(r => r.forecast > 0 || r.actual > 0 || r.logged_in > 0)
  }, [d, day, sl])

  if (err && !d) return <div style={S.card}><b>Couldn’t load intraday.</b><p style={S.mut}>{err}</p></div>
  if (!d) return <div style={S.card}>Loading…</div>
  const tot = rows.reduce((a, r) => ({ fc: a.fc + Number(r.forecast), act: a.act + r.actual }), { fc: 0, act: 0 })
  const max = Math.max(1, ...rows.map(r => Math.max(Number(r.forecast), r.actual, r.reFc || 0)))
  const short = rows.filter(r => !r.past && r.need > Math.max(r.logged_in, r.agents_on_calls))

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div>
          <div style={S.h2}>Intraday</div>
          <div style={S.mut}>Forecast = average of the same weekday over the last 6 weeks. Central time. Refreshes every minute.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} style={S.input} />
          <label>Target <input type="number" value={sl.pct} onChange={e => setSl(x => ({ ...x, pct: Number(e.target.value) || 80 }))} style={{ ...S.input, width: 56 }} />% in</label>
          <input type="number" value={sl.sec} onChange={e => setSl(x => ({ ...x, sec: Number(e.target.value) || 30 }))} style={{ ...S.input, width: 56 }} /> sec
        </div>
      </div>

      <div style={S.tiles}>
        <Tile k="Calls so far" v={tot.act} />
        <Tile k="Forecast for the day" v={Math.round(tot.fc)} />
        <Tile k="Running vs forecast" v={tot.fc ? `${Math.round((100 * tot.act) / Math.max(1, rows.filter(r => r.past).reduce((a, r) => a + Number(r.forecast), 0)))}%` : '—'} />
        <Tile k="Short-staffed intervals ahead" v={short.length} warn={short.length > 0} />
      </div>

      <div style={S.card}>
        <div style={S.h3}>Calls per 30 minutes</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, margin: '4px 0 8px' }}>
          <Key c={FC} t="Forecast" /><Key c={ACT} t="Actual" /><Key c={FC} t="Re-forecast" dash />
        </div>
        <svg viewBox={`0 0 ${rows.length * 28 + 30} 170`} width="100%" height="170" role="img" aria-label="Forecast vs actual calls by 30 minutes">
          {rows.map((r, k) => {
            const x = 30 + k * 28, y = v => 150 - (140 * v) / max
            return (
              <g key={r.slot}>
                <rect x={x} y={y(Number(r.forecast))} width="11" height={150 - y(Number(r.forecast))} fill={FC} opacity={r.past ? 0.5 : 0.25}><title>{`${slotLabel(r.slot)} forecast ${r.forecast}`}</title></rect>
                {r.past ? <rect x={x + 12} y={y(r.actual)} width="11" height={150 - y(r.actual)} fill={ACT}><title>{`${slotLabel(r.slot)} actual ${r.actual}`}</title></rect>
                  : <rect x={x + 12} y={y(r.reFc)} width="11" height={150 - y(r.reFc)} fill="none" stroke={FC} strokeDasharray="3 2"><title>{`${slotLabel(r.slot)} re-forecast ${r.reFc?.toFixed(1)}`}</title></rect>}
                {k % 2 === 0 && <text x={x + 11} y="165" fontSize="9" textAnchor="middle" fill="#64748b">{slotLabel(r.slot)}</text>}
                {r.now && <line x1={x - 2} x2={x - 2} y1="5" y2="150" stroke={NEED} strokeDasharray="2 2" />}
              </g>
            )
          })}
          <line x1="28" x2={rows.length * 28 + 30} y1="150" y2="150" stroke="#cbd5e1" />
        </svg>
      </div>

      <div style={S.card}>
        <div style={S.h3}>Staffing by interval</div>
        <div style={S.mut}>Needed = CSRs on the phones to hit {sl.pct}% answered in {sl.sec}s. “Took calls” counts CSRs who handled a call in that half hour on any phone system; “Logged in” counts portal-phone CSRs signed in.</div>
        <div style={{ overflow: 'auto', marginTop: 8 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
            <thead><tr>{['Time', 'Forecast', 'Actual / re-fc', 'Avg handle', 'Needed', 'Took calls', 'Logged in', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => {
              const have = Math.max(r.logged_in, r.agents_on_calls), gap = r.need - have
              return (
                <tr key={r.slot} style={{ background: r.now ? '#fefce8' : undefined }}>
                  <td style={S.td}><b>{slotLabel(r.slot)}</b></td><td style={S.td}>{r.forecast}</td>
                  <td style={S.td}>{r.past ? r.actual : r.reFc?.toFixed(1)}</td><td style={S.td}>{Math.round(r.aht / 6) / 10} min</td>
                  <td style={S.td}><b>{r.need}</b></td><td style={S.td}>{r.agents_on_calls}</td><td style={S.td}>{r.logged_in}</td>
                  <td style={{ ...S.td, color: gap > 0 ? NEED : '#166534', fontWeight: 700 }}>{r.past ? '' : gap > 0 ? `short ${gap}` : 'covered'}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.h3}>CSR day (portal phone)</div>
        {agents.length === 0 && <div style={S.mut}>No portal-phone CSRs logged in on this day.</div>}
        {agents.length > 0 && (
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%', marginTop: 6 }}>
            <thead><tr>{['CSR', 'Now', 'Ready', 'On call', 'Wrap', 'Not ready', 'Occupancy'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{agents.map(a => {
              const st = a.states || {}, work = (st.on_call || 0) + (st.wrap || 0), avail = work + (st.ready || 0)
              return (
                <tr key={a.profile_id}>
                  <td style={S.td}><b>{a.name}</b><div style={S.mut}>{[a.brand, a.location].filter(Boolean).join(' · ')}</div></td>
                  <td style={S.td}>{String(a.now || 'offline').replace('_', ' ')}</td>
                  <td style={S.td}>{hms(st.ready)}</td><td style={S.td}>{hms(st.on_call)}</td><td style={S.td}>{hms(st.wrap)}</td><td style={S.td}>{hms(st.not_ready)}</td>
                  <td style={S.td}><b>{avail ? Math.round((100 * work) / avail) : 0}%</b></td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const Tile = ({ k, v, warn }) => <div style={{ ...S.card, borderColor: warn ? '#fca5a5' : '#e2e8f0' }}><div style={S.mut}>{k}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? NEED : G }}>{v}</div></div>
const Key = ({ c, t, dash }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 10, background: dash ? 'transparent' : c, border: dash ? `1px dashed ${c}` : 'none', opacity: dash ? 1 : 0.7 }} />{t}</span>

const S = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 },
  h2: { fontSize: 17, fontWeight: 800, color: G, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: 800, color: G, marginBottom: 4 },
  mut: { fontSize: 12.5, color: '#64748b' },
  input: { padding: '6px 8px', fontSize: 13, borderRadius: 8, border: '1px solid #cbd5e1' },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  th: { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: '#64748b', padding: '6px', borderBottom: '1px solid #e2e8f0' },
  td: { padding: '6px', borderBottom: '1px solid #f1f5f9' },
}
