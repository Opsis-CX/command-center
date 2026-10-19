import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, todayET, fmtDate, panel } from './financeBits'
import { Modal } from './FinanceInvoices'

// ============================================================
// PAY RUNS (Admins and Owners)
// Gather everyone's counted hours for a pay period, review them, approve (the hours are locked so nobody is paid twice),
// then download the file Rippling imports. Rippling gets hours and any flat payment, never pay rates.
// ============================================================

const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '8px', borderBottom: '1px solid var(--line-soft, var(--line))', verticalAlign: 'top', fontSize: 13.5 }
const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const monthEnd = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).toLocaleDateString('en-CA')
const prevMonthStart = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 2, 1).toLocaleDateString('en-CA')
const hours2 = (secs) => (Number(secs) / 3600).toFixed(2)
const hms = (secs) => { const s = Math.round(Number(secs)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
const period = (r) => `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`
const finalSecs = (l) => (l.adjusted_seconds != null ? Number(l.adjusted_seconds) : Number(l.seconds))
const scaledValue = (l) => (l.adjusted_seconds != null && Number(l.seconds) > 0 ? Math.round(Number(l.value) * Number(l.adjusted_seconds) / Number(l.seconds) * 100) / 100 : Number(l.value))
const counts = (l) => finalSecs(l) > 0 || Number(l.flat_amount) > 0

// the next pay period: the day after the last live run, to the 15th or the end of that month (or the latest finished half-month)
export function suggestPayPeriod(runs, today) {
  const lastEnd = runs.filter(r => r.status !== 'void').reduce((m, r) => (r.period_end > m ? r.period_end : m), '')
  let from
  if (lastEnd) from = addDays(lastEnd, 1)
  else if (Number(today.slice(8, 10)) >= 16) from = today.slice(0, 8) + '01'
  else from = prevMonthStart(today).slice(0, 8) + '16'
  const to = Number(from.slice(8, 10)) <= 15 ? from.slice(0, 8) + '15' : monthEnd(from)
  return { from, to, lastEnd, inProgress: to >= today }
}

// ---------- the file Rippling imports: its exact 18 headers, one row per person ----------
export const RIPPLING_HEADERS = ['Rippling Emp No', 'Employee Name', 'Workweek', 'Shift ID', 'Contractor Hourly Hours', 'Contractor Hourly Rate', 'Contractor Hourly Amount', 'Contractor Payments', 'Contractor Invoices', 'Payable Cash Tips',
  'Regular Rate of Pay (Premium) Hours', 'Regular Rate of Pay (Premium) Rate', 'Regular Rate of Pay (Premium) Amount', 'Difficulty Care Payments Hours Hours', 'Difficulty Care Payments Hours Rate', 'Difficulty Care Payments Hours Amount', 'Difficulty Care Payments', 'Paystub Note']

export function ripplingCsv(snapshot) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const rows = (snapshot.lines || []).filter(l => Number(l.seconds) > 0 || Number(l.flat_amount) > 0)
    .sort((a, b) => Number(a.rippling_emp_no) - Number(b.rippling_emp_no) || String(a.full_name).localeCompare(String(b.full_name)))
    .map(l => {
      const cells = RIPPLING_HEADERS.map(() => '')
      cells[0] = l.rippling_emp_no; cells[1] = l.full_name
      if (Number(l.seconds) > 0) cells[4] = String(+(Number(l.seconds) / 3600).toFixed(6))
      if (Number(l.flat_amount) > 0) cells[7] = Number(l.flat_amount).toFixed(2)
      cells[17] = l.note || ''
      return cells.map(esc).join(',')
    })
  return [RIPPLING_HEADERS.map(esc).join(','), ...rows].join('\r\n') + '\r\n'
}
function downloadRippling(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })   // no byte-order mark: it would spoil the first header
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function FinancePayRuns({ flash }) {
  const [runs, setRuns] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [building, setBuilding] = useState(null)
  const today = todayET()

  const load = useCallback(async () => {
    const [r, l] = await Promise.all([
      supabase.from('finance_pay_runs').select('*').order('period_start', { ascending: false }),
      supabase.from('finance_pay_run_lines').select('*').order('full_name'),
    ])
    setErr((r.error || l.error) ? (r.error || l.error).message : '')
    setRuns(r.data || []); setLines(l.data || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const totals = (run) => {
    if (run.snapshot) return { people: run.snapshot.lines.length, secs: Number(run.snapshot.total_seconds), flat: Number(run.snapshot.total_flat), value: Number(run.snapshot.total_value) }
    const ls = lines.filter(x => x.run_id === run.id && counts(x))
    return { people: ls.length, secs: ls.reduce((s, x) => s + finalSecs(x), 0), flat: ls.reduce((s, x) => s + Number(x.flat_amount), 0), value: ls.reduce((s, x) => s + scaledValue(x), 0) }
  }
  const shown = useMemo(() => runs.filter(r => filter === 'all' || (filter === 'drafts' && r.status === 'draft') || (filter === 'approved' && r.status === 'approved') || (filter === 'void' && r.status === 'void')), [runs, filter])

  if (loading) return <p className="page-sub">Loading…</p>
  const open = runs.find(r => r.id === openId)
  if (open) return <PayRunPage key={open.id} run={open} lines={lines.filter(l => l.run_id === open.id)} onBack={() => setOpenId(null)} reload={load} flash={flash} />

  const hasDraft = runs.some(r => r.status === 'draft')
  const sp = suggestPayPeriod(runs, today)
  return (
    <div>
      <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 760 }}>Gather everyone's counted hours for a pay period, review them, and approve. Approving locks those hours so nobody is paid twice. Then download the file and upload it to Rippling, where the payments are processed. Rippling gets hours (and any flat payment), never pay rates.</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div style={{ ...panel, marginBottom: 14 }} data-ready>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Next pay run</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!hasDraft && <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setBuilding({ from: sp.from, to: sp.to })} aria-label={`Build the pay run for ${fmtDate(sp.from)} to ${fmtDate(sp.to)}`}>Build {fmtDate(sp.from)} – {fmtDate(sp.to)}</button>}
            <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setBuilding({})}>+ Build a pay run</button>
          </div>
        </div>
        <p className="page-sub" style={{ margin: '6px 0 0' }}>{hasDraft ? 'A draft pay run is open. Finish it or delete it before building the next one.' : `${sp.lastEnd ? `Last pay run goes through ${fmtDate(sp.lastEnd)}.` : 'No pay run yet.'}${sp.inProgress ? ' That period is not finished yet.' : ''}`}</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[['all', 'All'], ['drafts', 'Drafts'], ['approved', 'Approved'], ['void', 'Void']].map(([k, l]) => <button key={k} style={chip(filter === k)} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>)}
      </div>
      {shown.length === 0 ? <p className="page-sub">No pay runs yet.</p> : (
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }} data-run-table>
          <thead><tr><th style={th}>Period</th><th style={{ ...th, textAlign: 'right' }}>People</th><th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={{ ...th, textAlign: 'right' }}>Flat payments</th><th style={{ ...th, textAlign: 'right' }}>Value at pay rates</th><th style={th}>Status</th></tr></thead>
          <tbody>{shown.map(r => { const t = totals(r); return (
            <tr key={r.id} data-run={period(r)} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
              <td style={td}><b>{period(r)}</b></td><td style={num}>{t.people}</td><td style={num}>{hours2(t.secs)}</td><td style={num}>{money(t.flat)}</td><td style={num}>{money(t.value)}</td>
              <td style={td}><span className={r.status === 'approved' ? 'badge passed' : r.status === 'void' ? 'badge failed' : 'badge needed'}>{r.status === 'approved' ? 'Approved' : r.status === 'void' ? 'Void' : 'Draft'}</span></td>
            </tr>) })}</tbody></table></div>)}
      {building && <BuildModal init={building} onClose={() => setBuilding(null)} onBuilt={async (id) => { setBuilding(null); await load(); setOpenId(id); flash('Pay run gathered. Review it, then approve.') }} />}
    </div>
  )
}

