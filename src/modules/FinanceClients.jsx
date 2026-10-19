import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'
import { ReminderModal, describeReminder, saveArgs } from './FinanceReminders'

// ============================================================
// CLIENTS (Admins and Owners)
// Every client in Command Center is here, including new ones (also the ones created when a sales deal closes, with the deal's
// contact already filled in). For each client you say ONCE how it is billed:
//   - Invoiced client: which bill (billing entity) its invoices go on, and what happens to the hours worked for it
//   - Internal (Opsis's own work): never invoiced
// Hours worked for the client then follow that choice, so there are no rules to keep. A choice on one hour still wins.
// ONE INVOICE PER CLIENT: a deal or project (GarageCo: Web Leads) sits UNDER a client. Its hours are billed on that client's invoice and paid
// as usual; it has no invoice of its own and is not listed as a separate client. "Not in invoicing" means only that a client is never billed (Opsis).
// TWO CHECKBOXES per client: "Invoicing" (is it part of Finance; unticked = hidden here and its hours are not invoiced) and
// "Task management" (is it offered in the task dropdowns). They are independent.
// HOUR CAPS: a client can have several caps, weekly and monthly, each with dates and its own alert levels (see CapsSection).
// ============================================================

const KIND = { invoiced: 'Invoiced', internal: 'Internal', not_set: 'Needs setup' }
const kindBadge = (k) => k === 'invoiced' ? 'badge passed' : k === 'internal' ? 'badge' : 'badge needed'
const typeBadge = (p) => p.in_invoicing === false ? ['Not in invoicing', 'badge'] : [KIND[p.billing_kind === 'internal' ? 'not_set' : p.billing_kind], kindBadge(p.billing_kind === 'internal' ? 'not_set' : p.billing_kind)]
const shortName = (child, parent) => parent && child.name.startsWith(parent.name + ': ') ? child.name.slice(parent.name.length + 2) : child.name
function parentMessage(name, parentName) { return parentName ? `${name} is now a deal under ${parentName}. Its hours are billed on ${parentName}'s invoice and are paid as usual.` : `${name} is no longer under a client.` }
function flagMessage(name, patch) {
  if ('p_in_invoicing' in patch) return patch.p_in_invoicing ? `${name} is in invoicing.` : `${name} is out of invoicing. Hours worked for it are not invoiced.`
  return patch.p_show_in_tasks ? `${name} is offered in task management.` : `${name} is hidden from the task dropdowns. Names on existing tasks stay.`
}
const ROLES = [['primary', 'Main contact'], ['billing', 'Billing contact'], ['other', 'Other']]
const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })

export function describeHoursSetting(profile, types, entities) {
  if (profile.in_invoicing === false) return 'Not in invoicing: hours are not invoiced'
  if (profile.billing_kind === 'internal') return 'Never invoiced'
  if (profile.billing_kind === 'not_set') return 'Not set up yet'
  if (profile.hours_mode === 'no') return 'Hours are not invoiced'
  if (profile.hours_mode === 'invoice') {
    const t = types.find(x => x.id === profile.default_invoice_type_id); const e = t && entities.find(x => x.id === t.entity_id)
    return `Hours are invoiced on ${t ? (e ? `${e.name} › ${t.name}` : t.name) : 'an invoice'}`
  }
  return 'You decide each time'
}

