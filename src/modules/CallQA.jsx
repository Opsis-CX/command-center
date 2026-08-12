import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'

// ============================================================
// CALL QA (AI) — automated call scoring, opportunity/outcome & coaching
// Pipeline: CallRail pull -> (Deepgram transcribe) -> Claude score (ai_qa_rubric,
// the door form) -> ai_qa_reviews. Managers (quality_audit.call_reviews) see all;
// agents see only their own. RLS-enforced.
// ============================================================

const SECTIONS = [
  { key: 'greeting_compliance', label: 'Greeting & Compliance' },
  { key: 'discovery_needs', label: 'Discovery & Needs' },
  { key: 'solution_pitch', label: 'Solution & Pitch' },
  { key: 'close_next_steps', label: 'Close & Next Steps' },
]
const RUBRIC_ORDER = ['greeting', 'verify', 'callflow', 'knowledge', 'appointment', 'professionalism', 'rebuttals', 'hold', 'nextsteps', 'closing']
// Program/client scope for the Call QA screen. `garagedoor` = GarageCo (external client);
// `lavin` / `open_invoices` = Opsis's own internal Five9 programs. Keys must match ai_qa_reviews.campaign.
const PROGRAM_LABELS = { garagedoor: 'GarageCo', lavin: 'Lavin', open_invoices: 'Open Invoices' }
const TEAL = '#0f766e'
const INK = '#0f172a'   // this module's own text colour (it never uses the theme's)
const canViewAll = (r) => can(r, 'quality_audit.call_reviews') || can(r, 'service_performance_scorecard.view_all_scorecards')

