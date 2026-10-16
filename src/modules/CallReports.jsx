// ============================================================
//  Call Reports (/call-reports) — Five9-style custom reports for Opsis Voice
//  (and the Five9 history synced into Command Center).
//
//  Three report types (pick one, then customise and save):
//    Call Log         — every call: outbound dialer, inbound (incl. AI), manual, Five9
//    Agent Occupancy  — login / ready / on call / wrap / not-ready (by reason) per agent-day
//    List Details     — every contact loaded to a campaign, attempts, results, lead fields
//
//  Customise: date range, filters, columns (pick + order), group by (up to 3) with
//  sum/avg/min/max, sort, totals. Save, export CSV, and schedule by email
//  (report-scheduler edge function runs every 15 minutes).
//
//  Data: rpc report_data(type, from, to) — managers only (can_manage_dialer).
//  Engine: src/lib/reportEngine.js (same code the scheduler uses).
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { REPORTS, OPS, AGGS, PRESETS, runReport, toCSV, formatValue, resolveRange, catalog, prepareRows } from '../lib/reportEngine'

const MAX_SHOWN = 2000
const FREQS = { daily: 'Every day', weekdays: 'Weekdays (Mon–Fri)', weekly: 'Weekly', monthly: 'Monthly' }
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const clone = o => JSON.parse(JSON.stringify(o))
const hourLabel = h => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`

export default function CallReports() {
  const [saved, setSaved] = useState([])
  const [current, setCurrent] = useState(null) // { id?, name, report_type, config, schedule }
  const [err, setErr] = useState('')

  const loadSaved = async () => {
    const { data, error } = await supabase.from('saved_reports').select('*').order('name')
    if (error) setErr(error.message); else setSaved(data || [])
  }
  useEffect(() => { loadSaved() }, [])

  const openStandard = type => setCurrent({ name: REPORTS[type].label, report_type: type, config: clone(REPORTS[type].defaults), schedule: null })
  const openSaved = r => setCurrent({ ...r, config: { ...clone(REPORTS[r.report_type].defaults), ...(r.config || {}) } })

  if (current) return <Builder key={current.id || current.report_type} report={current} onBack={() => { setCurrent(null); loadSaved() }} onSaved={r => { loadSaved(); setCurrent(r) }} />

  return (
    <div>
      <h1 className="page-title">Call Reports</h1>
      <p className="page-sub">Pick a report, customise the columns, filters and grouping, then save it, export it or email it on a schedule. Includes Opsis Voice calls and your Five9 history.</p>
      {err && <div style={S.error}>{err}</div>}
      <div style={S.sectionTitle}>Standard reports</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {Object.entries(REPORTS).map(([k, r]) => (
          <button key={k} onClick={() => openStandard(k)} style={S.tile}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{r.label}</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>{r.blurb}</div>
          </button>
        ))}
      </div>
      <div style={{ ...S.sectionTitle, marginTop: 22 }}>Saved reports</div>
      {!saved.length && <div style={{ opacity: 0.65, fontSize: 14 }}>Nothing saved yet — open a standard report, customise it and click Save.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {saved.map(r => (
          <button key={r.id} onClick={() => openSaved(r)} style={S.row}>
            <div>
              <div style={{ fontWeight: 700 }}>{r.name}</div>
              <div style={{ fontSize: 12.5, opacity: 0.65 }}>{REPORTS[r.report_type]?.label}{r.config?.range?.preset ? ` · ${PRESETS[r.config.range.preset] || ''}` : ''}</div>
            </div>
            <div style={{ fontSize: 12, textAlign: 'right' }}>
              {r.schedule?.enabled
                ? <span style={S.tag}>✉ {FREQS[r.schedule.freq] || 'Scheduled'}{r.next_run_at ? ` · next ${new Date(r.next_run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}` : ''}</span>
                : <span style={{ opacity: 0.5 }}>Not scheduled</span>}
              {r.last_error && <div style={{ color: '#b91c1c', marginTop: 3 }}>Last send failed: {r.last_error}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// =====================================================================
function Builder({ report, onBack, onSaved }) {
  const type = report.report_type
  const def = REPORTS[type]
  const [name, setName] = useState(report.name)
  const [cfg, setCfg] = useState(report.config)
  const [schedule, setSchedule] = useState(report.schedule || null)
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [panel, setPanel] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)
  const [fetchedRange, setFetchedRange] = useState(null)

  const range = resolveRange(cfg.range)
  const set = p => setCfg(c => ({ ...c, ...p }))

  async function run() {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('report_data', { p_type: type, p_from: range.from, p_to: range.to })
    setLoading(false)
    if (error) { setErr(error.message); return }
    setRaw(data || []); setFetchedRange(`${range.from}|${range.to}`)
  }
  useEffect(() => { run() }, []) // eslint-disable-line
  const stale = raw && fetchedRange !== `${range.from}|${range.to}`

  const fields = useMemo(() => catalog(type, prepareRows(type, raw || [])), [type, raw])
  const byKey = useMemo(() => Object.fromEntries(fields.map(f => [f.key, f])), [fields])
  const result = useMemo(() => (raw ? runReport(type, raw, cfg) : null), [raw, cfg, type])
  const distinct = useMemo(() => {
    const m = {}
    for (const r of prepareRows(type, raw || []).slice(0, 20000)) for (const f of fields) {
      if (f.type !== 'text' && f.type !== 'date') continue
      const v = r[f.key]; if (v == null || v === '') continue
      ;(m[f.key] = m[f.key] || new Set()).add(String(v))
    }
    return Object.fromEntries(Object.entries(m).map(([k, s]) => [k, [...s].sort().slice(0, 300)]))
  }, [raw, fields, type])

  async function save(asNew = false) {
    setMsg(''); setErr('')
    const row = { name: name.trim() || def.label, report_type: type, config: cfg, schedule }
    const q = report.id && !asNew
      ? supabase.from('saved_reports').update(row).eq('id', report.id).select('*').single()
      : supabase.from('saved_reports').insert(asNew && report.id ? { ...row, name: `${row.name} (copy)` } : row).select('*').single()
    const { data, error } = await q
    if (error) { setErr(error.message); return }
    setMsg('Saved.'); onSaved({ ...data, config: cfg })
  }
  async function remove() {
    if (!report.id || !window.confirm(`Delete "${report.name}"?`)) return
    const { error } = await supabase.from('saved_reports').delete().eq('id', report.id)
    if (error) setErr(error.message); else onBack()
  }
  async function sendNow() {
    if (!report.id) { setErr('Save the report first.'); return }
    setMsg('Sending…'); setErr('')
    const { data, error } = await supabase.functions.invoke('report-scheduler', { body: { report_id: report.id } })
    if (error || data?.error) { setMsg(''); setErr(data?.error || error.message); return }
    setMsg(`Sent to ${(data.sent_to || []).join(', ')}.`)
  }
  function exportCsv() {
    if (!result) return
    const blob = new Blob([toCSV(result)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(name || def.label).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_')}_${range.from || 'all'}_${range.to || ''}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }
  const toggleSort = key => set({ sort: { key, dir: cfg.sort?.key === key && cfg.sort.dir === 'desc' ? 'asc' : 'desc' } })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={S.btn}>← Reports</button>
          <input value={name} onChange={e => setName(e.target.value)} style={{ ...S.input, width: 300, fontWeight: 700, fontSize: 16, marginTop: 0 }} />
          <span style={S.tag}>{def.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
          <button onClick={exportCsv} disabled={!result} style={S.btn}>Export CSV</button>
          <button onClick={() => setShowSchedule(s => !s)} style={S.btn}>{schedule?.enabled ? '✉ Scheduled' : 'Schedule'}</button>
          {report.id && <button onClick={() => save(true)} style={S.btn}>Save as copy</button>}
          {report.id && <button onClick={remove} style={{ ...S.btn, color: '#b91c1c' }}>Delete</button>}
          <button onClick={() => save(false)} style={S.primary}>{report.id ? 'Save' : 'Save report'}</button>
        </div>
      </div>
      {err && <div style={S.error}>{err}</div>}

      {showSchedule && <ScheduleBox schedule={schedule} setSchedule={setSchedule} saved={!!report.id} onSendNow={sendNow} nextRun={report.next_run_at} />}

      {/* date range */}
      <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={S.lbl}>{def.dateLabel}
          <select value={cfg.range?.preset || 'today'} onChange={e => set({ range: { ...cfg.range, preset: e.target.value } })} style={{ ...S.input, width: 200 }}>
            {Object.entries(PRESETS).filter(([k]) => k !== 'all' || type === 'list_details').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {cfg.range?.preset === 'custom' && <>
          <label style={S.lbl}>From<input type="date" value={cfg.range.from || ''} onChange={e => set({ range: { ...cfg.range, from: e.target.value } })} style={{ ...S.input, width: 160 }} /></label>
          <label style={S.lbl}>To<input type="date" value={cfg.range.to || ''} onChange={e => set({ range: { ...cfg.range, to: e.target.value } })} style={{ ...S.input, width: 160 }} /></label>
        </>}
        <div style={{ fontSize: 12.5, opacity: 0.65, paddingBottom: 9 }}>{range.from ? (range.from === range.to ? range.from : `${range.from} → ${range.to}`) : 'All time'} · Eastern</div>
        <button onClick={run} disabled={loading} style={{ ...S.primary, marginLeft: 'auto', background: stale ? '#d97706' : '#0891b2' }}>{loading ? 'Running…' : stale ? 'Run (dates changed)' : 'Run'}</button>
      </div>

      {/* customise */}
      <div style={S.card}>
        <div style={S.tabs}>
          {[['columns', 'Columns'], ['filters', `Filters${cfg.filters?.length ? ` (${cfg.filters.length})` : ''}`], ['group', `Group & totals${cfg.groupBy?.length ? ` (${cfg.groupBy.length})` : ''}`]].map(([k, l]) =>
            <button key={k} onClick={() => setPanel(panel === k ? '' : k)} style={{ ...S.tab, ...(panel === k ? S.tabOn : {}) }}>{l}</button>)}
          <button onClick={() => setCfg(clone(def.defaults))} style={{ ...S.tab, marginLeft: 'auto', fontSize: 12.5 }}>Reset to standard</button>
        </div>
        {panel === 'columns' && <ColumnsPanel fields={fields} cfg={cfg} set={set} />}
        {panel === 'filters' && <FiltersPanel fields={fields} byKey={byKey} cfg={cfg} set={set} distinct={distinct} />}
        {panel === 'group' && <GroupPanel fields={fields} byKey={byKey} cfg={cfg} set={set} />}
      </div>

      {/* results */}
      <div style={S.card}>
        {!result ? <div style={{ opacity: 0.7 }}>{loading ? 'Running…' : 'Run the report to see results.'}</div> : (
          <>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>
              {result.count.toLocaleString()} records{cfg.groupBy?.length ? ` in ${result.rows.length.toLocaleString()} groups` : ''}
              {result.rows.length > MAX_SHOWN && ` · showing the first ${MAX_SHOWN.toLocaleString()} rows (Export CSV for all)`}
            </div>
            <div style={{ overflow: 'auto', maxHeight: '65vh' }}>
              <table style={S.table}>
                <thead>
                  <tr>{result.columns.map(c => (
                    <th key={c.key} onClick={() => toggleSort(c.key)} style={{ ...S.th, textAlign: isRight(c) ? 'right' : 'left' }}>
                      {c.label}{cfg.sort?.key === c.key ? (cfg.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>))}</tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, MAX_SHOWN).map((r, i) => (
                    <tr key={i}>{result.columns.map(c => <td key={c.key} style={{ ...S.td, textAlign: isRight(c) ? 'right' : 'left' }} title={typeof r[c.key] === 'string' && r[c.key].length > 60 ? r[c.key] : undefined}>{clip(formatValue(c, r[c.key]))}</td>)}</tr>
                  ))}
                  {!result.rows.length && <tr><td colSpan={result.columns.length} style={{ ...S.td, opacity: 0.6, textAlign: 'center', padding: 24 }}>No records for these dates and filters.</td></tr>}
                </tbody>
                {result.totals && result.rows.length > 0 && (
                  <tfoot>
                    <tr>{result.columns.map((c, i) => (
                      <td key={c.key} style={{ ...S.td, ...S.total, textAlign: isRight(c) ? 'right' : 'left' }}>
                        {i === 0 ? 'Total' : (isRight(c) ? formatValue(c, result.totals[c.key]) : '')}
                      </td>))}</tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const isRight = c => ['num', 'sec', 'pct', 'bool'].includes(c.type) || c.key === '__n' || !!c.derived
const clip = s => (s && s.length > 80 ? s.slice(0, 78) + '…' : s)

// ---------- columns ----------
function ColumnsPanel({ fields, cfg, set }) {
  const [q, setQ] = useState('')
  const cols = cfg.columns || []
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]))
  const move = (i, d) => { const n = [...cols]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); set({ columns: n }) }
  const toggle = k => set({ columns: cols.includes(k) ? cols.filter(x => x !== k) : [...cols, k] })
  const avail = fields.filter(f => !cols.includes(f.key) && (!q || f.label.toLowerCase().includes(q.toLowerCase())))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <div>
        <div style={S.miniTitle}>Shown, in this order</div>
        {cols.map((k, i) => byKey[k] && (
          <div key={k} style={S.colRow}>
            <span style={{ flex: 1 }}>{byKey[k].label}{byKey[k].groupOnly && <span style={S.hint}> (when grouped)</span>}</span>
            <button style={S.icon} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button style={S.icon} disabled={i === cols.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button style={S.icon} onClick={() => toggle(k)}>✕</button>
          </div>
        ))}
      </div>
      <div>
        <div style={S.miniTitle}>Add a column</div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search fields…" style={{ ...S.input, marginTop: 0, marginBottom: 6 }} />
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {avail.map(f => (
            <button key={f.key} onClick={() => toggle(f.key)} style={S.addRow}>
              + {f.label}{f.derived && <span style={S.hint}> calculated</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- filters ----------
function FiltersPanel({ fields, byKey, cfg, set, distinct }) {
  const flt = cfg.filters || []
  const upd = (i, p) => set({ filters: flt.map((f, j) => (j === i ? { ...f, ...p } : f)) })
  const filterable = fields.filter(f => !f.derived)
  const opsFor = f => (f?.type === 'bool' ? ['is_true', 'is_false']
    : ['num', 'sec'].includes(f?.type) ? ['gt', 'lt', 'empty', 'not_empty']
    : ['in', 'not_in', 'contains', 'not_contains', 'empty', 'not_empty'])
  return (
    <div>
      {flt.map((fl, i) => {
        const f = byKey[fl.key]
        const opts = distinct[fl.key] || []
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' }}>
            <select value={fl.key} onChange={e => { const nf = byKey[e.target.value]; upd(i, { key: e.target.value, op: opsFor(nf)[0], values: [] }) }} style={{ ...S.input, width: 200, marginTop: 0 }}>
              {filterable.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <select value={fl.op} onChange={e => upd(i, { op: e.target.value })} style={{ ...S.input, width: 170, marginTop: 0 }}>
              {opsFor(f).map(o => <option key={o} value={o}>{OPS[o]}</option>)}
            </select>
            {['in', 'not_in'].includes(fl.op) && (opts.length ? (
              <select multiple value={fl.values || []} onChange={e => upd(i, { values: [...e.target.selectedOptions].map(o => o.value) })}
                style={{ ...S.input, width: 280, height: 110, marginTop: 0 }}>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : <input placeholder="values, comma separated" value={(fl.values || []).join(', ')} onChange={e => upd(i, { values: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} style={{ ...S.input, width: 280, marginTop: 0 }} />)}
            {['contains', 'not_contains'].includes(fl.op) && <input placeholder="text (comma = any of)" value={(fl.values || []).join(', ')} onChange={e => upd(i, { values: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} style={{ ...S.input, width: 240, marginTop: 0 }} />}
            {['gt', 'lt'].includes(fl.op) && <input type="number" placeholder={f?.type === 'sec' ? 'seconds' : 'number'} value={fl.values?.[0] ?? ''} onChange={e => upd(i, { values: [e.target.value] })} style={{ ...S.input, width: 140, marginTop: 0 }} />}
            <button style={S.icon} onClick={() => set({ filters: flt.filter((_, j) => j !== i) })}>✕</button>
          </div>
        )
      })}
      <button style={S.btn} onClick={() => { const f = filterable[0]; set({ filters: [...flt, { key: f.key, op: opsFor(f)[0], values: [] }] }) }}>+ Add filter</button>
      <div style={{ ...S.hint, marginTop: 8 }}>Pick lists show values from the last run. Hold Ctrl/Cmd to pick several.</div>
    </div>
  )
}

// ---------- group & totals ----------
function GroupPanel({ fields, byKey, cfg, set }) {
  const gb = cfg.groupBy || []
  const groupable = fields.filter(f => f.group)
  const numericShown = (cfg.columns || []).map(k => byKey[k]).filter(f => f && !f.derived && ['num', 'sec', 'bool'].includes(f.type) && !gb.includes(f.key))
  const setGb = (i, k) => { const n = [...gb]; if (k) n[i] = k; else n.splice(i, 1); set({ groupBy: n.filter(Boolean) }) }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <div>
        <div style={S.miniTitle}>Group by</div>
        {[0, 1, 2].map(i => (i <= gb.length) && (
          <select key={i} value={gb[i] || ''} onChange={e => setGb(i, e.target.value)} style={{ ...S.input, marginTop: i ? 6 : 0 }}>
            <option value="">{i === 0 ? 'No grouping — one row per record' : '— none —'}</option>
            {groupable.map(f => <option key={f.key} value={f.key} disabled={gb.includes(f.key) && gb[i] !== f.key}>{f.label}</option>)}
          </select>
        ))}
        <label style={{ ...S.lbl, display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <input type="checkbox" checked={cfg.totals !== false} onChange={e => set({ totals: e.target.checked })} /> Show totals row
        </label>
        <div style={S.hint}>When grouped, only number columns and calculated columns (like Contact rate, Occupancy %) are shown next to the groups.</div>
      </div>
      <div>
        <div style={S.miniTitle}>How to total each number column</div>
        {!numericShown.length && <div style={S.hint}>Add number columns (talk time, calls…) to choose sum / average / min / max.</div>}
        {numericShown.map(f => (
          <div key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: 13.5 }}>{f.label}</span>
            <select value={(cfg.aggs || {})[f.key] || f.agg || 'sum'} onChange={e => set({ aggs: { ...(cfg.aggs || {}), [f.key]: e.target.value } })} style={{ ...S.input, width: 130, marginTop: 0 }}>
              {Object.entries(AGGS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- schedule ----------
function ScheduleBox({ schedule, setSchedule, saved, onSendNow, nextRun }) {
  const s = schedule || { enabled: false, freq: 'daily', hour: 7, weekday: 1, monthday: 1, range: 'report', recipients: [] }
  const upd = p => setSchedule({ ...s, ...p })
  return (
    <div style={{ ...S.card, borderColor: 'rgba(8,145,178,0.45)' }}>
      <label style={{ ...S.lbl, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={!!s.enabled} onChange={e => upd({ enabled: e.target.checked })} /> Email this report on a schedule
      </label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', opacity: s.enabled ? 1 : 0.5 }}>
        <label style={S.lbl}>How often
          <select value={s.freq} onChange={e => upd({ freq: e.target.value })} style={{ ...S.input, width: 190 }}>
            {Object.entries(FREQS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {s.freq === 'weekly' && <label style={S.lbl}>Day
          <select value={s.weekday} onChange={e => upd({ weekday: Number(e.target.value) })} style={{ ...S.input, width: 150 }}>
            {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
          </select></label>}
        {s.freq === 'monthly' && <label style={S.lbl}>Day of month
          <select value={s.monthday} onChange={e => upd({ monthday: Number(e.target.value) })} style={{ ...S.input, width: 120 }}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
          </select></label>}
        <label style={S.lbl}>Time (Eastern)
          <select value={s.hour} onChange={e => upd({ hour: Number(e.target.value) })} style={{ ...S.input, width: 130 }}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </label>
        <label style={S.lbl}>Dates in the email
          <select value={s.range} onChange={e => upd({ range: e.target.value })} style={{ ...S.input, width: 210 }}>
            <option value="report">Same as the report</option>
            {Object.entries(PRESETS).filter(([k]) => k !== 'custom').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label style={{ ...S.lbl, flex: '1 1 300px' }}>Send to (emails, comma separated)
          <input value={(s.recipients || []).join(', ')} onChange={e => upd({ recipients: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} style={S.input} placeholder="you@opsiscx.com, rob@…" />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span style={S.hint}>Click Save to apply the schedule. Emails include a preview table and the full CSV.{nextRun ? ` Next send: ${new Date(nextRun).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}</span>
        <button onClick={onSendNow} disabled={!saved} style={{ ...S.btn, marginLeft: 'auto' }} title={saved ? 'Email it now to the recipients (or you, if none)' : 'Save first'}>Send now</button>
      </div>
    </div>
  )
}