export function ClientList({ clients, profiles, entities, links, types, retainers, terms, caps = [], onOpen, reload, flash }) {
  const [filter, setFilter] = useState('invoicing')
  const [q, setQ] = useState('')
  const today = todayET()
  const profileOf = (id) => profiles.find(p => p.client_id === id) || { billing_kind: 'not_set', hours_mode: 'decide', status: 'active', in_invoicing: true }
  const parentOf = (id) => { const pid = profileOf(id).parent_client_id; return pid ? clients.find(c => c.id === pid) : null }
  const childrenOf = (id) => clients.filter(c => profileOf(c.id).parent_client_id === id)
  const topLevelIn = clients.filter(c => profileOf(c.id).in_invoicing !== false && !profileOf(c.id).parent_client_id)
  const needs = topLevelIn.filter(c => profileOf(c.id).billing_kind !== 'invoiced' && profileOf(c.id).status !== 'ended').length
  const shown = useMemo(() => clients.filter(c => {
    const p = profileOf(c.id); const inv = p.in_invoicing !== false; const par = p.parent_client_id
    if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'deals') return !!par
    if (par) return false
    if (filter === 'out') return !inv
    if (!inv) return false
    if (filter === 'needs') return p.billing_kind !== 'invoiced' && p.status !== 'ended'
    if (filter === 'invoiced') return p.billing_kind === 'invoiced'
    return true
  }), [clients, profiles, filter, q])   // eslint-disable-line
  async function call(name, args, msg) {
    const { error } = await supabase.rpc(name, args)
    if (error) return flash(error.message)
    flash(msg); await reload()
  }
  const setFlag = (c, patch) => call('finance_client_set_flags', { p_client: c.id, p_in_invoicing: null, p_show_in_tasks: null, ...patch }, flagMessage(c.name, patch))
  const setParent = (c, parent) => call('finance_client_set_parent', { p_client: c.id, p_parent: parent ? parent.id : null }, parentMessage(c.name, parent && parent.name))
  const tickInvoicing = (c, on) => {
    const n = childrenOf(c.id).length
    if (!on && n > 0 && !window.confirm(`${c.name} has ${n} deal${n === 1 ? '' : 's'} under it. Taking it out of invoicing means hours on ${n === 1 ? 'it' : 'all of them'} are not invoiced either. Continue?`)) return
    setFlag(c, { p_in_invoicing: on })
  }
  const box = { display: 'flex', gap: 5, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }
  return (
    <div>
      <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 780 }}>The clients you invoice, <b>one invoice per client</b>. A deal or project (like GarageCo: Web Leads) sits <b>under</b> its client: its hours are billed on the client's invoice and paid as usual, with no invoice of its own. Untick <b>Invoicing</b> only for a client you never bill (like Opsis). <b>Task management</b> is separate: a client stays in the task dropdowns unless you untick it. For each client, say once how it is billed, and its hours follow that choice. You do not need rules.</p>
      {needs > 0 && <div className="card" role="note" style={{ marginBottom: 12 }}><b data-needs>{needs} client{needs === 1 ? '' : 's'} need{needs === 1 ? 's' : ''} setup.</b> Until a client is set up, hours worked for it wait for your decision. If a client is not one you invoice, untick Invoicing on it.</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[['invoicing', 'In invoicing'], ['needs', 'Needs setup'], ['invoiced', 'Invoiced'], ['deals', 'Deals under a client'], ['out', 'Not in invoicing']].map(([k, l]) => <button key={k} style={chip(filter === k)} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>)}
        <input aria-label="Search clients" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', minWidth: 180 }} />
      </div>
      {filter === 'out' && <p className="page-sub" style={{ margin: '0 0 10px' }} data-out-note>These clients are not part of Finance, and hours worked for them are not invoiced (they are still paid as usual). Tick Invoicing to bring one back, or put one under a client if it is a deal or project of that client.</p>}
      {filter === 'deals' && <p className="page-sub" style={{ margin: '0 0 10px' }} data-deals-note>These are deals and projects under a client. They are billed on that client's invoice and paid as usual.</p>}
      {shown.length === 0 && <p className="page-sub">No clients match.</p>}
      {shown.map(c => {
        const p = profileOf(c.id); const inv = p.in_invoicing !== false
        const parent = parentOf(c.id); const kids = childrenOf(c.id)
        const link = links.find(l => l.client_id === (parent ? parent.id : c.id))
        const bill = link && entities.find(e => e.id === link.entity_id)
        const owner = parent || c; const op = profileOf(owner.id)
        const rs = bill ? retainers.filter(r => types.some(t => t.id === r.invoice_type_id && t.entity_id === bill.id)) : []
        const live = parent ? [] : rs.filter(r => terms.some(t => t.retainer_id === r.id && t.effective_from <= today && (!t.effective_to || t.effective_to >= today)))
        const myCaps = caps.filter(k => k.client_id === c.id && k.effective_from <= today && (!k.effective_to || k.effective_to >= today)).sort((a, b) => a.period.localeCompare(b.period) * -1)
        const capText = myCaps.map(k => `${k.period === 'week' ? 'Weekly' : 'Monthly'} cap ${Number(k.cap_hours)} h`).join(' · ')
        const [badgeText, badgeCls] = parent ? [`Part of ${parent.name}`, 'badge'] : typeBadge(p)
        const candidates = topLevelIn.filter(x => x.id !== c.id)
        return (
          <div key={c.id} data-client={c.name} onClick={() => onOpen(c.id)}
            style={{ ...panel, marginBottom: 8, cursor: 'pointer', opacity: p.status === 'ended' ? 0.6 : inv ? 1 : 0.8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(c.id) }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name} <span className={badgeCls} style={{ marginLeft: 6 }}>{badgeText}</span>{p.status !== 'active' && <span className="badge failed" style={{ marginLeft: 6 }}>{p.status}</span>}</div>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{parent ? `Billed through ${parent.name}` : !inv ? 'Not part of Finance billing' : p.billing_kind === 'invoiced' ? (bill ? `Billed to ${bill.name}` : 'Not billed to anyone yet') : 'Choose how this client is billed'}</div>
                {kids.length > 0 && <div className="page-sub" style={{ margin: '2px 0 0' }} data-kids>Deals and projects under it: {kids.map(k => shortName(k, c)).join(', ')}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="page-sub" style={{ margin: '2px 0 0' }}>{parent ? `Hours follow ${parent.name}: ${describeHoursSetting(op, types, entities)}` : describeHoursSetting(p, types, entities)}</div>
                {(live.length > 0 || capText) && <div className="page-sub" style={{ margin: '2px 0 0' }}>{live.length > 0 ? `${live.length} retainer${live.length === 1 ? '' : 's'}` : ''}{live.length > 0 && capText ? ' · ' : ''}{capText}</div>}
                <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} style={{ display: 'flex', gap: 14, justifyContent: 'flex-end', marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }} data-flags-row>
                  {parent
                    ? <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setParent(c, null)} aria-label={`Take ${c.name} out of ${parent.name}`}>Take out of {parent.name}</button>
                    : <label style={box}><input type="checkbox" aria-label={`Include ${c.name} in invoicing`} checked={inv} onChange={e => tickInvoicing(c, e.target.checked)} /> Invoicing</label>}
                  <label style={box}><input type="checkbox" aria-label={`Show ${c.name} in task management`} checked={c.show_in_tasks !== false} onChange={e => setFlag(c, { p_show_in_tasks: e.target.checked })} /> Task management</label>
                  {!parent && !inv && candidates.length > 0 && (
                    <select aria-label={`Put ${c.name} under a client`} value="" onChange={e => { const t = candidates.find(x => x.id === e.target.value); if (t) setParent(c, t) }} style={{ fontSize: 12.5 }}>
                      <option value="">Put under a client…</option>{candidates.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>)}
                </div>
              </div>
            </div>
          </div>)
      })}
    </div>
  )
}

