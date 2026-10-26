import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, panel } from './financeBits'
import { Modal } from './FinanceInvoices'

// ============================================================
// REMINDERS (Admins and Owners)
// Built-in reminders (on each invoice date, when an invoice is overdue, when a pay period ends) are ready to use.
// Add your own too: once, daily, weekly, monthly or every few days, about a client or not. Each goes to the bell once
// per occasion per person, never before 8 am New York time. Finance reminders only go to Admins and Owners.
// ============================================================

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const KIND_LABEL = { invoice_date: 'Invoice date', invoice_overdue: 'Overdue invoice', pay_run: 'Pay period', document_expiry: 'Document expires', custom: 'Your own' }
const plural = (n, w) => `${n} ${w}${Number(n) === 1 ? '' : 's'}`
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

export function scheduleText(r) {
  if (r.schedule === 'once') return `Once, on ${fmtDate(r.run_on)}`
  if (r.schedule === 'daily') return 'Every day'
  if (r.schedule === 'weekly') return `Every ${DAYS[(r.weekday || 1) - 1]}`
  if (r.schedule === 'monthly') return `Every month on the ${ordinal(r.month_day)}`
  if (r.schedule === 'every_n_days') return `Every ${plural(r.every_days, 'day')}, starting ${fmtDate(r.anchor)}`
  return ''
}
export function describeReminder(r, entities = [], types = [], clients = []) {
  const e = r.entity_id ? entities.find(x => x.id === r.entity_id) : null
  const t = r.invoice_type_id ? types.find(x => x.id === r.invoice_type_id) : null
  const scope = t ? `${t.name} for ${e ? e.name : 'its client'}` : e ? `every invoice for ${e.name}` : 'every client'
  if (r.kind === 'invoice_date') return `${r.lead_days === 0 ? 'On' : `${plural(r.lead_days, 'day')} before`} the invoice date: ${scope}`
  if (r.kind === 'invoice_overdue') return `${plural(r.lead_days, 'day')} after the due date, while a balance remains: ${scope}`
  if (r.kind === 'pay_run') return `${r.lead_days === 0 ? 'On the day' : `${plural(r.lead_days, 'day')} after`} a pay period ends (the 15th and the end of the month), if no pay run covers it`
  const c = r.client_id ? clients.find(x => x.id === r.client_id) : null
  if (r.kind === 'document_expiry') return `${r.lead_days === 0 ? 'On the day' : `${plural(r.lead_days, 'day')} before`} a contract or document expires: ${c ? c.name : 'every client'}`
  return `${scheduleText(r)}${c ? `, about ${c.name}` : ''}`
}

const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })

export function saveArgs(r, over = {}) {
  const x = { ...r, ...over }
  return { p_id: x.id || null, p_kind: x.kind, p_name: x.name, p_entity: x.entity_id || null, p_type: x.invoice_type_id || null, p_client: x.client_id || null, p_schedule: x.schedule || null, p_run_on: x.run_on || null,
    p_weekday: x.weekday || null, p_month_day: x.month_day || null, p_every_days: x.every_days || null, p_anchor: x.anchor || null, p_lead_days: x.lead_days ?? 0, p_recipients: x.recipients || [], p_message: x.message || null, p_active: x.active !== false }
}

