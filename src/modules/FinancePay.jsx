import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'

// ============================================================
// PEOPLE AND PAY (Admins and Owners)
// How each person is paid, and their job title (set here by an Admin or Owner; it also shows on their profile page).
//   Team:  Deal team = paid per deal (a person can be on several deals, with a rate for each).
//          Internal team = one rate that applies across every deal (it is not tied to a deal).
//   Pay:   Hourly, or Salary (a fixed amount per week, every other week, twice a month, month or year).
// A change never rewrites the past: the old rate ends the day before the new one starts.
// Each person can see only their own pay, and only when Pay visibility is switched on in Settings.
// ============================================================

const PAY_TYPES = [['hourly_contractor', 'Hourly'], ['salary', 'Salary'], ['not_paid_here', 'Not paid through Command Center']]
const TEAMS = [['deal_team', 'Deal team (paid per deal)'], ['internal_team', 'Internal team (one rate across every deal)']]
const PERIODS = [['week', 'Per week'], ['biweekly', 'Every other week'], ['semimonthly', 'Twice a month (each payment)'], ['month', 'Per month'], ['year', 'Per year']]
const money = (n, max = 4) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: max })
export const payText = (r) => r.rate_type === 'salary'
  ? `${money(r.salary_amount, 2)} ${(PERIODS.find(p => p[0] === r.salary_period)?.[1] || '').toLowerCase()}`
  : `${money(r.hourly_rate)}/hr`
const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '9px 10px', fontSize: 13.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' }
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }
const dayBefore = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.toLocaleDateString('en-CA') }
const num = (v) => Number(String(v).replace(/[$,\s]/g, ''))

