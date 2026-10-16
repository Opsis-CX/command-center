import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { todayET, fmtDate, downloadCsv, panel } from './financeBits'

// ============================================================
// HOURS (Admins and Owners)
// Three views of the same hours:
//   Review   - scheduled vs worked by person, the categories to go through (Five9, each project, meetings) with check-offs, and the KPIs
//   By day   - each person's scheduled shift next to what they actually worked, day by day, with the time over or short
//   Entries  - the individual hours, each with two answers you can set by hand: Client invoice (yes / no / not decided) and Internal pay (paid / not paid)
// Counting rule: agents = Five9 Ready time (login minus not-ready); everyone else = task timers. Exact to the second.
// Totals are always added up from seconds, never from the rounded hours.
// Scheduled time comes from the shifts people claimed. Five9 time is counted for the client set in Settings.
// Defaults (a hand choice always wins): Five9 time = covered by the Five9 invoice from Settings (a retainer, so it is NOT billed by the hour); timers on client work = not decided; timers with no client = not invoiced.
// Retainer invoices (GarageCo's call center) bill for coverage, hours open x agents x rate, so Five9 time never sets that bill: it pays the agents.
//   Pay: hourly people are paid for all counted time; salaried people and people with no pay profile are not paid from hours.
// ============================================================