export function ClientPage({ client, profile, entities, links, types, contacts, retainers, terms, caps = [], reminders = [], rates = [], deals = [], allClients = [], profiles = [], onBack, onOpenBill, onOpenClient, reload, flash }) {
  const p = profile || { billing_kind: 'not_set', hours_mode: 'decide', status: 'active', in_invoicing: true }
  const inv = p.in_invoicing !== false
  const profOf = (id) => profiles.find(x => x.client_id === id) || {}
  const parentClient = p.parent_client_id ? allClients.find(c => c.id === p.parent_client_id) : null
  const isChild = !!parentClient
  const kids = allClients.filter(c => profOf(c.id).parent_client_id === client.id)
  const candidates = allClients.filter(c => c.id !== client.id && !profOf(c.id).parent_client_id && !kids.some(k => k.id === c.id) && !allClients.some(x => profOf(x.id).parent_client_id === c.id)).sort((a, b) => a.name.localeCompare(b.name))
  const parentCandidates = allClients.filter(c => c.id !== client.id && profOf(c.id).in_invoicing !== false && !profOf(c.id).parent_client_id)
  const link = links.find(l => l.client_id === client.id)
  const [kind, setKind] = useState(p.billing_kind === 'internal' ? 'not_set' : p.billing_kind)
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

  const checklist = [['Chosen how this client is billed', p.billing_kind === 'invoiced'],
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
    flash(kind === 'not_set' ? `${client.name} is back to needing setup.` : `Saved. ${client.name} is an invoiced client.`)
    await reload()
  }
  async function setFlag(patch) {
    const { error } = await supabase.rpc('finance_client_set_flags', { p_client: client.id, p_in_invoicing: null, p_show_in_tasks: null, ...patch })
    if (error) return flash(error.message)
    flash(flagMessage(client.name, patch)); await reload()
  }
  async function setParentFor(child, parent) {
    const { error } = await supabase.rpc('finance_client_set_parent', { p_client: child.id, p_parent: parent ? parent.id : null })
    if (error) return flash(error.message)
    flash(parentMessage(child.name, parent && parent.name)); await reload()
  }
  function tickInvoicing(on) {
    if (!on && kids.length > 0 && !window.confirm(`${client.name} has ${kids.length} deal${kids.length === 1 ? '' : 's'} under it. Taking it out of invoicing means hours on ${kids.length === 1 ? 'it' : 'all of them'} are not invoiced either. Continue?`)) return
    setFlag({ p_in_invoicing: on })
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
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>{client.name} <span className={isChild ? 'badge' : typeBadge(p)[1]} style={{ marginLeft: 6, fontSize: 12 }}>{isChild ? `Part of ${parentClient.name}` : typeBadge(p)[0]}</span></h2>
      <p className="page-sub" style={{ margin: '0 0 14px' }}>{isChild ? `Hours follow ${parentClient.name}: ${describeHoursSetting(profOf(parentClient.id), types, entities)}` : describeHoursSetting(p, types, entities)}</p>

      <div style={{ ...panel, marginBottom: 14 }} data-flags>
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Where this client is used</h3>
        {isChild ? (
          <div data-part-of style={{ padding: '4px 0' }}>
            <div><b>Part of {parentClient.name}</b></div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '2px 0 6px' }}>This is a deal or project under {parentClient.name}. Its hours are billed on {parentClient.name}'s invoice and paid as usual. It has no invoice of its own.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => onOpenClient(parentClient.id)}>Open {parentClient.name}</button>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setParentFor(client, null)}>Take it out of {parentClient.name}</button>
            </div>
          </div>
        ) : (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
            <input type="checkbox" aria-label="Include in invoicing" checked={inv} onChange={e => tickInvoicing(e.target.checked)} style={{ marginTop: 3 }} />
            <span><b>Invoicing</b><span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-soft)' }}>This client gets its own invoice. Unticked, it is hidden from the Clients list here, and hours worked for it are not invoiced. Pay is not affected.</span></span>
          </label>)}
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
          <input type="checkbox" aria-label="Show in task management" checked={client.show_in_tasks !== false} onChange={e => setFlag({ p_show_in_tasks: e.target.checked })} style={{ marginTop: 3 }} />
          <span><b>Task management</b><span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-soft)' }}>Offered in the client dropdowns for the timer, tasks and recurring tasks. Names already on tasks always stay.</span></span>
        </label>
      </div>

      {inv && !isChild && (
        <div style={{ ...panel, marginBottom: 14 }} data-deals>
          <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Deals and projects under {client.name}</h3>
          <p className="page-sub" style={{ margin: '0 0 8px' }}>One invoice for the client. These roll up into it: their hours are billed on its invoice and paid as usual.</p>
          {kids.length === 0 && <p className="page-sub" style={{ margin: '0 0 8px' }}>None yet.</p>}
          {kids.map(k => (
            <div key={k.id} data-deal={k.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', padding: '6px 0' }}>
              <span>{k.name}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => onOpenClient(k.id)} aria-label={`Open ${k.name}`}>Open</button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setParentFor(k, null)} aria-label={`Take ${k.name} out of ${client.name}`}>Take out</button>
              </span>
            </div>))}
          {candidates.length > 0 && <div className="field" style={{ maxWidth: 420, marginTop: 8 }}><label htmlFor="cl-adddeal">Add a deal or project</label>
            <select id="cl-adddeal" value="" onChange={e => { const t = candidates.find(x => x.id === e.target.value); if (t) setParentFor(t, client) }}><option value="">Choose a client…</option>{candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        </div>)}

      {!inv && !isChild && <div className="card" style={{ marginBottom: 14 }} data-not-invoiced>This client is not in invoicing. It is hidden from the Clients list here, and hours worked for it are not invoiced (they are still paid as usual). Tick <b>Invoicing</b> above to set up its billing.
        {parentCandidates.length > 0 && <div className="field" style={{ maxWidth: 420, marginTop: 8 }}><label htmlFor="cl-putunder">Or, if this is a deal or project of a client you invoice, put it under that client</label>
          <select id="cl-putunder" value="" onChange={e => { const t = parentCandidates.find(x => x.id === e.target.value); if (t) setParentFor(client, t) }}><option value="">Choose a client…</option>{parentCandidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      </div>}
      {inv && !isChild && (<>
      <div style={{ ...panel, marginBottom: 14 }} data-checklist>
        <b>{left === 0 ? 'This client is ready.' : `${left} thing${left === 1 ? '' : 's'} left to set up`}</b>
        <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
          {checklist.map(([t, ok]) => <li key={t} style={{ padding: '2px 0', color: ok ? 'var(--ink)' : 'var(--ink-soft)' }}><span aria-hidden="true">{ok ? '✓' : '○'}</span> <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>{ok ? 'Done: ' : 'To do: '}</span>{t}</li>)}
        </ul>
      </div>

      <div style={{ ...panel, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>How is this client billed?</h3>
        {err && <div className="login-err" role="alert">{err}</div>}
        {[['invoiced', 'Invoiced client', 'We send invoices for this client.'], ['not_set', 'Not set up yet', 'Hours worked for it wait for your decision.']].map(([k, l, h]) => (
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
            <div style={{ fontWeight: 600, fontSize: 14 }}>Hour caps</div>
            <div className="page-sub" style={{ margin: 0 }}>{(() => { const a = caps.filter(k => k.effective_from <= today && (!k.effective_to || k.effective_to >= today)); return a.length ? a.map(k => `${k.period === 'week' ? 'Weekly' : 'Monthly'}: ${Number(k.cap_hours)} hours`).join(' · ') : 'No cap set (see Hour caps below)' })()}</div>
          </div>
        </div>)}
      </>)}

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

      {!isChild && savedBill && <WhatClientPays bill={savedBill} billTypes={savedTypes} rates={rates} deals={deals} retainers={retainers} terms={terms} onOpenBill={() => onOpenBill(savedBill.id)} />}

      <CapsSection client={client} caps={caps} reload={reload} flash={flash} />

      <RemindersSection client={client} bill={isChild ? null : savedBill} billTypes={isChild ? [] : savedTypes} reminders={reminders} entities={entities} types={types} allClients={allClients} reload={reload} flash={flash} />

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


// ---------- hour caps: several per client, dated, weekly or monthly, with the alert levels you choose ----------
const LEVELS = [50, 75, 80, 90, 100, 110]
const DEFAULT_LEVELS = [50, 80, 90, 100]
const capColor = (pct) => pct == null ? 'var(--ink-soft)' : pct >= 100 ? 'var(--failed)' : pct >= 90 ? '#ea580c' : pct >= 80 ? '#d97706' : '#16a34a'
const fmtHrs = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const perWord = (p) => p === 'week' ? 'week' : 'month'

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width, maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-label={title}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function CapsSection({ client, caps, reload, flash }) {
  const today = todayET()
  const [status, setStatus] = useState([])
  const [modal, setModal] = useState(null)
  const [err, setErr] = useState('')
  const key = caps.map(k => `${k.id}${k.effective_from}${k.effective_to}${k.cap_hours}`).join('|')
  useEffect(() => {
    let alive = true
    supabase.rpc('finance_client_cap_status', { p_as_of: null }).then(({ data }) => { if (alive) setStatus((data || []).filter(x => x.client_id === client.id)) })
    return () => { alive = false }
  }, [client.id, key])   // eslint-disable-line
  const state = (k) => k.effective_from > today ? 'later' : (!k.effective_to || k.effective_to >= today) ? 'now' : 'ended'
  const levelsText = (k) => (k.thresholds || []).length ? `Alerts at ${k.thresholds.join('%, ')}%` : 'No alerts'
  const inEffect = (period) => caps.find(k => k.period === period && state(k) === 'now') || caps.filter(k => k.period === period).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || null

  async function remove(k) {
    if (!window.confirm(`Delete the ${perWord(k.period)}ly cap that starts ${fmtDate(k.effective_from)}?`)) return
    const { error } = await supabase.rpc('finance_client_cap_delete', { p_cap: k.id })
    if (error) return setErr(error.message)
    setErr(''); flash('Cap deleted.'); await reload()
  }
  const group = (period) => caps.filter(k => k.period === period).sort((a, b) => b.effective_from.localeCompare(a.effective_from))

  return (
    <div style={{ ...panel, marginBottom: 14 }} data-caps>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Hour caps</h3>
        <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setModal({ kind: 'set', period: 'week' })}>{caps.length ? 'Set or change a cap' : '+ Set a cap'}</button>
      </div>
      <p className="page-sub" style={{ margin: '0 0 8px', maxWidth: 700 }}>Limit the hours delivered to this client. It can have a weekly cap and a monthly cap at the same time, and every cap has dates, so a change never rewrites the past. The Admins get a bell alert at the levels you choose.</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      {caps.length === 0 && <p className="page-sub" style={{ margin: 0 }}>No caps. Set one if this client has a limit on hours.</p>}
      {['week', 'month'].map(period => group(period).length > 0 && (
        <div key={period} data-cap-group={period}>
          <div style={{ fontWeight: 600, fontSize: 14, margin: '10px 0 2px' }}>{period === 'week' ? 'Weekly caps (Monday to Sunday)' : 'Monthly caps (calendar month)'}</div>
          {group(period).map(k => {
            const st = state(k); const s = status.find(x => x.cap_id === k.id)
            return (
              <div key={k.id} data-cap={`${period}-${k.effective_from}`} style={{ borderTop: '1px solid var(--line)', padding: '9px 0', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 260, flex: 1 }}>
                  <div><b>{fmtHrs(k.cap_hours)} hours a {perWord(period)}</b> · from {fmtDate(k.effective_from)} {k.effective_to ? `to ${fmtDate(k.effective_to)}` : 'until changed'}
                    {st === 'now' && <span className="badge passed" style={{ marginLeft: 6 }}>In effect now</span>}{st === 'later' && <span className="badge needed" style={{ marginLeft: 6 }}>Starts later</span>}{st === 'ended' && <span className="badge" style={{ marginLeft: 6 }}>Ended</span>}</div>
                  <div className="page-sub" style={{ margin: '2px 0 0' }}>{levelsText(k)}{k.warn_projected ? ' · warns when on pace to exceed' : ''}{k.note ? ` · ${k.note}` : ''}</div>
                  {st === 'now' && s && (
                    <div style={{ marginTop: 6, maxWidth: 380 }} data-meter>
                      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--line-soft)', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', inset: 0, width: `${Math.min(Number(s.projected_pct) || 0, 100)}%`, background: capColor(Number(s.projected_pct)), opacity: 0.22 }} />
                        <div style={{ position: 'absolute', inset: 0, width: `${Math.min(Number(s.pct) || 0, 100)}%`, background: capColor(Number(s.pct)) }} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
                        <span style={{ color: capColor(Number(s.pct)), fontWeight: 600 }}>{fmtHrs(s.delivered)}</span> of {fmtHrs(k.cap_hours)} hours this {perWord(period)} ({s.pct}%)
                        {Number(s.scheduled_remaining) > 0 && ` · ${fmtHrs(s.scheduled_remaining)} still scheduled`}
                        {Number(s.projected_pct) >= 100 && Number(s.pct) < 100 && <span style={{ color: '#d97706', fontWeight: 600 }}> · on pace for {s.projected_pct}%</span>}
                      </div>
                    </div>)}
                </div>
                <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setModal({ kind: 'set', period, base: k })} aria-label={`Change the ${perWord(period)}ly cap from ${fmtDate(k.effective_from)}`}>Change</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setModal({ kind: 'end', cap: k })} aria-label={`Set when the ${perWord(period)}ly cap from ${fmtDate(k.effective_from)} stops`}>{k.effective_to ? 'End date' : 'Stop'}</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => remove(k)} aria-label={`Delete the ${perWord(period)}ly cap from ${fmtDate(k.effective_from)}`}>Delete</button>
                </div>
              </div>)
          })}
        </div>))}
      <p className="page-sub" style={{ margin: '10px 0 0', fontSize: 12 }}>What counts: Five9 time for dialer clients, worked shift time for the others, plus tracked task and meeting time for this client. Each alert fires once per week or month.</p>
      {modal?.kind === 'set' && <SetCapModal client={client} today={today} inEffect={inEffect} start={modal} onClose={() => setModal(null)} onSaved={(m) => { setModal(null); flash(m); reload() }} />}
      {modal?.kind === 'end' && <EndCapModal cap={modal.cap} today={today} onClose={() => setModal(null)} onSaved={(m) => { setModal(null); flash(m); reload() }} />}
    </div>
  )
}

