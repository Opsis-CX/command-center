import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'

// ============================================================
// CLIENTS AND BILLING (Admins and Owners)
// Set up, once per client, everything an invoice needs: who is billed and by which company, how often and on what
// day, payment terms, invoice numbering, how the lines are grouped, which client labels roll up into the bill,
// the deals (engagements), and the rate card. Every rate has dates, so changing a rate never rewrites an old invoice.
// Hours are never rounded; the decimals setting only changes how many are shown.
// ============================================================

const DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday']]
const UNITS = [['hour', 'Per hour'], ['call', 'Per call'], ['flat', 'Flat fee']]
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
const dayLabel = (n) => (Number(n) >= 29 ? 'the last day of the month' : `the ${ord(Number(n))}`)
const rateText = (r) => Number(r).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })

export function scheduleSummary(e) {
  if (e.invoice_day == null) return 'Schedule not set up yet'
  const terms = `Net ${e.terms_days}`
  if (e.invoice_frequency === 'weekly') return `Every ${DAYS.find(d => d[0] === e.invoice_day)?.[1]} · ${terms}`
  if (e.invoice_frequency === 'biweekly') return `Every other ${DAYS.find(d => d[0] === e.invoice_day)?.[1]}${e.invoice_anchor ? ` from ${fmtDate(e.invoice_anchor)}` : ''} · ${terms}`
  if (e.invoice_frequency === 'semimonthly') return `Twice a month (${dayLabel(e.invoice_day)} and ${dayLabel(e.invoice_day2)}) · ${terms}`
  return `Monthly on ${dayLabel(e.invoice_day)} · ${terms}`
}
export function numberPreview(e) {
  const yr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 4)
  return [String(e.number_prefix || '').trim() || null, e.number_include_year ? yr : null, String(e.next_number)].filter(Boolean).join('-')
}

const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '9px 10px', fontSize: 13.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' }
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0 16px' }

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

