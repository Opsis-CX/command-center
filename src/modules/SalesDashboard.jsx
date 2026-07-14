import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
// ============================================================
//  SALES PIPELINE DASHBOARD
//  Kanban board for outbound B2B deals. Mirrors HiringDashboard:
//  status->column indirection, realtime refresh, detail slide-over,
//  stage-event logging, and STUBBED email on transitions
//  (see sendSalesEmail — wire the Edge Function to your Gmail).
// ============================================================

// ---- Stages -------------------------------------------------
// These mirror the "Lead Pipeline" stages from Pipedrive exactly, in order.
// `key` is stored in deals.status; `title`/`hint` are display only.
// Terminal stages (see CLOSED) render behind a toggle, not as live columns.
const STAGES = [
  { key: 'new_lead',        title: 'New Lead',              hint: 'Imported / not yet worked' },
  { key: 'email_1_sent',    title: 'Email 1 Sent',          hint: 'First email out' },
  { key: 'call_1_made',     title: 'Call 1 Made',           hint: 'First call attempt' },
  { key: 'linkedin_1_sent', title: 'LinkedIn Message 1 Sent', hint: 'First LinkedIn touch' },
  { key: 'email_2_sent',    title: 'Email 2 Sent',          hint: 'Second email out' },
  { key: 'call_2_made',     title: 'Call 2 Made',           hint: 'Second call attempt' },
  { key: 'linkedin_2_sent', title: 'LinkedIn Message 2 Sent', hint: 'Second LinkedIn touch' },
  { key: 'drip_campaign',   title: 'Added to Drip Campaign', hint: 'In nurture sequence' },
  { key: 'contact_made',    title: 'Contact Made',          hint: 'They responded' },
  { key: 'discovery_call',  title: 'Discovery Call Scheduled', hint: 'Call booked' },
  { key: 'proposal_sent',   title: 'Proposal Sent',         hint: 'Proposal out' },
  { key: 'negotiations',    title: 'Negotiations',          hint: 'Working terms' },
  { key: 'contract_sent',   title: 'Contract Sent',         hint: 'Awaiting signature' },
]
// Terminal statuses — hidden behind the toggle (like the hiring "screened out").
// email_unreachable = dead end; contract_signed = won.
const CLOSED = ['email_unreachable', 'contract_signed']
const STAGE_LABEL = {
  new_lead: 'New Lead', email_1_sent: 'Email 1 Sent', email_unreachable: 'Email Unreachable',
  call_1_made: 'Call 1 Made', linkedin_1_sent: 'LinkedIn Message 1 Sent', email_2_sent: 'Email 2 Sent',
  call_2_made: 'Call 2 Made', linkedin_2_sent: 'LinkedIn Message 2 Sent', drip_campaign: 'Added to Drip Campaign',
  contact_made: 'Contact Made', discovery_call: 'Discovery Call Scheduled', proposal_sent: 'Proposal Sent',
  negotiations: 'Negotiations', contract_sent: 'Contract Sent', contract_signed: 'Contract Signed',
}
// direct status -> column (kept as an indirection layer like the hiring board,
// so you can add sub-statuses later without touching the columns).
const STATUS_TO_COLUMN = Object.fromEntries(STAGES.map(s => [s.key, s.key]))

// which email (if any) fires when you move INTO a stage. null = no email.
// These `kind` strings are what the send-sales-email Edge Function switches on.
const STAGE_EMAIL = {
  email_1_sent: 'intro',        // first cold outreach
  email_2_sent: 'followup',     // second email in the sequence
  proposal_sent: 'proposal',
  contract_sent: 'contract',
  contract_signed: 'won_welcome',
}

// ---- email stub (mirrors sendHiringEmail) -------------------
async function sendSalesEmail(kind, to, data) {
  if (!kind || !to) return
  try {
    const { error } = await supabase.functions.invoke('send-sales-email', { body: { kind, to, data } })
    if (error) console.error('email send failed:', error)
  } catch (e) { console.error('email send failed:', e) }
}