function SetCapModal({ client, today, inEffect, start, onClose, onSaved }) {
  const base0 = start.base || inEffect(start.period)
  const [period, setPeriod] = useState(start.period || 'week')
  const [startDate, setStartDate] = useState(today)
  const [hours, setHours] = useState(base0 ? String(Number(base0.cap_hours)) : '')
  const [levels, setLevels] = useState(base0 ? [...(base0.thresholds || [])] : [...DEFAULT_LEVELS])
  const [warn, setWarn] = useState(base0 ? !!base0.warn_projected : true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const existing = inEffect(period)
  const switchPeriod = (p) => { setPeriod(p); const b = inEffect(p); setHours(b ? String(Number(b.cap_hours)) : ''); setLevels(b ? [...(b.thresholds || [])] : [...DEFAULT_LEVELS]); setWarn(b ? !!b.warn_projected : true) }
  const toggle = (l) => setLevels(p => p.includes(l) ? p.filter(x => x !== l) : [...p, l])
  async function save() {
    setErr('')
    const h = Number(hours)
    if (!startDate) return setErr('Choose the date this cap starts.')
    if (hours === '' || !(h > 0)) return setErr('Enter the cap in hours, more than 0.')
    setBusy(true)
    const { error } = await supabase.rpc('finance_client_cap_change_from', { p_client: client.id, p_period: period, p_start: startDate, p_hours: h, p_thresholds: [...levels].sort((a, b) => a - b), p_warn_projected: warn, p_note: note.trim() || null })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(`Saved. ${client.name} has a ${period === 'week' ? 'weekly' : 'monthly'} cap of ${fmtHrs(h)} hours from ${fmtDate(startDate)}.`)
  }
  return (
    <Modal title={`Set or change a cap: ${client.name}`} onClose={onClose}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Which kind of cap?</div>
      {[['week', 'Weekly', 'Counted Monday to Sunday'], ['month', 'Monthly', 'Counted over the calendar month']].map(([v, l, h]) => (
        <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0' }}><input type="radio" name="cap-period" value={v} checked={period === v} onChange={() => switchPeriod(v)} style={{ marginTop: 3 }} /> <span><b>{l}</b><span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-soft)' }}>{h}</span></span></label>))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div className="field"><label htmlFor="cap-hours">Cap (hours) *</label><input id="cap-hours" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} placeholder="e.g. 40" /></div>
        <div className="field"><label htmlFor="cap-start">Starting on *</label><input id="cap-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
      </div>
      {existing && <div className="hint" role="note" style={{ marginBottom: 8 }}>This client already has a {period === 'week' ? 'weekly' : 'monthly'} cap of {fmtHrs(existing.cap_hours)} hours. From the start date on, the new cap replaces it, and the earlier one ends the day before.</div>}
      <div style={{ fontWeight: 600, fontSize: 14, margin: '4px 0' }}>Alert the Admins at</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
        {LEVELS.map(l => <label key={l} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" aria-label={`Alert at ${l} percent`} checked={levels.includes(l)} onChange={() => toggle(l)} /> {l}%</label>)}
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>{levels.length === 0 ? 'No alerts will be sent for this cap.' : 'Each level alerts once per ' + (period === 'week' ? 'week' : 'month') + ' in the bell.'}</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 8px' }}><input type="checkbox" checked={warn} onChange={e => setWarn(e.target.checked)} /> Also warn me when the shifts still scheduled would take the client over the cap</label>
      <div className="field"><label htmlFor="cap-note">Note (optional)</label><input id="cap-note" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. per the contract renewal" /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save the cap'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}

function EndCapModal({ cap, today, onClose, onSaved }) {
  const [noEnd, setNoEnd] = useState(!cap.effective_to && false)
  const [end, setEnd] = useState(cap.effective_to || today)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    if (!noEnd && !end) return setErr('Choose the last day of this cap.')
    if (!noEnd && end < cap.effective_from) return setErr('A cap cannot end before it starts.')
    setBusy(true)
    const { error } = await supabase.rpc('finance_client_cap_end', { p_cap: cap.id, p_end: noEnd ? null : end })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(noEnd ? 'The cap now runs until changed.' : `The cap ends on ${fmtDate(end)}.`)
  }
  return (
    <Modal title="When does this cap stop?" onClose={onClose} width={440}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ marginTop: 0 }}>The {fmtHrs(cap.cap_hours)}-hour {cap.period === 'week' ? 'weekly' : 'monthly'} cap from {fmtDate(cap.effective_from)}.</p>
      <div className="field"><label htmlFor="cap-end">Last day</label><input id="cap-end" type="date" value={end} min={cap.effective_from} onChange={e => setEnd(e.target.value)} disabled={noEnd} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}><input type="checkbox" checked={noEnd} onChange={e => setNoEnd(e.target.checked)} /> No end date: let it run until changed</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}