export default function FinanceBilling({ lookups, flash }) {
  const [entities, setEntities] = useState([])
  const [links, setLinks] = useState([])
  const [deals, setDeals] = useState([])
  const [lines, setLines] = useState([])
  const [next, setNext] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const [en, li, de, ra] = await Promise.all([
      supabase.from('finance_billing_entities').select('*').order('name'),
      supabase.from('finance_client_links').select('*'),
      supabase.from('finance_deals').select('*').order('name'),
      supabase.from('finance_rate_lines').select('*').order('sort').order('product_name'),
    ])
    const first = en.error || li.error || de.error || ra.error
    setErr(first ? first.message : '')
    const ents = en.data || []
    setEntities(ents); setLinks(li.data || []); setDeals(de.data || []); setLines(ra.data || [])
    const dates = {}
    await Promise.all(ents.filter(e => e.active && e.invoice_day != null).map(async e => {
      const { data } = await supabase.rpc('finance_next_invoice_date', { p_entity: e.id })
      dates[e.id] = data
    }))
    setNext(dates); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const open = entities.find(e => e.id === openId)
  if (loading) return <p className="page-sub">Loading…</p>

  if (open) return (
    <EntityDetail key={open.id} entity={open} entities={entities} links={links} deals={deals.filter(d => d.entity_id === open.id)}
      lines={lines.filter(l => l.entity_id === open.id)} next={next[open.id]} lookups={lookups} flash={flash}
      onBack={() => setOpenId(null)} reload={load} />
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 640 }}>Each billing entity is one bill. Several client labels can roll up into it, and it has its own schedule, numbering, layout and rate card.</p>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add billing entity</button>
      </div>
      {err && <div className="login-err">{err}</div>}
      {entities.length === 0 && <p className="page-sub">No billing entities yet.</p>}
      {entities.map(e => {
        const nClients = links.filter(l => l.entity_id === e.id).length
        const nRates = lines.filter(l => l.entity_id === e.id && l.active && (!l.effective_to || l.effective_to >= todayET())).length
        return (
          <div key={e.id} style={{ ...panel, marginBottom: 10, cursor: 'pointer', opacity: e.active ? 1 : 0.6 }} onClick={() => setOpenId(e.id)} role="button" tabIndex={0}
            onKeyDown={ev => { if (ev.key === 'Enter') setOpenId(e.id) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{e.name}{!e.active && <span className="badge failed" style={{ marginLeft: 8 }}>inactive</span>}</div>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{e.legal_name || 'Legal name not entered yet'} · billed by {lookups.companies.find(c => c.id === e.issuing_company_id)?.name || 'no company chosen yet'}</div>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{scheduleSummary(e)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{next[e.id] ? `Next invoice ${fmtDate(next[e.id])}` : ''}</div>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{nClients} client label{nClients === 1 ? '' : 's'} · {nRates} current rate{nRates === 1 ? '' : 's'}</div>
              </div>
            </div>
          </div>
        )
      })}
      {adding && <AddEntityModal lookups={lookups} onClose={() => setAdding(false)} onSaved={async (id) => { setAdding(false); await load(); setOpenId(id); flash('Billing entity added. Set up its schedule and rates next.') }} />}
    </div>
  )
}

function AddEntityModal({ lookups, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    if (!name.trim()) return setErr('Give the billing entity a name.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('finance_billing_entities').insert({ name: name.trim(), issuing_company_id: company || null }).select('id').single()
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'A billing entity with that name already exists.' : error.message)
    onSaved(data.id)
  }
  return (
    <Modal title="Add a billing entity" onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="be-name">Name *</label><input id="be-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. GarageCo" autoFocus /></div>
      <div className="field"><label htmlFor="be-co">Which company bills them?</label>
        <select id="be-co" value={company} onChange={e => setCompany(e.target.value)}><option value="">Choose later</option>{lookups.companies.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function EntityDetail({ entity, entities, links, deals, lines, next, lookups, flash, onBack, reload }) {
  const [tab, setTab] = useState('details')
  const TABS = [['details', 'Details'], ['schedule', 'Schedule and numbering'], ['clients', 'Client labels'], ['deals', 'Deals'], ['rates', 'Rate card']]
  return (
    <div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 12 }} onClick={onBack}>← All billing entities</button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{entity.name}</h2>
      <p className="page-sub" style={{ margin: '0 0 14px' }}>{scheduleSummary(entity)}{next ? ` · next invoice ${fmtDate(next)}` : ''}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }} role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} style={chip(tab === k)} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'details' && <DetailsForm entity={entity} lookups={lookups} reload={reload} flash={flash} />}
      {tab === 'schedule' && <ScheduleForm entity={entity} reload={reload} flash={flash} />}
      {tab === 'clients' && <ClientLabels entity={entity} entities={entities} links={links} lookups={lookups} reload={reload} flash={flash} />}
      {tab === 'deals' && <Deals entity={entity} deals={deals} reload={reload} flash={flash} />}
      {tab === 'rates' && <RateCard entity={entity} lines={lines} deals={deals} reload={reload} flash={flash} />}
    </div>
  )
}