const pad = (n) => String(n).padStart(2, '0')
export const hms = (s) => { const sign = s < 0 ? '-' : ''; const a = Math.abs(s); return `${sign}${Math.floor(a / 3600)}:${pad(Math.floor((a % 3600) / 60))}:${pad(Math.round(a % 60))}` }
export const hrs = (s) => (s / 3600).toFixed(2)
const show = (s) => `${hrs(s)} (${hms(s)})`
const keyOf = (r) => `${r.profile_id}|${r.work_date}|${r.source}|${r.source_ref}`
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA') }
const chip = (on) => ({ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--white, #fff)' : 'var(--ink-soft)' })
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', fontSize: 13.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' }
const right = { textAlign: 'right', whiteSpace: 'nowrap' }
const PAGE = 200
const NO_CLIENT = '__none'
const NOTE_TITLES = {
  agent_no_five9: 'Paid agents with no Five9 time in this period',
  five9_not_agent: 'Five9 time that is not counted (not an agent)',
  running_timer: 'Timers still running',
  ready_negative: 'Days where not-ready time was more than login time',
  agent_timer_ignored: 'Agent timers that are ignored',
  no_pay_profile: 'People with hours but no pay profile',
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
  const [sched, setSched] = useState([])
  const [notes, setNotes] = useState([])
  const [reviews, setReviews] = useState([])
  const [clients, setClients] = useState([])
  const [types, setTypes] = useState([])
  const [entities, setEntities] = useState([])
  const [rates, setRates] = useState([])
  const [settings, setSettings] = useState({})
  const [retainer, setRetainer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [view, setView] = useState('review')
  const [client, setClient] = useState('')
  const [person, setPerson] = useState('')
  const [category, setCategory] = useState('')
  const [invFilter, setInvFilter] = useState('')
  const [payFilter, setPayFilter] = useState('')
  const [picked, setPicked] = useState({})
  const [shownCount, setShownCount] = useState(PAGE)
  const [showNotes, setShowNotes] = useState(false)
  const [modal, setModal] = useState(null)
  const [busyCat, setBusyCat] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const [h, sc, n, rv, cl, ty, en, ra, se] = await Promise.all([
      supabase.rpc('finance_hours', { p_from: from, p_to: to }),
      supabase.rpc('finance_scheduled_hours', { p_from: from, p_to: to }),
      supabase.rpc('finance_hours_notes', { p_from: from, p_to: to }),
      supabase.from('finance_hour_reviews').select('*').eq('from_date', from).eq('to_date', to),
      supabase.from('clients').select('id,name').order('name'),
      supabase.from('finance_invoice_types').select('id,name,entity_id,active,billing_method').order('sort').order('name'),
      supabase.from('finance_billing_entities').select('id,name'),
      supabase.from('finance_rate_lines').select('invoice_type_id,product_name,active'),
      supabase.from('finance_settings').select('key,value'),
    ])
    const bad = h.error || sc.error
    if (bad) { setErr(bad.message); setRows([]); setSched([]); setLoading(false); return }
    setRows(h.data || []); setSched(sc.data || []); setNotes(n.data || []); setReviews(rv.data || [])
    setClients(cl.data || []); setTypes(ty.data || []); setEntities(en.data || []); setRates(ra.data || [])
    const st = Object.fromEntries((se.data || []).map(r => [r.key, r.value])); setSettings(st)
    const f9type = (ty.data || []).find(t => t.id === st.five9_invoice_type_id)
    if (f9type && f9type.billing_method === 'coverage') {
      const cs = await supabase.rpc('finance_coverage_summary', { p_invoice_type: f9type.id, p_from: from, p_to: to })
      setRetainer({ typeId: f9type.id, rows: cs.data || [], error: cs.error?.message || '' })
    } else setRetainer(null)
    setPicked({}); setShownCount(PAGE); setLoading(false)
  }, [from, to])
  useEffect(() => { load() }, [load])

  const clientName = (id) => clients.find(c => c.id === id)?.name || ''
  const typeLabel = (id) => { const t = types.find(x => x.id === id); if (!t) return ''; const e = entities.find(x => x.id === t.entity_id); return e ? `${e.name} › ${t.name}` : t.name }
  const invoiceLine = (r) => (r.invoice_state === 'yes' || r.invoice_state === 'retainer') ? `${typeLabel(r.invoice_type_effective) || 'Invoice'}${r.product_name ? ` · ${r.product_name}` : ''}` : ''
  const inClient = (cid) => client === '' ? true : client === NO_CLIENT ? !cid : cid === client

  // everything below follows the date range, client and person filters
  const rowsCP = useMemo(() => rows.filter(r => (!person || r.profile_id === person) && inClient(r.client_id)), [rows, person, client])   // eslint-disable-line
  const schedCP = useMemo(() => sched.filter(s => (!person || s.profile_id === person) && inClient(s.client_id)), [sched, person, client])   // eslint-disable-line
  const meta = useMemo(() => { const m = new Map(); rows.forEach(r => m.set(r.profile_id, { agent: r.is_agent, title: r.job_title })); return m }, [rows])
  const people = useMemo(() => {
    const m = new Map()
    rows.forEach(r => m.set(r.profile_id, { id: r.profile_id, name: r.full_name }))
    sched.forEach(s => m.set(s.profile_id, { id: s.profile_id, name: s.full_name }))
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, sched])

  // scheduled versus serviced, per person and day
  const calc = useMemo(() => {
    const S = new Map(), A = new Map(), shifts = new Map(), noShow = new Map(), who = new Map()
    schedCP.forEach(s => {
      const k = `${s.profile_id}|${s.work_date}`
      S.set(k, (S.get(k) || 0) + s.scheduled_seconds)
      shifts.set(k, [shifts.get(k), s.shifts].filter(Boolean).join('; '))
      if (s.had_no_show) noShow.set(k, true)
      who.set(k, { id: s.profile_id, name: s.full_name, date: s.work_date })
    })
    rowsCP.forEach(r => {
      const k = `${r.profile_id}|${r.work_date}`
      A.set(k, (A.get(k) || 0) + r.seconds)
      if (!who.has(k)) who.set(k, { id: r.profile_id, name: r.full_name, date: r.work_date })
    })
    const scheduledPeople = new Set(schedCP.map(s => s.profile_id))
    let scheduled = 0, serviced = 0, over = 0, short = 0, noShift = 0
    S.forEach((s, k) => { if (s > 0) { const a = A.get(k) || 0; scheduled += s; over += Math.max(a - s, 0); short += Math.max(s - a, 0) } })
    A.forEach((a, k) => { const pid = k.split('|')[0]; if (scheduledPeople.has(pid)) { serviced += a; if (!S.has(k)) noShift += a } })
    const unscheduled = new Set(rowsCP.filter(r => !scheduledPeople.has(r.profile_id)).map(r => r.profile_id)).size
    const days = [...who.entries()].map(([k, w]) => ({ key: k, ...w, scheduled: S.get(k) || 0, served: A.get(k) || 0, shifts: shifts.get(k) || '', noShow: !!noShow.get(k) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))
    const byPerson = new Map()
    days.forEach(d => {
      const p = byPerson.get(d.id) || { id: d.id, name: d.name, scheduled: 0, served: 0, over: 0, short: 0, noShift: 0, days: 0 }
      p.scheduled += d.scheduled; p.served += d.served; p.days += d.served > 0 ? 1 : 0
      if (d.scheduled > 0) { p.over += Math.max(d.served - d.scheduled, 0); p.short += Math.max(d.scheduled - d.served, 0) } else p.noShift += d.served
      byPerson.set(d.id, p)
    })
    return { scheduled, serviced, over, short, noShift, unscheduled, days, people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)) }
  }, [schedCP, rowsCP])

  // categories to review
  const cats = useMemo(() => {
    const m = new Map()
    rowsCP.forEach(r => {
      const c = m.get(r.category_key) || { key: r.category_key, label: r.category_label, secs: 0, n: 0, undec: 0, people: new Set() }
      c.secs += r.seconds; c.n += 1; c.people.add(r.profile_id); if (r.invoice_state === 'undecided') c.undec += r.seconds; m.set(r.category_key, c)
    })
    const rank = (c) => c.key === 'five9' ? 0 : c.key === 'meetings' ? 2 : c.key === 'none' ? 3 : 1
    return [...m.values()].sort((a, b) => rank(a) - rank(b) || b.secs - a.secs || a.label.localeCompare(b.label))
  }, [rowsCP])
  const reviewFor = (key) => reviews.find(r => r.category_key === key && (client === '' ? !r.client_id : r.client_id === client))
  const reviewedCount = cats.filter(c => reviewFor(c.key)).length
  const canReview = client !== NO_CLIENT

  async function toggleReview(c) {
    setBusyCat(c.key)
    const { error } = await supabase.rpc('finance_set_category_review', { p_from: from, p_to: to, p_category: c.key, p_client: client === '' ? null : client, p_reviewed: !reviewFor(c.key), p_note: null })
    setBusyCat('')
    if (error) return setErr(error.message)
    const { data } = await supabase.from('finance_hour_reviews').select('*').eq('from_date', from).eq('to_date', to)
    setReviews(data || [])
    flash(reviewFor(c.key) ? `${c.label} marked as not reviewed.` : `${c.label} marked as reviewed.`)
  }
  const openCategory = (c) => { setCategory(c.key); setView('entries'); setShownCount(PAGE); setPicked({}) }

  // entries
  const entries = useMemo(() => rowsCP.filter(r => {
    if (category && r.category_key !== category) return false
    if (invFilter && r.invoice_state !== invFilter) return false
    if (payFilter && r.pay_state !== payFilter) return false
    return true
  }), [rowsCP, category, invFilter, payFilter])
  const sum = (list) => list.reduce((s, r) => s + r.seconds, 0)
  const money = useMemo(() => {
    const by = (f) => rowsCP.filter(f).reduce((t, r) => t + r.seconds, 0)
    return { invoiced: by(r => r.invoice_state === 'yes'), retainer: by(r => r.invoice_state === 'retainer'), paid: by(r => r.pay_state === 'yes'), paidNotInvoiced: by(r => r.pay_state === 'yes' && r.invoice_state === 'no'), invoicedNotPaid: by(r => (r.invoice_state === 'yes' || r.invoice_state === 'retainer') && r.pay_state === 'no'), undecided: by(r => r.invoice_state === 'undecided'), ready: by(r => r.source === 'five9') }
  }, [rowsCP])
  const pickedRows = entries.filter(r => picked[keyOf(r)])
  const togglePick = (r) => setPicked(p => { const n = { ...p }; if (n[keyOf(r)]) delete n[keyOf(r)]; else n[keyOf(r)] = true; return n })
  const visible = entries.slice(0, shownCount)
  const allPicked = entries.length > 0 && entries.every(r => picked[keyOf(r)])
  const setRange = (f, t) => { setFrom(f); setTo(t) }
  const catLabel = (k) => cats.find(c => c.key === k)?.label || rows.find(r => r.category_key === k)?.category_label || ''

  async function exportCsv() {
    if (view === 'day') {
      await supabase.rpc('finance_log_event', { p_action: 'export', p_table: 'finance_hours', p_note: `CSV export (by day), ${calc.days.length} rows, ${from} to ${to}` })
      downloadCsv(`hours-by-day-${from}-to-${to}.csv`, ['Date', 'Person', 'Scheduled shift', 'Scheduled seconds', 'Scheduled H:MM:SS', 'Worked seconds', 'Worked H:MM:SS', 'Over or short seconds', 'Over or short H:MM:SS'],
        calc.days.map(d => [d.date, d.name, d.shifts, d.scheduled, hms(d.scheduled), d.served, hms(d.served), d.scheduled > 0 ? d.served - d.scheduled : '', d.scheduled > 0 ? hms(d.served - d.scheduled) : '']))
    } else {
      await supabase.rpc('finance_log_event', { p_action: 'export', p_table: 'finance_hours', p_note: `CSV export, ${entries.length} rows, ${from} to ${to}` })
      downloadCsv(`hours-${from}-to-${to}.csv`, ['Date', 'Person', 'Job title', 'Category', 'Client', 'What', 'Kind', 'Seconds', 'Hours', 'H:MM:SS', 'Client invoice', 'Invoice', 'Product', 'Invoice answer', 'Internal pay', 'Pay answer'],
        entries.map(r => [r.work_date, r.full_name, r.job_title, r.category_label, r.client_name, r.what, r.entry_kind, r.seconds, (r.seconds / 3600).toFixed(4), hms(r.seconds),
          r.invoice_state === 'yes' ? 'Yes, by the hour' : r.invoice_state === 'retainer' ? 'Retainer' : r.invoice_state === 'no' ? 'No' : 'Not decided', (r.invoice_state === 'yes' || r.invoice_state === 'retainer') ? typeLabel(r.invoice_type_effective) : '', (r.invoice_state === 'yes' || r.invoice_state === 'retainer') ? (r.product_name || '') : '', r.invoice_source === 'tagged' ? 'Set by hand' : 'Default',
          r.pay_state === 'yes' ? 'Paid' : 'Not paid', r.pay_source === 'tagged' ? 'Set by hand' : 'Default']))
    }
    flash('Exported. The export is recorded in the audit log.')
  }

  const hasAny = rows.length > 0 || sched.length > 0
  const retainerCents = retainer ? retainer.rows.reduce((t, x) => t + Math.round(Number(x.amount) * 100), 0) : 0
  const retainerAgentHours = retainer ? retainer.rows.reduce((t, x) => t + Number(x.agent_hours), 0) : 0
  const retainerNoTerms = retainer ? retainer.rows.find(x => !x.term_id) : null
  const showRetainer = !!retainer && !person && (client === '' || client === settings.five9_client_id)
  const retainerName = retainer ? typeLabel(retainer.typeId) : ''
  const withShifts = calc.people.filter(p => p.scheduled > 0)
  const noShifts = calc.people.filter(p => p.scheduled === 0 && p.served > 0)
  const pct = calc.scheduled > 0 ? Math.round((calc.serviced / calc.scheduled) * 1000) / 10 : null
  const kpis = [
    ['Hours scheduled', calc.scheduled, null], ['Hours worked', calc.serviced, null],
    ['Worked vs scheduled', null, pct == null ? '–' : `${pct}%`],
    ['Over scheduled time', calc.over, null], ['Short of scheduled time', calc.short, null], ['Worked with no shift', calc.noShift, null],
  ]

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }} role="note">
        <b>How hours are counted.</b> Agents: Five9 Ready time (login minus not-ready), counted for the client set in Settings. Everyone else: task timers. Exact to the second. Only Admins and Owners can see this page.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-from">From</label><input id="hr-from" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-to">To</label><input id="hr-to" type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></div>
        <button style={chip(false)} onClick={() => setRange(addDays(today, -14), today)}>Last 14 days</button>
        <button style={chip(false)} onClick={() => setRange(today.slice(0, 8) + '01', today)}>This month</button>
        <button style={chip(false)} onClick={() => { const f = new Date(today.slice(0, 8) + '01T00:00:00'); f.setMonth(f.getMonth() - 1); setRange(f.toLocaleDateString('en-CA'), addDays(today.slice(0, 8) + '01', -1)) }}>Last month</button>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-client">Client</label>
          <select id="hr-client" value={client} onChange={e => setClient(e.target.value)}><option value="">All clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={NO_CLIENT}>No client</option></select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="hr-person">Person</label>
          <select id="hr-person" value={person} onChange={e => setPerson(e.target.value)}><option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={view === 'review' || (view === 'day' ? !calc.days.length : !entries.length)}>Export CSV</button>
      </div>

      {err && <div className="login-err" role="alert">{err}</div>}
      {loading ? <p className="page-sub">Loading…</p> : !hasAny ? <p className="page-sub">No hours in this range.</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 6 }}>
            {kpis.map(([label, s, text]) => (
              <div key={label} style={{ ...panel, padding: '10px 14px' }} data-kpi={label}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{text != null ? text : `${hrs(s)} h`}</div>
                {text == null && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{hms(s)}</div>}
              </div>))}
          </div>
          <p className="page-sub" style={{ margin: '0 0 14px', fontSize: 12.5 }}>
            Scheduled vs worked covers the {calc.people.filter(p => p.scheduled > 0).length} people with a scheduled shift in this range{calc.unscheduled > 0 ? `. ${calc.unscheduled} ${calc.unscheduled === 1 ? 'person has' : 'people have'} no scheduled shifts and ${calc.unscheduled === 1 ? 'is' : 'are'} left out of these figures` : ''}.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 6 }}>
            {[['Hours invoiced by the hour', money.invoiced], ['Covered by a retainer', money.retainer], ['Hours paid', money.paid], ['Paid, not invoiced', money.paidNotInvoiced], ['Invoiced, not paid', money.invoicedNotPaid], ['Invoice not decided', money.undecided]].map(([label, s2]) => (
              <div key={label} style={{ ...panel, padding: '10px 14px' }} data-kpi={label}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{hrs(s2)} h</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{hms(s2)}</div>
              </div>))}
          </div>
          <p className="page-sub" style={{ margin: '0 0 14px', fontSize: 12.5 }}>
            Invoicing and pay follow the defaults unless you set them by hand: Five9 time is covered by the Five9 invoice from Settings, timers on client work stay "not decided" until you choose, and hourly people are paid for all counted time.
          </p>
          {showRetainer && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, margin: '4px 0 6px' }} data-retainer-heading>Retainer: {retainerName}. The client is billed for coverage, not for hours worked.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 6 }}>
                <div style={{ ...panel, padding: '10px 14px' }} data-kpi="Retainer billed (agent-hours)"><div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>Retainer billed (agent-hours)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{retainerAgentHours.toFixed(2)} h</div><div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>hours open × agents billed</div></div>
                <div style={{ ...panel, padding: '10px 14px' }} data-kpi="Retainer billed ($)"><div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>Retainer billed ($)</div><div style={{ fontSize: 20, fontWeight: 700 }}>${(retainerCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>for this date range</div></div>
                <div style={{ ...panel, padding: '10px 14px' }} data-kpi="Five9 Ready time worked"><div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>Five9 Ready time worked</div><div style={{ fontSize: 20, fontWeight: 700 }}>{hrs(money.ready)} h</div><div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{hms(money.ready)} · pays the agents</div></div>
                <div style={{ ...panel, padding: '10px 14px' }} data-kpi="Worked vs billed coverage"><div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>Worked vs billed coverage</div><div style={{ fontSize: 20, fontWeight: 700 }}>{retainerAgentHours > 0 ? `${Math.round((money.ready / 3600 / retainerAgentHours) * 1000) / 10}%` : '–'}</div><div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Ready hours ÷ agent-hours billed</div></div>
              </div>
              {retainerNoTerms && <p className="login-err" role="note" style={{ margin: '0 0 6px' }}>{retainerNoTerms.days} day{retainerNoTerms.days === 1 ? ' has' : 's have'} no retainer terms yet, so nothing is billed for {retainerNoTerms.days === 1 ? 'it' : 'them'}. Set the terms on Clients and billing, under the invoice.</p>}
              {retainer.error && <p className="login-err" role="alert">{retainer.error}</p>}
              <div style={{ marginBottom: 8 }} />
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }} role="tablist">
            {[['review', 'Review'], ['day', 'By day'], ['entries', 'Entries']].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} style={chip(view === k)} onClick={() => setView(k)}>{l}</button>)}
          </div>

          {view === 'review' && (
            <>
              <div style={{ ...panel, padding: 0, overflowX: 'auto', marginBottom: 14 }}>
                <div style={{ padding: '14px 16px 4px' }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Scheduled vs worked, by person</h3>
                  <p className="page-sub" style={{ margin: '4px 0 0' }}>Over and short are measured day by day against each shift. Click a person to see only them.</p>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                  <thead><tr>
                    <th style={th}>Person</th><th style={th}>Counted from</th><th style={{ ...th, textAlign: 'right' }}>Scheduled</th><th style={{ ...th, textAlign: 'right' }}>Worked</th>
                    <th style={{ ...th, textAlign: 'right' }}>Worked vs scheduled</th><th style={{ ...th, textAlign: 'right' }}>Over</th><th style={{ ...th, textAlign: 'right' }}>Short</th><th style={{ ...th, textAlign: 'right' }}>Worked with no shift</th>
                  </tr></thead>
                  <tbody>
                    {withShifts.map(p => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} aria-label={`Summary for ${p.name}`} onClick={() => setPerson(person === p.id ? '' : p.id)}>
                        <td style={td}><div style={{ fontWeight: 600 }}>{p.name}</div>{meta.get(p.id)?.title && <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{meta.get(p.id).title}</div>}</td>
                        <td style={td}>{meta.has(p.id) ? (meta.get(p.id).agent ? 'Five9 Ready time' : 'Task timers') : ''}</td>
                        <td style={{ ...td, ...right }}>{show(p.scheduled)}</td>
                        <td style={{ ...td, ...right, fontWeight: 600 }}>{show(p.served)}</td>
                        <td style={{ ...td, ...right }}>{Math.round((p.served / p.scheduled) * 1000) / 10}%</td>
                        <td style={{ ...td, ...right }}>{p.over ? hms(p.over) : ''}</td>
                        <td style={{ ...td, ...right }}>{p.short ? hms(p.short) : ''}</td>
                        <td style={{ ...td, ...right }}>{p.noShift ? hms(p.noShift) : ''}</td>
                      </tr>))}
                    {withShifts.length > 0 && (
                      <tr aria-label="Total for people with a scheduled shift" style={{ background: 'var(--surface-2, transparent)' }}>
                        <td style={{ ...td, fontWeight: 700 }} colSpan={2}>Total, people with a scheduled shift</td>
                        <td style={{ ...td, ...right, fontWeight: 700 }}>{show(calc.scheduled)}</td>
                        <td style={{ ...td, ...right, fontWeight: 700 }}>{show(calc.serviced)}</td>
                        <td style={{ ...td, ...right, fontWeight: 700 }}>{pct == null ? '' : `${pct}%`}</td>
                        <td style={{ ...td, ...right, fontWeight: 700 }}>{hms(calc.over)}</td>
                        <td style={{ ...td, ...right, fontWeight: 700 }}>{hms(calc.short)}</td>
                        <td style={{ ...td, ...right, fontWeight: 700 }}>{hms(calc.noShift)}</td>
                      </tr>)}
                    {withShifts.length === 0 && <tr><td style={td} colSpan={8}>Nobody has a scheduled shift for these filters.</td></tr>}
                    {noShifts.length > 0 && <tr><td style={{ ...td, color: 'var(--ink-soft)', fontWeight: 700, fontSize: 12 }} colSpan={8}>No shift scheduled in this range</td></tr>}
                    {noShifts.map(p => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} aria-label={`Summary for ${p.name}`} onClick={() => setPerson(person === p.id ? '' : p.id)}>
                        <td style={td}><div style={{ fontWeight: 600 }}>{p.name}</div>{meta.get(p.id)?.title && <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{meta.get(p.id).title}</div>}</td>
                        <td style={td}>{meta.has(p.id) ? (meta.get(p.id).agent ? 'Five9 Ready time' : 'Task timers') : ''}</td>
                        <td style={{ ...td, ...right, color: 'var(--ink-soft)' }}>No shifts</td>
                        <td style={{ ...td, ...right, fontWeight: 600 }}>{show(p.served)}</td>
                        <td style={td} colSpan={4}></td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              <div style={{ ...panel, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Categories to review</h3>
                  <span style={{ fontWeight: 600 }} data-progress>{reviewedCount} of {cats.length} reviewed</span>
                </div>
                <p className="page-sub" style={{ margin: '4px 0 10px' }}>
                  Go through each category, then tick it off. Click a category's name to see its entries. {!canReview && 'Choose All clients or one client to tick categories off.'}
                </p>
                {cats.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No hours to review for these filters.</p> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                      <thead><tr><th style={th}>Reviewed</th><th style={th}>Category</th><th style={{ ...th, textAlign: 'right' }}>People</th><th style={{ ...th, textAlign: 'right' }}>Entries</th><th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={{ ...th, textAlign: 'right' }}>Invoice not decided</th><th style={th}>Status</th></tr></thead>
                      <tbody>
                        {cats.map(c => {
                          const rv = reviewFor(c.key)
                          const changed = rv && (rv.seconds_at_review !== c.secs || rv.entries_at_review !== c.n)
                          return (
                            <tr key={c.key}>
                              <td style={td}><input type="checkbox" aria-label={`Reviewed: ${c.label}`} checked={!!rv} disabled={!canReview || busyCat === c.key} onChange={() => toggleReview(c)} /></td>
                              <td style={td}><button className="btn btn-ghost" style={{ fontSize: 13.5, padding: '2px 8px', fontWeight: 600 }} onClick={() => openCategory(c)}>{c.label}</button></td>
                              <td style={{ ...td, ...right }}>{c.people.size}</td>
                              <td style={{ ...td, ...right }}>{c.n}</td>
                              <td style={{ ...td, ...right, fontWeight: 600 }}>{show(c.secs)}</td>
                              <td style={{ ...td, ...right }}>{c.undec ? show(c.undec) : ''}</td>
                              <td style={td}>
                                {!rv ? <span style={{ color: 'var(--ink-soft)' }}>Not reviewed</span>
                                  : <><span className="badge passed">Reviewed</span> <span style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{fmtDate(rv.reviewed_at.slice(0, 10))}</span>
                                    {changed && <div><span className="badge failed">Changed since reviewed</span> <span style={{ fontSize: 12.5 }}>was {show(rv.seconds_at_review)}, now {show(c.secs)}. Tick it again after checking.</span></div>}</>}
                              </td>
                            </tr>)
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {notes.length > 0 && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}>{showNotes ? 'Hide' : 'Show'} data checks ({notes.length})</button>
                  <span className="page-sub" style={{ marginLeft: 10 }}>Things worth a look. They do not change the hours.</span>
                  {showNotes && Object.keys(NOTE_TITLES).filter(k => notes.some(n => n.kind === k)).map(k => (
                    <div key={k} style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 600 }}>{NOTE_TITLES[k]}</div>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>{notes.filter(n => n.kind === k).map((n, i) => <li key={i}><b>{n.full_name}:</b> {n.detail}</li>)}</ul>
                    </div>))}
                </div>
              )}
            </>
          )}

          {view === 'day' && (
            <>
              <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead><tr><th style={th}>Date</th><th style={th}>Person</th><th style={th}>Scheduled shift</th><th style={{ ...th, textAlign: 'right' }}>Scheduled</th><th style={{ ...th, textAlign: 'right' }}>Worked</th><th style={th}>Over or short</th></tr></thead>
                  <tbody>
                    {calc.days.slice(0, shownCount).map(d => {
                      const diff = d.served - d.scheduled
                      return (
                        <tr key={d.key}>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</td>
                          <td style={td}>{d.name}</td>
                          <td style={td}>{d.shifts || <span style={{ color: 'var(--ink-soft)' }}>No shift</span>}{d.noShow && <div><span className="badge failed">No-show</span></div>}</td>
                          <td style={{ ...td, ...right }}>{d.scheduled ? show(d.scheduled) : ''}</td>
                          <td style={{ ...td, ...right }}>{d.served ? show(d.served) : <span style={{ color: 'var(--ink-soft)' }}>0</span>}</td>
                          <td style={td}>{d.scheduled === 0 ? <span style={{ color: 'var(--ink-soft)' }}>Worked with no shift</span>
                            : diff > 0 ? <span style={{ fontWeight: 600 }}>{hms(diff)} over</span> : diff < 0 ? <span>{hms(-diff)} short</span> : <span>On time</span>}</td>
                        </tr>)
                    })}
                    {calc.days.length === 0 && <tr><td style={td} colSpan={6}>Nothing matches these filters.</td></tr>}
                  </tbody>
                </table>
              </div>
              {calc.days.length > shownCount && <div style={{ marginTop: 10 }}><button className="btn btn-ghost" onClick={() => setShownCount(c => c + PAGE)}>Show more ({calc.days.length - shownCount} not shown)</button></div>}
            </>
          )}

          {view === 'entries' && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                <div className="field" style={{ margin: 0 }}><label htmlFor="hr-cat">Category</label>
                  <select id="hr-cat" value={category} onChange={e => { setCategory(e.target.value); setShownCount(PAGE) }}><option value="">All categories</option>{cats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
                <div className="field" style={{ margin: 0 }}><label htmlFor="hr-inv">Client invoice</label>
                  <select id="hr-inv" value={invFilter} onChange={e => setInvFilter(e.target.value)}><option value="">All</option><option value="yes">Yes, by the hour</option><option value="retainer">Covered by a retainer</option><option value="no">No</option><option value="undecided">Not decided</option></select></div>
                <div className="field" style={{ margin: 0 }}><label htmlFor="hr-pay">Internal pay</label>
                  <select id="hr-pay" value={payFilter} onChange={e => setPayFilter(e.target.value)}><option value="">All</option><option value="yes">Paid</option><option value="no">Not paid</option></select></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
                {[['Shown', sum(entries)], ['Invoiced by the hour', sum(entries.filter(r => r.invoice_state === 'yes'))], ['Covered by a retainer', sum(entries.filter(r => r.invoice_state === 'retainer'))], ['Not invoiced', sum(entries.filter(r => r.invoice_state === 'no'))], ['Invoice not decided', sum(entries.filter(r => r.invoice_state === 'undecided'))], ['Paid', sum(entries.filter(r => r.pay_state === 'yes'))], ['Not paid', sum(entries.filter(r => r.pay_state === 'no'))]].map(([label, s]) => (
                  <div key={label} style={{ ...panel, padding: '10px 14px' }} data-card={label}>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{hrs(s)} h</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{hms(s)}</div>
                  </div>))}
              </div>

              {pickedRows.length > 0 && (
                <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} role="toolbar" aria-label="Set invoice and pay for the selected hours">
                  <b>{pickedRows.length} row{pickedRows.length === 1 ? '' : 's'} selected ({hrs(sum(pickedRows))} hours)</b>
                  <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setModal({ preset: 'edit' })}>Set invoice and pay</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setModal({ preset: 'clear' })}>Clear my choices</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setPicked({})}>Unselect all</button>
                </div>
              )}

              <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1020 }}>
                  <thead><tr>
                    <th style={th}><input type="checkbox" aria-label="Select every row shown" checked={allPicked} onChange={() => setPicked(allPicked ? {} : Object.fromEntries(entries.map(r => [keyOf(r), true])))} /></th>
                    <th style={th}>Date</th><th style={th}>Person</th><th style={th}>What</th><th style={th}>Category</th><th style={th}>Client</th><th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={th}>Client invoice</th><th style={th}>Internal pay</th>
                  </tr></thead>
                  <tbody>
                    {visible.length === 0 && <tr><td style={td} colSpan={9}>Nothing matches these filters.</td></tr>}
                    {visible.map(r => {
                      return (
                        <tr key={keyOf(r)}>
                          <td style={td}><input type="checkbox" aria-label={`Select ${r.full_name} ${r.work_date} ${r.what}`} checked={!!picked[keyOf(r)]} onChange={() => togglePick(r)} /></td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.work_date)}{!r.day_complete && <div><span className="badge needed">today, still changing</span></div>}</td>
                          <td style={td}>{r.full_name}</td>
                          <td style={td}><div>{r.what}</div><div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{r.entry_kind === 'typed by hand' ? 'Typed in by hand' : r.entry_kind === 'five9' ? '' : r.entry_kind}{r.flag ? ` · ${r.flag}` : ''}</div></td>
                          <td style={td}>{r.category_label}</td>
                          <td style={td}>{r.client_name || <span style={{ color: 'var(--ink-soft)' }}>None</span>}</td>
                          <td style={{ ...td, ...right }}>{show(r.seconds)}</td>
                          <td style={td} data-col="invoice">
                            {r.invoice_state === 'undecided' ? <span className="badge needed">Not decided</span> : <b>{r.invoice_state === 'yes' ? 'Yes' : r.invoice_state === 'retainer' ? 'Retainer' : 'No'}</b>}
                            {(r.invoice_state === 'yes' || r.invoice_state === 'retainer') && <div style={{ fontSize: 12.5 }}>{invoiceLine(r)}</div>}
                            {r.invoice_state !== 'undecided' && <div style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{r.invoice_source === 'default' ? 'default' : 'your choice'}</div>}
                          </td>
                          <td style={td} data-col="pay"><b>{r.pay_state === 'yes' ? 'Paid' : 'Not paid'}</b><div style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{r.pay_source === 'default' ? 'default' : 'your choice'}</div></td>
                        </tr>)
                    })}
                  </tbody>
                </table>
              </div>
              {entries.length > shownCount && <div style={{ marginTop: 10 }}><button className="btn btn-ghost" onClick={() => setShownCount(c => c + PAGE)}>Show {Math.min(PAGE, entries.length - shownCount)} more ({entries.length - shownCount} not shown)</button></div>}
            </>
          )}
        </>
      )}
      {modal && <DecisionModal modal={modal} rows={pickedRows} types={types} rates={rates} typeLabel={typeLabel} onClose={() => setModal(null)} onDone={(m) => { setModal(null); flash(m); load() }} />}
    </div>
  )
}