// ---- small helpers (copied from the hiring board for consistency) ----
function timeAgo(iso) {
  const d = new Date(iso), now = new Date(), s = Math.floor((now - d) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  if (s < 604800) return Math.floor(s / 86400) + 'd ago'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function initials(name) {
  const p = (name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
function avatarColor(name) {
  const colors = ['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']
  let h = 0; for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}
const money = (n) => (n ? '$' + Number(n).toLocaleString() : '$0')

export default function SalesDashboard() {
  const { user } = useAuth()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [orgFilter, setOrgFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.from('deals')
      .select('*').order('created_at', { ascending: false })
    if (error) setErr(error.message)
    else setDeals(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // realtime: refresh when deals change
  useEffect(() => {
    const ch = supabase.channel('sales-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // move a deal to a new stage, log the event, fire the stubbed email
  async function transition(deal, toStatus, { note } = {}) {
    setBusy(true)
    const from = deal.status
    const patch = { status: toStatus, reviewer_id: user?.id }
    const emailKind = STAGE_EMAIL[toStatus]
    if (emailKind) patch.last_emailed_at = new Date().toISOString()

    const { error } = await supabase.from('deals').update(patch).eq('id', deal.id)
    if (error) { setErr(error.message); setBusy(false); return }

    await supabase.from('deal_stage_events').insert({
      deal_id: deal.id, from_status: from, to_status: toStatus, actor_id: user?.id, note: note || null,
    })
    if (emailKind && deal.contact_email) {
      await sendSalesEmail(emailKind, deal.contact_email, {
        name: deal.contact_person, org: deal.organization, dealId: deal.id, title: deal.title,
      })
    }
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, ...patch } : d))
    setSelected(prev => prev && prev.id === deal.id ? { ...prev, ...patch } : prev)
    setBusy(false)
  }
  const markSigned = (deal) => {
    if (!window.confirm(`Mark ${deal.organization} as CONTRACT SIGNED (won)?`)) return
    transition(deal, 'contract_signed', { note: 'contract signed' })
  }
  const markUnreachable = (deal) => {
    if (!window.confirm(`Mark ${deal.organization} as EMAIL UNREACHABLE (dead)?`)) return
    transition(deal, 'email_unreachable', { note: 'marked unreachable' })
  }

  // filtering
  const orgs = useMemo(
    () => Array.from(new Set(deals.map(d => d.organization).filter(Boolean))).sort(),
    [deals]
  )
  const matches = (d) => {
    if (orgFilter && d.organization !== orgFilter) return false
    if (!query) return true
    const q = query.toLowerCase()
    return (d.organization || '').toLowerCase().includes(q)
      || (d.contact_person || '').toLowerCase().includes(q)
      || (d.title || '').toLowerCase().includes(q)
  }

  // group into columns
  const byColumn = {}
  STAGES.forEach(c => { byColumn[c.key] = [] })
  const closed = []
  deals.filter(matches).forEach(d => {
    if (CLOSED.includes(d.status)) { if (showClosed) closed.push(d); return }
    const col = STATUS_TO_COLUMN[d.status]
    if (col && byColumn[col]) byColumn[col].push(d)
  })
  const activeCount = deals.filter(d => !CLOSED.includes(d.status)).length
  const wonCount = deals.filter(d => d.status === 'contract_signed').length
  const lostCount = deals.filter(d => d.status === 'email_unreachable').length

  if (loading) return <p className="page-sub" style={{ padding: 20 }}>Loading pipeline…</p>

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Sales pipeline</h1>
          <p className="page-sub" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
            {activeCount} active · {wonCount} signed · {lostCount} unreachable
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search org, contact, role…"
            style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', minWidth: 200, fontFamily: 'inherit' }} />
          <select value={orgFilter} onChange={e => setOrgFilter(e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit' }}>
            <option value="">All organizations</option>
            {orgs.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', color: 'var(--ink-soft)' }}>
            <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
            Show signed/unreachable ({wonCount + lostCount})
          </label>
        </div>
      </div>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{err}</div>}

      {/* Kanban board */}
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
        {STAGES.map(col => (
          <div key={col.key} style={{ flex: 'none', width: 264, background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 12, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100dvh - 240px)' }}>
            <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <b style={{ fontSize: 13.5 }}>{col.title}</b>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--surface)', borderRadius: 10, padding: '1px 8px', border: '1px solid var(--line)' }}>{byColumn[col.key].length}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{col.hint}</div>
            </div>
            <div style={{ padding: 10, overflowY: 'auto', display: 'grid', gap: 8, flex: 1, minHeight: 60 }}>
              {byColumn[col.key].length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: '16px 0' }}>—</div>}
              {byColumn[col.key].map(deal => (
                <DealCard key={deal.id} deal={deal} onClick={() => setSelected(deal)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Won / Lost list */}
      {showClosed && closed.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Closed</h2>
          <div style={{ display: 'grid', gap: 6 }}>
            {closed.map(deal => (
              <button key={deal.id} onClick={() => setSelected(deal)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColor(deal.organization), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: 'none' }}>{initials(deal.organization)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{deal.organization}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{deal.contact_person} · {STAGE_LABEL[deal.status]}</div>
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{timeAgo(deal.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && <DealPanel deal={selected} user={user} onClose={() => setSelected(null)}
        onTransition={transition} onSigned={markSigned} onUnreachable={markUnreachable} busy={busy} />}
    </div>
  )
}

function DealCard({ deal, onClick }) {
  return (
    <div style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 10, padding: 10, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(deal.organization), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{initials(deal.organization)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{deal.organization}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{deal.contact_person || '—'}{deal.title && deal.title !== deal.organization ? ` · ${deal.title}` : ''}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
        <span>{money(deal.value)}</span>
        <span style={{ marginLeft: 'auto' }}>{timeAgo(deal.created_at)}</span>
      </div>
    </div>
  )
}

function DealPanel({ deal, user, onClose, onTransition, onSigned, onUnreachable, busy }) {
  const [events, setEvents] = useState([])
  const [activities, setActivities] = useState([])
  const [noteText, setNoteText] = useState('')

  const loadHistory = useCallback(async () => {
    const [{ data: ev }, { data: act }] = await Promise.all([
      supabase.from('deal_stage_events').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
      supabase.from('deal_activities').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
    ])
    setEvents(ev || []); setActivities(act || [])
  }, [deal.id])
  useEffect(() => { loadHistory() }, [loadHistory])

  async function logActivity(kind, extra = {}) {
    await supabase.from('deal_activities').insert({
      deal_id: deal.id, kind, actor_id: user?.id, actor_name: user?.email || null, ...extra,
    })
    loadHistory()
  }
  async function addNote() {
    if (!noteText.trim()) return
    await logActivity('note', { body: noteText.trim() })
    setNoteText('')
  }

  // next-stage advance control
  const idx = STAGES.findIndex(s => s.key === deal.status)
  const next = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null

  const Row = ({ label, value }) => value ? (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  ) : null

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 460, maxWidth: '92%', height: '100%', background: 'var(--surface)', overflowY: 'auto', boxShadow: '-10px 0 30px rgba(0,0,0,.15)' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 2 }}>
          <span style={{ width: 40, height: 40, borderRadius: '50%', background: avatarColor(deal.organization), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, flex: 'none' }}>{initials(deal.organization)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{deal.organization}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{STAGE_LABEL[deal.status]} · added {timeAgo(deal.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 22, color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* stage controls */}
          {!CLOSED.includes(deal.status) && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {next && (
                  <button disabled={busy} onClick={() => onTransition(deal, next.key, { note: `advanced to ${next.title}` })}
                    style={{ flex: 1, border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit', minWidth: 150 }}>
                    → Move to {next.title}
                  </button>
                )}
                <button disabled={busy} onClick={() => onSigned(deal)}
                  style={{ border: 0, borderRadius: 8, background: '#16A34A', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Signed</button>
                <button disabled={busy} onClick={() => onUnreachable(deal)}
                  style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: '#DC2626', fontSize: 13.5, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Unreachable</button>
              </div>
              {next && STAGE_EMAIL[next.key] && (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 7 }}>
                  Moving to {next.title} will send the “{STAGE_EMAIL[next.key]}” email (once the Edge Function is connected to your Gmail).
                </div>
              )}
            </div>
          )}

          {/* quick log buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            <button onClick={() => logActivity('call', { direction: 'outbound', outcome: 'connected' })}
              style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>＋ Log call</button>
            <button onClick={() => logActivity('linkedin', { direction: 'outbound' })}
              style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>＋ Log LinkedIn</button>
            <button onClick={() => logActivity('meeting')}
              style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>＋ Log meeting</button>
          </div>

          <Row label="Contact" value={deal.contact_person} />
          <Row label="Role / title" value={deal.title && deal.title !== deal.organization ? deal.title : null} />
          <Row label="Email" value={deal.contact_email} />
          <Row label="Phone" value={deal.contact_phone} />
          <Row label="Value" value={money(deal.value)} />
          <Row label="Owner" value={deal.owner_name} />
          <Row label="Source" value={deal.source} />
          <Row label="Notes" value={deal.notes} />

          {/* add note */}
          <div style={{ marginTop: 8, marginBottom: 20 }}>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note…"
              style={{ width: '100%', minHeight: 60, border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)', resize: 'vertical' }} />
            <button onClick={addNote} style={{ marginTop: 6, border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Save note</button>
          </div>

          {/* activity + stage history */}
          {(activities.length > 0 || events.length > 0) && (
            <div style={{ marginTop: 8, paddingTop: 16, borderTop: '2px solid var(--line)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 12px' }}>History</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                {activities.map(a => (
                  <div key={'a' + a.id} style={{ fontSize: 12.5, color: 'var(--ink)', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--ink-soft)', flex: 'none' }}>{timeAgo(a.created_at)}</span>
                    <span>{a.kind}{a.outcome ? ` · ${a.outcome}` : ''}{a.body ? ` — ${a.body}` : ''}</span>
                  </div>
                ))}
                {events.map(ev => (
                  <div key={'e' + ev.id} style={{ fontSize: 12.5, color: 'var(--ink-soft)', display: 'flex', gap: 8 }}>
                    <span style={{ flex: 'none' }}>{timeAgo(ev.created_at)}</span>
                    <span>{ev.from_status ? `${STAGE_LABEL[ev.from_status] || ev.from_status} → ` : ''}{STAGE_LABEL[ev.to_status] || ev.to_status}{ev.note ? ` (${ev.note})` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