// ---------- Details ----------
function DetailsForm({ entity, lookups, reload, flash }) {
  const [f, setF] = useState({
    name: entity.name || '', legal_name: entity.legal_name || '', bill_to_address: entity.bill_to_address || '',
    sameShip: !entity.ship_to_address, ship_to_address: entity.ship_to_address || '',
    contact_name: entity.contact_name || '', contact_email: entity.contact_email || '', contact_phone: entity.contact_phone || '',
    issuing_company_id: entity.issuing_company_id || '', notes: entity.notes || '', active: entity.active,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  async function save() {
    if (!f.name.trim()) return setErr('The entity needs a name.')
    setBusy(true); setErr('')
    const { error } = await supabase.from('finance_billing_entities').update({
      name: f.name.trim(), legal_name: f.legal_name.trim() || null, bill_to_address: f.bill_to_address.trim() || null,
      ship_to_address: f.sameShip ? null : (f.ship_to_address.trim() || null),
      contact_name: f.contact_name.trim() || null, contact_email: f.contact_email.trim() || null, contact_phone: f.contact_phone.trim() || null,
      issuing_company_id: f.issuing_company_id || null, notes: f.notes.trim() || null, active: f.active,
    }).eq('id', entity.id)
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'A billing entity with that name already exists.' : error.message)
    flash('Details saved.'); reload()
  }
  return (
    <div style={panel}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div style={grid2}>
        <div className="field"><label htmlFor="d-name">Name *</label><input id="d-name" value={f.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-legal">Legal name on the invoice</label><input id="d-legal" value={f.legal_name} onChange={e => set('legal_name', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-co">Billed by</label>
          <select id="d-co" value={f.issuing_company_id} onChange={e => set('issuing_company_id', e.target.value)}><option value="">Choose…</option>{lookups.companies.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="d-cn">Contact name</label><input id="d-cn" value={f.contact_name} onChange={e => set('contact_name', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-ce">Contact email</label><input id="d-ce" value={f.contact_email} onChange={e => set('contact_email', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-cp">Contact phone</label><input id="d-cp" value={f.contact_phone} onChange={e => set('contact_phone', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="d-bill">Bill to (address)</label><textarea id="d-bill" rows={3} value={f.bill_to_address} onChange={e => set('bill_to_address', e.target.value)} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontWeight: 500 }}><input type="checkbox" checked={f.sameShip} onChange={e => set('sameShip', e.target.checked)} /> Ship to is the same as bill to</label>
      {!f.sameShip && <div className="field"><label htmlFor="d-ship">Ship to (address)</label><textarea id="d-ship" rows={3} value={f.ship_to_address} onChange={e => set('ship_to_address', e.target.value)} /></div>}
      <div className="field"><label htmlFor="d-notes">Notes</label><textarea id="d-notes" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, fontWeight: 500 }}><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> Active (untick when you no longer bill them)</label>
      <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
    </div>
  )
}

// ---------- Schedule, numbering, layout ----------
function ScheduleForm({ entity, reload, flash }) {
  const [f, setF] = useState({
    invoice_frequency: entity.invoice_frequency, invoice_day: entity.invoice_day ?? '', invoice_day2: entity.invoice_day2 ?? '',
    invoice_anchor: entity.invoice_anchor || '', terms_days: entity.terms_days, number_prefix: entity.number_prefix || '',
    number_include_year: entity.number_include_year, next_number: entity.next_number, group_by: entity.group_by, quantity_decimals: entity.quantity_decimals,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const freq = f.invoice_frequency
  const weekly = freq === 'weekly' || freq === 'biweekly'
  const monthDays = [...Array(28)].map((_, i) => [i + 1, ord(i + 1)]).concat([[31, 'Last day of the month']])
  const changeFreq = (v) => setF(p => ({ ...p, invoice_frequency: v, invoice_day: '', invoice_day2: '' }))

  async function save() {
    setErr('')
    if (f.invoice_day === '') return setErr(weekly ? 'Choose the weekday.' : 'Choose the invoice day.')
    if (freq === 'semimonthly' && (f.invoice_day2 === '' || Number(f.invoice_day2) === Number(f.invoice_day))) return setErr('Choose two different days.')
    if (freq === 'biweekly' && !f.invoice_anchor) return setErr('Pick the first invoice date, so every other week can be counted from it.')
    if (freq === 'biweekly') {
      const iso = ((new Date(f.invoice_anchor + 'T00:00:00').getDay() + 6) % 7) + 1
      if (iso !== Number(f.invoice_day)) return setErr('The first invoice date must fall on the weekday you chose.')
    }
    const terms = Number(f.terms_days), nn = Number(f.next_number)
    if (!(terms >= 0 && terms <= 365)) return setErr('Payment terms must be between 0 and 365 days.')
    if (!(nn >= 1)) return setErr('The next invoice number must be 1 or more.')
    setBusy(true)
    const { error } = await supabase.from('finance_billing_entities').update({
      invoice_frequency: freq, invoice_day: Number(f.invoice_day), invoice_day2: freq === 'semimonthly' ? Number(f.invoice_day2) : null,
      invoice_anchor: freq === 'biweekly' ? f.invoice_anchor : null, terms_days: terms, number_prefix: f.number_prefix.trim(),
      number_include_year: f.number_include_year, next_number: nn, group_by: f.group_by, quantity_decimals: Number(f.quantity_decimals),
    }).eq('id', entity.id)
    setBusy(false)
    if (error) return setErr(error.message)
    flash('Schedule saved.'); reload()
  }
  const preview = numberPreview({ ...f, next_number: f.next_number || 1 })
  return (
    <div style={panel}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>When to invoice</h3>
      <div style={grid2}>
        <div className="field"><label htmlFor="s-freq">How often</label>
          <select id="s-freq" value={freq} onChange={e => changeFreq(e.target.value)}>
            <option value="monthly">Monthly</option><option value="semimonthly">Twice a month</option><option value="biweekly">Every other week</option><option value="weekly">Weekly</option></select></div>
        {weekly ? (
          <div className="field"><label htmlFor="s-day">Weekday</label>
            <select id="s-day" value={f.invoice_day} onChange={e => set('invoice_day', e.target.value)}><option value="">Choose…</option>{DAYS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></div>
        ) : (
          <div className="field"><label htmlFor="s-day">{freq === 'semimonthly' ? 'First day' : 'Day of the month'}</label>
            <select id="s-day" value={f.invoice_day} onChange={e => set('invoice_day', e.target.value)}><option value="">Choose…</option>{monthDays.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></div>
        )}
        {freq === 'semimonthly' && (
          <div className="field"><label htmlFor="s-day2">Second day</label>
            <select id="s-day2" value={f.invoice_day2} onChange={e => set('invoice_day2', e.target.value)}><option value="">Choose…</option>{monthDays.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></div>
        )}
        {freq === 'biweekly' && (
          <div className="field"><label htmlFor="s-anchor">First invoice date</label><input id="s-anchor" type="date" value={f.invoice_anchor} onChange={e => set('invoice_anchor', e.target.value)} /></div>
        )}
        <div className="field"><label htmlFor="s-terms">Payment terms (days)</label><input id="s-terms" inputMode="numeric" value={f.terms_days} onChange={e => set('terms_days', e.target.value)} />
          <div className="hint">The due date is the invoice date plus this many days (Net 30 = 30).</div></div>
      </div>

      <h3 style={{ margin: '14px 0 8px', fontSize: 15 }}>Invoice numbers</h3>
      <div style={grid2}>
        <div className="field"><label htmlFor="s-prefix">Prefix (optional)</label><input id="s-prefix" value={f.number_prefix} onChange={e => set('number_prefix', e.target.value)} placeholder="e.g. GCO" /></div>
        <div className="field"><label htmlFor="s-next">Next number</label><input id="s-next" inputMode="numeric" value={f.next_number} onChange={e => set('next_number', e.target.value)} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontWeight: 500 }}><input type="checkbox" checked={f.number_include_year} onChange={e => set('number_include_year', e.target.checked)} /> Include the year</label>
      <p className="page-sub" style={{ margin: '0 0 6px' }}>The next invoice will be numbered <b>{preview}</b>. Numbers are issued one at a time, so two people can never get the same one.</p>

      <h3 style={{ margin: '14px 0 8px', fontSize: 15 }}>How the invoice is laid out</h3>
      <div style={grid2}>
        <div className="field"><label htmlFor="s-group">Group the lines by</label>
          <select id="s-group" value={f.group_by} onChange={e => set('group_by', e.target.value)}><option value="product">Product or service</option><option value="brand">Brand</option><option value="role">Role</option><option value="person">Person</option></select></div>
        <div className="field"><label htmlFor="s-dec">Decimals shown on quantities</label>
          <select id="s-dec" value={f.quantity_decimals} onChange={e => set('quantity_decimals', e.target.value)}>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select>
          <div className="hint">Hours are never rounded. This only changes how many decimals are shown; amounts round to the cent.</div></div>
      </div>
      <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save schedule'}</button>
    </div>
  )
}

// ---------- Client labels that roll up into this bill ----------
function ClientLabels({ entity, entities, links, lookups, reload, flash }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  async function toggle(c, on) {
    setBusy(c.id); setErr('')
    const { error } = on
      ? await supabase.from('finance_client_links').delete().eq('client_id', c.id)
      : await supabase.from('finance_client_links').insert({ client_id: c.id, entity_id: entity.id })
    setBusy(null)
    if (error) return setErr(error.message)
    flash(on ? `${c.name} removed from this bill.` : `${c.name} added to this bill.`); reload()
  }
  return (
    <div style={panel}>
      <p className="page-sub" style={{ marginTop: 0 }}>Tick every client label that is billed together on {entity.name}'s invoice. A label can belong to only one billing entity.</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      {lookups.clients.map(c => {
        const link = links.find(l => l.client_id === c.id)
        const mine = link?.entity_id === entity.id
        const other = link && !mine ? entities.find(e => e.id === link.entity_id) : null
        return (
          <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--line)', fontWeight: 500, opacity: other ? 0.55 : 1 }}>
            <input type="checkbox" checked={mine} disabled={!!other || busy === c.id} onChange={() => toggle(c, mine)} aria-label={c.name} />
            <span>{c.name}</span>
            {other && <span className="page-sub" style={{ margin: 0 }}>already on {other.name}</span>}
          </label>
        )
      })}
    </div>
  )
}

// ---------- Deals ----------
function Deals({ entity, deals, reload, flash }) {
  const [edit, setEdit] = useState(null)
  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 560 }}>A deal is one engagement with this client. People's pay rates are set per deal, so a new client or a new kind of work becomes a new deal.</p>
        <button className="btn btn-primary" onClick={() => setEdit({})}>+ Add deal</button>
      </div>
      {deals.length === 0 && <p className="page-sub">No deals yet.</p>}
      {deals.map(d => (
        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <div><span style={{ fontWeight: 600 }}>{d.name}</span> <span className={`badge ${d.status === 'active' ? 'passed' : 'failed'}`}>{d.status}</span>
            <div className="page-sub" style={{ margin: 0 }}>{d.start_date ? `Started ${fmtDate(d.start_date)}` : ''}{d.end_date ? ` · ended ${fmtDate(d.end_date)}` : ''}</div></div>
          <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 11px' }} onClick={() => setEdit(d)}>Edit</button>
        </div>
      ))}
      {edit && <DealModal deal={edit} entity={entity} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); flash('Deal saved.') }} />}
    </div>
  )
}
function DealModal({ deal, entity, onClose, onSaved }) {
  const [f, setF] = useState({ name: deal.name || '', status: deal.status || 'active', start_date: deal.start_date || '', end_date: deal.end_date || '', notes: deal.notes || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  async function save() {
    if (!f.name.trim()) return setErr('The deal needs a name.')
    if (f.start_date && f.end_date && f.end_date < f.start_date) return setErr('The end date is before the start date.')
    setBusy(true); setErr('')
    const row = { name: f.name.trim(), status: f.status, start_date: f.start_date || null, end_date: f.end_date || null, notes: f.notes.trim() || null }
    const { error } = deal.id ? await supabase.from('finance_deals').update(row).eq('id', deal.id) : await supabase.from('finance_deals').insert({ ...row, entity_id: entity.id })
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'This client already has a deal with that name.' : error.message)
    onSaved()
  }
  return (
    <Modal title={deal.id ? 'Edit deal' : 'Add a deal'} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="dl-name">Name *</label><input id="dl-name" value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. GCO" /></div>
      <div className="field"><label htmlFor="dl-status">Status</label><select id="dl-status" value={f.status} onChange={e => set('status', e.target.value)}><option value="active">Active</option><option value="ended">Ended</option></select></div>
      <div style={grid2}>
        <div className="field"><label htmlFor="dl-start">Start date</label><input id="dl-start" type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></div>
        <div className="field"><label htmlFor="dl-end">End date</label><input id="dl-end" type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="dl-notes">Notes</label><textarea id="dl-notes" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

// ---------- Rate card ----------
function RateCard({ entity, lines, deals, reload, flash }) {
  const [history, setHistory] = useState(false)
  const [modal, setModal] = useState(null)   // { mode: 'add' | 'edit' | 'change' | 'end', line? }
  const [roles, setRoles] = useState([])
  const today = todayET()
  useEffect(() => { supabase.from('call_types').select('name').order('name').then(({ data }) => setRoles((data || []).map(r => r.name).filter(Boolean))).catch(() => {}) }, [])
  const shown = lines.filter(l => history || (l.active && (!l.effective_to || l.effective_to >= today)))
  const dealName = (id) => deals.find(d => d.id === id)?.name
  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 600 }}>What this client pays, line by line. Every rate has a start date. To change a rate, use <b>Change rate</b>: the old rate ends the day before, so past invoices stay exactly as they were.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={chip(history)} onClick={() => setHistory(!history)}>Show history</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add' })}>+ Add rate</button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr><th style={th}>Product or service</th><th style={th}>Unit</th><th style={{ ...th, textAlign: 'right' }}>Rate</th><th style={th}>Role</th><th style={th}>From</th><th style={th}>To</th><th style={th}></th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td style={td} colSpan={7}>No rates yet. Add what this client pays for, for example an hourly rate or a per-call price.</td></tr>}
            {shown.map(l => {
              const ended = !!l.effective_to && l.effective_to < today
              return (
                <tr key={l.id} style={{ opacity: ended || !l.active ? 0.55 : 1 }}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{l.product_name}</div>
                    <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{[l.description, l.split_by_brand ? 'one line per brand' : '', dealName(l.deal_id) ? `deal: ${dealName(l.deal_id)}` : ''].filter(Boolean).join(' · ')}</div></td>
                  <td style={td}>{UNITS.find(u => u[0] === l.unit)?.[1]}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{rateText(l.rate)}</td>
                  <td style={td}>{l.role || <span style={{ color: 'var(--ink-soft)' }}>Any</span>}</td>
                  <td style={td}>{fmtDate(l.effective_from)}</td>
                  <td style={td}>{l.effective_to ? fmtDate(l.effective_to) : <span style={{ color: 'var(--ink-soft)' }}>open</span>}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {!ended && l.active && <>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px', marginRight: 4 }} onClick={() => setModal({ mode: 'change', line: l })}>Change rate</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px', marginRight: 4 }} onClick={() => setModal({ mode: 'edit', line: l })}>Edit</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={() => setModal({ mode: 'end', line: l })}>End</button>
                    </>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {modal && <RateModal modal={modal} entity={entity} deals={deals} roles={roles} lines={lines} onClose={() => setModal(null)} onSaved={(msg) => { setModal(null); reload(); flash(msg) }} />}
    </div>
  )
}

function RateModal({ modal, entity, deals, roles, onClose, onSaved }) {
  const { mode, line } = modal
  const [f, setF] = useState({
    product_name: line?.product_name || '', description: line?.description || '', unit: line?.unit || 'hour',
    rate: mode === 'change' ? '' : (line?.rate ?? ''), role: line?.role || '', split_by_brand: !!line?.split_by_brand, deal_id: line?.deal_id || '',
    effective_from: mode === 'add' ? todayET() : mode === 'change' ? todayET() : (line?.effective_from || todayET()),
    end_on: todayET(),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const title = { add: 'Add a rate', edit: 'Edit this rate', change: `Change rate: ${line?.product_name}`, end: `End rate: ${line?.product_name}` }[mode]

  async function save() {
    setErr('')
    const dayBefore = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.toLocaleDateString('en-CA') }
    try {
      setBusy(true)
      if (mode === 'end') {
        if (f.end_on < line.effective_from) throw new Error('The end date is before this rate started.')
        const { error } = await supabase.from('finance_rate_lines').update({ effective_to: f.end_on }).eq('id', line.id)
        if (error) throw error
        return onSaved('Rate ended.')
      }
      if (mode === 'edit') {
        const { error } = await supabase.from('finance_rate_lines').update({ description: f.description.trim() || null, role: f.role.trim() || null, split_by_brand: f.split_by_brand, deal_id: f.deal_id || null }).eq('id', line.id)
        if (error) throw error
        return onSaved('Rate saved.')
      }
      if (mode === 'add' && !f.product_name.trim()) throw new Error('Name the product or service.')
      const rate = Number(String(f.rate).replace(/[$,\s]/g, ''))
      if (!(rate >= 0) || f.rate === '') throw new Error('Enter the rate, for example 125 or 0.12.')
      if (mode === 'add') {
        const { error } = await supabase.from('finance_rate_lines').insert({
          entity_id: entity.id, deal_id: f.deal_id || null, product_name: f.product_name.trim(), description: f.description.trim() || null, unit: f.unit, rate,
          role: f.role.trim() || null, split_by_brand: f.split_by_brand, effective_from: f.effective_from,
        })
        if (error) throw error
        return onSaved('Rate added.')
      }
      // change: end the old rate the day before, then start the new one
      if (f.effective_from <= line.effective_from) throw new Error('The new rate must start after the current one started.')
      const oldEnd = line.effective_to
      let { error } = await supabase.from('finance_rate_lines').update({ effective_to: dayBefore(f.effective_from) }).eq('id', line.id)
      if (error) throw error
      const ins = await supabase.from('finance_rate_lines').insert({
        entity_id: entity.id, deal_id: line.deal_id, product_name: line.product_name, description: line.description, unit: line.unit, rate,
        role: line.role, split_by_brand: line.split_by_brand, effective_from: f.effective_from, effective_to: oldEnd, sort: line.sort,
      })
      if (ins.error) { await supabase.from('finance_rate_lines').update({ effective_to: oldEnd }).eq('id', line.id); throw ins.error }
      return onSaved(`New rate starts ${fmtDate(f.effective_from)}. The old rate ended the day before.`)
    } catch (e) { setErr(e.message || 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {mode === 'end' ? (
        <div className="field"><label htmlFor="rt-end">Last day this rate applies</label><input id="rt-end" type="date" value={f.end_on} onChange={e => set('end_on', e.target.value)} /></div>
      ) : (
        <>
          {mode === 'add' && <div className="field"><label htmlFor="rt-name">Product or service *</label><input id="rt-name" value={f.product_name} onChange={e => set('product_name', e.target.value)} placeholder="e.g. Consulting, AI QA Calls" /></div>}
          {mode === 'add' && <div className="field"><label htmlFor="rt-unit">Charged</label><select id="rt-unit" value={f.unit} onChange={e => set('unit', e.target.value)}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
          {mode !== 'edit' && <div className="field"><label htmlFor="rt-rate">{mode === 'change' ? 'New rate (USD)' : 'Rate (USD)'} *</label><input id="rt-rate" inputMode="decimal" value={f.rate} onChange={e => set('rate', e.target.value)} placeholder="0.00" /></div>}
          {mode !== 'edit' && <div className="field"><label htmlFor="rt-from">{mode === 'change' ? 'New rate starts on' : 'Starts on'}</label><input id="rt-from" type="date" value={f.effective_from} onChange={e => set('effective_from', e.target.value)} /></div>}
          {mode !== 'change' && <>
            <div className="field"><label htmlFor="rt-desc">Description on the invoice (optional)</label><input id="rt-desc" value={f.description} onChange={e => set('description', e.target.value)} /></div>
            <div className="field"><label htmlFor="rt-role">Only for this role (optional)</label>
              <input id="rt-role" list="rt-roles" value={f.role} onChange={e => set('role', e.target.value)} placeholder="Leave empty for any role" />
              <datalist id="rt-roles">{roles.map(r => <option key={r} value={r} />)}</datalist></div>
            <div className="field"><label htmlFor="rt-deal">Deal (optional)</label>
              <select id="rt-deal" value={f.deal_id} onChange={e => set('deal_id', e.target.value)}><option value="">Not tied to a deal</option>{deals.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={f.split_by_brand} onChange={e => set('split_by_brand', e.target.checked)} /> Show one line per brand (like AI QA Calls)</label>
          </>}
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : mode === 'end' ? 'End rate' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}
