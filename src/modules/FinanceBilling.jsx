import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'
import FinanceCoverage from './FinanceCoverage'
import { ClientList, ClientPage } from './FinanceClients'

// ============================================================
// CLIENTS AND BILLING (Admins and Owners)
// Set up, once per client: who is billed, which client labels roll up into the bill, the deals (engagements), and one
// or more INVOICES. Each invoice has its own issuing company, schedule, payment terms, numbering and layout, and its own
// rate lines. Example: GarageCo has a Consulting invoice on the 1st and a Call center invoice on the 15th.
// Every rate has dates, so changing a rate never rewrites an old invoice. Hours are never rounded; the decimals
// setting only changes how many are shown.
// The front door is the CLIENTS list: every client in Command Center, each set up once as invoiced or internal (see FinanceClients.jsx).
// The "Billed to" view below it keeps the bills (billing entities) with their invoices, retainers and rates.
// An invoice is billed either BY THE HOUR (tagged hours x the rate card) or AS A RETAINER (hours open x agents per hour x
// rate, with dated terms and closed days). GarageCo's Call center is a retainer, so it has terms instead of rate lines.
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
  const [types, setTypes] = useState([])
  const [next, setNext] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [clientsAll, setClientsAll] = useState([])
  const [profiles, setProfiles] = useState([])
  const [contacts, setContacts] = useState([])
  const [retainers, setRetainers] = useState([])
  const [terms, setTerms] = useState([])
  const [caps, setCaps] = useState([])
  const [view, setView] = useState('clients')
  const [openClient, setOpenClient] = useState(null)
  const [fromClient, setFromClient] = useState(false)

  const load = useCallback(async () => {
    const [en, li, de, ra, ty, cl, pr, co, rt, tm, cp] = await Promise.all([
      supabase.from('finance_billing_entities').select('*').order('name'),
      supabase.from('finance_client_links').select('*'),
      supabase.from('finance_deals').select('*').order('name'),
      supabase.from('finance_rate_lines').select('*').order('sort').order('product_name'),
      supabase.from('finance_invoice_types').select('*').order('sort').order('name'),
      supabase.from('clients').select('id,name,show_in_tasks').order('name'),
      supabase.from('finance_client_profiles').select('*'),
      supabase.from('finance_client_contacts').select('*').order('created_at'),
      supabase.from('finance_retainers').select('*'),
      supabase.from('finance_coverage_terms').select('*'),
      supabase.from('finance_client_caps').select('*'),
    ])
    const first = en.error || li.error || de.error || ra.error || ty.error || cl.error || pr.error || co.error
    setErr(first ? first.message : '')
    const ents = en.data || []
    setEntities(ents); setLinks(li.data || []); setDeals(de.data || []); setLines(ra.data || []); setTypes(ty.data || [])
    setClientsAll(cl.data || []); setProfiles(pr.data || []); setContacts(co.data || []); setRetainers(rt.data || []); setTerms(tm.data || []); setCaps(cp.data || [])
    const dates = {}
    await Promise.all((ty.data || []).filter(t => t.active && t.invoice_day != null).map(async t => {
      const { data } = await supabase.rpc('finance_type_next_invoice_date', { p_type: t.id })
      dates[t.id] = data
    }))
    setNext(dates); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const open = entities.find(e => e.id === openId)
  if (loading) return <p className="page-sub">Loading…</p>

  if (open) return (
    <EntityDetail key={open.id} entity={open} entities={entities} links={links} deals={deals.filter(d => d.entity_id === open.id)}
      lines={lines.filter(l => l.entity_id === open.id)} types={types.filter(t => t.entity_id === open.id)} next={next} lookups={lookups} flash={flash}
      onBack={() => { setOpenId(null); if (fromClient) { setView('clients'); setFromClient(false) } }} reload={load} />
  )

  const chips = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }} role="tablist">
      <button role="tab" aria-selected={view === 'clients'} style={chip(view === 'clients')} onClick={() => setView('clients')}>Clients</button>
      <button role="tab" aria-selected={view === 'bills'} style={chip(view === 'bills')} onClick={() => setView('bills')}>Billed to</button>
    </div>
  )
  const theClient = openClient && clientsAll.find(c => c.id === openClient)
  if (view === 'clients') return (
    <div>
      {chips}
      {err && <div className="login-err">{err}</div>}
      {theClient
        ? <ClientPage key={theClient.id} client={theClient} profile={profiles.find(x => x.client_id === theClient.id)} entities={entities} links={links} types={types}
            contacts={contacts.filter(c => c.client_id === theClient.id)} retainers={retainers} terms={terms} caps={caps.filter(k => k.client_id === theClient.id)} onBack={() => setOpenClient(null)}
            onOpenBill={(id) => { setFromClient(true); setOpenId(id) }} reload={load} flash={flash} />
        : <ClientList clients={clientsAll} profiles={profiles} entities={entities} links={links} types={types} retainers={retainers} terms={terms} caps={caps} onOpen={setOpenClient} reload={load} flash={flash} />}
    </div>
  )

  return (
    <div>
      {chips}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 640 }}>Each billing entity is one client. Several client labels can roll up into it, and it can have several invoices, each with its own schedule, numbering and rates.</p>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add billing entity</button>
      </div>
      {err && <div className="login-err">{err}</div>}
      {entities.length === 0 && <p className="page-sub">No billing entities yet.</p>}
      {entities.map(e => {
        const nClients = links.filter(l => l.entity_id === e.id).length
        const nRates = lines.filter(l => l.entity_id === e.id && l.active && (!l.effective_to || l.effective_to >= todayET())).length
        const eTypes = types.filter(t => t.entity_id === e.id && t.active)
        return (
          <div key={e.id} style={{ ...panel, marginBottom: 10, cursor: 'pointer', opacity: e.active ? 1 : 0.6 }} onClick={() => setOpenId(e.id)} role="button" tabIndex={0}
            onKeyDown={ev => { if (ev.key === 'Enter') setOpenId(e.id) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{e.name}{!e.active && <span className="badge failed" style={{ marginLeft: 8 }}>inactive</span>}</div>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{e.legal_name || 'Legal name not entered yet'}</div>
                {eTypes.length === 0 ? <div className="page-sub" style={{ margin: '2px 0 0' }}>No invoices set up yet</div>
                  : eTypes.map(t => <div key={t.id} className="page-sub" style={{ margin: '2px 0 0' }}><b>{t.name}:</b> {scheduleSummary(t)}{next[t.id] ? ` · next ${fmtDate(next[t.id])}` : ''}</div>)}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{eTypes.length} invoice{eTypes.length === 1 ? '' : 's'} · {nClients} client label{nClients === 1 ? '' : 's'} · {nRates} current rate{nRates === 1 ? '' : 's'}</div>
              </div>
            </div>
          </div>
        )
      })}
      {adding && <AddEntityModal onClose={() => setAdding(false)} onSaved={async (id) => { setAdding(false); await load(); setOpenId(id); flash('Billing entity added. Add its invoices next.') }} />}
    </div>
  )
}