function Modal({ title, onClose, children, width = 540 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export default function FinancePay({ flash }) {
  const [people, setPeople] = useState([])
  const [profiles, setProfiles] = useState([])
  const [rates, setRates] = useState([])
  const [deals, setDeals] = useState([])
  const [entities, setEntities] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([])
  const [openId, setOpenId] = useState(null)
  const [bulk, setBulk] = useState(false)

  const load = useCallback(async () => {
    const [pe, pp, pr, de, en, ct] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role,job_title,is_active,client_id').order('full_name'),
      supabase.from('finance_pay_profiles').select('*'),
      supabase.from('finance_pay_rates').select('*').order('effective_from', { ascending: false }),
      supabase.from('finance_deals').select('id,name,status,entity_id').order('name'),
      supabase.from('finance_billing_entities').select('id,name'),
      supabase.from('call_types').select('name').order('name'),
    ])
    const first = pe.error || pp.error || pr.error || de.error
    setErr(first ? first.message : '')
    setPeople((pe.data || []).filter(p => p.is_active !== false && !p.client_id && !['csr', 'client'].includes(String(p.role || '').toLowerCase())))
    setProfiles(pp.data || []); setRates(pr.data || []); setDeals(de.data || []); setEntities(en.data || [])
    setRoles((ct.data || []).map(r => r.name).filter(Boolean))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const today = todayET()
  const dealLabel = (id) => { if (!id) return 'All deals'; const d = deals.find(x => x.id === id); if (!d) return ''; const e = entities.find(x => x.id === d.entity_id); return e ? `${d.name} (${e.name})` : d.name }
  const profileOf = (id) => profiles.find(p => p.profile_id === id)
  const isCurrent = (r) => r.active && r.effective_from <= today && (!r.effective_to || r.effective_to >= today)
  const currentRates = (id) => rates.filter(r => r.profile_id === id && isCurrent(r))

  const shown = useMemo(() => people.filter(p => {
    if (q && !`${p.full_name || ''} ${p.job_title || ''}`.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'unset' && profileOf(p.id)) return false
    if (filter === 'agent' && !/\bagent\b/i.test(p.role || '')) return false
    if (filter === 'internal' && profileOf(p.id)?.team_type !== 'internal_team') return false
    return true
  }), [people, profiles, q, filter])   // eslint-disable-line

  if (loading) return <p className="page-sub">Loading…</p>
  const open = people.find(p => p.id === openId)
  if (open) return <PersonDetail person={open} profile={profileOf(open.id)} rates={rates.filter(r => r.profile_id === open.id)} deals={deals} roles={roles}
    titles={[...new Set(people.map(x => x.job_title).filter(Boolean))].sort()} dealLabel={dealLabel} flash={flash} reload={load} onBack={() => setOpenId(null)} />

  const togglePick = (id) => setPicked(picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id])
  const allShownPicked = shown.length > 0 && shown.every(p => picked.includes(p.id))

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }} role="note">
        <b>Only Admins and Owners can see this.</b> No one else can see anyone's pay. Staff cannot see even their own until you turn on
        {' '}<i>Pay visibility</i> in Settings, which is off.
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 640 }}>How each person is paid. Everyone except Becky is a contractor. People on the deal team are paid per deal, and the internal team has one rate across every deal. Tick several people to set the same pay for all of them at once.</p>
        <button className="btn btn-primary" onClick={() => setBulk(true)} disabled={picked.length === 0}>Set pay for {picked.length || 'selected'} {picked.length === 1 ? 'person' : 'people'}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="field" style={{ margin: 0, minWidth: 200 }}><label htmlFor="pp-q">Search</label><input id="pp-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or job title" /></div>
        <button style={chip(filter === 'all')} onClick={() => setFilter('all')}>Everyone ({people.length})</button>
        <button style={chip(filter === 'unset')} onClick={() => setFilter('unset')}>Not set up yet ({people.filter(p => !profileOf(p.id)).length})</button>
        <button style={chip(filter === 'agent')} onClick={() => setFilter('agent')}>Agents</button>
        <button style={chip(filter === 'internal')} onClick={() => setFilter('internal')}>Internal team ({profiles.filter(p => p.team_type === 'internal_team').length})</button>
      </div>
      {deals.length === 0 && <div className="card" style={{ marginBottom: 14 }}>No deals exist yet. Add a deal on the Clients and billing tab first, so deal-team pay rates have a deal to attach to.</div>}
      {err && <div className="login-err">{err}</div>}
      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr>
            <th style={th}><input type="checkbox" aria-label="Select everyone shown" checked={allShownPicked} onChange={() => setPicked(allShownPicked ? picked.filter(id => !shown.some(p => p.id === id)) : [...new Set([...picked, ...shown.map(p => p.id)])])} /></th>
            <th style={th}>Person</th><th style={th}>Job title</th><th style={th}>Access role</th><th style={th}>Pay</th><th style={th}>Rippling number</th><th style={th}>Current pay</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td style={td} colSpan={8}>Nobody matches.</td></tr>}
            {shown.map(p => {
              const pf = profileOf(p.id); const cur = currentRates(p.id)
              return (
                <tr key={p.id}>
                  <td style={td}><input type="checkbox" aria-label={`Select ${p.full_name}`} checked={picked.includes(p.id)} onChange={() => togglePick(p.id)} /></td>
                  <td style={{ ...td, fontWeight: 600 }}>{p.full_name}</td>
                  <td style={td}>{p.job_title || <span style={{ color: 'var(--ink-soft)' }}>Not set</span>}</td>
                  <td style={td}>{p.role}</td>
                  <td style={td}>{!pf ? <span className="badge failed">Not set up</span> : <>
                    <div>{PAY_TYPES.find(t => t[0] === pf.pay_type)?.[1]}</div>
                    <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{pf.team_type === 'internal_team' ? 'Internal team' : 'Deal team'}</div></>}</td>
                  <td style={td}>{pf?.rippling_emp_no || <span style={{ color: 'var(--ink-soft)' }}>None</span>}</td>
                  <td style={td}>{cur.length === 0 ? <span style={{ color: 'var(--ink-soft)' }}>{pf?.pay_type === 'not_paid_here' ? '' : 'No rate yet'}</span>
                    : cur.map(r => <div key={r.id}>{payText(r)} · {dealLabel(r.deal_id)}{r.role ? ` · ${r.role}` : ''}</div>)}</td>
                  <td style={td}><button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 11px' }} onClick={() => setOpenId(p.id)}>Open</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {bulk && <BulkModal people={people.filter(p => picked.includes(p.id))} profiles={profiles} deals={deals} roles={roles} dealLabel={dealLabel} onClose={() => setBulk(false)}
        onDone={(msg) => { setBulk(false); setPicked([]); load(); flash(msg) }} />}
    </div>
  )
}

// ---------- one person ----------
function PersonDetail({ person, profile, rates, deals, roles, titles, dealLabel, flash, reload, onBack }) {
  const [f, setF] = useState({
    team_type: profile?.team_type || 'deal_team', pay_type: profile?.pay_type || 'hourly_contractor',
    rippling_emp_no: profile?.rippling_emp_no || '', default_deal_id: profile?.default_deal_id || '',
  })
  const [history, setHistory] = useState(false)
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const today = todayET()
  const current = rates.filter(r => r.active && r.effective_from <= today && (!r.effective_to || r.effective_to >= today))
  const teamLocked = !!profile && current.length > 0
  const internal = f.team_type === 'internal_team'

  async function save() {
    setBusy(true); setErr('')
    const { error } = await supabase.from('finance_pay_profiles').upsert({
      profile_id: person.id, team_type: f.team_type, pay_type: f.pay_type, rippling_emp_no: f.rippling_emp_no.trim() || null,
      default_deal_id: internal ? null : (f.default_deal_id || null),
    }, { onConflict: 'profile_id' })
    setBusy(false)
    if (error) return setErr(error.message)
    flash('Pay profile saved.'); reload()
  }
  const shown = rates.filter(r => history || (r.active && (!r.effective_to || r.effective_to >= today)))
  const canAdd = profile && f.pay_type !== 'not_paid_here' && (internal || deals.length > 0)

  return (
    <div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 12 }} onClick={onBack}>← Everyone</button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>{person.full_name}</h2>
      <p className="page-sub" style={{ margin: '0 0 14px' }}>{person.job_title || 'No job title yet'} · access role: {person.role}{profile ? '' : ' · no pay profile yet'}</p>
      <JobTitle person={person} titles={titles} flash={flash} reload={reload} />

      <div style={{ ...panel, marginBottom: 18 }}>
        {err && <div className="login-err" role="alert">{err}</div>}
        <div style={grid2}>
          <div className="field"><label htmlFor="pd-team">Team</label>
            <select id="pd-team" value={f.team_type} onChange={e => set('team_type', e.target.value)} disabled={teamLocked}>{TEAMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <div className="hint">{teamLocked ? 'End their current pay rates below before changing their team.' : internal ? 'One rate that applies to work on every deal.' : 'Paid separately for each deal they work on.'}</div></div>
          <div className="field"><label htmlFor="pd-type">How they are paid</label>
            <select id="pd-type" value={f.pay_type} onChange={e => set('pay_type', e.target.value)}>{PAY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="pd-rip">Rippling employee number</label><input id="pd-rip" value={f.rippling_emp_no} onChange={e => set('rippling_emp_no', e.target.value)} />
            <div className="hint">Entered once. It is used to fill the Rippling file.</div></div>
          {!internal && <div className="field"><label htmlFor="pd-deal">The deal their hours go to by default</label>
            <select id="pd-deal" value={f.default_deal_id} onChange={e => set('default_deal_id', e.target.value)}><option value="">None yet</option>{deals.map(d => <option key={d.id} value={d.id}>{dealLabel(d.id)}</option>)}</select>
            <div className="hint">Agent hours come from Five9 and are not tied to a client, so they are counted on this deal.</div></div>}
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : profile ? 'Save pay profile' : 'Create pay profile'}</button>
      </div>

      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div><h3 style={{ margin: 0, fontSize: 16 }}>{internal ? 'Pay (applies to every deal)' : 'Pay by deal'}</h3>
            <p className="page-sub" style={{ margin: '2px 0 0', maxWidth: 560 }}>
              {internal ? 'One rate, hourly or a salary, that applies to all of this person\'s work.' : 'Tick every deal this person works on and enter what they are paid on each.'} To change an amount use <b>Change</b>: the old one ends the day before, so past pay never changes.
            </p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={chip(history)} onClick={() => setHistory(!history)}>Show history</button>
            <button className="btn btn-primary" onClick={() => setModal({ mode: 'add' })} disabled={!canAdd}>{internal ? '+ Add pay' : '+ Add pay for deals'}</button>
          </div>
        </div>
        {!profile && <p className="page-sub" style={{ margin: '0 0 8px' }}>Create the pay profile above first.</p>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr><th style={th}>Deal</th><th style={th}>Role</th><th style={{ ...th, textAlign: 'right' }}>Pay</th><th style={th}>From</th><th style={th}>To</th><th style={th}></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td style={td} colSpan={6}>No pay yet.</td></tr>}
              {shown.map(r => {
                const ended = !!r.effective_to && r.effective_to < today
                return (
                  <tr key={r.id} style={{ opacity: ended || !r.active ? 0.55 : 1 }}>
                    <td style={{ ...td, fontWeight: 600 }}>{dealLabel(r.deal_id)}</td>
                    <td style={td}>{r.role || <span style={{ color: 'var(--ink-soft)' }}>Any role</span>}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{payText(r)}</td>
                    <td style={td}>{fmtDate(r.effective_from)}</td>
                    <td style={td}>{r.effective_to ? fmtDate(r.effective_to) : <span style={{ color: 'var(--ink-soft)' }}>open</span>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{!ended && r.active && <>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px', marginRight: 4 }} onClick={() => setModal({ mode: 'change', rate: r })}>Change</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={() => setModal({ mode: 'end', rate: r })}>End</button></>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {modal && <PayModal modal={modal} person={person} internal={internal} defaultBasis={f.pay_type === 'salary' ? 'salary' : 'hourly'} deals={deals} roles={roles} dealLabel={dealLabel}
        onClose={() => setModal(null)} onSaved={(m) => { setModal(null); reload(); flash(m) }} />}
    </div>
  )
}

// amount + (period) fields shared by the add, change and bulk windows
function AmountFields({ basis, setBasis, period, setPeriod, idPrefix, showBasis = true }) {
  return (
    <>
      {showBasis && <div className="field"><label htmlFor={`${idPrefix}-basis`}>Paid</label>
        <select id={`${idPrefix}-basis`} value={basis} onChange={e => setBasis(e.target.value)}><option value="hourly">Hourly</option><option value="salary">Salary</option></select></div>}
      {basis === 'salary' && <div className="field"><label htmlFor={`${idPrefix}-period`}>Salary is paid</label>
        <select id={`${idPrefix}-period`} value={period} onChange={e => setPeriod(e.target.value)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
    </>
  )
}
const rowFor = (profile_id, deal_id, role, basis, period, amount, from, to = null) => ({
  profile_id, deal_id, role: role || null, rate_type: basis, effective_from: from, effective_to: to,
  hourly_rate: basis === 'hourly' ? amount : null, salary_amount: basis === 'salary' ? amount : null, salary_period: basis === 'salary' ? period : null,
})

function PayModal({ modal, person, internal, defaultBasis, deals, roles, dealLabel, onClose, onSaved }) {
  const { mode, rate: line } = modal
  const [basis, setBasis] = useState(line?.rate_type || defaultBasis)
  const [period, setPeriod] = useState(line?.salary_period || 'month')
  const [role, setRole] = useState('')
  const [from, setFrom] = useState(todayET())
  const [endOn, setEndOn] = useState(todayET())
  const [amount, setAmount] = useState('')
  const [ticked, setTicked] = useState(deals.length === 1 && !internal ? { [deals[0].id]: '' } : {})
  const [fill, setFill] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [failed, setFailed] = useState([])
  const title = { add: internal ? `Add pay for ${person.full_name}` : `Add pay for ${person.full_name} on deals`, change: 'Change this pay', end: 'End this pay' }[mode]
  const amountWord = basis === 'salary' ? 'Salary amount (USD)' : 'Hourly rate (USD)'

  async function save() {
    setErr(''); setFailed([])
    try {
      setBusy(true)
      if (mode === 'end') {
        if (endOn < line.effective_from) throw new Error('The end date is before this started.')
        const { error } = await supabase.from('finance_pay_rates').update({ effective_to: endOn }).eq('id', line.id)
        if (error) throw error
        return onSaved('Pay ended.')
      }
      if (mode === 'change') {
        const amt = num(amount)
        if (amount === '' || !(amt >= 0)) throw new Error(basis === 'salary' ? 'Enter the salary amount.' : 'Enter the hourly rate, for example 15 or 32.50.')
        if (from <= line.effective_from) throw new Error('The new amount must start after the current one started.')
        const oldEnd = line.effective_to
        const up = await supabase.from('finance_pay_rates').update({ effective_to: dayBefore(from) }).eq('id', line.id)
        if (up.error) throw up.error
        const ins = await supabase.from('finance_pay_rates').insert(rowFor(person.id, line.deal_id, line.role, basis, period, amt, from, oldEnd))
        if (ins.error) { await supabase.from('finance_pay_rates').update({ effective_to: oldEnd }).eq('id', line.id); throw ins.error }
        return onSaved(`New pay starts ${fmtDate(from)}. The old one ended the day before.`)
      }
      // add
      if (internal) {
        const amt = num(amount)
        if (amount === '' || !(amt >= 0)) throw new Error(basis === 'salary' ? 'Enter the salary amount.' : 'Enter the hourly rate, for example 15 or 32.50.')
        const { error } = await supabase.from('finance_pay_rates').insert(rowFor(person.id, null, role, basis, period, amt, from))
        if (error) throw error
        return onSaved('Pay added.')
      }
      const ids = Object.keys(ticked)
      if (ids.length === 0) throw new Error('Tick at least one deal.')
      const missing = ids.filter(id => ticked[id] === '' || !(num(ticked[id]) >= 0))
      if (missing.length) throw new Error(`Enter ${basis === 'salary' ? 'a salary' : 'an hourly rate'} for ${missing.map(dealLabel).join(', ')}.`)
      const done = [], bad = []
      for (const id of ids) {
        const { error } = await supabase.from('finance_pay_rates').insert(rowFor(person.id, id, role, basis, period, num(ticked[id]), from))
        if (error) bad.push(`${dealLabel(id)}: ${/already has a pay rate/i.test(error.message) ? 'already has pay for that deal and role over those dates' : error.message}`); else done.push(id)
      }
      if (bad.length) { setFailed(bad); setTicked(Object.fromEntries(ids.filter(id => !done.includes(id)).map(id => [id, ticked[id]]))); throw new Error(done.length ? `Added for ${done.length} deal${done.length === 1 ? '' : 's'}. The rest could not be added, listed below.` : 'Nothing was added.') }
      return onSaved(`Pay added for ${done.length} deal${done.length === 1 ? '' : 's'}.`)
    } catch (e) { setErr(e.message || 'Could not save.') } finally { setBusy(false) }
  }

  const toggleDeal = (id) => setTicked(t => { const n = { ...t }; if (id in n) delete n[id]; else n[id] = fill; return n })
  return (
    <Modal title={title} onClose={onClose} width={mode === 'add' && !internal ? 620 : 520}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {failed.length > 0 && <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>{failed.map(s => <li key={s}>{s}</li>)}</ul>}
      {mode === 'end' ? (
        <div className="field"><label htmlFor="pr-end">Last day this applies</label><input id="pr-end" type="date" value={endOn} onChange={e => setEndOn(e.target.value)} /></div>
      ) : (
        <>
          {mode === 'change' && <p className="page-sub" style={{ marginTop: 0 }}>{dealLabel(line.deal_id)}{line.role ? ` · ${line.role}` : ''}, currently {payText(line)}.</p>}
          <AmountFields basis={basis} setBasis={setBasis} period={period} setPeriod={setPeriod} idPrefix="pr" />
          {mode === 'add' && !internal ? (
            <div className="field"><label id="pr-deals-label">Deals (tick every deal, then enter the amount for each) *</label>
              <div role="group" aria-labelledby="pr-deals-label">
                {deals.map(d => (
                  <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, fontWeight: 500, margin: 0 }}>
                      <input type="checkbox" aria-label={`Include ${dealLabel(d.id)}`} checked={d.id in ticked} onChange={() => toggleDeal(d.id)} /> {dealLabel(d.id)}
                    </label>
                    {d.id in ticked && <input aria-label={`Amount for ${dealLabel(d.id)}`} inputMode="decimal" style={{ width: 120, padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}
                      placeholder="0.00" value={ticked[d.id]} onChange={e => setTicked(t => ({ ...t, [d.id]: e.target.value }))} />}
                  </div>
                ))}
              </div>
              {Object.keys(ticked).length > 1 && <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <input aria-label="One amount for every ticked deal" inputMode="decimal" style={{ width: 120, padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }} placeholder="0.00" value={fill} onChange={e => setFill(e.target.value)} />
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setTicked(t => Object.fromEntries(Object.keys(t).map(id => [id, fill])))}>Use this for every ticked deal</button></div>}
            </div>
          ) : (
            <div className="field"><label htmlFor="pr-amount">{mode === 'change' ? `New ${amountWord.toLowerCase()}` : amountWord} *</label><input id="pr-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></div>
          )}
          {mode === 'add' && <div className="field"><label htmlFor="pr-role">Only for this role (optional)</label>
            <input id="pr-role" list="pr-roles" value={role} onChange={e => setRole(e.target.value)} placeholder="Leave empty for any role" />
            <datalist id="pr-roles">{roles.map(r => <option key={r} value={r} />)}</datalist></div>}
          <div className="field"><label htmlFor="pr-from">{mode === 'change' ? 'New amount starts on' : 'Starts on'}</label><input id="pr-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : mode === 'end' ? 'End' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{failed.length ? 'Close' : 'Cancel'}</button>
      </div>
    </Modal>
  )
}

// ---------- the same pay for many people ----------
function BulkModal({ people, profiles, deals, roles, dealLabel, onClose, onDone }) {
  const [team, setTeam] = useState('deal_team')
  const [basis, setBasis] = useState('hourly')
  const [period, setPeriod] = useState('month')
  const [dealIds, setDealIds] = useState(deals.length === 1 ? [deals[0].id] : [])
  const [amount, setAmount] = useState('')
  const [role, setRole] = useState('')
  const [from, setFrom] = useState(todayET())
  const [makeDefault, setMakeDefault] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [skipped, setSkipped] = useState([])
  const internal = team === 'internal_team'

  async function save() {
    setErr(''); setSkipped([])
    const amt = num(amount)
    if (!internal && dealIds.length === 0) return setErr('Tick at least one deal.')
    if (amount === '' || !(amt >= 0)) return setErr(basis === 'salary' ? 'Enter the salary amount.' : 'Enter the hourly rate, for example 15.')
    setBusy(true)
    const done = [], fail = []
    const payType = basis === 'salary' ? 'salary' : 'hourly_contractor'
    for (const p of people) {
      const existing = profiles.find(x => x.profile_id === p.id)
      const profileRow = { profile_id: p.id, team_type: team, pay_type: payType, rippling_emp_no: existing?.rippling_emp_no || null,
        default_deal_id: internal ? null : (existing?.default_deal_id || (makeDefault ? dealIds[0] : null)) }
      const up = await supabase.from('finance_pay_profiles').upsert(profileRow, { onConflict: 'profile_id' })
      if (up.error) { fail.push(`${p.full_name}: ${up.error.message}`); continue }
      const targets = internal ? [null] : dealIds
      let any = false
      for (const d of targets) {
        const { error } = await supabase.from('finance_pay_rates').insert(rowFor(p.id, d, role, basis, period, amt, from))
        if (error) fail.push(`${p.full_name}${d ? ` on ${dealLabel(d)}` : ''}: ${/already has a pay rate/i.test(error.message) ? 'already has pay for that deal and role over those dates' : error.message}`); else any = true
      }
      if (any) done.push(p.full_name)
    }
    setBusy(false)
    if (fail.length) { setSkipped(fail); return setErr(done.length ? `Added for ${done.length}. Some could not be added, listed below. Close this window to finish.` : 'Nothing was added.') }
    onDone(`Pay added for ${done.length} ${done.length === 1 ? 'person' : 'people'}.`)
  }
  const finish = () => (skipped.length ? onDone(`Finished with ${skipped.length} skipped.`) : onClose())
  return (
    <Modal title={`Set pay for ${people.length} ${people.length === 1 ? 'person' : 'people'}`} onClose={finish} width={600}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {skipped.length > 0 && <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>{skipped.map(s => <li key={s}>{s}</li>)}</ul>}
      <p className="page-sub" style={{ marginTop: 0 }}>{people.map(p => p.full_name).join(', ')}</p>
      <div className="field"><label htmlFor="bk-team">Team</label>
        <select id="bk-team" value={team} onChange={e => setTeam(e.target.value)}>{TEAMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <AmountFields basis={basis} setBasis={setBasis} period={period} setPeriod={setPeriod} idPrefix="bk" />
      {!internal && <div className="field"><label id="bk-deals-label">Deals (the same amount is added for each one you tick) *</label>
        <div role="group" aria-labelledby="bk-deals-label">{deals.map(d => (
          <label key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', fontWeight: 500 }}>
            <input type="checkbox" aria-label={`Include ${dealLabel(d.id)}`} checked={dealIds.includes(d.id)} onChange={() => setDealIds(dealIds.includes(d.id) ? dealIds.filter(x => x !== d.id) : [...dealIds, d.id])} /> {dealLabel(d.id)}
          </label>))}</div></div>}
      <div className="field"><label htmlFor="bk-amount">{basis === 'salary' ? 'Salary amount (USD)' : 'Hourly rate (USD)'} *</label><input id="bk-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></div>
      <div className="field"><label htmlFor="bk-role">Only for this role (optional)</label>
        <input id="bk-role" list="bk-roles" value={role} onChange={e => setRole(e.target.value)} placeholder="Leave empty for any role" />
        <datalist id="bk-roles">{roles.map(r => <option key={r} value={r} />)}</datalist></div>
      <div className="field"><label htmlFor="bk-from">Starts on</label><input id="bk-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
      {!internal && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} /> Make the first deal their default, if they don't have one yet</label>}
      <p className="page-sub" style={{ margin: '10px 0 0' }}>Anyone without a pay profile gets one. If someone is on a different team and still has current pay, they are skipped and named.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || skipped.length > 0}>{busy ? 'Saving…' : 'Add the pay'}</button>
        <button className="btn btn-ghost" onClick={finish} disabled={busy}>{skipped.length ? 'Close' : 'Cancel'}</button>
      </div>
    </Modal>
  )
}

// ---------- job title (set by an Admin or Owner; not pay information) ----------
function JobTitle({ person, titles, flash, reload }) {
  const [title, setTitle] = useState(person.job_title || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const changed = title.trim() !== (person.job_title || '')
  async function save() {
    setBusy(true); setErr('')
    const { error } = await supabase.from('profiles').update({ job_title: title.trim() || null }).eq('id', person.id)
    setBusy(false)
    if (error) return setErr(error.message)
    flash(title.trim() ? 'Job title saved.' : 'Job title cleared.'); reload()
  }
  return (
    <div style={{ ...panel, marginBottom: 18 }}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 240 }}>
          <label htmlFor="pd-title">Job title</label>
          <input id="pd-title" list="pd-titles" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Quality Lead" />
          <datalist id="pd-titles">{(titles || []).map(t => <option key={t} value={t} />)}</datalist>
          <div className="hint">Shown on their profile page. This is a title, not an access level, and only Admins and Owners can change it.</div>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save job title'}</button>
      </div>
    </div>
  )
}