const scoreColor = (v) => (v == null ? '#94a3b8' : v >= 85 ? '#1b5e20' : v >= 70 ? '#8d6e00' : '#b71c1c')
const scoreBg = (v) => (v == null ? '#f1f5f9' : v >= 85 ? '#e8f5e9' : v >= 70 ? '#fff8e1' : '#fdecea')
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')
const fmtDur = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const trendNavBtn = (enabled) => ({ width: 26, height: 26, lineHeight: '22px', textAlign: 'center', padding: 0, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: enabled ? '#334155' : '#cbd5e1', fontSize: 16, fontWeight: 700, cursor: enabled ? 'pointer' : 'default' })
// Put each speaker turn on its own line with a blank line between, for readability.
const formatTranscript = (t) => {
  if (!t) return ''
  return t
    .replace(/\s*\b(Agent|Caller|Customer|Rep|Speaker\s*\d+)\s*:\s*/g, '\n\n$1: ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
const OUTCOME_STYLE = {
  'Booked': { bg: '#e8f5e9', fg: '#1b5e20' }, 'Not Booked': { bg: '#fdecea', fg: '#b71c1c' },
  'Transferred': { bg: '#e3f2fd', fg: '#0d47a1' }, 'No Opportunity': { bg: '#f1f5f9', fg: '#64748b' }, 'Other': { bg: '#f1f5f9', fg: '#64748b' },
}
const agentOf = (r) => r.call?.agent_name || r.extracted_agent_name || 'Unknown'
// Seconds → m:ss for transcript timestamps.
const clockOf = (t) => { const s = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
// On-screen timestamped transcript (one line per Deepgram utterance).
function TimedTranscript({ segments }) {
  return (
    <div style={{ maxHeight: 340, overflowY: 'auto', fontSize: 13, lineHeight: 1.5 }}>
      {segments.map((seg, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
          <span style={{ color: TEAL, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 32 }}>{clockOf(seg.t)}</span>
          <span style={{ color: '#334155' }}><b style={{ color: '#475569' }}>{seg.s}:</b> {seg.text}</span>
        </div>
      ))}
    </div>
  )
}
// A review counts toward scores only if it's a real conversation and not manually excluded.
const isScored = (r) => r.scoreable !== false && !r.excluded && r.score_pct != null
const CLASS_LABEL = { wrong_number: 'Wrong number', ivr_only: 'IVR only', voicemail: 'Voicemail', no_agent: 'No agent', spam: 'Spam' }
const ynLabel = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'na' ? 'N/A' : '—')

// ---- Inferred deal size --------------------------------------------------
// There's no dollar/value field on a call, so we infer "how big" from what the
// caller wanted (the AI's controlled `topics` vocab). New-door installs and
// commercial jobs are the big-ticket work → "Large"; most repairs → "Medium";
// status/info calls → "Small". Used by the Large Missed Opps tab.
const HIGH_VALUE_TOPICS = new Set(['New Door / Installation Quote', 'Commercial'])
const MED_VALUE_TOPICS = new Set([
  'Repair - Spring', 'Repair - Opener', 'Repair - Cable', 'Repair - Off Track',
  'Repair - Panel/Section', 'Repair - Other', 'Emergency', 'Maintenance / Tune-up',
  'Quote Request', 'Accessory / Keypad Purchase', 'Warranty',
])
const valueTier = (r) => {
  const t = r.topics || []
  if (t.some((x) => HIGH_VALUE_TOPICS.has(x))) return 3
  if (t.some((x) => MED_VALUE_TOPICS.has(x))) return 2
  return 1
}
const TIER_META = {
  3: { label: 'Large', bg: '#fef3c7', fg: '#92400e' },
  2: { label: 'Medium', bg: '#e0f2fe', fg: '#075985' },
  1: { label: 'Small', bg: '#f1f5f9', fg: '#64748b' },
}
// A missed opportunity = a real sales/booking chance that didn't get booked.
// Matches how the Opportunities tab counts "Missed" (anything not Booked).
const isMissedOpp = (r) => Boolean(r.opportunity) && r.outcome && r.outcome !== 'Booked'
// Best single "why this call was bad / what to fix" line for a row.
const topIssue = (r) => (r.risk_flags || [])[0] || (r.improvements || [])[0] || r.not_booked_reason || (r.coaching_note ? r.coaching_note.slice(0, 90) : '') || '—'
// Recompute a review's totals from (possibly manager-edited) answers.
function recomputeReview(answers) {
  let earned = 0, max = 0; const sec = {}
  Object.values(answers || {}).forEach((a) => {
    const na = a.na || a.answer === 'na'
    const itemMax = Number(a.max) || 0
    const got = na ? 0 : (a.answer === 'yes' ? itemMax : (a.answer === 'no' ? 0 : Number(a.points) || 0))
    if (!na) { max += itemMax; earned += got }
    const s = a.section || 'other'; sec[s] ??= { earned: 0, max: 0 }; if (!na) { sec[s].max += itemMax; sec[s].earned += got }
  })
  const pct = max > 0 ? Math.round((earned / max) * 1000) / 10 : 0
  const section_scores = {}; for (const [s, v] of Object.entries(sec)) section_scores[s] = { earned: v.earned, max: v.max, pct: v.max ? Math.round((v.earned / v.max) * 1000) / 10 : null }
  return { earned, max, pct, section_scores }
}

// This module is painted light-on-light throughout (hardcoded #fff / #f8fafc).
// It must therefore state its own ink colour — otherwise text with no explicit
// colour inherits var(--ink), which is near-white in dark mode, on a white card.
const Card = ({ children, style }) => <div style={{ background: '#fff', color: INK, border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, ...style }}>{children}</div>
const Tile = ({ label, value, sub, color, delta }) => (
  <Card style={{ flex: 1, minWidth: 130 }}>
    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || '#0f172a' }}>{value}</div>
      {delta}
    </div>
    {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
  </Card>
)
// Change vs. the prior period. `good` says which direction is good (up/down); the
// arrow is green when the move is good, red when not. Renders nothing without a baseline.
const Delta = ({ now, prev, good = 'up', digits = 1, suffix = 'pp' }) => {
  if (now == null || prev == null) return null
  const d = now - prev
  if (Math.abs(d) < (digits === 0 ? 0.5 : 0.05)) return <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>±0</span>
  const up = d > 0
  const positive = good === 'up' ? up : !up
  const mag = digits === 0 ? Math.round(Math.abs(d)) : Math.round(Math.abs(d) * 10) / 10
  return <span title={'vs. prior period'} style={{ fontSize: 11.5, fontWeight: 700, color: positive ? '#1b5e20' : '#b71c1c', whiteSpace: 'nowrap' }}>{up ? '▲' : '▼'} {mag}{suffix}</span>
}
const Bar = ({ v, color }) => <div style={{ background: '#eef2f7', borderRadius: 999, height: 9, overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, v || 0))}%`, height: '100%', background: color || TEAL, borderRadius: 999, transition: 'width .3s ease' }} /></div>
// ---- Lightweight SVG charts (zero dependencies) ---------------------------
// Smooth area+line trend chart. `data` = [{ label, value, n? }]. Scales width
// to its container; height is fixed by the viewBox aspect ratio.
function TrendChart({ data, color = TEAL, yMax = 100, valueFmt = (v) => Math.round(v), showTrend = true }) {
  if (!data || !data.length) return <div style={{ color: '#64748b', padding: '20px 0' }}>No calls in range.</div>
  const W = 760, H = 200, padT = 12, padB = 24, padX = 6
  const n = data.length, innerW = W - padX * 2, innerH = H - padT - padB
  const x = (i) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v) => padT + innerH - (Math.max(0, Math.min(yMax, v || 0)) / yMax) * innerH
  const pts = data.map((d, i) => [x(i), y(d.value)])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = `${line} L ${x(n - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`
  // Least-squares best-fit trend line across the visible points.
  const mx = (n - 1) / 2, my = data.reduce((s, d) => s + (d.value || 0), 0) / n
  let tnum = 0, tden = 0
  data.forEach((d, i) => { tnum += (i - mx) * ((d.value || 0) - my); tden += (i - mx) ** 2 })
  const slope = tden ? tnum / tden : 0
  const fit = (i) => my + slope * (i - mx)
  const trendPath = n > 1 ? `M ${x(0).toFixed(1)} ${y(fit(0)).toFixed(1)} L ${x(n - 1).toFixed(1)} ${y(fit(n - 1)).toFixed(1)}` : null
  const step = Math.max(1, Math.ceil(n / 8))
  const gid = 'grad' + String(color).replace(/[^a-z0-9]/gi, '')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto', overflow: 'visible' }}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.20" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={padX} x2={W - padX} y1={padT + innerH * g} y2={padT + innerH * g} stroke="#eef2f7" strokeWidth="1" />)}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {showTrend && trendPath && <path d={trendPath} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4"><title>Best-fit trend</title></path>}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={n > 30 ? 0 : 3} fill="#fff" stroke={color} strokeWidth="2"><title>{`${data[i].label}: ${valueFmt(data[i].value)}${data[i].n != null ? ` · ${data[i].n} calls` : ''}`}</title></circle>)}
      {data.map((d, i) => ((n - 1 - i) % step === 0 ? <text key={i} x={x(i)} y={H - 7} fontSize="11" fill="#94a3b8" textAnchor="middle">{d.label}</text> : null))}
    </svg>
  )
}
// A labeled horizontal bar row (label · value on top, bar below).
const BarRow = ({ label, value, v, color }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, gap: 8 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span><b style={{ whiteSpace: 'nowrap' }}>{value}</b></div>
    <Bar v={v} color={color} />
  </div>
)

// ---- Table view: in-table search + pagination ----------------------------
// Wrap an already-sorted row list. Returns the current page of rows plus the
// search box / pager state. `searchText(row)` supplies the text a row matches on.
function useTableView(rows, opts = {}) {
  const { pageSize = 25, searchText = null } = opts
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => ((!q || !searchText) ? rows : rows.filter((r) => String(searchText(r) || '').toLowerCase().includes(q))),
    [rows, q, searchText]
  )
  useEffect(() => { setPage(1) }, [q])
  const total = filtered.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const cur = Math.min(Math.max(1, page), pages)
  const pageRows = filtered.slice((cur - 1) * pageSize, cur * pageSize)
  return { query, setQuery, pageRows, total, allTotal: rows.length, page: cur, pages, setPage, pageSize }
}
const pagerBtn = (on) => ({ width: 26, height: 26, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: on ? '#334155' : '#cbd5e1', cursor: on ? 'pointer' : 'default', fontSize: 15, fontWeight: 700, lineHeight: '20px', padding: 0 })
function Pager({ view }) {
  if (view.pages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#475569' }}>
      <button onClick={() => view.setPage(view.page - 1)} disabled={view.page <= 1} title="Previous page" style={pagerBtn(view.page > 1)}>‹</button>
      <span style={{ whiteSpace: 'nowrap' }}>Page {view.page} / {view.pages}</span>
      <button onClick={() => view.setPage(view.page + 1)} disabled={view.page >= view.pages} title="Next page" style={pagerBtn(view.page < view.pages)}>›</button>
    </div>
  )
}
// Search box + row count + pager, shown above a table.
function TableToolbar({ view, placeholder = 'Search…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 12, pointerEvents: 'none' }}>🔎</span>
        <input value={view.query} onChange={(e) => view.setQuery(e.target.value)} placeholder={placeholder}
          style={{ padding: '6px 10px 6px 30px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, width: 210, maxWidth: '60vw', background: '#fff', color: INK, boxSizing: 'border-box' }} />
      </div>
      <div style={{ fontSize: 12.5, color: '#64748b' }}>{view.total === view.allTotal ? `${view.total} rows` : `${view.total} of ${view.allTotal}`}</div>
      <div style={{ flex: 1 }} />
      <Pager view={view} />
    </div>
  )
}
const Pill = ({ children, bg, fg }) => <span style={{ background: bg, color: fg, fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>

// ---- Column sorting -------------------------------------------------------
// Click a table header to sort by that column; click again to flip the
// direction. Numeric columns sort low↔high, text columns sort A↔Z. Blank
// values ("—" / null) always sink to the bottom regardless of direction.
const dnum = (v) => { if (!v) return null; const t = new Date(v).getTime(); return Number.isNaN(t) ? null : t }
function useSort(initialKey = null, initialDir = 'asc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir })
  const onSort = useCallback((key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }, [])
  return [sort, onSort]
}
function sortRows(list, sort, accessors) {
  if (!sort || !sort.key || !accessors) return list
  const acc = accessors[sort.key]
  if (!acc) return list
  const dir = sort.dir === 'desc' ? -1 : 1
  const val = (row) => { const v = acc(row); return (v === '' || v === '—' || v == null || (typeof v === 'number' && Number.isNaN(v))) ? null : v }
  return list.slice().sort((a, b) => {
    const va = val(a), vb = val(b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir
  })
}
// A <thead> whose headers are click-to-sort. Each `cols` item is either a label
// string (sortable by that label) or [label, sortKey] where sortKey === null
// makes the column non-sortable (action / index / visual columns).
function SortHead({ cols, sort, onSort, thStyle, trStyle }) {
  return (
    <thead>
      <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569', ...trStyle }}>
        {cols.map((c, i) => {
          const label = Array.isArray(c) ? c[0] : c
          const key = Array.isArray(c) ? c[1] : c
          const sortable = key != null
          const active = sortable && sort && sort.key === key
          return (
            <th key={label + i}
              onClick={sortable ? () => onSort(key) : undefined}
              title={sortable ? 'Sort by ' + label : undefined}
              style={{ padding: '8px 12px', cursor: sortable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1, ...thStyle, ...(active ? { color: TEAL } : null) }}>
              {label}{active ? <span style={{ color: TEAL }}>{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span> : (sortable ? <span style={{ color: '#cbd5e1', fontSize: 10 }}> ⇅</span> : '')}
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

export default function CallQA({ portal = false } = {}) {
  const { appRole, user, isClientPortal } = useAuth()
  // Portal mode = an external client login. They see ALL of their client's calls
  // and the agent names (their own reception staff), can export and add notes —
  // but never the manager controls (re-score / exclude / adjust) or Settings.
  const portalMode = portal || isClientPortal || appRole === 'client'
  const canManage = canViewAll(appRole) && !portalMode   // Opsis manager edit rights
  const viewAll = canViewAll(appRole) || portalMode       // see all rows + agent names + agent filter
  const [meName, setMeName] = useState('')
  const [exporting, setExporting] = useState(false)
  const [tab, setTab] = useState(() => (viewAll ? 'dashboard' : 'overview'))
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [settings, setSettings] = useState([])
  const [secretKeys, setSecretKeys] = useState([])
  const [pipeline, setPipeline] = useState({})
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState('')
  const [days, setDays] = useState(30)
  const [startDate, setStartDate] = useState('') // YYYY-MM-DD; when set (with endDate) overrides the Range preset
  const [endDate, setEndDate] = useState('')
  const [brand, setBrand] = useState('all')
  const [agent, setAgent] = useState('all')
  const [topic, setTopic] = useState('all')
  const [source, setSource] = useState('all')       // CallRail / Lightspeed / (internal Five9 for managers only)
  const [callType, setCallType] = useState('conversation') // default: real conversations (hide voicemail/IVR/wrong#/spam)
  const [program, setProgram] = useState('garagedoor') // GarageCo vs internal programs (Lavin / Open Invoices)
  // Overview is served by a server-side aggregate (callqa_overview) for managers, so
  // it renders instantly instead of waiting for the full row download. Agents/portal
  // keep the client-side path (RLS-scoped rows). Verified to match the row math.
  const [ovData, setOvData] = useState(null)
  const [ovErr, setOvErr] = useState('')

  // Guards against a slower, superseded load clobbering the current program's rows.
  // Switching program (garagedoor -> lavin) kicks off a new load(), but the previous
  // load may still be paging (the ~11k-row garagedoor fetch takes ~10s). Without this,
  // that stale fetch's setRows() lands late and — because `scoped` filters to the NOW-
  // selected program — every row gets filtered out ("No scored calls in this range").
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true); setErr('')
    // Supabase caps a single response at 1000 rows, so page through ALL reviews.
    // The heavy per-question `answers` blob and the `transcript` are fetched lazily
    // (in the detail drawer, and on demand at CSV-export time) to keep this initial
    // payload light — it makes the first load noticeably faster at scale.
    const sel = 'id, campaign, score_pct, earned_points, max_points, auto_fail, section_scores, strengths, improvements, strength_tags, improvement_tags, coaching_note, risk_flags, summary, status, opportunity, outcome, not_booked_reason, opportunity_context, extracted_agent_name, call_class, scoreable, excluded, manager_adjusted, adjustment_note, reviewed, reviewed_marked_at, reviewed_marked_by, topics, objections, asked_for_booking, info_before_pricing, set_fee_expectations, winnable, revenue_tip, asked_for_cc, cc_quote, collected_cc, cc_collected_quote, created_at, call:ai_qa_calls(id, agent_name, profile_id, brand, source, direction, disposition, call_date, duration_seconds, recording_url, customer_name, customer_number)'
    // Managers fetch only the selected program server-side (client-side `scoped`
    // still applies); everyone else is RLS-scoped. The settings / secret-presence /
    // pipeline-count queries run concurrently. Reviews are paged SEQUENTIALLY: an
    // exact COUNT and concurrent heavy paged queries tripped statement_timeout for
    // the RLS-scoped client portal, so we page until a short page instead.
    const page = 1000
    const useCampaign = canManage && program !== 'all'
    const withCampaign = (q) => (useCampaign ? q.eq('campaign', program) : q)
    const statuses = ['ingested', 'needs_transcription', 'transcribing', 'ready', 'scoring', 'scored', 'error']
    const [{ data: st }, { data: sk }, ...pipe] = await Promise.all([
      supabase.from('ai_qa_settings').select('*').order('campaign'),
      // Presence-only RPC (names, never values) — integration_secrets isn't client-readable.
      supabase.rpc('callqa_secret_presence'),
      ...statuses.map((s) => supabase.from('ai_qa_calls').select('id', { count: 'exact', head: true }).eq('status', s).then((r) => ({ s, count: r.count || 0 }))),
    ])
    if (seq !== loadSeq.current) return
    setSettings(st || []); setSecretKeys(Array.isArray(sk) ? sk : [])
    const counts = {}; pipe.forEach(({ s, count: c }) => { counts[s] = c }); setPipeline(counts)
    let all = []
    if (portalMode) {
      // Client portal: ONE fast server-side query (callqa_portal_rows) instead of the
      // 13-request paged RLS download that tripped statement_timeout at scale. The RPC
      // self-scopes to the caller's own client (CallRail/LightSpeed only, never Five9)
      // and returns rows in the exact { …review, call:{…} } shape this component expects,
      // so all downstream tab math is unchanged.
      const { data, error } = await supabase.rpc('callqa_portal_rows', { p_start: null, p_end: null })
      if (seq !== loadSeq.current) return
      if (error) { setErr(error.message); setLoading(false); return }
      all = Array.isArray(data) ? data : []
    } else {
      let from = 0
      for (;;) {
        const { data, error } = await withCampaign(supabase.from('ai_qa_reviews').select(sel).order('created_at', { ascending: false }).range(from, from + page - 1))
        if (seq !== loadSeq.current) return   // a newer load superseded this one — drop its result
        if (error) { setErr(error.message); setLoading(false); return }
        all = all.concat(data || [])
        if (!data || data.length < page) break
        from += page
      }
    }
    if (seq !== loadSeq.current) return
    setRows(all)
    setLoading(false)
  }, [canManage, program, portalMode])
  useEffect(() => { load() }, [load])
  // Server-side Overview aggregate for EVERYONE — instant landing. The RPC
  // self-scopes exactly like the row RLS (manager → all, portal → their client,
  // agent → own), so it's safe for the client portal and far faster than the
  // paged row download.
  useEffect(() => {
    let active = true
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const today = new Date()
    let pStart, pEnd, prevStart, prevEnd
    if (startDate || endDate) {
      const s = startDate ? new Date(startDate + 'T00:00:00') : new Date('2000-01-01T00:00:00')
      const e = endDate ? new Date(endDate + 'T00:00:00') : today
      pStart = fmt(s); pEnd = fmt(e)
      const span = e - s
      const pe = new Date(s.getTime() - 86400000)
      const ps = new Date(s.getTime() - 86400000 - span)
      prevStart = fmt(ps); prevEnd = fmt(pe)
    } else {
      const s = new Date(today); s.setDate(s.getDate() - days)
      pStart = fmt(s); pEnd = fmt(today)
      const pe = new Date(s); pe.setDate(pe.getDate() - 1)
      const ps = new Date(s); ps.setDate(ps.getDate() - days - 1)
      prevStart = fmt(ps); prevEnd = fmt(pe)
    }
    setOvData(null); setOvErr('')
    supabase.rpc('callqa_overview', {
      p_campaign: canManage && program !== 'all' ? program : null,
      p_start: pStart, p_end: pEnd, p_prev_start: prevStart, p_prev_end: prevEnd,
      p_brand: brand === 'all' ? null : brand, p_agent: agent === 'all' ? null : agent, p_topic: topic === 'all' ? null : topic,
    }).then(({ data, error }) => { if (!active) return; if (error) setOvErr(error.message); else setOvData(data) })
    return () => { active = false }
  }, [canManage, program, days, startDate, endDate, brand, agent, topic])
  // Current user's display name, used when they add a note.
  useEffect(() => {
    let active = true
    if (!user?.id) return
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (active) setMeName(data?.full_name || user.email || 'User') })
      .catch(() => { if (active) setMeName(user.email || 'User') })
    return () => { active = false }
  }, [user?.id])

  // Program scope. Only Opsis managers get the GarageCo↔internal switcher; everyone else
  // (portal clients, agents) is left unfiltered so RLS alone governs what they see —
  // that avoids hiding an internal agent's own Lavin/Open-Invoices reviews.
  const scoped = useMemo(() => ((canManage && program !== 'all') ? rows.filter((r) => r.campaign === program) : rows), [rows, program, canManage])
  const programOpts = useMemo(() => {
    const camps = Array.from(new Set(['garagedoor', ...settings.map((s) => s.campaign).filter(Boolean)]))
    return [['all', 'All programs'], ...camps.map((c) => [c, PROGRAM_LABELS[c] || c])]
  }, [settings])
  const customRange = Boolean(startDate || endDate) // explicit calendar dates take over from the Range preset
  const filtered = useMemo(() => {
    // Default window from the "Range" preset…
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
    // …unless a start and/or end date is chosen on the calendar, which overrides it.
    const start = startDate ? new Date(startDate + 'T00:00:00') : null
    const end = endDate ? new Date(endDate + 'T23:59:59.999') : null
    return scoped.filter((r) => {
      const c = r.call || {}
      // call_date is a DATE ('YYYY-MM-DD'); parse it at LOCAL midnight so it lines
      // up with the start/end pickers (also local). Bare new Date('YYYY-MM-DD')
      // parses as UTC midnight, which in ET is the night before — that shift made
      // same-day filters (e.g. today–today) drop the current day entirely.
      const d = c.call_date ? new Date(c.call_date + 'T00:00:00') : new Date(r.created_at)
      if (customRange) {
        if (start && d < start) return false
        if (end && d > end) return false
      } else if (d < cutoff) return false
      if (brand !== 'all' && c.brand !== brand) return false
      if (agent !== 'all' && agentOf(r) !== agent) return false
      if (topic !== 'all' && !(r.topics || []).includes(topic)) return false
      if (source !== 'all' && (c.source || null) !== source) return false
      if (callType === 'conversation' ? !(r.call_class == null || r.call_class === 'conversation') : (callType !== 'all' && r.call_class !== callType)) return false
      return true
    })
  }, [scoped, days, startDate, endDate, customRange, brand, agent, topic, source, callType])

  // Date-range-only view (ignores the brand/agent/topic pickers) — the Scorecards
  // hub has its own brand/agent selectors, so it works off this wider set.
  const dateFiltered = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
    const start = startDate ? new Date(startDate + 'T00:00:00') : null
    const end = endDate ? new Date(endDate + 'T23:59:59.999') : null
    return scoped.filter((r) => {
      const c = r.call || {}
      // call_date is a DATE ('YYYY-MM-DD'); parse it at LOCAL midnight so it lines
      // up with the start/end pickers (also local). Bare new Date('YYYY-MM-DD')
      // parses as UTC midnight, which in ET is the night before — that shift made
      // same-day filters (e.g. today–today) drop the current day entirely.
      const d = c.call_date ? new Date(c.call_date + 'T00:00:00') : new Date(r.created_at)
      if (customRange) { if (start && d < start) return false; if (end && d > end) return false }
      else if (d < cutoff) return false
      if (source !== 'all' && ((r.call || {}).source || null) !== source) return false
      if (callType === 'conversation' ? !(r.call_class == null || r.call_class === 'conversation') : (callType !== 'all' && r.call_class !== callType)) return false
      return true
    })
  }, [scoped, days, startDate, endDate, customRange, source, callType])

  // Agent options are scoped to the current date range + selected brand, so picking
  // a brand narrows the CSR list to that brand's agents (not everyone).
  const agents = useMemo(() => {
    const pool = dateFiltered.filter((r) => brand === 'all' || (r.call || {}).brand === brand)
    return Array.from(new Set(pool.map(agentOf).filter(Boolean))).sort()
  }, [dateFiltered, brand])
  const brands = useMemo(() => Array.from(new Set(scoped.map((r) => r.call?.brand).filter(Boolean))).sort(), [scoped])
  const topicList = useMemo(() => Array.from(new Set(scoped.flatMap((r) => r.topics || []))).sort(), [scoped])
  // Source options are derived from the rows the viewer can actually see, so the
  // client portal only ever lists its own sources (CallRail / Lightspeed) — Five9
  // is internal and never present in portal rows, so it can't appear here.
  const sourceList = useMemo(() => Array.from(new Set(scoped.map((r) => r.call?.source).filter(Boolean))).sort(), [scoped])
  const SOURCE_LABELS = { callrail: 'CallRail', lightspeed: 'Lightspeed', five9: 'Five9' }
  const CALLTYPE_OPTS = [['conversation', 'Real conversations'], ['all', 'All call types'], ['voicemail', 'Voicemail'], ['ivr_only', 'IVR only'], ['wrong_number', 'Wrong number'], ['no_agent', 'No agent'], ['spam', 'Spam']]
  const CALLTYPE_LABELS = Object.fromEntries(CALLTYPE_OPTS)

  const agg = useMemo(() => {
    const scored = filtered.filter(isScored)
    const n = scored.length
    const avg = n ? scored.reduce((s, r) => s + (Number(r.score_pct) || 0), 0) / n : null
    const opps = filtered.filter((r) => r.opportunity)
    const booked = opps.filter((r) => r.outcome === 'Booked')
    const conv = opps.length ? (booked.length / opps.length) * 100 : null
    const sec = {}
    for (const s of SECTIONS) { const v = scored.map((r) => r.section_scores?.[s.key]?.pct).filter((x) => x != null); sec[s.key] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
    const outcomes = {}; filtered.forEach((r) => { if (r.outcome) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1 })
    const reasons = {}; opps.filter((r) => r.outcome === 'Not Booked').forEach((r) => { const k = r.not_booked_reason || 'Unspecified'; reasons[k] = (reasons[k] || 0) + 1 })
    const topics = {}; filtered.forEach((r) => (r.topics || []).forEach((t) => { topics[t] = (topics[t] || 0) + 1 }))
    return { n, avg, total: filtered.length, excluded: filtered.length - n, opps: opps.length, booked: booked.length, conv, sec, outcomes, reasons, topics, flags: filtered.filter((r) => (r.risk_flags || []).length).length }
  }, [filtered])

  const trend = useMemo(() => {
    const m = new Map()
    filtered.filter(isScored).forEach((r) => { const d = (r.call?.call_date) || r.created_at.slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(Number(r.score_pct) || 0) })
    return Array.from(m.entries()).map(([d, arr]) => ({ d, avg: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length })).sort((a, b) => a.d.localeCompare(b.d))
  }, [filtered])

  // Same-length window immediately BEFORE the current one — powers the period-over-
  // period ▲/▼ deltas on the Overview tiles. Null when there's no comparable prior data.
  const prevAgg = useMemo(() => {
    let start, end
    if (customRange) {
      const s = startDate ? new Date(startDate + 'T00:00:00') : null
      const e = endDate ? new Date(endDate + 'T23:59:59.999') : new Date()
      if (!s) return null
      const span = e - s
      end = new Date(s.getTime() - 1)
      start = new Date(s.getTime() - span - 1)
    } else {
      if (days >= 3650) return null // "All time" has no prior window
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
      end = new Date(cutoff.getTime() - 1)
      start = new Date(cutoff.getTime()); start.setDate(start.getDate() - days)
    }
    const inWin = scoped.filter((r) => {
      const c = r.call || {}
      const d = c.call_date ? new Date(c.call_date + 'T00:00:00') : new Date(r.created_at)
      if (d < start || d > end) return false
      if (brand !== 'all' && c.brand !== brand) return false
      if (agent !== 'all' && agentOf(r) !== agent) return false
      if (topic !== 'all' && !(r.topics || []).includes(topic)) return false
      return true
    })
    const scoredP = inWin.filter(isScored)
    const nP = scoredP.length
    const oppsP = inWin.filter((r) => r.opportunity)
    const bookedP = oppsP.filter((r) => r.outcome === 'Booked')
    if (!inWin.length) return null
    return { n: nP, avg: nP ? scoredP.reduce((s, r) => s + (Number(r.score_pct) || 0), 0) / nP : null, opps: oppsP.length, booked: bookedP.length, conv: oppsP.length ? (bookedP.length / oppsP.length) * 100 : null, winnable: inWin.filter((r) => isMissedOpp(r) && r.winnable).length }
  }, [scoped, days, startDate, endDate, customRange, brand, agent, topic])

  // Prior-period rows for the DATE-ONLY slice (matches `dateFiltered`, which the
  // Scorecards hub uses). Empty when there's no comparable prior window.
  const prevDateRows = useMemo(() => {
    let start, end
    if (customRange) {
      const s = startDate ? new Date(startDate + 'T00:00:00') : null
      const e = endDate ? new Date(endDate + 'T23:59:59.999') : new Date()
      if (!s) return []
      const span = e - s
      end = new Date(s.getTime() - 1); start = new Date(s.getTime() - span - 1)
    } else {
      if (days >= 3650) return []
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
      end = new Date(cutoff.getTime() - 1); start = new Date(cutoff.getTime()); start.setDate(start.getDate() - days)
    }
    return scoped.filter((r) => {
      const c = r.call || {}
      const d = c.call_date ? new Date(c.call_date + 'T00:00:00') : new Date(r.created_at)
      return d >= start && d <= end
    })
  }, [scoped, days, startDate, endDate, customRange])

  const byAgent = useMemo(() => {
    const m = new Map()
    filtered.forEach((r) => {
      const a = agentOf(r); if (!m.has(a)) m.set(a, { name: a, scores: [], improvements: {}, strengths: {}, calls: 0, opps: 0, booked: 0 })
      const o = m.get(a); o.calls++
      if (isScored(r)) o.scores.push(Number(r.score_pct) || 0)
      if (r.opportunity) { o.opps++; if (r.outcome === 'Booked') o.booked++ }
      if (isScored(r)) { (r.improvements || []).forEach((i) => o.improvements[i] = (o.improvements[i] || 0) + 1); (r.strengths || []).forEach((i) => o.strengths[i] = (o.strengths[i] || 0) + 1) }
    })
    return Array.from(m.values()).map((o) => ({
      ...o, avg: o.scores.length ? o.scores.reduce((a, b) => a + b, 0) / o.scores.length : null,
      conv: o.opps ? (o.booked / o.opps) * 100 : null,
      topWeak: Object.entries(o.improvements).sort((a, b) => b[1] - a[1]).slice(0, 3),
      topStrong: Object.entries(o.strengths).sort((a, b) => b[1] - a[1]).slice(0, 3),
    })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
  }, [filtered])

  async function rescore(callId) { setBusy(callId); try { const { error } = await supabase.functions.invoke('callqa-score', { body: { call_id: callId } }); if (error) throw error; await load() } catch (e) { alert('Re-score failed: ' + (e.message || e)) } setBusy('') }
  async function setReviewStatus(reviewId, status) { await supabase.from('ai_qa_reviews').update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reviewId); await load() }
  // Marking reviewed goes through the qa_set_reviewed RPC rather than a direct
  // update: the RLS write policy on ai_qa_reviews is can_manage_qa(), which
  // does NOT include the asc role, so a plain .update() would fail silently for
  // Corinne / Kerri / Sylvia. The RPC is security-definer and gated on
  // can_view_all_scorecards(), which does include asc.
  // Patches local state instead of reloading — load() refetches every review.
  // A background re-score deletes+reinserts a call's review row, so the id the
  // browser is holding can go stale ("QA review <id> not found"). Resolve the
  // CURRENT review id by call_id right before acting so the action can't miss.
  async function liveReviewId(reviewId, callId) {
    if (!callId) return reviewId
    const { data } = await supabase.from('ai_qa_reviews').select('id').eq('call_id', callId).maybeSingle()
    return data?.id || reviewId
  }
  async function setReviewed(reviewId, val, callId) {
    setBusy(reviewId)
    const id = await liveReviewId(reviewId, callId)
    const { data, error } = await supabase.rpc('qa_set_reviewed', { p_review_id: id, p_reviewed: val })
    if (error) { window.alert('Could not update reviewed status: ' + error.message + '\nRefreshing…'); setBusy(''); await load(); return }
    const patch = {
      id,
      reviewed: val,
      reviewed_marked_at: data?.reviewed_marked_at ?? (val ? new Date().toISOString() : null),
      reviewed_marked_by: data?.reviewed_marked_by ?? (val ? user?.id : null),
    }
    setRows((prev) => prev.map((r) => (r.id === reviewId || r.id === id ? { ...r, ...patch } : r)))
    setSelected((sel) => (sel && (sel.id === reviewId || sel.id === id) ? { ...sel, ...patch } : sel))
    setBusy('')
  }
  async function setExcluded(reviewId, val, callId) {
    setBusy(reviewId)
    const id = await liveReviewId(reviewId, callId)
    const { error } = await supabase.from('ai_qa_reviews').update({ excluded: val, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', id)
    if (error) { window.alert('Could not update scoring status: ' + error.message) }
    await load(); setBusy('')
  }
  async function saveAdjustment(reviewId, answers, note) {
    setBusy(reviewId)
    const { earned, max, pct, section_scores } = recomputeReview(answers)
    await supabase.from('ai_qa_reviews').update({ answers, earned_points: earned, max_points: max, score_pct: pct, section_scores, manager_adjusted: true, adjustment_note: note || null, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reviewId)
    await load(); setBusy('')
  }
  async function saveSetting(s) { setBusy('settings'); await supabase.from('ai_qa_settings').upsert(s, { onConflict: 'campaign' }); await load(); setBusy('') }

  async function exportCSV() {
    // `answers` is no longer in the bulk load, so pull it just for the rows being
    // exported (batched to stay under URL limits), then merge for the per-item columns.
    setExporting(true)
    const ansById = {}
    try {
      const ids = filtered.map((r) => r.id)
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400)
        const { data } = await supabase.from('ai_qa_reviews').select('id, answers').in('id', chunk)
        ;(data || []).forEach((r) => { ansById[r.id] = r.answers || {} })
      }
    } catch { /* fall through — per-item columns just come out blank */ }
    const cols = ['call_date', 'brand', 'agent', 'source', 'direction', 'duration_sec', 'disposition',
      'call_class', 'scoreable', 'excluded', 'manager_adjusted', 'reviewed', 'reviewed_at', 'topics',
      'score_pct', 'earned', 'max', 'opportunity', 'outcome', 'not_booked_reason', 'opportunity_context',
      'objections', 'asked_for_booking', 'info_before_pricing', 'set_fee_expectations', 'winnable', 'revenue_tip',
      'sec_greeting_compliance', 'sec_discovery_needs', 'sec_solution_pitch', 'sec_close_next_steps',
      ...RUBRIC_ORDER, ...RUBRIC_ORDER.map((k) => k + '_missed'),
      'strengths', 'improvements', 'coaching_note', 'risk_flags', 'summary', 'recording_url', 'status', 'review_id', 'call_id']
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const lines = [cols.join(',')]
    filtered.forEach((r) => {
      const c = r.call || {}, a = ansById[r.id] || r.answers || {}, ss = r.section_scores || {}
      const row = {
        call_date: c.call_date, brand: c.brand, agent: agentOf(r), source: c.source, direction: c.direction,
        duration_sec: c.duration_seconds, disposition: c.disposition,
        call_class: r.call_class, scoreable: r.scoreable, excluded: r.excluded, manager_adjusted: r.manager_adjusted,
        reviewed: r.reviewed ? 'yes' : 'no', reviewed_at: r.reviewed_marked_at || '', topics: (r.topics || []).join(' | '),
        score_pct: r.score_pct, earned: r.earned_points, max: r.max_points,
        opportunity: r.opportunity, outcome: r.outcome, not_booked_reason: r.not_booked_reason, opportunity_context: r.opportunity_context,
        objections: (r.objections || []).join(' | '), asked_for_booking: r.asked_for_booking, info_before_pricing: r.info_before_pricing,
        set_fee_expectations: r.set_fee_expectations, winnable: r.winnable, revenue_tip: r.revenue_tip,
        sec_greeting_compliance: ss.greeting_compliance?.pct, sec_discovery_needs: ss.discovery_needs?.pct,
        sec_solution_pitch: ss.solution_pitch?.pct, sec_close_next_steps: ss.close_next_steps?.pct,
        strengths: (r.strengths || []).join(' | '), improvements: (r.improvements || []).join(' | '),
        coaching_note: r.coaching_note, risk_flags: (r.risk_flags || []).join(' | '), summary: r.summary,
        recording_url: c.recording_url, status: r.status, review_id: r.id, call_id: c.id,
      }
      RUBRIC_ORDER.forEach((k) => { row[k] = a[k]?.answer || ''; row[k + '_missed'] = (a[k]?.misses || []).join('; ') })
      lines.push(cols.map((k) => esc(row[k])).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `call-qa-export-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url)
    setExporting(false)
  }

  const base = import.meta.env.VITE_SUPABASE_URL || ''
  const inFlight = (pipeline.needs_transcription || 0) + (pipeline.transcribing || 0) + (pipeline.ready || 0) + (pipeline.scoring || 0)
  const todayStr = new Date().toISOString().slice(0, 10)
  // Human-readable summary of the active top-bar filters, shown under the tabs so
  // every view (and its exports) makes clear what range/brand/agent it reflects.
  const rangeLabel = customRange
    ? ((startDate || '…') + ' → ' + (endDate || '…'))
    : (days === 7 ? 'Last 7 days' : days === 30 ? 'Last 30 days' : days === 90 ? 'Last 90 days' : days >= 3650 ? 'All time' : ('Last ' + days + ' days'))
  // Scorecards + Human vs AI run off the date-only row set (portfolio views with
  // their own drill-in), so the Brand/Agent/Topic pickers don't apply there —
  // only Program + Range do. Reflect that honestly so the chips can't contradict
  // the numbers (e.g. "Brand: Omaha Door" over an all-brands aggregate).
  const dateOnlyTab = tab === 'scorecards' || tab === 'humanai'
  const isOverviewTab = tab === 'overview'
  const filterChips = [
    ...(canManage ? [['Program', PROGRAM_LABELS[program] || program]] : []),
    ['Range', rangeLabel],
    ...(dateOnlyTab ? [] : [
      ['Brand', brand === 'all' ? 'All brands' : brand],
      ...(topic !== 'all' ? [['Topic', topic]] : []),
      ...(viewAll ? [['Agent', agent === 'all' ? 'All agents' : agent]] : []),
    ]),
    // Source + Call-type apply client-side (all tabs except the Overview server aggregate).
    ...(!isOverviewTab ? [
      ['Call type', CALLTYPE_LABELS[callType] || callType],
      ...(source !== 'all' ? [['Source', SOURCE_LABELS[source] || source]] : []),
    ] : []),
  ]
  const filterText = filterChips.map(([, v]) => v).join(' · ')
  const TABS = [...(viewAll ? [['dashboard', 'Dashboard']] : []), ['overview', 'Overview'], ...(viewAll ? [['scorecards', 'Scorecards'], ['humanai', 'Human vs AI']] : []), ['opportunities', 'Opportunities'], ['missed', 'Large Missed Opps'], ['conversion', 'Conversion'], ['bookings', 'Bookings & Card'], ['calls', 'Calls'], ['fails', 'Lowest Scores'], ...(canManage ? [['rubric', 'Rubric'], ['settings', 'Settings'], ['import', 'Import']] : [])]

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: '0 auto', color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Call QA <span style={{ color: TEAL }}>(AI)</span></h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Every call scored on the 10-point door rubric, with sales-opportunity outcomes and coaching.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {inFlight > 0 && <Pill bg="#fff8e1" fg="#8d6e00">⏳ {inFlight} in queue</Pill>}
          <button onClick={exportCSV} disabled={exporting} style={{ ...btn('ghost'), opacity: exporting ? 0.6 : 1 }}>{exporting ? 'Preparing…' : '⬇ Export CSV'}</button>
          <button onClick={load} style={btn('ghost')}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', margin: '16px 0' }}>
        {canManage && <Select label="Program" value={program} onChange={(v) => { setProgram(v); setBrand('all'); setAgent('all') }} opts={programOpts} />}
        <Select label="Range" value={days} onChange={(v) => setDays(Number(v))} opts={[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [3650, 'All time']]} disabled={customRange} title={customRange ? 'Using the custom date range below' : undefined} />
        <DateField label="Start date" value={startDate} max={endDate || todayStr} onChange={setStartDate} />
        <DateField label="End date" value={endDate} min={startDate || undefined} max={todayStr} onChange={setEndDate} />
        {customRange && <button onClick={() => { setStartDate(''); setEndDate('') }} style={{ ...btn('ghost'), padding: '7px 10px' }}>✕ Clear dates</button>}
        <Select label="Brand" value={brand} onChange={(v) => { setBrand(v); setAgent('all') }} opts={[['all', 'All brands'], ...brands.map((c) => [c, c])]} />
        <Select label="Topic" value={topic} onChange={setTopic} opts={[['all', 'All topics'], ...topicList.map((t) => [t, t])]} />
        {viewAll && <Select label="Agent" value={agent} onChange={setAgent} opts={[['all', 'All agents'], ...agents.map((a) => [a, a])]} />}
        <Select label="Call type" value={callType} onChange={setCallType} opts={CALLTYPE_OPTS} title="Real conversations excludes voicemail, IVR, wrong-number and spam" />
        {sourceList.length > 1 && <Select label="Source" value={source} onChange={setSource} opts={[['all', 'All sources'], ...sourceList.map((s) => [s, SOURCE_LABELS[s] || s])]} />}
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', padding: '10px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: tab === k ? TEAL : '#64748b', borderBottom: tab === k ? `2px solid ${TEAL}` : '2px solid transparent' }}>{l}</button>)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 14px', fontSize: 12.5 }}>
        <span style={{ color: '#94a3b8', fontWeight: 600 }}>Showing:</span>
        {filterChips.map(([k, v]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '3px 10px' }}>
            <span style={{ color: '#94a3b8' }}>{k}</span>
            <span style={{ color: '#334155', fontWeight: 700 }}>{v}</span>
          </span>
        ))}
        {dateOnlyTab && <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>portfolio view — spans all brands &amp; agents (use the rows/segments to drill in)</span>}
      </div>

      {tab === 'overview' ? (
        ovErr ? <Card style={{ color: '#b71c1c' }}>Error: {ovErr}</Card>
          : ovData ? <Overview agg={ovData.agg} trend={ovData.trend} prevAgg={ovData.prev} />
            : <div style={{ color: '#64748b' }}>Loading…</div>
      ) : loading ? <div style={{ color: '#64748b' }}>Loading…</div> : err ? <Card style={{ color: '#b71c1c' }}>Error: {err}</Card> : (
        <>
          {tab === 'dashboard' && <ManagerDashboard rows={filtered} onOpen={setSelected} onGotoTab={setTab} onPickAgent={(a) => setAgent(a)} />}
          {tab === 'scorecards' && <Scorecards rows={dateFiltered} prevRows={prevDateRows} viewAll={viewAll} onOpen={setSelected} brand={brand} setBrand={setBrand} />}
          {tab === 'humanai' && <HumanVsAI rows={dateFiltered} filterText={filterText} />}
          {tab === 'opportunities' && <Opportunities rows={filtered} agg={agg} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'missed' && <MissedOpps rows={filtered} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'conversion' && <Conversion rows={filtered} prevAgg={prevAgg} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'bookings' && <BookingsCard rows={filtered} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'calls' && <Calls rows={filtered} onOpen={setSelected} viewAll={viewAll} canManage={canManage} onSetReviewed={setReviewed} busy={busy} />}
          {tab === 'fails' && <EpicFails rows={filtered} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'rubric' && canManage && <RubricTab campaigns={settings.map((s) => s.campaign)} />}
        {tab === 'settings' && canManage && <SettingsTab settings={settings} secretKeys={secretKeys} pipeline={pipeline} base={base} onSave={saveSetting} busy={busy} />}
        {tab === 'import' && canManage && <ImportPanel />}
        </>
      )}
      {selected && <Detail row={selected} onClose={() => setSelected(null)} onRescore={rescore} onExclude={setExcluded} onSetReviewed={setReviewed} onAdjust={saveAdjustment} busy={busy} canManage={canManage} meName={meName} userId={user?.id} />}
    </div>
  )
}