function DecisionModal({ modal, rows, types, rates, typeLabel, onClose, onDone }) {
  const clear = modal.preset === 'clear'
  const [inv, setInv] = useState(clear ? 'clear' : 'keep')
  const [pay, setPay] = useState(clear ? 'clear' : 'keep')
  const [invoice, setInvoice] = useState('')
  const [product, setProduct] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const active = types.filter(t => t.active)
  const products = [...new Set(rates.filter(r => r.invoice_type_id === invoice && r.active !== false).map(r => r.product_name))].sort()
  const word = { yes: 'yes', no: 'no', clear: 'back to the default' }

  async function save() {
    setErr('')
    if (inv === 'keep' && pay === 'keep') return setErr('Choose something to change.')
    if (inv === 'yes' && !invoice) return setErr('Choose which invoice this time belongs to.')
    if (rows.length > 3000) return setErr('Choose 3000 rows or fewer at a time.')
    setBusy(true)
    const payload = rows.map(r => ({ profile_id: r.profile_id, work_date: r.work_date, source: r.source, source_ref: r.source_ref }))
    const { data, error } = await supabase.rpc('finance_set_hour_decisions', {
      p_rows: payload, p_invoice: inv, p_invoice_type: inv === 'yes' ? invoice : null, p_product: inv === 'yes' ? (product || null) : null, p_pay: pay, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    const n = data ?? rows.length
    const parts = []
    if (inv !== 'keep') parts.push(`client invoice ${word[inv]}`)
    if (pay !== 'keep') parts.push(`internal pay ${pay === 'yes' ? 'paid' : pay === 'no' ? 'not paid' : word[pay]}`)
    onDone(`Saved for ${n} row${n === 1 ? '' : 's'}: ${parts.join(', ')}.`)
  }
  const radios = (name, value, setValue, options) => options.map(([v, l]) => (
    <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 14 }}>
      <input type="radio" name={name} value={v} checked={value === v} onChange={() => setValue(v)} /> {l}
    </label>))
  return (
    <Modal title={`${clear ? 'Clear my choices' : 'Set invoice and pay'}: ${rows.length} row${rows.length === 1 ? '' : 's'}`} onClose={onClose} width={560}>
      {err && <div className="login-err" role="alert">{err}</div>}
      <p className="page-sub" style={{ marginTop: 0 }}>{(rows.reduce((s, r) => s + r.seconds, 0) / 3600).toFixed(2)} hours in total. Each question is separate, so you can answer one and leave the other.</p>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
        <legend style={{ fontWeight: 700, fontSize: 14, padding: 0 }}>Client invoice</legend>
        <div className="hint" style={{ marginBottom: 4 }}>Is this time invoiced to a client? Five9 time is invoiced by default; timers on client work stay "not decided" until you choose.</div>
        {radios('dec-inv', inv, setInv, [['keep', 'Leave as it is'], ['yes', 'Yes, invoice it to a client'], ['no', 'No, do not invoice it'], ['clear', 'Go back to the default']])}
        {inv === 'yes' && (
          <div style={{ marginLeft: 24, marginTop: 6 }}>
            <div className="field"><label htmlFor="dc-inv">Which invoice? *</label>
              <select id="dc-inv" value={invoice} onChange={e => { setInvoice(e.target.value); setProduct('') }}><option value="">Choose…</option>{active.map(t => <option key={t.id} value={t.id}>{typeLabel(t.id)}</option>)}</select></div>
            {types.find(t => t.id === invoice)?.billing_method === 'coverage' && <div className="hint" role="note" style={{ marginBottom: 8 }}>This invoice is a retainer, so these hours will show as covered by it. They are not billed by the hour.</div>}
            <div className="field"><label htmlFor="dc-prod">Which product or service?</label>
              <select id="dc-prod" value={product} onChange={e => setProduct(e.target.value)} disabled={!invoice}><option value="">No particular product</option>{products.map(p => <option key={p} value={p}>{p}</option>)}</select>
              <div className="hint">The products come from that invoice's rate card.</div></div>
          </div>
        )}
      </fieldset>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
        <legend style={{ fontWeight: 700, fontSize: 14, padding: 0 }}>Internal pay</legend>
        <div className="hint" style={{ marginBottom: 4 }}>Is the person paid for this time? Hourly people are paid by default; salaried people are not paid from hours.</div>
        {radios('dec-pay', pay, setPay, [['keep', 'Leave as it is'], ['yes', 'Paid for this time'], ['no', 'Not paid for this time'], ['clear', 'Go back to the default']])}
      </fieldset>

      {!(inv === 'keep' && pay === 'keep') && <div className="field"><label htmlFor="dc-note">Note (optional)</label><input id="dc-note" value={note} onChange={e => setNote(e.target.value)} /></div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  )
}
