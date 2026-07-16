import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { notifyTicketCreated, notifyTicketReply, notifyTicketStatus } from '../lib/notify'

// ============================================================
// HELP CENTER — private support tickets (Zendesk-style).
// Agents open a ticket instead of asking in a public channel; all
// communication lives in the ticket thread. ASC + admins work the queue,
// can leave staff-only internal notes, and track SLAs:
//   • First response: within 1 BUSINESS hour (window configurable below)
//   • Resolution:     within 24 clock hours
// ============================================================

const CATEGORIES = [
  ['payments', 'Payments', '💵'],
  ['schedule', 'Schedule', '📅'],
  ['technical', 'Technical', '🖥'],
  ['training', 'Training', '🎓'],
  ['other', 'Other', '📌'],
]
const catLabel = (c) => CATEGORIES.find(x => x[0] === c)?.[1] || c
const catIcon = (c) => CATEGORIES.find(x => x[0] === c)?.[2] || '📌'

const STATUSES = [
  ['open', 'Open', 'var(--failed)', 'var(--failed-bg)'],
  ['pending', 'Pending agent', 'var(--needed)', 'var(--needed-bg)'],
  ['resolved', 'Resolved', 'var(--passed)', 'var(--passed-bg)'],
  ['closed', 'Closed', 'var(--ink-soft)', 'var(--canvas)'],
]
const statusMeta = (s) => STATUSES.find(x => x[0] === s) || STATUSES[0]

// ---- SLA ----
// Business hours for the first-response clock. Adjust here as policy changes.
const BUSINESS = { tz: 'America/New_York', startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] } // Mon–Fri 9a–6p ET
const FIRST_RESPONSE_TARGET_BUS_MIN = 60        // 1 business hour
const RESOLUTION_TARGET_HOURS = 24              // 24 clock hours

function inTZ(d) { return new Date(new Date(d).toLocaleString('en-US', { timeZone: BUSINESS.tz })) }

// Business minutes elapsed between two instants (approximate walk in 5-min steps —
// plenty accurate for a 1-hour SLA and far easier to verify than closed-form math).
function businessMinutesBetween(a, b) {
  if (!a || !b) return null
  let t = inTZ(a).getTime()
  const end = inTZ(b).getTime()
  if (end <= t) return 0
  let mins = 0
  const STEP = 5 * 60000
  // Cap the walk at 60 days so a pathological range can't hang the UI.
  for (let guard = 0; t < end && guard < 60 * 24 * 12 * 60; guard++) {
    const d = new Date(t)
    if (BUSINESS.days.includes(d.getDay()) && d.getHours() >= BUSINESS.startHour && d.getHours() < BUSINESS.endHour) {
      mins += Math.min(5, Math.ceil((end - t) / 60000))
    }
    t += STEP
  }
  return mins
}

const hoursBetween = (a, b) => (!a || !b) ? null : (new Date(b) - new Date(a)) / 3600000

function fmtDur(mins) {
  if (mins == null) return '—'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = mins / 60
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}
const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
function timeAgo(iso) {
  const m = (Date.now() - new Date(iso)) / 60000
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.round(m)}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

function StatusBadge({ status }) {
  const [, label, color, bg] = statusMeta(status)
  return <span className="badge" style={{ background: bg, color, fontSize: 10.5, fontWeight: 700 }}>{label}</span>
}

function SlaBadges({ t }) {
  // First response: business minutes from creation to first staff reply (or to now if none yet).
  const frMins = businessMinutesBetween(t.created_at, t.first_response_at || new Date().toISOString())
  const frDone = !!t.first_response_at
  const frBreach = frMins != null && frMins > FIRST_RESPONSE_TARGET_BUS_MIN
  // Resolution: clock hours from creation to resolved (or to now while open).
  const done = t.resolved_at || t.closed_at
  const resHrs = hoursBetween(t.created_at, done || new Date().toISOString())
  const resBreach = resHrs != null && resHrs > RESOLUTION_TARGET_HOURS

  const pill = (ok, text, title) => (
    <span title={title} style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: ok ? 'var(--passed-bg)' : 'var(--failed-bg)', color: ok ? 'var(--passed)' : 'var(--failed)' }}>{text}</span>
  )
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      {pill(!frBreach, frDone ? `FR ${fmtDur(frMins)}` : `FR due ${fmtDur(Math.max(FIRST_RESPONSE_TARGET_BUS_MIN - (frMins || 0), 0))}`,
        'First response — target 1 business hour')}
      {(done || resBreach) && pill(!resBreach, done ? `Res ${fmtDur(resHrs * 60)}` : 'Res overdue', 'Resolution — target 24 hours')}
    </span>
  )
}

