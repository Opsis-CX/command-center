import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
// ============================================================
//  SALES PIPELINE DASHBOARD
//  Kanban board for outbound B2B deals. Mirrors HiringDashboard:
//  status->column indirection, realtime refresh, detail slide-over,
//  stage-event logging, and STUBBED email on transitions
//  (see sendSalesEmail — wire the Edge Function to your Gmail).
//
//  Moving deals:
//   - drag a card onto any column (forward OR backward)
//   - or use the "Move to stage…" dropdown in the detail panel
//   - or the quick "next stage" / Signed / Unreachable buttons
//  Stages wired to an auto-email ask for confirmation first, so a
//  casual drag never sends an email unintentionally.
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
  { key: 'contract_signed', title: 'Contract Signed',       hint: 'Signed — mark Won to close' },
]
// Terminal statuses — removed from the board, shown behind the toggle
// (like the hiring "screened out"). won/lost are the real exits;
// email_unreachable is a third exit for dead email addresses.
const CLOSED = ['won', 'lost', 'email_unreachable']
const STAGE_LABEL = {
  new_lead: 'New Lead', email_1_sent: 'Email 1 Sent', email_unreachable: 'Email Unreachable',
  call_1_made: 'Call 1 Made', linkedin_1_sent: 'LinkedIn Message 1 Sent', email_2_sent: 'Email 2 Sent',
  call_2_made: 'Call 2 Made', linkedin_2_sent: 'LinkedIn Message 2 Sent', drip_campaign: 'Added to Drip Campaign',
  contact_made: 'Contact Made', discovery_call: 'Discovery Call Scheduled', proposal_sent: 'Proposal Sent',
  negotiations: 'Negotiations', contract_sent: 'Contract Sent', contract_signed: 'Contract Signed',
  won: 'Won', lost: 'Lost',
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
  won: 'won_welcome',
}

// ---- Lost reasons -------------------------------------------
// Shown in the "Mark as Lost" dialog. Edit freely — this list is the
// only place to change; everything else follows it. Keep 'Other' last.
const LOST_REASONS = [
  'No response',
  'Not interested',
  'No budget',
  'Bad timing',
  'Chose a competitor',
  'Not a fit',
  'Contact left the company',
  'Company closed / restructured',
  'Other',
]

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