// ---------- invoice dates and reminders for this client ----------
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ord = (n) => { const x = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (x[(v - 20) % 10] || x[v] || x[0]) }
export function invoiceScheduleText(t) {
  if (t.invoice_day == null) return 'No schedule set'
  if (t.invoice_frequency === 'weekly') return `Every ${WEEKDAYS[t.invoice_day - 1]}`
  if (t.invoice_frequency === 'biweekly') return `Every two weeks on ${WEEKDAYS[t.invoice_day - 1]}`
  if (t.invoice_frequency === 'semimonthly') return `Twice a month, on the ${ord(t.invoice_day)} and the ${ord(t.invoice_day2)}`
  return `Monthly on the ${ord(t.invoice_day)}`
}

function RemindersSection({ client, bill, billTypes, reminders, entities, types, allClients, reload, flash }) {
  const [next, setNext] = useState({})
  const [modal, setModal] = useState(null)
  const [err, setErr] = useState('')
  const key = billTypes.map(t => t.id).join(',')
  useEffect(() => {
    let alive = true
    Promise.all(billTypes.filter(t => t.invoice_day != null).map(async t => { const { data } = await supabase.rpc('finance_type_next_invoice_date', { p_type: t.id }); return [t.id, data] }))
      .then(rows => { if (alive) setNext(Object.fromEntries(rows)) })
    return () => { alive = false }
  }, [key])   // eslint-disable-line
  const mine = reminders.filter(r => (bill && r.entity_id === bill.id && (r.kind === 'invoice_date' || r.kind === 'invoice_overdue')) || (r.kind === 'custom' && r.client_id === client.id))
  async function toggle(r) {
    const { error } = await supabase.rpc('finance_reminder_save', saveArgs(r, { active: !r.active }))
    if (error) return setErr(error.message)
    setErr(''); flash(`${r.name}: ${r.active ? 'switched off' : 'switched on'}.`); await reload()
  }
  return (
    <div style={{ ...panel, marginBottom: 14 }} data-reminders>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Invoice dates and reminders</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {bill && <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setModal({ defaults: { kind: 'invoice_date', entity_id: bill.id, lead_days: 3, name: `${client.name}: 3 days before an invoice date` } })}>+ Remind me before an invoice date</button>}
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setModal({ defaults: { kind: 'custom', client_id: client.id, name: '' } })}>+ Add a reminder for this client</button>
        </div>
      </div>
      {err && <div className="login-err" role="alert">{err}</div>}
      {billTypes.length > 0 && (
        <div data-invoice-dates style={{ margin: '4px 0 8px' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Invoice dates</div>
          {billTypes.map(t => <div key={t.id} className="page-sub" style={{ margin: '2px 0' }} data-invoice-date={t.name}><b>{t.name}</b>: {invoiceScheduleText(t)}{next[t.id] ? ` · next invoice date ${fmtDate(next[t.id])}` : ''}</div>)}
          <div className="page-sub" style={{ margin: '2px 0', fontSize: 12 }}>Change the dates under "Open the bill".</div>
        </div>)}
      <div style={{ fontWeight: 600, fontSize: 14 }}>Reminders for this client</div>
      {mine.length === 0 && <p className="page-sub" style={{ margin: '2px 0 0' }}>None of its own yet. The built-in reminders (every invoice date, overdue invoices, pay periods) already cover every client and are managed on the Reminders tab.</p>}
      {mine.map(r => (
        <div key={r.id} data-client-reminder={r.name} style={{ borderTop: '1px solid var(--line)', padding: '8px 0', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div><b>{r.name}</b>{!r.active && <span className="badge failed" style={{ marginLeft: 6 }}>Off</span>}<div className="page-sub" style={{ margin: '2px 0 0' }}>{describeReminder(r, entities, types, allClients)}</div></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}><input type="checkbox" aria-label={`Turn ${r.name} on`} checked={r.active} onChange={() => toggle(r)} /> On</label>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setModal({ reminder: r })} aria-label={`Change ${r.name}`}>Change</button>
          </div>
        </div>))}
      {modal && <ReminderModal reminder={modal.reminder} defaults={modal.defaults} entities={entities} types={types} clients={allClients} onClose={() => setModal(null)}
        onSaved={async (msg) => { setModal(null); flash(msg); await reload() }} />}
    </div>
  )
}


