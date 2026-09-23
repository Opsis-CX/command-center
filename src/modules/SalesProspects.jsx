// ============================================================================
//  PROSPECTS — the dialer's workspace (Brittney, 2026-09-23).
//
//  A prospect IS a sales-pipeline deal: same `deals` row, seen as research
//  instead of as a stage. Editing here updates the Pipeline board and the other
//  way round — nothing is entered twice. The research fields were imported
//  from the OpsisCx Sales Tracker sheet on 2026-09-23 (blanks filled only).
//
//  What a dialer does here:
//    • find who to call (tier, industry, stage, owner, needs-research filters)
//    • read the research + call hypothesis before dialing
//    • log what happened (call outcome / note), set the next follow-up
//    • book the discovery meeting (moves the deal to Discovery Call Scheduled
//      and stamps who booked it — that is who earns the meeting bonus)
//    • record the discovery session (14 questions) once it happens
//  Moves to any other stage still happen on the Pipeline board, because that
//  is where the stage emails are confirmed and sent.
// ============================================================================
import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { SALES_STAGES } from './PipelineBoard'
import { useSalesLists, withCurrent } from '../lib/salesEmails'
import { S, TierChip, TIERS, TIER_HINT, useMe, fmtDate, todayET } from '../lib/salesShared.jsx'
import { DiscoveryForm, MEETING_STATUS } from './SalesDiscovery'

const CLOSED = ['won', 'lost', 'email_unreachable']
const STAGE_TITLE = {
  ...Object.fromEntries(SALES_STAGES.map(s => [s.key, s.title])),
  won: 'Won', lost: 'Lost', email_unreachable: 'Email Unreachable',
}
const BOOKED_OR_LATER = ['discovery_call', 'proposal_sent', 'negotiations', 'contract_sent', 'contract_signed', 'won']

const COLS = 'id, organization, contact_person, contact_title, contact_email, contact_phone, phone_type, company_phone, website, ' +
  'industry, service_fit, tier, lead_source, potential_services, known_problem, social_profiles, hiring_activity, office_hours, ' +
  'after_hours_coverage, online_booking, crm_tools, locations, growth_indicators, review_signals, call_hypothesis, research_notes, ' +
  'research_status, researched_by_name, researched_at, status, owner_id, owner_name, next_activity, notes, booked_by_id, booked_by_name, ' +
  'meeting_at, meeting_outcome, meeting_qualified, value, monthly_hours, updated_at, created_at'

// Research fields shown on the record, in reading order. `long` = textarea.
const CONTACT_FIELDS = [
  ['contact_person', 'Contact name'], ['contact_title', 'Title'], ['contact_phone', 'Phone'], ['phone_type', 'Phone type'],
  ['contact_email', 'Email'], ['company_phone', 'Company phone'], ['website', 'Website'],
]
const COMPANY_FIELDS = [
  ['potential_services', 'Potential service', true], ['known_problem', 'Known problem / opportunity', true],
  ['office_hours', 'Office hours', true], ['after_hours_coverage', 'After-hours coverage?', true],
  ['online_booking', 'Online booking?', true], ['hiring_activity', 'Hiring activity', true],
  ['locations', '# of locations', true], ['growth_indicators', 'Growth indicators', true],
  ['crm_tools', 'Existing CRM / tools', true], ['review_signals', 'Reviews re: communication problems', true],
  ['social_profiles', 'Social profiles', true], ['lead_source', 'Lead source'],
]
const CALL_OUTCOMES = ['Left voicemail', 'No answer', 'Decision maker unavailable', 'Callback requested', 'Spoke — interested',
  'Spoke — not interested', 'Info requested', 'Follow-up required', 'Working with competitor', 'Bad number']