export default function FinanceReminders({ flash }) {
  const [reminders, setReminders] = useState([])
  const [entities, setEntities] = useState([])
  const [types, setTypes] = useState([])
  const [clients, setClients] = useState([])
  const [people, setPeople] = useState([])
  const [lastSent, setLastSent] = useState({})
  const [preview, setPreview] = useState([])
  const [days, setDays] = useState(14)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)       // null | { reminder? , defaults? }

  const load = useCallback(async () => {
    const [rm, en, ty, cl, pe, lg] = await Promise.all([
      supabase.from('finance_reminders').select('*').order('created_at'),
      supabase.from('finance_billing_entities').select('id,name').order('name'),
      supabase.from('finance_invoice_types').select('id,entity_id,name,active').order('name'),
      supabase.from('clients').select('id,name').order('name'),
      supabase.rpc('finance_reminder_people'),
      supabase.from('finance_reminder_log').select('reminder_id,fired_on').order('fired_on', { ascending: false }).limit(500),
    ])
    const first = rm.error || en.error || ty.error || cl.error || pe.error
    setErr(first ? first.message : '')
    setReminders(rm.data || []); setEntities(en.data || []); setTypes(ty.data || []); setClients(cl.data || []); setPeople(pe.data || [])
    const m = {}; (lg.data || []).forEach(x => { if (!m[x.reminder_id]) m[x.reminder_id] = x.fired_on }); setLastSent(m)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { supabase.rpc('finance_reminders_preview', { p_from: null, p_days: days }).then(({ data }) => setPreview(data || [])) }, [days, reminders])

  async function toggle(r) {
    const { error } = await supabase.rpc('finance_reminder_save', saveArgs(r, { active: !r.active }))
    if (error) return setErr(error.message)
    setErr(''); flash(`${r.name}: ${r.active ? 'switched off' : 'switched on'}.`); await load()
  }
  async function test(r) {
    const { data, error } = await supabase.rpc('finance_reminder_test', { p_id: r.id })
    if (error) return setErr(error.message)
    setErr(''); flash(`${data} Look at your bell.`)
  }
  async function remove(r) {
    if (!window.confirm(`Delete the reminder "${r.name}"?`)) return
    const { error } = await supabase.rpc('finance_reminder_delete', { p_id: r.id })
    if (error) return setErr(error.message)
    setErr(''); flash('Reminder deleted.'); await load()
  }
  const whoText = (r) => (r.recipients || []).length === 0 ? 'All Admins and Owners' : r.recipients.map(id => (people.find(p => p.id === id) || {}).full_name || 'someone').join(', ')
  const byDate = useMemo(() => { const m = {}; preview.forEach(p => { (m[p.on_date] = m[p.on_date] || []).push(p) }); return Object.entries(m) }, [preview])

  if (loading) return <p className="page-sub">Loading…</p>
  const builtIn = reminders.filter(r => r.built_in); const own = reminders.filter(r => !r.built_in)
  const Row = ({ r }) => (
    <div data-reminder={r.name} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 600 }}>{r.name} <span className="badge" style={{ marginLeft: 6 }}>{KIND_LABEL[r.kind]}</span>{!r.active && <span className="badge failed" style={{ marginLeft: 6 }}>Off</span>}</div>
        <div className="page-sub" style={{ margin: '2px 0 0' }} data-when>{describeReminder(r, entities, types, clients)}</div>
        <div className="page-sub" style={{ margin: '2px 0 0' }} data-who>Goes to: {whoText(r)}{lastSent[r.id] ? ` · last sent ${fmtDate(lastSent[r.id])}` : ' · not sent yet'}</div>
        {r.message && <div className="page-sub" style={{ margin: '2px 0 0' }}>“{r.message}”</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}><input type="checkbox" aria-label={`Turn ${r.name} on`} checked={r.active} onChange={() => toggle(r)} /> On</label>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setEditing({ reminder: r })} aria-label={`Change ${r.name}`}>Change</button>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => test(r)} aria-label={`Send me a test of ${r.name}`}>Send me a test</button>
        {!r.built_in && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => remove(r)} aria-label={`Delete ${r.name}`}>Delete</button>}
      </div>
    </div>)

  return (
    <div>
      <p className="page-sub" style={{ margin: '0 0 12px', maxWidth: 780 }}>Reminders arrive in your bell. The built-in ones are on and ready: on each invoice date, when an invoice is overdue, and when a pay period ends. Add your own for anything else. Each reminder is sent once per occasion, never before 8 am Eastern, and invoice and pay reminders only go to Admins and Owners.</p>
      {err && <div className="login-err" role="alert">{err}</div>}

      <div style={{ ...panel, marginBottom: 14 }} data-preview>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Coming up</h3>
          <div style={{ display: 'flex', gap: 6 }}>{[14, 30, 60].map(n => <button key={n} style={chip(days === n)} onClick={() => setDays(n)} aria-pressed={days === n}>{n} days</button>)}</div>
        </div>
        {byDate.length === 0 && <p className="page-sub" style={{ margin: '8px 0 0' }}>Nothing is due in the next {days} days.</p>}
        {byDate.map(([d, items]) => (
          <div key={d} data-day={d} style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 6 }}>
            <b>{fmtDate(d)}</b>
            {items.map((it, i) => <div key={i} className="page-sub" style={{ margin: '2px 0 0' }}>{it.title} <span style={{ opacity: 0.7 }}>· to {it.recipient_count === 1 ? '1 person' : `${it.recipient_count} people`}</span></div>)}
          </div>))}
      </div>

      <div style={{ ...panel, marginBottom: 14 }} data-builtin>
        <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Built-in reminders</h3>
        {builtIn.map(r => <Row key={r.id} r={r} />)}
      </div>

      <div style={{ ...panel, marginBottom: 14 }} data-own>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Your reminders</h3>
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setEditing({})}>+ Add a reminder</button>
        </div>
        {own.length === 0 && <p className="page-sub" style={{ margin: '8px 0 0' }}>None yet. Add one for anything you want to be reminded of, such as a monthly check-in, a contract renewal, or three days before an invoice date.</p>}
        {own.map(r => <Row key={r.id} r={r} />)}
      </div>

      {editing && <ReminderModal reminder={editing.reminder} defaults={editing.defaults} entities={entities} types={types} clients={clients} people={people} onClose={() => setEditing(null)}
        onSaved={async (msg) => { setEditing(null); flash(msg); await load() }} />}
    </div>
  )
}

