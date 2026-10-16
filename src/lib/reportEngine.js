// ============================================================
//  reportEngine — the Five9-style custom report engine for Call Reports.
//  Pure JS (no React). The SAME code runs in the browser (src/modules/CallReports.jsx)
//  and in the report-scheduler edge function (emailed CSVs), so a saved report
//  looks identical on screen and in the inbox.
//
//  Data comes from rpc report_data(type, from, to) — one row per call / agent-day /
//  list contact. Everything else (columns, filters, grouping, totals, sorting,
//  derived metrics) happens here from the saved report's config:
//
//    config = {
//      range:   { preset: 'today'|'yesterday'|'this_week'|'last_week'|'last_7'|'last_30'|
//                         'this_month'|'last_month'|'custom'|'all', from, to },
//      columns: ['agent', 'calls', ...],                // order = display order
//      filters: [{ key, op, values }],                  // see OPS
//      groupBy: ['agent'],                              // up to 3
//      aggs:    { talk_seconds: 'avg' },                // override default sum/avg/min/max
//      sort:    { key, dir: 'asc'|'desc' },
//      totals:  true
//    }
// ============================================================

export const TZ = 'America/New_York'

// ---------- field catalogs ----------
// type: text | num | sec | pct | date | datetime | bool
// agg (when grouped): sum | avg | min | max | none     group: can group by it
// derived: calc(a) from the aggregated row (a.__n = records, a[key] = sums)
const T = (key, label, extra = {}) => ({ key, label, type: 'text', group: true, ...extra })
const N = (key, label, extra = {}) => ({ key, label, type: 'num', agg: 'sum', ...extra })
const SEC = (key, label, extra = {}) => ({ key, label, type: 'sec', agg: 'sum', ...extra })
const B = (key, label, extra = {}) => ({ key, label, type: 'bool', agg: 'sum', group: true, ...extra })
const DT = (key, label, extra = {}) => ({ key, label, type: 'datetime', ...extra })
const D = (key, label, extra = {}) => ({ key, label, type: 'date', group: true, ...extra })
const div = (a, b) => (b ? a / b : null)