function Overview({ agg, trend, prevAgg }) {
  // Window size (days shown at once) + how many days back the window starts (0 = latest)
  const [trendWindow, setTrendWindow] = useState(7)
  const [trendOffset, setTrendOffset] = useState(0)
  const total = trend.length
  const paged = total > trendWindow
  const offset = Math.min(trendOffset, Math.max(0, total - trendWindow)) // clamp when window grows
  const end = Math.max(trendWindow, total - offset)
  const start = Math.max(0, end - trendWindow)
  const visibleTrend = paged ? trend.slice(start, end) : trend
  const canOlder = start > 0
  const canNewer = offset > 0
  const setWindow = (w) => { setTrendWindow(w); setTrendOffset(0) }
  const topReasons = Object.entries(agg.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const topTopics = Object.entries(agg.topics).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const maxTopic = Math.max(1, ...topTopics.map((t) => t[1]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Calls scored" value={agg.n} delta={<Delta now={agg.n} prev={prevAgg?.n} digits={0} suffix="" />} />
        <Tile label="Not scored" value={agg.excluded} sub="wrong # / IVR / excluded" />
        <Tile label="Avg QA score" value={agg.avg == null ? '—' : pct(agg.avg)} color={scoreColor(agg.avg)} delta={<Delta now={agg.avg} prev={prevAgg?.avg} suffix="pp" />} />
        <Tile label="Opportunities" value={agg.opps} sub="calls with a booking/sale chance" delta={<Delta now={agg.opps} prev={prevAgg?.opps} digits={0} suffix="" />} />
        <Tile label="Booked" value={agg.booked} color="#1b5e20" delta={<Delta now={agg.booked} prev={prevAgg?.booked} digits={0} suffix="" />} />
        <Tile label="Conversion" value={agg.conv == null ? '—' : pct(agg.conv)} color={TEAL} sub="booked ÷ opportunities" delta={<Delta now={agg.conv} prev={prevAgg?.conv} suffix="pp" />} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 2, minWidth: 340 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Score by section</div>
          {SECTIONS.map((s) => (
            <BarRow key={s.key} label={s.label} value={pct(agg.sec[s.key])} v={agg.sec[s.key]} color={scoreColor(agg.sec[s.key])} />
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Top “not booked” reasons</div>
          {topReasons.length ? topReasons.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}><span>{k}</span><b>{v}</b></div>
          )) : <div style={{ color: '#64748b', fontSize: 13 }}>No missed opportunities in range.</div>}
        </Card>
      </div>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700 }}>Daily QA score trend <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>· dashed line = trend</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 7, overflow: 'hidden' }}>
              {[7, 14, 30].map((w) => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  style={{ padding: '4px 11px', fontSize: 12.5, fontWeight: 700, border: 'none', borderLeft: w === 7 ? 'none' : '1px solid #e2e8f0', cursor: 'pointer', background: trendWindow === w ? TEAL : '#fff', color: trendWindow === w ? '#fff' : '#475569' }}
                >{w}d</button>
              ))}
            </div>
            {paged && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {visibleTrend.length ? `${fmtDate(visibleTrend[0].d)} – ${fmtDate(visibleTrend[visibleTrend.length - 1].d)}` : ''}
                </span>
                <button
                  onClick={() => setTrendOffset((o) => Math.min(total - trendWindow, o + trendWindow))}
                  disabled={!canOlder}
                  title="Older days"
                  style={trendNavBtn(canOlder)}
                >‹</button>
                <button
                  onClick={() => setTrendOffset((o) => Math.max(0, o - trendWindow))}
                  disabled={!canNewer}
                  title="Newer days"
                  style={trendNavBtn(canNewer)}
                >›</button>
              </div>
            )}
          </div>
        </div>
        {trend.length === 0 ? <div style={{ color: '#64748b' }}>No calls in range.</div> : (
          <TrendChart data={visibleTrend.map((t) => ({ label: fmtDate(t.d), value: t.avg, n: t.n }))} />
        )}
        {paged && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>Showing {visibleTrend.length} of {total} days{canOlder ? '' : ' · earliest'}{canNewer ? '' : ' · most recent'}</div>}
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 14 }}>What calls are about</div>
        {topTopics.length === 0 ? <div style={{ color: '#64748b' }}>No topics yet.</div> : topTopics.map(([t, v]) => (
          <BarRow key={t} label={t} value={v} v={(v / maxTopic) * 100} color={TEAL} />
        ))}
      </Card>
    </div>
  )
}

