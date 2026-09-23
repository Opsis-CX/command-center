// ============================================================================
//  DISCOVERY NOTES — the 14 questions from the sales sprint plan, one row per
//  discovery session (`deal_discovery_notes`), attached to the prospect.
//
//  Saving a session also writes its meeting status and "qualified" answer onto
//  the deal (meeting_outcome / meeting_qualified), because that is what the
//  Sprint Scorecard counts and what the $15 bonus is paid on.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { S, TierChip, useMe, todayET, fmtDate, fmtMoney } from '../lib/salesShared.jsx'

export const DISCOVERY_QUESTIONS = [
  { key: 'q1_problem', label: 'Q1 · Problem to solve' },
  { key: 'q2_today', label: 'Q2 · What happens today' },
  { key: 'q3_broken', label: "Q3 · What's broken / inefficient" },
  { key: 'q4_volume', label: 'Q4 · Volume' },
  { key: 'q5_resources', label: 'Q5 · Internal resources today' },
  { key: 'q6_cost', label: 'Q6 · Cost today' },
  { key: 'q7_coverage_gaps', label: 'Q7 · After-hours / overflow / PTO gaps' },
  { key: 'q8_systems', label: 'Q8 · Systems involved' },
  { key: 'q9_impact', label: 'Q9 · Financial / operational impact' },
  { key: 'q10_success', label: 'Q10 · Definition of success' },
  { key: 'q11_decision_maker', label: 'Q11 · Decision maker' },
  { key: 'q12_timeline', label: 'Q12 · Timeline' },
  { key: 'q13_solution', label: 'Q13 · Recommended Opsis solution' },
  { key: 'q14_opportunity', label: 'Q14 · Opportunity size' },
]
export const MEETING_STATUS = [
  { key: 'scheduled', label: 'Scheduled', deal: 'scheduled' },
  { key: 'held', label: 'Held', deal: 'showed' },
  { key: 'no_show', label: 'No-show', deal: 'no_show' },
  { key: 'rescheduled', label: 'Rescheduled', deal: 'rescheduled' },
  { key: 'cancelled', label: 'Cancelled', deal: 'cancelled' },
]
const STATUS_LABEL = Object.fromEntries(MEETING_STATUS.map(m => [m.key, m.label]))

