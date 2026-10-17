import React, { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'

// ============================================================
// CLIENTS (Admins and Owners)
// Every client in Command Center is here, including new ones (also the ones created when a sales deal closes, with the deal's
// contact already filled in). For each client you say ONCE how it is billed:
//   - Invoiced client: which bill (billing entity) its invoices go on, and what happens to the hours worked for it
//   - Internal (Opsis's own work): never invoiced
// Hours worked for the client then follow that choice, so there are no rules to keep. A choice on one hour still wins.
// ============================================================

const KIND = { invoiced: 'Invoiced', internal: 'Internal', not_set: 'Needs setup' }
const kindBadge = (k) => k === 'invoiced' ? 'badge passed' : k === 'internal' ? 'badge' : 'badge needed'
const ROLES = [['primary', 'Main contact'], ['billing', 'Billing contact'], ['other', 'Other']]
const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })

export function describeHoursSetting(profile, types, entities) {
  if (profile.billing_kind === 'internal') return 'Never invoiced'
  if (profile.billing_kind === 'not_set') return 'Not set up yet'
  if (profile.hours_mode === 'no') return 'Hours are not invoiced'
  if (profile.hours_mode === 'invoice') {
    const t = types.find(x => x.id === profile.default_invoice_type_id); const e = t && entities.find(x => x.id === t.entity_id)
    return `Hours are invoiced on ${t ? (e ? `${e.name} › ${t.name}` : t.name) : 'an invoice'}`
  }
  return 'You decide each time'
}

export function ClientList({ clients, profiles, entities, links, types, retainers, terms, onOpen }) {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const today = todayET()
  const profileOf = (id) => profiles.find(p => p.client_id === id) || { billing_kind: 'not_set', hours_mode: 'decide', status: 'active' }
  const needs = clients.filter(c => profileOf(c.id).billing_kind === 'not_set' && profileOf(c.id).status !== 'ended').length
  const shown = useMemo(() => clients.filter(c => {
    const p = profileOf(c.id)
    if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'needs') return p.billing_kind === 'not_set' && p.status !== 'ended'
    if (filter === 'invoiced') return p.billing_kind === 'invoiced'
    if (filter === 'internal') return p.billing_kind === 'internal'
    return true
  }), [clients, profiles, filter, q])   // eslint-disable-line
  return (
    <div>
      <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 720 }}>Every client in Command Center is listed here, including new ones. For each, say once whether it is invoiced or internal. Hours worked for the client then follow that choice, so you do not need rules.</p>
      {needs > 0 && <div className="card" role="note" style={{ marginBottom: 12 }}><b data-needs>{needs} client{needs === 1 ? '' : 's'} need{needs === 1 ? 's' : ''} setup.</b> Until a client is set up, hours worked for it wait for your decision.</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[['all', 'All'], ['needs', 'Needs setup'], ['invoiced', 'Invoiced'], ['internal', 'Internal']].map(([k, l]) => <button key={k} style={chip(filter === k)} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>)}
        <input aria-label="Search clients" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', minWidth: 180 }} />
      </div>
      {shown.length === 0 && <p className="page-sub">No clients match.</p>}
      {shown.map(c => {
        const p = profileOf(c.id)
        const link = links.find(l => l.client_id === c.id)
        const bill = link && entities.find(e => e.id === link.entity_id)
        const rs = bill ? retainers.filter(r => types.some(t => t.id === r.invoice_type_id && t.entity_id === bill.id)) : []
        const live = rs.filter(r => terms.some(t => t.retainer_id === r.id && t.effective_from <= today && (!t.effective_to || t.effective_to >= today)))
        return (
          <div key={c.id} data-client={c.name} role="button" tabIndex={0} onClick={() => onOpen(c.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(c.id) }}
            style={{ ...panel, marginBottom: 8, cursor: 'pointer', opacity: p.status === 'ended' ? 0.6 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name} <span className={kindBadge(p.billing_kind)} style={{ marginLeft: 6 }}>{KIND[p.billing_kind]}</span>{p.status !== 'active' && <span className="badge failed" style={{ marginLeft: 6 }}>{p.status}</span>}</div>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{p.billing_kind === 'invoiced' ? (bill ? `Billed to ${bill.name}` : 'Not billed to anyone yet') : p.billing_kind === 'internal' ? 'Opsis\'s own work' : 'Choose whether this client is invoiced or internal'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{describeHoursSetting(p, types, entities)}</div>
                {(live.length > 0 || c.max_weekly_hours) && <div className="page-sub" style={{ margin: '2px 0 0' }}>{live.length > 0 ? `${live.length} retainer${live.length === 1 ? '' : 's'}` : ''}{live.length > 0 && c.max_weekly_hours ? ' · ' : ''}{c.max_weekly_hours ? `Weekly cap ${Number(c.max_weekly_hours)} h` : ''}</div>}
              </div>
            </div>
          </div>)
      })}
    </div>
  )
}