// ---- Opportunities: every opportunity call → booked/sold or not ----
function Opportunities({ rows, agg, onOpen, viewAll }) {
  const opps = rows.filter((r) => r.opportunity)
  const byBrand = useMemo(() => {
    const m = new Map()
    opps.forEach((r) => { const b = r.call?.brand || '—'; if (!m.has(b)) m.set(b, { brand: b, opps: 0, booked: 0 }); const o = m.get(b); o.opps++; if (r.outcome === 'Booked') o.booked++ })
    return Array.from(m.values()).map((o) => ({ ...o, conv: o.opps ? (o.booked / o.opps) * 100 : 0 })).sort((a, b) => b.opps - a.opps)
  }, [rows])
  const [brandSort, brandOnSort] = useSort()
  const [oppSort, oppOnSort] = useSort()
  const brandAcc = { Brand: (b) => b.brand, Opportunities: (b) => b.opps, Booked: (b) => b.booked, Conversion: (b) => b.conv }
  const oppAcc = { Date: (r) => dnum(r.call?.call_date), Agent: (r) => agentOf(r), Brand: (r) => r.call?.brand, 'What they wanted': (r) => r.opportunity_context, Outcome: (r) => r.outcome, Reason: (r) => r.not_booked_reason, Score: (r) => Number(r.score_pct) }
  const oppView = useTableView(sortRows(opps, oppSort, oppAcc), { searchText: (r) => `${fmtDate(r.call?.call_date)} ${agentOf(r)} ${r.call?.brand || ''} ${r.opportunity_context || ''} ${r.outcome || ''} ${r.not_booked_reason || ''}` })
  if (!opps.length) return <Card style={{ color: '#64748b' }}>No opportunity calls scored in this range yet.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Opportunities" value={agg.opps} />
        <Tile label="Booked / Sold" value={agg.booked} color="#1b5e20" />
        <Tile label="Missed" value={agg.opps - agg.booked} color="#b71c1c" />
        <Tile label="Conversion" value={agg.conv == null ? '—' : pct(agg.conv)} color={TEAL} />
      </div>
      <Card style={{ padding: 0 }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Conversion by brand</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <SortHead cols={['Brand', 'Opportunities', 'Booked', 'Conversion']} sort={brandSort} onSort={brandOnSort} />
          <tbody>{sortRows(byBrand, brandSort, brandAcc).map((b) => (
            <tr key={b.brand} style={{ borderTop: '1px solid #eef2f7' }}>
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{b.brand}</td><td style={{ padding: '8px 12px' }}>{b.opps}</td><td style={{ padding: '8px 12px' }}>{b.booked}</td>
              <td style={{ padding: '8px 12px' }}><span style={{ color: b.conv >= 50 ? '#1b5e20' : b.conv >= 30 ? '#8d6e00' : '#b71c1c', fontWeight: 700 }}>{pct(b.conv)}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Opportunity calls</div>
        <TableToolbar view={oppView} placeholder="Search opportunities…" />
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <SortHead cols={['Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'What they wanted', 'Outcome', 'Reason', 'Score']} sort={oppSort} onSort={oppOnSort} />
          <tbody>{oppView.pageRows.map((r) => {
            const c = r.call || {}; const os = OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.Other
            return (
              <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                {viewAll && <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{agentOf(r)}</td>}
                <td style={{ padding: '8px 12px' }}>{c.brand}</td>
                <td style={{ padding: '8px 12px', maxWidth: 220, color: '#475569' }}>{r.opportunity_context || '—'}</td>
                <td style={{ padding: '8px 12px' }}><Pill bg={os.bg} fg={os.fg}>{r.outcome}</Pill></td>
                <td style={{ padding: '8px 12px', color: '#64748b' }}>{r.outcome === 'Not Booked' ? (r.not_booked_reason || '—') : ''}</td>
                <td style={{ padding: '8px 12px' }}><span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{pct(r.score_pct)}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
        </div>
      </Card>
    </div>
  )
}

// ---- Large Missed Opps: every missed opportunity, ranked by inferred deal size ----
// "Large" is inferred from what the caller wanted (no dollar field exists):
// new-door installs + commercial = Large, most repairs = Medium, info/status = Small.
function MissedOpps({ rows, onOpen, viewAll }) {
  const [highOnly, setHighOnly] = useState(false)
  const allMissed = useMemo(
    () => rows.filter(isMissedOpp).map((r) => ({ r, tier: valueTier(r) })),
    [rows]
  )
  const large = allMissed.filter((x) => x.tier === 3).length
  const medium = allMissed.filter((x) => x.tier === 2).length
  const winnable = allMissed.filter((x) => x.r.winnable).length
  const shown = useMemo(() => {
    return allMissed
      .filter((x) => (highOnly ? x.tier === 3 : true))
      // Biggest first, then recoverable ones, then most recent.
      .sort((a, b) => (b.tier - a.tier)
        || (Number(Boolean(b.r.winnable)) - Number(Boolean(a.r.winnable)))
        || String(b.r.call?.call_date || b.r.created_at).localeCompare(String(a.r.call?.call_date || a.r.created_at)))
  }, [allMissed, highOnly])
  const [missSort, missOnSort] = useSort()
  const missAcc = { Size: (x) => x.tier, Date: (x) => dnum(x.r.call?.call_date), Agent: (x) => agentOf(x.r), Brand: (x) => x.r.call?.brand, 'What they wanted': (x) => x.r.opportunity_context || (x.r.topics || [])[0], Outcome: (x) => x.r.outcome, 'What would have won it': (x) => x.r.revenue_tip || x.r.not_booked_reason, Score: (x) => Number(x.r.score_pct) }
  const missView = useTableView(sortRows(shown, missSort, missAcc), { searchText: ({ r }) => `${fmtDate(r.call?.call_date)} ${agentOf(r)} ${r.call?.brand || ''} ${r.opportunity_context || (r.topics || [])[0] || ''} ${r.outcome || ''}` })

  if (!allMissed.length) return <Card style={{ color: '#64748b' }}>No missed opportunities in this range.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Large missed" value={large} color="#92400e" sub="new-door / commercial" />
        <Tile label="Medium missed" value={medium} color="#075985" sub="repairs / service" />
        <Tile label="Total missed" value={allMissed.length} color="#b71c1c" sub="opps not booked" />
        <Tile label="Winnable" value={winnable} color={TEAL} sub="recoverable with better handling" />
      </div>
      <Card style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#92400e' }}>Biggest deals that got away</div>
            <div style={{ fontSize: 12.5, color: '#9a3412', marginTop: 2 }}>Missed opportunities ranked by inferred deal size. Deal size is estimated from the call topic (there's no dollar value on the call) — new-door installs and commercial jobs rank highest.</div>
          </div>
          <label style={{ fontSize: 13, color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={highOnly} onChange={(e) => setHighOnly(e.target.checked)} /> Large only
          </label>
        </div>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <TableToolbar view={missView} placeholder="Search missed opps…" />
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 66 }} />
            <col style={{ width: 66 }} />
            {viewAll && <col style={{ width: 110 }} />}
            <col style={{ width: 108 }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: 96 }} />
            <col />
            <col style={{ width: 78 }} />
          </colgroup>
          <SortHead cols={['Size', 'Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'What they wanted', 'Outcome', 'What would have won it', 'Score']} sort={missSort} onSort={missOnSort} thStyle={{ fontWeight: 600 }} />
          <tbody>{missView.pageRows.map(({ r, tier }) => {
            const c = r.call || {}; const os = OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.Other; const tm = TIER_META[tier]
            const cell = { padding: '8px 12px', verticalAlign: 'top', whiteSpace: 'normal', overflowWrap: 'anywhere' }
            return (
              <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                <td style={cell}><Pill bg={tm.bg} fg={tm.fg}>{tm.label}</Pill></td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                {viewAll && <td style={cell}>{agentOf(r)}</td>}
                <td style={cell}>{c.brand}</td>
                <td style={{ ...cell, color: '#475569' }}>{r.opportunity_context || (r.topics || [])[0] || '—'}</td>
                <td style={cell}><Pill bg={os.bg} fg={os.fg}>{r.outcome}</Pill></td>
                <td style={{ ...cell, color: TEAL }}>{r.revenue_tip || (r.not_booked_reason ? `Reason: ${r.not_booked_reason}` : '—')}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}><span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>{pct(r.score_pct)}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
        </div>
      </Card>
    </div>
  )
}

// ---- Epic Fails: every scored call ranked worst-first ----
function EpicFails({ rows, onOpen, viewAll }) {
  const scored = useMemo(
    () => rows.filter(isScored).slice().sort((a, b) => (Number(a.score_pct) || 0) - (Number(b.score_pct) || 0)),
    [rows]
  )
  const [failSort, failOnSort] = useSort()
  const failAcc = { Score: (r) => Number(r.score_pct), Date: (r) => dnum(r.call?.call_date), Agent: (r) => agentOf(r), Brand: (r) => r.call?.brand, 'Biggest issue': (r) => topIssue(r), Outcome: (r) => r.outcome }
  const failView = useTableView(sortRows(scored, failSort, failAcc), { searchText: (r) => `${fmtDate(r.call?.call_date)} ${agentOf(r)} ${r.call?.brand || ''} ${topIssue(r)} ${r.outcome || ''}` })
  const under50 = scored.filter((r) => Number(r.score_pct) < 50).length
  const under60 = scored.filter((r) => Number(r.score_pct) < 60).length
  const worst = scored.length ? Number(scored[0].score_pct) : null
  if (!scored.length) return <Card style={{ color: '#64748b' }}>No scored calls in this range.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Lowest score" value={worst == null ? '—' : pct(worst)} color="#b71c1c" />
        <Tile label="Under 50%" value={under50} color="#b71c1c" />
        <Tile label="Under 60%" value={under60} color="#8d6e00" />
        <Tile label="Scored calls" value={scored.length} sub="in this range" />
      </div>
      <Card style={{ background: '#fdecea', border: '1px solid #f5c6cb' }}>
        <div style={{ fontWeight: 700, color: '#b71c1c' }}>Lowest scores first</div>
        <div style={{ fontSize: 12.5, color: '#7f1d1d', marginTop: 2 }}>Every scored call in range, ranked lowest QA score to highest. Start at the top for the calls that need attention most.</div>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <TableToolbar view={failView} placeholder="Search calls…" />
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 74 }} />
            <col style={{ width: 66 }} />
            {viewAll && <col style={{ width: 120 }} />}
            <col style={{ width: 130 }} />
            <col />
            <col style={{ width: 132 }} />
          </colgroup>
          <SortHead cols={[['#', null], 'Score', 'Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'Biggest issue', 'Outcome']} sort={failSort} onSort={failOnSort} thStyle={{ fontWeight: 600 }} />
          <tbody>{failView.pageRows.map((r, i) => {
            const c = r.call || {}; const os = OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.Other
            const cell = { padding: '8px 12px', verticalAlign: 'top', whiteSpace: 'normal', overflowWrap: 'anywhere' }
            return (
              <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                <td style={{ ...cell, color: '#94a3b8', fontWeight: 600 }}>{(failView.page - 1) * failView.pageSize + i + 1}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}><span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{pct(r.score_pct)}{r.manager_adjusted ? ' *' : ''}</span></td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                {viewAll && <td style={cell}>{agentOf(r)}</td>}
                <td style={cell}>{c.brand || '—'}</td>
                <td style={{ ...cell, color: '#b71c1c' }}>{topIssue(r)}</td>
                <td style={cell}>{r.outcome ? <Pill bg={os.bg} fg={os.fg}>{r.outcome}</Pill> : '—'}</td>
              </tr>
            )
          })}</tbody>
        </table>
        </div>
      </Card>
    </div>
  )
}

// ---- Conversion: revenue intelligence (win/loss drivers + leaks) ----
function Conversion({ rows, onOpen, viewAll, prevAgg }) {
  const opps = rows.filter((r) => r.opportunity)
  const booked = opps.filter((r) => r.outcome === 'Booked')
  const lost = opps.filter((r) => r.outcome !== 'Booked')
  const conv = opps.length ? (booked.length / opps.length) * 100 : 0
  const pctOf = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)

  const noAsk = opps.filter((r) => r.asked_for_booking === false).length
  const priceBeforeInfo = rows.filter((r) => r.info_before_pricing === 'no').length
  const noFee = rows.filter((r) => r.set_fee_expectations === 'no').length
  const winnableLost = lost.filter((r) => r.winnable).length
  const priceDiscussed = rows.filter((r) => r.info_before_pricing === 'yes' || r.info_before_pricing === 'no').length
  const feeApplicable = rows.filter((r) => r.set_fee_expectations === 'yes' || r.set_fee_expectations === 'no').length
  const scoredCount = rows.filter(isScored).length

  const objections = {}; opps.forEach((r) => (r.objections || []).forEach((o) => { objections[o] = (objections[o] || 0) + 1 }))
  const topObj = Object.entries(objections).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxObj = Math.max(1, ...topObj.map((t) => t[1]))
  const tags = {}; rows.forEach((r) => (r.improvement_tags || []).forEach((t) => { tags[t] = (tags[t] || 0) + 1 }))
  const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxTag = Math.max(1, ...topTags.map((t) => t[1]))

  const am = new Map()
  opps.forEach((r) => { const a = agentOf(r); if (!am.has(a)) am.set(a, { name: a, opps: 0, booked: 0, asked: 0 }); const o = am.get(a); o.opps++; if (r.outcome === 'Booked') o.booked++; if (r.asked_for_booking) o.asked++ })
  const agents = Array.from(am.values()).map((o) => ({ ...o, conv: pctOf(o.booked, o.opps), askRate: pctOf(o.asked, o.opps) })).sort((a, b) => b.opps - a.opps)

  const winList = lost.filter((r) => r.winnable)
  const [agSort, agOnSort] = useSort()
  const [winSort, winOnSort] = useSort()
  const agAcc = { Agent: (a) => a.name, Opportunities: (a) => a.opps, Booked: (a) => a.booked, Conversion: (a) => a.conv, 'Asked for booking': (a) => a.askRate }
  const winAcc = { Date: (r) => dnum(r.call?.call_date), Agent: (r) => agentOf(r), Brand: (r) => r.call?.brand, 'What they wanted': (r) => r.opportunity_context, 'What would have won it': (r) => r.revenue_tip }
  const agView = useTableView(sortRows(agents, agSort, agAcc), { pageSize: 15, searchText: (a) => a.name })
  const Leak = ({ label, n, sub, of }) => (
    <Card style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#b71c1c' }}>{n}</div>
      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{of ? `${pctOf(n, of)}% of ${sub}` : sub}</div>
    </Card>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* funnel */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Tile label="Opportunities" value={opps.length} delta={<Delta now={opps.length} prev={prevAgg?.opps} digits={0} suffix="" />} />
        <div style={{ color: '#94a3b8', fontSize: 20 }}>→</div>
        <Tile label="Booked / Sold" value={booked.length} color="#1b5e20" delta={<Delta now={booked.length} prev={prevAgg?.booked} digits={0} suffix="" />} />
        <div style={{ color: '#94a3b8', fontSize: 20 }}>→</div>
        <Tile label="Conversion" value={`${conv.toFixed(1)}%`} color={TEAL} sub={`${booked.length} of ${opps.length} opps`} delta={<Delta now={conv} prev={prevAgg?.conv} suffix="pp" />} />
        <Tile label="Winnable lost" value={winnableLost} color="#b71c1c" sub={`${pctOf(winnableLost, lost.length)}% of lost · recoverable`} delta={<Delta now={winnableLost} prev={prevAgg?.winnable} digits={0} suffix="" good="down" />} />
      </div>

      <Card style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Where revenue is leaking</div>
        <div style={{ fontSize: 12.5, color: '#9a3412', marginBottom: 12 }}>The biggest, most fixable gaps across these calls — each one is money left on the table.</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Leak label="Didn't ask for the booking" n={noAsk} of={opps.length} sub="opportunities" />
          <Leak label="Quoted price before collecting info" n={priceBeforeInfo} of={priceDiscussed} sub="calls where price came up" />
          <Leak label="Fee expectations not set" n={noFee} of={feeApplicable} sub="calls where a fee applied" />
          <Leak label="Winnable calls lost" n={winnableLost} of={lost.length} sub="lost opps" />
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>What's stopping the sale (objections)</div>
          {topObj.length === 0 ? <div style={{ color: '#64748b' }}>No objections captured yet.</div> : topObj.map(([o, v]) => (
            <BarRow key={o} label={o} value={<span>{v} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({pctOf(v, opps.length)}% of opps)</span></span>} v={(v / maxObj) * 100} color="#c2410c" />
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Biggest revenue coaching gaps</div>
          {topTags.length === 0 ? <div style={{ color: '#64748b' }}>No coaching data yet.</div> : topTags.map(([t, v]) => (
            <BarRow key={t} label={t} value={<span>{v} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({pctOf(v, scoredCount)}% of calls)</span></span>} v={(v / maxTag) * 100} color={TEAL} />
          ))}
        </Card>
      </div>

      {viewAll && (
        <Card style={{ padding: 0 }}>
          <div style={{ fontWeight: 700, padding: 14 }}>Conversion by agent</div>
          <TableToolbar view={agView} placeholder="Search agents…" />
          <div style={{ overflowX: 'auto', maxHeight: 620 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <SortHead cols={['Agent', 'Opportunities', 'Booked', 'Conversion', 'Asked for booking']} sort={agSort} onSort={agOnSort} />
            <tbody>{agView.pageRows.map((a) => (
              <tr key={a.name} style={{ borderTop: '1px solid #eef2f7' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.name}</td>
                <td style={{ padding: '8px 12px' }}>{a.opps}</td>
                <td style={{ padding: '8px 12px' }}>{a.booked}</td>
                <td style={{ padding: '8px 12px' }}><b style={{ color: a.conv >= 50 ? '#1b5e20' : a.conv >= 30 ? '#8d6e00' : '#b71c1c' }}>{a.conv.toFixed(0)}%</b></td>
                <td style={{ padding: '8px 12px', color: a.askRate < 50 ? '#b71c1c' : '#334155' }}>{a.askRate.toFixed(0)}%</td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Winnable calls you lost <span style={{ color: '#94a3b8', fontWeight: 400 }}>— recoverable with better handling</span></div>
        {winList.length === 0 ? <div style={{ padding: 14, color: '#64748b' }}>None flagged in range.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <SortHead cols={['Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'What they wanted', 'What would have won it']} sort={winSort} onSort={winOnSort} />
            <tbody>{sortRows(winList, winSort, winAcc).map((r) => {
              const c = r.call || {}
              return (
                <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                  {viewAll && <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{agentOf(r)}</td>}
                  <td style={{ padding: '8px 12px' }}>{c.brand}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 180, color: '#475569' }}>{r.opportunity_context || '—'}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 320, color: TEAL }}>{r.revenue_tip || '—'}</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function Calls({ rows, onOpen, viewAll, canManage, onSetReviewed, busy }) {
  // All / Unreviewed / Reviewed lives here rather than in the global filter bar,
  // deliberately: filtering the whole module would skew the Overview averages and
  // the scorecards. This is a worklist filter, not an analytics one.
  const [revFilter, setRevFilter] = useState('all')
  const reviewedCount = rows.filter((r) => r.reviewed).length

  const list = useMemo(() => {
    if (revFilter === 'reviewed') return rows.filter((r) => r.reviewed)
    if (revFilter === 'unreviewed') return rows.filter((r) => !r.reviewed)
    return rows
  }, [rows, revFilter])
  const [callSort, callOnSort] = useSort()
  const callAcc = { Date: (r) => dnum(r.call?.call_date), Agent: (r) => agentOf(r), Brand: (r) => r.call?.brand, 'Opp.': (r) => (r.opportunity ? 1 : 0), Outcome: (r) => r.outcome, Score: (r) => (isScored(r) ? Number(r.score_pct) : null) }
  const callView = useTableView(sortRows(list, callSort, callAcc), { searchText: (r) => `${fmtDate(r.call?.call_date)} ${agentOf(r)} ${r.call?.brand || ''} ${r.outcome || ''} ${(r.topics || [])[0] || ''}` })

  if (!rows.length) return <Card style={{ color: '#64748b' }}>No scored calls in this range.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Show</span>
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            {[['all', `All (${rows.length})`], ['unreviewed', `Unreviewed (${rows.length - reviewedCount})`], ['reviewed', `Reviewed (${reviewedCount})`]].map(([k, lbl], i) => (
              <button key={k} onClick={() => setRevFilter(k)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, border: 'none', borderLeft: i === 0 ? 'none' : '1px solid #e2e8f0', cursor: 'pointer', background: revFilter === k ? TEAL : '#fff', color: revFilter === k ? '#fff' : '#475569' }}>{lbl}</button>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>
            {reviewedCount} of {rows.length} calls in this range marked reviewed
          </div>
        </div>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <TableToolbar view={callView} placeholder="Search calls…" />
        {list.length === 0 ? <div style={{ padding: 14, color: '#64748b' }}>
          {revFilter === 'unreviewed' ? 'Everything in this range has been reviewed. 🎉' : 'No calls match this filter.'}
        </div> : (
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
        <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 13 }}>
          <SortHead cols={[...(canManage ? [['✓', null]] : []), 'Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'Opp.', 'Outcome', 'Score', ['', null]]} sort={callSort} onSort={callOnSort} thStyle={{ padding: '10px 12px' }} />
          <tbody>{callView.pageRows.map((r) => {
            const c = r.call || {}; const os = OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.Other
            return (
              <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer', background: r.reviewed ? '#f8fdf9' : '#fff' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = r.reviewed ? '#f8fdf9' : '#fff'}>
                {canManage && (
                  // stopPropagation so ticking the box doesn't also open the drawer
                  <td style={{ padding: '9px 12px' }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={!!r.reviewed} disabled={busy === r.id}
                      onChange={(e) => onSetReviewed(r.id, e.target.checked, r.call?.id)}
                      title={r.reviewed ? `Reviewed${r.reviewed_marked_at ? ' ' + fmtDate(r.reviewed_marked_at) : ''} — click to unmark` : 'Mark this call reviewed'}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: TEAL }} />
                  </td>
                )}
                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                {viewAll && <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{agentOf(r)}</td>}
                <td style={{ padding: '9px 12px' }}>{c.brand || '—'}{(r.topics || [])[0] && <div style={{ fontSize: 11, color: '#94a3b8' }}>🏷 {r.topics[0]}</div>}</td>
                <td style={{ padding: '9px 12px' }}>{r.opportunity ? '✅' : '—'}</td>
                <td style={{ padding: '9px 12px' }}>{r.outcome ? <Pill bg={os.bg} fg={os.fg}>{r.outcome}</Pill> : '—'}</td>
                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{isScored(r)
                  ? <span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 9px', borderRadius: 8 }}>{r.auto_fail ? 'FAIL' : pct(r.score_pct)}{r.manager_adjusted ? ' *' : ''}</span>
                  : <Pill bg="#f1f5f9" fg="#64748b">{r.excluded ? 'Excluded' : (CLASS_LABEL[r.call_class] || 'Not scored')}</Pill>}
                  {r.reviewed && <span style={{ marginLeft: 6, fontSize: 11, color: '#1b5e20', fontWeight: 600 }}>✓ Reviewed</span>}</td>
                <td style={{ padding: '9px 12px', color: '#94a3b8' }}>›</td>
              </tr>
            )
          })}</tbody>
        </table>
        </div>
        )}
      </Card>
    </div>
  )
}

// ---- Bookings & Card: every booked call, with TWO layers — did the CSR ASK for a card
// to secure the appointment (agent metric), and given they asked, did we COLLECT it (corporate metric) ----
function BookingsCard({ rows, onOpen, viewAll }) {
  const [filter, setFilter] = useState('all') // all | asked | collected | failed
  const booked = useMemo(() => rows.filter((r) => r.outcome === 'Booked'), [rows])
  const asked = booked.filter((r) => r.asked_for_cc === true).length
  const collected = booked.filter((r) => r.collected_cc === true).length
  const askedButNot = booked.filter((r) => r.asked_for_cc === true && r.collected_cc === false).length
  const notAsked = booked.filter((r) => r.asked_for_cc === false).length
  const pending = booked.filter((r) => r.asked_for_cc == null).length
  const askPct = booked.length ? Math.round((asked / booked.length) * 1000) / 10 : null      // Layer A: ask rate (of bookings)
  const collectPct = asked ? Math.round((collected / asked) * 1000) / 10 : null                // Layer B: collect rate (of asks)
  // Sort: asked-first, and within asked, collected-first.
  const rank = (r) => (r.asked_for_cc === true ? (r.collected_cc === true ? 0 : r.collected_cc === false ? 1 : 2) : r.asked_for_cc == null ? 3 : 4)
  const shown = useMemo(() => {
    let base = booked
    if (filter === 'asked') base = booked.filter((r) => r.asked_for_cc === true)
    else if (filter === 'collected') base = booked.filter((r) => r.collected_cc === true)
    else if (filter === 'failed') base = booked.filter((r) => r.asked_for_cc === true && r.collected_cc === false)
    return base.slice().sort((a, b) => (rank(a) - rank(b)) || (new Date(b.call?.call_date || 0) - new Date(a.call?.call_date || 0)))
  }, [booked, filter])
  const [bkSort, bkOnSort] = useSort()
  const bkAcc = { Date: (r) => dnum(r.call?.call_date), Agent: (r) => agentOf(r), Brand: (r) => r.call?.brand, 'What they wanted': (r) => r.opportunity_context || (r.topics || [])[0], 'Card asked': (r) => (r.asked_for_cc === true ? 1 : r.asked_for_cc === false ? 0 : null), Collected: (r) => (r.asked_for_cc !== true ? null : r.collected_cc === true ? 1 : r.collected_cc === false ? 0 : null), 'What the rep said': (r) => r.cc_quote, Score: (r) => (isScored(r) ? Number(r.score_pct) : null) }
  const bkView = useTableView(sortRows(shown, bkSort, bkAcc), { searchText: (r) => `${fmtDate(r.call?.call_date)} ${agentOf(r)} ${r.call?.brand || ''} ${r.opportunity_context || (r.topics || [])[0] || ''} ${r.cc_quote || ''}` })
  if (!booked.length) return <Card style={{ color: '#64748b' }}>No booked calls in this range.</Card>
  const askPill = (v) => v === true
    ? <Pill bg="#e8f5e9" fg="#1b5e20">Yes</Pill>
    : v === false ? <Pill bg="#f1f5f9" fg="#64748b">No</Pill>
      : <Pill bg="#fff8e1" fg="#8d6e00">Pending</Pill>
  // Collect only applies when the rep asked. Otherwise it's N/A.
  const collectPill = (r) => r.asked_for_cc !== true
    ? <span style={{ color: '#cbd5e1' }}>—</span>
    : r.collected_cc === true ? <Pill bg="#ccfbf1" fg="#0f766e">Yes</Pill>
      : r.collected_cc === false ? <Pill bg="#fee2e2" fg="#b71c1c">No</Pill>
        : <Pill bg="#fff8e1" fg="#8d6e00">Pending</Pill>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Bookings" value={booked.length} sub="calls that booked" />
        <Tile label="Card asked" value={asked} color="#1b5e20" sub={askPct == null ? '' : `${askPct}% of bookings · agent metric`} />
        <Tile label="Card collected" value={collected} color="#0f766e" sub={collectPct == null ? 'no asks yet' : `${collectPct}% of asks · corporate metric`} />
        {askedButNot > 0 && <Tile label="Asked, not collected" value={askedButNot} color="#b71c1c" />}
        {pending > 0 && <Tile label="Pending" value={pending} color="#8d6e00" sub="not yet evaluated" />}
      </div>
      <Card style={{ background: '#f0fdfa', border: '1px solid #99f6e4' }}>
        <div style={{ fontWeight: 700, color: TEAL }}>Booked calls — two layers: did we ask for a card, and did we collect it?</div>
        <div style={{ fontSize: 12.5, color: '#334155', marginTop: 2 }}><b>Layer A — Card asked</b> (agent metric): the CSR asks the customer for a credit card <b>to secure or hold the appointment</b> (e.g. “we'll need a card to hold it — no charge until we come out”). Paying for a product/part over the phone, paying an existing invoice, or the customer offering to pay on arrival do <b>not</b> count. <b>Layer B — Card collected</b> (corporate metric): given the rep asked, the customer actually provided the card. An agent gets credit for asking even if the customer declines — collection is a corporate outcome, not an agent ding. Click any row to open the full call — timestamped transcript, recording, scoring and notes.</div>
      </Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexWrap: 'wrap' }}>
        <span style={{ color: '#64748b' }}>Show:</span>
        {[['all', `All bookings (${booked.length})`], ['asked', `Asked (${asked})`], ['collected', `Collected (${collected})`], ['failed', `Asked but not collected (${askedButNot})`]].map(([k, lbl]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid ' + (filter === k ? TEAL : '#e2e8f0'), background: filter === k ? '#f0fdfa' : '#fff', color: filter === k ? TEAL : '#475569', fontWeight: filter === k ? 700 : 500, cursor: 'pointer' }}>{lbl}</button>
        ))}
      </div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <TableToolbar view={bkView} placeholder="Search bookings…" />
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 74 }} />
              {viewAll && <col style={{ width: 120 }} />}
              <col style={{ width: 130 }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 96 }} />
              <col />
              <col style={{ width: 60 }} />
              <col style={{ width: 28 }} />
            </colgroup>
            <SortHead cols={['Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'What they wanted', 'Card asked', 'Collected', 'What the rep said', 'Score', ['', null]]} sort={bkSort} onSort={bkOnSort} thStyle={{ fontWeight: 600 }} />
            <tbody>{bkView.pageRows.map((r) => {
              const c = r.call || {}
              const cell = { padding: '8px 12px', verticalAlign: 'top', whiteSpace: 'normal', overflowWrap: 'anywhere' }
              return (
                <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                  {viewAll && <td style={cell}>{agentOf(r)}</td>}
                  <td style={cell}>{c.brand || '—'}</td>
                  <td style={{ ...cell, color: '#475569' }}>{r.opportunity_context || (r.topics || [])[0] || '—'}</td>
                  <td style={cell}>{askPill(r.asked_for_cc)}</td>
                  <td style={cell}>{collectPill(r)}</td>
                  <td style={{ ...cell, color: '#64748b', fontStyle: (r.cc_quote || r.cc_collected_quote) ? 'italic' : 'normal' }}>{r.asked_for_cc === true ? (r.cc_quote ? `“${r.cc_quote}”` : '—') : ''}{r.asked_for_cc === true && r.cc_collected_quote ? <span style={{ display: 'block', color: '#0f766e', marginTop: 2 }}>{`→ “${r.cc_collected_quote}”`}</span> : null}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}><span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{isScored(r) ? (r.auto_fail ? 'FAIL' : pct(r.score_pct)) : '—'}</span></td>
                  <td style={{ ...cell, color: '#94a3b8' }}>›</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Coaching({ byAgent }) {
  const [open, setOpen] = useState(null)
  if (!byAgent.length) return <Card style={{ color: '#64748b' }}>No data in range.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {byAgent.map((a) => (
        <Card key={a.name} style={{ padding: 0 }}>
          <div onClick={() => setOpen(open === a.name ? null : a.name)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, cursor: 'pointer' }}>
            <div style={{ width: 46, textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(a.avg) }}>{a.avg == null ? '—' : Math.round(a.avg)}</div><div style={{ fontSize: 10, color: '#94a3b8' }}>avg</div></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{a.name}</div><div style={{ fontSize: 12, color: '#64748b' }}>{a.calls} calls · {a.opps} opportunities · {a.booked} booked{a.conv != null ? ` (${pct(a.conv)})` : ''}</div></div>
            <span style={{ color: '#94a3b8' }}>{open === a.name ? '▾' : '›'}</span>
          </div>
          {open === a.name && (
            <div style={{ padding: '0 14px 14px 74px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1b5e20', marginBottom: 6 }}>Strengths</div>
                {a.topStrong.length ? a.topStrong.map(([t, n]) => <div key={t} style={{ fontSize: 13, marginBottom: 4 }}>• {t} <span style={{ color: '#94a3b8' }}>×{n}</span></div>) : <div style={{ fontSize: 13, color: '#64748b' }}>—</div>}
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b71c1c', marginBottom: 6 }}>Weaknesses / coaching focus</div>
                {a.topWeak.length ? a.topWeak.map(([t, n]) => <div key={t} style={{ fontSize: 13, marginBottom: 4 }}>• {t} <span style={{ color: '#94a3b8' }}>×{n}</span></div>) : <div style={{ fontSize: 13, color: '#64748b' }}>Solid across the board.</div>}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

function Detail({ row, onClose, onRescore, onExclude, onSetReviewed, onAdjust, busy, canManage, meName, userId }) {
  const c = row.call || {}
  const os = OUTCOME_STYLE[row.outcome] || OUTCOME_STYLE.Other
  const [transcript, setTranscript] = useState(c.transcript ?? null)
  // Timestamped, speaker-labeled lines from Deepgram (null = not yet fetched,
  // [] = call has no timing data → fall back to the plain transcript).
  const [segments, setSegments] = useState(c.transcript_segments ?? null)
  useEffect(() => {
    let active = true
    if (transcript == null && c.id) supabase.from('ai_qa_calls').select('transcript, transcript_segments').eq('id', c.id).single().then(({ data }) => { if (active) { setTranscript(data?.transcript || ''); setSegments(data?.transcript_segments || []) } })
    return () => { active = false }
  }, [c.id])
  // Per-question answers are lazy-loaded (they're excluded from the list payload
  // to keep the initial load fast). null = not yet fetched.
  const [ans, setAns] = useState(row.answers ?? null)
  const [origAns, setOrigAns] = useState(row.answers ?? null)
  useEffect(() => {
    let active = true
    if (ans == null && row.id) supabase.from('ai_qa_reviews').select('answers').eq('id', row.id).single()
      .then(({ data }) => { if (active) { const v = data?.answers || {}; setAns(v); setOrigAns(v) } })
    return () => { active = false }
  }, [row.id])
  const [note, setNote] = useState(row.adjustment_note || '')
  const [downloading, setDownloading] = useState(false)
  // Build a clean, print-ready one-call report and open it for Save-as-PDF.
  // Answers / transcript / notes may be lazy-loaded, so make sure we have them.
  async function downloadPdf(includeTranscript = false) {
    setDownloading(true)
    try {
      let answers = ans
      if (answers == null && row.id) { const { data } = await supabase.from('ai_qa_reviews').select('answers').eq('id', row.id).single(); answers = data?.answers || {} }
      let tx = transcript, segs = segments
      if (includeTranscript && (tx == null || segs == null) && c.id) { const { data } = await supabase.from('ai_qa_calls').select('transcript, transcript_segments').eq('id', c.id).single(); tx = data?.transcript || ''; segs = data?.transcript_segments || [] }
      let notes = []
      if (c.id) { const { data } = await supabase.from('ai_qa_notes').select('*').eq('call_id', c.id).order('created_at', { ascending: true }); notes = data || [] }
      const html = buildCallReportHtml(row, c, answers || {}, includeTranscript ? (tx || '') : '', notes, includeTranscript, includeTranscript ? (segs || []) : [])
      const w = window.open('', '_blank')
      if (!w) { alert('Please allow pop-ups for this site to download the PDF.'); setDownloading(false); return }
      w.document.write(html); w.document.close(); w.focus()
    } catch (e) { alert('Could not build the report: ' + (e.message || e)) }
    setDownloading(false)
  }
  const dirty = origAns != null && JSON.stringify(ans) !== JSON.stringify(origAns)
  const preview = recomputeReview(ans)
  const notScored = row.scoreable === false || row.excluded
  const setItem = (k, answer) => setAns((p) => ({ ...p, [k]: { ...p[k], answer, na: answer === 'na', points: answer === 'yes' ? (Number(p[k].max) || 0) : 0 } }))
  const items = Object.entries(ans || {}).sort((a, b) => {
    const ia = RUBRIC_ORDER.indexOf(a[0]), ib = RUBRIC_ORDER.indexOf(b[0])
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const shownPct = dirty ? preview.pct : row.score_pct
  const headerText = row.excluded ? 'Excluded' : (row.scoreable === false ? (CLASS_LABEL[row.call_class] || 'Not scored') : (row.auto_fail && !dirty ? 'FAIL' : pct(shownPct)))
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', background: '#f8fafc', color: INK, height: '100%', overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #e2e8f0', padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{agentOf(row)} · {c.brand}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(c.call_date)} · {c.source} · {c.direction} · {fmtDur(c.duration_seconds)}{c.customer_number ? ` · 📞 ${c.customer_number}` : ''}{c.customer_name ? ` · ${c.customer_name}` : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: notScored ? 15 : 26, fontWeight: 800, color: notScored ? '#64748b' : scoreColor(shownPct) }}>{headerText}</div>
            {dirty && !notScored && <div style={{ fontSize: 11, color: '#8d6e00' }}>adjusted preview</div>}
            {row.manager_adjusted && !dirty && <div style={{ fontSize: 11, color: '#8d6e00' }}>manager-adjusted</div>}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
              <button onClick={() => downloadPdf(false)} disabled={downloading} title="One-page summary (no transcript)" style={{ ...btn('ghost'), padding: '2px 8px', opacity: downloading ? 0.6 : 1 }}>{downloading ? 'Preparing…' : '⬇ PDF'}</button>
              <button onClick={() => downloadPdf(true)} disabled={downloading} title="Full report including the transcript" style={{ ...btn('ghost'), padding: '2px 8px', opacity: downloading ? 0.6 : 1 }}>⬇ + Transcript</button>
              <button onClick={onClose} style={{ ...btn('ghost'), padding: '2px 8px' }}>Close ✕</button>
            </div>
          </div>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {notScored && <Card style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}><b style={{ color: '#475569' }}>Not counted toward the agent's score</b> <span style={{ fontSize: 13, color: '#64748b' }}>— {row.excluded ? 'manually excluded' : (CLASS_LABEL[row.call_class] || 'non-conversation')}. Still shown here for reporting.</span></Card>}

          <Card style={{ background: os.bg, border: `1px solid ${os.fg}33` }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>CALL TYPE</div><div style={{ fontWeight: 700 }}>{CLASS_LABEL[row.call_class] || 'Conversation'}</div></div>
              <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>OPPORTUNITY</div><div style={{ fontWeight: 700 }}>{row.opportunity ? 'Yes' : 'No'}</div></div>
              <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>OUTCOME</div><div style={{ fontWeight: 700, color: os.fg }}>{row.outcome || '—'}</div></div>
              {row.outcome === 'Not Booked' && <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>REASON</div><div style={{ fontWeight: 700 }}>{row.not_booked_reason || '—'}</div></div>}
              {row.opportunity_context && <div style={{ flex: 1, minWidth: 180 }}><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>CALLER WANTED</div><div>{row.opportunity_context}</div></div>}
            </div>
            {(row.topics || []).length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{row.topics.map((t, i) => <Pill key={i} bg="#e0f2fe" fg="#075985">🏷 {t}</Pill>)}</div>}
          </Card>

          {(row.opportunity || row.revenue_tip || row.asked_for_cc != null) && (
            <Card style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: '#9a3412' }}>Revenue &amp; conversion</div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>ASKED FOR BOOKING</div><b style={{ color: row.asked_for_booking ? '#1b5e20' : '#b71c1c' }}>{row.asked_for_booking == null ? '—' : (row.asked_for_booking ? 'Yes' : 'No')}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>INFO BEFORE PRICING</div><b>{ynLabel(row.info_before_pricing)}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>FEE EXPECTATIONS SET</div><b>{ynLabel(row.set_fee_expectations)}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>WINNABLE</div><b>{row.winnable == null ? '—' : (row.winnable ? 'Yes' : 'No')}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>CARD ASKED</div><b style={{ color: row.asked_for_cc == null ? '#64748b' : (row.asked_for_cc ? '#1b5e20' : '#b71c1c') }}>{row.asked_for_cc == null ? '—' : (row.asked_for_cc ? 'Yes' : 'No')}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>CARD COLLECTED</div><b style={{ color: row.asked_for_cc !== true ? '#94a3b8' : (row.collected_cc == null ? '#8d6e00' : (row.collected_cc ? '#0f766e' : '#b71c1c')) }}>{row.asked_for_cc !== true ? 'N/A' : (row.collected_cc == null ? 'Pending' : (row.collected_cc ? 'Yes' : 'No'))}</b></div>
              </div>
              {(row.objections || []).length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{row.objections.map((o, i) => <Pill key={i} bg="#fee2e2" fg="#991b1b">⛔ {o}</Pill>)}</div>}
              {row.asked_for_cc && row.cc_quote && <div style={{ marginTop: 10, fontSize: 13.5, color: '#334155' }}><b>Card ask:</b> “{row.cc_quote}”</div>}
              {row.asked_for_cc === true && row.cc_collected_quote && <div style={{ marginTop: 6, fontSize: 13.5, color: '#334155' }}><b>Collected:</b> “{row.cc_collected_quote}”</div>}
              {row.revenue_tip && <div style={{ marginTop: 10, fontSize: 13.5, color: '#7c2d12' }}><b>Biggest revenue lever:</b> {row.revenue_tip}</div>}
            </Card>
          )}

          {(row.risk_flags || []).length > 0 && <Card style={{ background: '#fdecea', border: '1px solid #f5c6cb' }}><b style={{ color: '#b71c1c' }}>⚠ Risk flags</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{row.risk_flags.map((f, i) => <li key={i} style={{ fontSize: 13 }}>{f}</li>)}</ul></Card>}

          <Card><div style={{ fontWeight: 700, marginBottom: 4 }}>Summary</div><div style={{ fontSize: 13.5, color: '#334155' }}>{row.summary || '—'}</div></Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><div style={{ fontWeight: 700 }}>Detailed scoring</div>{canManage && ans != null && <span style={{ fontSize: 12, color: '#94a3b8' }}>managers can change any item ↓</span>}</div>
            {ans == null && <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading detailed scoring…</div>}
            {items.map(([k, a]) => {
              const isNa = a.na || a.answer === 'na'; const isYes = a.answer === 'yes'
              const col = isNa ? '#64748b' : isYes ? '#1b5e20' : '#b71c1c'
              return (
                <div key={k} style={{ padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.label || k}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                      {canManage
                        ? <select value={isNa ? 'na' : (isYes ? 'yes' : 'no')} onChange={(e) => setItem(k, e.target.value)} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #cbd5e1', color: col, fontWeight: 700 }}><option value="yes">✓ Yes</option><option value="no">✗ No</option><option value="na">N/A</option></select>
                        : <span style={{ fontWeight: 700, color: col }}>{isNa ? 'N/A' : (isYes ? '✓' : '✗')}</span>}
                      <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>({isNa ? 0 : a.max} pts)</span>
                    </div>
                  </div>
                  {a.rationale && <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>{a.rationale}</div>}
                  {(a.misses || []).length > 0 && !isNa && !isYes && <div style={{ fontSize: 12, color: '#b71c1c', marginTop: 2 }}>Missed: {a.misses.join(', ')}</div>}
                  {a.evidence && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>“{a.evidence}”</div>}
                </div>
              )
            })}
          </Card>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card style={{ flex: 1, minWidth: 240 }}><div style={{ fontWeight: 700, marginBottom: 6, color: '#1b5e20' }}>What went well</div><ul style={{ margin: 0, paddingLeft: 18 }}>{(row.strengths || []).map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{s}</li>)}</ul></Card>
            <Card style={{ flex: 1, minWidth: 240 }}><div style={{ fontWeight: 700, marginBottom: 6, color: '#b71c1c' }}>Coaching focus (revenue)</div><ul style={{ margin: 0, paddingLeft: 18 }}>{(row.improvements || []).map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{s}</li>)}</ul></Card>
          </div>

          <Card style={{ background: '#f0fdfa', border: '1px solid #99f6e4' }}><div style={{ fontWeight: 700, marginBottom: 4, color: TEAL }}>Coaching note</div><div style={{ fontSize: 13.5, color: '#134e4a' }}>{row.coaching_note || '—'}</div></Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><div style={{ fontWeight: 700 }}>Transcript</div>{c.recording_url && <RecordingBtn callId={c.id} />}</div>
            {transcript == null && segments == null ? <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading transcript…</div>
              : (segments && segments.length)
                ? <TimedTranscript segments={segments} />
                : <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: '#334155', margin: 0, maxHeight: 320, overflowY: 'auto', lineHeight: 1.5 }}>{formatTranscript(transcript) || 'No transcript.'}</pre>}
          </Card>

          <NotesCard callId={c.id} meName={meName} userId={userId} canDelete={canManage} />

          {canManage && (
            <Card>
              {dirty && <input placeholder="Why are you adjusting this? (optional note)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} />}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {dirty && <button disabled={busy === row.id} onClick={() => onAdjust(row.id, ans, note)} style={btn('primary')}>{busy === row.id ? 'Saving…' : `Save adjustments → ${pct(preview.pct)}`}</button>}
                <button disabled={busy === c.id} onClick={() => onRescore(c.id)} style={btn('ghost')}>{busy === c.id ? 'Scoring…' : '↻ Re-score with AI'}</button>
                {row.excluded
                  ? <button disabled={busy === row.id} onClick={() => onExclude(row.id, false, row.call?.id)} style={btn('ghost')}>Include in scoring</button>
                  : <button disabled={busy === row.id} onClick={() => onExclude(row.id, true, row.call?.id)} style={btn('ghost')}>Exclude from scoring</button>}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, paddingTop: 12, borderTop: '1px solid #eef2f7', cursor: 'pointer', fontSize: 13.5 }}>
                <input type="checkbox" checked={!!row.reviewed} disabled={busy === row.id}
                  onChange={(e) => onSetReviewed(row.id, e.target.checked, row.call?.id)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: TEAL }} />
                <span style={{ fontWeight: 600 }}>This call has been reviewed</span>
                {row.reviewed && row.reviewed_marked_at &&
                  <span style={{ color: '#64748b', fontSize: 12 }}>· marked {fmtDate(row.reviewed_marked_at)}</span>}
              </label>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// Notes thread on a single call. Shared between managers and the client portal:
// anyone who can see the call can read and add notes; only managers can delete.
// Backed by ai_qa_notes (RLS-scoped to the caller's client / staff role).
function NotesCard({ callId, meName, userId, canDelete }) {
  const [notes, setNotes] = useState(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const loadNotes = useCallback(async () => {
    if (!callId) return
    const { data } = await supabase.from('ai_qa_notes').select('*').eq('call_id', callId).order('created_at', { ascending: true })
    setNotes(data || [])
  }, [callId])
  useEffect(() => { loadNotes() }, [loadNotes])
  async function add() {
    const text = body.trim(); if (!text || !callId) return
    setSaving(true)
    const { error } = await supabase.from('ai_qa_notes').insert({ call_id: callId, author_id: userId || null, author_name: meName || 'User', body: text })
    setSaving(false)
    if (error) { alert('Could not save note: ' + error.message); return }
    setBody(''); loadNotes()
  }
  async function del(id) {
    setSaving(true)
    await supabase.from('ai_qa_notes').delete().eq('id', id)
    setSaving(false); loadNotes()
  }
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Notes {notes && notes.length > 0 && <span style={{ color: '#94a3b8', fontWeight: 600 }}>({notes.length})</span>}</div>
      {notes == null ? <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</div> : notes.length === 0
        ? <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>No notes yet. Add the first one below.</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{n.author_name || 'User'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{n.created_at ? new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>
                    {canDelete && <button onClick={() => del(n.id)} style={{ border: 'none', background: 'none', color: '#b71c1c', cursor: 'pointer', fontSize: 12, padding: 0 }}>Delete</button>}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, color: '#0f172a', marginTop: 3, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              </div>
            ))}
          </div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note about this call…" rows={2}
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
        <button disabled={saving || !body.trim()} onClick={add} style={{ ...btn('primary'), opacity: saving || !body.trim() ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Add note'}</button>
      </div>
    </Card>
  )
}

// ---- Rubric editor: the criteria the AI scores each call on. Edits write to
// ai_qa_rubric (RLS: managers only) and take effect on the next scoring run.
function RubricTab({ campaigns }) {
  const list = (campaigns && campaigns.length ? Array.from(new Set(campaigns)) : ['garagedoor'])
  const [campaign, setCampaign] = useState(list[0])
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [guidance, setGuidance] = useState('')
  const [guidanceOrig, setGuidanceOrig] = useState('')

  const load = useCallback(async () => {
    setErr(''); setRows(null)
    const [{ data, error }, { data: st }] = await Promise.all([
      supabase.from('ai_qa_rubric').select('*').eq('campaign', campaign).order('sort_order'),
      supabase.from('ai_qa_settings').select('scoring_guidance').eq('campaign', campaign).maybeSingle(),
    ])
    if (error) setErr(error.message); else setRows(data || [])
    const g = st?.scoring_guidance || ''
    setGuidance(g); setGuidanceOrig(g)
  }, [campaign])
  useEffect(() => { load() }, [load])
  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 1800) }

  async function saveRow(r, d) {
    setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, ...d } : x)))
    const { error } = await supabase.from('ai_qa_rubric')
      .update({ label: d.label, section: d.section || null, points: Number(d.points) || 0, allow_na: !!d.allow_na, misses: d.misses || [] })
      .eq('campaign', campaign).eq('key', r.key)
    if (error) { setErr(error.message); load() } else flash('Saved')
  }
  async function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const a = rows[i], b = rows[j]
    const na = { ...a, sort_order: b.sort_order }, nb = { ...b, sort_order: a.sort_order }
    setRows(rows.map((x) => (x.key === a.key ? na : x.key === b.key ? nb : x)).sort((p, q) => p.sort_order - q.sort_order))
    const res = await Promise.all([
      supabase.from('ai_qa_rubric').update({ sort_order: na.sort_order }).eq('campaign', campaign).eq('key', a.key),
      supabase.from('ai_qa_rubric').update({ sort_order: nb.sort_order }).eq('campaign', campaign).eq('key', b.key),
    ])
    const bad = res.find((r) => r.error); if (bad) { setErr(bad.error.message); load() }
  }
  async function addRow() {
    const key = 'c_' + Math.random().toString(36).slice(2, 8)
    const sort_order = rows.length ? Math.max(...rows.map((r) => r.sort_order || 0)) + 1 : 1
    const row = { campaign, key, label: 'New criterion', section: rows[rows.length - 1]?.section || 'general', points: 5, allow_na: true, sort_order, misses: [] }
    setRows((rs) => [...rs, row])
    const { error } = await supabase.from('ai_qa_rubric').insert(row)
    if (error) { setErr(error.message); load() }
  }
  async function removeRow(r) {
    if (!window.confirm(`Delete criterion "${r.label}"? This changes how future calls are scored.`)) return
    setRows((rs) => rs.filter((x) => x.key !== r.key))
    const { error } = await supabase.from('ai_qa_rubric').delete().eq('campaign', campaign).eq('key', r.key)
    if (error) { setErr(error.message); load() }
  }

  async function saveGuidance() {
    const { error } = await supabase.from('ai_qa_settings').upsert({ campaign, scoring_guidance: guidance }, { onConflict: 'campaign' })
    if (error) setErr(error.message); else { setGuidanceOrig(guidance); flash('Guidance saved') }
  }

  const total = (rows || []).reduce((s, r) => s + (Number(r.points) || 0), 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Scoring rubric</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>These are the criteria the AI grades every call against. Edits apply to the next scoring run — use Re-score on a call to apply them immediately.</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {msg && <span style={{ color: '#1b5e20', fontSize: 13 }}>{msg}</span>}
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Campaign{' '}
              <select value={campaign} onChange={(e) => setCampaign(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}>
                {list.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Scoring guidance</div>
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 8 }}>Plain-language instructions the AI follows when scoring this campaign — how strict to be, what counts as pass/fail, phrases to watch for. Applies on the next scoring run.</div>
        <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. Mark Next Steps N/A (don't deduct) when no appointment was booked. Reward confident language; flag phrases like 'I don't know.'"
          style={{ width: '100%', minHeight: 90, resize: 'vertical', border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 13.5, fontFamily: 'inherit', boxSizing: 'border-box' }} />
        {guidance !== guidanceOrig && <div style={{ marginTop: 8 }}><button onClick={saveGuidance} style={btn('primary')}>Save guidance</button></div>}
      </Card>
      {err && <Card style={{ borderColor: '#f5c6cb' }}><span style={{ color: '#b71c1c', fontSize: 13 }}>{err}</span></Card>}
      {rows == null ? <Card><span style={{ color: '#64748b' }}>Loading rubric…</span></Card> : (
        <>
          {rows.map((r, i) => (
            <Card key={r.key}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
                  <button title="Move up" disabled={i === 0} onClick={() => move(i, -1)} style={{ ...btn('ghost'), padding: '2px 7px', color: i === 0 ? '#cbd5e1' : '#475569' }}>▲</button>
                  <button title="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} style={{ ...btn('ghost'), padding: '2px 7px', color: i === rows.length - 1 ? '#cbd5e1' : '#475569' }}>▼</button>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}><RubricRow r={r} onSave={saveRow} onDelete={removeRow} /></div>
              </div>
            </Card>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <button onClick={addRow} style={btn('primary')}>+ Add criterion</button>
            <span style={{ fontSize: 13, color: '#64748b' }}>Total points possible: <b>{total}</b></span>
          </div>
        </>
      )}
      <datalist id="rubric-sections">
        <option value="greeting_compliance" /><option value="discovery_needs" /><option value="solution_pitch" /><option value="close_next_steps" />
      </datalist>
    </div>
  )
}
function RubricRow({ r, onSave, onDelete }) {
  const [d, setD] = useState(r)
  useEffect(() => { setD(r) }, [r.key])
  const dirty = JSON.stringify({ ...d, sort_order: 0 }) !== JSON.stringify({ ...r, sort_order: 0 })
  const missesText = (d.misses || []).join('\n')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} placeholder="What the AI checks for on the call" style={{ ...inp(360), flex: 1, minWidth: 220 }} />
        <label style={{ fontSize: 12, color: '#64748b' }}>Points <input type="number" value={d.points} onChange={(e) => setD({ ...d, points: e.target.value })} style={inp(60)} /></label>
        <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={!!d.allow_na} onChange={(e) => setD({ ...d, allow_na: e.target.checked })} /> Allow N/A</label>
        <input value={d.section || ''} list="rubric-sections" onChange={(e) => setD({ ...d, section: e.target.value })} placeholder="section" style={inp(150)} />
      </div>
      <textarea value={missesText} onChange={(e) => setD({ ...d, misses: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
        placeholder="Miss reasons the AI can cite when the answer is 'No' — one per line (optional)"
        style={{ ...inp('100%'), width: '100%', minHeight: 48, resize: 'vertical', fontFamily: 'inherit' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => onDelete(r)} style={{ ...btn('ghost'), color: '#b71c1c', padding: '4px 10px' }}>Delete</button>
        {dirty && <button onClick={() => onSave(r, d)} style={{ ...btn('primary'), padding: '4px 12px' }}>Save changes</button>}
      </div>
    </div>
  )
}
function SettingsTab({ settings, secretKeys, pipeline, base, onSave, busy }) {
  const required = [['callqa_webhook_secret', 'Inbound webhook secret'], ['anthropic_api_key', 'Claude scoring'], ['deepgram_api_key', 'Deepgram transcription'], ['callrail_api_key', 'CallRail API']]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Pipeline</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {['ingested', 'needs_transcription', 'transcribing', 'ready', 'scoring', 'scored', 'error'].map((s) => (
            <Pill key={s} bg="#f1f5f9" fg="#475569">{s}: {pipeline[s] || 0}</Pill>
          ))}
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Integration status</div>
        {required.map(([k, d]) => { const on = secretKeys.includes(k); return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
            <Pill bg={on ? '#e8f5e9' : '#fdecea'} fg={on ? '#1b5e20' : '#b71c1c'}>{on ? 'SET' : 'MISSING'}</Pill><code style={{ fontSize: 13 }}>{k}</code><span style={{ fontSize: 12, color: '#64748b' }}>{d}</span>
          </div>
        )})}
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Per-campaign automation</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#475569' }}>{['Campaign', 'Enabled', 'Auto-score', 'Min sec', 'Pass %', 'Model', ''].map((h) => <th key={h} style={{ padding: '6px 8px' }}>{h}</th>)}</tr></thead>
          <tbody>{settings.map((s) => <SettingRow key={s.campaign} s={s} onSave={onSave} busy={busy} />)}{!settings.length && <tr><td colSpan={7} style={{ color: '#64748b', padding: 8 }}>No campaigns.</td></tr>}</tbody>
        </table>
      </Card>
    </div>
  )
}
function SettingRow({ s, onSave, busy }) {
  const [d, setD] = useState(s); const dirty = JSON.stringify(d) !== JSON.stringify(s)
  return (
    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.campaign}</td>
      <td style={{ padding: '6px 8px' }}><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /></td>
      <td style={{ padding: '6px 8px' }}><input type="checkbox" checked={d.auto_score} onChange={(e) => setD({ ...d, auto_score: e.target.checked })} /></td>
      <td style={{ padding: '6px 8px' }}><input type="number" value={d.min_duration_seconds} onChange={(e) => setD({ ...d, min_duration_seconds: Number(e.target.value) })} style={inp(60)} /></td>
      <td style={{ padding: '6px 8px' }}><input type="number" value={d.pass_threshold} onChange={(e) => setD({ ...d, pass_threshold: Number(e.target.value) })} style={inp(60)} /></td>
      <td style={{ padding: '6px 8px' }}><input value={d.model} onChange={(e) => setD({ ...d, model: e.target.value })} style={inp(200)} /></td>
      <td style={{ padding: '6px 8px' }}>{dirty && <button disabled={busy === 'settings'} onClick={() => onSave(d)} style={{ ...btn('primary'), padding: '4px 10px' }}>Save</button>}</td>
    </tr>
  )
}

function Select({ label, value, onChange, opts, disabled = false, title }) {
  return (
    <label style={{ fontSize: 12, color: '#64748b', opacity: disabled ? 0.5 : 1 }} title={title}>
      <div style={{ marginBottom: 3, fontWeight: 600 }}>{label}</div>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: disabled ? '#f1f5f9' : '#fff', fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer' }}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  )
}
function DateField({ label, value, onChange, min, max }) {
  return (
    <label style={{ fontSize: 12, color: '#64748b' }}>
      <div style={{ marginBottom: 3, fontWeight: 600 }}>{label}</div>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13, fontFamily: 'inherit', color: value ? '#0f172a' : '#94a3b8' }} />
    </label>
  )
}
function RecordingBtn({ callId }) {
  const [url, setUrl] = useState(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState(false)
  async function loadRec() {
    setLoading(true); setErr(false)
    try {
      const { data, error } = await supabase.functions.invoke('callqa-recording', { body: { call_id: callId } })
      if (error) throw error
      // proxy returns either {url} (signed, seekable) or the audio bytes as a Blob
      if (data && !(data instanceof Blob) && data.url) setUrl(data.url)
      else { const blob = data instanceof Blob ? data : new Blob([data], { type: 'audio/mpeg' }); setUrl(URL.createObjectURL(blob)) }
    } catch (e) { setErr(true) }
    setLoading(false)
  }
  if (url) return <audio controls autoPlay src={url} style={{ height: 34 }} />
  return <button onClick={loadRec} disabled={loading} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 13 }}>{loading ? 'Loading…' : (err ? '↻ Retry' : '▶ Recording')}</button>
}
// ===================== Scorecards hub (3-tier feedback loop) =================
// Executive (portfolio) / Manager (per brand) / Agent (personal) views computed
// live from the loaded reviews. Each tier is exportable to PDF, Excel, and CSV.
// Renders for managers and the client portal (viewAll). Agent-login scoping +
// read-receipts come later; this is the read side of the loop.

const r1 = (v) => (v == null ? '' : Math.round(Number(v) * 10) / 10)
const csvEsc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
function downloadBlob(filename, blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url) }
// sheets = [{ title, sheet, cols:[], rows:[[...]] }]
function exportCSVsheets(filename, sheets) {
  const parts = sheets.map((s) => {
    const lines = [(s.title ? csvEsc(s.title) : ''), s.cols.map(csvEsc).join(','), ...s.rows.map((r) => r.map(csvEsc).join(','))].filter((x) => x !== '')
    return lines.join('\n')
  })
  downloadBlob(filename + '.csv', new Blob([parts.join('\n\n')], { type: 'text/csv;charset=utf-8;' }))
}
let _xlsxPromise = null
function ensureXLSX() {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX)
  if (!_xlsxPromise) _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload = () => resolve(window.XLSX); s.onerror = () => reject(new Error('Could not load the Excel library'))
    document.head.appendChild(s)
  })
  return _xlsxPromise
}
async function exportXLSXsheets(filename, sheets) {
  const XLSX = await ensureXLSX()
  const wb = XLSX.utils.book_new()
  sheets.forEach((s, i) => {
    const ws = XLSX.utils.aoa_to_sheet([s.cols, ...s.rows])
    XLSX.utils.book_append_sheet(wb, ws, String(s.sheet || s.title || ('Sheet' + (i + 1))).slice(0, 31))
  })
  XLSX.writeFile(wb, filename + '.xlsx')
}
function exportPDFsheets(title, subtitle, sheets) {
  const e = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = sheets.map((s) => '<h2>' + e(s.title || '') + '</h2><table><thead><tr>' + s.cols.map((c) => '<th>' + e(c) + '</th>').join('') + '</tr></thead><tbody>' + s.rows.map((r) => '<tr>' + r.map((c) => '<td>' + e(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>').join('')
  const gen = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + e(title) + '</title><style>'
    + '@page{margin:12mm}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:6px 10px;font-size:12px}'
    + 'h1{font-size:18px;margin:0 0 2px;border-bottom:3px solid ' + TEAL + ';padding-bottom:8px}h1 span{color:' + TEAL + '}'
    + '.sub{color:#64748b;font-size:11px;margin:6px 0 4px}h2{font-size:13px;margin:16px 0 6px}'
    + 'table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#f1f5f9;text-align:left;padding:5px 7px;font-size:10.5px;color:#475569}td{padding:4px 7px;border-top:1px solid #eef2f7}tr{page-break-inside:avoid}'
    + '.foot{margin-top:14px;border-top:1px solid #e2e8f0;padding-top:6px;color:#94a3b8;font-size:10px;display:flex;justify-content:space-between}'
    + '.noprint{text-align:center;margin-bottom:10px}.noprint button{background:' + TEAL + ';color:#fff;border:none;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer}'
    + '@media print{.noprint{display:none}body{padding:0}}'
    + '</style></head><body><div class="noprint"><button onclick="window.print()">⬇ Save as PDF / Print</button></div>'
    + '<h1>Call QA <span>(AI)</span> — ' + e(title) + '</h1><div class="sub">' + e(subtitle || '') + '</div>' + body
    + '<div class="foot"><span>Generated ' + e(gen) + '</span><span>Powered by Opsis CX</span></div>'
    + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},300)}</scr' + 'ipt></body></html>'
  const w = window.open('', '_blank'); if (!w) { alert('Please allow pop-ups to export the PDF.'); return }
  w.document.write(html); w.document.close(); w.focus()
}
function ExportBar({ name, title, subtitle, build }) {
  const [busy, setBusy] = useState('')
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button style={{ ...btn('ghost'), padding: '6px 10px' }} onClick={() => exportPDFsheets(title, subtitle, build())}>⬇ PDF</button>
      <button style={{ ...btn('ghost'), padding: '6px 10px', opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={async () => { setBusy('x'); try { await exportXLSXsheets(name, build()) } catch (e) { alert(e.message || e) } setBusy('') }}>{busy ? 'Preparing…' : '⬇ Excel'}</button>
      <button style={{ ...btn('ghost'), padding: '6px 10px' }} onClick={() => exportCSVsheets(name, build())}>⬇ CSV</button>
    </div>
  )
}

// AI CSRs (virtual agents) — audited for quality like anyone else, but never
// coached (there's no 1:1 with an AI) and kept out of the human baseline so they
// don't inflate it. Extend this list as more AI agents come online.
const AI_CSRS = new Set(['Dane', 'Sophia', 'Jason'])
const isAiCsr = (name) => AI_CSRS.has((name || '').trim())

// Aggregate a row set into the scorecard shape (overall + per-brand + per-agent +
// coaching gaps). Pulled out so the current and prior periods use identical math.
function buildScorecardData(rows) {
  const P = (n, d) => (d ? (n / d) * 100 : null)
  const scored = rows.filter(isScored)
  const overall = {
    scored: scored.length,
    avg: scored.length ? scored.reduce((s, r) => s + (Number(r.score_pct) || 0), 0) / scored.length : null,
    opps: rows.filter((r) => r.opportunity).length,
    booked: rows.filter((r) => r.opportunity && r.outcome === 'Booked').length,
    missed: rows.filter(isMissedOpp).length,
    winnable: rows.filter((r) => isMissedOpp(r) && r.winnable).length,
    large: rows.filter((r) => isMissedOpp(r) && valueTier(r) === 3).length,
  }
  const bm = new Map()
  rows.forEach((r) => {
    const b = r.call?.brand || '—'
    if (!bm.has(b)) bm.set(b, { brand: b, scores: [], opps: 0, booked: 0, ccYes: 0, collYes: 0, missed: 0, winnable: 0, large: 0, agents: new Set() })
    const o = bm.get(b); if (isScored(r)) o.scores.push(Number(r.score_pct) || 0)
    if (r.opportunity) { o.opps++; if (r.outcome === 'Booked') { o.booked++; if (r.asked_for_cc === true) o.ccYes++; if (r.collected_cc === true) o.collYes++ } }
    if (isMissedOpp(r)) { o.missed++; if (r.winnable) o.winnable++; if (valueTier(r) === 3) o.large++ }
    const an = agentOf(r); if (an) o.agents.add(an)
  })
  const brands = Array.from(bm.values()).map((o) => ({
    ...o, avg: o.scores.length ? o.scores.reduce((a, b) => a + b, 0) / o.scores.length : null,
    conv: P(o.booked, o.opps), cardRate: P(o.ccYes, o.booked), collectRate: P(o.collYes, o.ccYes), calls: o.scores.length, nAgents: o.agents.size,
  })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))

  const am = new Map()
  rows.forEach((r) => {
    const an = agentOf(r); const b = r.call?.brand || '—'; const k = an + '|||' + b
    if (!am.has(k)) am.set(k, { name: an, brand: b, scores: [], opps: 0, booked: 0, ccYes: 0, collYes: 0, asked: 0, focus: {}, win: {} })
    const o = am.get(k); if (isScored(r)) o.scores.push(Number(r.score_pct) || 0)
    if (r.opportunity) { o.opps++; if (r.outcome === 'Booked') { o.booked++; if (r.asked_for_cc === true) o.ccYes++; if (r.collected_cc === true) o.collYes++ } if (r.asked_for_booking) o.asked++ }
    ;(r.improvement_tags || []).forEach((t) => o.focus[t] = (o.focus[t] || 0) + 1)
    ;(r.strength_tags || []).forEach((t) => o.win[t] = (o.win[t] || 0) + 1)
  })
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map((x) => x[0])
  const agents = Array.from(am.values()).filter((o) => o.scores.length >= 1 && o.name && o.name !== 'Unknown').map((o) => ({
    ...o, avg: o.scores.length ? o.scores.reduce((a, b) => a + b, 0) / o.scores.length : null,
    calls: o.scores.length, conv: P(o.booked, o.opps), askRate: P(o.asked, o.opps), cardRate: P(o.ccYes, o.booked), collectRate: P(o.collYes, o.ccYes),
    topFocus: top(o.focus), topWin: top(o.win), ai: isAiCsr(o.name),
  })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))

  // Coaching gaps are a human-only view (we don't coach AI CSRs).
  const gaps = (brand) => {
    const m = {}
    agents.filter((a) => (!brand || a.brand === brand) && !a.ai).forEach((a) => { (a.topFocus.slice(0, 2)).forEach((t) => m[t] = (m[t] || 0) + 1) })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }
  return { overall, brands, agents, gaps }
}

// Human vs AI CSRs, broken out by brand. AI CSRs (Dane/Sophia/Jason) handle
// after-hours coverage and are audited like anyone else, but kept in their own
// column so the client can see the AI's quality next to the human team without
// the two being blended. Named agents only — unattributed calls aren't tied to a
// CSR, so they sit out of this comparison (same rule the Scorecards tab uses).
// ===========================================================================
// Manager Dashboard — the "log in and see what's wrong" landing view.
// Dashboard → Click → Investigate → Coach. Reuses buildScorecardData, the row
// coaching signals already in ai_qa_reviews, and the existing call-detail drawer
// (via onOpen). Additive: it does not replace any existing tab.
// ===========================================================================
const TAG_LABEL = {
  'Capture complete contact info for follow-up': 'Capture customer contact info',
  'Sell the appointment (book the repair)': 'Ask for / sell the appointment',
  'Secure commitment before ending the call': 'Secure commitment before ending',
  'Set trip/diagnostic/dispatch fee expectations': 'Explain the service fee',
  'Collect info before quoting price': 'Collect info before quoting price',
  'Offer a specific appointment time': 'Offer a specific appointment time',
  'Verify customer & job details': 'Verify customer & job details',
  'Branded greeting & identification': 'Branded greeting & identification',
  'Offer an in-home estimate/quote (installs & sales)': 'Offer an in-home estimate',
  'Overcome the price objection with value': 'Overcome the price objection',
  'Professional tone & active listening': 'Professional tone & listening',
}
const friendlyTag = (t) => TAG_LABEL[t] || t
const CONTACT_TAG = 'Capture complete contact info for follow-up'

function ManagerDashboard({ rows, onOpen, onGotoTab, onPickAgent }) {
  const [focus, setFocus] = useState(null) // { title, calls }
  const data = useMemo(() => buildScorecardData(rows), [rows])
  const k = useMemo(() => {
    const scored = rows.filter(isScored)
    const opps = rows.filter((r) => r.opportunity)
    const booked = opps.filter((r) => r.outcome === 'Booked')
    const lost = opps.filter((r) => r.outcome && r.outcome !== 'Booked')
    const winnable = lost.filter((r) => r.winnable)
    const noAsk = opps.filter((r) => r.asked_for_booking === false)
    const priceBefore = rows.filter((r) => r.info_before_pricing === 'no')
    const noContact = rows.filter((r) => (r.improvement_tags || []).includes(CONTACT_TAG))
    const feeObj = rows.filter((r) => (r.objections || []).some((o) => /price|fee/i.test(o)))
    const humans = data.agents.filter((a) => !a.ai); const ais = data.agents.filter((a) => a.ai)
    const wavg = (arr) => { const c = arr.reduce((s, a) => s + a.calls, 0); return c ? arr.reduce((s, a) => s + (a.avg || 0) * a.calls, 0) / c : null }
    return {
      scored, avg: scored.length ? scored.reduce((s, r) => s + (Number(r.score_pct) || 0), 0) / scored.length : null,
      opps, booked, lost, winnable, noAsk, priceBefore, noContact, feeObj,
      bookingRate: opps.length ? (booked.length / opps.length) * 100 : null,
      winPct: lost.length ? (winnable.length / lost.length) * 100 : null,
      humanAvg: wavg(humans), aiAvg: wavg(ais), aiN: ais.reduce((s, a) => s + a.calls, 0),
    }
  }, [rows, data])

  // Per-agent rollup (human CSRs only), scoped to whatever the top filters already narrowed to.
  const agentRows = useMemo(() => {
    const m = new Map()
    rows.forEach((r) => {
      const a = agentOf(r); if (!a || a === 'Unknown' || isAiCsr(a)) return
      if (!m.has(a)) m.set(a, { name: a, scored: 0, sum: 0, opps: 0, booked: 0, winnable: 0 })
      const o = m.get(a)
      if (isScored(r)) { o.scored++; o.sum += Number(r.score_pct) || 0 }
      if (r.opportunity) { o.opps++; if (r.outcome === 'Booked') o.booked++; else if (r.outcome && r.winnable) o.winnable++ }
    })
    return Array.from(m.values()).filter((o) => o.scored >= 5)
      .map((o) => ({ ...o, avg: o.scored ? o.sum / o.scored : null, booking: o.opps ? (o.booked / o.opps) * 100 : null }))
      .sort((a, b) => b.scored - a.scored)
  }, [rows])

  const priorities = useMemo(() => {
    const m = {}
    rows.forEach((r) => (r.improvement_tags || []).forEach((t) => { m[t] = (m[t] || 0) + 1 }))
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([t, n]) => ({ tag: t, label: friendlyTag(t), n, calls: rows.filter((r) => (r.improvement_tags || []).includes(t)) }))
  }, [rows])

  const queue = useMemo(() => k.winnable.slice()
    .sort((a, b) => (Number(a.score_pct) || 0) - (Number(b.score_pct) || 0)).slice(0, 8), [k])

  const go = (title, calls) => { setFocus({ title, calls }); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const bookBand = (v) => (v == null ? '#94a3b8' : v >= 50 ? '#1b5e20' : v >= 35 ? '#8d6e00' : '#b71c1c')
  const bookBg = (v) => (v == null ? '#f1f5f9' : v >= 50 ? '#e8f5e9' : v >= 35 ? '#fff8e1' : '#fdecea')

  // clickable KPI card
  const KpiCard = ({ label, value, sub, color, onClick }) => (
    <div onClick={onClick} style={{ flex: 1, minWidth: 150, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, cursor: onClick ? 'pointer' : 'default', transition: '.12s' }}
      onMouseEnter={(e) => { if (onClick) { e.currentTarget.style.borderColor = TEAL; e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,118,110,.10)' } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: color || '#0f172a', letterSpacing: '-.5px' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}{onClick ? <span style={{ color: TEAL }}> ›</span> : null}</div>
    </div>
  )
  const CallLine = ({ r }) => {
    const nm = agentOf(r) || 'Unknown'; const sc = Number(r.score_pct)
    const miss = (r.improvement_tags || [])[0]
    return (
      <div onClick={() => onOpen(r)} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 11, marginBottom: 8, cursor: 'pointer' }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = TEAL} onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>{nm}</b><span style={{ color: '#94a3b8', fontSize: 12 }}>— {(r.call || {}).brand || '—'}</span>
          <span style={{ marginLeft: 'auto', background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8, fontSize: 12.5 }}>{r.score_pct == null ? '—' : Math.round(sc) + '%'}</span>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{r.outcome || 'No outcome'}{miss ? ' · ' + friendlyTag(miss) : ''}</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {focus && (
        <Card style={{ padding: 0, overflow: 'hidden', border: `1px solid ${TEAL}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderBottom: '1px solid #eef2f7', flexWrap: 'wrap' }}>
            <button onClick={() => setFocus(null)} style={{ ...btn('ghost'), padding: '5px 10px' }}>‹ Back</button>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{focus.title}</div>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{focus.calls.length.toLocaleString()} calls · click any to open the recording &amp; transcript</span>
            <button onClick={() => onGotoTab('calls')} style={{ ...btn('ghost'), padding: '5px 10px', marginLeft: 'auto' }}>Open in Calls tab →</button>
          </div>
          <div style={{ padding: 14, maxHeight: 460, overflow: 'auto' }}>
            {focus.calls.length ? focus.calls.slice(0, 100).map((r, i) => <CallLine key={r.id || i} r={r} />) : <div style={{ color: '#64748b' }}>No calls match in this range.</div>}
            {focus.calls.length > 100 && <div style={{ color: '#94a3b8', fontSize: 12 }}>Showing first 100 · open the Calls tab for the full list.</div>}
          </div>
        </Card>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Performance snapshot</div>
          <span style={{ color: '#94a3b8', fontSize: 12.5 }}>Every card is clickable — it opens the calls behind the number.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
          <KpiCard label="Average QA Score" value={pct(k.avg)} color={scoreColor(k.avg)} sub={k.scored.length.toLocaleString() + ' scored'} onClick={() => onGotoTab('scorecards')} />
          <KpiCard label="Booking Rate" value={pct(k.bookingRate)} color={TEAL} sub={k.booked.length + ' of ' + k.opps.length + ' opps'} onClick={() => go('Booked opportunities', k.booked)} />
          <KpiCard label="Calls Reviewed" value={k.scored.length.toLocaleString()} sub="real conversations" onClick={() => onGotoTab('calls')} />
          <KpiCard label="Winnable Losses" value={k.winnable.length.toLocaleString()} color="#b71c1c" sub={pct(k.winPct) + ' of lost'} onClick={() => go('Winnable losses', k.winnable)} />
          <KpiCard label="Booking Not Asked For" value={k.noAsk.length.toLocaleString()} color="#b71c1c" sub="opportunities, no ask" onClick={() => go('No booking attempt', k.noAsk)} />
          <KpiCard label="Pricing Before Discovery" value={k.priceBefore.length.toLocaleString()} color="#8d6e00" sub="quoted before qualifying" onClick={() => go('Pricing before discovery', k.priceBefore)} />
          <KpiCard label="Fee / Pricing Objections" value={k.feeObj.length.toLocaleString()} color="#8d6e00" sub="price / fee pushback" onClick={() => go('Fee / pricing objections', k.feeObj)} />
          <KpiCard label="Customer Info Not Captured" value={k.noContact.length.toLocaleString()} color="#b71c1c" sub="no complete contact info" onClick={() => go('Customer info not captured', k.noContact)} />
          {k.aiN > 0 && <KpiCard label="Human vs AI QA" value={pct(k.humanAvg) + ' / ' + pct(k.aiAvg)} color={TEAL} sub={'human vs AI · ' + k.aiN + ' AI calls'} onClick={() => onGotoTab('humanai')} />}
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Quick Views</div>
          <span style={{ color: '#94a3b8', fontSize: 12.5 }}>One click → the applicable calls.</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
          {[
            ['Needs Coaching', k.winnable], ['Winnable Losses', k.winnable],
            ['Lowest Scoring Calls', k.scored.slice().sort((a, b) => (Number(a.score_pct) || 0) - (Number(b.score_pct) || 0))],
            ['Great Calls', k.scored.filter((r) => (Number(r.score_pct) || 0) >= 85 && r.outcome === 'Booked')],
            ['No Booking Attempt', k.noAsk], ['Pricing Objections', k.feeObj],
            ['Customer Info Not Captured', k.noContact],
            ['High Performing Calls', k.scored.filter((r) => (Number(r.score_pct) || 0) >= 85)],
          ].map(([label, calls]) => (
            <button key={label} onClick={() => go(label, calls)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = TEAL; e.currentTarget.style.color = TEAL }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = INK }}>
              {label}<span style={{ fontWeight: 800, color: '#94a3b8', fontSize: 12 }}>{calls.length.toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
        <Card>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Coaching Priorities</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Biggest systemic misses in this view. Click one to see the calls.</div>
          {priorities.map((p, i) => (
            <div key={p.tag} onClick={() => go(p.label, p.calls)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '11px 0', borderTop: i ? '1px solid #eef2f7' : 'none', cursor: 'pointer' }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: TEAL, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>{i + 1}</div>
              <div style={{ fontWeight: 700 }}>{p.label}</div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}><b style={{ fontSize: 18 }}>{p.n.toLocaleString()}</b><span style={{ display: 'block', color: '#94a3b8', fontSize: 11 }}>calls</span></div>
            </div>
          ))}
        </Card>
        <Card>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Coaching Queue <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12.5 }}>— auto-prioritized</span></div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Highest-value calls to review — winnable losses, lowest score first.</div>
          {queue.length ? queue.map((r, i) => {
            const nm = agentOf(r) || 'Unknown'; const tags = (r.improvement_tags || []).slice(0, 3)
            return (
              <div key={r.id || i} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 13, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <b>{nm}</b><span style={{ color: '#64748b', fontSize: 12.5 }}>— {(r.call || {}).brand || '—'}</span>
                  <span style={{ marginLeft: 'auto', background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8, fontSize: 12.5 }}>QA {r.score_pct == null ? '—' : Math.round(Number(r.score_pct)) + '%'}</span>
                  <span style={{ background: '#fdecea', color: '#b71c1c', fontWeight: 800, padding: '2px 7px', borderRadius: 6, fontSize: 11 }}>Winnable loss</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>Outcome: {r.outcome || '—'}</div>
                <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>{tags.map((t, j) => <li key={j} style={{ fontSize: 13, color: '#475569' }}>▸ {friendlyTag(t)}</li>)}</ul>
                <button onClick={() => onOpen(r)} style={{ marginTop: 10, background: TEAL, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>▶ Review Call</button>
              </div>
            )
          }) : <div style={{ color: '#64748b' }}>No winnable losses in this range.</div>}
        </Card>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 800, fontSize: 16, padding: 14 }}>Agent Performance <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12.5 }}>— click an agent to scope the page to them</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569' }}>
              <th style={{ padding: '8px 12px' }}>CSR</th><th style={{ padding: '8px 12px' }}>QA</th><th style={{ padding: '8px 12px' }}>Booking rate</th><th style={{ padding: '8px 12px' }}>Winnable losses</th><th style={{ padding: '8px 12px' }}>Calls</th>
            </tr></thead>
            <tbody>{agentRows.map((a) => (
              <tr key={a.name} onClick={() => onPickAgent(a.name)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f0fdfa'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                <td style={{ padding: '9px 12px', fontWeight: 700, color: TEAL }}>{a.name} ›</td>
                <td style={{ padding: '9px 12px' }}><span style={{ background: scoreBg(a.avg), color: scoreColor(a.avg), fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>{pct(a.avg)}</span></td>
                <td style={{ padding: '9px 12px' }}><span style={{ background: bookBg(a.booking), color: bookBand(a.booking), fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>{pct(a.booking)}</span></td>
                <td style={{ padding: '9px 12px' }}>{a.winnable}</td>
                <td style={{ padding: '9px 12px' }}>{a.scored.toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// Beige/tan for the AI series (was violet). AI_HUE = the soft fill used for bars
// and legend swatches; AI_INK = a darker tan for text labels so they stay legible
// on white (the fill tone is too light to read as text).
const AI_HUE = '#c9a06a'
const AI_INK = '#7a5a2e'
function HaiBar({ color, textColor, label, value, max }) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 44, fontSize: 11.5, color: '#64748b', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: w + '%', background: color, height: '100%', borderRadius: 6, transition: 'width .3s' }} />
      </div>
      <span style={{ width: 52, textAlign: 'right', fontWeight: 700, fontSize: 12.5, color: textColor || color, flexShrink: 0 }}>{pct(value)}</span>
    </div>
  )
}
// AI opportunity samples are thin per brand, so close-rate reads below this many
// opportunities are flagged as low-confidence (shown muted with a ° marker).
const HAI_LOW_N = 30
function HumanVsAI({ rows, filterText }) {
  // Which lens: 'qa' = avg QA score (audit quality), 'close' = conversion
  // (booked ÷ opportunities on scored calls).
  const [metric, setMetric] = useState('qa')
  const data = useMemo(() => buildScorecardData(rows), [rows])
  const byBrand = useMemo(() => {
    const m = new Map()
    data.agents.forEach((a) => {
      if (!m.has(a.brand)) m.set(a.brand, { brand: a.brand, hCalls: 0, hSum: 0, aCalls: 0, aSum: 0, hOpps: 0, hBooked: 0, aOpps: 0, aBooked: 0 })
      const o = m.get(a.brand)
      if (a.ai) { o.aCalls += a.calls; o.aSum += (a.avg || 0) * a.calls; o.aOpps += a.opps || 0; o.aBooked += a.booked || 0 }
      else { o.hCalls += a.calls; o.hSum += (a.avg || 0) * a.calls; o.hOpps += a.opps || 0; o.hBooked += a.booked || 0 }
    })
    return Array.from(m.values()).map((o) => ({
      ...o,
      hAvg: o.hCalls ? o.hSum / o.hCalls : null,
      aAvg: o.aCalls ? o.aSum / o.aCalls : null,
      hClose: o.hOpps ? (o.hBooked / o.hOpps) * 100 : null,
      aClose: o.aOpps ? (o.aBooked / o.aOpps) * 100 : null,
      calls: o.hCalls + o.aCalls,
      qaLift: (o.hCalls && o.aCalls) ? (o.aSum / o.aCalls - o.hSum / o.hCalls) : null,
      closeLift: (o.hOpps && o.aOpps) ? ((o.aBooked / o.aOpps) - (o.hBooked / o.hOpps)) * 100 : null,
    })).sort((a, b) => b.calls - a.calls)
  }, [data])

  const tot = useMemo(() => {
    const t = byBrand.reduce((s, b) => ({ hCalls: s.hCalls + b.hCalls, hSum: s.hSum + b.hSum, aCalls: s.aCalls + b.aCalls, aSum: s.aSum + b.aSum, hOpps: s.hOpps + b.hOpps, hBooked: s.hBooked + b.hBooked, aOpps: s.aOpps + b.aOpps, aBooked: s.aBooked + b.aBooked }), { hCalls: 0, hSum: 0, aCalls: 0, aSum: 0, hOpps: 0, hBooked: 0, aOpps: 0, aBooked: 0 })
    const hAvg = t.hCalls ? t.hSum / t.hCalls : null
    const aAvg = t.aCalls ? t.aSum / t.aCalls : null
    const hClose = t.hOpps ? (t.hBooked / t.hOpps) * 100 : null
    const aClose = t.aOpps ? (t.aBooked / t.aOpps) * 100 : null
    return { ...t, hAvg, aAvg, hClose, aClose,
      qaLift: (hAvg != null && aAvg != null) ? aAvg - hAvg : null,
      closeLift: (hClose != null && aClose != null) ? aClose - hClose : null,
      aiBrands: byBrand.filter((b) => b.aCalls > 0).length }
  }, [byBrand])

  const isQa = metric === 'qa'
  // Per-metric accessors so the tiles, bars, and table share one code path.
  const hVal = (b) => (isQa ? b.hAvg : b.hClose)
  const aVal = (b) => (isQa ? b.aAvg : b.aClose)
  const lift = (b) => (isQa ? b.qaLift : b.closeLift)
  const hN = (b) => (isQa ? b.hCalls : b.hOpps)
  const aN = (b) => (isQa ? b.aCalls : b.aOpps)
  const lowN = (b) => (!isQa && aN(b) > 0 && aN(b) < HAI_LOW_N)   // thin AI close-rate sample
  const nWord = isQa ? 'calls' : 'opps'
  const totH = isQa ? tot.hAvg : tot.hClose
  const totA = isQa ? tot.aAvg : tot.aClose
  const totLift = isQa ? tot.qaLift : tot.closeLift
  const totHN = isQa ? tot.hCalls : tot.hOpps
  const totAN = isQa ? tot.aCalls : tot.aOpps
  // In QA mode color = score band; in Close mode there's no universal "good" band,
  // so use the series colors (teal / tan) instead.
  const valColor = (v, ai) => (isQa ? scoreColor(v) : (v == null ? '#94a3b8' : ai ? AI_INK : TEAL))
  const valBg = (v) => (isQa ? scoreBg(v) : '#f1f5f9')
  const anyLowN = !isQa && byBrand.some((b) => lowN(b))

  // Unattributed bucket = portfolio total (all scored calls) minus the attributed
  // human + AI. These calls have no agent name so they can't sit in a brand/agent
  // row, but they ARE in the headline Avg QA / Conversion — surface them here so
  // the segments reconcile to the portfolio and the average can't look impossible.
  const ov = data.overall
  const un = useMemo(() => {
    const calls = Math.max(0, (ov.scored || 0) - tot.hCalls - tot.aCalls)
    const qaSum = (ov.avg || 0) * (ov.scored || 0) - tot.hSum - tot.aSum
    const opps = Math.max(0, (ov.opps || 0) - tot.hOpps - tot.aOpps)
    const booked = Math.max(0, (ov.booked || 0) - tot.hBooked - tot.aBooked)
    return { calls, opps, avg: calls ? qaSum / calls : null, close: opps ? (booked / opps) * 100 : null }
  }, [ov, tot])
  const unVal = isQa ? un.avg : un.close
  const unN = isQa ? un.calls : un.opps
  const attrN = isQa ? tot.hCalls + tot.aCalls : tot.hOpps + tot.aOpps
  const portN = isQa ? (ov.scored || 0) : (ov.opps || 0)
  const covPct = portN ? Math.round((100 * attrN) / portN) : 100

  const [sort, onSort] = useSort('N', 'desc')
  const acc = { Brand: (b) => b.brand, 'Human n': (b) => hN(b), 'Human val': (b) => hVal(b), 'AI n': (b) => aN(b), 'AI val': (b) => aVal(b), 'AI diff': (b) => lift(b), N: (b) => b.calls }
  const view = useTableView(sortRows(byBrand, sort, acc), { pageSize: 20, searchText: (b) => b.brand })

  const build = () => ([
    { title: 'Human vs AI — summary', sheet: 'Summary', cols: ['Metric', 'Human', 'AI', 'AI diff'], rows: [
      ['Avg QA %', r1(tot.hAvg), r1(tot.aAvg), tot.qaLift == null ? '' : r1(tot.qaLift)],
      ['Scored calls', tot.hCalls, tot.aCalls, ''],
      ['Close rate %', r1(tot.hClose), r1(tot.aClose), tot.closeLift == null ? '' : r1(tot.closeLift)],
      ['Opportunities', tot.hOpps, tot.aOpps, ''],
      ['Booked', tot.hBooked, tot.aBooked, ''],
      ['Brands with AI coverage', tot.aiBrands, '', ''],
    ] },
    { title: 'By brand — Avg QA', sheet: 'QA by brand', cols: ['Brand', 'Human calls', 'Human avg QA %', 'AI calls', 'AI avg QA %', 'AI lift (pp)'],
      rows: byBrand.map((b) => [b.brand, b.hCalls, r1(b.hAvg), b.aCalls, r1(b.aAvg), b.qaLift == null ? '' : r1(b.qaLift)]) },
    { title: 'By brand — Close rate', sheet: 'Close by brand', cols: ['Brand', 'Human opps', 'Human booked', 'Human close %', 'AI opps', 'AI booked', 'AI close %', 'AI diff (pp)', 'AI sample'],
      rows: byBrand.map((b) => [b.brand, b.hOpps, b.hBooked, r1(b.hClose), b.aOpps, b.aBooked, r1(b.aClose), b.closeLift == null ? '' : r1(b.closeLift), lowN(b) ? 'low (<' + HAI_LOW_N + ')' : (b.aOpps ? 'ok' : '')]) },
    { title: 'Coverage / reconciliation', sheet: 'Coverage', cols: ['Bucket', 'Scored calls', 'Avg QA %', 'Opportunities', 'Booked', 'Close rate %'], rows: [
      ['Human', tot.hCalls, r1(tot.hAvg), tot.hOpps, tot.hBooked, r1(tot.hClose)],
      ['AI', tot.aCalls, r1(tot.aAvg), tot.aOpps, tot.aBooked, r1(tot.aClose)],
      ['Unattributed', un.calls, r1(un.avg), un.opps, Math.max(0, (ov.booked || 0) - tot.hBooked - tot.aBooked), r1(un.close)],
      ['Portfolio (all)', ov.scored || 0, r1(ov.avg), ov.opps || 0, ov.booked || 0, r1(ov.opps ? (ov.booked / ov.opps) * 100 : null)],
    ] },
  ])

  const liftStr = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + 'pp')
  const withAi = byBrand.filter((b) => aN(b) > 0 && hN(b) > 0).sort((a, b) => (aVal(b) ?? 0) - (aVal(a) ?? 0))

  const seg = (k, l) => <button key={k} onClick={() => { setMetric(k); onSort('N') }} style={{ border: 'none', background: metric === k ? TEAL : '#fff', color: metric === k ? '#fff' : '#334155', padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 13, boxShadow: metric === k ? 'none' : 'inset 0 0 0 1px #cbd5e1' }}>{l}</button>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Human vs AI CSRs — by brand</div>
        <ExportBar name="callqa-human-vs-ai" title="Human vs AI CSRs" subtitle={(filterText ? filterText + ' — ' : '') + tot.hCalls.toLocaleString() + ' human · ' + tot.aCalls.toLocaleString() + ' AI scored calls'} build={build} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {seg('qa', 'QA score')}{seg('close', 'Close rate')}
        <span style={{ color: '#94a3b8', fontSize: 12.5, marginLeft: 4 }}>
          {isQa ? 'Audit quality on the 10-point rubric.' : 'Conversion = booked ÷ opportunities on scored calls.'}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: '#64748b', marginTop: -6 }}>
        AI CSRs (Dane, Sophia, Jason) handle after-hours coverage and are audited for quality, not coached. The per-brand rows below cover named agents only; calls with no agent name are shown in the Unattributed tile so the totals reconcile to the portfolio.
        {!isQa && ' Close rate here is on the QA-scored sample, not the full lead-to-booked funnel.'}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label={isQa ? 'Human CSRs — avg QA' : 'Human CSRs — close rate'} value={pct(totH)} color={valColor(totH, false)} sub={totHN.toLocaleString() + ' ' + nWord} />
        <Tile label={isQa ? 'AI CSRs — avg QA' : 'AI CSRs — close rate'} value={pct(totA)} color={valColor(totA, true)} sub={totAN.toLocaleString() + ' ' + nWord + (isQa ? ' · audit only' : '')} />
        {unN > 0 && <Tile label={isQa ? 'Unattributed — avg QA' : 'Unattributed — close rate'} value={pct(unVal)} color={isQa ? scoreColor(unVal) : '#64748b'} sub={unN.toLocaleString() + ' ' + nWord + ' · no agent name'} />}
        <Tile label={isQa ? 'AI quality lift' : 'AI close-rate diff'} value={liftStr(totLift)} color={AI_INK} sub={isQa ? 'AI avg minus human avg' : 'AI close minus human close'} />
        <Tile label="Brands with AI coverage" value={tot.aiBrands} sub={'of ' + byBrand.length + ' brands'} />
      </div>

      {unN > 0 && (
        <div style={{ fontSize: 12, color: '#64748b', marginTop: -6 }}>
          {attrN.toLocaleString()} of {portN.toLocaleString()} {nWord} ({covPct}%) are attributed to a named CSR; the other {unN.toLocaleString()} have no agent name and appear only in the portfolio total, not the per-brand rows below.
        </div>
      )}

      {withAi.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>{isQa ? 'Avg QA by brand — human vs AI' : 'Close rate by brand — human vs AI'}</div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: '#475569' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: TEAL }} />Human</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: AI_HUE }} />AI</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {withAi.map((b) => (
              <div key={b.brand}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>{b.brand}{lowN(b) && <span title={'Small AI sample (<' + HAI_LOW_N + ' opportunities) — interpret with caution'} style={{ color: '#b45309', fontWeight: 600 }}> °</span>}</span>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>{hN(b).toLocaleString()} human · {aN(b).toLocaleString()} AI {nWord} · {liftStr(lift(b))}</span>
                </div>
                <HaiBar color={TEAL} label="Human" value={hVal(b)} max={100} />
                <div style={{ height: 4 }} />
                <HaiBar color={AI_HUE} textColor={AI_INK} label="AI" value={aVal(b)} max={100} />
              </div>
            ))}
          </div>
          {anyLowN && <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 10 }}>° Small AI sample (&lt;{HAI_LOW_N} opportunities) — treat the difference as directional, not conclusive.</div>}
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>All brands</div>
        <TableToolbar view={view} placeholder="Search brands…" />
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <SortHead cols={[['Brand', 'Brand'], [isQa ? 'Human calls' : 'Human opps', 'Human n'], [isQa ? 'Human avg QA' : 'Human close', 'Human val'], [isQa ? 'AI calls' : 'AI opps', 'AI n'], [isQa ? 'AI avg QA' : 'AI close', 'AI val'], [isQa ? 'AI lift' : 'AI diff', 'AI diff']]} sort={sort} onSort={onSort} />
            <tbody>{view.pageRows.map((b) => (
              <tr key={b.brand} style={{ borderTop: '1px solid #eef2f7' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{b.brand}{lowN(b) && <span title={'Small AI sample (<' + HAI_LOW_N + ' opportunities)'} style={{ color: '#b45309' }}> °</span>}</td>
                <td style={{ padding: '8px 12px' }}>{hN(b) ? hN(b).toLocaleString() : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={{ padding: '8px 12px' }}>{hN(b) ? <span style={{ background: valBg(hVal(b)), color: valColor(hVal(b), false), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{pct(hVal(b))}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={{ padding: '8px 12px' }}>{aN(b) ? aN(b).toLocaleString() : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={{ padding: '8px 12px' }}>{aN(b) ? <span style={{ background: valBg(aVal(b)), color: valColor(aVal(b), true), fontWeight: 700, padding: '3px 8px', borderRadius: 8, opacity: lowN(b) ? 0.55 : 1 }}>{pct(aVal(b))}</span> : <span style={{ color: '#cbd5e1' }}>no AI</span>}</td>
                <td style={{ padding: '8px 12px', fontWeight: 700, color: lift(b) == null ? '#cbd5e1' : lift(b) >= 0 ? '#1b5e20' : '#b71c1c', opacity: lowN(b) ? 0.55 : 1 }}>{liftStr(lift(b))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {anyLowN && <div style={{ fontSize: 11.5, color: '#b45309', padding: '0 14px 12px' }}>° Small AI sample (&lt;{HAI_LOW_N} opportunities) — AI close rate shown muted; treat as directional.</div>}
      </Card>
    </div>
  )
}

function Scorecards({ rows, prevRows, viewAll, onOpen, brand: topBrand, setBrand: setTopBrand }) {
  const [tier, setTier] = useState('exec')
  const [agentKey, setAgentKey] = useState('')
  const data = useMemo(() => buildScorecardData(rows), [rows])
  const prevData = useMemo(() => buildScorecardData(prevRows || []), [prevRows])
  const hasPrev = (prevRows || []).length > 0
  const prevBrand = useMemo(() => { const m = {}; (prevData.brands || []).forEach((b) => { m[b.brand] = b }); return m }, [prevData])
  const prevAgentMap = useMemo(() => { const m = {}; (prevData.agents || []).forEach((a) => { m[a.name + '|||' + a.brand] = a }); return m }, [prevData])

  const seg = (k, l) => <button key={k} onClick={() => setTier(k)} style={{ border: 'none', background: tier === k ? TEAL : '#fff', color: tier === k ? '#fff' : '#334155', padding: '8px 16px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 13, boxShadow: tier === k ? 'none' : 'inset 0 0 0 1px #cbd5e1' }}>{l}</button>

  // Selected brand/agent fall back to the top-ranked one until the user picks
  // (or drills in via a click).
  // Single source of truth for brand = the top filter bar. When it's on "All
  // brands" the Manager tier falls back to the top-ranked brand; picking a brand
  // up top (or clicking a brand row in Executive) drives this view.
  const brand = (topBrand && topBrand !== 'all' && data.brands.some((x) => x.brand === topBrand)) ? topBrand : (data.brands[0]?.brand || '')
  const aKey = (agentKey && data.agents.some((x) => (x.name + '|||' + x.brand) === agentKey)) ? agentKey : (data.agents[0] ? data.agents[0].name + '|||' + data.agents[0].brand : '')
  const goBrand = (b) => { if (setTopBrand) setTopBrand(b); setTier('mgr') }
  const goAgent = (name, br) => { setAgentKey(name + '|||' + br); setTier('agent') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {seg('exec', 'Executive')}{seg('mgr', 'Manager')}{seg('agent', 'Agent')}
        <span style={{ color: '#94a3b8', fontSize: 12.5, marginLeft: 4 }}>Click a brand or agent to drill in · export any view as PDF, Excel, or CSV.</span>
      </div>
      {tier === 'exec' && <ScExec data={data} prevOverall={hasPrev ? prevData.overall : null} onBrand={goBrand} />}
      {tier === 'mgr' && <ScMgr data={data} prevBrand={hasPrev ? prevBrand : null} prevAgent={hasPrev ? prevAgentMap : null} brand={brand} onAgent={goAgent} onOpen={onOpen} />}
      {tier === 'agent' && <ScAgent data={data} prevAgent={hasPrev ? prevAgentMap : null} rows={rows} aKey={aKey} setKey={setAgentKey} onOpen={onOpen} />}
    </div>
  )
}

function ScExec({ data, prevOverall, onBrand }) {
  const o = data.overall; const cv = P100(o.booked, o.opps)
  const prevCv = prevOverall ? P100(prevOverall.booked, prevOverall.opps) : null
  const gaps = data.gaps(null).slice(0, 8)
  const gmax = Math.max(1, ...gaps.map((g) => g[1]))
  const [exSort, exOnSort] = useSort()
  const exAcc = { Brand: (b) => b.brand, Calls: (b) => b.calls, 'Avg QA': (b) => b.avg, Conversion: (b) => b.conv, 'Card asked': (b) => b.cardRate, 'Card collected': (b) => b.collectRate, Missed: (b) => b.missed, 'Large missed': (b) => b.large }
  const exView = useTableView(sortRows(data.brands, exSort, exAcc), { pageSize: 15, searchText: (b) => b.brand })
  const build = () => ([
    { title: 'Portfolio summary', sheet: 'Summary', cols: ['Metric', 'Value'], rows: [
      ['Calls scored', o.scored], ['Avg QA %', r1(o.avg)], ['Opportunities', o.opps], ['Booked', o.booked],
      ['Conversion %', r1(cv)], ['Missed opportunities', o.missed], ['Winnable lost', o.winnable], ['Large missed opps', o.large],
    ] },
    { title: 'Brand ranking', sheet: 'Brands', cols: ['Brand', 'Calls', 'Avg QA %', 'Conversion %', 'Card asked %', 'Card collected %', 'Missed', 'Large missed', 'Agents'], rows: data.brands.map((b) => [b.brand, b.calls, r1(b.avg), r1(b.conv), r1(b.cardRate), r1(b.collectRate), b.missed, b.large, b.nAgents]) },
    { title: 'Systemic coaching gaps', sheet: 'Gaps', cols: ['Coaching gap', 'Agents affected'], rows: data.gaps(null).map((g) => [g[0], g[1]]) },
  ])
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Executive — portfolio</div>
        <ExportBar name="callqa-executive-scorecard" title="Executive Scorecard" subtitle={'All brands · ' + o.scored + ' calls scored'} build={build} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Calls scored" value={o.scored} sub="all brands" delta={<Delta now={o.scored} prev={prevOverall?.scored} digits={0} suffix="" />} />
        <Tile label="Avg QA score" value={pct(o.avg)} color={scoreColor(o.avg)} delta={<Delta now={o.avg} prev={prevOverall?.avg} suffix="pp" />} />
        <Tile label="Conversion" value={pct(cv)} color={TEAL} sub={o.booked + ' of ' + o.opps + ' opps'} delta={<Delta now={cv} prev={prevCv} suffix="pp" />} />
        <Tile label="Winnable lost" value={o.winnable} color="#b71c1c" delta={<Delta now={o.winnable} prev={prevOverall?.winnable} digits={0} suffix="" good="down" />} />
        <Tile label="Large missed opps" value={o.large} color="#92400e" sub="install / commercial" delta={<Delta now={o.large} prev={prevOverall?.large} digits={0} suffix="" good="down" />} />
      </div>
      {(() => {
        const humans = data.agents.filter((a) => !a.ai); const ais = data.agents.filter((a) => a.ai)
        const sumW = (arr) => arr.reduce((s, a) => s + (a.avg || 0) * a.calls, 0)
        const cnt = (arr) => arr.reduce((s, a) => s + a.calls, 0)
        const wavg = (arr) => { const c = cnt(arr); return c ? sumW(arr) / c : null }
        const hc = cnt(humans); const ac = cnt(ais)
        // Distinct people, not name×brand rows (an agent working 3 brands is 1 CSR).
        const nH = new Set(humans.map((a) => a.name)).size; const nA = new Set(ais.map((a) => a.name)).size
        // Unattributed = scored calls with no agent name. They're inside the headline
        // Avg QA but not in Human/AI, so they must be shown for the three to add up —
        // otherwise the portfolio average can sit below both visible segments.
        const unc = Math.max(0, (o.scored || 0) - hc - ac)
        const unAvg = unc ? ((o.avg || 0) * (o.scored || 0) - sumW(humans) - sumW(ais)) / unc : null
        const attrPct = o.scored ? Math.round((100 * (hc + ac)) / o.scored) : 100
        if (!ais.length && !unc) return null
        return (
          <Card style={{ background: '#f8fafc' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Human vs AI performance <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12.5 }}>— AI CSRs are audited for quality, not coached</span></div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Tile label="Human CSRs — avg QA" value={pct(wavg(humans))} color={scoreColor(wavg(humans))} sub={nH + (nH === 1 ? ' CSR · ' : ' CSRs · ') + hc.toLocaleString() + ' scored calls'} />
              <Tile label="AI CSRs — avg QA" value={pct(wavg(ais))} color={scoreColor(wavg(ais))} sub={nA + (nA === 1 ? ' AI agent · ' : ' AI agents · ') + ac.toLocaleString() + ' scored calls · audit only'} />
              {unc > 0 && <Tile label="Unattributed — avg QA" value={pct(unAvg)} color={scoreColor(unAvg)} sub={unc.toLocaleString() + ' scored calls · no agent name'} />}
            </div>
            {unc > 0 && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>
                {(hc + ac).toLocaleString()} of {(o.scored || 0).toLocaleString()} scored calls ({attrPct}%) are attributed to a CSR. The remaining {unc.toLocaleString()} have no agent name in the source data, so they land in the portfolio Avg QA ({pct(o.avg)}) but not in the Human/AI split — which is why the portfolio number can fall below both. Attribution improves as agent identity is captured (mainly a CallRail gap).
              </div>
            )}
          </Card>
        )
      })()}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Brand ranking</div>
        <TableToolbar view={exView} placeholder="Search brands…" />
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <SortHead cols={['Brand', 'Calls', 'Avg QA', 'Conversion', 'Card asked', 'Card collected', 'Missed', 'Large missed']} sort={exSort} onSort={exOnSort} />
          <tbody>{exView.pageRows.map((b) => (
            <tr key={b.brand} onClick={() => onBrand(b.brand)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
              <td style={{ padding: '8px 12px', fontWeight: 600, color: TEAL }}>{b.brand} <span style={{ color: '#cbd5e1' }}>›</span></td>
              <td style={{ padding: '8px 12px' }}>{b.calls}</td>
              <td style={{ padding: '8px 12px' }}><span style={{ background: scoreBg(b.avg), color: scoreColor(b.avg), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{pct(b.avg)}</span></td>
              <td style={{ padding: '8px 12px', fontWeight: 700, color: b.conv >= 50 ? '#1b5e20' : b.conv >= 35 ? '#8d6e00' : '#b71c1c' }}>{pct(b.conv)}</td>
              <td style={{ padding: '8px 12px', fontWeight: 700, color: TEAL }} title={b.cardRate == null ? 'no bookings in range' : (b.ccYes + ' of ' + b.booked + ' bookings asked')}>{pct(b.cardRate)}</td>
              <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f766e' }} title={b.collectRate == null ? 'no card asks in range' : (b.collYes + ' of ' + b.ccYes + ' asks collected')}>{pct(b.collectRate)}</td>
              <td style={{ padding: '8px 12px' }}>{b.missed}</td>
              <td style={{ padding: '8px 12px', color: '#92400e', fontWeight: 700 }}>{b.large}</td>
            </tr>
          ))}</tbody>
        </table>
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Biggest systemic coaching gaps <span style={{ color: '#94a3b8', fontWeight: 400 }}>— across all brands</span></div>
        {gaps.map((g) => (
          <BarRow key={g[0]} label={g[0]} value={`${g[1]} agents`} v={(g[1] / gmax) * 100} color="#c2410c" />
        ))}
      </Card>
    </>
  )
}

function ScMgr({ data, prevBrand, prevAgent, brand, onAgent, onOpen }) {
  const b = data.brands.find((x) => x.brand === brand) || data.brands[0]
  const prevB = prevBrand ? prevBrand[b?.brand] : null
  const roster = data.agents.filter((a) => a.brand === (b?.brand) && !a.ai)   // coachable humans
  const aiRoster = data.agents.filter((a) => a.brand === (b?.brand) && a.ai)  // audit-only AI
  const [mgrSort, mgrOnSort] = useSort()
  const [aiSort, aiOnSort] = useSort()
  const mgrAcc = { Agent: (a) => a.name, Calls: (a) => a.calls, 'Avg QA': (a) => a.avg, Conversion: (a) => a.conv, 'Asked for booking': (a) => a.askRate, 'Card asked': (a) => a.cardRate, 'Coaching focus': (a) => a.topFocus[0] }
  const mgrView = useTableView(sortRows(roster, mgrSort, mgrAcc), { pageSize: 15, searchText: (a) => a.name })
  const gaps = data.gaps(b?.brand).slice(0, 6); const gmax = Math.max(1, ...gaps.map((g) => g[1]))
  const build = () => ([
    { title: (b.brand + ' — team summary'), sheet: 'Summary', cols: ['Metric', 'Value'], rows: [
      ['Brand', b.brand], ['Calls scored', b.calls], ['Avg QA %', r1(b.avg)], ['Conversion %', r1(b.conv)], ['Card asked on bookings %', r1(b.cardRate)],
      ['Missed opportunities', b.missed], ['Large missed opps', b.large], ['Agents', b.nAgents],
    ] },
    { title: 'Agent leaderboard', sheet: 'Agents', cols: ['#', 'Agent', 'Calls', 'Avg QA %', 'Conversion %', 'Asked for booking %', 'Card asked %', 'Coaching focus'], rows: roster.map((a, i) => [i + 1, a.name, a.calls, r1(a.avg), r1(a.conv), r1(a.askRate), r1(a.cardRate), a.topFocus[0] || '']) },
    { title: 'Team coaching gaps', sheet: 'Gaps', cols: ['Coaching gap', 'Agents affected'], rows: data.gaps(b?.brand).map((g) => [g[0], g[1]]) },
  ])
  if (!b) return <Card style={{ color: '#64748b' }}>No brand data in range.</Card>
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{b.brand} <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: 13 }}>— team</span></div>
        <ExportBar name={'callqa-manager-' + b.brand.replace(/\W+/g, '-').toLowerCase()} title={b.brand + ' — Team Scorecard'} subtitle={b.calls + ' calls · ' + b.nAgents + ' agents'} build={build} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Team avg QA" value={pct(b.avg)} color={scoreColor(b.avg)} sub={b.calls + ' calls'} delta={<Delta now={b.avg} prev={prevB?.avg} suffix="pp" />} />
        <Tile label="Conversion" value={pct(b.conv)} color={TEAL} sub={b.booked + ' of ' + b.opps} delta={<Delta now={b.conv} prev={prevB?.conv} suffix="pp" />} />
        <Tile label="Card asked" value={pct(b.cardRate)} color={TEAL} sub={b.cardRate == null ? 'no bookings' : (b.ccYes + ' of ' + b.booked + ' bookings')} delta={<Delta now={b.cardRate} prev={prevB?.cardRate} suffix="pp" />} />
        <Tile label="Winnable lost" value={b.winnable} color="#b71c1c" sub="recoverable" delta={<Delta now={b.winnable} prev={prevB?.winnable} digits={0} suffix="" good="down" />} />
        <Tile label="Large missed" value={b.large} color="#92400e" sub="install / commercial" delta={<Delta now={b.large} prev={prevB?.large} digits={0} suffix="" good="down" />} />
      </div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Agent leaderboard</div>
        <TableToolbar view={mgrView} placeholder="Search agents…" />
        <div style={{ overflowX: 'auto', maxHeight: 620 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <SortHead cols={[['#', null], 'Agent', 'Calls', 'Avg QA', 'Conversion', 'Asked for booking', 'Card asked', 'Coaching focus']} sort={mgrSort} onSort={mgrOnSort} />
          <tbody>{mgrView.pageRows.map((a, i) => (
            <tr key={a.name} onClick={() => onAgent(a.name, a.brand)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
              <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{(mgrView.page - 1) * mgrView.pageSize + i + 1}</td>
              <td style={{ padding: '8px 12px', fontWeight: 600, color: TEAL }}>{a.name} <span style={{ color: '#cbd5e1' }}>›</span></td>
              <td style={{ padding: '8px 12px' }}>{a.calls}</td>
              <td style={{ padding: '8px 12px' }}><span style={{ background: scoreBg(a.avg), color: scoreColor(a.avg), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{pct(a.avg)}</span></td>
              <td style={{ padding: '8px 12px', fontWeight: 700, color: a.conv >= 50 ? '#1b5e20' : a.conv >= 35 ? '#8d6e00' : '#b71c1c' }}>{pct(a.conv)}</td>
              <td style={{ padding: '8px 12px', color: a.askRate < 50 ? '#b71c1c' : '#334155' }}>{pct(a.askRate)}</td>
              <td style={{ padding: '8px 12px', color: '#334155' }}>{pct(a.cardRate)}</td>
              <td style={{ padding: '8px 12px', maxWidth: 240, color: '#475569' }}>{a.topFocus[0] || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        </div>
      </Card>
      {aiRoster.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ fontWeight: 700, padding: 14 }}>AI CSRs <span style={{ color: '#94a3b8', fontWeight: 400 }}>— audited for quality, not coached</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <SortHead cols={['Agent', 'Calls', 'Avg QA', 'Conversion', 'Asked for booking', 'Card asked']} sort={aiSort} onSort={aiOnSort} />
            <tbody>{sortRows(aiRoster, aiSort, mgrAcc).map((a) => (
              <tr key={a.name} onClick={() => onAgent(a.name, a.brand)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                <td style={{ padding: '8px 12px', fontWeight: 600, color: TEAL }}>{a.name} <Pill bg="#ede9fe" fg="#6d28d9">AI</Pill> <span style={{ color: '#cbd5e1' }}>›</span></td>
                <td style={{ padding: '8px 12px' }}>{a.calls}</td>
                <td style={{ padding: '8px 12px' }}><span style={{ background: scoreBg(a.avg), color: scoreColor(a.avg), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{pct(a.avg)}</span></td>
                <td style={{ padding: '8px 12px', fontWeight: 700, color: a.conv >= 50 ? '#1b5e20' : a.conv >= 35 ? '#8d6e00' : '#b71c1c' }}>{pct(a.conv)}</td>
                <td style={{ padding: '8px 12px', color: '#334155' }}>{pct(a.askRate)}</td>
                <td style={{ padding: '8px 12px', color: '#334155' }}>{pct(a.cardRate)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Top team coaching gaps <span style={{ color: '#94a3b8', fontWeight: 400 }}>— coach the pattern (human CSRs)</span></div>
        {gaps.length === 0 ? <div style={{ color: '#64748b' }}>No data.</div> : gaps.map((g) => (
          <BarRow key={g[0]} label={g[0]} value={`${g[1]} agents`} v={(g[1] / gmax) * 100} color="#c2410c" />
        ))}
      </Card>
    </>
  )
}

function ScAgent({ data, prevAgent, rows, aKey, setKey, onOpen }) {
  const opts = [...data.agents].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name))
  const a = data.agents.find((x) => (x.name + '|||' + x.brand) === aKey) || opts[0]
  const [acSort, acOnSort] = useSort()
  const acAcc = { Date: (r) => dnum(r.call?.call_date), Score: (r) => (isScored(r) ? Number(r.score_pct) : null), 'Opp.': (r) => (r.opportunity ? 1 : 0), Outcome: (r) => r.outcome, Topic: (r) => (r.topics || [])[0] }
  if (!a) return <Card style={{ color: '#64748b' }}>No agent data in range.</Card>
  const prevA = prevAgent ? prevAgent[a.name + '|||' + a.brand] : null
  const isAi = a.ai
  const win = a.topWin[0] || '—'; const f0 = a.topFocus[0] || '—'; const f1 = a.topFocus[1]
  // This agent's own scored calls — clickable through to the full Detail drawer
  // (10-section breakdown, transcript, recording playback).
  const myCalls = (rows || []).filter((r) => agentOf(r) === a.name && (r.call?.brand || '—') === a.brand)
    .slice().sort((x, y) => String(y.call?.call_date || y.created_at).localeCompare(String(x.call?.call_date || x.created_at)))
  const build = () => ([
    { title: a.name + ' (' + a.brand + ') — scorecard', sheet: 'Scorecard', cols: ['Metric', 'Value'], rows: [
      ['Agent', a.name], ['Brand', a.brand], ['Calls scored', a.calls], ['Avg QA %', r1(a.avg)],
      ['Conversion %', r1(a.conv)], ['Asked for booking %', r1(a.askRate)],
      ['What they do best', win], ['Focus this week', f0], ['Then', f1 || ''],
    ] },
    { title: 'QA reviews', sheet: 'Calls', cols: ['Date', 'Score %', 'Scoreable', 'Opportunity', 'Outcome', 'Not booked reason', 'Topic', 'Summary'], rows: myCalls.map((r) => [r.call?.call_date || '', r.score_pct == null ? '' : r.score_pct, isScored(r) ? 'yes' : 'no', r.opportunity ? 'yes' : 'no', r.outcome || '', r.not_booked_reason || '', (r.topics || [])[0] || '', r.summary || '']) },
  ])
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <Select label="Agent" value={aKey} onChange={setKey} opts={opts.map((o) => [o.name + '|||' + o.brand, o.name + ' · ' + o.brand + (o.ai ? ' (AI)' : '')])} />
        <ExportBar name={'callqa-agent-' + a.name.replace(/\W+/g, '-').toLowerCase()} title={a.name + ' — Scorecard'} subtitle={a.brand + ' · ' + a.calls + ' calls'} build={build} />
      </div>
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 92, height: 92, borderRadius: '50%', background: scoreColor(a.avg), color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{a.avg == null ? '—' : Math.round(a.avg)}</div><div style={{ fontSize: 10, opacity: 0.9 }}>avg QA</div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{a.name} {isAi ? <Pill bg="#ede9fe" fg="#6d28d9">AI CSR</Pill> : null} <span style={{ color: '#64748b', fontWeight: 500 }}>· {a.brand}</span></div>
            <div style={{ color: '#64748b', fontSize: 12.5 }}>{a.calls} calls scored in range</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>{isAi ? 'Virtual agent — audited for quality and tuned, not coached.' : ((a.avg >= 80 ? '⭐ One of the strongest voices on the team. ' : '') + 'One focus this week — small change, real money.')}</div>
          </div>
        </div>
      </Card>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Calls scored" value={a.calls} delta={<Delta now={a.calls} prev={prevA?.calls} digits={0} suffix="" />} />
        <Tile label="Avg QA" value={pct(a.avg)} color={scoreColor(a.avg)} delta={<Delta now={a.avg} prev={prevA?.avg} suffix="pp" />} />
        <Tile label="Conversion" value={pct(a.conv)} color={TEAL} sub={a.booked + ' booked'} delta={<Delta now={a.conv} prev={prevA?.conv} suffix="pp" />} />
        <Tile label="Asked for booking" value={pct(a.askRate)} color={a.askRate < 50 ? '#b71c1c' : '#1b5e20'} sub="on opportunities" delta={<Delta now={a.askRate} prev={prevA?.askRate} suffix="pp" />} />
        <Tile label="AHT" value="—" color="#94a3b8" sub="Lightspeed · pending" />
        <Tile label="ACW" value="—" color="#94a3b8" sub="Lightspeed · pending" />
      </div>
      {!isAi ? (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card style={{ flex: 1, minWidth: 240, background: '#f0fdf4', border: '1px solid #bbf7d0' }}><div style={{ fontWeight: 700, color: '#166534', marginBottom: 4 }}>🌟 What you're great at</div><div>{win}</div></Card>
            <Card style={{ flex: 1, minWidth: 240, background: '#fff7ed', border: '1px solid #fed7aa' }}><div style={{ fontWeight: 700, color: '#9a3412', marginBottom: 4 }}>🎯 Your focus this week</div><div style={{ fontWeight: 600 }}>{f0}</div>{f1 ? <div style={{ color: '#64748b', fontSize: 12.5, marginTop: 4 }}>Then: {f1}</div> : null}</Card>
          </div>
          <Card>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Asked for the booking</div>
            <div style={{ height: 10, borderRadius: 6, background: '#eef2f7', overflow: 'hidden' }}><div style={{ height: '100%', width: (a.askRate || 0) + '%', background: a.askRate < 50 ? '#b71c1c' : '#1b5e20' }} /></div>
            <div style={{ color: '#64748b', fontSize: 12.5, marginTop: 6 }}>{pct(a.askRate)} of your opportunity calls. Next cycle this shows your movement — that's the loop.</div>
          </Card>
        </>
      ) : (
        <Card style={{ background: '#faf5ff', border: '1px solid #e9d5ff' }}>
          <div style={{ fontWeight: 700, color: '#6d28d9', marginBottom: 4 }}>🤖 AI CSR — audit only</div>
          <div style={{ fontSize: 13, color: '#334155' }}>This is a virtual agent. Its calls are scored for quality monitoring and tuning, not coached. It asked for the booking on <b>{pct(a.askRate)}</b> of opportunity calls, with <b>{pct(a.conv)}</b> conversion. Use the calls below to spot-check and tune the AI.</div>
        </Card>
      )}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Their QA reviews <span style={{ color: '#94a3b8', fontWeight: 400 }}>— click any call to see the full breakdown, transcript &amp; recording</span></div>
        {myCalls.length === 0 ? <div style={{ padding: 14, color: '#64748b' }}>No calls in range.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <SortHead cols={['Date', 'Score', 'Opp.', 'Outcome', 'Topic', ['', null]]} sort={acSort} onSort={acOnSort} />
            <tbody>{sortRows(myCalls, acSort, acAcc).map((r) => {
              const c = r.call || {}; const os = OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.Other
              return (
                <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                  <td style={{ padding: '8px 12px' }}>{isScored(r)
                    ? <span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{r.auto_fail ? 'FAIL' : pct(r.score_pct)}</span>
                    : <Pill bg="#f1f5f9" fg="#64748b">{r.excluded ? 'Excluded' : (CLASS_LABEL[r.call_class] || 'Not scored')}</Pill>}</td>
                  <td style={{ padding: '8px 12px' }}>{r.opportunity ? '✅' : '—'}</td>
                  <td style={{ padding: '8px 12px' }}>{r.outcome ? <Pill bg={os.bg} fg={os.fg}>{r.outcome}</Pill> : '—'}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 220, color: '#475569' }}>{(r.topics || [])[0] || '—'}</td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>›</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </Card>
    </>
  )
}
const P100 = (n, d) => (d ? (n / d) * 100 : null)

// Build a self-contained, print-optimized HTML report for a single call and
// auto-open the browser print dialog (Save as PDF). No external dependencies.
// Layout: page 1 = the analysis (score, context, revenue, risks, summary,
// coaching, full 10-point scoring); page 2 = transcript + notes.
function buildCallReportHtml(row, c, answers, transcript, notes, includeTranscript = false, segments = []) {
  const esc = (v) => (v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))
  // Short, print-friendly names for the rubric items (full questions are long).
  const SHORT = { greeting: 'Greeting', verify: 'Verify customer info', callflow: 'Call flow & expectations', knowledge: 'Product knowledge', appointment: 'Offer appointment', professionalism: 'Professionalism', rebuttals: 'Rebuttals to book', hold: 'Hold policy', nextsteps: 'Clear next steps', closing: 'Proper closing' }
  const items = Object.entries(answers || {}).sort((a, b) => {
    const ia = RUBRIC_ORDER.indexOf(a[0]), ib = RUBRIC_ORDER.indexOf(b[0])
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const notScored = row.scoreable === false || row.excluded
  const scoreStr = row.excluded ? 'Excluded' : (row.scoreable === false ? (CLASS_LABEL[row.call_class] || 'Not scored') : (row.auto_fail ? 'FAIL' : pct(row.score_pct)))
  const scoreCol = notScored ? '#64748b' : scoreColor(row.score_pct)
  const chip = (label, val) => `<div class="fld"><div class="lbl">${esc(label)}</div><div class="val">${esc(val)}</div></div>`

  const metaBits = [agentOf(row), c.brand, fmtDate(c.call_date), c.source, c.direction, fmtDur(c.duration_seconds),
    c.customer_number ? '☎ ' + c.customer_number : '', c.customer_name].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')

  const contextCard = `<div class="card"><div class="h">Call context</div><div class="grid">
    ${chip('Call type', CLASS_LABEL[row.call_class] || 'Conversation')}
    ${chip('Opportunity', row.opportunity ? 'Yes' : 'No')}
    ${chip('Outcome', row.outcome || '—')}
    ${row.outcome === 'Not Booked' ? chip('Reason', row.not_booked_reason || '—') : ''}
  </div>${row.opportunity_context ? `<div class="ln"><b>Caller wanted:</b> ${esc(row.opportunity_context)}</div>` : ''}${(row.topics || []).length ? `<div class="tags">${row.topics.map((t) => `<span class="tag">🏷 ${esc(t)}</span>`).join('')}</div>` : ''}</div>`

  const revenueCard = (row.opportunity || row.revenue_tip) ? `<div class="card amber"><div class="h">Revenue &amp; conversion</div><div class="grid">
    ${chip('Asked for booking', row.asked_for_booking == null ? '—' : (row.asked_for_booking ? 'Yes' : 'No'))}
    ${chip('Info before pricing', ynLabel(row.info_before_pricing))}
    ${chip('Fee expectations', ynLabel(row.set_fee_expectations))}
    ${chip('Winnable', row.winnable == null ? '—' : (row.winnable ? 'Yes' : 'No'))}
  </div>${(row.objections || []).length ? `<div class="tags">${row.objections.map((o) => `<span class="tag red">⛔ ${esc(o)}</span>`).join('')}</div>` : ''}${row.revenue_tip ? `<div class="ln lever"><b>Biggest revenue lever:</b> ${esc(row.revenue_tip)}</div>` : ''}</div>` : ''

  const risks = (row.risk_flags || []).length ? `<div class="card red"><span class="rh">⚠ Risk flags:</span> ${row.risk_flags.map((f) => esc(f)).join(' &nbsp;•&nbsp; ')}</div>` : ''

  const summaryCard = `<div class="card"><div class="h">Summary</div><div class="body">${esc(row.summary) || '—'}</div></div>`
  const coachInner = `${row.coaching_note ? `<div class="body">${esc(row.coaching_note)}</div>` : ''}${(row.improvements || []).length ? `<div class="ln"><b>Focus:</b> ${row.improvements.map((s) => esc(s)).join(' · ')}</div>` : ''}${(row.strengths || []).length ? `<div class="ln" style="color:#1b5e20"><b>Strengths:</b> ${row.strengths.map((s) => esc(s)).join(' · ')}</div>` : ''}`
  const coachingCard = `<div class="card teal"><div class="h">Coaching</div>${coachInner || '<div class="body">—</div>'}</div>`

  const scoringItems = items.length ? items.map(([k, a]) => {
    const isNa = a.na || a.answer === 'na'; const isYes = a.answer === 'yes'
    const mark = isNa ? 'N/A' : (isYes ? '✓' : '✗'); const mc = isNa ? '#64748b' : (isYes ? '#1b5e20' : '#b71c1c')
    const earned = isNa ? 'N/A' : `${isYes ? (a.max || 0) : 0}/${a.max || 0}`
    const misses = (a.misses || []).length && !isNa && !isYes ? esc(a.misses.join(', ')) : ''
    return `<div class="s"><div class="sh"><span class="mk" style="color:${mc}">${mark}</span> <b>${esc(SHORT[k] || a.label || k)}</b> <span class="pts">${earned}</span></div>${a.rationale ? `<div class="rat">${esc(a.rationale)}</div>` : ''}${misses ? `<div class="miss">Missed: ${misses}</div>` : ''}</div>`
  }).join('') : '<div class="body">No detailed scoring available.</div>'
  const scoreTotal = (row.earned_points != null && row.max_points != null) ? `${row.earned_points} / ${row.max_points}` : ''
  const scoringCard = `<div class="card flow"><div class="h">Detailed scoring${scoreTotal ? ` <span class="pts" style="font-size:12px">${esc(scoreTotal)} pts</span>` : ''}</div><div class="scores">${scoringItems}</div></div>`

  const notesHtml = (notes && notes.length) ? `<div class="card"><div class="h">Notes (${notes.length})</div>${notes.map((n) => `<div class="note"><div class="notehd"><b>${esc(n.author_name || 'User')}</b><span>${n.created_at ? esc(new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span></div><div class="body">${esc(n.body)}</div></div>`).join('')}</div>` : ''
  // Optional: full transcript, forced onto its own page(s) after the summary.
  // Timestamped table when we have Deepgram segments; plain text otherwise.
  const txBody = (segments && segments.length)
    ? `<table class="tx">${segments.map((seg) => `<tr><td class="ts">${clockOf(seg.t)}</td><td class="sp">${esc(seg.s)}</td><td>${esc(seg.text)}</td></tr>`).join('')}</table>`
    : `<pre>${esc(formatTranscript(transcript)) || 'No transcript.'}</pre>`
  const txSection = includeTranscript ? `<div class="pg2"><div class="card"><div class="h">Transcript</div>${txBody}</div></div>` : ''

  const genDate = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const title = `Call QA Report — ${agentOf(row)} · ${c.brand || ''} · ${fmtDate(c.call_date)}`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 12px 26px; font-size: 11.5px; line-height: 1.35; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${TEAL}; padding-bottom: 8px; margin-bottom: 6px; }
  .top h1 { font-size: 18px; margin: 0 0 3px; }
  .brand { color: ${TEAL}; font-weight: 800; letter-spacing: .3px; }
  .meta { color: #64748b; font-size: 11px; }
  .score { text-align: right; white-space: nowrap; }
  .score .n { font-size: 28px; font-weight: 800; color: ${scoreCol}; line-height: 1; }
  .score .c { font-size: 10.5px; color: #64748b; }
  .row { display: flex; gap: 10px; align-items: stretch; }
  .row > .card { flex: 1; }
  .card { border: 1px solid #e2e8f0; border-radius: 9px; padding: 8px 11px; margin-top: 7px; page-break-inside: avoid; }
  .card.flow { page-break-inside: auto; }
  .card.amber { background: #fffbeb; border-color: #fde68a; }
  .card.red { background: #fdecea; border-color: #f5c6cb; color: #7f1d1d; }
  .card.teal { background: #f0fdfa; border-color: #99f6e4; }
  .h { font-weight: 700; margin-bottom: 6px; }
  .rh { font-weight: 700; color: #b71c1c; }
  .grid { display: flex; flex-wrap: wrap; gap: 6px 18px; }
  .fld .lbl { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .4px; }
  .fld .val { font-weight: 700; font-size: 12px; }
  .ln { margin-top: 6px; color: #334155; }
  .lever { color: #7c2d12; }
  .tags { margin-top: 7px; display: flex; flex-wrap: wrap; gap: 5px; }
  .tag { background: #e0f2fe; color: #075985; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 999px; }
  .tag.red { background: #fee2e2; color: #991b1b; }
  .body { color: #334155; }
  /* Detailed scoring — two compact columns */
  .scores { column-count: 2; column-gap: 20px; }
  .s { break-inside: avoid; padding: 3px 0; border-top: 1px solid #f1f5f9; }
  .s:first-child { border-top: none; }
  .sh { display: flex; align-items: baseline; gap: 5px; }
  .mk { font-weight: 800; width: 12px; display: inline-block; }
  .sh b { flex: 1; }
  .pts { color: #94a3b8; font-weight: 600; font-size: 10.5px; white-space: nowrap; }
  .rat { color: #475569; margin: 1px 0 0 17px; }
  .miss { color: #b71c1c; margin: 1px 0 0 17px; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 11.5px; color: #334155; margin: 0; }
  .tx { width: 100%; border-collapse: collapse; }
  .tx td { vertical-align: top; padding: 2px 0; color: #334155; }
  .tx .ts { color: ${TEAL}; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; padding-right: 9px; width: 30px; }
  .tx .sp { font-weight: 700; color: #475569; white-space: nowrap; padding-right: 9px; width: 44px; }
  .note { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 9px; margin-bottom: 7px; }
  .notehd { display: flex; justify-content: space-between; font-size: 10.5px; color: #64748b; }
  .pg2 { page-break-before: always; }
  .foot { margin-top: 10px; padding-top: 7px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10.5px; display: flex; justify-content: space-between; }
  .noprint { text-align: center; margin-bottom: 12px; }
  .noprint button { background: ${TEAL}; color: #fff; border: none; padding: 9px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style></head><body>
  <div class="noprint"><button onclick="window.print()">⬇ Save as PDF / Print</button></div>
  <div class="top">
    <div><h1>Call QA <span class="brand">(AI)</span> Report</h1><div class="meta">${metaBits}</div></div>
    <div class="score"><div class="n">${esc(scoreStr)}</div><div class="c">${notScored ? 'not counted toward score' : 'QA score'}${row.manager_adjusted ? ' · adjusted' : ''}</div></div>
  </div>
  <div class="row">${contextCard}${revenueCard}</div>
  ${risks}
  <div class="row">${summaryCard}${coachingCard}</div>
  ${scoringCard}
  ${notesHtml}${txSection}
  <div class="foot"><span>Generated ${esc(genDate)}</span><span>Powered by Opsis CX</span></div>
  <script>window.onload=function(){setTimeout(function(){window.print()},350)};window.onafterprint=function(){setTimeout(function(){window.close()},100)};</script>
</body></html>`
}
const inp = (w) => ({ padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', width: w, fontSize: 13 })
// ---- Lightspeed bulk import (managers) ------------------------------------
// Upload a .zip of Lightspeed WAVs (or the WAVs directly) to a brand's folder.
// The persistent `callqa-lightspeed-pump` cron ingests + transcribes + scores
// them automatically; recording links and per-line timestamps are captured on
// the first pass (no backfill needed). Client/brand/scope drive where they land.
function ImportPanel() {
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [brand, setBrand] = useState('')
  const [scope, setScope] = useState('inout')
  const [prefix, setPrefix] = useState('')
  const [phase, setPhase] = useState('idle') // idle | preparing | uploading | done | error
  const [prog, setProg] = useState({ done: 0, total: 0, failed: 0, cur: '' })
  const [status, setStatus] = useState(null)
  const [err, setErr] = useState('')

  const AUDIO_RE = /\.(wav|mp3|m4a|gsm|ogg|flac)$/i

  useEffect(() => {
    supabase.from('clients').select('id, portal_name').order('portal_name').then(({ data }) => {
      const list = (data || []).filter((c) => c.portal_name)
      setClients(list)
      const gc = list.find((c) => /garage/i.test(c.portal_name))
      setClientId((prev) => prev || gc?.id || list[0]?.id || '')
    })
  }, [])

  async function loadZipLib() {
    if (window.__zipjs) return window.__zipjs
    // @zip.js/zip.js is ESM-only now (no browser-global build), so load it as a
    // module from jsDelivr (already used elsewhere in the app for ffmpeg).
    const mod = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.8.34/+esm')
    const lib = (mod && mod.ZipReader) ? mod : (mod && mod.default) ? mod.default : mod
    if (!lib || !lib.ZipReader) throw new Error('Could not load the zip reader.')
    window.__zipjs = lib
    return lib
  }

  async function refreshStatus(b) {
    try { const { data } = await supabase.rpc('callqa_lightspeed_status', { p_brand: b }); setStatus(data) } catch { /* ignore */ }
  }

  async function onFiles(fileList) {
    setErr(''); setStatus(null)
    const files = Array.from(fileList || [])
    if (!files.length) return
    if (!clientId) { setErr('Pick a client first.'); return }
    if (!brand.trim()) { setErr('Enter a brand (e.g. Apple Door).'); return }

    let dest
    try {
      setPhase('preparing')
      const { data, error } = await supabase.rpc('callqa_lightspeed_register_source',
        { p_client: clientId, p_brand: brand.trim(), p_scope: scope, p_campaign: 'garagedoor' })
      if (error) throw error
      dest = data; setPrefix(data)
    } catch (e) { setPhase('error'); setErr('Could not prepare destination: ' + (e.message || e)); return }

    const readers = []
    const jobs = []
    try {
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          const zip = await loadZipLib()
          const reader = new zip.ZipReader(new zip.BlobReader(f))
          readers.push(reader)
          const entries = await reader.getEntries()
          for (const e of entries) {
            if (e.directory || !AUDIO_RE.test(e.filename)) continue
            jobs.push({ name: e.filename.split('/').pop(), entry: e })
          }
        } else if (AUDIO_RE.test(f.name)) {
          jobs.push({ name: f.name, file: f })
        }
      }
    } catch (e) {
      for (const r of readers) { try { await r.close() } catch { /* ignore */ } }
      setPhase('error'); setErr('Could not read the file(s): ' + (e.message || e)); return
    }

    if (!jobs.length) {
      for (const r of readers) { try { await r.close() } catch { /* ignore */ } }
      setPhase('error'); setErr('No audio files (.wav/.mp3/…) found in the selection.'); return
    }

    setPhase('uploading'); setProg({ done: 0, total: jobs.length, failed: 0, cur: '' })
    let done = 0, failed = 0
    for (const j of jobs) {
      try {
        setProg((p) => ({ ...p, cur: j.name }))
        const blob = j.file ? j.file : await j.entry.getData(new window.__zipjs.BlobWriter())
        const { error } = await supabase.storage.from('qa-recordings')
          .upload(`${dest}${j.name}`, blob, { upsert: true, contentType: 'audio/wav' })
        if (error) throw error
        done++
      } catch (e) { failed++ }
      setProg((p) => ({ ...p, done, failed }))
    }
    for (const r of readers) { try { await r.close() } catch { /* ignore */ } }
    setPhase('done')
    await refreshStatus(brand.trim())
  }

  // Poll processing status after upload so the counts + checks stay live.
  useEffect(() => {
    if (phase !== 'done') return
    const b = brand.trim(); if (!b) return
    const t = setInterval(() => refreshStatus(b), 5000)
    return () => clearInterval(t)
  }, [phase, brand])

  const busyUp = phase === 'uploading' || phase === 'preparing'
  const recOk = status && status.missing_recording === 0
  const tsOk = status && (status.scored || 0) > 0 && status.scored_missing_timestamps === 0

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Bulk import — Lightspeed recordings</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          Drop a <b>.zip</b> of Lightspeed WAVs (or select the WAVs). They upload to the brand's folder and the
          pipeline transcribes + scores them automatically within a couple of minutes — inbound &amp; outbound
          are scored; internal/fragment calls are kept but held. Recording links and per-line timestamps are
          captured on the first pass.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Select label="Client" value={clientId} onChange={setClientId} opts={clients.map((c) => [c.id, c.portal_name])} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Brand</label>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Apple Door"
              style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }} />
          </div>
          <Select label="Scope" value={scope} onChange={setScope} opts={[['inout', 'Inbound + outbound'], ['all', 'All call types']]} />
        </div>
      </Card>

      <Card>
        <label style={{ display: 'block', border: '2px dashed #cbd5e1', borderRadius: 12, padding: 24, textAlign: 'center', cursor: busyUp ? 'default' : 'pointer', background: '#f8fafc', opacity: busyUp ? 0.6 : 1 }}>
          <input type="file" accept=".zip,.wav,.mp3,.m4a,.gsm,.ogg,.flac" multiple style={{ display: 'none' }}
            onChange={(e) => onFiles(e.target.files)} disabled={busyUp} />
          <div style={{ fontSize: 15, fontWeight: 600, color: TEAL }}>Choose a .zip or WAV files…</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Large zips stream file-by-file — you can leave this tab open.</div>
        </label>

        {phase === 'preparing' && <div style={{ marginTop: 12, color: '#64748b' }}>Preparing destination…</div>}
        {(phase === 'uploading' || phase === 'done') && (
          <div style={{ marginTop: 14 }}>
            <Bar v={prog.total ? (prog.done + prog.failed) / prog.total * 100 : 0} />
            <div style={{ fontSize: 13, color: '#475569', marginTop: 6 }}>
              {prog.done + prog.failed} / {prog.total} uploaded{prog.failed ? ` · ${prog.failed} failed` : ''}{phase === 'uploading' && prog.cur ? ` · ${prog.cur}` : ''}
            </div>
          </div>
        )}
        {err && <div style={{ marginTop: 12, color: '#b71c1c', fontSize: 13 }}>{err}</div>}
      </Card>

      {status && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Processing — {status.brand}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {Object.entries(status.by_status || {}).map(([s, n]) => <Pill key={s} bg="#eef2f7" fg="#334155">{s}: {n}</Pill>)}
            <Pill bg="#eef2f7" fg="#334155">total: {status.total}</Pill>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Pill bg={recOk ? '#e8f5e9' : '#fff8e1'} fg={recOk ? '#1b5e20' : '#8d6e00'}>
              {recOk ? '✓' : '⚠'} recordings linked{status.missing_recording ? ` (${status.missing_recording} missing)` : ''}
            </Pill>
            <Pill bg={tsOk ? '#e8f5e9' : '#fff8e1'} fg={tsOk ? '#1b5e20' : '#8d6e00'}>
              {tsOk ? '✓' : '…'} timestamps present{status.scored_missing_timestamps ? ` (${status.scored_missing_timestamps} missing)` : ''}
            </Pill>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Auto-refreshing every 5s. Scored calls appear on the scorecards under this brand.</div>
        </Card>
      )}
    </div>
  )
}

function btn(kind) {
  if (kind === 'primary') return { background: TEAL, color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
  return { background: '#fff', color: '#334155', border: '1px solid #cbd5e1', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
}