function BuildModal({ init, onClose, onBuilt }) {
  const [from, setFrom] = useState(init.from || '')
  const [to, setTo] = useState(init.to || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function build() {
    setErr('')
    if (!from || !to) return setErr('Choose the first and last day of the pay period.')
    if (to < from) return setErr('The last day cannot be before the first day.')
    setBusy(true)
    const { data, error } = await supabase.rpc('finance_pay_run_build', { p_from: from, p_to: to })
    setBusy(false)
    if (error) return setErr(error.message)
    onBuilt(data)
  }
  return (
    <Modal title="Build a pay run" onClose={onClose} width={460}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label htmlFor="pr-from">First day</label><input id="pr-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="pr-to">Last day</label><input id="pr-to" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
      </div>
      <div className="hint">Everyone who is paid by the hour is included, with the hours counted as paid in this period. You can review and change everything before approving.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={build} disabled={busy}>{busy ? 'Gathering…' : 'Gather the hours'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function PayRunPage({ run, lines: allLines, onBack, reload, flash }) {
  const draft = run.status === 'draft'
  const snap = run.snapshot
  const [changes, setChanges] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState(run.notes || '')
  const [numbers, setNumbers] = useState({})       // line id -> typed Rippling number
  const [behind, setBehind] = useState({})
  const [adjust, setAdjust] = useState(null)
  const [leaving, setLeaving] = useState(null)
  const [approving, setApproving] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidWhy, setVoidWhy] = useState('')
  const lines = [...allLines].sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))

  const loadChanges = useCallback(async () => {
    if (!draft) return
    const { data } = await supabase.rpc('finance_pay_run_changes', { p_run: run.id }); setChanges(data)
  }, [run.id, draft])
  useEffect(() => { loadChanges() }, [loadChanges, allLines.length])

  async function call(name, args, ok) {
    setErr(''); setBusy(true)
    const { data, error } = await supabase.rpc(name, args)
    setBusy(false)
    if (error) { setErr(error.message); return { ok: false, data: null } }
    if (ok) flash(typeof ok === 'function' ? ok(data) : ok)
    await reload(); await loadChanges()
    return { ok: true, data }
  }
  const counted = lines.filter(counts)
  const missing = counted.filter(l => l.flagged)
  const noRate = counted.filter(l => l.missing_rate)
  const changed = changes && (changes.added_entries > 0 || changes.removed_entries > 0)
  const totalSecs = counted.reduce((s, l) => s + finalSecs(l), 0), totalFlat = counted.reduce((s, l) => s + Number(l.flat_amount), 0), totalValue = counted.reduce((s, l) => s + scaledValue(l), 0)

  async function saveNumber(l) {
    const v = (numbers[l.id] || '').trim()
    if (!v) return setErr('Type the Rippling number first.')
    const res = await call('finance_pay_set_rippling_no', { p_profile: l.profile_id, p_no: v }, `Rippling number saved for ${l.full_name}.`)
    if (res.ok) setNumbers(n => { const c = { ...n }; delete c[l.id]; return c })
  }
  async function toggleBehind(l) {
    if (behind[l.id] !== undefined) { setBehind(b => { const n = { ...b }; delete n[l.id]; return n }); return }
    const { data } = await supabase.rpc('finance_pay_run_line_breakdown', { p_line: l.id })
    setBehind(b => ({ ...b, [l.id]: data || [] }))
  }
  async function saveAdjust() {
    const h = Number(adjust.hours), f = adjust.flat === '' ? 0 : Number(adjust.flat)
    if (adjust.hours === '' || !Number.isFinite(h) || h < 0) return setErr('Enter the hours to pay, 0 or more.')
    if (!Number.isFinite(f) || f < 0) return setErr('A flat payment must be $0 or more.')
    const same = Math.round(h * 3600) === Number(adjust.line.seconds)
    if (!same && adjust.reason.trim().length < 3) return setErr('Say why you are changing the hours. The counted hours are kept with your reason.')
    const res = await call('finance_pay_run_line_set', { p_line: adjust.line.id, p_hours: same ? null : h, p_flat: f, p_note: adjust.note, p_reason: adjust.reason.trim() || null }, 'Saved.')
    if (res.ok) setAdjust(null)
  }
  async function saveLeave() {
    if (leaving.reason.trim().length < 3) return setErr('Say why this person is being left out. Their hours stay unpaid until a later run.')
    const res = await call('finance_pay_run_line_remove', { p_line: leaving.line.id, p_reason: leaving.reason.trim() }, `${leaving.line.full_name} is left out of this run.`)
    if (res.ok) setLeaving(null)
  }
  async function approve() {
    const res = await call('finance_pay_run_approve', { p_run: run.id }, 'Approved. The hours are locked. Download the Rippling file next.')
    if (res.ok) setApproving(false)
  }
  async function voidIt() {
    if (voidWhy.trim().length < 3) return setErr('Say why this pay run is being voided.')
    const res = await call('finance_pay_run_void', { p_run: run.id, p_reason: voidWhy.trim() }, 'Pay run voided. Its hours can be paid again.')
    if (res.ok) setVoiding(false)
  }
  async function download() {
    downloadRippling(`rippling-pay-run-${run.period_start}-to-${run.period_end}.csv`, ripplingCsv(snap))
    await supabase.rpc('finance_log_export', { p_table: 'finance_pay_runs', p_row: run.id, p_note: 'Rippling file downloaded' })
    flash('Rippling file downloaded. Upload it in Rippling to process the payments.')
  }

  const rows = draft ? lines : (snap ? snap.lines : [])
  return (
    <div data-run-page={period(run)}>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 10 }} onClick={onBack}>← All pay runs</button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>Pay run: {period(run)} <span className={run.status === 'approved' ? 'badge passed' : run.status === 'void' ? 'badge failed' : 'badge needed'} style={{ marginLeft: 6, fontSize: 12 }}>{run.status === 'approved' ? 'Approved' : run.status === 'void' ? 'Void' : 'Draft'}</span></h2>
      <p className="page-sub" style={{ margin: '0 0 12px' }}>{snap ? snap.lines.length : counted.length} people · {hours2(snap ? snap.total_seconds : totalSecs)} hours</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      {run.status === 'void' && <div className="card" style={{ marginBottom: 12 }} data-void-note>This pay run is void: {run.void_reason}. Its hours can be paid again. If you already uploaded its file to Rippling, that does not undo anything there.</div>}

      {draft && (
        <div style={{ ...panel, marginBottom: 14 }} data-warnings>
          <b>{missing.length > 0 || changed ? 'Needs your attention before you approve' : noRate.length > 0 ? 'Ready to approve. Worth a look first:' : 'Ready to approve.'}</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {missing.length > 0 && <li data-w="rippling">{missing.length} {missing.length === 1 ? 'person has' : 'people have'} no Rippling number ({missing.map(l => l.full_name).join(', ')}). Type it in the row, or leave {missing.length === 1 ? 'them' : 'them'} out of the run.</li>}
            {changed && <li data-w="changed">The hours have changed since this pay run was gathered ({changes.added_entries > 0 ? `${hours2(changes.added_seconds)} h added` : ''}{changes.added_entries > 0 && changes.removed_entries > 0 ? ', ' : ''}{changes.removed_entries > 0 ? `${hours2(changes.removed_seconds)} h removed` : ''}). Rebuild it so it matches the work.</li>}
            {noRate.length > 0 && <li data-w="norate">{noRate.length} {noRate.length === 1 ? 'person has' : 'people have'} hours with no pay rate covering those dates ({noRate.map(l => l.full_name).join(', ')}). Their value shows as $0 here. Rippling is not affected, because it gets hours only.</li>}
          </ul>
        </div>)}

      {draft && (
        <div style={{ ...panel, marginBottom: 14 }} data-notes>
          <div className="field" style={{ marginBottom: 8 }}><label htmlFor="pr-notes">Note on this pay run (optional)</label><input id="pr-notes" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <button className="btn btn-ghost" onClick={() => call('finance_pay_run_set_notes', { p_run: run.id, p_notes: notes }, 'Note saved.')} disabled={busy}>Save the note</button>
        </div>)}

      <div style={{ overflowX: 'auto', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-lines>
          <thead><tr><th style={th}>Rippling no.</th><th style={th}>Person</th><th style={{ ...th, textAlign: 'right' }}>{draft ? 'Counted' : 'Counted'}</th><th style={{ ...th, textAlign: 'right' }}>Pay this run</th><th style={{ ...th, textAlign: 'right' }}>Flat payment</th><th style={th}>Note</th><th style={{ ...th, textAlign: 'right' }}>Value</th>{draft && <th style={th}></th>}</tr></thead>
          <tbody>
            {rows.map(l => {
              const id = draft ? l.id : l.profile_id; const secs = draft ? finalSecs(l) : Number(l.seconds); const counted_s = draft ? Number(l.seconds) : Number(l.counted_seconds)
              const adjusted = draft ? l.adjusted_seconds != null : l.adjusted
              const val = draft ? scaledValue(l) : Number(l.value)
              const emp = l.rippling_emp_no
              return (
                <React.Fragment key={id}>
                  <tr data-person={l.full_name} style={draft && l.flagged && counts(l) ? { background: 'var(--warn-bg, #fff7ed)' } : undefined}>
                    <td style={td}>{emp ? <b data-emp>{emp}</b> : draft ? (
                      <div style={{ display: 'flex', gap: 4 }}><input aria-label={`Rippling number for ${l.full_name}`} inputMode="numeric" value={numbers[l.id] || ''} onChange={e => setNumbers({ ...numbers, [l.id]: e.target.value })} style={{ width: 80, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6 }} />
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => saveNumber(l)} disabled={busy} aria-label={`Save the Rippling number for ${l.full_name}`}>Save</button></div>) : ''}</td>
                    <td style={td}><b>{l.full_name}</b>{draft && l.flagged && counts(l) && <div role="note" data-flag style={{ color: '#b45309', fontSize: 12.5, marginTop: 2 }}>⚠ {l.flagged}</div>}
                      {l.missing_rate && <div className="page-sub" style={{ margin: '2px 0 0', fontSize: 12 }} data-norate>No pay rate for some of these hours</div>}</td>
                    <td style={num} title={hms(counted_s)}>{hours2(counted_s)} h</td>
                    <td style={num} title={hms(secs)}><b>{hours2(secs)} h</b>{adjusted && <div className="page-sub" style={{ margin: '2px 0 0', fontSize: 12, whiteSpace: 'normal', textAlign: 'right' }} data-adjusted>Adjusted: {l.adjust_reason}</div>}</td>
                    <td style={num}>{Number(l.flat_amount) > 0 ? money(l.flat_amount) : ''}</td>
                    <td style={td}>{l.note}</td>
                    <td style={num}>{money(val)}</td>
                    {draft && <td style={td}><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => toggleBehind(l)} aria-label={`Show what is behind ${l.full_name}`}>{behind[l.id] !== undefined ? 'Hide' : "What's behind this"}</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => { setErr(''); setAdjust({ line: l, hours: String(+(finalSecs(l) / 3600).toFixed(6)), flat: Number(l.flat_amount) > 0 ? String(Number(l.flat_amount)) : '', note: l.note || '', reason: l.adjust_reason || '' }) }} aria-label={`Adjust ${l.full_name}`}>Adjust</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => { setErr(''); setLeaving({ line: l, reason: '' }) }} aria-label={`Leave ${l.full_name} out`}>Leave out</button>
                    </div></td>}
                  </tr>
                  {draft && behind[l.id] !== undefined && (
                    <tr data-behind><td></td><td colSpan={7} style={{ ...td, background: 'var(--surface-2, #f8fafc)' }}>
                      {behind[l.id].length === 0 ? 'Nothing recorded.' : behind[l.id].map(b => <div key={b.work_date + b.source}>{fmtDate(b.work_date)}: {hours2(b.seconds)} h ({b.source === 'five9' ? 'Five9 Ready time' : 'task timers'})</div>)}
                    </td></tr>)}
                </React.Fragment>)
            })}
            {rows.length === 0 && <tr><td colSpan={8} style={td}>Nobody has hours counted as paid in this period.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>Totals</td><td style={{ ...num, fontWeight: 700 }} data-total-hours>{hours2(snap ? snap.total_seconds : totalSecs)} h</td><td style={{ ...num, fontWeight: 700 }} data-total-flat>{money(snap ? snap.total_flat : totalFlat)}</td><td style={td}></td><td style={{ ...num, fontWeight: 700 }} data-total-value>{money(snap ? snap.total_value : totalValue)}</td>{draft && <td style={td}></td>}</tr></tfoot>
        </table>
      </div>
      <p className="page-sub" style={{ margin: '-6px 0 14px', fontSize: 12 }}>Value is the hours at each person's pay rate, for cost reporting. It is not sent to Rippling.</p>

      {draft && (run.left_out || []).length > 0 && (
        <div style={{ ...panel, marginBottom: 14 }} data-left-out>
          <b>Left out of this run</b>
          {run.left_out.map(p => (
            <div key={p.profile_id} data-left-out-person={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', padding: '6px 0', marginTop: 6 }}>
              <span>{p.name}: {p.reason}. Their hours stay unpaid until a later run.</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => call('finance_pay_run_put_back', { p_run: run.id, p_profile: p.profile_id }, `${p.name} is back in this run.`)} aria-label={`Put ${p.name} back`}>Put back</button>
            </div>))}
        </div>)}
      {!draft && snap && snap.notes && <p className="page-sub">{snap.notes}</p>}

      {draft && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-ghost" onClick={() => { if (window.confirm('Rebuild from the work? Hours you adjusted, flat payments and notes stay. Anyone you left out stays out.')) call('finance_pay_run_rebuild', { p_run: run.id }, 'Rebuilt from the work.') }} disabled={busy}>Rebuild from the work</button>
          <button className="btn btn-ghost" onClick={() => { if (window.confirm('Delete this draft pay run? Its hours go back to be paid later.')) call('finance_pay_run_delete', { p_run: run.id }, 'Draft deleted.').then(r => { if (r.ok) onBack() }) }} disabled={busy}>Delete draft</button>
          <button className="btn btn-primary" onClick={() => { setErr(''); setApproving(true) }} disabled={busy}>Approve…</button>
        </div>)}
      {run.status === 'approved' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-primary" onClick={download}>Download the Rippling file</button>
          <button className="btn btn-ghost" onClick={() => { setErr(''); setVoiding(true) }}>Void this pay run</button>
        </div>)}

      {adjust && (
        <Modal title={`Adjust: ${adjust.line.full_name}`} onClose={() => setAdjust(null)}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <p className="page-sub" style={{ marginTop: 0 }}>Counted from the work: {hours2(adjust.line.seconds)} h ({hms(adjust.line.seconds)}).</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label htmlFor="ad-hours">Hours to pay</label><input id="ad-hours" inputMode="decimal" value={adjust.hours} onChange={e => setAdjust({ ...adjust, hours: e.target.value })} /></div>
            <div className="field"><label htmlFor="ad-flat">Flat payment ($)</label><input id="ad-flat" inputMode="decimal" value={adjust.flat} onChange={e => setAdjust({ ...adjust, flat: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="field"><label htmlFor="ad-note">Note on the pay stub (optional)</label><input id="ad-note" value={adjust.note} onChange={e => setAdjust({ ...adjust, note: e.target.value })} /></div>
          <div className="field"><label htmlFor="ad-why">Why are you changing the hours?</label><input id="ad-why" value={adjust.reason} onChange={e => setAdjust({ ...adjust, reason: e.target.value })} placeholder="e.g. a timer was left running" />
            <div className="hint">Needed only if the hours differ from the counted figure. The counted hours stay on record with your reason.</div></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={saveAdjust} disabled={busy}>Save</button><button className="btn btn-ghost" onClick={() => setAdjust(null)}>Cancel</button></div>
        </Modal>)}
      {leaving && (
        <Modal title={`Leave ${leaving.line.full_name} out`} onClose={() => setLeaving(null)} width={460}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <p className="page-sub" style={{ marginTop: 0 }}>Their hours are not paid in this run and stay unpaid until a later run picks them up.</p>
          <div className="field"><label htmlFor="lv-why">Why are they being left out? *</label><input id="lv-why" value={leaving.reason} onChange={e => setLeaving({ ...leaving, reason: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={saveLeave} disabled={busy}>Leave them out</button><button className="btn btn-ghost" onClick={() => setLeaving(null)}>Cancel</button></div>
        </Modal>)}
      {approving && (
        <Modal title="Approve this pay run" onClose={() => setApproving(false)} width={500}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <p style={{ marginTop: 0 }}>This pay run covers <b>{counted.length} {counted.length === 1 ? 'person' : 'people'}</b> for {period(run)}: <b>{hours2(totalSecs)} hours</b>{totalFlat > 0 ? <> and <b>{money(totalFlat)}</b> in flat payments</> : null}.</p>
          <p className="page-sub">Approving locks these hours so nobody is paid twice. After that you download the Rippling file. To change anything, void the pay run and build it again.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={approve} disabled={busy}>Approve and lock</button><button className="btn btn-ghost" onClick={() => setApproving(false)} disabled={busy}>Cancel</button></div>
        </Modal>)}
      {voiding && (
        <Modal title="Void this pay run" onClose={() => setVoiding(false)} width={460}>
          {err && <div className="login-err" role="alert">{err}</div>}
          <p className="page-sub" style={{ marginTop: 0 }}>Its hours go back to be paid again. If you already uploaded its file to Rippling, voiding here does not undo anything there.</p>
          <div className="field"><label htmlFor="pv-why">Why is it being voided? *</label><input id="pv-why" value={voidWhy} onChange={e => setVoidWhy(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-primary" onClick={voidIt} disabled={busy}>Void the pay run</button><button className="btn btn-ghost" onClick={() => setVoiding(false)}>Cancel</button></div>
        </Modal>)}
    </div>
  )
}
