import React, { useEffect, useMemo, useState } from 'react'
import { staffInterval } from '../lib/erlang'

// ============================================================
// Workforce → Actual vs needed (2026-11-19)
// Over / under staffed headcount by location and hour of day, average open weekday.
//   Actual = CSRs who handled at least one call in the hour (LightSpeed via Switchboard, table ls_staff_hour,
//            loaded daily by the LightSpeed scheduled task). A CSR who was logged in but idle all hour is not seen,
//            so actual is a floor.
//   Needed = Erlang C for that location's average calls offered in the hour (ls_cdr_hour), with the perfect-world
//            standards: 90% in 15 seconds, 3% abandon, 80% occupancy cap, handle time = enterprise talk time + 30s,
//            at least 1 CSR in any hour with calls.
// Data comes from data.actual({ start, end }) → { start, end, latest, rows: [{ brand, location, hour, agents, calls, days }] }.
// ============================================================

const f1 = v => (v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1))
const sgn = v => (v == null || !isFinite(v) ? '—' : (v > 0.05 ? '+' : '') + f1(v))
const hr = h => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`
const iso = d => d.toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const fdate = d => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')
const shortBrand = b => String(b || '').replace(/ (Overhead )?Doors?$/, '')
const locName = r => r.location || 'Main line'

const S = {
  card: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  h3: { margin: 0, fontSize: 16 },
  sub: { margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  kpi: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' },
  kpiN: { fontSize: 26, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' },
  kpiL: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.4 },
  th: { textAlign: 'right', padding: '8px 8px', fontSize: 12, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--surface)', fontWeight: 600 },
  td: { textAlign: 'right', padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--line-soft)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  chip: on => ({ padding: '6px 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-bg)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--ink)', fontSize: 13, cursor: 'pointer', font: 'inherit', fontWeight: on ? 600 : 400 }),
  sel: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', font: 'inherit', fontSize: 13 },
}
// Gap colors: short = red, about right = green, 1+ extra = amber, 2+ extra = darker amber.
const gapStyle = g => (g <= -0.5 ? { background: 'var(--failed-bg, #fde8e8)', color: 'var(--failed)' }
  : g >= 2 ? { background: '#fbe3b8', color: '#8a5a00' }
  : g >= 1 ? { background: '#fdf1d8', color: '#8a5a00' }
  : { background: 'var(--passed-bg, #e6f6ec)', color: 'var(--passed)' })

const RANGES = [[5, '1 week'], [10, '2 weeks'], [20, '4 weeks']]

function Kpi({ n, l, tone }) {
  return <div style={S.kpi}><div style={{ ...S.kpiN, color: tone || 'var(--ink)' }}>{n}</div><div style={S.kpiL}>{l}</div></div>
}

export default function WfmActual({ loadActual, loadTarget }) {
  const [weeks, setWeeks] = useState(5)
  const [d, setD] = useState(null)
  const [aht, setAht] = useState(null)
  const [err, setErr] = useState('')
  const [brand, setBrand] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadTarget?.().then(t => { const a = (t?.aht_by_month || []).filter(Boolean); if (a.length) setAht(Math.round(a[a.length - 1])) }).catch(() => {}) }, [])
  useEffect(() => {
    let off = false
    ;(async () => {
      setBusy(true); setErr('')
      try {
        // Ask for a wide window ending today; the server trims to days that have staffing loaded. Then take the last N weekdays.
        const end = iso(new Date())
        const first = await loadActual({ start: addDays(end, -45), end })
        const latest = first?.latest
        if (!latest) { if (!off) setD({ rows: [] }); return }
        let start = latest, n = 0
        while (n < weeks) { const dow = new Date(start + 'T12:00:00Z').getUTCDay(); if (dow >= 1 && dow <= 5) n++; if (n < weeks) start = addDays(start, -1) }
        const r = await loadActual({ start, end: latest })
        if (!off) setD(r)
      } catch (e) { if (!off) setErr(e.message || 'Could not load staffing.') }
      finally { if (!off) setBusy(false) }
    })()
    return () => { off = true }
  }, [weeks])

  const useAht = aht || 210
  const rows = useMemo(() => (d?.rows || []).map(r => {
    const need = r.calls > 0.05 ? staffInterval({ calls: r.calls, aht: useAht, intervalSec: 3600, slPct: 0.9, slSec: 15, maxOcc: 0.8, shrink: 0, patience: 11, minAgents: 1, abandonMax: 0.03 }).N : 0
    return { ...r, need, gap: r.agents - need }
  }), [d, useAht])

  const brands = useMemo(() => [...new Set(rows.map(r => r.brand))].sort(), [rows])
  const shown = rows.filter(r => !brand || r.brand === brand)
  // Open hours = hours with calls or CSRs on average.
  const open = shown.filter(r => r.need > 0 || r.agents >= 0.5)
  const hours = [...new Set(open.map(r => r.hour))].sort((a, b) => a - b)
  const locs = useMemo(() => {
    const m = new Map()
    open.forEach(r => {
      const k = r.brand + '|' + r.location
      if (!m.has(k)) m.set(k, { brand: r.brand, location: r.location, cells: {}, a: 0, n: 0, hrs: 0, under: 0, over: 0, short: 0, extra: 0 })
      const L = m.get(k)
      L.cells[r.hour] = r; L.a += r.agents; L.n += r.need; L.hrs++
      if (r.gap <= -0.5) { L.under++; L.short += -r.gap }
      if (r.gap >= 1) { L.over++; L.extra += r.gap }
    })
    return [...m.values()].sort((x, y) => x.brand.localeCompare(y.brand) || locName(x).localeCompare(locName(y)))
  }, [open])

  const tot = locs.reduce((t, L) => ({ a: t.a + L.a, n: t.n + L.n, hrs: t.hrs + L.hrs, under: t.under + L.under, over: t.over + L.over, short: t.short + L.short, extra: t.extra + L.extra }), { a: 0, n: 0, hrs: 0, under: 0, over: 0, short: 0, extra: 0 })

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--failed)' }}>{err}</div>
  if (!d) return <div className="card" style={{ padding: 16, color: 'var(--ink-soft)' }}>Loading staffing…</div>
  if (!rows.length) return <div className="card" style={{ padding: 16, color: 'var(--ink-soft)' }}>No LightSpeed staffing has been loaded yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ ...S.card, gap: 6 }}>
        <h3 style={{ ...S.h3, fontSize: 18 }}>Actual vs needed CSRs{brand ? ` · ${shortBrand(brand)}` : ''}</h3>
        <p style={S.sub}>How many CSRs were on the phones in each hour compared with how many the calls needed. Average open weekday, {fdate(d.start)} – {fdate(d.end)} ({rows[0]?.days || 0} weekdays). Red = short, green = about right, amber = more CSRs than the calls needed.</p>
        <p style={{ ...S.sub, fontSize: 12 }}>Actual = CSRs who handled at least one call in the hour (LightSpeed, loaded daily; a CSR logged in but idle all hour isn't counted). Needed = Erlang C for that location's calls with the perfect-world standards: 90% answered in 15 seconds, 3% abandon, {useAht}s handle time, at least 1 CSR in any hour with calls.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {RANGES.map(([n, l]) => <button key={n} style={S.chip(weeks === n)} onClick={() => setWeeks(n)} disabled={busy}>{l}</button>)}
        {brands.length > 1 && <select style={S.sel} value={brand} onChange={e => setBrand(e.target.value)} aria-label="Brand"><option value="">All brands</option>{brands.map(b => <option key={b} value={b}>{shortBrand(b)}</option>)}</select>}
        {busy && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Loading…</span>}
      </div>

      <div style={S.kpis}>
        <Kpi n={f1(tot.a / Math.max(1, hours.length))} l="CSRs on the phones, average open hour (all locations)" />
        <Kpi n={f1(tot.n / Math.max(1, hours.length))} l="CSRs needed, average open hour" />
        <Kpi n={sgn((tot.a - tot.n) / Math.max(1, hours.length))} l="Over (+) / under (−) per hour" tone={tot.a - tot.n < 0 ? 'var(--failed)' : '#8a5a00'} />
        <Kpi n={tot.under} l={`Location-hours short · ${f1(tot.short)} CSR-hours missing a day`} tone="var(--failed)" />
        <Kpi n={tot.over} l={`Location-hours with 1+ extra · ${f1(tot.extra)} extra CSR-hours a day`} tone="#8a5a00" />
      </div>

      <div className="card" style={S.card}>
        <h3 style={S.h3}>By location and hour</h3>
        <p style={S.sub}>Each cell: CSRs on the phones / CSRs needed. Hours are local to the location. Hover a cell for calls.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...S.th, textAlign: 'left' }}>Location</th>
              {hours.map(h => <th key={h} style={{ ...S.th, textAlign: 'center' }}>{hr(h)}</th>)}
              <th style={S.th}>Actual / day</th><th style={S.th}>Needed / day</th><th style={S.th}>Gap</th><th style={S.th}>Hrs short</th><th style={S.th}>Hrs over</th>
            </tr></thead>
            <tbody>
              {locs.map(L => (
                <tr key={L.brand + L.location}>
                  <td style={{ ...S.td, textAlign: 'left' }}><div style={{ fontWeight: 600 }}>{locName(L)}</div><div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{shortBrand(L.brand)}</div></td>
                  {hours.map(h => {
                    const c = L.cells[h]
                    if (!c) return <td key={h} style={{ ...S.td, textAlign: 'center', color: 'var(--ink-faint, #bbb)' }}>·</td>
                    return <td key={h} title={`${hr(h)}: ${f1(c.calls)} calls, ${f1(c.agents)} CSRs on the phones, ${c.need} needed`} style={{ ...S.td, textAlign: 'center', ...gapStyle(c.gap), fontSize: 12 }}>{f1(c.agents)}/{c.need}</td>
                  })}
                  <td style={S.td}>{f1(L.a)}</td>
                  <td style={S.td}>{f1(L.n)}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: L.a - L.n < 0 ? 'var(--failed)' : L.a - L.n >= 1 ? '#8a5a00' : 'var(--passed)' }}>{sgn(L.a - L.n)}</td>
                  <td style={{ ...S.td, color: L.under ? 'var(--failed)' : undefined }}>{L.under}</td>
                  <td style={{ ...S.td, color: L.over ? '#8a5a00' : undefined }}>{L.over}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ ...S.sub, fontSize: 12 }}>"Actual / day" and "Needed / day" add up the hours, so they are CSR-hours on an average weekday. Each location is staffed on its own here; sharing CSRs across locations would need fewer. A CSR who answers for two locations in the same hour counts at both. "Main line" = calls to a brand's main number not tied to one location.</p>
      </div>
    </div>
  )
}