// ---------- what this client pays (separate from what the team is paid) ----------
const rateMoney = (n) => { const v = Number(n); return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }) }
const UNIT_TEXT = { hour: 'per hour', call: 'per call', flat: 'flat fee on each invoice' }
function WhatClientPays({ bill, billTypes, rates, deals, retainers, terms, onOpenBill }) {
  const today = todayET()
  const mine = rates.filter(r => r.entity_id === bill.id && r.active && !(r.effective_to && r.effective_to < today))
  const dealName = (id) => (deals.find(d => d.id === id) || {}).name
  const scope = (r) => { const roles = r.roles || [], ds = (r.deal_ids || []).map(dealName).filter(Boolean); return `${roles.length === 0 ? 'any role' : roles.length > 3 ? `${roles.length} roles` : roles.join(', ')} · ${ds.length ? ds.join(', ') : 'any deal'}` }
  const orphans = mine.filter(r => !r.invoice_type_id)
  const retainerTerm = (rt) => terms.filter(t => t.retainer_id === rt.id && t.effective_from <= today && (!t.effective_to || t.effective_to >= today)).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]
  return (
    <div style={{ ...panel, marginBottom: 14 }} data-pays>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>What this client pays</h3>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={onOpenBill}>Edit rates</button>
      </div>
      <p className="page-sub" style={{ margin: '2px 0 6px' }}>Set on this client's bill. These rates are their own and have nothing to do with what you pay your team.</p>
      {billTypes.length === 0 && <p className="page-sub" style={{ margin: 0 }}>No invoice yet. Add one under "Open the bill".</p>}
      {billTypes.map(t => {
        const lines = mine.filter(r => r.invoice_type_id === t.id)
        const rts = retainers.filter(r => r.invoice_type_id === t.id)
        return (
          <div key={t.id} data-pay-invoice={t.name} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
            <b>{t.name}</b> <span className="page-sub">· {t.billing_method === 'coverage' ? 'billed as a retainer' : 'billed from hours'}</span>
            {rts.map(rt => { const tm = retainerTerm(rt); return <div key={rt.id} data-pay-retainer={rt.name} className="page-sub" style={{ margin: '2px 0' }}>Retainer “{rt.name}”: {tm ? `${Number(tm.agents_per_hour)} ${Number(tm.agents_per_hour) === 1 ? 'agent' : 'agents'} per hour at ${rateMoney(tm.rate_per_agent_hour)} per agent hour` : 'no terms yet'}</div> })}
            {lines.map(r => <div key={r.id} data-pay-rate={r.product_name} className="page-sub" style={{ margin: '2px 0', opacity: r.effective_from > today ? 0.6 : 1 }}>{r.product_name}: {rateMoney(r.rate)} {UNIT_TEXT[r.unit]} · {scope(r)}{r.effective_from > today ? ` · starts ${fmtDate(r.effective_from)}` : ''}</div>)}
            {rts.length === 0 && lines.length === 0 && <div className="page-sub" style={{ margin: '2px 0' }}>No rates yet.</div>}
          </div>)
      })}
      {orphans.length > 0 && (
        <div role="note" data-orphans style={{ borderTop: '1px solid var(--line)', padding: '8px 0 0', color: '#b45309' }}>
          ⚠ Not on any invoice, so never billed: {orphans.map(r => `${r.product_name} (${rateMoney(r.rate)} ${UNIT_TEXT[r.unit]})`).join(', ')}. Open the bill, go to Rate card, press Edit, and choose the invoice.
        </div>)}
    </div>
  )
}
