import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, downloadCsv, panel } from './financeBits'

// ============================================================
// HOURS (Admins and Owners)
// Everyone's hours for a period, counted by the rule you set:
//   Agents       -> Five9 Ready time (login minus not-ready), counted once, no split by deal
//   Everyone else -> task timers
// Exact to the second. Totals are always added up from seconds, never from the rounded hours.
// You can mark hours billable (to an invoice and product) or not billable, by hand. The database
// reads each amount itself, so what is saved can never differ from what is counted.
// ============================================================

const pad = (n) => String(n).padStart(2, '0')
export const hms = (s) => `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.round(s % 60))}`
export const hrs = (s) => (s / 3600).toFixed(2)
const show = (s) => `${hrs(s)} (${hms(s)})`
const keyOf = (r) => `${r.profile_id}|${r.work_date}|${r.source}|${r.source_ref}`
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA') }
const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', fontSize: 13.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' }
const PAGE = 200
const NOTE_TITLES = {
  agent_no_five9: 'Paid agents with no Five9 time in this period',
  five9_not_agent: 'Five9 time that is not counted (not an agent)',
  running_timer: 'Timers still running',
  ready_negative: 'Days where not-ready time was more than login time',
  agent_timer_ignored: 'Agent timers that are ignored',
}

function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export default function FinanceHours({ flash }) {
  const today = todayET()
  const [from, setFrom] = useState(addDays(today, -14))
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState([])
  const [notes, setNotes] = useState([])
  const [types, setTypes] = useState([])
  const [entities, setEntities] = useState([])
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [person, setPerson] = useState('')
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [picked, setPicked] = useState({})
  const [shownCount, setShownCount] = useState(PAGE)
  const [showNotes, setShowNotes] = useState(false)
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const [h, n, ty, en, ra] = await Promise.all([
      supabase.rpc('finance_hours', { p_from: from, p_to: to }),
      supabase.rpc('finance_hours_notes', { p_from: from, p_to: to }),
      supabase.from('finance_invoice_types').select('id,name,entity_id,active').order('sort').order('name'),
      supabase.from('finance_billing_entities').select('id,name'),
      supabase.from('finance_rate_lines').select('invoice_type_id,product_name,active'),
    ])
    if (h.error) { setErr(h.error.message); setRows([]); setLoading(false); return }
    setRows(h.data || []); setNotes(n.data || []); setTypes(ty.data || []); setEntities(en.data || []); setRates(ra.data || [])
    setPicked({}); setShownCount(PAGE); setLoading(false)
  }, [from, to])
  useEffect(() => { load() }, [load])

  const typeLabel = (id) => { const t = types.find(x => x.id === id); if (!t) return ''; const e = entities.find(x => x.id === t.entity_id); return e ? `${e.name} › ${t.name}` : t.name }
  const tagLabel = (r) => r.billable == null ? null : r.billable ? `Billable · ${typeLabel(r.invoice_type_id) || 'invoice'}${r.product_name ? ` · ${r.product_name}` : ''}` : 'Not billable'

  const people = useMemo(() => {
    const m = new Map()
    rows.forEach(r => { if (!m.has(r.profile_id)) m.set(r.profile_id, { id: r.profile_id, name: r.full_name, title: r.job_title, agent: r.is_agent }) })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (person && r.profile_id !== person) return false
    if (source && r.source !== source) return false
    if (status === 'untagged' && r.billable != null) return false
    if (status === 'billable' && r.billable !== true) return false
    if (status === 'not' && r.billable !== false) return false
    return true
  }), [rows, person, source, status])

  const sum = (list) => list.reduce((s, r) => s + r.seconds, 0)
  const byPerson = useMemo(() => {
    const m = new Map()
    filtered.forEach(r => {
      const p = m.get(r.profile_id) || { id: r.profile_id, name: r.full_name, title: r.job_title, agent: r.is_agent, secs: 0, days: new Set(), untagged: 0, billable: 0, not: 0 }
      p.secs += r.seconds; p.days.add(r.work_date)
      if (r.billable == null) p.untagged += r.seconds; else if (r.billable) p.billable += r.seconds; else p.not += r.seconds
      m.set(r.profile_id, p)
    })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const pickedRows = filtered.filter(r => picked[keyOf(r)])
  const togglePick = (r) => setPicked(p => { const n = { ...p }; if (n[keyOf(r)]) delete n[keyOf(r)]; else n[keyOf(r)] = true; return n })
  const visible = filtered.slice(0, shownCount)
  const allPicked = filtered.length > 0 && filtered.every(r => picked[keyOf(r)])
  const setRange = (f, t) => { setFrom(f); setTo(t) }

  async function exportCsv() {
    await supabase.rpc('finance_log_event', { p_action: 'export', p_table: 'finance_hours', p_note: `CSV export, ${filtered.length} rows, ${from} to ${to}` })
    downloadCsv(`hours-${from}-to-${to}.csv`,
      ['Date', 'Person', 'Job title', 'Counted from', 'What', 'Client', 'Kind', 'Seconds', 'Hours', 'H:MM:SS', 'Tag', 'Invoice', 'Product'],
      filtered.map(r => [r.work_date, r.full_name, r.job_title, r.source === 'five9' ? 'Five9 Ready time' : 'Task timer', r.what, r.client_name, r.entry_kind, r.seconds, (r.seconds / 3600).toFixed(4), hms(r.seconds),
        r.billable == null ? 'Untagged' : r.billable ? 'Billable' : 'Not billable', r.billable ? typeLabel(r.invoice_type_id) : '', r.product_name || '']))
    flash('Exported. The export is recorded in the audit log.')
  }

  const hasData = rows.length > 0
  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }} role="note">
        <b>How hours are counted.</b> Agents: Five9 Ready time (login minus not-ready), counted once. Everyone else: task timers. Exact to the second. Only Admins and Owners can see this page.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-from">From</label><input id="hr-from" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-to">To</label><input id="hr-to" type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></div>
        <button style={chip(false)} onClick={() => setRange(addDays(today, -14), today)}>Last 14 days</button>
        <button style={chip(false)} onClick={() => setRange(today.slice(0, 8) + '01', today)}>This month</button>
        <button style={chip(false)} onClick={() => { const f = new Date(today.slice(0, 8) + '01T00:00:00'); f.setMonth(f.getMonth() - 1); const first = f.toLocaleDateString('en-CA'); const last = addDays(today.slice(0, 8) + '01', -1); setRange(first, last) }}>Last month</button>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-person">Person</label>
          <select id="hr-person" value={person} onChange={e => setPerson(e.target.value)}><option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-source">Counted from</label>
          <select id="hr-source" value={source} onChange={e => setSource(e.target.value)}><option value="">Everything</option><option value="five9">Five9 Ready time</option><option value="timer">Task timers</option></select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-status">Billing tag</label>
          <select id="hr-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option><option value="untagged">Not tagged yet</option><option value="billable">Billable</option><option value="not">Not billable</option></select></div>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!filtered.length}>Export CSV</button>
      </div>

      {err && <div className="login-err" role="alert">{err}</div>}
      {loading ? <p className="page-sub">Loading…</p> : !hasData ? <p className="page-sub">No hours in this range.</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[['Total', sum(filtered)], ['Five9 Ready time', sum(filtered.filter(r => r.source === 'five9'))], ['Task timers', sum(filtered.filter(r => r.source === 'timer'))],
              ['Not tagged yet', sum(filtered.filter(r => r.billable == null))], ['Billable', sum(filtered.filter(r => r.billable === true))], ['Not billable', sum(filtered.filter(r => r.billable === false))]].map(([label, s]) => (
              <div key={label} style={{ ...panel, padding: '10px 14px' }} data-card={label}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{hrs(s)} h</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{hms(s)}</div>
              </div>))}
          </div>

          {notes.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}>
                {showNotes ? 'Hide' : 'Show'} data checks ({notes.length})
              </button>
              <span className="page-sub" style={{ marginLeft: 10 }}>Things worth a look. They do not change the hours.</span>
              {showNotes && Object.keys(NOTE_TITLES).filter(k => notes.some(n => n.kind === k)).map(k => (
                <div key={k} style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600 }}>{NOTE_TITLES[k]}</div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>{notes.filter(n => n.kind === k).map((n, i) => <li key={i}><b>{n.full_name}:</b> {n.detail}</li>)}</ul>
                </div>))}
            </div>
          )}

          <div style={{ ...panel, padding: 0, overflowX: 'auto', marginBottom: 18 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr><th style={th}>Person</th><th style={th}>Counted from</th><th style={{ ...th, textAlign: 'right' }}>Days</th><th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={{ ...th, textAlign: 'right' }}>Not tagged</th><th style={{ ...th, textAlign: 'right' }}>Billable</th><th style={{ ...th, textAlign: 'right' }}>Not billable</th></tr></thead>
              <tbody>
                {byPerson.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setPerson(person === p.id ? '' : p.id)} aria-label={`Hours for ${p.name}`}>
                    <td style={td}><div style={{ fontWeight: 600 }}>{p.name}</div>{p.title && <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{p.title}</div>}</td>
                    <td style={td}>{p.agent ? 'Five9 Ready time' : 'Task timers'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{p.days.size}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{show(p.secs)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{p.untagged ? hrs(p.untagged) : ''}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{p.billable ? hrs(p.billable) : ''}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{p.not ? hrs(p.not) : ''}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>

          {pickedRows.length > 0 && (
            <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} role="toolbar" aria-label="Tag the selected hours">
              <b>{pickedRows.length} row{pickedRows.length === 1 ? '' : 's'} selected ({hrs(sum(pickedRows))} hours)</b>
              <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setModal({ mode: 'billable' })}>Mark billable</button>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setModal({ mode: 'not' })}>Mark not billable</button>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setModal({ mode: 'clear' })}>Clear tags</button>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setPicked({})}>Unselect all</button>
            </div>
          )}

          <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead><tr>
                <th style={th}><input type="checkbox" aria-label="Select every row shown" checked={allPicked} onChange={() => setPicked(allPicked ? {} : Object.fromEntries(filtered.map(r => [keyOf(r), true])))} /></th>
                <th style={th}>Date</th><th style={th}>Person</th><th style={th}>What</th><th style={th}>Client</th><th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={th}>Billing tag</th>
              </tr></thead>
              <tbody>
                {visible.length === 0 && <tr><td style={td} colSpan={7}>Nothing matches these filters.</td></tr>}
                {visible.map(r => {
                  const tag = tagLabel(r)
                  return (
                    <tr key={keyOf(r)}>
                      <td style={td}><input type="checkbox" aria-label={`Select ${r.full_name} ${r.work_date} ${r.what}`} checked={!!picked[keyOf(r)]} onChange={() => togglePick(r)} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.work_date)}{!r.day_complete && <div><span className="badge needed">today, still changing</span></div>}</td>
                      <td style={td}>{r.full_name}</td>
                      <td style={td}><div>{r.what}</div><div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{r.entry_kind === 'typed by hand' ? 'Typed in by hand' : r.entry_kind === 'five9' ? '' : r.entry_kind}{r.flag ? ` · ${r.flag}` : ''}</div></td>
                      <td style={td}>{r.client_name || ''}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{show(r.seconds)}</td>
                      <td style={td}>{tag || <span style={{ color: 'var(--ink-soft)' }}>Not tagged</span>}</td>
                    </tr>)
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > shownCount && <div style={{ marginTop: 10 }}><button className="btn btn-ghost" onClick={() => setShownCount(c => c + PAGE)}>Show {Math.min(PAGE, filtered.length - shownCount)} more ({filtered.length - shownCount} not shown)</button></div>}
        </>
      )}
      {modal && <TagModal modal={modal} rows={pickedRows} types={types} entities={entities} rates={rates} typeLabel={typeLabel} onClose={() => setModal(null)} onDone={(m) => { setModal(null); flash(m); load() }} />}
    </div>
  )
}

