import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'

// ============================================================
// RETAINERS (Admins and Owners)
// Some clients (GarageCo's call center) are billed for COVERAGE, not for hours worked:
//     hours open  x  agents per hour  x  rate per agent-hour
// - An invoice can have SEVERAL retainers, each with its own terms and its own line on the invoice.
// - HOURS OPEN come from the schedule: you pick which shift roles are part of the retainer, and the hours are the time
//   those shifts are open each day. Closed days and short days therefore follow the schedule by themselves.
//   (Typed weekday hours are still available for a retainer that is not tied to the schedule.)
// - AGENTS PER HOUR and the RATE are typed, with a start date. They are commercial terms: the schedule may staff 2 agents
//   while you bill 1.5. The shift roles are dated with them, so a change can never rewrite an old bill.
// - "Change the terms from a date" ends the earlier terms the day before, automatically.
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

// "Mon–Fri 11 h, Sat–Sun 6 h": runs of days with the same open hours are grouped (typed weekday hours)
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
const describeSource = (t) => t.hours_source === 'schedule' ? `Hours open come from the schedule: ${(t.roles || []).join(', ') || 'no shifts chosen'}` : `Open ${describeHours(t)} (typed)`

function Modal({ title, onClose, children, width = 600 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width, maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export default function FinanceCoverage({ type, flash }) {
  const today = todayET()
  const [retainers, setRetainers] = useState([])
  const [terms, setTerms] = useState([])
  const [days, setDays] = useState([])
  const [roleOptions, setRoleOptions] = useState([])
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) })
  const [summary, setSummary] = useState([])
  const [dayRows, setDayRows] = useState([])
  const [open, setOpen] = useState({})          // which retainers show their day-by-day table
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null)

  const first = `${ym.y}-${pad(ym.m)}-01`
  const last = `${ym.y}-${pad(ym.m)}-${pad(new Date(ym.y, ym.m, 0).getDate())}`

  const load = useCallback(async () => {
    setErr('')
    const [r, t, d, ro, s, p] = await Promise.all([
      supabase.from('finance_retainers').select('*').eq('invoice_type_id', type.id),
      supabase.from('finance_coverage_terms').select('*').eq('invoice_type_id', type.id),
      supabase.from('finance_coverage_days').select('*').eq('invoice_type_id', type.id),
      supabase.rpc('finance_retainer_role_options', { p_invoice_type: type.id }),
      supabase.rpc('finance_coverage_summary', { p_invoice_type: type.id, p_from: first, p_to: last }),
      supabase.rpc('finance_coverage_preview', { p_invoice_type: type.id, p_from: first, p_to: last }),
    ])
    const bad = r.error || t.error || d.error || s.error || p.error
    if (bad) { setErr(bad.message); setLoading(false); return }
    setRetainers((r.data || []).slice().sort((a, b) => (a.sort - b.sort) || String(a.created_at || '').localeCompare(String(b.created_at || ''))))
    setTerms((t.data || []).slice().sort((a, b) => b.effective_from.localeCompare(a.effective_from)))
    setDays((d.data || []).slice().sort((a, b) => b.day.localeCompare(a.day)))
    setRoleOptions(ro.data || []); setSummary(s.data || []); setDayRows(p.data || []); setLoading(false)
  }, [type.id, first, last])
  useEffect(() => { load() }, [load])

  const inEffect = (t) => t.effective_from <= today && (!t.effective_to || t.effective_to >= today)
  const moveMonth = (n) => setYm(({ y, m }) => { const d = new Date(y, m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } })
  const total = summary.reduce((s, x) => s + cents(x.amount), 0)
  const totalAgentHours = summary.reduce((s, x) => s + Number(x.agent_hours), 0)
  const hasBilling = summary.some(x => x.term_id)
  const termsOf = (rid) => terms.filter(t => t.retainer_id === rid)
  const daysOf = (rid) => days.filter(d => d.retainer_id === rid)
  const linesOf = (rid) => summary.filter(x => x.retainer_id === rid)
  const rowsOf = (rid) => dayRows.filter(x => x.retainer_id === rid)
  const mname = `${MONTHS[ym.m - 1]} ${ym.y}`

  async function run(fn, okMsg) {
    const { error } = await fn()
    if (error) { setErr(error.message); return false }
    flash(okMsg); await load(); return true
  }
  const removeTerm = (t) => window.confirm(`Remove the terms that start ${fmtDate(t.effective_from)}? The earlier terms will stretch over the gap.`) && run(() => supabase.rpc('finance_coverage_remove_term', { p_term: t.id }), 'Terms removed.')
  const removeDay = (d) => run(() => supabase.rpc('finance_retainer_remove_days', { p_retainer: d.retainer_id, p_from: d.day, p_to: d.day }), `${fmtDate(d.day)} is back to the schedule.`)
  const deleteRetainer = (r) => window.confirm(`Delete the retainer "${r.name}", with all its terms and closed days? This cannot be undone.`) && run(() => supabase.rpc('finance_retainer_delete', { p_retainer: r.id }), 'Retainer deleted.')

  return (
    <div style={{ ...panel, marginTop: 16 }} data-section="retainer">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Retainers</h2>
          <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 720 }}>
            This invoice bills for <b>coverage</b>, not for hours worked: hours open × agents per hour × the rate. The <b>hours open come from the schedule</b>: pick which shifts are part of each retainer. You type only how many agents are billed and the rate. Five9 time never changes this bill; it only pays the agents.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>+ Add a retainer</button>
      </div>
      {err && <div className="login-err" role="alert">{err}</div>}
      {loading ? <p className="page-sub">Loading…</p> : (
        <>
          <h3 style={{ margin: '4px 0 6px', fontSize: 15 }}>What this invoice bills</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => moveMonth(-1)}>← Previous month</button>
            <b data-month style={{ minWidth: 130, textAlign: 'center' }}>{mname}</b>
            <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => moveMonth(1)}>Next month →</button>
          </div>
          {retainers.length === 0 && <p className="page-sub">No retainers yet, so nothing is billed. Add the first one.</p>}
          {retainers.map(r => {
            const lines = linesOf(r.id)
            const sub = lines.reduce((s, x) => s + cents(x.amount), 0)
            const noSched = rowsOf(r.id).filter(x => x.source === 'schedule' && Number(x.hours_open) === 0).length
            const noTerms = lines.find(x => !x.term_id)
            return (
              <div key={r.id} data-bill={r.name} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div>
                {lines.filter(x => x.term_id).map(x => (
                  <div key={x.term_id} data-line style={{ padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 14 }}>
                    <b>{fmtDate(x.seg_from)}{x.seg_from !== x.seg_to ? ` to ${fmtDate(x.seg_to)}` : ''}</b> · {x.days} day{x.days === 1 ? '' : 's'}: {fmtN(x.open_hours)} open hours × {fmtH(x.agents)} agent{Number(x.agents) === 1 ? '' : 's'} = {fmtN(x.agent_hours)} agent-hours × {money(x.rate)} = <b>{money(x.amount)}</b>
                  </div>))}
                {noTerms && <div className="login-err" role="note" style={{ margin: '4px 0' }}>{noTerms.days} day{noTerms.days === 1 ? ' has' : 's have'} no terms yet, so nothing is billed for {noTerms.days === 1 ? 'it' : 'them'}. Set the terms below.</div>}
                {noSched > 0 && <div className="page-sub" role="note" data-noshifts style={{ margin: '2px 0 4px' }}>{noSched} day{noSched === 1 ? ' has' : 's have'} no selected shifts, so {noSched === 1 ? 'it bills' : 'they bill'} nothing. That is right for closed days; if the schedule is not built yet, build it first.</div>}
                {lines.some(x => x.term_id) && retainers.length > 1 && <div style={{ fontSize: 13.5, color: 'var(--ink-soft)' }} data-subtotal>Subtotal for {r.name}: {money(sub / 100)}</div>}
              </div>)
          })}
          {hasBilling && (
            <div style={{ padding: '8px 0', borderTop: '2px solid var(--line)', fontSize: 15 }} data-total>
              <b>Total for {mname}: {fmtN(totalAgentHours)} agent-hours, {money(total / 100)}</b>
            </div>)}

          <h3 style={{ margin: '22px 0 6px', fontSize: 15 }}>The retainers</h3>
          {retainers.map(r => (
            <div key={r.id} data-retainer={r.name} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <h4 style={{ margin: 0, fontSize: 16 }}>{r.name}</h4>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '5px 12px' }} onClick={() => setModal({ kind: 'terms', retainer: r })}>{termsOf(r.id).length ? 'Change the terms from a date' : 'Set the first terms'}</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 10px' }} onClick={() => setModal({ kind: 'rename', retainer: r })} aria-label={`Rename ${r.name}`}>Rename</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 10px' }} onClick={() => deleteRetainer(r)} aria-label={`Delete ${r.name}`}>Delete</button>
                </div>
              </div>
              {termsOf(r.id).length === 0 && <p className="page-sub" style={{ margin: 0 }}>No terms yet, so nothing is billed. Set the first terms: which shifts are part of it, how many agents per hour, and the rate.</p>}
              {termsOf(r.id).map(t => (
                <div key={t.id} data-term={t.effective_from} style={{ borderTop: '1px solid var(--line)', padding: '9px 0', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div><b>From {fmtDate(t.effective_from)}</b> {t.effective_to ? `to ${fmtDate(t.effective_to)}` : 'until changed'} {inEffect(t) && <span className="badge passed" style={{ marginLeft: 6 }}>In effect now</span>}</div>
                    <div>{fmtH(t.agents_per_hour)} agent{Number(t.agents_per_hour) === 1 ? '' : 's'} per hour at {money(t.rate_per_agent_hour)} per agent-hour</div>
                    <div className="page-sub" style={{ margin: '2px 0 0' }}>{describeSource(t)}{t.note ? ` · ${t.note}` : ''}</div>
                  </div>
                  <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 10px', alignSelf: 'flex-start' }} onClick={() => removeTerm(t)} aria-label={`Remove the terms from ${fmtDate(t.effective_from)} (${r.name})`}>Remove</button>
                </div>))}

              <div style={{ fontWeight: 600, fontSize: 14, margin: '12px 0 4px' }}>Closed days and short days</div>
              <p className="page-sub" style={{ margin: '0 0 6px', maxWidth: 640 }}>Normally closed days follow the schedule by themselves. Use this only to override a day: 0 hours means closed.</p>
              <DayForm retainer={r} onSaved={(m) => { flash(m); load() }} onError={setErr} />
              {daysOf(r.id).slice(0, 20).map(d => (
                <div key={d.id} data-day={d.day} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
                  <span><b>{fmtDate(d.day)}</b> · {Number(d.hours_open) === 0 ? 'Closed' : `Open ${fmtH(d.hours_open)} h`}{d.reason ? ` · ${d.reason}` : ''}</span>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => removeDay(d)} aria-label={`Put ${fmtDate(d.day)} back to the schedule (${r.name})`}>Back to the schedule</button>
                </div>))}

              <button className="btn btn-ghost" style={{ fontSize: 12.5, marginTop: 8 }} onClick={() => setOpen({ ...open, [r.id]: !open[r.id] })} aria-expanded={!!open[r.id]} aria-label={`${open[r.id] ? 'Hide' : 'Show'} day by day for ${r.name}`}>{open[r.id] ? 'Hide' : 'Show'} day by day</button>
              {open[r.id] && (
                <div style={{ overflowX: 'auto', marginTop: 8 }} data-days-table={r.name}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead><tr><th style={th}>Day</th><th style={{ ...th, textAlign: 'right' }}>Open hours</th><th style={{ ...th, textAlign: 'right' }}>Agents</th><th style={{ ...th, textAlign: 'right' }}>Agent-hours</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Why</th></tr></thead>
                    <tbody>
                      {rowsOf(r.id).map(p => (
                        <tr key={p.day}>
                          <td style={td}>{DAYS[p.weekday - 1][1]} {fmtDate(p.day)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtN(p.hours_open)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtH(p.agents)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtN(p.agent_hours)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{money(p.amount)}</td>
                          <td style={td}>{p.source === 'exception' ? `${Number(p.hours_open) === 0 ? 'Closed' : 'Short day'}${p.reason ? `: ${p.reason}` : ''}` : p.source === 'no terms' ? 'No terms yet' : p.source === 'schedule' && Number(p.hours_open) === 0 ? 'No selected shifts' : ''}</td>
                        </tr>))}
                    </tbody>
                  </table>
                </div>)}
            </div>))}
        </>
      )}
      {modal?.kind === 'terms' && <TermsModal type={type} retainer={modal.retainer} base={termsOf(modal.retainer.id).find(inEffect) || termsOf(modal.retainer.id)[0] || null} hasTerms={termsOf(modal.retainer.id).length > 0} today={today} roleOptions={roleOptions} onClose={() => setModal(null)} onSaved={(m) => { setModal(null); flash(m); load() }} />}
      {modal?.kind === 'add' && <NameModal title="Add a retainer" help="Give it a name that says what it covers, for example Appointment setting or LSA chat. Each retainer gets its own line on the invoice." action="Add retainer" onClose={() => setModal(null)}
        onSave={async (name) => { const { data, error } = await supabase.rpc('finance_retainer_create', { p_invoice_type: type.id, p_name: name }); if (error) return error.message; await load(); const made = { id: data, name }; setModal({ kind: 'terms', retainer: made }); flash('Retainer added. Now set its terms.'); return '' }} />}
      {modal?.kind === 'rename' && <NameModal title="Rename the retainer" initial={modal.retainer.name} action="Save" onClose={() => setModal(null)}
        onSave={async (name) => { const { error } = await supabase.rpc('finance_retainer_rename', { p_retainer: modal.retainer.id, p_name: name }); if (error) return error.message; setModal(null); flash('Renamed.'); load(); return '' }} />}
    </div>
  )
}