export function ClientPage({ client, profile, entities, links, types, contacts, retainers, terms, onBack, onOpenBill, reload, flash }) {
  const p = profile || { billing_kind: 'not_set', hours_mode: 'decide', status: 'active' }
  const link = links.find(l => l.client_id === client.id)
  const [kind, setKind] = useState(p.billing_kind)
  const [billId, setBillId] = useState(link ? link.entity_id : '')
  const [newName, setNewName] = useState(client.name)
  const [mode, setMode] = useState(p.hours_mode || 'decide')
  const [invId, setInvId] = useState(p.default_invoice_type_id || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [det, setDet] = useState({ status: p.status || 'active', start: p.start_date || '', end: p.end_date || '', website: p.website || '', industry: p.industry || '', notes: p.notes || '' })
  const [detBusy, setDetBusy] = useState(false)
  const [detErr, setDetErr] = useState('')
  const bill = entities.find(e => e.id === billId)
  const billTypes = types.filter(t => t.entity_id === billId && t.active)
  const savedBill = link && entities.find(e => e.id === link.entity_id)
  const savedTypes = savedBill ? types.filter(t => t.entity_id === savedBill.id && t.active) : []
  const today = todayET()

  const checklist = p.billing_kind === 'internal' ? [['Chosen that this client is internal', true]]
    : [['Chosen whether this client is invoiced or internal', p.billing_kind !== 'not_set'],
       ...(p.billing_kind === 'invoiced' ? [['Billed to someone', !!savedBill], ['That bill has at least one invoice', savedTypes.length > 0], ['At least one contact is on file', contacts.length > 0]] : [])]
  const left = checklist.filter(([, ok]) => !ok).length

  async function saveBilling() {
    setErr('')
    if (kind === 'invoiced') {
      if (!billId) return setErr('Choose who this client is billed to.')
      if (billId === '__new' && !newName.trim()) return setErr('Name the new bill.')
      if (mode === 'invoice' && !invId) return setErr('Choose which invoice these hours go on.')
    }
    setBusy(true)
    const { error } = await supabase.rpc('finance_client_set_billing', {
      p_client: client.id, p_kind: kind, p_bill: kind === 'invoiced' && billId && billId !== '__new' ? billId : null,
      p_new_bill_name: kind === 'invoiced' && billId === '__new' ? newName.trim() : null,
      p_hours_mode: kind === 'invoiced' ? mode : 'decide', p_default_invoice: kind === 'invoiced' && mode === 'invoice' ? invId : null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    flash(kind === 'internal' ? `${client.name} is internal. Its hours are never invoiced.` : kind === 'not_set' ? `${client.name} is back to needing setup.` : `Saved. ${client.name} is an invoiced client.`)
    await reload()
  }
  async function saveDetails() {
    setDetErr('')
    if (det.start && det.end && det.end < det.start) return setDetErr('The end date cannot be before the start date.')
    setDetBusy(true)
    const { error } = await supabase.rpc('finance_client_update_details', { p_client: client.id, p_status: det.status, p_start: det.start || null, p_end: det.end || null, p_notes: det.notes, p_website: det.website, p_industry: det.industry })
    setDetBusy(false)
    if (error) return setDetErr(error.message)
    flash('Details saved.'); await reload()
  }

  const myRetainers = savedBill ? retainers.filter(r => savedTypes.some(t => t.id === r.invoice_type_id)) : []
  const currentTerm = (r) => terms.filter(t => t.retainer_id === r.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from)).find(t => t.effective_from <= today && (!t.effective_to || t.effective_to >= today))

  return (
    <div data-client-page={client.name}>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 10 }} onClick={onBack}>← All clients</button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>{client.name} <span className={kindBadge(p.billing_kind)} style={{ marginLeft: 6, fontSize: 12 }}>{KIND[p.billing_kind]}</span></h2>
      <p className="page-sub" style={{ margin: '0 0 14px' }}>{describeHoursSetting(p, types, entities)}</p>

      <div style={{ ...panel, marginBottom: 14 }} data-checklist>
        <b>{left === 0 ? 'This client is ready.' : `${left} thing${left === 1 ? '' : 's'} left to set up`}</b>
        <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
          {checklist.map(([t, ok]) => <li key={t} style={{ padding: '2px 0', color: ok ? 'var(--ink)' : 'var(--ink-soft)' }}><span aria-hidden="true">{ok ? '✓' : '○'}</span> <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>{ok ? 'Done: ' : 'To do: '}</span>{t}</li>)}
        </ul>
      </div>

      <div style={{ ...panel, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>How is this client billed?</h3>
        {err && <div className="login-err" role="alert">{err}</div>}
        {[['invoiced', 'Invoiced client', 'We send invoices for this client.'], ['internal', 'Internal', "Opsis's own work. Hours worked for it are never invoiced."], ['not_set', 'Not set up yet', 'Hours worked for it wait for your decision.']].map(([k, l, h]) => (
          <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
            <input type="radio" name="cl-kind" value={k} checked={kind === k} onChange={() => setKind(k)} style={{ marginTop: 3 }} /> <span><b>{l}</b><span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-soft)' }}>{h}</span></span>
          </label>))}
        {kind === 'invoiced' && (
          <div style={{ marginLeft: 22, marginTop: 8 }}>
            <div className="field" style={{ maxWidth: 440 }}><label htmlFor="cl-bill">Billed to</label>
              <select id="cl-bill" value={billId} onChange={e => { setBillId(e.target.value); setInvId(''); if (e.target.value === '__new' && mode === 'invoice') setMode('decide') }}>
                <option value="">Choose…</option>{entities.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}<option value="__new">A new bill for this client</option></select>
              <div className="hint">Several clients can share one bill. For example, all the GarageCo clients are billed together.</div></div>
            {billId === '__new' && <div className="field" style={{ maxWidth: 440 }}><label htmlFor="cl-newname">Name of the new bill</label><input id="cl-newname" value={newName} onChange={e => setNewName(e.target.value)} />
              <div className="hint">You will add its invoices next.</div></div>}
            <div style={{ fontWeight: 600, fontSize: 14, margin: '6px 0 4px' }}>Hours worked for this client</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><input type="radio" name="cl-mode" value="invoice" checked={mode === 'invoice'} onChange={() => setMode('invoice')} disabled={!billId || billId === '__new' || billTypes.length === 0} /> Invoice them on:
              <select id="cl-inv" aria-label="Invoice for these hours" value={invId} onChange={e => { setInvId(e.target.value); setMode('invoice') }} disabled={!billId || billId === '__new' || billTypes.length === 0}><option value="">Choose an invoice…</option>{billTypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.billing_method === 'coverage' ? ' (retainer)' : ''}</option>)}</select></label>
            {billId && billId !== '__new' && billTypes.length === 0 && <div className="hint" style={{ marginLeft: 22 }}>This bill has no invoices yet. Add one under "Open the bill" below, then choose it here.</div>}
            {billTypes.find(t => t.id === invId)?.billing_method === 'coverage' && mode === 'invoice' && <div className="hint" role="note" style={{ marginLeft: 22 }}>That invoice is a retainer, so these hours show as covered by it. They are not billed by the hour.</div>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><input type="radio" name="cl-mode" value="no" checked={mode === 'no'} onChange={() => setMode('no')} /> Do not invoice them</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><input type="radio" name="cl-mode" value="decide" checked={mode === 'decide'} onChange={() => setMode('decide')} /> I decide each time (they wait in the Hours review)</label>
            <div className="hint" style={{ marginTop: 4 }}>You can always change a single hour by hand on the Hours tab. That choice wins.</div>
          </div>)}
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={saveBilling} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>

      {p.billing_kind === 'invoiced' && savedBill && (
        <div style={{ ...panel, marginBottom: 14 }} data-bill-summary>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Billed to {savedBill.name}</h3>
            <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => onOpenBill(savedBill.id)}>Open the bill: invoices, retainers and rates</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Invoices</div>
            {savedTypes.length === 0 ? <div className="page-sub" style={{ margin: 0 }}>No invoices yet.</div> : savedTypes.map(t => <div key={t.id} className="page-sub" style={{ margin: '2px 0' }}><b>{t.name}</b>{t.billing_method === 'coverage' ? ' (retainer)' : ''}</div>)}
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Retainers</div>
            {myRetainers.length === 0 ? <div className="page-sub" style={{ margin: 0 }}>None.</div> : myRetainers.map(r => { const t = currentTerm(r); return <div key={r.id} className="page-sub" style={{ margin: '2px 0' }}><b>{r.name}</b>: {t ? `${Number(t.agents_per_hour)} agent${Number(t.agents_per_hour) === 1 ? '' : 's'} per hour at $${Number(t.rate_per_agent_hour).toFixed(2)} since ${fmtDate(t.effective_from)}` : 'no terms in effect today'}</div> })}
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Weekly hour cap</div>
            <div className="page-sub" style={{ margin: 0 }}>{client.max_weekly_hours ? `${Number(client.max_weekly_hours)} hours a week (change it under Backend › Clients)` : 'No cap (set one under Backend › Clients)'}</div>
          </div>
        </div>)}
      {p.billing_kind === 'internal' && <div className="card" style={{ marginBottom: 14 }}>Internal clients are never invoiced, so there is no bill, invoice or retainer to set up here.</div>}

      <div style={{ ...panel, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Details</h3>
        {detErr && <div className="login-err" role="alert">{detErr}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="field"><label htmlFor="cd-status">Status</label><select id="cd-status" value={det.status} onChange={e => setDet({ ...det, status: e.target.value })}><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option></select></div>
          <div className="field"><label htmlFor="cd-start">Started</label><input id="cd-start" type="date" value={det.start} onChange={e => setDet({ ...det, start: e.target.value })} /></div>
          <div className="field"><label htmlFor="cd-end">Ended</label><input id="cd-end" type="date" value={det.end} min={det.start} onChange={e => setDet({ ...det, end: e.target.value })} /></div>
          <div className="field"><label htmlFor="cd-site">Website</label><input id="cd-site" value={det.website} onChange={e => setDet({ ...det, website: e.target.value })} /></div>
          <div className="field"><label htmlFor="cd-ind">Industry</label><input id="cd-ind" value={det.industry} onChange={e => setDet({ ...det, industry: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="cd-notes">Notes</label><textarea id="cd-notes" rows={3} value={det.notes} onChange={e => setDet({ ...det, notes: e.target.value })} style={{ width: '100%' }} /></div>
        <button className="btn btn-primary" onClick={saveDetails} disabled={detBusy}>{detBusy ? 'Saving…' : 'Save details'}</button>
      </div>

      <Contacts client={client} contacts={contacts} reload={reload} flash={flash} />
    </div>
  )
}

function Contacts({ client, contacts, reload, flash }) {
  const blank = { name: '', email: '', phone: '', title: '', role: 'other', gets_invoices: false, note: '' }
  const [form, setForm] = useState(null)      // null = closed, else { id?, ...fields }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setErr('')
    if (!form.name.trim() && !form.email.trim()) return setErr('Enter a name or an email.')
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setErr('That email does not look right.')
    setBusy(true)
    const row = { name: form.name.trim() || null, email: form.email.trim().toLowerCase() || null, phone: form.phone.trim() || null, title: form.title.trim() || null, role: form.role, gets_invoices: !!form.gets_invoices, note: form.note.trim() || null }
    const { error } = form.id ? await supabase.from('finance_client_contacts').update(row).eq('id', form.id) : await supabase.from('finance_client_contacts').insert({ ...row, client_id: client.id })
    setBusy(false)
    if (error) return setErr(error.message)
    setForm(null); flash(form.id ? 'Contact saved.' : 'Contact added.'); await reload()
  }
  async function remove(c) {
    if (!window.confirm(`Remove ${c.name || c.email} from ${client.name}?`)) return
    const { error } = await supabase.from('finance_client_contacts').delete().eq('id', c.id)
    if (error) return setErr(error.message)
    flash('Contact removed.'); await reload()
  }
  return (
    <div style={panel} data-contacts>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Contacts</h3>
        <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => { setErr(''); setForm({ ...blank }) }}>+ Add a contact</button>
      </div>
      {err && !form && <div className="login-err" role="alert">{err}</div>}
      {contacts.length === 0 && !form && <p className="page-sub" style={{ margin: 0 }}>No contacts yet. Add who receives the invoices and who to ask about the work.</p>}
      {contacts.map(c => (
        <div key={c.id} data-contact={c.name || c.email} style={{ borderTop: '1px solid var(--line)', padding: '8px 0', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div><b>{c.name || c.email}</b>{c.title ? ` · ${c.title}` : ''} <span className="badge" style={{ marginLeft: 4 }}>{ROLES.find(r => r[0] === c.role)?.[1]}</span>{c.gets_invoices && <span className="badge passed" style={{ marginLeft: 4 }}>Gets invoices</span>}{c.source === 'deal' && <span className="badge" style={{ marginLeft: 4 }}>From the deal</span>}</div>
            <div className="page-sub" style={{ margin: '2px 0 0' }}>{[c.name ? c.email : null, c.phone].filter(Boolean).join(' · ')}{c.note ? ` · ${c.note}` : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => { setErr(''); setForm({ id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '', title: c.title || '', role: c.role, gets_invoices: c.gets_invoices, note: c.note || '' }) }} aria-label={`Edit ${c.name || c.email}`}>Edit</button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => remove(c)} aria-label={`Remove ${c.name || c.email}`}>Remove</button>
          </div>
        </div>))}
      {form && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 10 }} data-contact-form>
          {err && <div className="login-err" role="alert">{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="field"><label htmlFor="ct-name">Name</label><input id="ct-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-email">Email</label><input id="ct-email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-phone">Phone</label><input id="ct-phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-title">Title</label><input id="ct-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-role">Role</label><select id="ct-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 8px' }}><input type="checkbox" checked={form.gets_invoices} onChange={e => setForm({ ...form, gets_invoices: e.target.checked })} /> Receives the invoices</label>
          <div className="field"><label htmlFor="ct-note">Note</label><input id="ct-note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save contact' : 'Add contact'}</button>
            <button className="btn btn-ghost" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
          </div>
        </div>)}
    </div>
  )
}
