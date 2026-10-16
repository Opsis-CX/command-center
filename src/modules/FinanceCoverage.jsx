import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'

// ============================================================
// RETAINER TERMS (Admins and Owners)
// Some clients (GarageCo's call center) are billed for COVERAGE, not for hours worked:
//     hours open  x  agents per hour  x  rate per agent-hour
// - The terms have dates ("1.5 agents in October, 2 agents from November on") and last until you change them,
//   so there is nothing to redo each month.
// - "Change the terms from a date" ends the earlier terms the day before, automatically.
// - Holidays and short days are listed separately (0 hours = closed).
// - The preview shows exactly what a month bills, line by line. Amounts round to the cent per line.
// Five9 time is never part of this bill. It pays the agents.
// ============================================================

const DAYS = [['mon', 'Mon', 'Monday'], ['tue', 'Tue', 'Tuesday'], ['wed', 'Wed', 'Wednesday'], ['thu', 'Thu', 'Thursday'], ['fri', 'Fri', 'Friday'], ['sat', 'Sat', 'Saturday'], ['sun', 'Sun', 'Sunday']]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const fmtH = (v) => String(Number(v))
const fmtN = (v, d = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const money = (v) => `$${fmtN(v, 2)}`
const cents = (v) => Math.round(Number(v) * 100)
const pad = (n) => String(n).padStart(2, '0')
const th = { textAlign: 'left', padding: '7px 9px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)' }
const td = { padding: '7px 9px', fontSize: 13.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' }

// "Mon–Fri 11 h, Sat–Sun 6 h": runs of days with the same open hours are grouped
export function describeHours(term) {
  const vals = DAYS.map(([k]) => Number(term[`hours_${k}`] || 0))
  const out = []
  let i = 0
  while (i < 7) {
    let j = i
    while (j + 1 < 7 && vals[j + 1] === vals[i]) j++
    out.push(`${i === j ? DAYS[i][1] : `${DAYS[i][1]}–${DAYS[j][1]}`} ${vals[i] === 0 ? 'closed' : `${fmtH(vals[i])} h`}`)
    i = j + 1
  }
  return out.join(', ')
}

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export default function FinanceCoverage({ type, flash }) {
  const today = todayET()
  const [terms, setTerms] = useState([])
  const [days, setDays] = useState([])
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) })
  const [summary, setSummary] = useState([])
  const [preview, setPreview] = useState([])
  const [showDays, setShowDays] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null)

  const first = `${ym.y}-${pad(ym.m)}-01`
  const last = `${ym.y}-${pad(ym.m)}-${pad(new Date(ym.y, ym.m, 0).getDate())}`

  const load = useCallback(async () => {
    setErr('')
    const [t, d, s, p] = await Promise.all([
      supabase.from('finance_coverage_terms').select('*').eq('invoice_type_id', type.id),
      supabase.from('finance_coverage_days').select('*').eq('invoice_type_id', type.id),
      supabase.rpc('finance_coverage_summary', { p_invoice_type: type.id, p_from: first, p_to: last }),
      supabase.rpc('finance_coverage_preview', { p_invoice_type: type.id, p_from: first, p_to: last }),
    ])
    const bad = t.error || d.error || s.error || p.error
    if (bad) { setErr(bad.message); setLoading(false); return }
    setTerms((t.data || []).slice().sort((a, b) => b.effective_from.localeCompare(a.effective_from)))
    setDays((d.data || []).slice().sort((a, b) => b.day.localeCompare(a.day)))
    setSummary(s.data || []); setPreview(p.data || []); setLoading(false)
  }, [type.id, first, last])
  useEffect(() => { load() }, [load])

  const inEffect = (t) => t.effective_from <= today && (!t.effective_to || t.effective_to >= today)
  const baseTerm = terms.find(inEffect) || terms[0] || null
  const moveMonth = (n) => setYm(({ y, m }) => { const d = new Date(y, m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } })
  const total = summary.reduce((s, x) => s + cents(x.amount), 0)
  const totalAgentHours = summary.reduce((s, x) => s + Number(x.agent_hours), 0)
  const noTerms = summary.find(x => !x.term_id)

  async function removeTerm(t) {
    if (!window.confirm(`Remove the terms that start ${fmtDate(t.effective_from)}? The earlier terms will stretch over the gap.`)) return
    const { error } = await supabase.rpc('finance_coverage_remove_term', { p_term: t.id })
    if (error) return setErr(error.message)
    flash('Terms removed.'); load()
  }
  async function removeDay(d) {
    const { error } = await supabase.rpc('finance_coverage_remove_days', { p_invoice_type: type.id, p_from: d.day, p_to: d.day })
    if (error) return setErr(error.message)
    flash(`${fmtDate(d.day)} is back to the normal hours.`); load()
  }

  return (
    <div style={{ ...panel, marginTop: 16 }} data-section="retainer">
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Retainer terms</h2>
      <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 720 }}>
        This invoice bills for <b>coverage</b>, not for hours worked: hours open × agents per hour × the rate. Five9 time never changes this bill; it only pays the agents. Terms last until you change them, so there is nothing to redo each month.
      </p>
      {err && <div className="login-err" role="alert">{err}</div>}
      {loading ? <p className="page-sub">Loading…</p> : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Terms</h3>
            <button className="btn btn-primary" onClick={() => setModal({ kind: 'terms' })}>{terms.length ? 'Change the terms from a date' : 'Set the first terms'}</button>
          </div>
          {terms.length === 0 && <p className="page-sub" style={{ marginTop: 0 }}>No terms yet, so nothing is billed. Set the first terms: how many agents per hour, the rate, and the hours you are open each day.</p>}
          {terms.map(t => (
            <div key={t.id} data-term={t.effective_from} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div><b>From {fmtDate(t.effective_from)}</b> {t.effective_to ? `to ${fmtDate(t.effective_to)}` : 'until changed'} {inEffect(t) && <span className="badge passed" style={{ marginLeft: 6 }}>In effect now</span>}</div>
                <div>{fmtH(t.agents_per_hour)} agent{Number(t.agents_per_hour) === 1 ? '' : 's'} per hour at {money(t.rate_per_agent_hour)} per agent-hour</div>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>Open {describeHours(t)}{t.note ? ` · ${t.note}` : ''}</div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 10px', alignSelf: 'flex-start' }} onClick={() => removeTerm(t)} aria-label={`Remove the terms from ${fmtDate(t.effective_from)}`}>Remove</button>
            </div>))}

          <h3 style={{ margin: '18px 0 6px', fontSize: 15 }}>Closed days and short days</h3>
          <p className="page-sub" style={{ margin: '0 0 8px', maxWidth: 680 }}>Holidays and days you are open for fewer hours. Everything else follows the weekday hours above. 0 hours means closed.</p>
          <DayForm type={type} onSaved={(m) => { flash(m); load() }} onError={setErr} />
          {days.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {days.slice(0, 30).map(d => (
                <div key={d.id} data-day={d.day} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
                  <span><b>{fmtDate(d.day)}</b> · {Number(d.hours_open) === 0 ? 'Closed' : `Open ${fmtH(d.hours_open)} h`}{d.reason ? ` · ${d.reason}` : ''}</span>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => removeDay(d)} aria-label={`Put ${fmtDate(d.day)} back to normal`}>Put back to normal</button>
                </div>))}
              {days.length > 30 && <p className="page-sub" style={{ margin: '6px 0 0' }}>Showing the 30 most recent of {days.length}.</p>}
            </div>)}

          <h3 style={{ margin: '20px 0 6px', fontSize: 15 }}>What this bills</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => moveMonth(-1)}>← Previous month</button>
            <b data-month style={{ minWidth: 130, textAlign: 'center' }}>{MONTHS[ym.m - 1]} {ym.y}</b>
            <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => moveMonth(1)}>Next month →</button>
          </div>
          {summary.filter(x => x.term_id).map(x => (
            <div key={x.term_id} data-line style={{ padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 14 }}>
              <b>{fmtDate(x.seg_from)}{x.seg_from !== x.seg_to ? ` to ${fmtDate(x.seg_to)}` : ''}</b> · {x.days} day{x.days === 1 ? '' : 's'}: {fmtN(x.open_hours)} open hours × {fmtH(x.agents)} agent{Number(x.agents) === 1 ? '' : 's'} = {fmtN(x.agent_hours)} agent-hours × {money(x.rate)} = <b>{money(x.amount)}</b>
            </div>))}
          {noTerms && <div className="login-err" role="note" style={{ marginTop: 6 }}>{noTerms.days} day{noTerms.days === 1 ? ' has' : 's have'} no terms yet, so nothing is billed for {noTerms.days === 1 ? 'it' : 'them'}. Set the terms above.</div>}
          {summary.some(x => x.term_id) && (
            <div style={{ padding: '8px 0', borderTop: '2px solid var(--line)', fontSize: 15 }} data-total>
              <b>Total for {MONTHS[ym.m - 1]} {ym.y}: {fmtN(totalAgentHours)} agent-hours, {money(total / 100)}</b>
            </div>)}
          <button className="btn btn-ghost" style={{ fontSize: 12.5, marginTop: 4 }} onClick={() => setShowDays(!showDays)} aria-expanded={showDays}>{showDays ? 'Hide' : 'Show'} day by day</button>
          {showDays && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead><tr><th style={th}>Day</th><th style={{ ...th, textAlign: 'right' }}>Open hours</th><th style={{ ...th, textAlign: 'right' }}>Agents</th><th style={{ ...th, textAlign: 'right' }}>Agent-hours</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Why</th></tr></thead>
                <tbody>
                  {preview.map(p => (
                    <tr key={p.day}>
                      <td style={td}>{DAYS[p.weekday - 1][1]} {fmtDate(p.day)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(p.hours_open)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtH(p.agents)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(p.agent_hours)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{money(p.amount)}</td>
                      <td style={td}>{p.source === 'exception' ? `${Number(p.hours_open) === 0 ? 'Closed' : 'Short day'}${p.reason ? `: ${p.reason}` : ''}` : p.source === 'no terms' ? 'No terms yet' : ''}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </>
      )}
      {modal?.kind === 'terms' && <TermsModal type={type} base={baseTerm} hasTerms={terms.length > 0} today={today} onClose={() => setModal(null)} onSaved={(m) => { setModal(null); flash(m); load() }} />}
    </div>
  )
}

function TermsModal({ type, base, hasTerms, today, onClose, onSaved }) {
  const firstOfNext = (() => { const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` })()
  const [f, setF] = useState({
    start: hasTerms ? firstOfNext : `${today.slice(0, 8)}01`,
    agents: base ? fmtH(base.agents_per_hour) : '', rate: base ? Number(base.rate_per_agent_hour).toFixed(2) : '',
    hours: DAYS.map(([k]) => base ? fmtH(base[`hours_${k}`]) : ''), note: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const hoursNum = f.hours.map(h => (h === '' ? NaN : Number(h)))
  const week = hoursNum.reduce((s, h) => s + (Number.isFinite(h) ? h : 0), 0)
  const agentsN = Number(f.agents), rateN = Number(f.rate)
  const weekOk = week > 0 && agentsN > 0 && Number.isFinite(rateN) && f.rate !== ''

  async function save() {
    setErr('')
    if (!f.start) return setErr('Choose the date these terms start.')
    if (!(agentsN > 0 && agentsN <= 100)) return setErr('Agents per hour must be more than 0.')
    if (f.rate === '' || !(rateN >= 0)) return setErr('Enter the rate per agent-hour.')
    if (hoursNum.some(h => !Number.isFinite(h) || h < 0 || h > 24)) return setErr('Enter the open hours for every day, from 0 to 24. Use 0 for a day you are closed.')
    setBusy(true)
    const { error } = await supabase.rpc('finance_coverage_change_from', { p_invoice_type: type.id, p_start: f.start, p_agents: agentsN, p_rate: rateN, p_hours: hoursNum, p_note: f.note.trim() || null })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(`Terms saved. From ${fmtDate(f.start)}, ${fmtH(agentsN)} agent${agentsN === 1 ? '' : 's'} per hour at ${money(rateN)}.`)
  }
  return (
    <Modal title={hasTerms ? 'Change the terms from a date' : 'Set the first terms'} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ marginTop: 0 }}>{hasTerms ? 'From the start date on, these terms replace the earlier ones. The earlier terms end the day before, so nothing else needs to change. The boxes start with the terms now in effect, so change only what is different.' : 'These terms last until you change them.'}</p>
      <div className="field"><label htmlFor="ct-start">These terms start on *</label><input id="ct-start" type="date" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label htmlFor="ct-agents">Agents billed per hour *</label><input id="ct-agents" inputMode="decimal" value={f.agents} onChange={e => setF({ ...f, agents: e.target.value })} placeholder="e.g. 1.5" />
          <div className="hint">Can be a fraction, like 1.5.</div></div>
        <div className="field"><label htmlFor="ct-rate">Rate per agent-hour ($) *</label><input id="ct-rate" inputMode="decimal" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} placeholder="e.g. 32.50" /></div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, margin: '4px 0 6px' }}>Hours open each day *</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {DAYS.map(([k, short, long], i) => (
          <div key={k} className="field" style={{ margin: 0 }}>
            <label htmlFor={`ct-h-${i + 1}`} style={{ fontSize: 12 }}>{short}</label>
            <input id={`ct-h-${i + 1}`} aria-label={`Hours open on ${long}`} inputMode="decimal" value={f.hours[i]} onChange={e => setF({ ...f, hours: f.hours.map((h, j) => (j === i ? e.target.value : h)) })} style={{ width: '100%' }} />
          </div>))}
      </div>
      <div className="hint" style={{ margin: '6px 0 10px' }}>Use 0 for a day you are closed. Holidays are added separately, so leave them out here.</div>
      {weekOk && <div className="card" role="status" data-check style={{ margin: '0 0 10px' }}>A normal week bills <b>{fmtN(week)} open hours × {fmtH(agentsN)} agents = {fmtN(week * agentsN)} agent-hours × {money(rateN)} = {money(cents(week * agentsN * rateN) / 100)}</b>. Check this against what you expect.</div>}
      <div className="field"><label htmlFor="ct-note">Note (optional)</label><input id="ct-note" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. Becky confirmed 2 agents from November" /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save the terms'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function DayForm({ type, onSaved, onError }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [hours, setHours] = useState('0')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function add() {
    onError('')
    if (!from) return onError('Choose the day, or the first day of the run.')
    const end = to || from
    if (end < from) return onError('The last day cannot be before the first day.')
    const h = Number(hours)
    if (hours === '' || !(h >= 0 && h <= 24)) return onError('Open hours must be from 0 to 24. Use 0 for closed.')
    setBusy(true)
    const { data, error } = await supabase.rpc('finance_coverage_set_days', { p_invoice_type: type.id, p_from: from, p_to: end, p_hours: h, p_reason: reason.trim() || null })
    setBusy(false)
    if (error) return onError(error.message)
    setFrom(''); setTo(''); setHours('0'); setReason('')
    onSaved(`${data ?? 1} day${(data ?? 1) === 1 ? '' : 's'} saved as ${h === 0 ? 'closed' : `open ${fmtH(h)} h`}.`)
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="field" style={{ margin: 0 }}><label htmlFor="cd-from">Day (or first day)</label><input id="cd-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div className="field" style={{ margin: 0 }}><label htmlFor="cd-to">Last day (optional)</label><input id="cd-to" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
      <div className="field" style={{ margin: 0, width: 110 }}><label htmlFor="cd-hours">Hours open</label><input id="cd-hours" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} /></div>
      <div className="field" style={{ margin: 0, minWidth: 180 }}><label htmlFor="cd-reason">Reason</label><input id="cd-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Thanksgiving" /></div>
      <button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? 'Saving…' : 'Add closed or short days'}</button>
    </div>
  )
}