// Maps a raw Five9 disposition (from f9_calls_archive, Turritopsis Consulting
// campaign) to the closest matching entry in CALL_OUTCOMES above, for
// auto-suggesting the outcome dropdown. A few of these are judgment calls,
// not exact equivalents (Five9 has no "spoke, interested" concept, for
// example) -- that's exactly why the raw disposition is still shown
// alongside the suggestion rather than silently swapped in. Anything not
// listed here (the excluded/administrative dispositions, or a genuinely new
// one Five9 starts using) returns null and leaves the dropdown at its
// ordinary default instead of guessing.
const FIVE9_TO_OUTCOME = {
  'no answer': 'No answer',
  'busy': 'No answer',
  'left voicemail': 'Left voicemail',
  'voicemail - no message left': 'Left voicemail',
  'bad number': 'Bad number',
  'call back': 'Callback requested',
  'decision maker unavailable': 'Decision maker unavailable',
  'not interested': 'Spoke — not interested',
  'not viable': 'Spoke — not interested',
  'working with competitor': 'Working with competitor',
  'info requested': 'Info requested',
  'information requested': 'Info requested',
  'follow-up required': 'Follow-up required',
  'follow up required': 'Follow-up required',
  'booked': 'Spoke — interested',
}
function mapFive9Disposition(raw) {
  return FIVE9_TO_OUTCOME[String(raw || '').trim().toLowerCase()] || null
}

const quiet = v => !v || /^not publicly verified/i.test(String(v).trim())