/** Create or edit one discovery session for a deal. */
export function DiscoveryForm({ deal, note, onSaved, onCancel }) {
  const me = useMe()
  const [f, setF] = useState(() => note ? { ...note } : { session_date: todayET(), meeting_status: 'held', qualified: null })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const row = {
      deal_id: deal.id,
      session_date: f.session_date || null,
      owner_id: f.owner_id || me?.id || null,
      owner_name: f.owner_name || me?.full_name || null,
      ...Object.fromEntries(DISCOVERY_QUESTIONS.map(q => [q.key, (f[q.key] || '').trim() || null])),
      opportunity_value: f.opportunity_value === '' || f.opportunity_value == null ? null : Number(f.opportunity_value),
      next_step: (f.next_step || '').trim() || null,
      next_step_date: f.next_step_date || null,
      notes: (f.notes || '').trim() || null,
      meeting_status: f.meeting_status || null,
      qualified: f.qualified === '' ? null : f.qualified,
    }
    const res = note?.id
      ? await supabase.from('deal_discovery_notes').update(row).eq('id', note.id).select().single()
      : await supabase.from('deal_discovery_notes').insert({ ...row, created_by: me?.id || null }).select().single()
    if (res.error) { setBusy(false); setErr(res.error.message); return }

    // Keep the deal's meeting fields in step — the scorecard and bonus read them.
    const ms = MEETING_STATUS.find(m => m.key === row.meeting_status)
    const dealPatch = {}
    if (ms) dealPatch.meeting_outcome = ms.deal
    if (row.qualified !== null) dealPatch.meeting_qualified = row.qualified
    if (row.next_step_date) dealPatch.next_activity = row.next_step_date
    if (Object.keys(dealPatch).length) {
      const { error } = await supabase.from('deals').update(dealPatch).eq('id', deal.id)
      if (error) { setBusy(false); setErr('Notes saved, but the meeting status could not be written to the prospect: ' + error.message); return }
    }
    await supabase.from('deal_activities').insert({
      deal_id: deal.id, kind: 'meeting', actor_id: me?.id || null, actor_name: me?.full_name || null,
      subject: note?.id ? 'Discovery notes updated' : 'Discovery notes added',
      body: [ms ? `Meeting: ${ms.label}` : null, row.qualified === true ? 'Qualified' : row.qualified === false ? 'Not qualified' : null, row.next_step ? `Next: ${row.next_step}` : null].filter(Boolean).join(' · ') || null,
    })
    setBusy(false)
    onSaved(res.data, dealPatch)
  }

  const area = (key, label, rows = 2) => (
    <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={S.label}>{label}</span>
      <textarea id={`disc-${key}`} rows={rows} value={f[key] || ''} onChange={set(key)} style={{ ...S.input, resize: 'vertical' }} />
    </label>
  )

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {err && <div style={{ ...S.err, margin: 0 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Session date</span>
          <input id="disc-date" type="date" value={f.session_date || ''} onChange={set('session_date')} style={S.input} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Meeting</span>
          <select id="disc-status" value={f.meeting_status || ''} onChange={set('meeting_status')} style={S.input}>
            <option value="">Not set</option>
            {MEETING_STATUS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Qualified?</span>
          <select id="disc-qualified" value={f.qualified === true ? 'yes' : f.qualified === false ? 'no' : ''}
            onChange={e => setF(x => ({ ...x, qualified: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null }))} style={S.input}>
            <option value="">Not decided</option>
            <option value="yes">Yes — qualified</option>
            <option value="no">No</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Opportunity ($ / mo)</span>
          <input id="disc-value" type="number" step="0.01" value={f.opportunity_value ?? ''} onChange={set('opportunity_value')} style={S.input} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {DISCOVERY_QUESTIONS.map(q => area(q.key, q.label))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        {area('next_step', 'Next step', 1)}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Next step date</span>
          <input id="disc-next-date" type="date" value={f.next_step_date || ''} onChange={set('next_step_date')} style={S.input} />
        </label>
      </div>
      {area('notes', 'Additional notes', 3)}
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0 }}>
        A meeting marked <b>Held</b> and <b>Qualified</b> earns the sprint bonus for whoever booked it.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {onCancel && <button type="button" style={S.btn} onClick={onCancel}>Cancel</button>}
        <button type="submit" style={S.btnPri} disabled={busy}>{busy ? 'Saving…' : 'Save discovery notes'}</button>
      </div>
    </form>
  )
}

/** All discovery sessions, newest first — the sheet's Discovery Notes tab. */
export default function SalesDiscovery() {
  const [notes, setNotes] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('deal_discovery_notes')
      .select('*, deal:deals(id, organization, contact_person, tier, status, booked_by_name)')
      .order('session_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    if (error) { setErr(error.message); setNotes([]); return }
    setNotes(data || [])
  }
  useEffect(() => { load() }, [])

  const shown = useMemo(() => (notes || []).filter(n => {
    if (status === 'qualified' && n.qualified !== true) return false
    if (status && status !== 'qualified' && n.meeting_status !== status) return false
    if (!q.trim()) return true
    const hay = [n.deal?.organization, n.deal?.contact_person, n.owner_name, n.q1_problem, n.q13_solution, n.next_step].join(' ').toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  }), [notes, q, status])

  if (!notes) return <p className="page-sub" style={{ padding: 20 }}>Loading discovery notes…</p>

  const qualified = notes.filter(n => n.qualified === true).length
  const pipelineValue = notes.filter(n => n.qualified === true).reduce((s, n) => s + Number(n.opportunity_value || 0), 0)

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 style={S.h1}>Discovery Notes</h1>
          <p className="page-sub" style={S.sub}>
            {notes.length} session{notes.length === 1 ? '' : 's'} · {qualified} qualified · {fmtMoney(pipelineValue)}/mo qualified opportunity
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input id="disc-search" placeholder="Search company, contact, notes…" value={q} onChange={e => setQ(e.target.value)} style={{ ...S.input, width: 240 }} />
          <select id="disc-filter" value={status} onChange={e => setStatus(e.target.value)} style={{ ...S.input, width: 'auto' }}>
            <option value="">All sessions</option>
            <option value="qualified">Qualified only</option>
            {MEETING_STATUS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
      </div>
      {err && <div style={S.err}>{err}</div>}

      {notes.length === 0 ? (
        <div style={S.card}>
          <p style={{ margin: 0 }}>No discovery sessions yet. Open a prospect on the <b>Prospects</b> tab and use its <b>Discovery</b> section to record one.</p>
        </div>
      ) : (
        <div style={{ ...S.card, padding: '6px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                {['Date', 'Company', 'Tier', 'Owner', 'Meeting', 'Qualified', 'Problem', 'Solution', 'Opportunity', 'Next step'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {shown.map(n => (
                  <tr key={n.id} onClick={() => setOpen(n)} style={{ cursor: 'pointer' }}>
                    <td style={S.td}>{fmtDate(n.session_date)}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{n.deal?.organization || '—'}</td>
                    <td style={S.td}><TierChip tier={n.deal?.tier} /></td>
                    <td style={S.td}>{n.owner_name || '—'}</td>
                    <td style={S.td}>{STATUS_LABEL[n.meeting_status] || '—'}</td>
                    <td style={S.td}>{n.qualified === true ? <b style={{ color: '#1f8a53' }}>Yes</b> :n.qualified === false ? 'No' : '—'}</td>
                    <td style={{ ...S.td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.q1_problem || '—'}</td>
                    <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.q13_solution || '—'}</td>
                    <td style={{ ...S.td, ...S.num }}>{n.opportunity_value ? fmtMoney(n.opportunity_value) : (n.q14_opportunity || '—')}</td>
                    <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.next_step ? `${n.next_step}${n.next_step_date ? ` (${fmtDate(n.next_step_date)})` : ''}` : '—'}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td style={S.td} colSpan={10}>Nothing matches that search.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: 24, overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', color: 'var(--ink)', borderRadius: 14, width: 'min(900px, 100%)', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{open.deal?.organization} — discovery</h2>
              <button style={S.btn} onClick={() => setOpen(null)}>Close</button>
            </div>
            <DiscoveryForm deal={open.deal} note={open} onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); load() }} />
          </div>
        </div>
      )}
    </div>
  )
}