function AddEntityModal({ onClose, onSaved }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    if (!name.trim()) return setErr('Give the billing entity a name.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('finance_billing_entities').insert({ name: name.trim() }).select('id').single()
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'A billing entity with that name already exists.' : error.message)
    onSaved(data.id)
  }
  return (
    <Modal title="Add a billing entity" onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="be-name">Name *</label><input id="be-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. GarageCo" autoFocus /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function EntityDetail({ entity, entities, links, deals, lines, types, next, lookups, flash, onBack, reload }) {
  const [tab, setTab] = useState('details')
  const TABS = [['details', 'Details'], ['invoices', 'Invoices'], ['clients', 'Client labels'], ['deals', 'Deals'], ['rates', 'Rate card']]
  return (
    <div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 12 }} onClick={onBack}>← All billing entities</button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{entity.name}</h2>
      <p className="page-sub" style={{ margin: '0 0 14px' }}>{types.filter(t => t.active).length === 0 ? 'No invoices set up yet' : types.filter(t => t.active).map(t => `${t.name}${next[t.id] ? ` next ${fmtDate(next[t.id])}` : ''}`).join(' · ')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }} role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} style={chip(tab === k)} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'details' && <DetailsForm entity={entity} reload={reload} flash={flash} />}
      {tab === 'invoices' && <Invoices entity={entity} types={types} next={next} lookups={lookups} reload={reload} flash={flash} />}
      {tab === 'clients' && <ClientLabels entity={entity} entities={entities} links={links} lookups={lookups} reload={reload} flash={flash} />}
      {tab === 'deals' && <Deals entity={entity} deals={deals} reload={reload} flash={flash} />}
      {tab === 'rates' && <RateCard entity={entity} lines={lines} deals={deals} types={types} reload={reload} flash={flash} />}
    </div>
  )
}

