// ============================================================================
//  SALES — shared helpers for the Dashboard, Sprint Scorecard, Prospects and
//  Discovery Notes tabs (built 2026-09-23 from the OpsisCx Sales Tracker sheet).
//
//  Every number on those screens comes from ONE database function,
//  public.sales_activity_daily(p_start, p_end), so the dashboard and the
//  scorecard can never count the same thing two different ways. It returns one
//  row per (day, person). What each column means:
//    dials        Five9 calls on the Turritopsis Consulting campaigns (excludes
//                 No Disposition / Test Call / INTERNAL / Abandon / Force Stop)
//    connections  dispositions Brittney listed on 2026-09-23: Booked, Call Back,
//                 Working with Competitor, Not Interested, Decision Maker
//                 Unavailable, Not Viable, Info Requested, Follow-Up Required
//    callbacks    Five9 "Call Back"
//    emails       emails logged on sales-pipeline deals
//    researched   prospects whose research was completed that day (+ A / B tier)
//    booked       deals moved into Discovery Call Scheduled
//    held/no_show meeting outcome on the deal; qualified = held AND qualified
//    proposals    deals moved into Proposal Sent
//    won          deals moved into Contract Signed / Won (counted once)
//
//  The database refuses the function to anyone who cannot see the Sales
//  pipeline (agents and clients), so these screens are safe even on a direct hit.
// ============================================================================
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export const METRIC_KEYS = ['dials', 'connections', 'callbacks', 'emails', 'researched', 'researched_a', 'researched_b',
  'booked', 'held', 'no_show', 'qualified', 'proposals', 'won', 'won_value', 'won_hours']

export const TIERS = ['A', 'B', 'C', 'D']
export const TIER_HINT = {
  A: 'Strong fit — research and call immediately',
  B: 'Good fit — work the same day',
  C: 'Possible fit — work after A/B',
  D: 'Weak fit — low priority',
}

// ---------- dates (the team works on Eastern time) ----------
const ET = 'America/New_York'
export function todayET() {
  // 'YYYY-MM-DD' for today in Eastern time
  return new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function dayOfWeek(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay() }
/** The last working day strictly before `iso` (Mon → the Friday before). */
export function prevWorkday(iso) {
  let d = addDays(iso, -1)
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, -1)
  return d
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000)
}
export function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  if (!iso) return '—'
  return new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-US', { timeZone: iso.length <= 10 ? 'UTC' : ET, ...opts })
}
export function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
export function pct(num, den) {
  if (!den) return '—'
  return Math.round((num / den) * 100) + '%'
}

// ---------- data ----------
/** Rows from sales_activity_daily for [start, end]. */
export async function loadActivity(start, end) {
  const { data, error } = await supabase.rpc('sales_activity_daily', { p_start: start, p_end: end })
  if (error) throw error
  return (data || []).map(r => {
    const o = { ...r }
    for (const k of METRIC_KEYS) o[k] = Number(r[k] || 0)
    return o
  })
}

/** Sum metric columns over rows, optionally filtered. */
export function sumRows(rows, filter = () => true) {
  const out = Object.fromEntries(METRIC_KEYS.map(k => [k, 0]))
  for (const r of rows) if (filter(r)) for (const k of METRIC_KEYS) out[k] += r[k]
  return out
}

/** The signed-in person's profile row (id + full name), for stamping edits. */
export function useMe() {
  const { user } = useAuth()
  const [me, setMe] = useState(null)
  useEffect(() => {
    let off = false
    if (!user?.id) return
    supabase.from('profiles').select('id, full_name, email').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (!off) setMe(data || { id: user.id, full_name: user.email, email: user.email }) })
    return () => { off = true }
  }, [user?.id])
  return me
}

// ---------- shared styles (inline, on the app's own tokens) ----------
export const S = {
  page: { padding: '18px 20px 40px' },
  h1: { fontSize: 22, fontWeight: 800, margin: 0 },
  sub: { margin: '4px 0 0', fontSize: 13.5 },
  card: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' },
  label: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' },
  btn: { border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' },
  btnPri: { border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' },
  input: { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit', boxSizing: 'border-box' },
  th: { textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', padding: '6px 10px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--line)', fontSize: 13.5, whiteSpace: 'nowrap' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  err: { background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: '0 0 14px' },
}

export const TIER_STYLE = {
  A: { background: '#e7f5ec', color: '#1f8a53' },
  B: { background: 'var(--accent-bg, #e5f1f8)', color: 'var(--accent)' },
  C: { background: '#e3edf0', color: '#245866' },
  D: { background: 'var(--canvas)', color: 'var(--ink-soft)' },
}
export function TierChip({ tier }) {
  if (!tier) return <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>—</span>
  return (
    <span title={TIER_HINT[tier]}
      style={{ display: 'inline-block', minWidth: 22, textAlign: 'center', fontSize: 12, fontWeight: 800, padding: '2px 7px', borderRadius: 99, ...(TIER_STYLE[tier] || {}) }}>
      {tier}
    </span>
  )
}

/** Big-number tile with an optional progress bar toward a goal. */
export function Tile({ label, value, goal, goalLabel, hint }) {
  const v = typeof value === 'number' ? value : null
  const showBar = goal && v != null
  const p = showBar ? Math.min(100, Math.round((v / goal) * 100)) : 0
  return (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={S.label}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
      {showBar && (
        <div style={{ height: 6, borderRadius: 99, background: 'var(--canvas)', overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ width: p + '%', height: '100%', background: p >= 100 ? '#1f8a53' : 'var(--accent)' }} />
        </div>
      )}
      {(goalLabel || hint) && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{goalLabel || hint}</span>}
    </div>
  )
}