export function ReminderModal({ reminder, defaults = {}, entities, types, clients, people: peopleIn, onClose, onSaved }) {
  const isNew = !reminder
  const r0 = reminder || { kind: 'custom', name: '', entity_id: null, invoice_type_id: null, client_id: null, schedule: 'once', run_on: '', weekday: 5, month_day: 1, every_days: 7, anchor: todayET(), lead_days: 0, recipients: [], message: '', active: true, ...defaults }
  const [people, setPeople] = useState(peopleIn || [])
  const [f, setF] = useState({ ...r0, run_on: r0.run_on || '', anchor: r0.anchor || todayET(), weekday: r0.weekday || 5, month_day: r0.month_day || 1, every_days: r0.every_days || 7, schedule: r0.schedule || 'once', message: r0.message || '', recipients: r0.recipients || [] })
  const [who, setWho] = useState((r0.recipients || []).length ? 'some' : 'all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (!peopleIn) supabase.rpc('finance_reminder_people').then(({ data }) => setPeople(data || [])) }, [peopleIn])
  const finance = f.kind !== 'custom'
  const choices = finance ? people.filter(p => p.is_manager) : people
  const entityTypes = types.filter(t => t.entity_id === f.entity_id && t.active !== false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const toggleP = (id) => setF(x => ({ ...x, recipients: x.recipients.includes(id) ? x.recipients.filter(i => i !== id) : [...x.recipients, id] }))
  const leadLabel = f.kind === 'invoice_date' ? 'Days before the invoice date (0 = on the day)' : f.kind === 'invoice_overdue' ? 'Days after the due date' : f.kind === 'document_expiry' ? 'Days before it expires (0 = on the day)' : 'Days after the pay period ends (1 = the day after)'

  async function save() {
    setErr('')
    if (!f.name.trim()) return setErr('Give the reminder a name.')
    if (f.kind === 'custom') {
      if (f.schedule === 'once' && !f.run_on) return setErr('Choose the date for this reminder.')
      if (f.schedule === 'monthly' && !(Number(f.month_day) >= 1 && Number(f.month_day) <= 31)) return setErr('Choose the day of the month.')
      if (f.schedule === 'every_n_days' && (!(Number(f.every_days) >= 1) || !f.anchor)) return setErr('Choose how many days apart, and the first day.')
    }
    if (who === 'some' && f.recipients.length === 0) return setErr('Choose at least one person, or pick "All Admins and Owners".')
    setBusy(true)
    const custom = f.kind === 'custom'
    const { error } = await supabase.rpc('finance_reminder_save', saveArgs({ ...f, id: reminder ? reminder.id : null, recipients: who === 'all' ? [] : f.recipients, lead_days: finance ? Number(f.lead_days) || 0 : 0,
      client_id: custom || f.kind === 'document_expiry' ? f.client_id : null, schedule: custom ? f.schedule : null, run_on: custom && f.schedule === 'once' ? f.run_on : null, weekday: custom && f.schedule === 'weekly' ? Number(f.weekday) : null,
      month_day: custom && f.schedule === 'monthly' ? Number(f.month_day) : null, every_days: custom && f.schedule === 'every_n_days' ? Number(f.every_days) : null, anchor: custom && f.schedule === 'every_n_days' ? f.anchor : null }))
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(isNew ? `Reminder "${f.name.trim()}" added.` : `Reminder "${f.name.trim()}" saved.`)
  }
  return (
    <Modal title={isNew ? 'Add a reminder' : `Change: ${reminder.name}`} onClose={onClose} width={600}>
      {err && <div className="login-err" role="alert">{err}</div>}
      {isNew && <div className="field"><label htmlFor="rm-kind">What is it for?</label>
        <select id="rm-kind" value={f.kind} onChange={e => set('kind', e.target.value)}>
          <option value="custom">Something of my own</option><option value="invoice_date">Before or on an invoice date</option><option value="invoice_overdue">An invoice that is overdue</option><option value="pay_run">When a pay period ends</option><option value="document_expiry">Before a contract or document expires</option></select></div>}
      <div className="field"><label htmlFor="rm-name">Name</label><input id="rm-name" value={f.name} onChange={e => set('name', e.target.value)} maxLength={80} placeholder="e.g. Check in with GarageCo" /></div>

      {(f.kind === 'invoice_date' || f.kind === 'invoice_overdue') && (<>
        <div className="field"><label htmlFor="rm-entity">Which client</label>
          <select id="rm-entity" value={f.entity_id || ''} onChange={e => setF(x => ({ ...x, entity_id: e.target.value || null, invoice_type_id: null }))}><option value="">Every client</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        {f.entity_id && <div className="field"><label htmlFor="rm-type">Which invoice</label>
          <select id="rm-type" value={f.invoice_type_id || ''} onChange={e => set('invoice_type_id', e.target.value || null)}><option value="">All of its invoices</option>{entityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
      </>)}
      {f.kind === 'document_expiry' && <div className="field"><label htmlFor="rm-docclient">Which client</label>
        <select id="rm-docclient" value={f.client_id || ''} onChange={e => set('client_id', e.target.value || null)}><option value="">Every client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      {finance && <div className="field" style={{ maxWidth: 260 }}><label htmlFor="rm-lead">{leadLabel}</label><input id="rm-lead" inputMode="numeric" value={f.lead_days} onChange={e => set('lead_days', e.target.value)} /></div>}

      {f.kind === 'custom' && (<>
        <div className="field"><label htmlFor="rm-client">About which client (optional)</label>
          <select id="rm-client" value={f.client_id || ''} onChange={e => set('client_id', e.target.value || null)}><option value="">No particular client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="rm-schedule">When</label>
          <select id="rm-schedule" value={f.schedule} onChange={e => set('schedule', e.target.value)}>
            <option value="once">Once, on a date</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="every_n_days">Every few days</option></select></div>
        {f.schedule === 'once' && <div className="field" style={{ maxWidth: 220 }}><label htmlFor="rm-runon">Date</label><input id="rm-runon" type="date" value={f.run_on} onChange={e => set('run_on', e.target.value)} /></div>}
        {f.schedule === 'weekly' && <div className="field" style={{ maxWidth: 220 }}><label htmlFor="rm-weekday">Day of the week</label><select id="rm-weekday" value={f.weekday} onChange={e => set('weekday', e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>}
        {f.schedule === 'monthly' && <div className="field" style={{ maxWidth: 220 }}><label htmlFor="rm-monthday">Day of the month</label><input id="rm-monthday" inputMode="numeric" value={f.month_day} onChange={e => set('month_day', e.target.value)} /><div className="hint">In a shorter month it goes on the last day.</div></div>}
        {f.schedule === 'every_n_days' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label htmlFor="rm-every">Every how many days</label><input id="rm-every" inputMode="numeric" value={f.every_days} onChange={e => set('every_days', e.target.value)} /></div>
          <div className="field"><label htmlFor="rm-anchor">Starting on</label><input id="rm-anchor" type="date" value={f.anchor} onChange={e => set('anchor', e.target.value)} /></div></div>}
      </>)}

      <div style={{ fontWeight: 600, fontSize: 14, margin: '6px 0 4px' }}>Who gets it</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}><input type="radio" name="rm-who" checked={who === 'all'} onChange={() => setWho('all')} /> All Admins and Owners</label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}><input type="radio" name="rm-who" checked={who === 'some'} onChange={() => setWho('some')} /> Only these people</label>
      {who === 'some' && <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto' }} data-people>
        {choices.map(p => <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" aria-label={p.full_name} checked={f.recipients.includes(p.id)} onChange={() => toggleP(p.id)} /> {p.full_name}{p.is_manager && !finance ? <span className="badge" style={{ marginLeft: 4 }}>Admin or Owner</span> : null}</label>)}
      </div>}
      <div className="hint" style={{ marginTop: 4 }}>{finance ? 'Invoice and pay reminders can only go to Admins and Owners.' : 'Your own reminders can go to any team member.'}</div>

      <div className="field" style={{ marginTop: 8 }}><label htmlFor="rm-msg">Message (optional)</label><input id="rm-msg" value={f.message} onChange={e => set('message', e.target.value)} maxLength={500} placeholder={finance ? 'Leave blank to use the standard wording' : 'What should the reminder say?'} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> Switched on</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save the reminder'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}