export const REPORTS = {
  call_log: {
    label: 'Call Log',
    blurb: 'Every call — outbound, inbound, AI and manual — from Opsis Voice and Five9.',
    dateLabel: 'Call date',
    fields: [
      T('source', 'Source'), T('call_id', 'Call ID', { group: false }), DT('started_at', 'Start time'),
      D('call_date', 'Date'), N('call_hour', 'Hour', { group: true, agg: 'none' }), T('call_type', 'Call type'),
      T('campaign', 'Campaign / line'), T('list_name', 'List'), T('client', 'Client'), T('brand', 'Brand'),
      T('agent', 'Agent'), T('customer_name', 'Customer', { group: false }), T('phone_last4', 'Phone (last 4)', { group: false }),
      T('disposition', 'Disposition'), B('is_contact', 'Contact'), SEC('talk_seconds', 'Talk time'),
      SEC('ring_seconds', 'Ring / preview time', { agg: 'avg' }), T('menu_option', 'Menu option'),
      B('after_hours', 'After hours'), B('ai_handled', 'AI handled'), N('attempt_number', 'Attempt #', { agg: 'avg', group: true }),
      DT('callback_at', 'Callback set for'), T('notes', 'Notes', { group: false }), T('ai_summary', 'AI summary', { group: false }),
      B('has_recording', 'Recorded'), T('wrap_fields', 'Captured fields', { group: false }), T('call_status', 'Call status'),
      { key: 'd_contact_rate', label: 'Contact rate', type: 'pct', derived: a => div(a.is_contact, a.__n), groupOnly: true },
      { key: 'd_avg_talk', label: 'Avg talk time', type: 'sec', derived: a => div(a.talk_seconds, a.__n), groupOnly: true },
      { key: 'd_avg_talk_contact', label: 'Avg talk (contacts)', type: 'sec', derived: a => div(a.talk_seconds, a.is_contact), groupOnly: true },
    ],
    defaults: {
      range: { preset: 'today' },
      columns: ['started_at', 'call_date', 'source', 'call_type', 'campaign', 'agent', 'customer_name', 'phone_last4', 'disposition', 'talk_seconds'],
      filters: [], groupBy: [], aggs: {}, sort: { key: 'started_at', dir: 'desc' }, totals: true,
    },
  },
  agent_occupancy: {
    label: 'Agent Occupancy',
    blurb: 'Login, Ready, On call, Wrap-up and Not ready time per agent per day, with calls and occupancy.',
    dateLabel: 'Work date',
    fields: [
      T('source', 'Source'), D('work_date', 'Date'), T('agent', 'Agent'),
      SEC('login_seconds', 'Login time'), SEC('ready_seconds', 'Ready time'), SEC('on_call_seconds', 'On call time'),
      SEC('wrap_seconds', 'Wrap-up (ACW)'), SEC('not_ready_seconds', 'Not ready time'),
      SEC('nr_break', 'NR — Break'), SEC('nr_lunch', 'NR — Lunch'), SEC('nr_meeting', 'NR — Meeting'),
      SEC('nr_training', 'NR — Training'), SEC('nr_coaching', 'NR — Coaching'), SEC('nr_other', 'NR — Other'),
      N('calls', 'Calls'), N('inbound_calls', 'Inbound calls'), N('outbound_calls', 'Outbound calls'), N('manual_calls', 'Manual calls'),
      SEC('talk_seconds', 'Talk time'),
      { key: 'd_occupancy', label: 'Occupancy %', type: 'pct', derived: a => div((a.on_call_seconds || 0) + (a.wrap_seconds || 0), (a.login_seconds || 0) - (a.not_ready_seconds || 0)) },
      { key: 'd_ready_pct', label: 'Ready %', type: 'pct', derived: a => div(a.ready_seconds, a.login_seconds) },
      { key: 'd_nr_pct', label: 'Not ready %', type: 'pct', derived: a => div(a.not_ready_seconds, a.login_seconds) },
      { key: 'd_aht', label: 'Avg handle time', type: 'sec', derived: a => div((a.talk_seconds || 0) + (a.wrap_seconds || 0), a.calls) },
      { key: 'd_calls_per_hour', label: 'Calls / login hour', type: 'num', derived: a => div(a.calls, (a.login_seconds || 0) / 3600) },
    ],
    defaults: {
      range: { preset: 'yesterday' },
      columns: ['work_date', 'agent', 'source', 'login_seconds', 'ready_seconds', 'on_call_seconds', 'wrap_seconds', 'not_ready_seconds', 'calls', 'talk_seconds', 'd_occupancy', 'd_aht'],
      filters: [], groupBy: [], aggs: {}, sort: { key: 'work_date', dir: 'desc' }, totals: true,
    },
  },
  list_details: {
    label: 'List Details',
    blurb: 'Every contact loaded to a campaign: status, attempts, last result, speed to first dial and lead fields.',
    dateLabel: 'Date loaded',
    fields: [
      T('campaign', 'Campaign'), T('client', 'Client'), T('brand', 'Brand'), T('list_name', 'List'), T('source', 'Loaded from'),
      T('contact_name', 'Contact', { group: false }), T('phone_last4', 'Phone (last 4)', { group: false }), T('status', 'Status'),
      N('attempts', 'Attempts', { agg: 'avg', group: true }), B('contacted', 'Contacted'), T('last_disposition', 'Last disposition'),
      DT('first_attempt_at', 'First dial'), SEC('seconds_to_first_dial', 'Speed to first dial', { agg: 'avg' }),
      DT('last_attempt_at', 'Last attempt'), DT('next_attempt_at', 'Next attempt'), DT('call_after', 'Call after'),
      DT('created_at', 'Loaded at'), D('created_date', 'Date loaded'), N('priority', 'Priority', { agg: 'avg' }),
      T('reason', 'Reason', { group: false }), T('hubspot_contact_id', 'HubSpot ID', { group: false }), T('customer_tz', 'Time zone'),
      SEC('total_talk_seconds', 'Total talk time'),
      { key: 'd_contact_rate', label: 'Contact rate', type: 'pct', derived: a => div(a.contacted, a.__n), groupOnly: true },
      { key: 'd_dialed', label: 'Dialed', type: 'num', derived: a => a.__dialed, groupOnly: true },
    ],
    defaults: {
      range: { preset: 'last_30' },
      columns: ['created_at', 'campaign', 'list_name', 'contact_name', 'phone_last4', 'status', 'attempts', 'contacted', 'last_disposition', 'seconds_to_first_dial'],
      filters: [], groupBy: [], aggs: {}, sort: { key: 'created_at', dir: 'desc' }, totals: true,
    },
  },
}