// ---------- Details ----------
function DetailsForm({ entity, reload, flash }) {
  const [f, setF] = useState({
    name: entity.name || '', legal_name: entity.legal_name || '', bill_to_address: entity.bill_to_address || '',
    sameShip: !entity.ship_to_address, ship_to_address: entity.ship_to_address || '',
    contact_name: entity.contact_name || '', contact_email: entity.contact_email || '', contact_phone: entity.contact_phone || '',
    notes: entity.notes || '', active: entity.active,
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
      notes: f.notes.trim() || null, active: f.active,
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

// ---------- Invoices (each with its own schedule, issuing company, numbering, layout) ----------
const COVERS = [
  ['manual', "I'll choose the dates when I draft it"], ['previous_month', 'The previous calendar month'],
  ['previous_half_month', 'The previous half of the month (1st to 15th, or 16th to the end)'],
  ['previous_two_weeks', 'The previous two weeks'], ['previous_week', 'The previous week'],
]
const suggestPrefix = (name) => String(name || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()

function Invoices({ entity, types, next, lookups, reload, flash }) {
  const [editId, setEditId] = useState(null)   // an invoice id
  const [adding, setAdding] = useState(false)
  const editing = types.find(t => t.id === editId)
  if (editing) return <InvoiceForm key={editing.id} type={editing} lookups={lookups} next={next[editing.id]} reload={reload} flash={flash} onBack={() => setEditId(null)} />
  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 600 }}>Each invoice has its own schedule, issuing company, numbering and rates. For example, a Consulting invoice on the 1st and a Call center invoice on the 15th.</p>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add invoice</button>
      </div>
      {types.length === 0 && <p className="page-sub">No invoices yet. Add one for each separate bill this client gets.</p>}
      {types.map(t => (
        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)', opacity: t.active ? 1 : 0.55 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t.name}{t.billing_method === 'coverage' && <span className="badge" style={{ marginLeft: 8 }}>Retainer</span>}{!t.active && <span className="badge failed" style={{ marginLeft: 8 }}>ended</span>}</div>
            <div className="page-sub" style={{ margin: '2px 0 0' }}>Billed by {lookups.companies.find(c => c.id === t.issuing_company_id)?.name || 'no company chosen yet'}</div>
            <div className="page-sub" style={{ margin: '2px 0 0' }}>{scheduleSummary(t)}{next[t.id] ? ` · next invoice ${fmtDate(next[t.id])}` : ''}</div>
            <div className="page-sub" style={{ margin: '2px 0 0' }}>Next number {numberPreview(t)}</div>
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => setEditId(t.id)}>Edit</button>
        </div>
      ))}
      {adding && <AddInvoiceModal entity={entity} lookups={lookups} onClose={() => setAdding(false)}
        onSaved={async (id) => { setAdding(false); await reload(); setEditId(id); flash('Invoice added. Set its schedule next.') }} />}
    </div>
  )
}