const S = {
  card: { padding: 14, borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'var(--card, transparent)', marginBottom: 12 },
  tile: { textAlign: 'left', padding: 16, borderRadius: 14, border: '1px solid rgba(100,116,139,0.25)', background: 'var(--card, transparent)', color: 'inherit', cursor: 'pointer' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(100,116,139,0.25)', background: 'var(--card, transparent)', color: 'inherit', cursor: 'pointer', textAlign: 'left', fontSize: 14 },
  sectionTitle: { fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#0e7490', margin: '14px 0 8px' },
  miniTitle: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.65, marginBottom: 6 },
  tag: { padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'rgba(8,145,178,0.12)', color: '#0e7490', whiteSpace: 'nowrap' },
  primary: { padding: '8px 16px', borderRadius: 10, border: 'none', background: '#0891b2', color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' },
  btn: { padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  icon: { padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(100,116,139,0.3)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.35)', background: 'transparent', color: 'inherit', fontSize: 13.5, fontFamily: 'inherit' },
  lbl: { display: 'block', fontSize: 12.5, fontWeight: 700 },
  hint: { fontSize: 12, opacity: 0.6, fontWeight: 400 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid rgba(100,116,139,0.2)', marginBottom: 12, flexWrap: 'wrap' },
  tab: { padding: '6px 12px', border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, fontSize: 13.5, borderBottom: '2px solid transparent', opacity: 0.7 },
  tabOn: { borderBottomColor: '#0891b2', opacity: 1, color: '#0891b2' },
  colRow: { display: 'flex', gap: 6, alignItems: 'center', padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.18)', marginBottom: 4, fontSize: 13.5 },
  addRow: { display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13.5, borderRadius: 6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { position: 'sticky', top: 0, background: 'var(--card, #fff)', padding: '8px 10px', borderBottom: '2px solid rgba(100,116,139,0.3)', whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 12.5, zIndex: 1 },
  td: { padding: '6px 10px', borderBottom: '1px solid rgba(100,116,139,0.12)', whiteSpace: 'nowrap' },
  total: { fontWeight: 800, borderTop: '2px solid rgba(100,116,139,0.35)', position: 'sticky', bottom: 0, background: 'var(--card, #fff)' },
  error: { padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 13, marginBottom: 10 },
}