export const OPS = {
  in: 'is any of', not_in: 'is none of', contains: 'contains', not_contains: 'does not contain',
  gt: 'greater than', lt: 'less than', empty: 'is empty', not_empty: 'is not empty', is_true: 'is yes', is_false: 'is no',
}
export const AGGS = { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', none: '—' }
export const PRESETS = {
  today: 'Today', yesterday: 'Yesterday', this_week: 'This week (Mon–today)', last_week: 'Last week (Mon–Sun)',
  last_7: 'Last 7 days', last_30: 'Last 30 days', this_month: 'This month', last_month: 'Last month', custom: 'Custom', all: 'All time',
}

// ---------- rows ----------
export function prepareRows(type, rows) {
  if (type !== 'list_details') return rows || []
  return (rows || []).map(r => {
    const out = { ...r, created_date: r.created_at ? etDate(new Date(r.created_at)) : null }
    for (const [k, v] of Object.entries(r.data || {})) {
      if (v == null || typeof v === 'object') continue
      out[`data.${k}`] = v
    }
    delete out.data
    return out
  })
}

// Catalog including lead-data fields discovered in the rows (List Details).
export function catalog(type, rows = []) {
  const base = REPORTS[type].fields
  if (type !== 'list_details') return base
  const extra = new Set()
  for (const r of rows.slice(0, 2000)) for (const k of Object.keys(r)) if (k.startsWith('data.')) extra.add(k)
  return [...base, ...[...extra].sort().map(k => T(k, `Lead: ${k.slice(5).replace(/_/g, ' ')}`))]
}

const isNum = f => f && ['num', 'sec', 'pct', 'bool'].includes(f.type)

function passes(row, flt, f) {
  const v = row[flt.key]
  const s = v == null ? '' : String(v)
  const vals = (flt.values || []).map(String)
  switch (flt.op) {
    case 'in': return !vals.length || vals.includes(s)
    case 'not_in': return !vals.includes(s)
    case 'contains': return vals.some(x => s.toLowerCase().includes(x.toLowerCase()))
    case 'not_contains': return !vals.some(x => s.toLowerCase().includes(x.toLowerCase()))
    case 'gt': return v != null && Number(v) > Number(vals[0])
    case 'lt': return v != null && Number(v) < Number(vals[0])
    case 'empty': return v == null || s === ''
    case 'not_empty': return !(v == null || s === '')
    case 'is_true': return v === true || v === 'true'
    case 'is_false': return !(v === true || v === 'true')
    default: return true
  }
}

function accumulate(acc, row, fields) {
  acc.__n = (acc.__n || 0) + 1
  if (row.first_attempt_at) acc.__dialed = (acc.__dialed || 0) + 1
  for (const f of fields) {
    if (f.derived || !isNum(f)) continue
    let v = row[f.key]
    if (f.type === 'bool') v = v === true || v === 'true' ? 1 : 0
    if (v == null || v === '') continue
    v = Number(v)
    if (Number.isNaN(v)) continue
    acc[f.key] = (acc[f.key] || 0) + v
    acc[`__c_${f.key}`] = (acc[`__c_${f.key}`] || 0) + 1
    acc[`__min_${f.key}`] = Math.min(acc[`__min_${f.key}`] ?? Infinity, v)
    acc[`__max_${f.key}`] = Math.max(acc[`__max_${f.key}`] ?? -Infinity, v)
  }
  return acc
}

function finish(acc, cols, aggs) {
  const out = {}
  for (const f of cols) {
    if (f.derived) { out[f.key] = f.derived(acc); continue }
    if (!isNum(f)) continue
    const a = aggs[f.key] || f.agg || 'sum'
    out[f.key] = a === 'none' ? null
      : a === 'avg' ? div(acc[f.key] || 0, acc[`__c_${f.key}`] || 0)
      : a === 'min' ? (acc[`__min_${f.key}`] ?? null)
      : a === 'max' ? (acc[`__max_${f.key}`] ?? null)
      : (acc[f.key] ?? 0)
  }
  out.__n = acc.__n || 0
  return out
}

// Main entry: raw rows + config → { columns, rows, totals, count }
export function runReport(type, rawRows, cfg) {
  const rows = prepareRows(type, rawRows)
  const fields = catalog(type, rows)
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]))
  const filtered = rows.filter(r => (cfg.filters || []).every(fl => !byKey[fl.key] || passes(r, fl, byKey[fl.key])))
  const groupBy = (cfg.groupBy || []).filter(k => byKey[k])
  const aggs = cfg.aggs || {}
  const grouped = groupBy.length > 0

  let columns = (cfg.columns || []).map(k => byKey[k]).filter(Boolean)
  if (grouped) {
    const groupCols = groupBy.map(k => byKey[k])
    const valueCols = columns.filter(f => !groupBy.includes(f.key) && (isNum(f) || f.derived))
    columns = [...groupCols, { key: '__n', label: 'Records', type: 'num' }, ...valueCols]
  } else {
    columns = columns.filter(f => !f.groupOnly)
  }

  let out
  if (grouped) {
    const map = new Map()
    for (const r of filtered) {
      const k = groupBy.map(g => (r[g] == null ? '' : String(r[g]))).join('\u0001')
      if (!map.has(k)) map.set(k, { keys: Object.fromEntries(groupBy.map(g => [g, r[g] ?? null])), acc: {} })
      accumulate(map.get(k).acc, r, fields)
    }
    out = [...map.values()].map(({ keys, acc }) => ({ ...keys, ...finish(acc, columns, aggs) }))
  } else {
    out = filtered.map(r => {
      const o = { ...r }
      for (const f of columns) if (f.derived) o[f.key] = f.derived({ ...r, __n: 1 })
      return o
    })
  }

  const sortKey = cfg.sort?.key && columns.some(c => c.key === cfg.sort.key) ? cfg.sort.key : null
  if (sortKey) {
    const f = columns.find(c => c.key === sortKey)
    const dir = cfg.sort.dir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      if (isNum(f)) return (Number(x) - Number(y)) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }

  let totals = null
  if (cfg.totals !== false) {
    const acc = {}
    for (const r of filtered) accumulate(acc, r, fields)
    const t = finish(acc, columns.filter(c => c.key !== '__n'), aggs)
    totals = { ...t, __n: filtered.length }
  }
  return { columns, rows: out, totals, count: filtered.length, fields }
}

