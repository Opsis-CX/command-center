import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'

// ============================================================
// PEOPLE AND PAY (Admins and Owners)
// How each person is paid: a pay profile (pay type, Rippling employee number, the deal their hours default to)
// and a dated hourly rate for each deal they work (optionally for one role). Everyone except Becky is an hourly
// contractor. A rate change never rewrites the past: the old rate ends the day before the new one starts.
// Each person can see only their own pay (on their own profile); the database enforces that.
// ============================================================

const PAY_TYPES = [['hourly_contractor', 'Hourly contractor'], ['not_paid_here', 'Not paid through Command Center']]
const rateText = (r) => Number(r).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '9px 10px', fontSize: 13.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' }
const dayBefore = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.toLocaleDateString('en-CA') }

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
      supabase.from('profiles').select('id,full_name,role,is_active,client_id').order('full_name'),
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
  const dealLabel = (id) => { const d = deals.find(x => x.id === id); if (!d) return ''; const e = entities.find(x => x.id === d.entity_id); return e ? `${d.name} (${e.name})` : d.name }
  const profileOf = (id) => profiles.find(p => p.profile_id === id)
  const currentRates = (id) => rates.filter(r => r.profile_id === id && r.active && r.effective_from <= today && (!r.effective_to || r.effective_to >= today))

  const shown = useMemo(() => people.filter(p => {
    if (q && !String(p.full_name || '').toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'unset' && profileOf(p.id)) return false
    if (filter === 'agent' && !/\bagent\b/i.test(p.role || '')) return false
    return true
  }), [people, profiles, q, filter])   // eslint-disable-line

  if (loading) return <p className="page-sub">Loading…</p>
  const open = people.find(p => p.id === openId)
  if (open) return <PersonDetail person={open} profile={profileOf(open.id)} rates={rates.filter(r => r.profile_id === open.id)} deals={deals} roles={roles}
    dealLabel={dealLabel} flash={flash} reload={load} onBack={() => setOpenId(null)} />

  const togglePick = (id) => setPicked(picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id])
  const allShownPicked = shown.length > 0 && shown.every(p => picked.includes(p.id))

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }} role="note">
        <b>Only Admins and Owners can see this.</b> No one else can see anyone's pay. Staff cannot see even their own until you turn on
        {' '}<i>Pay visibility</i> in Settings, which is off.
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 640 }}>How each person is paid. Everyone except Becky is an hourly contractor. Tick several people to give them the same rate at once, for example every agent on one deal.</p>
        <button className="btn btn-primary" onClick={() => setBulk(true)} disabled={picked.length === 0}>Set a rate for {picked.length || 'selected'} {picked.length === 1 ? 'person' : 'people'}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="field" style={{ margin: 0, minWidth: 200 }}><label htmlFor="pp-q">Search</label><input id="pp-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Name" /></div>
        <button style={chip(filter === 'all')} onClick={() => setFilter('all')}>Everyone ({people.length})</button>
        <button style={chip(filter === 'unset')} onClick={() => setFilter('unset')}>Not set up yet ({people.filter(p => !profileOf(p.id)).length})</button>
        <button style={chip(filter === 'agent')} onClick={() => setFilter('agent')}>Agents</button>
      </div>
      {deals.length === 0 && <div className="card" style={{ marginBottom: 14 }}>No deals exist yet. Add a deal on the Clients and billing tab first, so pay rates have a deal to attach to.</div>}
      {err && <div className="login-err">{err}</div>}
      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr>
            <th style={th}><input type="checkbox" aria-label="Select everyone shown" checked={allShownPicked} onChange={() => setPicked(allShownPicked ? picked.filter(id => !shown.some(p => p.id === id)) : [...new Set([...picked, ...shown.map(p => p.id)])])} /></th>
            <th style={th}>Person</th><th style={th}>Role</th><th style={th}>Pay</th><th style={th}>Rippling number</th><th style={th}>Current hourly rates</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td style={td} colSpan={7}>Nobody matches.</td></tr>}
            {shown.map(p => {
              const pf = profileOf(p.id); const cur = currentRates(p.id)
              return (
                <tr key={p.id}>
                  <td style={td}><input type="checkbox" aria-label={`Select ${p.full_name}`} checked={picked.includes(p.id)} onChange={() => togglePick(p.id)} /></td>
                  <td style={{ ...td, fontWeight: 600 }}>{p.full_name}</td>
                  <td style={td}>{p.role}</td>
                  <td style={td}>{!pf ? <span className="badge failed">Not set up</span> : pf.pay_type === 'hourly_contractor' ? 'Hourly contractor' : <span style={{ color: 'var(--ink-soft)' }}>Not paid here</span>}</td>
                  <td style={td}>{pf?.rippling_emp_no || <span style={{ color: 'var(--ink-soft)' }}>None</span>}</td>
                  <td style={td}>{cur.length === 0 ? <span style={{ color: 'var(--ink-soft)' }}>{pf?.pay_type === 'not_paid_here' ? '' : 'No rate yet'}</span>
                    : cur.map(r => <div key={r.id}>{rateText(r.hourly_rate)}/hr · {dealLabel(r.deal_id)}{r.role ? ` · ${r.role}` : ''}</div>)}</td>
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
function PersonDetail({ person, profile, rates, deals, roles, dealLabel, flash, reload, onBack }) {
  const [f, setF] = useState({ pay_type: profile?.pay_type || 'hourly_contractor', rippling_emp_no: profile?.rippling_emp_no || '', default_deal_id: profile?.default_deal_id || '' })
  const [history, setHistory] = useState(false)
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const today = todayET()

  async function save() {
    setBusy(true); setErr('')
    const { error } = await supabase.from('finance_pay_profiles').upsert({
      profile_id: person.id, pay_type: f.pay_type, rippling_emp_no: f.rippling_emp_no.trim() || null, default_deal_id: f.default_deal_id || null,
    }, { onConflict: 'profile_id' })
    setBusy(false)
    if (error) return setErr(error.message)
    flash('Pay profile saved.'); reload()
  }
  const shown = rates.filter(r => history || (r.active && (!r.effective_to || r.effective_to >= today)))

  return (
    <div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 12 }} onClick={onBack}>← Everyone</button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>{person.full_name}</h2>
      <p className="page-sub" style={{ margin: '0 0 14px' }}>{person.role}{profile ? '' : ' · no pay profile yet'}</p>

      <div style={{ ...panel, marginBottom: 18 }}>
        {err && <div className="login-err" role="alert">{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0 16px' }}>
          <div className="field"><label htmlFor="pd-type">How they are paid</label>
            <select id="pd-type" value={f.pay_type} onChange={e => set('pay_type', e.target.value)}>{PAY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="pd-rip">Rippling employee number</label><input id="pd-rip" value={f.rippling_emp_no} onChange={e => set('rippling_emp_no', e.target.value)} />
            <div className="hint">Entered once. It is used to fill the Rippling file.</div></div>
          <div className="field"><label htmlFor="pd-deal">The deal their hours go to by default</label>
            <select id="pd-deal" value={f.default_deal_id} onChange={e => set('default_deal_id', e.target.value)}><option value="">None yet</option>{deals.map(d => <option key={d.id} value={d.id}>{dealLabel(d.id)}</option>)}</select>
            <div className="hint">Agent hours come from Five9 and are not tied to a client, so they are counted on this deal.</div></div>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : profile ? 'Save pay profile' : 'Create pay profile'}</button>
      </div>

      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div><h3 style={{ margin: 0, fontSize: 16 }}>Hourly pay rates</h3>
            <p className="page-sub" style={{ margin: '2px 0 0', maxWidth: 560 }}>One rate per deal, and optionally per role. To change a rate use <b>Change rate</b>: the old rate ends the day before, so past pay never changes.</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={chip(history)} onClick={() => setHistory(!history)}>Show history</button>
            <button className="btn btn-primary" onClick={() => setModal({ mode: 'add' })} disabled={deals.length === 0}>+ Add rate</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr><th style={th}>Deal</th><th style={th}>Role</th><th style={{ ...th, textAlign: 'right' }}>Hourly rate</th><th style={th}>From</th><th style={th}>To</th><th style={th}></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td style={td} colSpan={6}>No pay rate yet.</td></tr>}
              {shown.map(r => {
                const ended = !!r.effective_to && r.effective_to < today
                return (
                  <tr key={r.id} style={{ opacity: ended || !r.active ? 0.55 : 1 }}>
                    <td style={{ ...td, fontWeight: 600 }}>{dealLabel(r.deal_id)}</td>
                    <td style={td}>{r.role || <span style={{ color: 'var(--ink-soft)' }}>Any role</span>}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{rateText(r.hourly_rate)}</td>
                    <td style={td}>{fmtDate(r.effective_from)}</td>
                    <td style={td}>{r.effective_to ? fmtDate(r.effective_to) : <span style={{ color: 'var(--ink-soft)' }}>open</span>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{!ended && r.active && <>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px', marginRight: 4 }} onClick={() => setModal({ mode: 'change', rate: r })}>Change rate</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={() => setModal({ mode: 'end', rate: r })}>End</button></>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {modal && <PayRateModal modal={modal} person={person} deals={deals} roles={roles} dealLabel={dealLabel} onClose={() => setModal(null)} onSaved={(m) => { setModal(null); reload(); flash(m) }} />}
    </div>
  )
}

function PayRateModal({ modal, person, deals, roles, dealLabel, onClose, onSaved }) {
  const { mode, rate: line } = modal
  const [f, setF] = useState({ deal_id: line?.deal_id || (deals.length === 1 ? deals[0].id : ''), role: line?.role || '', rate: '', from: todayET(), end_on: todayET() })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const title = { add: `Add a pay rate for ${person.full_name}`, change: 'Change this pay rate', end: 'End this pay rate' }[mode]

  async function save() {
    setErr('')
    try {
      setBusy(true)
      if (mode === 'end') {
        if (f.end_on < line.effective_from) throw new Error('The end date is before this rate started.')
        const { error } = await supabase.from('finance_pay_rates').update({ effective_to: f.end_on }).eq('id', line.id)
        if (error) throw error
        return onSaved('Pay rate ended.')
      }
      if (mode === 'add' && !f.deal_id) throw new Error('Choose which deal this rate is for.')
      const rate = Number(String(f.rate).replace(/[$,\s]/g, ''))
      if (f.rate === '' || !(rate >= 0)) throw new Error('Enter the hourly rate, for example 15 or 32.50.')
      if (mode === 'add') {
        const { error } = await supabase.from('finance_pay_rates').insert({ profile_id: person.id, deal_id: f.deal_id, role: f.role.trim() || null, hourly_rate: rate, effective_from: f.from })
        if (error) throw error
        return onSaved('Pay rate added.')
      }
      if (f.from <= line.effective_from) throw new Error('The new rate must start after the current one started.')
      const oldEnd = line.effective_to
      const up = await supabase.from('finance_pay_rates').update({ effective_to: dayBefore(f.from) }).eq('id', line.id)
      if (up.error) throw up.error
      const ins = await supabase.from('finance_pay_rates').insert({ profile_id: person.id, deal_id: line.deal_id, role: line.role, hourly_rate: rate, effective_from: f.from, effective_to: oldEnd })
      if (ins.error) { await supabase.from('finance_pay_rates').update({ effective_to: oldEnd }).eq('id', line.id); throw ins.error }
      return onSaved(`New pay rate starts ${fmtDate(f.from)}. The old rate ended the day before.`)
    } catch (e) { setErr(e.message || 'Could not save.') } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {mode === 'end' ? (
        <div className="field"><label htmlFor="pr-end">Last day this rate applies</label><input id="pr-end" type="date" value={f.end_on} onChange={e => set('end_on', e.target.value)} /></div>
      ) : (
        <>
          {mode === 'add' && <div className="field"><label htmlFor="pr-deal">Deal *</label>
            <select id="pr-deal" value={f.deal_id} onChange={e => set('deal_id', e.target.value)}><option value="">Choose…</option>{deals.map(d => <option key={d.id} value={d.id}>{dealLabel(d.id)}</option>)}</select></div>}
          {mode === 'add' && <div className="field"><label htmlFor="pr-role">Only for this role (optional)</label>
            <input id="pr-role" list="pr-roles" value={f.role} onChange={e => set('role', e.target.value)} placeholder="Leave empty for any role" />
            <datalist id="pr-roles">{roles.map(r => <option key={r} value={r} />)}</datalist></div>}
          {mode === 'change' && <p className="page-sub" style={{ marginTop: 0 }}>{dealLabel(line.deal_id)}{line.role ? ` · ${line.role}` : ''}, currently {rateText(line.hourly_rate)}/hr.</p>}
          <div className="field"><label htmlFor="pr-rate">{mode === 'change' ? 'New hourly rate (USD)' : 'Hourly rate (USD)'} *</label><input id="pr-rate" inputMode="decimal" value={f.rate} onChange={e => set('rate', e.target.value)} placeholder="0.00" /></div>
          <div className="field"><label htmlFor="pr-from">{mode === 'change' ? 'New rate starts on' : 'Starts on'}</label><input id="pr-from" type="date" value={f.from} onChange={e => set('from', e.target.value)} /></div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : mode === 'end' ? 'End rate' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

// ---------- the same rate for many people ----------
function BulkModal({ people, profiles, deals, roles, dealLabel, onClose, onDone }) {
  const [f, setF] = useState({ deal_id: deals.length === 1 ? deals[0].id : '', role: '', rate: '', from: todayET(), makeDefault: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [skipped, setSkipped] = useState([])
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  async function save() {
    setErr(''); setSkipped([])
    if (!f.deal_id) return setErr('Choose which deal this rate is for.')
    const rate = Number(String(f.rate).replace(/[$,\s]/g, ''))
    if (f.rate === '' || !(rate >= 0)) return setErr('Enter the hourly rate, for example 15.')
    setBusy(true)
    const done = [], fail = []
    for (const p of people) {
      const existing = profiles.find(x => x.profile_id === p.id)
      if (!existing) {
        const { error } = await supabase.from('finance_pay_profiles').upsert({ profile_id: p.id, pay_type: 'hourly_contractor', default_deal_id: f.makeDefault ? f.deal_id : null }, { onConflict: 'profile_id' })
        if (error) { fail.push(`${p.full_name}: ${error.message}`); continue }
      } else if (f.makeDefault && !existing.default_deal_id) {
        await supabase.from('finance_pay_profiles').upsert({ profile_id: p.id, pay_type: existing.pay_type, rippling_emp_no: existing.rippling_emp_no, default_deal_id: f.deal_id }, { onConflict: 'profile_id' })
      }
      const { error } = await supabase.from('finance_pay_rates').insert({ profile_id: p.id, deal_id: f.deal_id, role: f.role.trim() || null, hourly_rate: rate, effective_from: f.from })
      if (error) fail.push(`${p.full_name}: ${/already has a pay rate/i.test(error.message) ? 'already has a rate for that deal and role over those dates' : error.message}`); else done.push(p.full_name)
    }
    setBusy(false)
    if (fail.length) { setSkipped(fail); if (!done.length) return setErr('No rates were added.') ; return setErr(`Added for ${done.length}. ${fail.length} could not be added, listed below. Close this window to finish.`) }
    onDone(`Rate added for ${done.length} ${done.length === 1 ? 'person' : 'people'}.`)
  }
  return (
    <Modal title={`Set a pay rate for ${people.length} ${people.length === 1 ? 'person' : 'people'}`} onClose={() => (skipped.length ? onDone(`Finished with ${skipped.length} skipped.`) : onClose())} width={560}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {skipped.length > 0 && <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>{skipped.map(s => <li key={s}>{s}</li>)}</ul>}
      <p className="page-sub" style={{ marginTop: 0 }}>{people.map(p => p.full_name).join(', ')}</p>
      <div className="field"><label htmlFor="bk-deal">Deal *</label>
        <select id="bk-deal" value={f.deal_id} onChange={e => set('deal_id', e.target.value)}><option value="">Choose…</option>{deals.map(d => <option key={d.id} value={d.id}>{dealLabel(d.id)}</option>)}</select></div>
      <div className="field"><label htmlFor="bk-role">Only for this role (optional)</label>
        <input id="bk-role" list="bk-roles" value={f.role} onChange={e => set('role', e.target.value)} placeholder="Leave empty for any role" />
        <datalist id="bk-roles">{roles.map(r => <option key={r} value={r} />)}</datalist></div>
      <div className="field"><label htmlFor="bk-rate">Hourly rate (USD) *</label><input id="bk-rate" inputMode="decimal" value={f.rate} onChange={e => set('rate', e.target.value)} placeholder="0.00" /></div>
      <div className="field"><label htmlFor="bk-from">Starts on</label><input id="bk-from" type="date" value={f.from} onChange={e => set('from', e.target.value)} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={f.makeDefault} onChange={e => set('makeDefault', e.target.checked)} /> Make this the deal their hours go to, if they don't have one yet</label>
      <p className="page-sub" style={{ margin: '10px 0 0' }}>Anyone without a pay profile gets one, as an hourly contractor.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || skipped.length > 0}>{busy ? 'Saving…' : 'Add the rate'}</button>
        <button className="btn btn-ghost" onClick={() => (skipped.length ? onDone(`Finished with ${skipped.length} skipped.`) : onClose())} disabled={busy}>{skipped.length ? 'Close' : 'Cancel'}</button>
      </div>
    </Modal>
  )
}