// ============================================================
export default function HelpCenter() {
  const { user, appRole, isAdmin } = useAuth()
  const isStaff = isAdmin || ['asc', 'admin'].includes(String(appRole || '').toLowerCase())
  const [tab, setTab] = useState('tickets')

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title">Help Center</h1>
        <p className="page-sub">{isStaff
          ? 'Work the ticket queue. Targets: first response within 1 business hour, resolution within 24.'
          : 'Questions about payments, your schedule, tech, or anything else? Open a ticket and we\u2019ll take it from there — no need to ask in a public channel.'}</p>
      </div>

      {isStaff && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          <button className={'btn ' + (tab === 'tickets' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('tickets')}>Queue</button>
          <button className={'btn ' + (tab === 'reporting' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('reporting')}>Reporting</button>
        </div>
      )}

      {tab === 'reporting' && isStaff
        ? <TicketReporting />
        : <TicketList me={user} isStaff={isStaff} />}
    </div>
  )
}

// ============================================================
function TicketList({ me, isStaff }) {
  const [tickets, setTickets] = useState([])
  const [profiles, setProfiles] = useState([])
  const [openId, setOpenId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active') // active | all | open | pending | resolved | closed
  const [catFilter, setCatFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [tRes, pRes] = await Promise.all([
        supabase.from('help_tickets').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, full_name, role, is_active'),
      ])
      if (tRes.error) throw tRes.error
      setTickets(tRes.data || [])
      setProfiles(pRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Live: new tickets / status changes / replies bump the list.
  useEffect(() => {
    const ch = supabase.channel('help-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'help_tickets' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const nameOf = (id) => profiles.find(p => p.id === id)?.full_name || 'Someone'

  const visible = tickets.filter(t => {
    if (catFilter && t.category !== catFilter) return false
    if (statusFilter === 'active') return t.status === 'open' || t.status === 'pending'
    if (statusFilter === 'all') return true
    return t.status === statusFilter
  })

  if (loading) return <p className="page-sub">Loading tickets…</p>
  if (err) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load.</b> <span className="page-sub">{err}</span></div>

  const open = tickets.find(t => t.id === openId)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New ticket</button>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)' }}>
          <option value="active">Active (open + pending)</option>
          <option value="all">All</option>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)' }}>
          <option value="">All categories</option>
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="page-sub" style={{ fontSize: 12, marginLeft: 'auto' }}>{visible.length} ticket{visible.length !== 1 ? 's' : ''}</span>
      </div>

      {visible.length === 0 ? (
        <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 26 }}>
          {isStaff ? 'No tickets match these filters.' : 'No tickets yet. If you have a question, open one — we\u2019re on it within the hour during business hours.'}
        </div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {visible.map(t => (
            <div key={t.id} onClick={() => setOpenId(t.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{catIcon(t.category)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13.5 }}>#{t.ticket_number} · {t.subject}</b>
                  <StatusBadge status={t.status} />
                  <SlaBadges t={t} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                  {catLabel(t.category)}{isStaff ? ` · ${nameOf(t.requester_id)}` : ''}
                  {t.assignee_id ? ` · assigned to ${nameOf(t.assignee_id)}` : isStaff ? ' · unassigned' : ''}
                  {' · updated ' + timeAgo(t.updated_at)}
                </div>
              </div>
              <span style={{ color: 'var(--ink-soft)', flexShrink: 0 }}>›</span>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewTicketModal me={me} profiles={profiles} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); load(); setOpenId(id) }} />}
      {open && <TicketDetail ticket={open} me={me} isStaff={isStaff} profiles={profiles} nameOf={nameOf}
        onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}

// ============================================================
function NewTicketModal({ me, profiles, onClose, onCreated }) {
  const [category, setCategory] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function create() {
    setErr('')
    if (!category) { setErr('Pick a category.'); return }
    if (!subject.trim()) { setErr('Add a short subject.'); return }
    if (!body.trim()) { setErr('Describe your question or issue.'); return }
    setSaving(true)
    try {
      const { data: t, error } = await supabase.from('help_tickets')
        .insert({ requester_id: me.id, category, subject: subject.trim() }).select().single()
      if (error) throw error
      const { error: mErr } = await supabase.from('help_ticket_messages')
        .insert({ ticket_id: t.id, sender_id: me.id, body: body.trim() })
      if (mErr) throw mErr

      // Notify the ASC team (admins can see the queue anyway).
      try {
        const meName = profiles.find(p => p.id === me.id)?.full_name
        const ascIds = profiles.filter(p => p.is_active !== false && String(p.role || '').toLowerCase() === 'asc').map(p => p.id)
        await notifyTicketCreated({ recipientIds: ascIds, actorId: me.id, actorName: meName, ticketNumber: t.ticket_number, category: catLabel(category), subject: t.subject })
      } catch (e) { console.error('Ticket created, notification failed', e) }

      onCreated?.(t.id)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto', padding: 20 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>New ticket</h3>
        <p className="page-sub" style={{ fontSize: 12.5, margin: '0 0 14px' }}>This goes privately to the support team — target first response is 1 business hour.</p>

        <div className="field"><label>What's this about?</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(([v, l, ic]) => (
              <button key={v} type="button" onClick={() => setCategory(v)}
                style={{ border: '1px solid ' + (category === v ? 'var(--accent)' : 'var(--line)'), background: category === v ? 'var(--accent-bg)' : 'var(--surface)', color: category === v ? 'var(--accent)' : 'var(--ink)', borderRadius: 8, padding: '7px 11px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {ic} {l}
              </button>
            ))}
          </div>
        </div>
        <div className="field"><label>Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Missing hours on my last payment" autoFocus /></div>
        <div className="field"><label>Details</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Tell us what's going on — dates, amounts, screenshots info, anything that helps."
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} /></div>

        {err && <div style={{ color: 'var(--failed)', fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
function TicketDetail({ ticket, me, isStaff, profiles, nameOf, onClose, onChanged }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [internal, setInternal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)

  const meName = profiles.find(p => p.id === me.id)?.full_name

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('help_ticket_messages')
      .select('*').eq('ticket_id', ticket.id).order('created_at')
    if (error) setErr(error.message)
    setMessages(data || [])
    setLoading(false)
  }, [ticket.id])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const ch = supabase.channel(`ticket:${ticket.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'help_ticket_messages' }, (payload) => {
        if (payload.new.ticket_id !== ticket.id) return
        if (!isStaff && payload.new.is_internal) return
        setMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [ticket.id, isStaff])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length])

  async function send() {
    const body = text.trim(); if (!body) return
    setSending(true); setErr('')
    try {
      const { error } = await supabase.from('help_ticket_messages')
        .insert({ ticket_id: ticket.id, sender_id: me.id, body, is_internal: isStaff && internal })
      if (error) throw error
      setText('')

      // Staff public reply reopens the conversation for the agent (status → pending);
      // agent reply on a pending/resolved ticket reopens it for staff (→ open).
      let newStatus = null
      if (isStaff && !internal && ticket.status === 'open') newStatus = 'pending'
      if (!isStaff && (ticket.status === 'pending' || ticket.status === 'resolved')) newStatus = 'open'
      if (newStatus) await supabase.from('help_tickets').update({ status: newStatus }).eq('id', ticket.id)

      // Route notifications: staff reply → requester; agent reply → assignee or all ASC.
      try {
        if (!(isStaff && internal)) {
          const recipients = isStaff
            ? [ticket.requester_id]
            : ticket.assignee_id
              ? [ticket.assignee_id]
              : profiles.filter(p => p.is_active !== false && String(p.role || '').toLowerCase() === 'asc').map(p => p.id)
          await notifyTicketReply({ recipientIds: recipients, actorId: me.id, actorName: meName, ticketNumber: ticket.ticket_number, body })
        }
      } catch (e) { console.error('Reply saved, notification failed', e) }

      onChanged?.()
    } catch (e) { setErr(e.message) } finally { setSending(false) }
  }

  async function setStatus(status) {
    const { error } = await supabase.from('help_tickets').update({ status }).eq('id', ticket.id)
    if (error) { setErr(error.message); return }
    try {
      await notifyTicketStatus({ recipientId: ticket.requester_id, actorId: me.id, actorName: meName, ticketNumber: ticket.ticket_number, status })
    } catch (e) { console.error(e) }
    onChanged?.()
  }

  async function assignToMe() {
    const { error } = await supabase.from('help_tickets').update({ assignee_id: me.id }).eq('id', ticket.id)
    if (error) setErr(error.message); else onChanged?.()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="card" style={{ width: 640, maxWidth: '94vw', height: '86vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', flex: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 15 }}>{catIcon(ticket.category)} #{ticket.ticket_number} · {ticket.subject}</b>
            <StatusBadge status={ticket.status} />
            <SlaBadges t={ticket} />
            <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 9px' }} onClick={onClose}>Close</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
            {catLabel(ticket.category)} · opened by {nameOf(ticket.requester_id)} {fmtWhen(ticket.created_at)}
            {ticket.assignee_id ? ` · assigned to ${nameOf(ticket.assignee_id)}` : ''}
          </div>
          {isStaff && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {!ticket.assignee_id || ticket.assignee_id !== me.id
                ? <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 9px' }} onClick={assignToMe}>Assign to me</button> : null}
              {ticket.status !== 'resolved' && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 9px', color: 'var(--passed)' }} onClick={() => setStatus('resolved')}>✓ Mark resolved</button>}
              {ticket.status === 'resolved' && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 9px' }} onClick={() => setStatus('closed')}>Close ticket</button>}
              {(ticket.status === 'resolved' || ticket.status === 'closed') && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 9px' }} onClick={() => setStatus('open')}>Reopen</button>}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }}>
          {loading ? <span className="page-sub">Loading…</span> : messages.map(m => {
            const mine = m.sender_id === me.id
            return (
              <div key={m.id} style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '82%', padding: '9px 12px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                  background: m.is_internal ? 'var(--needed-bg)' : mine ? 'var(--accent-bg)' : 'var(--canvas)',
                  border: '1px solid ' + (m.is_internal ? 'var(--needed)' : 'var(--line)') }}>
                  {m.is_internal && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--needed)', marginBottom: 3 }}>INTERNAL NOTE — not visible to the agent</div>}
                  {m.body}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 3 }}>{nameOf(m.sender_id)} · {fmtWhen(m.created_at)}</div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: 12, flex: 'none' }}>
          {err && <div style={{ color: 'var(--failed)', fontSize: 12, marginBottom: 6 }}>{err}</div>}
          {ticket.status === 'closed' && !isStaff
            ? <div className="page-sub" style={{ fontSize: 12.5, textAlign: 'center' }}>This ticket is closed. Open a new one if you need anything else.</div>
            : (
              <>
                {isStaff && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 12.5, color: internal ? 'var(--needed)' : 'var(--ink-soft)', cursor: 'pointer', fontWeight: internal ? 700 : 400 }}>
                    <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />
                    Internal note (staff only — the agent won't see it)
                  </label>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder={internal ? 'Add an internal note…' : 'Write a reply…'}
                    style={{ flex: 1, resize: 'none', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }} />
                  <button className="btn btn-primary" onClick={send} disabled={sending || !text.trim()}>{internal ? 'Add note' : 'Reply'}</button>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
function TicketReporting() {
  const [tickets, setTickets] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const [tRes, pRes] = await Promise.all([
        supabase.from('help_tickets').select('*'),
        supabase.from('profiles').select('id, full_name'),
      ])
      if (tRes.error) setErr(tRes.error.message)
      setTickets(tRes.data || [])
      setProfiles(pRes.data || [])
      setLoading(false)
    })()
  }, [])

  const stats = useMemo(() => {
    const nameOf = (id) => profiles.find(p => p.id === id)?.full_name || 'Unknown'
    const active = tickets.filter(t => t.status === 'open' || t.status === 'pending')
    const responded = tickets.filter(t => t.first_response_at)
    const resolvedOnes = tickets.filter(t => t.resolved_at || t.closed_at)

    const frMins = responded.map(t => businessMinutesBetween(t.created_at, t.first_response_at)).filter(x => x != null).sort((a, b) => a - b)
    const resHrs = resolvedOnes.map(t => hoursBetween(t.created_at, t.resolved_at || t.closed_at)).filter(x => x != null).sort((a, b) => a - b)
    const median = (arr) => arr.length ? arr[Math.floor(arr.length / 2)] : null

    const frWithin = frMins.filter(m => m <= FIRST_RESPONSE_TARGET_BUS_MIN).length
    const resWithin = resHrs.filter(h => h <= RESOLUTION_TARGET_HOURS).length

    const byCat = CATEGORIES.map(([v, l, ic]) => ({
      key: v, label: l, icon: ic,
      total: tickets.filter(t => t.category === v).length,
      open: active.filter(t => t.category === v).length,
    })).filter(c => c.total > 0).sort((a, b) => b.total - a.total)

    const byRequester = Object.entries(tickets.reduce((m, t) => ((m[t.requester_id] = (m[t.requester_id] || 0) + 1), m), {}))
      .map(([id, n]) => ({ name: nameOf(id), n })).sort((a, b) => b.n - a.n).slice(0, 8)

    // volume by week (last ~8 weeks)
    const cutoff = Date.now() - 56 * 86400000
    const recent = tickets.filter(t => new Date(t.created_at) > cutoff)

    const oldestOpen = active.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0]

    return {
      total: tickets.length, active: active.length,
      unassigned: active.filter(t => !t.assignee_id).length,
      frMedian: median(frMins), frPct: frMins.length ? Math.round((frWithin / frMins.length) * 100) : null,
      resMedian: median(resHrs), resPct: resHrs.length ? Math.round((resWithin / resHrs.length) * 100) : null,
      byCat, byRequester, recentCount: recent.length,
      oldestOpen,
    }
  }, [tickets, profiles])

  if (loading) return <p className="page-sub">Loading reporting…</p>
  if (err) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load.</b> <span className="page-sub">{err}</span></div>
  if (!tickets.length) return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 26 }}>No tickets yet — reporting fills in as they come.</div></div>

  const Stat = ({ label, value, sub, color }) => (
    <div className="card" style={{ flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--ink)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Stat label="Active tickets" value={stats.active} sub={`${stats.unassigned} unassigned`} color={stats.active ? 'var(--accent)' : 'var(--passed)'} />
        <Stat label="First response SLA" value={stats.frPct == null ? '—' : `${stats.frPct}%`}
          sub={`within 1 business hr · median ${fmtDur(stats.frMedian)}`}
          color={stats.frPct == null ? undefined : stats.frPct >= 90 ? 'var(--passed)' : stats.frPct >= 70 ? 'var(--needed)' : 'var(--failed)'} />
        <Stat label="Resolution SLA" value={stats.resPct == null ? '—' : `${stats.resPct}%`}
          sub={`within 24 hrs · median ${stats.resMedian == null ? '—' : fmtDur(stats.resMedian * 60)}`}
          color={stats.resPct == null ? undefined : stats.resPct >= 90 ? 'var(--passed)' : stats.resPct >= 70 ? 'var(--needed)' : 'var(--failed)'} />
        <Stat label="Last 8 weeks" value={stats.recentCount} sub={`${stats.total} all time`} />
      </div>

      {stats.oldestOpen && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--needed)' }}>
          <b style={{ fontSize: 13 }}>⏳ Oldest open ticket:</b>{' '}
          <span style={{ fontSize: 13 }}>#{stats.oldestOpen.ticket_number} · {stats.oldestOpen.subject} — open {timeAgo(stats.oldestOpen.created_at)}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
        <div className="card">
          <b style={{ fontSize: 14 }}>Tickets by category</b>
          <div style={{ marginTop: 10 }}>
            {stats.byCat.map(c => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <span style={{ width: 110, fontSize: 13, flexShrink: 0 }}>{c.icon} {c.label}</span>
                <div style={{ flex: 1, height: 12, background: 'var(--canvas)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round((c.total / stats.total) * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 6 }} />
                </div>
                <span style={{ width: 70, textAlign: 'right', fontSize: 12, color: 'var(--ink-soft)', flexShrink: 0 }}>{c.total} ({c.open} open)</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <b style={{ fontSize: 14 }}>Top submitters</b>
          <div style={{ marginTop: 10 }}>
            {stats.byRequester.map(r => (
              <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                <span>{r.name}</span><b>{r.n}</b>
              </div>
            ))}
          </div>
          <p className="page-sub" style={{ fontSize: 11.5, marginTop: 8 }}>Frequent submitters can flag confusing processes worth documenting in the Knowledge Base.</p>
        </div>
      </div>
    </div>
  )
}