// ---------- formatting / export ----------
export function fmtSec(s) {
  if (s == null || s === '') return ''
  const n = Math.round(Number(s))
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), x = n % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
}
export function formatValue(f, v) {
  if (v == null || v === '') return ''
  switch (f?.type) {
    case 'sec': return fmtSec(v)
    case 'pct': return `${(Number(v) * 100).toFixed(1)}%`
    case 'num': return Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(2)
    case 'bool': return typeof v === 'number' ? String(v) : (v === true || v === 'true' ? 'Yes' : 'No')
    case 'datetime': return new Date(v).toLocaleString('en-US', { timeZone: TZ, month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
    case 'date': return String(v).slice(0, 10)
    default: return String(v)
  }
}
export function toCSV(result) {
  const esc = s => { const t = String(s ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  const head = result.columns.map(c => esc(c.label)).join(',')
  const body = result.rows.map(r => result.columns.map(c => esc(formatValue(c, r[c.key]))).join(','))
  if (result.totals) body.push(result.columns.map((c, i) => esc(i === 0 ? 'Total' : (isNum(c) || c.derived || c.key === '__n') ? formatValue(c, result.totals[c.key]) : '')).join(','))
  return [head, ...body].join('\n')
}

// ---------- dates (Eastern) ----------
export function etDate(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
function addDays(ymd, n) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function dow(ymd) { const x = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return x === 0 ? 7 : x } // Mon=1..Sun=7
export function resolveRange(range = {}, now = new Date()) {
  const today = etDate(now)
  const p = range.preset || 'today'
  if (p === 'all') return { from: null, to: null }
  if (p === 'custom') return { from: range.from || today, to: range.to || range.from || today }
  if (p === 'yesterday') { const y = addDays(today, -1); return { from: y, to: y } }
  if (p === 'this_week') return { from: addDays(today, 1 - dow(today)), to: today }
  if (p === 'last_week') { const mon = addDays(today, 1 - dow(today) - 7); return { from: mon, to: addDays(mon, 6) } }
  if (p === 'last_7') return { from: addDays(today, -6), to: today }
  if (p === 'last_30') return { from: addDays(today, -29), to: today }
  if (p === 'this_month') return { from: `${today.slice(0, 8)}01`, to: today }
  if (p === 'last_month') {
    const first = `${today.slice(0, 8)}01`
    const lastPrev = addDays(first, -1)
    return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev }
  }
  return { from: today, to: today }
}