// ---- deal attachments -------------------------------------------
// Storage bucket that holds deal files (proposals, contracts, docs).
// Create it once in Supabase (public bucket named exactly this). To reuse an
// existing bucket instead, change this one string.
const DEAL_BUCKET = 'deal-attachments'
const MAX_ATTACH_MB = 50
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function fileIcon(type) {
  const t = type || ''
  if (t.startsWith('image/')) return '🖼'
  if (t.startsWith('video/')) return '🎬'
  if (t.includes('pdf')) return '📄'
  if (t.includes('word') || t.includes('document')) return '📝'
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return '📊'
  if (t.includes('presentation') || t.includes('powerpoint')) return '📽'
  return '📎'
}

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
  // drag-and-drop state: which deal is being dragged, which column is hovered
  const [dragId, setDragId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  // deal currently in the "mark as lost" dialog (null = closed)
  const [losingDeal, setLosingDeal] = useState(null)
  // whether the "new lead" create dialog is open
  const [creating, setCreating] = useState(false)
  // whether the "import CSV" dialog is open
  const [importing, setImporting] = useState(false)

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

  // move a deal to a new stage, log the event, fire the stubbed email.
  // If the target stage has an auto-email wired, confirm first — this covers
  // drags, the dropdown, and the quick buttons alike.
  async function transition(deal, toStatus, { note, skipConfirm, extraPatch } = {}) {
    if (toStatus === deal.status) return
    const emailKind = STAGE_EMAIL[toStatus]
    if (emailKind && !skipConfirm) {
      const ok = window.confirm(
        `Moving ${deal.organization} to "${STAGE_LABEL[toStatus]}" will send the "${emailKind}" email` +
        (deal.contact_email ? ` to ${deal.contact_email}.` : ' (no email on file, so nothing will send).') +
        `\n\nContinue?`
      )
      if (!ok) return
    }
    setBusy(true)
    const from = deal.status
    const patch = { status: toStatus, reviewer_id: user?.id, ...(extraPatch || {}) }
    // reopening a lost deal clears its stale reason
    if (from === 'lost' && toStatus !== 'lost') patch.lost_reason = null
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
  const markWon = (deal) => {
    if (!window.confirm(`Mark ${deal.organization} as WON? This removes it from the pipeline` +
      (deal.contact_email ? ` and sends the welcome email to ${deal.contact_email}.` : '.'))) return
    transition(deal, 'won', { note: 'marked won', skipConfirm: true })
  }
  // Lost goes through a dialog so a reason is always captured.
  const markLost = (deal) => setLosingDeal(deal)
  const confirmLost = (deal, reason, detail) => {
    setLosingDeal(null)
    const note = 'marked lost: ' + reason + (detail ? ' — ' + detail : '')
    transition(deal, 'lost', { note, skipConfirm: true, extraPatch: { lost_reason: reason } })
    // if the panel is open on this deal, close it — the deal left the board
    setSelected(prev => prev && prev.id === deal.id ? null : prev)
  }

  // Edit a deal's fields (contact info, value, notes, etc.) in place.
  // Throws on error so the panel can keep the form open; also surfaces the
  // message on the board banner.
  async function updateDeal(deal, patch) {
    const { data, error } = await supabase.from('deals').update(patch).eq('id', deal.id).select().single()
    if (error) { setErr(error.message); throw error }
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, ...data } : d))
    setSelected(prev => prev && prev.id === deal.id ? { ...prev, ...data } : prev)
    return data
  }

  // ---- drag-and-drop handlers ----
  function onDragStart(e, deal) {
    setDragId(deal.id)
    e.dataTransfer.effectAllowed = 'move'
    // some browsers need data set for the drag to start
    e.dataTransfer.setData('text/plain', deal.id)
  }
  function onDragEnd() { setDragId(null); setDragOverCol(null) }
  function onColDragOver(e, colKey) {
    e.preventDefault()                       // required to allow dropping
    e.dataTransfer.dropEffect = 'move'
    if (dragOverCol !== colKey) setDragOverCol(colKey)
  }
  function onColDrop(e, colKey) {
    e.preventDefault()
    const id = dragId || e.dataTransfer.getData('text/plain')
    setDragId(null); setDragOverCol(null)
    const deal = deals.find(d => d.id === id)
    if (!deal || deal.status === colKey) return
    transition(deal, colKey, { note: `dragged to ${STAGE_LABEL[colKey]}` })
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
  const wonCount = deals.filter(d => d.status === 'won').length
  const lostCount = deals.filter(d => d.status === 'lost' || d.status === 'email_unreachable').length

  if (loading) return <p className="page-sub" style={{ padding: 20 }}>Loading pipeline…</p>

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Sales pipeline</h1>
          <p className="page-sub" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
            {activeCount} active · {wonCount} won · {lostCount} lost
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setCreating(true)}
            style={{ border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
            ＋ New lead
          </button>
          <button onClick={() => setImporting(true)}
            style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 700, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
            ⭱ Import CSV
          </button>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search org, contact, role…"
            style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', minWidth: 200, fontFamily: 'inherit' }} />
          <select value={orgFilter} onChange={e => setOrgFilter(e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit' }}>
            <option value="">All organizations</option>
            {orgs.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', color: 'var(--ink-soft)' }}>
            <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
            Show won/lost ({wonCount + lostCount})
          </label>
        </div>
      </div>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{err}</div>}

      {/* Kanban board */}
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
        {STAGES.map(col => (
          <div key={col.key}
            onDragOver={e => onColDragOver(e, col.key)}
            onDragLeave={() => setDragOverCol(prev => prev === col.key ? null : prev)}
            onDrop={e => onColDrop(e, col.key)}
            style={{
              flex: 'none', width: 264, background: 'var(--canvas)',
              border: dragOverCol === col.key ? '2px dashed var(--accent)' : '1px solid var(--line)',
              borderRadius: 12, display: 'flex', flexDirection: 'column',
              maxHeight: 'calc(100dvh - 240px)',
              transition: 'border-color .1s ease',
            }}>
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
                <DealCard key={deal.id} deal={deal}
                  dragging={dragId === deal.id}
                  onDragStart={e => onDragStart(e, deal)}
                  onDragEnd={onDragEnd}
                  onClick={() => setSelected(deal)} />
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
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{deal.contact_person} · {STAGE_LABEL[deal.status]}{deal.lost_reason ? ` · ${deal.lost_reason}` : ''}</div>
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{timeAgo(deal.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && <DealPanel deal={selected} user={user} onClose={() => setSelected(null)}
        onTransition={transition} onWon={markWon} onLost={markLost} onUpdate={updateDeal} busy={busy} />}

      {losingDeal && <LostDialog deal={losingDeal}
        onCancel={() => setLosingDeal(null)}
        onConfirm={(reason, detail) => confirmLost(losingDeal, reason, detail)} />}

      {creating && <NewLeadModal
        onCancel={() => setCreating(false)}
        onCreated={(deal) => {
          setCreating(false)
          setDeals(prev => [deal, ...prev])   // optimistic; realtime will reconcile
          setSelected(deal)                    // open the new lead's panel
        }}
        onError={setErr} />}

      {importing && <ImportModal
        onCancel={() => setImporting(false)}
        onDone={() => { setImporting(false); load() }}
        onError={setErr} />}
    </div>
  )
}

function DealCard({ deal, onClick, dragging, onDragStart, onDragEnd }) {
  return (
    <div draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 10, padding: 10,
        cursor: 'grab', opacity: dragging ? 0.4 : 1, transition: 'opacity .1s ease',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(deal.organization), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{initials(deal.organization)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{deal.organization}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{deal.contact_person || '—'}{deal.title && deal.title !== deal.organization ? ` · ${deal.title}` : ''}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
        <span>{money(deal.value)}</span>
        {deal.attachments && deal.attachments.length > 0 && (
          <span title={`${deal.attachments.length} attachment${deal.attachments.length === 1 ? '' : 's'}`}>📎 {deal.attachments.length}</span>
        )}
        <span style={{ marginLeft: 'auto' }}>{timeAgo(deal.created_at)}</span>
      </div>
    </div>
  )
}

function DealPanel({ deal, user, onClose, onTransition, onWon, onLost, onUpdate, busy }) {
  const [events, setEvents] = useState([])
  const [activities, setActivities] = useState([])
  const [noteText, setNoteText] = useState('')
  // inline edit state for the deal's own fields
  const [editing, setEditing] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [form, setForm] = useState({})
  const [editErr, setEditErr] = useState('')
  // attachment upload state
  const [upBusy, setUpBusy] = useState(false)
  const [upErr, setUpErr] = useState('')
  const attList = deal.attachments || []

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

  // Upload one or more files to the deal bucket, then persist their metadata in
  // the deal's `attachments` JSONB array. Also logs an activity per file.
  async function onFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUpErr(''); setUpBusy(true)
    let next = [...(deal.attachments || [])]
    let added = 0
    for (const file of files) {
      if (file.size > MAX_ATTACH_MB * 1024 * 1024) { setUpErr(`${file.name} is over ${MAX_ATTACH_MB}MB — skipped.`); continue }
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${deal.id}/${Date.now()}-${safe}`
      const { error: upE } = await supabase.storage.from(DEAL_BUCKET).upload(path, file, { contentType: file.type || undefined })
      if (upE) { setUpErr(`Upload failed: ${upE.message}`); continue }
      next = [{ name: file.name, type: file.type || '', size: file.size, path, uploaded_by: user?.id || null, created_at: new Date().toISOString() }, ...next]
      added++
    }
    if (added) {
      try {
        await onUpdate(deal, { attachments: next })
        logActivity('attachment', { body: `added ${added} file${added === 1 ? '' : 's'}` })
      } catch (err) { setUpErr(err.message || 'Files uploaded but could not be saved to the deal.') }
    }
    setUpBusy(false)
  }

  async function removeAttachment(att) {
    if (!window.confirm(`Remove "${att.name}" from this deal?`)) return
    setUpErr('')
    try {
      await supabase.storage.from(DEAL_BUCKET).remove([att.path])
      const next = (deal.attachments || []).filter(a => a.path !== att.path)
      await onUpdate(deal, { attachments: next })
    } catch (err) { setUpErr(err.message || 'Could not remove that file.') }
  }

  function startEdit() {
    setForm({
      organization: deal.organization || '', contact_person: deal.contact_person || '',
      title: deal.title || '', contact_email: deal.contact_email || '',
      contact_phone: deal.contact_phone || '', value: deal.value ?? '',
      owner_name: deal.owner_name || '', source: deal.source || '', notes: deal.notes || '',
    })
    setEditErr(''); setEditing(true)
  }
  const setFld = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }))
  async function saveEdit() {
    if (!(form.organization || '').trim()) { setEditErr('Organization is required.'); return }
    setSavingEdit(true); setEditErr('')
    const clean = (v) => { const t = (v || '').trim(); return t === '' ? null : t }
    const patch = {
      organization: form.organization.trim(), contact_person: clean(form.contact_person),
      title: clean(form.title), contact_email: clean(form.contact_email),
      contact_phone: clean(form.contact_phone), owner_name: clean(form.owner_name),
      source: clean(form.source), notes: clean(form.notes),
      value: form.value === '' ? null : Number(form.value),
    }
    try { await onUpdate(deal, patch); setEditing(false) }
    catch (e) { setEditErr(e.message || 'Could not save changes.') }
    finally { setSavingEdit(false) }
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

  // Like Row, but always renders — shows a muted "Not set" when empty, so
  // missing contact details are visible instead of silently hidden.
  const RowShow = ({ label, value }) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: value ? 'var(--ink)' : 'var(--ink-soft)', fontStyle: value ? 'normal' : 'italic' }}>{value || 'Not set'}</div>
    </div>
  )

  const efield = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit' }
  const elabel = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', margin: '0 0 3px', display: 'block' }

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
          <div style={{ marginBottom: 20 }}>
            {!CLOSED.includes(deal.status) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {next && (
                  <button disabled={busy} onClick={() => onTransition(deal, next.key, { note: `advanced to ${next.title}` })}
                    style={{ flex: 1, border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit', minWidth: 150 }}>
                    → Move to {next.title}
                  </button>
                )}
                <button disabled={busy} onClick={() => onWon(deal)}
                  style={{ border: 0, borderRadius: 8, background: '#16A34A', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>🏆 Won</button>
                <button disabled={busy} onClick={() => onLost(deal)}
                  style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: '#DC2626', fontSize: 13.5, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Lost</button>
              </div>
            )}
            {/* jump to ANY stage — forward or backward, or reopen a closed deal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, flex: 'none' }}>Move to stage:</label>
              <select disabled={busy} value={deal.status}
                onChange={e => {
                  const v = e.target.value
                  if (v === 'lost') { onLost(deal); return }
                  onTransition(deal, v, { note: `moved to ${STAGE_LABEL[v]} via stage picker` })
                }}
                style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit' }}>
                {STAGES.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.title}{STAGE_EMAIL[s.key] ? ' (sends email)' : ''}
                  </option>
                ))}
                <option value="won">Won — remove from pipeline{STAGE_EMAIL.won ? ' (sends email)' : ''}</option>
                <option value="lost">Lost — remove from pipeline</option>
                <option value="email_unreachable">Email Unreachable — remove from pipeline</option>
              </select>
            </div>
            {next && STAGE_EMAIL[next.key] && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 7 }}>
                Moving to {next.title} will send the “{STAGE_EMAIL[next.key]}” email (once the Edge Function is connected to your Gmail).
              </div>
            )}
          </div>

          {/* quick log buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            <button onClick={() => logActivity('call', { direction: 'outbound', outcome: 'connected' })}
              style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>＋ Log call</button>
            <button onClick={() => logActivity('linkedin', { direction: 'outbound' })}
              style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>＋ Log LinkedIn</button>
            <button onClick={() => logActivity('meeting')}
              style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>＋ Log meeting</button>
          </div>

          {/* Details — view or edit the deal's own fields */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingTop: 4, borderTop: '1px solid var(--line)' }}>
            <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', margin: '12px 0 0' }}>Details</h3>
            {!editing ? (
              <button onClick={startEdit}
                style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>✎ Edit</button>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button onClick={() => setEditing(false)} disabled={savingEdit}
                  style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={saveEdit} disabled={savingEdit}
                  style={{ border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, padding: '5px 14px', cursor: savingEdit ? 'default' : 'pointer', fontFamily: 'inherit', opacity: savingEdit ? .6 : 1 }}>{savingEdit ? 'Saving…' : 'Save'}</button>
              </div>
            )}
          </div>

          {editErr && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 12 }}>{editErr}</div>}

          {editing ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                <FormField lbl="Organization *" value={form.organization} onChange={setFld('organization')} placeholder="Acme Corp" full />
                <FormField lbl="Contact person" value={form.contact_person} onChange={setFld('contact_person')} placeholder="Jane Doe" />
                <FormField lbl="Role / title" value={form.title} onChange={setFld('title')} placeholder="VP Marketing" />
                <FormField lbl="Email" value={form.contact_email} onChange={setFld('contact_email')} type="email" placeholder="jane@acme.com" />
                <FormField lbl="Phone" value={form.contact_phone} onChange={setFld('contact_phone')} placeholder="(555) 123-4567" />
                <FormField lbl="Value ($)" value={form.value} onChange={setFld('value')} type="number" placeholder="0" />
                <FormField lbl="Owner" value={form.owner_name} onChange={setFld('owner_name')} placeholder="Lead owner" />
                <FormField lbl="Source" value={form.source} onChange={setFld('source')} placeholder="Referral, LinkedIn…" full />
              </div>
              <label style={elabel}>Notes</label>
              <textarea value={form.notes} onChange={setFld('notes')} placeholder="Anything useful about this lead…"
                style={{ ...efield, minHeight: 64, resize: 'vertical' }} />
            </div>
          ) : (
            <>
              <RowShow label="Contact" value={deal.contact_person} />
              <Row label="Role / title" value={deal.title && deal.title !== deal.organization ? deal.title : null} />
              <RowShow label="Email" value={deal.contact_email} />
              <RowShow label="Phone" value={deal.contact_phone} />
              <Row label="Value" value={money(deal.value)} />
              <Row label="Owner" value={deal.owner_name} />
              <Row label="Source" value={deal.source} />
              <Row label="Lost reason" value={deal.lost_reason} />
              <Row label="Notes" value={deal.notes} />
            </>
          )}

          {/* Attachments (proposals, contracts, docs) */}
          <div style={{ marginTop: 4, marginBottom: 20, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', margin: 0 }}>Attachments</h3>
              <label style={{ border: '1px solid var(--line)', borderRadius: 7, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, padding: '5px 12px', cursor: upBusy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: upBusy ? .6 : 1 }}>
                {upBusy ? 'Uploading…' : '📎 Add file'}
                <input type="file" multiple hidden disabled={upBusy} onChange={onFiles} />
              </label>
            </div>

            {attList.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No files yet — attach the proposal, contract, or any supporting doc.</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {attList.map(a => {
                  const isImg = (a.type || '').startsWith('image/')
                  const { data } = supabase.storage.from(DEAL_BUCKET).getPublicUrl(a.path)
                  const url = data?.publicUrl || '#'
                  return (
                    <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', background: 'var(--canvas)' }}>
                      {isImg
                        ? <img src={url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                        : <span style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--accent-bg)', display: 'grid', placeItems: 'center', fontSize: 16, flex: 'none' }}>{fileIcon(a.type)}</span>}
                      <a href={url} target="_blank" rel="noreferrer" download={a.name} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'var(--ink)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtSize(a.size)}{a.created_at ? ` · ${timeAgo(a.created_at)}` : ''}</div>
                      </a>
                      <button onClick={() => removeAttachment(a)} title="Remove"
                        style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--failed, #DC2626)', fontSize: 14, flex: 'none' }}>🗑</button>
                    </div>
                  )
                })}
              </div>
            )}
            {upErr && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12, marginTop: 8 }}>{upErr}</div>}
          </div>

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

// Create-a-lead dialog. Inserts a row into `deals` at the first stage
// ('new_lead'). Only writes columns the board already reads/writes, so it
// matches the existing schema. Organization is the one required field.
// ---- CSV import -------------------------------------------------
// Minimal but correct CSV parser: handles quoted fields, embedded commas,
// escaped double-quotes (""), and CRLF/LF line endings. Returns the header
// row plus an array of value-arrays.
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  const endField = () => { row.push(field); field = '' }
  const endRow = () => { endField(); rows.push(row); row = [] }
  text = text.replace(/^\uFEFF/, '')   // strip BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') endField()
    else if (c === '\n') endRow()
    else if (c === '\r') { /* handled by the \n that follows */ }
    else field += c
  }
  if (field.length || row.length) endRow()
  const clean = rows.filter(r => !(r.length === 1 && r[0].trim() === ''))
  const headers = clean.shift() || []
  return { headers: headers.map(h => h.trim()), rows: clean }
}

// The deal fields the importer can fill, with header keywords used to guess a
// mapping. Order = display order. `organization` is required per row.
// Maps a CRM stage label (e.g. "Email 1 Sent", "Email Unreachable") back to a
// pipeline status key, using the same labels the board already displays.
// Unknown labels fall back to the first stage.
const LABEL_TO_STATUS = Object.fromEntries(
  Object.entries(STAGE_LABEL).map(([k, v]) => [v.toLowerCase().trim(), k])
)
const stageToStatus = (text) => LABEL_TO_STATUS[(text || '').toLowerCase().trim()] || 'new_lead'

const IMPORT_FIELDS = [
  { key: 'organization',   label: 'Organization', required: true, match: ['organization', 'company', 'account'] },
  { key: 'contact_person', label: 'Contact person', match: ['contact person', 'person - name', 'contact name', 'full name', 'name'] },
  { key: 'title',          label: 'Role / title', match: ['title', 'role', 'job'] },
  { key: 'status',         label: 'Stage', match: ['stage'] },
  { key: 'contact_email',  label: 'Email', match: ['email', 'e-mail'] },
  { key: 'contact_phone',  label: 'Phone', match: ['phone', 'mobile', 'tel'] },
  { key: 'value',          label: 'Value', match: ['value', 'amount'] },
  { key: 'owner_name',     label: 'Owner', match: ['owner'] },
  { key: 'source',         label: 'Source', match: ['source', 'channel'] },
]
function autoMap(headers) {
  const norm = headers.map(h => h.toLowerCase())
  const map = {}
  for (const f of IMPORT_FIELDS) {
    let idx = -1
    for (const m of f.match) { idx = norm.findIndex(h => h.includes(m)); if (idx >= 0) break }
    map[f.key] = idx
  }
  return map
}

function ImportModal({ onCancel, onDone, onError }) {
  const [parsed, setParsed] = useState(null)   // { headers, rows }
  const [map, setMap] = useState({})
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState('')
  const [result, setResult] = useState(null)   // { inserted, skipped }

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name); setLocalErr(''); setResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const p = parseCSV(String(reader.result))
        if (!p.headers.length || !p.rows.length) { setLocalErr('That file has no data rows.'); return }
        setParsed(p); setMap(autoMap(p.headers))
      } catch (err) { setLocalErr('Could not read that file: ' + err.message) }
    }
    reader.onerror = () => setLocalErr('Could not read that file.')
    reader.readAsText(file)
  }

  const cell = (r, key) => { const i = map[key]; return i != null && i >= 0 ? (r[i] ?? '') : '' }
  const clean = (v) => { const t = (v ?? '').toString().trim(); return t === '' ? null : t }
  const toNum = (v) => { const t = clean(v); if (t == null) return null; const n = Number(t.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n }

  // rows that have an organization — the rest are skipped
  const buildable = parsed ? parsed.rows.filter(r => clean(cell(r, 'organization'))) : []
  const skipCount = parsed ? parsed.rows.length - buildable.length : 0

  async function doImport() {
    if (!buildable.length) { setLocalErr('No rows have an Organization, so nothing can be imported. Check the mapping.'); return }
    setBusy(true); setLocalErr('')
    const rows = buildable.map(r => ({
      status: (map.status != null && map.status >= 0) ? stageToStatus(cell(r, 'status')) : 'new_lead',
      organization: clean(cell(r, 'organization')),
      contact_person: clean(cell(r, 'contact_person')),
      title: clean(cell(r, 'title')),
      contact_email: clean(cell(r, 'contact_email')),
      contact_phone: clean(cell(r, 'contact_phone')),
      owner_name: clean(cell(r, 'owner_name')),
      source: clean(cell(r, 'source')),
      value: toNum(cell(r, 'value')),
    }))
    let inserted = 0
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const { error } = await supabase.from('deals').insert(chunk)
      if (error) {
        setBusy(false)
        setLocalErr(`Imported ${inserted} before an error: ${error.message}`)
        onError && onError(error.message)
        return
      }
      inserted += chunk.length
    }
    setBusy(false)
    setResult({ inserted, skipped: skipCount })
  }

  const box = { width: '640px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 22, boxShadow: '0 18px 50px rgba(0,0,0,.25)' }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={box}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800 }}>Import leads from CSV</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ink-soft)' }}>
          Each row becomes a lead at the “New Lead” stage. Only mapped columns are imported.
        </p>
        {localErr && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 14 }}>{localErr}</div>}

        {result ? (
          <div>
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', borderRadius: 8, padding: '12px 14px', fontSize: 13.5, marginBottom: 16 }}>
              Imported <b>{result.inserted}</b> lead{result.inserted === 1 ? '' : 's'}.{result.skipped > 0 ? ` Skipped ${result.skipped} row${result.skipped === 1 ? '' : 's'} with no organization.` : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onDone}
                style={{ border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '8px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
            </div>
          </div>
        ) : !parsed ? (
          <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 28, textAlign: 'center', background: 'var(--canvas)' }}>
            <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginBottom: 10 }}>Choose a .csv file exported from your CRM</div>
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
              <b>{fileName}</b> · {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} · {parsed.headers.length} columns
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginBottom: 8 }}>Map columns</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 18 }}>
              {IMPORT_FIELDS.map(f => (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 12.5, color: 'var(--ink)', width: 108, flex: 'none' }}>
                    {f.label}{f.required ? ' *' : ''}
                  </label>
                  <select value={map[f.key] ?? -1} onChange={e => setMap(m => ({ ...m, [f.key]: Number(e.target.value) }))}
                    style={{ flex: 1, minWidth: 0, border: '1px solid var(--line)', borderRadius: 7, padding: '6px 8px', fontSize: 12.5, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit' }}>
                    <option value={-1}>— skip —</option>
                    {parsed.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginBottom: 8 }}>Preview (first 3)</div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--canvas)' }}>
                    {IMPORT_FIELDS.filter(f => (map[f.key] ?? -1) >= 0).map(f => (
                      <th key={f.key} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', fontWeight: 700 }}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buildable.slice(0, 3).map((r, ri) => (
                    <tr key={ri}>
                      {IMPORT_FIELDS.filter(f => (map[f.key] ?? -1) >= 0).map(f => (
                        <td key={f.key} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{cell(r, f.key) || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
              Will import <b>{buildable.length}</b> lead{buildable.length === 1 ? '' : 's'}{skipCount > 0 ? ` · ${skipCount} skipped (no organization)` : ''}. Importing again will create duplicates.
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onCancel} disabled={busy}
                style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={doImport} disabled={busy || !buildable.length}
                style={{ border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '8px 18px', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy || !buildable.length ? .6 : 1 }}>
                {busy ? 'Importing…' : `Import ${buildable.length} lead${buildable.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Module-scope field component. IMPORTANT: this must live at module scope, not
// inside a modal's render body. A component defined inside render gets a new
// function identity on every keystroke, so React remounts the <input> each time
// and focus jumps away (the cursor bounced back to the first field). Hoisting it
// here keeps the input mounted, so typing behaves normally.
function FormField({ lbl, value, onChange, type = 'text', placeholder, full, autoFocus }) {
  return (
    <div style={{ marginBottom: 12, gridColumn: full ? '1 / -1' : undefined }}>
      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', margin: '0 0 4px', display: 'block' }}>{lbl}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus}
        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit' }} />
    </div>
  )
}

function NewLeadModal({ onCancel, onCreated, onError }) {
  const [f, setF] = useState({
    organization: '', contact_person: '', title: '', contact_email: '',
    contact_phone: '', value: '', owner_name: '', source: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [localErr, setLocalErr] = useState('')
  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }))

  async function save() {
    if (!f.organization.trim()) { setLocalErr('Organization is required.'); return }
    setSaving(true); setLocalErr('')
    // Build the row from non-empty fields only; nulls where blank.
    const clean = (v) => { const t = (v || '').trim(); return t === '' ? null : t }
    const row = {
      status: 'new_lead',
      organization: f.organization.trim(),
      contact_person: clean(f.contact_person),
      title: clean(f.title),
      contact_email: clean(f.contact_email),
      contact_phone: clean(f.contact_phone),
      owner_name: clean(f.owner_name),
      source: clean(f.source),
      notes: clean(f.notes),
      value: f.value === '' ? null : Number(f.value),
    }
    const { data, error } = await supabase.from('deals').insert(row).select().single()
    if (error) {
      setSaving(false)
      setLocalErr(error.message)   // shows the exact DB error if a column mismatches
      onError && onError(error.message)
      return
    }
    onCreated(data)
  }

  const field = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit' }
  const label = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', margin: '0 0 4px', display: 'block' }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 22, boxShadow: '0 18px 50px rgba(0,0,0,.25)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800 }}>New lead</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ink-soft)' }}>
          Adds a deal to the pipeline at the “New Lead” stage.
        </p>
        {localErr && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 14 }}>{localErr}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <FormField lbl="Organization *" value={f.organization} onChange={set('organization')} placeholder="Acme Corp" full autoFocus />
          <FormField lbl="Contact person" value={f.contact_person} onChange={set('contact_person')} placeholder="Jane Doe" />
          <FormField lbl="Role / title" value={f.title} onChange={set('title')} placeholder="VP Marketing" />
          <FormField lbl="Email" value={f.contact_email} onChange={set('contact_email')} type="email" placeholder="jane@acme.com" />
          <FormField lbl="Phone" value={f.contact_phone} onChange={set('contact_phone')} placeholder="(555) 123-4567" />
          <FormField lbl="Deal value ($)" value={f.value} onChange={set('value')} type="number" placeholder="0" />
          <FormField lbl="Owner" value={f.owner_name} onChange={set('owner_name')} placeholder="Who owns this lead" />
          <FormField lbl="Source" value={f.source} onChange={set('source')} placeholder="Referral, LinkedIn, list…" full />
          <div style={{ marginBottom: 4, gridColumn: '1 / -1' }}>
            <label style={label}>Notes</label>
            <textarea value={f.notes} onChange={set('notes')} placeholder="Anything useful about this lead…"
              style={{ ...field, minHeight: 64, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCancel} disabled={saving}
            style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '8px 18px', cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving ? .6 : 1 }}>
            {saving ? 'Adding…' : 'Add lead'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Small centered dialog for marking a deal Lost — captures a reason
// (from LOST_REASONS) plus an optional free-text detail.
function LostDialog({ deal, onCancel, onConfirm }) {
  const [reason, setReason] = useState(LOST_REASONS[0])
  const [detail, setDetail] = useState('')
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: 420, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 20, boxShadow: '0 18px 50px rgba(0,0,0,.25)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>Mark as Lost</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-soft)' }}>
          {deal.organization} will be removed from the pipeline. Why was it lost?
        </p>
        <select value={reason} onChange={e => setReason(e.target.value)} autoFocus
          style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'inherit', marginBottom: 10 }}>
          {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <textarea value={detail} onChange={e => setDetail(e.target.value)}
          placeholder="Optional detail (e.g. who they went with, when to revisit)…"
          style={{ width: '100%', minHeight: 56, border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)', resize: 'vertical', marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={() => onConfirm(reason, detail.trim())}
            style={{ border: 0, borderRadius: 8, background: '#DC2626', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit' }}>Mark Lost</button>
        </div>
      </div>
    </div>
  )
}