export default function SalesProspects() {
  const me = useMe()
  const { verticals } = useSalesLists()
  const [deals, setDeals] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [f, setF] = useState({ q: '', tiers: [], industry: '', stage: 'open', owner: 'all', research: '' })

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('deals').select(COLS).eq('pipeline', 'sales')
    if (error) { setErr(error.message); setDeals([]); return }
    setDeals(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const patchLocal = (id, patch) => setDeals(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d))

  const industries = useMemo(() => [...new Set((deals || []).map(d => d.industry).filter(Boolean))].sort(), [deals])

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const t = todayET()
    return (deals || []).filter(d => {
      if (f.tiers.length && !f.tiers.includes(d.tier || '—')) return false
      if (f.industry && d.industry !== f.industry) return false
      if (f.stage === 'open' && CLOSED.includes(d.status)) return false
      if (f.stage === 'due' && (!d.next_activity || d.next_activity > t || CLOSED.includes(d.status))) return false
      if (f.stage && !['open', 'all', 'due'].includes(f.stage) && d.status !== f.stage) return false
      if (f.owner === 'mine' && d.owner_id !== me?.id) return false
      if (f.owner === 'unassigned' && d.owner_id) return false
      if (f.research === 'needs' && d.researched_at) return false
      if (f.research === 'done' && !d.researched_at) return false
      if (!q) return true
      return [d.organization, d.contact_person, d.contact_email, d.contact_phone, d.company_phone, d.website, d.potential_services]
        .some(v => String(v || '').toLowerCase().includes(q))
    }).sort((a, b) =>
      (TIERS.indexOf(a.tier) + 1 || 9) - (TIERS.indexOf(b.tier) + 1 || 9) ||
      String(a.next_activity || '9999').localeCompare(String(b.next_activity || '9999')) ||
      String(a.organization || '').localeCompare(String(b.organization || '')))
  }, [deals, f, me?.id])

  if (!deals) return <p className="page-sub" style={{ padding: 20 }}>Loading prospects…</p>
  const open = deals.find(d => d.id === openId)
  const due = deals.filter(d => d.next_activity && d.next_activity <= todayET() && !CLOSED.includes(d.status)).length
  const toggleTier = t => setF(x => ({ ...x, tiers: x.tiers.includes(t) ? x.tiers.filter(y => y !== t) : [...x.tiers, t] }))

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h1 style={S.h1}>Prospects</h1>
          <p className="page-sub" style={S.sub}>
            {shown.length.toLocaleString()} of {deals.length.toLocaleString()} shown · {deals.filter(d => d.tier === 'A' && !CLOSED.includes(d.status)).length} open A-tier · {due} follow-up{due === 1 ? '' : 's'} due
          </p>
        </div>
      </div>
      {err && <div style={S.err}>{err}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input id="pros-search" placeholder="Search company, contact, phone, email…" value={f.q}
          onChange={e => setF(x => ({ ...x, q: e.target.value }))} style={{ ...S.input, flex: '1 1 220px', width: 'auto' }} />
        <div style={{ display: 'inline-flex', gap: 4 }} aria-label="Tier filter">
          {TIERS.map(t => (
            <button key={t} title={TIER_HINT[t]} onClick={() => toggleTier(t)}
              style={{ ...S.btn, padding: '6px 10px', background: f.tiers.includes(t) ? 'var(--accent)' : 'var(--surface)', color: f.tiers.includes(t) ? '#fff' : 'var(--ink)' }}>{t}</button>
          ))}
        </div>
        <select id="pros-industry" value={f.industry} onChange={e => setF(x => ({ ...x, industry: e.target.value }))} style={{ ...S.input, width: 'auto' }}>
          <option value="">All industries</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <select id="pros-stage" value={f.stage} onChange={e => setF(x => ({ ...x, stage: e.target.value }))} style={{ ...S.input, width: 'auto' }}>
          <option value="open">All open</option>
          <option value="due">Follow-up due</option>
          <option value="all">Everything (incl. closed)</option>
          {SALES_STAGES.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}
          <option value="won">Won</option><option value="lost">Lost</option><option value="email_unreachable">Email Unreachable</option>
        </select>
        <select id="pros-owner" value={f.owner} onChange={e => setF(x => ({ ...x, owner: e.target.value }))} style={{ ...S.input, width: 'auto' }}>
          <option value="all">Any owner</option><option value="mine">Mine</option><option value="unassigned">Unassigned</option>
        </select>
        <select id="pros-research" value={f.research} onChange={e => setF(x => ({ ...x, research: e.target.value }))} style={{ ...S.input, width: 'auto' }}>
          <option value="">Any research</option><option value="needs">Needs research</option><option value="done">Researched</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: open ? 'minmax(0, 1fr) minmax(0, 1.25fr)' : '1fr', gap: 12, alignItems: 'start' }} className="sales-prospects-grid">
        <div style={{ ...S.card, padding: 4, maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}><tr>
              <th style={S.th}>Tier</th><th style={S.th}>Company</th>{!open && <th style={S.th}>Contact</th>}
              {!open && <th style={S.th}>Industry</th>}<th style={S.th}>Stage</th><th style={S.th}>Next</th>{!open && <th style={S.th}>Owner</th>}
            </tr></thead>
            <tbody>
              {shown.slice(0, 400).map(d => (
                <tr key={d.id} onClick={() => setOpenId(d.id === openId ? null : d.id)}
                  style={{ cursor: 'pointer', background: d.id === openId ? 'var(--accent-bg, #e5f1f8)' : undefined }}>
                  <td style={S.td}><TierChip tier={d.tier} /></td>
                  <td style={{ ...S.td, fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.organization || '—'}{!d.researched_at && <span title="Needs research" style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#a15c00' }}>RESEARCH</span>}
                  </td>
                  {!open && <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.contact_person || '—'}</td>}
                  {!open && <td style={{ ...S.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ink-soft)' }}>{d.industry || '—'}</td>}
                  <td style={{ ...S.td, color: 'var(--ink-soft)' }}>{STAGE_TITLE[d.status] || d.status}</td>
                  <td style={{ ...S.td, color: d.next_activity && d.next_activity <= todayET() ? '#c0392b' : 'var(--ink-soft)' }}>{d.next_activity ? fmtDate(d.next_activity) : '—'}</td>
                  {!open && <td style={{ ...S.td, color: 'var(--ink-soft)' }}>{d.owner_name || '—'}</td>}
                </tr>
              ))}
              {shown.length === 0 && <tr><td style={S.td} colSpan={7}>No prospects match these filters.</td></tr>}
            </tbody>
          </table>
          {shown.length > 400 && <p className="page-sub" style={{ padding: '8px 10px', fontSize: 12.5 }}>Showing the first 400 — narrow the filters to see the rest.</p>}
        </div>

        {open && (
          <ProspectRecord key={open.id} deal={open} me={me} verticals={verticals}
            onClose={() => setOpenId(null)}
            onChanged={patch => patchLocal(open.id, patch)} />
        )}
      </div>
      <style>{`@media (max-width: 900px){ .sales-prospects-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

function ProspectRecord({ deal, me, verticals, onClose, onChanged }) {
  const [tab, setTab] = useState('research')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(deal)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [history, setHistory] = useState(null)
  const [notes, setNotes] = useState(null)
  const [discEdit, setDiscEdit] = useState(null) // note object, {} for new
  const [log, setLog] = useState({ outcome: CALL_OUTCOMES[0], body: '', next: deal.next_activity || '' })
  const [booking, setBooking] = useState(false)
  const [meetAt, setMeetAt] = useState('')
  const [meetWith, setMeetWith] = useState('')
  const [slots, setSlots] = useState(null) // null = not loaded, [] = loaded/empty
  const [slotsErr, setSlotsErr] = useState('')
  // Suggests the Call Outcome from Kerri's actual, already-dispositioned Five9
  // call, so she isn't re-picking the same outcome twice -- Five9 already
  // counts the real disposition toward the scorecard; this is purely to save
  // her a redundant click here. She can always change it; nothing is hidden,
  // the raw Five9 disposition is shown right under the dropdown.
  const [suggested, setSuggested] = useState(null) // { disposition, work_date } | null
  useEffect(() => {
    let active = true
    if (!deal.contact_phone) return
    supabase.rpc('sales_last_call_outcome', { p_phone: deal.contact_phone }).then(({ data, error }) => {
      if (!active || error || !data || !data.length) return
      const row = data[0]
      const mapped = mapFive9Disposition(row.disposition)
      setSuggested({ disposition: row.disposition, work_date: row.work_date })
      if (mapped) setLog(x => ({ ...x, outcome: mapped }))
    })
    return () => { active = false }
  }, [deal.id, deal.contact_phone])

  const loadHistory = useCallback(async () => {
    const [a, e, n] = await Promise.all([
      supabase.from('deal_activities').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('deal_stage_events').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('deal_discovery_notes').select('*').eq('deal_id', deal.id).order('session_date', { ascending: false, nullsFirst: false }),
    ])
    const items = [
      ...(a.data || []).map(x => ({ at: x.created_at, who: x.actor_name, what: [x.kind === 'call' ? 'Call' : x.kind[0].toUpperCase() + x.kind.slice(1), x.outcome, x.subject].filter(Boolean).join(' · '), body: x.body })),
      ...(e.data || []).map(x => ({ at: x.created_at, who: null, what: `Moved to ${STAGE_TITLE[x.to_status] || x.to_status}`, body: x.note })),
    ].sort((p, q) => q.at.localeCompare(p.at))
    setHistory(items); setNotes(n.data || [])
  }, [deal.id])
  useEffect(() => { loadHistory() }, [loadHistory])

  async function update(patch, okMsg) {
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.from('deals').update(patch).eq('id', deal.id)
    setBusy(false)
    if (error) { setErr(error.message); return false }
    onChanged(patch); if (okMsg) setMsg(okMsg)
    return true
  }

  async function saveEdits() {
    const keys = ['tier', 'industry', 'call_hypothesis', 'research_notes', ...CONTACT_FIELDS.map(c => c[0]), ...COMPANY_FIELDS.map(c => c[0])]
    const patch = {}
    for (const k of keys) {
      const v = typeof form[k] === 'string' ? form[k].trim() : form[k]
      const nv = v === '' ? null : v
      if ((deal[k] ?? null) !== nv) patch[k] = nv
    }
    if (!Object.keys(patch).length) { setEditing(false); return }
    if (await update(patch, 'Saved.')) setEditing(false)
  }

  async function markResearched() {
    await update({
      research_status: 'Researched', researched_at: new Date().toISOString(),
      researched_by_id: me?.id || null, researched_by_name: me?.full_name || null,
    }, 'Marked as researched.')
  }

  async function logCall(kind) {
    setBusy(true); setErr(''); setMsg('')
    const row = kind === 'note'
      ? { deal_id: deal.id, kind: 'note', body: log.body.trim(), actor_id: me?.id || null, actor_name: me?.full_name || null }
      : { deal_id: deal.id, kind: 'call', direction: 'outbound', outcome: log.outcome, body: log.body.trim() || null, actor_id: me?.id || null, actor_name: me?.full_name || null }
    if (kind === 'note' && !row.body) { setBusy(false); setErr('Write the note first.'); return }
    const { error } = await supabase.from('deal_activities').insert(row)
    if (error) { setBusy(false); setErr(error.message); return }
    if ((log.next || null) !== (deal.next_activity || null)) {
      await supabase.from('deals').update({ next_activity: log.next || null }).eq('id', deal.id)
      onChanged({ next_activity: log.next || null })
    }
    setBusy(false)
    setLog(x => ({ ...x, body: '' }))
    setMsg(kind === 'note' ? 'Note added.' : 'Call logged.')
    loadHistory()
  }

  // Real open slots, checked against Corinne's and Becky's actual synced
  // calendars (Corinne first) -- loaded fresh each time the booking panel
  // opens, so a slot someone just took elsewhere never gets shown stale.
  async function loadSlots() {
    setSlots(null); setSlotsErr('')
    const { data, error } = await supabase.rpc('sales_available_meeting_slots', { p_days: 10 })
    if (error) { setSlotsErr(error.message); setSlots([]); return }
    setSlots(data || [])
  }

  async function bookMeeting() {
    if (!meetAt) { setErr('Pick an available time.'); return }
    const patch = {
      meeting_at: new Date(meetAt).toISOString(),
      meeting_outcome: deal.meeting_outcome && deal.meeting_outcome !== 'scheduled' ? deal.meeting_outcome : 'scheduled',
    }
    if (!deal.booked_by_id) { patch.booked_by_id = me?.id || null; patch.booked_by_name = me?.full_name || null }
    const moving = !BOOKED_OR_LATER.includes(deal.status)
    if (moving) patch.status = 'discovery_call'
    const ok = await update(patch, `Meeting booked with ${meetWith || 'the team'}.`)
    if (!ok) return
    if (moving) {
      await supabase.from('deal_stage_events').insert({ deal_id: deal.id, from_status: deal.status, to_status: 'discovery_call', actor_id: me?.id || null, note: 'Booked from Prospects' })
    }
    await supabase.from('deal_activities').insert({
      deal_id: deal.id, kind: 'meeting', subject: 'Discovery meeting booked',
      body: `${new Date(meetAt).toLocaleString()}${meetWith ? ` with ${meetWith}` : ''}`,
      actor_id: me?.id || null, actor_name: me?.full_name || null,
    })
    setBooking(false); loadHistory()
  }

  const inputFor = (k, long) => long
    ? <textarea id={`pros-${k}`} rows={2} value={form[k] || ''} onChange={e => setForm(x => ({ ...x, [k]: e.target.value }))} style={{ ...S.input, resize: 'vertical' }} />
    : <input id={`pros-${k}`} value={form[k] || ''} onChange={e => setForm(x => ({ ...x, [k]: e.target.value }))} style={S.input} />

  const tabBtn = (k, label) => (
    <button key={k} onClick={() => setTab(k)}
      style={{ border: 0, background: tab === k ? 'var(--accent-bg, #e5f1f8)' : 'transparent', color: tab === k ? 'var(--accent)' : 'var(--ink-soft)', fontWeight: 700, fontSize: 13, padding: '6px 11px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>
      {label}
    </button>
  )

  return (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, overflowWrap: 'anywhere' }}>{deal.organization}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4, fontSize: 12.5, color: 'var(--ink-soft)' }}>
            <TierChip tier={deal.tier} />
            <span>{STAGE_TITLE[deal.status] || deal.status}</span>
            <span>· {deal.industry || 'No industry'}</span>
            <span>· Owner: {deal.owner_name || 'Unassigned'}</span>
            {deal.researched_at
              ? <span>· Researched {fmtDate(deal.researched_at)}{deal.researched_by_name ? ` by ${deal.researched_by_name}` : ''}</span>
              : <span style={{ color: '#a15c00', fontWeight: 700 }}>· Needs research</span>}
          </div>
        </div>
        <button style={S.btn} onClick={onClose} aria-label="Close record">✕</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!deal.owner_id && me && <button style={S.btn} disabled={busy} onClick={() => update({ owner_id: me.id, owner_name: me.full_name }, 'Assigned to you.')}>Assign to me</button>}
        {!deal.researched_at && <button style={S.btn} disabled={busy} onClick={markResearched}>Mark researched</button>}
        <button style={S.btnPri} disabled={busy} onClick={() => { const opening = !booking; setBooking(opening); setErr(''); if (opening && !slots) loadSlots() }}>Book meeting</button>
      </div>
      {booking && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 260 }}>
            <span style={S.label}>Discovery meeting — real open slot</span>
            {slotsErr ? <span style={{ fontSize: 12.5, color: 'var(--failed, #c0392b)' }}>Couldn't load calendars: {slotsErr}</span> : !slots ? (
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Checking Corinne's and Becky's calendars…</span>
            ) : slots.length === 0 ? (
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No open 30-min slots in the next two weeks.</span>
            ) : (
              <select id="pros-meet-at" value={meetAt} style={S.input}
                onChange={e => {
                  const s = slots[Number(e.target.value)]
                  if (!s) { setMeetAt(''); setMeetWith(''); return }
                  setMeetAt(etToIso(s.slot_date, s.slot_start.slice(0, 5))); setMeetWith(s.with_name)
                }}>
                <option value="">Pick a time…</option>
                {slots.map((s, i) => (
                  <option key={i} value={i}>
                    {fmtDate(s.slot_date, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(s.slot_start)} — {s.with_name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <button style={S.btnPri} disabled={busy || !meetAt} onClick={bookMeeting}>Confirm booking</button>
          <span style={{ fontSize: 12, color: 'var(--ink-soft)', flexBasis: '100%' }}>
            {BOOKED_OR_LATER.includes(deal.status) ? 'Updates the meeting time.' : 'Moves this prospect to Discovery Call Scheduled.'}
            {deal.booked_by_name ? ` Booked by ${deal.booked_by_name}.` : ' You will be recorded as the booker.'}
            {' '}Corinne is checked first; Becky is offered only where Corinne's calendar already has something.
          </span>
        </div>
      )}
      {err && <div style={{ ...S.err, margin: 0 }}>{err}</div>}
      {msg && <div style={{ fontSize: 12.5, color: '#1f8a53', fontWeight: 700 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
        {tabBtn('research', 'Research')}{tabBtn('log', 'Log & activity')}{tabBtn('discovery', `Discovery${notes?.length ? ` (${notes.length})` : ''}`)}
      </div>

      {tab === 'research' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!editing && (deal.call_hypothesis
            ? <div style={{ background: 'var(--accent-bg, #e5f1f8)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5 }}><b>Call hypothesis:</b> {deal.call_hypothesis}</div>
            : <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No call hypothesis yet.</div>)}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {editing
              ? <><button style={S.btn} onClick={() => { setForm(deal); setEditing(false) }}>Cancel</button><button style={S.btnPri} disabled={busy} onClick={saveEdits}>{busy ? 'Saving…' : 'Save'}</button></>
              : <button style={S.btn} onClick={() => { setForm(deal); setEditing(true) }}>Edit research</button>}
          </div>

          {editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={S.label}>Tier</span>
                <select id="pros-tier" value={form.tier || ''} onChange={e => setForm(x => ({ ...x, tier: e.target.value }))} style={S.input}>
                  <option value="">No tier</option>{TIERS.map(t => <option key={t} value={t}>{t} — {TIER_HINT[t]}</option>)}
                </select></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={S.label}>Industry</span>
                <select id="pros-industry-edit" value={form.industry || ''} onChange={e => setForm(x => ({ ...x, industry: e.target.value }))} style={S.input}>
                  <option value="">Not set</option>{withCurrent(verticals, form.industry).map(v => <option key={v} value={v}>{v}</option>)}
                </select></label>
              {CONTACT_FIELDS.map(([k, label]) => <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={S.label}>{label}</span>{inputFor(k)}</label>)}
              {COMPANY_FIELDS.map(([k, label, long]) => <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={S.label}>{label}</span>{inputFor(k, long)}</label>)}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}><span style={S.label}>Call hypothesis</span>{inputFor('call_hypothesis', true)}</label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}><span style={S.label}>Research notes</span>{inputFor('research_notes', true)}</label>
            </div>
          ) : (
            <>
              <section>
                <h3 style={{ ...S.label, margin: '0 0 6px' }}>Contact</h3>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px', margin: 0, fontSize: 13.5 }}>
                  {CONTACT_FIELDS.map(([k, label]) => (
                    <FragmentKV key={k} label={label} value={deal[k]} link={k === 'website' ? normalizeUrl(deal[k]) : null} />
                  ))}
                </dl>
              </section>
              <section>
                <h3 style={{ ...S.label, margin: '0 0 6px' }}>Company research</h3>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px', margin: 0, fontSize: 13.5 }}>
                  {COMPANY_FIELDS.map(([k, label]) => <FragmentKV key={k} label={label} value={deal[k]} />)}
                </dl>
              </section>
              {deal.research_notes && (
                <section>
                  <h3 style={{ ...S.label, margin: '0 0 6px' }}>Research notes</h3>
                  <p style={{ margin: 0, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{deal.research_notes}</p>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'log' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={S.label}>Call outcome</span>
              <select id="pros-outcome" value={log.outcome} onChange={e => setLog(x => ({ ...x, outcome: e.target.value }))} style={S.input}>
                {CALL_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {suggested && (
                <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                  Suggested from her last Five9 call ({fmtDate(suggested.work_date)}): <b>{suggested.disposition}</b>
                </span>
              )}</label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={S.label}>Next follow-up</span>
              <input id="pros-next" type="date" value={log.next || ''} onChange={e => setLog(x => ({ ...x, next: e.target.value }))} style={S.input} /></label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={S.label}>Notes</span>
            <textarea id="pros-log-body" rows={3} value={log.body} onChange={e => setLog(x => ({ ...x, body: e.target.value }))} style={{ ...S.input, resize: 'vertical' }}
              placeholder="Who you spoke to, what they said, what happens next…" /></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={S.btn} disabled={busy} onClick={() => logCall('note')}>Add note only</button>
            <button style={S.btnPri} disabled={busy} onClick={() => logCall('call')}>Log call</button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0 }}>
            Five9 already counts your dials and dispositions for the scorecard, and now suggests the outcome above too — logging here keeps the story of this prospect in one place.
          </p>
          <div>
            <h3 style={{ ...S.label, margin: '4px 0 8px' }}>History</h3>
            {!history ? <p className="page-sub">Loading…</p> : history.length === 0 ? <p className="page-sub" style={{ fontSize: 13 }}>Nothing logged yet.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map((h, i) => (
                  <li key={i} style={{ borderLeft: '3px solid var(--line)', paddingLeft: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{h.what}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{new Date(h.at).toLocaleString()}{h.who ? ` · ${h.who}` : ''}</div>
                    {h.body && <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 2 }}>{h.body}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'discovery' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {deal.booked_by_name || deal.meeting_at ? (
            <div style={{ fontSize: 13, background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 11px' }}>
              Meeting {deal.meeting_at ? new Date(deal.meeting_at).toLocaleString() : '(no time set)'} · booked by {deal.booked_by_name || '—'} ·
              {' '}{MEETING_STATUS.find(m => m.deal === deal.meeting_outcome)?.label || 'No outcome yet'}
              {deal.meeting_qualified === true ? ' · Qualified' : deal.meeting_qualified === false ? ' · Not qualified' : ''}
            </div>
          ) : <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>No meeting booked yet — use <b>Book meeting</b> above.</p>}

          {discEdit ? (
            <DiscoveryForm deal={deal} note={discEdit.id ? discEdit : null} onCancel={() => setDiscEdit(null)}
              onSaved={(_n, dealPatch) => { setDiscEdit(null); if (dealPatch && Object.keys(dealPatch).length) onChanged(dealPatch); loadHistory() }} />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button style={S.btnPri} onClick={() => setDiscEdit({})}>＋ New discovery session</button>
              </div>
              {(notes || []).length === 0 ? <p className="page-sub" style={{ fontSize: 13 }}>No discovery sessions recorded.</p> : notes.map(n => (
                <button key={n.id} onClick={() => setDiscEdit(n)}
                  style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtDate(n.session_date)} · {MEETING_STATUS.find(m => m.key === n.meeting_status)?.label || 'No status'}{n.qualified === true ? ' · Qualified' : ''}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>{n.q1_problem || 'No problem statement'}{n.next_step ? ` — Next: ${n.next_step}` : ''}</div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FragmentKV({ label, value, link }) {
  const empty = !value || !String(value).trim()
  return (
    <>
      <dt style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{label}</dt>
      <dd style={{ margin: 0, overflowWrap: 'anywhere', color: empty || quiet(value) ? 'var(--ink-soft)' : 'var(--ink)' }}>
        {empty ? '—' : link ? <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{value}</a> : value}
      </dd>
    </>
  )
}

function normalizeUrl(v) {
  if (!v) return null
  const s = String(v).trim()
  return /^https?:\/\//i.test(s) ? s : 'https://' + s
}

// Converts a wall-clock date+time that's meant as America/New_York local time
// into the correct UTC ISO instant, regardless of what timezone the browser
// viewing this page is actually set to (the slots themselves are computed
// server-side in ET; this just has to land on the same real moment in time).
function etToIso(dateStr, timeStr) {
  const [y, mo, da] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  let guess = new Date(Date.UTC(y, mo - 1, da, h, mi))
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(guess)
    const get = t => Number(parts.find(p => p.type === t).value)
    const seenUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'))
    guess = new Date(guess.getTime() + (Date.UTC(y, mo - 1, da, h, mi) - seenUTC))
  }
  return guess.toISOString()
}

// Formats a plain "HH:MM:SS" time-of-day string (as returned by the slots
// RPC) as "9:00 AM" -- these are already wall-clock ET, so this is pure
// string formatting, no timezone conversion involved.
function fmtTime(hms) {
  const [h, m] = hms.split(':').map(Number)
  const ap = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}