function NameModal({ title, help, initial = '', action, onClose, onSave }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    if (!name.trim()) return setErr('Name the retainer.')
    setBusy(true); const m = await onSave(name.trim()); setBusy(false); if (m) setErr(m)
  }
  return (
    <Modal title={title} onClose={onClose} width={460}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {help && <p className="page-sub" style={{ marginTop: 0 }}>{help}</p>}
      <div className="field"><label htmlFor="rt-name">Name *</label><input id="rt-name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : action}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function TermsModal({ type, retainer, base, hasTerms, today, roleOptions, onClose, onSaved }) {
  const firstOfNext = (() => { const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` })()
  const [f, setF] = useState({
    start: hasTerms ? firstOfNext : `${today.slice(0, 8)}01`,
    agents: base ? fmtH(base.agents_per_hour) : '', rate: base ? Number(base.rate_per_agent_hour).toFixed(2) : '',
    source: base ? base.hours_source : 'schedule',
    roles: base && base.hours_source === 'schedule' ? [...(base.roles || [])] : [],
    hours: DAYS.map(([k]) => base && base.hours_source === 'weekdays' ? fmtH(base[`hours_${k}`]) : ''), note: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [week, setWeek] = useState(null)       // typical open hours per weekday for the chosen shifts
  const agentsN = Number(f.agents), rateN = Number(f.rate)
  const hoursNum = f.hours.map(h => (h === '' ? NaN : Number(h)))
  const rolesKey = [...f.roles].sort().join('|')

  useEffect(() => {
    if (f.source !== 'schedule' || f.roles.length === 0) { setWeek(null); return }
    let alive = true
    supabase.rpc('finance_retainer_role_week', { p_invoice_type: type.id, p_roles: [...f.roles].sort() }).then(({ data, error }) => { if (alive) setWeek(error ? null : data || []) })
    return () => { alive = false }
  }, [rolesKey, f.source, type.id])   // eslint-disable-line

  const weekHours = f.source === 'schedule' ? (week ? week.reduce((s, x) => s + Number(x.hours), 0) : null) : hoursNum.reduce((s, h) => s + (Number.isFinite(h) ? h : 0), 0)
  const weekOk = weekHours != null && weekHours > 0 && agentsN > 0 && f.rate !== '' && Number.isFinite(rateN)
  const toggleRole = (role) => setF(p => ({ ...p, roles: p.roles.includes(role) ? p.roles.filter(x => x !== role) : [...p.roles, role] }))

  async function save() {
    setErr('')
    if (!f.start) return setErr('Choose the date these terms start.')
    if (!(agentsN > 0 && agentsN <= 100)) return setErr('Agents per hour must be more than 0.')
    if (f.rate === '' || !(rateN >= 0)) return setErr('Enter the rate per agent-hour.')
    if (f.source === 'schedule' && f.roles.length === 0) return setErr('Choose at least one shift. The hours open are taken from the shifts you choose.')
    if (f.source === 'weekdays' && hoursNum.some(h => !Number.isFinite(h) || h < 0 || h > 24)) return setErr('Enter the open hours for every day, from 0 to 24. Use 0 for a day you are closed.')
    setBusy(true)
    const { error } = await supabase.rpc('finance_retainer_change_from', {
      p_retainer: retainer.id, p_start: f.start, p_agents: agentsN, p_rate: rateN, p_source: f.source,
      p_roles: f.source === 'schedule' ? [...f.roles].sort() : null, p_hours: f.source === 'weekdays' ? hoursNum : null, p_note: f.note.trim() || null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(`Terms saved for ${retainer.name}. From ${fmtDate(f.start)}, ${fmtH(agentsN)} agent${agentsN === 1 ? '' : 's'} per hour at ${money(rateN)}.`)
  }
  return (
    <Modal title={`${hasTerms ? 'Change the terms from a date' : 'Set the first terms'}: ${retainer.name}`} onClose={onClose} width={680}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ marginTop: 0 }}>{hasTerms ? 'From the start date on, these terms replace the earlier ones. The earlier terms end the day before, so nothing else needs to change. The boxes start with the terms now in effect, so change only what is different.' : 'These terms last until you change them.'}</p>
      <div className="field"><label htmlFor="ct-start">These terms start on *</label><input id="ct-start" type="date" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label htmlFor="ct-agents">Agents billed per hour *</label><input id="ct-agents" inputMode="decimal" value={f.agents} onChange={e => setF({ ...f, agents: e.target.value })} placeholder="e.g. 1.5" />
          <div className="hint">What you bill, which can differ from how many agents are scheduled. Can be a fraction.</div></div>
        <div className="field"><label htmlFor="ct-rate">Rate per agent-hour ($) *</label><input id="ct-rate" inputMode="decimal" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} placeholder="e.g. 32.50" /></div>
      </div>

      <div style={{ fontWeight: 600, fontSize: 14, margin: '4px 0 6px' }}>Where do the hours open come from?</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><input type="radio" name="ct-source" value="schedule" checked={f.source === 'schedule'} onChange={() => setF({ ...f, source: 'schedule' })} /> The schedule: I choose which shifts are part of this retainer</label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><input type="radio" name="ct-source" value="weekdays" checked={f.source === 'weekdays'} onChange={() => setF({ ...f, source: 'weekdays' })} /> Typed hours for each weekday</label>

      {f.source === 'schedule' && (
        <div style={{ margin: '8px 0 10px' }} data-roles>
          <div className="hint" style={{ marginBottom: 6 }}>Pick the shifts that count. The hours open are the time these shifts are open each day on this client's schedules, so closed days and short days follow the schedule automatically. Shifts with no spots are ignored.</div>
          {roleOptions.length === 0 && <p className="page-sub">No shifts were found on this client's schedules in the last 8 weeks, so there is nothing to choose yet.</p>}
          {roleOptions.length > 0 && <div style={{ marginBottom: 4 }}><button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setF({ ...f, roles: roleOptions.map(o => o.role) })}>Select all</button> <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setF({ ...f, roles: [] })}>Clear</button></div>}
          {roleOptions.map(o => (
            <label key={o.role} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
              <input type="checkbox" aria-label={`Include ${o.role}`} checked={f.roles.includes(o.role)} onChange={() => toggleRole(o.role)} style={{ marginTop: 3 }} />
              <span><b>{o.role}</b><span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-soft)' }}>About {o.weekday_hours == null ? '–' : fmtN(o.weekday_hours)} h a day on weekdays, {o.weekend_hours == null ? '–' : fmtN(o.weekend_hours)} h on weekends · seen on {o.days_seen} days, last {fmtDate(o.last_seen)}</span></span>
            </label>))}
          {f.roles.filter(r => !roleOptions.some(o => o.role === r)).map(r => (
            <label key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}><input type="checkbox" aria-label={`Include ${r}`} checked onChange={() => toggleRole(r)} /> <span><b>{r}</b> <span style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>(not on the schedule in the last 8 weeks)</span></span></label>))}
        </div>)}

      {f.source === 'weekdays' && (
        <div style={{ margin: '8px 0 10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {DAYS.map(([k, short, long], i) => (
              <div key={k} className="field" style={{ margin: 0 }}>
                <label htmlFor={`ct-h-${i + 1}`} style={{ fontSize: 12 }}>{short}</label>
                <input id={`ct-h-${i + 1}`} aria-label={`Hours open on ${long}`} inputMode="decimal" value={f.hours[i]} onChange={e => setF({ ...f, hours: f.hours.map((h, j) => (j === i ? e.target.value : h)) })} style={{ width: '100%' }} />
              </div>))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>Use 0 for a day you are closed. Holidays are added separately, so leave them out here.</div>
        </div>)}

      {weekOk && <div className="card" role="status" data-check style={{ margin: '0 0 10px' }}>{f.source === 'schedule' ? 'Based on the last 8 weeks of the schedule, a normal week bills' : 'A normal week bills'} <b>{fmtN(weekHours)} open hours × {fmtH(agentsN)} agents = {fmtN(weekHours * agentsN)} agent-hours × {money(rateN)} = {money(cents(weekHours * agentsN * rateN) / 100)}</b>. Check this against what you expect.</div>}
      <div className="field"><label htmlFor="ct-note">Note (optional)</label><input id="ct-note" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. Becky confirmed 2 agents from November" /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save the terms'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function DayForm({ retainer, onSaved, onError }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [hours, setHours] = useState('0')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const key = (s) => `${s}-${retainer.id}`
  async function add() {
    onError('')
    if (!from) return onError('Choose the day, or the first day of the run.')
    const end = to || from
    if (end < from) return onError('The last day cannot be before the first day.')
    const h = Number(hours)
    if (hours === '' || !(h >= 0 && h <= 24)) return onError('Open hours must be from 0 to 24. Use 0 for closed.')
    setBusy(true)
    const { data, error } = await supabase.rpc('finance_retainer_set_days', { p_retainer: retainer.id, p_from: from, p_to: end, p_hours: h, p_reason: reason.trim() || null })
    setBusy(false)
    if (error) return onError(error.message)
    setFrom(''); setTo(''); setHours('0'); setReason('')
    onSaved(`${data ?? 1} day${(data ?? 1) === 1 ? '' : 's'} saved as ${h === 0 ? 'closed' : `open ${fmtH(h)} h`} for ${retainer.name}.`)
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }} data-dayform={retainer.name}>
      <div className="field" style={{ margin: 0 }}><label htmlFor={key('cd-from')}>Day (or first day)</label><input id={key('cd-from')} data-f="from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div className="field" style={{ margin: 0 }}><label htmlFor={key('cd-to')}>Last day (optional)</label><input id={key('cd-to')} data-f="to" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
      <div className="field" style={{ margin: 0, width: 110 }}><label htmlFor={key('cd-hours')}>Hours open</label><input id={key('cd-hours')} data-f="hours" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} /></div>
      <div className="field" style={{ margin: 0, minWidth: 180 }}><label htmlFor={key('cd-reason')}>Reason</label><input id={key('cd-reason')} data-f="reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Thanksgiving" /></div>
      <button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? 'Saving…' : 'Add closed or short days'}</button>
    </div>
  )
}
