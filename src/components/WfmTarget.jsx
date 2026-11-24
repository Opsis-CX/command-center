import React, { useEffect, useMemo, useState } from 'react'

// ============================================================
// Workforce → Staffing target (2026-11-17)
// The "Perfect-World WFM - All Brands" dashboard from Switchboard, brought into Workforce (Command Center and the
// GarageCo portal). Data = the latest row of wfm_target_snapshot for the client (a copy of the Switchboard models
// wfm_target_enterprise_staffing_output v5, wfm_target_enterprise_region_staffing_output v8 and
// wfm_staffing_ladder_output). Portal logins read it through opsis-portal-ops (pwfm op "target"); brand-locked
// logins only get their own brand. Nothing here is computed live: it is a target-state model, not today's staffing.
// ============================================================

const MONTH = m => new Date(m + '-15T12:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
const f1 = v => (v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1))
const f2 = v => (v == null || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toFixed(2))
const n0 = v => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString())
const pc = v => (v == null || !isFinite(v) ? '—' : (Math.round(v * 1000) / 10).toFixed(1) + '%')
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const clock = min => { const h = Math.floor(min / 60), m = min % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}` }
const fdate = d => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '')

const S = {
  card: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  h3: { margin: 0, fontSize: 16, display: 'flex', alignItems: 'center' },
  sub: { margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 },
  kpi: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' },
  kpiN: { fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' },
  kpiL: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, display: 'flex', alignItems: 'center', lineHeight: 1.4 },
  th: { textAlign: 'right', padding: '8px 10px', fontSize: 12, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--surface)', fontWeight: 600 },
  td: { textAlign: 'right', padding: '7px 10px', fontSize: 13, borderBottom: '1px solid var(--line-soft)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  chip: on => ({ padding: '6px 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-bg)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--ink)', fontSize: 13, cursor: 'pointer', font: 'inherit', fontWeight: on ? 600 : 400 }),
  sel: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', font: 'inherit', fontSize: 13 },
  li: { margin: '0 0 6px', fontSize: 13, lineHeight: 1.55 },
}

// ⓘ with a definition. The bubble opens below the whole tile / header it belongs to ([data-tipbox]), or above it near
// the bottom of the screen, so it never sits on the label or the words it explains.
function Tip({ text }) {
  const [pos, setPos] = useState(null)
  const show = e => {
    const r = (e.currentTarget.closest('[data-tipbox]') || e.currentTarget).getBoundingClientRect()
    const left = Math.min(window.innerWidth - 330, Math.max(8, r.left + r.width / 2 - 160))
    const below = r.bottom + 10, up = window.innerHeight - r.top + 10
    setPos(r.bottom + 180 > window.innerHeight ? { left, bottom: up } : { left, top: below })
  }
  return (
    <span tabIndex={0} aria-label={text} onMouseEnter={show} onFocus={show} onMouseLeave={() => setPos(null)} onBlur={() => setPos(null)}
      style={{ marginLeft: 6, cursor: 'help', width: 17, height: 17, borderRadius: 99, border: '1px solid var(--line)', color: 'var(--ink-soft)', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, verticalAlign: 'middle', fontStyle: 'normal' }}>
      i
      {pos && <span role="tooltip" style={{ position: 'fixed', ...pos, zIndex: 90, width: 320, pointerEvents: 'none', background: '#14302A', color: '#fff', fontSize: 12, fontWeight: 400, lineHeight: 1.5, padding: '9px 12px', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,.18)', textAlign: 'left', whiteSpace: 'normal', letterSpacing: 0, textTransform: 'none' }}>{text}</span>}
    </span>
  )
}
const Th = ({ children, tip, left }) => <th style={{ ...S.th, textAlign: left ? 'left' : 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>{children}{tip && <Tip text={tip} />}</span></th>
function Kpi({ n, l, tip, tone, sub }) {
  return <div data-tipbox style={S.kpi}><div style={{ ...S.kpiN, color: tone || S.kpiN.color }}>{n}</div><div style={S.kpiL}><span>{l}</span>{tip && <Tip text={tip} />}</div>{sub && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>{sub}</div>}</div>
}
function Card({ title, tip, sub, right, children }) {
  return (
    <div className="card" style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div data-tipbox style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><h3 style={S.h3}>{title}{tip && <Tip text={tip} />}</h3>{sub && <p style={S.sub}>{sub}</p>}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

const TIPS = {
  fte: 'FTE = (average agent hours per open Mon-Fri day × 5 + average agent hours per open Saturday) ÷ 30 phone hours. 30 phone hours = a 40-hour week less 25% shrinkage.',
  pooled: 'East and West each staffed as one team that answers every brand in the region. Best case: it assumes any agent can answer any brand. Includes the 30% inbound occupancy ceiling on weekdays.',
  separate: 'Each of the 10 brands staffed as its own team, then added together. Apple, Cheney, Dans, PDQ and Quality pool their own locations. No occupancy ceiling.',
  service: 'Regional pools staffed to the service standard only (90% in 15 seconds and 3% abandon), with no 30% occupancy ceiling.',
  ceiling: 'On weekdays the pooled teams keep inbound work at 30% of agent time or less in every half-hour, so idle time is held for outbound work and growth peaks. Saturdays get one agent per open half-hour per region.',
  saving: 'Separate brand teams minus the regional pools. It understates the pooling effect, because the pools also carry the 30% ceiling and the brand teams do not.',
  abandon: 'Measured abandon rate during open hours, every abandoned call counted (including instant hang-ups). The target is 3% or less.',
  modeled: 'Staffing to the 3% abandon limit gives about 1.5% modeled abandonment, because agents come in whole numbers.',
  cpw: 'Inbound CSR-queue calls offered during open hours, per week, May 1 to Oct 31, 2026.',
  aht: 'Handle time used for every team: the enterprise average talk time per answered call for the month (all 10 brands) plus 30 seconds of after-call work.',
  avg6: 'Six-month average = the mean of the six monthly FTE values.',
  obh: 'Outbound capacity = hours left idle after inbound work, up to 80% occupancy, per week. It is capacity, not a forecast of outbound volume.',
  agents: 'Average agents required in each 30-minute block on open weekdays, May to Oct. Each block takes the larger of the Erlang C count for 90% in 15 seconds and the Erlang A count for 3% abandon. Every open half-hour has at least one agent.',
  calls: 'Average inbound calls offered in that 30-minute block on open weekdays.',
  people: 'Distinct people who answered at least one CSR-queue call in the window. People are not FTE.',
  primary: 'The smallest group of people, ranked by answered calls, who answered 80% of the calls.',
  dedicated: 'People whose main job is answering these phones.',
  multihat: 'Staff who answer phones but also have other duties.',
  shared: 'A shared phone or front-desk line, not one person.',
  occasional: 'People who answered some calls but are not on the CSR roster.',
  offered: 'Inbound CSR-queue calls offered in the window, including calls outside open hours.',
  abn: 'Abandoned calls ÷ calls offered, measured. No model applied.',
  asa: 'Average seconds from ring to answer, measured.',
  sl15: 'Share of answered calls picked up within 15 seconds, measured.',
  fteLoc: 'Perfect-world FTE if each location is its own team. On brand and region rows it adds up the location rows.',
  fteBrand: 'Perfect-world FTE if all locations of a brand share one team. On region rows it adds up the brand rows.',
  fteRegion: 'Perfect-world FTE if the whole region is one team, with the 30% inbound occupancy ceiling.',
}

const TEAM_VIEWS = [['brands', 'All brands'], ['East', 'East pool'], ['West', 'West pool'], ['enterprise', 'Enterprise']]

// Calls (bars) and agents required (line) through the day for one team.
function TodChart({ rows, label }) {
  const [hover, setHover] = useState(null)
  if (!rows?.length) return <p style={S.sub}>No interval data for this team.</p>
  const W = 980, H = 260, P = { l: 46, r: 46, t: 24, b: 34 }
  const maxC = Math.max(1, ...rows.map(r => r[2])), maxA = Math.max(1, ...rows.map(r => r[1]))
  const bw = (W - P.l - P.r) / rows.length
  const x = i => P.l + i * bw + bw / 2
  const yC = v => H - P.b - (v / maxC) * (H - P.t - P.b)
  const yA = v => H - P.b - (v / maxA) * (H - P.t - P.b)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={`Agents required by time of day, ${label}`} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => <line key={t} x1={P.l} x2={W - P.r} y1={P.t + t * (H - P.t - P.b)} y2={P.t + t * (H - P.t - P.b)} stroke="var(--line-soft)" />)}
        {rows.map((r, i) => <rect key={r[0]} x={P.l + i * bw + 3} y={yC(r[2])} width={Math.max(1, bw - 6)} height={H - P.b - yC(r[2])} rx="3" fill="var(--accent-bg)" stroke="var(--accent)" strokeOpacity=".35" />)}
        <path d={rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${yA(r[1])}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="3" />
        {rows.map((r, i) => <circle key={'c' + r[0]} cx={x(i)} cy={yA(r[1])} r={hover === i ? 5 : 3.5} fill="var(--accent)" />)}
        {rows.map((r, i) => <rect key={'h' + r[0]} x={P.l + i * bw} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {rows.map((r, i) => (i % 2 === 0 ? <text key={'t' + r[0]} x={x(i)} y={H - 12} fontSize="11" textAnchor="middle" fill="var(--ink-soft)">{clock(r[0])}</text> : null))}
        <text x={4} y={14} fontSize="11" fill="var(--ink-soft)">calls</text>
        <text x={W - 4} y={14} fontSize="11" textAnchor="end" fill="var(--accent)">agents</text>
        <text x={P.l - 8} y={yC(maxC) + 4} fontSize="11" textAnchor="end" fill="var(--ink-soft)">{Math.round(maxC)}</text>
        <text x={W - P.r + 8} y={yA(maxA) + 4} fontSize="11" fill="var(--accent)">{f1(maxA)}</text>
      </svg>
      {hover != null && (
        <div style={{ position: 'absolute', top: 0, left: `${Math.min(80, Math.max(0, ((x(hover) / W) * 100) - 8))}%`, background: '#14302A', color: '#fff', fontSize: 12, padding: '7px 10px', borderRadius: 8, pointerEvents: 'none', transform: 'translateY(-110%)' }}>
          {clock(rows[hover][0])}–{clock(rows[hover][0] + 30)} · {f1(rows[hover][2])} calls · {f1(rows[hover][1])} agents
        </div>
      )}
    </div>
  )
}

export default function WfmTarget({ load }) {
  const [t, setT] = useState(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState('brands')
  const [brand, setBrand] = useState('')
  const [svc, setSvc] = useState(false)
  const [ladderLvl, setLadderLvl] = useState('brand')

  useEffect(() => { (async () => { try { const d = await load(); if (!d) setErr('No staffing target has been loaded yet.'); else setT(d) } catch (e) { setErr(e.message || 'Could not load the staffing target.') } })() }, [])

  const ladder = useMemo(() => {
    if (!t) return []
    const cols = t.ladder_cols || []
    return (t.ladder || []).map(r => (Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r))
  }, [t])

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--ink-soft)' }}>{err}</div>
  if (!t) return <div className="card" style={{ padding: 16, color: 'var(--ink-soft)' }}>Loading the staffing target…</div>

  const locked = !!t.locked || !(t.regions || []).length
  const months = t.months || []
  const brands = t.brands || []
  const regions = t.regions || []
  const brandSum = brands.reduce((a, b) => a + (b.fte || 0), 0)
  const regionSum = regions.reduce((a, r) => a + (svc ? r.fte_service : r.fte_ceiling), 0)
  const cpw = brands.reduce((a, b) => a + (b.calls_per_week || 0), 0)
  const obh = brands.reduce((a, b) => a + (b.outbound_hrs_per_week || 0), 0)

  // Team comparison rows for the selected Team View.
  const viewRows = (() => {
    if (locked || view === 'brands') return (brand ? brands.filter(b => b.brand === brand) : brands).map(b => ({ name: b.brand, region: b.region, months: b.months, fte: b.fte, cpw: b.calls_per_week, obh: b.outbound_hrs_per_week, hours: b.hours }))
    const rs = view === 'enterprise' ? regions : regions.filter(r => r.region === view)
    return rs.map(r => ({ name: r.region + ' pool', region: r.region, months: svc ? r.service : r.ceiling, fte: svc ? r.fte_service : r.fte_ceiling, cpw: r.calls.reduce((a, c) => a + c, 0) * 7 / 184, hours: 'Brands: ' + r.brands.join(', ') + ' · ' + r.clock + ' clock' }))
  })()
  const todRows = (() => {
    if (locked || view === 'brands') {
      const k = brand || (locked ? brands[0]?.brand : '')
      if (k) return { label: k, rows: t.tod?.brand?.[k] }
      // All brands: add the brand curves together by clock minute (each on its own local clock).
      const acc = {}
      Object.values(t.tod?.brand || {}).forEach(rows => rows.forEach(([m, a, c]) => { acc[m] = acc[m] || [m, 0, 0]; acc[m][1] += a; acc[m][2] += c }))
      return { label: 'All brands, separate teams added together (each brand on its local clock)', rows: Object.values(acc).sort((a, b) => a[0] - b[0]) }
    }
    const src = svc ? t.tod?.region_svc : t.tod?.region
    if (view === 'enterprise') {
      const acc = {}
      Object.values(src || {}).forEach(rows => rows.forEach(([m, a, c]) => { acc[m] = acc[m] || [m, 0, 0]; acc[m][1] += a; acc[m][2] += c }))
      return { label: 'Enterprise (East on Eastern clock, West on Central clock)', rows: Object.values(acc).sort((a, b) => a[0] - b[0]) }
    }
    return { label: view + ' pool', rows: src?.[view] }
  })()

  const lrows = ladder.filter(r => r.row_level === ladderLvl).sort((a, b) => (a.region || '').localeCompare(b.region || '') || (a.brand_name || '').localeCompare(b.brand_name || '') || (a.location_name || '').localeCompare(b.location_name || ''))
  const total = ladder.find(r => r.row_level === 'total')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ ...S.card, gap: 6 }}>
        <h3 style={{ ...S.h3, fontSize: 18 }}>Perfect-world staffing{locked && brands[0] ? ` · ${brands[0].brand}` : ' · All brands'}</h3>
        <p style={S.sub}>The staff a world-class contact center would need for the actual inbound CSR call volume during open hours: 90% of calls answered in 15 seconds and 3% abandon or less in every half-hour. This is a target, not a description of today's staffing. Outbound calls are not counted.</p>
        <p style={{ ...S.sub, fontSize: 12 }}>Model window {fdate(t.window?.[0])} – {fdate(t.window?.[1])}. Current-staffing comparison {fdate(t.ladder_window?.[0])} – {fdate(t.ladder_window?.[1])}. Source: Switchboard, Perfect-World WFM. Loaded {t.loaded_at ? new Date(t.loaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}.</p>
      </div>

      {/* Headline tiles */}
      <div style={S.kpis}>
        {!locked && <Kpi n={f1(t.totals?.region_ceiling)} l="FTE · pooled by region" tip={TIPS.pooled + ' ' + TIPS.fte} sub={regions.map(r => `${r.region} ${f1(r.fte_ceiling)}`).join(' · ')} />}
        <Kpi n={f1(locked ? brandSum : t.totals?.brands_sum ?? brandSum)} l={locked ? 'FTE · brand as one team' : 'FTE · separate brand teams'} tip={TIPS.separate + ' ' + TIPS.fte} />
        {!locked && <Kpi n={f1((t.totals?.brands_sum ?? brandSum) - (t.totals?.region_ceiling ?? 0))} l="FTE saved by pooling" tip={TIPS.saving} tone="var(--passed)" />}
        {!locked && <Kpi n={f1(t.totals?.region_service)} l="FTE · regions, service standard only" tip={TIPS.service} />}
        <Kpi n={n0(cpw)} l="Inbound calls per week" tip={TIPS.cpw} />
        <Kpi n={n0(obh)} l="Outbound capacity hours per week" tip={TIPS.obh} />
        {!locked && <Kpi n={(t.totals?.actual_abandon_pct ?? '—') + '%'} l="Actual abandon rate, open hours" tip={TIPS.abandon} tone="var(--failed)" sub={`Target 3% · modeled ${t.totals?.modeled_abandon_pct ?? '—'}%`} />}
      </div>

      {/* Filters */}
      {!locked && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center' }}>Team view<Tip text="All brands: each brand is its own team. East pool / West pool: every brand in that region is one shared team. Enterprise: both pools together." /></span>
          {TEAM_VIEWS.map(([k, l]) => <button key={k} style={S.chip(view === k)} onClick={() => { setView(k); if (k !== 'brands') setBrand('') }}>{l}</button>)}
          {view === 'brands' && <select style={S.sel} value={brand} onChange={e => setBrand(e.target.value)} aria-label="Brand"><option value="">All 10 brands</option>{brands.map(b => <option key={b.brand}>{b.brand}</option>)}</select>}
          {view !== 'brands' && <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}><input type="checkbox" checked={svc} onChange={e => setSvc(e.target.checked)} />Service standard only (no 30% ceiling)<Tip text={TIPS.ceiling} /></label>}
        </div>
      )}

      {/* FTE by month */}
      <Card title="FTE by month" tip={TIPS.fte} sub="May to October 2026. Each month uses its own count of open days. Pooled teams follow the Team view; the brand rows are always each brand staffed on its own.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <Th left>Team</Th>
              {months.map(m => <Th key={m}>{MONTH(m)}</Th>)}
              <Th tip={TIPS.avg6}>6-mo avg</Th>
              <Th tip={TIPS.cpw}>Calls / week</Th>
              {(locked || view === 'brands') && <Th tip={TIPS.obh}>Outbound hrs / week</Th>}
            </tr></thead>
            <tbody>
              {viewRows.map(r => (
                <tr key={r.name}>
                  <td style={{ ...S.td, textAlign: 'left' }}><div style={{ fontWeight: 600 }}>{r.name}</div><div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.region} · {r.hours}</div></td>
                  {r.months.map((v, i) => <td key={i} style={S.td}>{f2(v)}</td>)}
                  <td style={{ ...S.td, fontWeight: 700 }}>{f2(mean(r.months))}</td>
                  <td style={S.td}>{n0(r.cpw)}</td>
                  {(locked || view === 'brands') && <td style={S.td}>{n0(r.obh)}</td>}
                </tr>
              ))}
              {viewRows.length > 1 && (
                <tr style={{ background: 'var(--canvas)' }}>
                  <td style={{ ...S.td, textAlign: 'left', fontWeight: 700 }}>Total</td>
                  {months.map((_, i) => <td key={i} style={{ ...S.td, fontWeight: 700 }}>{f2(viewRows.reduce((a, r) => a + r.months[i], 0))}</td>)}
                  <td style={{ ...S.td, fontWeight: 700 }}>{f2(viewRows.reduce((a, r) => a + mean(r.months), 0))}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{n0(viewRows.reduce((a, r) => a + r.cpw, 0))}</td>
                  {(locked || view === 'brands') && <td style={{ ...S.td, fontWeight: 700 }}>{n0(viewRows.reduce((a, r) => a + (r.obh || 0), 0))}</td>}
                </tr>
              )}
              {!locked && view === 'brands' && !brand && regions.length > 0 && (
                <>
                  {regions.map(r => (
                    <tr key={r.region}>
                      <td style={{ ...S.td, textAlign: 'left' }}><span style={{ fontWeight: 600 }}>{r.region} pool</span> <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>· 30% ceiling</span></td>
                      {r.ceiling.map((v, i) => <td key={i} style={S.td}>{f2(v)}</td>)}
                      <td style={{ ...S.td, fontWeight: 700 }}>{f2(mean(r.ceiling))}</td>
                      <td style={S.td}>{n0(r.calls.reduce((a, c) => a + c, 0) * 7 / 184)}</td><td style={S.td} />
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--canvas)' }}>
                    <td style={{ ...S.td, textAlign: 'left', fontWeight: 700 }}>Pooled by region</td>
                    {months.map((_, i) => <td key={i} style={{ ...S.td, fontWeight: 700 }}>{f2(regions.reduce((a, r) => a + r.ceiling[i], 0))}</td>)}
                    <td style={{ ...S.td, fontWeight: 700 }}>{f2(regions.reduce((a, r) => a + mean(r.ceiling), 0))}</td>
                    <td style={S.td} /><td style={S.td} />
                  </tr>
                </>
              )}
              <tr>
                <td style={{ ...S.td, textAlign: 'left', color: 'var(--ink-soft)' }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Handle time (sec)<Tip text={TIPS.aht} /></span></td>
                {(t.aht_by_month || []).map((v, i) => <td key={i} style={{ ...S.td, color: 'var(--ink-soft)' }}>{n0(v)}</td>)}
                <td style={S.td} /><td style={S.td} />{(locked || view === 'brands') && <td style={S.td} />}
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ ...S.sub, fontSize: 12 }}>The 6-month column averages the six monthly values. {locked ? `Over the whole window at once: ${f2(brands[0]?.fte)} FTE.` : `Over the whole window at once the totals are ${f1(t.totals?.brands_sum)} FTE for separate brand teams and ${f1(t.totals?.region_ceiling)} FTE pooled by region.`}</p>
      </Card>

      {/* Agents by time of day */}
      <Card title="Agents required by time of day" tip={TIPS.agents} sub={`${todRows.label}. Average open weekday, May to October. Bars = calls offered, line = agents required. Hover a bar for the numbers.`}>
        <TodChart rows={todRows.rows} label={todRows.label} />
      </Card>

      {/* Current vs perfect-world */}
      <Card title="Current staffing vs perfect-world" tip="People and call outcomes are measured. Perfect-world FTE is modeled with the same rules at every level." sub={`${fdate(t.ladder_window?.[0])} – ${fdate(t.ladder_window?.[1])} (last 30 complete days in the snapshot). People are not FTE: multi-hat staff have other duties, and a shared endpoint is a front-desk line.`}
        right={<div style={{ display: 'flex', gap: 6 }}>{[['region', 'By region'], ['brand', 'By brand'], ['location', 'By location']].filter(([k]) => !locked || k !== 'region').map(([k, l]) => <button key={k} style={S.chip(ladderLvl === k)} onClick={() => setLadderLvl(k)}>{l}</button>)}</div>}>
        {!locked && total && (
          <div style={S.kpis}>
            <Kpi n={n0(total.people)} l="People answering" tip={TIPS.people} sub={`${n0(total.primary_people)} primary answerers`} />
            <Kpi n={pc(total.abandon_rate)} l="Abandon rate" tip={TIPS.abn} tone={total.abandon_rate > 0.03 ? 'var(--failed)' : 'var(--passed)'} />
            <Kpi n={f1(total.fte_brand_pool)} l="Perfect-world FTE, brand teams" tip={TIPS.fteBrand} />
            <Kpi n={f1(total.fte_region_pool)} l="Perfect-world FTE, regional pools" tip={TIPS.fteRegion} />
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <Th left>{ladderLvl === 'location' ? 'Location' : ladderLvl === 'brand' ? 'Brand' : 'Region'}</Th>
              <Th tip={TIPS.people}>People</Th>
              <Th tip={TIPS.primary}>Primary</Th>
              <Th tip={TIPS.dedicated}>Dedicated</Th>
              <Th tip={TIPS.multihat}>Multi-hat</Th>
              <Th tip={TIPS.shared}>Shared line</Th>
              <Th tip={TIPS.occasional}>Occasional</Th>
              <Th tip={TIPS.offered}>Calls</Th>
              <Th tip={TIPS.abn}>Abandon</Th>
              <Th tip={TIPS.asa}>Sec to answer</Th>
              <Th tip={TIPS.sl15}>In 15 sec</Th>
              <Th tip={TIPS.fteLoc}>FTE by location</Th>
              {ladderLvl !== 'location' && <Th tip={TIPS.fteBrand}>FTE by brand</Th>}
              {ladderLvl === 'region' && <Th tip={TIPS.fteRegion}>FTE by region</Th>}
            </tr></thead>
            <tbody>
              {lrows.map(r => (
                <tr key={r.row_key}>
                  <td style={{ ...S.td, textAlign: 'left' }}><div style={{ fontWeight: 600 }}>{r.team_name}</div>{ladderLvl !== 'region' && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{ladderLvl === 'location' ? `${r.brand_name} · ` : ''}{r.region}</div>}</td>
                  <td style={S.td}>{n0(r.people)}</td>
                  <td style={S.td}>{n0(r.primary_people)}</td>
                  <td style={S.td}>{n0(r.dedicated)}</td>
                  <td style={S.td}>{n0(r.multi_hat)}</td>
                  <td style={S.td}>{n0(r.shared_endpoint)}</td>
                  <td style={S.td}>{n0(r.occasional)}</td>
                  <td style={S.td}>{n0(r.calls_offered)}</td>
                  <td style={{ ...S.td, color: r.abandon_rate > 0.03 ? 'var(--failed)' : 'var(--passed)', fontWeight: 600 }}>{pc(r.abandon_rate)}</td>
                  <td style={S.td}>{f1(r.avg_answer_sec)}</td>
                  <td style={S.td}>{pc(r.pct_answered_15s)}</td>
                  <td style={S.td}>{f1(r.fte_local)}</td>
                  {ladderLvl !== 'location' && <td style={S.td}>{f1(r.fte_brand_pool)}</td>}
                  {ladderLvl === 'region' && <td style={{ ...S.td, fontWeight: 700 }}>{f1(r.fte_region_pool)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ ...S.sub, fontSize: 12 }}>A call counts at the location of the first queue leg with an agent, or the last queue it rang if nobody answered. Perfect-world FTE counts calls inside open hours only; measured calls include calls outside open hours. On region rows people add up the brands, so someone who answers for two brands counts twice. Every open location needs about 2 FTE even at low volume, because each open half-hour has at least one agent.</p>
      </Card>

      {/* Method */}
      <Card title="Method, assumptions and caveats">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <div>
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Standards</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li style={S.li}>90% of calls answered within 15 seconds.</li>
              <li style={S.li}>Abandonment of 3% or less in every 30-minute block, every abandon counted (including instant hang-ups). Abandoning callers are assumed to wait about 9 seconds (a patience setting of about 11 seconds); this is an estimate.</li>
              <li style={S.li}>25% shrinkage and an 80% occupancy cap. 30 phone hours per FTE per week.</li>
              <li style={S.li}>Handle time for every team = the enterprise average talk time for the month (all 10 brands) + 30 seconds of after-call work. A date range that covers part of a month uses that month's figure.</li>
              <li style={S.li}>Agents in each block = the larger of the Erlang C count for 90/15 and the Erlang A count for 3% abandon. Every open half-hour has at least one agent, even with zero calls.</li>
              <li style={S.li}>Outbound calls are not counted. An automated dialer is assumed to use idle time, up to the occupancy cap. Outbound capacity is capacity, not a forecast.</li>
              <li style={S.li}>Saturday uses the agents needed to carry the monthly average Saturday workload (rounded up, minimum 1), not the 90/15 or 3% abandon counts.</li>
            </ul>
          </div>
          <div>
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Pooling and caveats</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {!locked && <li style={S.li}>East = Apple, Genson, PDQ, Quality, TVG (Eastern clock). West = Cedar Park, Cheney, Cunningham, Dans, Omaha (Central clock). Cunningham is on Eastern time and is moved to Central time before pooling; it stays in West.</li>}
              {!locked && <li style={S.li}>Pooled is a best case: it assumes any agent can answer any brand.</li>}
              {!locked && <li style={S.li}>The 30% inbound occupancy ceiling is a weekday staffing choice that holds idle time for outbound work and growth peaks. It sets regional staffing in about 85% of weekday half-hours with calls. Applying it on Saturdays too would add about 0.7 FTE ({f2(t.totals?.saturday_ceiling_total)} total).</li>}
              <li style={S.li}>Staffing to a 3% abandon limit gives about {t.totals?.modeled_abandon_pct ?? 1.5}% modeled abandonment, because agents come in whole numbers.{!locked && ` Actual abandonment across all brands is about ${t.totals?.actual_abandon_pct ?? 5.3}% during open hours.`}</li>
              <li style={S.li}>Short-abandon analysis is not possible yet: LightSpeed does not send time-to-abandon for most abandoned calls.</li>
              <li style={S.li}>Every brand is closed Sunday and on May 25, Jul 3, Jul 4 and Sep 7. Cheney, Cunningham, Dans and Genson are closed Saturday.</li>
            </ul>
          </div>
          <div>
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Open hours (official, local time)</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {brands.map(b => <li key={b.brand} style={S.li}><b>{b.brand}</b>: {b.hours}</li>)}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}