function AddInvoiceModal({ entity, lookups, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const onName = (v) => { setName(v); if (!prefixTouched) setPrefix(suggestPrefix(v)) }
  async function save() {
    if (!name.trim()) return setErr('Name the invoice, for example Consulting or Call center.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('finance_invoice_types').insert({ entity_id: entity.id, name: name.trim(), issuing_company_id: company || null, number_prefix: prefix.trim() }).select('id').single()
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'This client already has an invoice with that name.' : error.message)
    onSaved(data.id)
  }
  return (
    <Modal title="Add an invoice" onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div className="field"><label htmlFor="ai-name">Name *</label><input id="ai-name" value={name} onChange={e => onName(e.target.value)} placeholder="e.g. Consulting" autoFocus /></div>
      <div className="field"><label htmlFor="ai-co">Which company bills it?</label>
        <select id="ai-co" value={company} onChange={e => setCompany(e.target.value)}><option value="">Choose later</option>{lookups.companies.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor="ai-prefix">Invoice number prefix</label><input id="ai-prefix" value={prefix} onChange={e => { setPrefix(e.target.value); setPrefixTouched(true) }} />
        <div className="hint">A short code at the start of each invoice number, so invoices from the same company never repeat a number.</div></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function InvoiceForm({ type, lookups, next, reload, flash, onBack }) {
  const [f, setF] = useState({
    name: type.name, issuing_company_id: type.issuing_company_id || '', covers: type.covers,
    invoice_frequency: type.invoice_frequency, invoice_day: type.invoice_day ?? '', invoice_day2: type.invoice_day2 ?? '',
    invoice_anchor: type.invoice_anchor || '', terms_days: type.terms_days, number_prefix: type.number_prefix || '',
    number_include_year: type.number_include_year, next_number: type.next_number, group_by: type.group_by, quantity_decimals: type.quantity_decimals, active: type.active,
    billing_method: type.billing_method || 'hours',
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
    if (!f.name.trim()) return setErr('Name the invoice.')
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
    const { error } = await supabase.from('finance_invoice_types').update({
      name: f.name.trim(), issuing_company_id: f.issuing_company_id || null, covers: f.covers,
      invoice_frequency: freq, invoice_day: Number(f.invoice_day), invoice_day2: freq === 'semimonthly' ? Number(f.invoice_day2) : null,
      invoice_anchor: freq === 'biweekly' ? f.invoice_anchor : null, terms_days: terms, number_prefix: f.number_prefix.trim(),
      number_include_year: f.number_include_year, next_number: nn, group_by: f.group_by, quantity_decimals: Number(f.quantity_decimals), active: f.active,
      billing_method: f.billing_method,
    }).eq('id', type.id)
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'This client already has an invoice with that name.' : error.message)
    flash('Invoice saved.'); reload()
  }
  const preview = numberPreview({ ...f, next_number: f.next_number || 1 })
  return (
    <div>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 12 }} onClick={onBack}>← All invoices</button>
      <div style={panel}>
        {err && <div className="login-err" role="alert">{err}</div>}
        <div style={grid2}>
          <div className="field"><label htmlFor="s-name">Invoice name *</label><input id="s-name" value={f.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="field"><label htmlFor="s-co">Billed by</label>
            <select id="s-co" value={f.issuing_company_id} onChange={e => set('issuing_company_id', e.target.value)}><option value="">Choose…</option>{lookups.companies.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>

        <h3 style={{ margin: '8px 0 8px', fontSize: 15 }}>How this invoice is billed</h3>
        <div className="field" style={{ maxWidth: 560 }}><label htmlFor="s-method">Billed</label>
          <select id="s-method" value={f.billing_method} onChange={e => set('billing_method', e.target.value)}>
            <option value="hours">By the hour: the hours you tag to it × the rate card</option>
            <option value="coverage">As a retainer: hours open × agents per hour × a rate</option>
          </select>
          <div className="hint">{f.billing_method === 'coverage' ? 'A retainer bills for coverage, not for hours worked. Its terms are set below once the invoice is saved. Five9 time does not change this bill.' : 'Hours you mark "invoice it" on the Hours tab are billed at the rates on the Rate card.'}</div></div>

        <h3 style={{ margin: '8px 0 8px', fontSize: 15 }}>When to invoice</h3>
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
          <div className="field"><label htmlFor="s-covers">The work it covers</label>
            <select id="s-covers" value={f.covers} onChange={e => set('covers', e.target.value)}>{COVERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>

        <h3 style={{ margin: '14px 0 8px', fontSize: 15 }}>Invoice numbers</h3>
        <p className="page-sub" style={{ margin: '0 0 8px', maxWidth: 640 }}>Command Center hands out invoice numbers for you, one at a time. You only say where to start: set <b>Next number</b> to one more than the last invoice you already sent for this invoice. If you are starting fresh, leave it at 1.</p>
        <div style={grid2}>
          <div className="field"><label htmlFor="s-prefix">Prefix (optional)</label><input id="s-prefix" value={f.number_prefix} onChange={e => set('number_prefix', e.target.value)} placeholder="e.g. CON" />
            <div className="hint">Use a different prefix on each invoice a company sends, so no two invoice numbers repeat.</div></div>
          <div className="field"><label htmlFor="s-next">Next number</label><input id="s-next" inputMode="numeric" value={f.next_number} onChange={e => set('next_number', e.target.value)} /></div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontWeight: 500 }}><input type="checkbox" checked={f.number_include_year} onChange={e => set('number_include_year', e.target.checked)} /> Include the year</label>
        <p className="page-sub" style={{ margin: '0 0 6px' }}>The next invoice will be numbered <b>{preview}</b>.</p>

        <h3 style={{ margin: '14px 0 8px', fontSize: 15 }}>How the invoice is laid out</h3>
        <div style={grid2}>
          <div className="field"><label htmlFor="s-group">Group the lines by</label>
            <select id="s-group" value={f.group_by} onChange={e => set('group_by', e.target.value)}><option value="product">Product or service</option><option value="brand">Brand</option><option value="role">Role</option><option value="person">Person</option></select></div>
          <div className="field"><label htmlFor="s-dec">Decimals shown on quantities</label>
            <select id="s-dec" value={f.quantity_decimals} onChange={e => set('quantity_decimals', e.target.value)}>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select>
            <div className="hint">Hours are never rounded. This only changes how many decimals are shown; amounts round to the cent.</div></div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 14px', fontWeight: 500 }}><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> In use (untick when you stop sending this invoice)</label>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</button>
      </div>
      {f.billing_method === 'coverage' && type.billing_method === 'coverage' && <FinanceCoverage type={type} flash={flash} />}
      {f.billing_method === 'coverage' && type.billing_method !== 'coverage' && <p className="page-sub" style={{ marginTop: 12 }}>Save the invoice first, then you can set its retainer terms here.</p>}
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
function RateCard({ entity, lines, deals, types, reload, flash }) {
  const [history, setHistory] = useState(false)
  const [modal, setModal] = useState(null)   // { mode: 'add' | 'edit' | 'change' | 'end', line? }
  const [roles, setRoles] = useState([])
  const today = todayET()
  useEffect(() => { supabase.from('call_types').select('name').order('name').then(({ data }) => setRoles((data || []).map(r => r.name).filter(Boolean))).catch(() => {}) }, [])
  const shown = lines.filter(l => history || (l.active && (!l.effective_to || l.effective_to >= today)))
  const dealName = (id) => deals.find(d => d.id === id)?.name
  const typeName = (id) => types.find(t => t.id === id)?.name
  const noInvoices = types.filter(t => t.active).length === 0
  const retainers = types.filter(t => t.active && t.billing_method === 'coverage')
  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <p className="page-sub" style={{ margin: 0, maxWidth: 600 }}>What this client pays, line by line. Every rate has a start date. To change a rate, use <b>Change rate</b>: the old rate ends the day before, so past invoices stay exactly as they were.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={chip(history)} onClick={() => setHistory(!history)}>Show history</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add' })} disabled={noInvoices}>+ Add rate</button>
        </div>
      </div>
      {noInvoices && <p className="page-sub" style={{ marginTop: 0 }}>Add an invoice first (on the Invoices tab), so each rate has an invoice to belong to.</p>}
      {retainers.length > 0 && <p className="page-sub" data-retainer-note style={{ marginTop: 0, maxWidth: 680 }}>{retainers.map(t => t.name).join(' and ')} {retainers.length === 1 ? 'is' : 'are'} billed as a retainer, priced by its own terms on the Invoices tab. Rates added here are only for anything else billed on {retainers.length === 1 ? 'it' : 'them'}.</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr><th style={th}>Product or service</th><th style={th}>Invoice</th><th style={th}>Unit</th><th style={{ ...th, textAlign: 'right' }}>Rate</th><th style={th}>Applies to</th><th style={th}>From</th><th style={th}>To</th><th style={th}></th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td style={td} colSpan={8}>No rates yet. Add what this client pays for, for example an hourly rate or a per-call price.</td></tr>}
            {shown.map(l => {
              const ended = !!l.effective_to && l.effective_to < today
              return (
                <tr key={l.id} style={{ opacity: ended || !l.active ? 0.55 : 1 }}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{l.product_name}</div>
                    <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{[l.description, l.split_by_brand ? 'one line per brand' : ''].filter(Boolean).join(' · ')}</div></td>
                  <td style={td}>{typeName(l.invoice_type_id) || <span style={{ color: 'var(--ink-soft)' }}>None</span>}</td>
                  <td style={td}>{UNITS.find(u => u[0] === l.unit)?.[1]}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{rateText(l.rate)}</td>
                  <td style={td}>
                    <div>{(l.roles || []).length ? (l.roles || []).join(', ') : <span style={{ color: 'var(--ink-soft)' }}>Any role</span>}</div>
                    <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{(l.deal_ids || []).length ? `Deals: ${(l.deal_ids || []).map(dealName).filter(Boolean).join(', ')}` : 'Any deal'}</div>
                  </td>
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
      {modal && <RateModal modal={modal} entity={entity} deals={deals} roles={roles} types={types} onClose={() => setModal(null)} onSaved={(msg) => { setModal(null); reload(); flash(msg) }} />}
    </div>
  )
}

function RateModal({ modal, entity, deals, roles, types, onClose, onSaved }) {
  const { mode, line } = modal
  const activeTypes = types.filter(t => t.active)
  const [f, setF] = useState({
    product_name: line?.product_name || '', description: line?.description || '', unit: line?.unit || 'hour',
    rate: mode === 'change' ? '' : (line?.rate ?? ''), roles: line?.roles || [], split_by_brand: !!line?.split_by_brand, deal_ids: line?.deal_ids || [],
    invoice_type_id: line?.invoice_type_id || (activeTypes.length === 1 ? activeTypes[0].id : ''),
    effective_from: mode === 'add' ? todayET() : mode === 'change' ? todayET() : (line?.effective_from || todayET()),
    end_on: todayET(),
  })
  const [roleDraft, setRoleDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const sameRole = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const roleOptions = [...roles, ...f.roles.filter(r => !roles.some(x => sameRole(x, r)))]
  const toggleRole = (r) => set('roles', f.roles.some(x => sameRole(x, r)) ? f.roles.filter(x => !sameRole(x, r)) : [...f.roles, r])
  const addRoleDraft = () => { const v = roleDraft.trim(); if (v && !f.roles.some(x => sameRole(x, v))) set('roles', [...f.roles, roles.find(x => sameRole(x, v)) || v]); setRoleDraft('') }
  const toggleDeal = (id) => set('deal_ids', f.deal_ids.includes(id) ? f.deal_ids.filter(x => x !== id) : [...f.deal_ids, id])
  const title = { add: 'Add a rate', edit: 'Edit this rate', change: `Change rate: ${line?.product_name}`, end: `End rate: ${line?.product_name}` }[mode]

  async function save() {
    setErr('')
    const dayBefore = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.toLocaleDateString('en-CA') }
    try {
      setBusy(true)
      const draft = roleDraft.trim()
      const roleList = draft && !f.roles.some(x => sameRole(x, draft)) ? [...f.roles, draft] : f.roles
      if (mode === 'end') {
        if (f.end_on < line.effective_from) throw new Error('The end date is before this rate started.')
        const { error } = await supabase.from('finance_rate_lines').update({ effective_to: f.end_on }).eq('id', line.id)
        if (error) throw error
        return onSaved('Rate ended.')
      }
      if (mode === 'edit') {
        const { error } = await supabase.from('finance_rate_lines').update({ description: f.description.trim() || null, roles: roleList, split_by_brand: f.split_by_brand, deal_ids: f.deal_ids, invoice_type_id: f.invoice_type_id || null }).eq('id', line.id)
        if (error) throw error
        return onSaved('Rate saved.')
      }
      if (mode === 'add' && !f.product_name.trim()) throw new Error('Name the product or service.')
      if (mode === 'add' && !f.invoice_type_id) throw new Error('Choose which invoice this rate belongs to.')
      const rate = Number(String(f.rate).replace(/[$,\s]/g, ''))
      if (!(rate >= 0) || f.rate === '') throw new Error('Enter the rate, for example 125 or 0.12.')
      if (mode === 'add') {
        const { error } = await supabase.from('finance_rate_lines').insert({
          entity_id: entity.id, invoice_type_id: f.invoice_type_id, deal_ids: f.deal_ids, product_name: f.product_name.trim(), description: f.description.trim() || null, unit: f.unit, rate,
          roles: roleList, split_by_brand: f.split_by_brand, effective_from: f.effective_from,
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
        entity_id: entity.id, invoice_type_id: line.invoice_type_id, deal_ids: line.deal_ids || [], product_name: line.product_name, description: line.description, unit: line.unit, rate,
        roles: line.roles || [], split_by_brand: line.split_by_brand, effective_from: f.effective_from, effective_to: oldEnd, sort: line.sort,
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
          {mode !== 'change' && <div className="field"><label htmlFor="rt-type">Which invoice? {mode === 'add' ? '*' : ''}</label>
            <select id="rt-type" value={f.invoice_type_id} onChange={e => set('invoice_type_id', e.target.value)}><option value="">Choose…</option>{activeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
          {mode === 'add' && <div className="field"><label htmlFor="rt-unit">Charged</label><select id="rt-unit" value={f.unit} onChange={e => set('unit', e.target.value)}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
          {mode !== 'edit' && <div className="field"><label htmlFor="rt-rate">{mode === 'change' ? 'New rate (USD)' : 'Rate (USD)'} *</label><input id="rt-rate" inputMode="decimal" value={f.rate} onChange={e => set('rate', e.target.value)} placeholder="0.00" /></div>}
          {mode !== 'edit' && <div className="field"><label htmlFor="rt-from">{mode === 'change' ? 'New rate starts on' : 'Starts on'}</label><input id="rt-from" type="date" value={f.effective_from} onChange={e => set('effective_from', e.target.value)} /></div>}
          {mode !== 'change' && <>
            <div className="field"><label htmlFor="rt-desc">Description on the invoice (optional)</label><input id="rt-desc" value={f.description} onChange={e => set('description', e.target.value)} /></div>
            <div className="field"><label id="rt-roles-label">Only for these roles (optional)</label>
              <div className="tag-picker" role="group" aria-labelledby="rt-roles-label">
                {roleOptions.map(r => <button key={r} type="button" className={'tag-opt' + (f.roles.some(x => sameRole(x, r)) ? ' on' : '')} aria-pressed={f.roles.some(x => sameRole(x, r))} onClick={() => toggleRole(r)}>{r}</button>)}
              </div>
              <input aria-label="Add another role" style={{ marginTop: 8 }} value={roleDraft} onChange={e => setRoleDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRoleDraft() } }} placeholder="A role that is not listed? Type it and press Enter" />
              <div className="hint">{f.roles.length ? `Applies only to: ${f.roles.join(', ')}.` : 'Nothing picked means it applies to any role.'}</div></div>
            <div className="field"><label id="rt-deals-label">Only for these deals (optional)</label>
              {deals.length === 0 ? <div className="hint">This client has no deals yet. Add them on the Deals tab to limit a rate to some of them.</div> : (
                <div className="tag-picker" role="group" aria-labelledby="rt-deals-label">
                  {deals.map(d => <button key={d.id} type="button" className={'tag-opt' + (f.deal_ids.includes(d.id) ? ' on' : '')} aria-pressed={f.deal_ids.includes(d.id)} onClick={() => toggleDeal(d.id)}>{d.name}</button>)}
                </div>)}
              <div className="hint">Nothing picked means it applies to every deal. A rate limited to certain roles or deals is used instead of the general rate for the same product.</div></div>
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