function TagModal({ modal, rows, types, rates, typeLabel, onClose, onDone }) {
  const [invoice, setInvoice] = useState('')
  const [product, setProduct] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const active = types.filter(t => t.active)
  const products = [...new Set(rates.filter(r => r.invoice_type_id === invoice && r.active !== false).map(r => r.product_name))].sort()
  const { mode } = modal
  const title = { billable: 'Mark as billable', not: 'Mark as not billable', clear: 'Clear the tags' }[mode]

  async function save() {
    setErr('')
    if (mode === 'billable' && !invoice) return setErr('Choose which invoice this billable time belongs to.')
    if (rows.length > 3000) return setErr('Choose 3000 rows or fewer at a time.')
    setBusy(true)
    const payload = rows.map(r => ({ profile_id: r.profile_id, work_date: r.work_date, source: r.source, source_ref: r.source_ref }))
    const { data, error } = await supabase.rpc('finance_set_hour_tags', {
      p_rows: payload, p_billable: mode === 'billable' ? true : mode === 'not' ? false : null,
      p_invoice_type: mode === 'billable' ? invoice : null, p_product: mode === 'billable' ? (product || null) : null, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    onDone(mode === 'clear' ? `Cleared ${data ?? rows.length} tag${(data ?? rows.length) === 1 ? '' : 's'}.` : `Tagged ${data ?? rows.length} row${(data ?? rows.length) === 1 ? '' : 's'} ${mode === 'billable' ? 'billable' : 'not billable'}.`)
  }
  return (
    <Modal title={`${title}: ${rows.length} row${rows.length === 1 ? '' : 's'}`} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ marginTop: 0 }}>{(rows.reduce((s, r) => s + r.seconds, 0) / 3600).toFixed(2)} hours in total.</p>
      {mode === 'billable' && <>
        <div className="field"><label htmlFor="tg-inv">Which invoice? *</label>
          <select id="tg-inv" value={invoice} onChange={e => { setInvoice(e.target.value); setProduct('') }}><option value="">Choose…</option>{active.map(t => <option key={t.id} value={t.id}>{typeLabel(t.id)}</option>)}</select></div>
        <div className="field"><label htmlFor="tg-prod">Which product or service?</label>
          <select id="tg-prod" value={product} onChange={e => setProduct(e.target.value)} disabled={!invoice}><option value="">No particular product</option>{products.map(p => <option key={p} value={p}>{p}</option>)}</select>
          <div className="hint">The products come from that invoice's rate card.</div></div>
      </>}
      {mode === 'clear' && <p>This removes the billing tag from the selected rows. The hours themselves are not changed.</p>}
      {mode !== 'clear' && <div className="field"><label htmlFor="tg-note">Note (optional)</label><input id="tg-note" value={note} onChange={e => setNote(e.target.value)} /></div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : mode === 'clear' ? 'Clear tags' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}
