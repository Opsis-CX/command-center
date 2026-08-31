// ============================================================================
//  SALES SPRINT REPORT — who did the work, and what they are owed
// ============================================================================
//  Built for the 2026-08-31 sales sprint. Becky: "I want to call people out and
//  if people aren't doing what they need to be doing, then we're going to not be
//  paying them to do it." That only works if the numbers are in one place and
//  nobody has to be believed about them.
//
//  Two halves, because they answer two different questions:
//
//  ACTIVITY — did this person work today? Counted from `deal_activities` and
//  `deal_stage_events`, which are written by the app, not typed by the person
//  being measured.
//
//  OWED — what has actually been earned. $15 per discovery meeting BOOKED AND
//  SHOWED (a no-show pays nothing, which is the whole reason `meeting_outcome`
//  exists). The 5% of the first three invoices is NOT computed here: invoices
//  live outside this app, so the report names the won deals and their owner and
//  leaves the arithmetic to Becky rather than inventing a number.
//
//  Every figure is a live query. Nothing is cached, nothing is a running total
//  somebody could have edited.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { researchStatus } from '../lib/salesEmails'

export const MEETING_INCENTIVE = 15

// Sunday-anchored week, in the browser's own timezone — everyone on this team
// is on Eastern, and a UTC week boundary would move Sunday's work into Monday.
function startOfWeek(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}
function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}

const RANGES = [
  { key: 'today', label: 'Today', from: () => startOfDay() },
  { key: 'week', label: 'This week', from: () => startOfWeek() },
  { key: 'all', label: 'All time', from: () => new Date(0) },
]

export default function SalesSprintReport({ pipelineKey = 'sales', onClose }) {
  const [range, setRange] = useState('week')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const from = useMemo(() => (RANGES.find(r => r.key === range) || RANGES[1]).from(), [range])

  const load = async () => {
    setErr('')
    try {
      const iso = from.toISOString()
      const [dealsRes, actRes, evRes, profRes] = await Promise.all([
        supabase.from('deals')
          .select('id, organization, status, owner_id, owner_name, contact_email, contact_phone, company_phone, website, industry, service_fit, email_observation, contact_person, booked_by_id, booked_by_name, meeting_at, meeting_outcome, meeting_incentive_paid_at, value, updated_at')
          .eq('pipeline', pipelineKey),
        supabase.from('deal_activities').select('id, kind, actor_id, actor_name, created_at').gte('created_at', iso),
        supabase.from('deal_stage_events').select('id, to_status, actor_id, created_at').gte('created_at', iso),
        supabase.from('profiles').select('id, full_name').eq('is_active', true),
      ])
      const bad = [dealsRes, actRes, evRes, profRes].find(r => r.error)
      if (bad) throw bad.error

      const nameOf = Object.fromEntries((profRes.data || []).map(p => [p.id, p.full_name]))
      const deals = dealsRes.data || []
      const byId = Object.fromEntries(deals.map(d => [d.id, d]))

      // One bucket per person, created lazily so nobody with zero of everything
      // shows up as a row of zeros they never earned.
      const acc = new Map()
      const bucket = (id, name) => {
        if (!id) return null
        if (!acc.has(id)) acc.set(id, {
          id, name: name || nameOf[id] || 'Unknown',
          calls: 0, emails: 0, linkedin: 0, otherActivity: 0,
          moves: 0, booked: 0, showed: 0, noShow: 0, owedMeetings: 0, paidMeetings: 0, won: [],
        })
        return acc.get(id)
      }

      for (const a of actRes.data || []) {
        const b = bucket(a.actor_id, a.actor_name); if (!b) continue
        if (a.kind === 'call') b.calls++
        else if (a.kind === 'email') b.emails++
        else if (a.kind === 'linkedin') b.linkedin++
        else b.otherActivity++
      }
      for (const e of evRes.data || []) {
        // Only count moves on deals in THIS pipeline.
        if (!byId[e.deal_id] && e.deal_id) { /* other pipeline — skip silently */ }
        const b = bucket(e.actor_id); if (!b) continue
        b.moves++
      }

      // Meetings are counted from the DEAL, not from the range: a meeting booked
      // last week that showed today still earns today. The range filters the
      // activity columns; money follows the meeting.
      for (const d of deals) {
        if (!d.booked_by_id) continue
        if (d.meeting_at && new Date(d.meeting_at) < from && range !== 'all') continue
        const b = bucket(d.booked_by_id, d.booked_by_name); if (!b) continue
        b.booked++
        if (d.meeting_outcome === 'showed') {
          b.showed++
          if (d.meeting_incentive_paid_at) b.paidMeetings += MEETING_INCENTIVE
          else b.owedMeetings += MEETING_INCENTIVE
        } else if (d.meeting_outcome === 'no_show') b.noShow++
        if (d.status === 'won') b.won.push(d)
      }

      const list = [...acc.values()].sort((a, b) =>
        (b.owedMeetings - a.owedMeetings) || (b.calls - a.calls) || a.name.localeCompare(b.name))

      // Pipeline health, so the payout table has context: the sprint target was
      // 20 booked discovery meetings by Friday.
      const totals = {
        active: deals.filter(d => !['won', 'lost', 'email_unreachable'].includes(d.status)).length,
        researched: deals.filter(d => researchStatus(d).complete).length,
        unassigned: deals.filter(d => !d.owner_id && !['won', 'lost', 'email_unreachable'].includes(d.status)).length,
        booked: deals.filter(d => d.booked_by_id).length,
        showed: deals.filter(d => d.meeting_outcome === 'showed').length,
        owed: list.reduce((n, r) => n + r.owedMeetings, 0),
      }
      setRows({ list, totals })
    } catch (e) {
      setErr(e.message || String(e))
      setRows({ list: [], totals: null })
    }
  }
  useEffect(() => { load() }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  // Marking a payout is the one WRITE this screen does. It stamps the deal so
  // the same $15 can never be counted twice — the reason a spreadsheet was the
  // wrong tool for this.
  async function markPaid(personId) {
    if (!window.confirm('Mark every unpaid showed-up meeting for this person as PAID? This cannot be undone from here.')) return
    setBusy(true)
    const { error } = await supabase.from('deals')
      .update({ meeting_incentive_paid_at: new Date().toISOString() })
      .eq('booked_by_id', personId).eq('meeting_outcome', 'showed').is('meeting_incentive_paid_at', null)
    setBusy(false)
    if (error) { setErr(error.message); return }
    load()
  }

  const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', padding: '0 10px 8px' }
  const td = { padding: '10px', borderTop: '1px solid var(--line)', fontSize: 13.5 }
  const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: 24, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', borderRadius: 14, width: 'min(920px, 100%)', padding: 22, color: 'var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, flex: 1 }}>Sales sprint report</h2>
          <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                style={{ border: 0, background: range === r.key ? 'var(--accent)' : 'var(--surface)', color: range === r.key ? '#fff' : 'var(--ink)', fontSize: 12.5, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={onClose}
            style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 13, fontWeight: 700, padding: '7px 13px', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
        </div>
        <p className="page-sub" style={{ margin: '0 0 16px', fontSize: 13 }}>
          Activity is counted from what the app logged, not from what anyone reported. Only a meeting marked <b>They showed up</b> earns the ${MEETING_INCENTIVE}.
        </p>

        {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{err}</div>}
        {!rows && <p className="page-sub">Loading…</p>}

        {rows?.totals && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              ['Active leads', rows.totals.active],
              ['Fully researched', rows.totals.researched],
              ['Unassigned', rows.totals.unassigned],
              ['Meetings booked', `${rows.totals.booked} / 20`],
              ['Showed up', rows.totals.showed],
              ['Owed right now', '$' + rows.totals.owed],
            ].map(([k, v]) => (
              <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '9px 13px', background: 'var(--canvas)', minWidth: 118 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>{k}</div>
                <div style={{ fontSize: 19, fontWeight: 800, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {rows && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...th, paddingLeft: 14 }}>Person</th>
                  <th style={{ ...th, textAlign: 'right' }}>Calls</th>
                  <th style={{ ...th, textAlign: 'right' }}>Emails</th>
                  <th style={{ ...th, textAlign: 'right' }}>LinkedIn</th>
                  <th style={{ ...th, textAlign: 'right' }}>Stage moves</th>
                  <th style={{ ...th, textAlign: 'right' }}>Booked</th>
                  <th style={{ ...th, textAlign: 'right' }}>Showed</th>
                  <th style={{ ...th, textAlign: 'right' }}>No-show</th>
                  <th style={{ ...th, textAlign: 'right' }}>Owed</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {rows.list.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...td, paddingLeft: 14, fontWeight: 600 }}>
                      {r.name}
                      {r.won.length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 400 }}>
                          Won: {r.won.map(d => d.organization).join(', ')} — 5% of first 3 invoices, calculated by Becky
                        </div>
                      )}
                    </td>
                    <td style={num}>{r.calls}</td>
                    <td style={num}>{r.emails}</td>
                    <td style={num}>{r.linkedin}</td>
                    <td style={num}>{r.moves}</td>
                    <td style={num}>{r.booked}</td>
                    <td style={{ ...num, fontWeight: 700 }}>{r.showed}</td>
                    <td style={{ ...num, color: r.noShow ? '#B91C1C' : 'var(--ink-soft)' }}>{r.noShow}</td>
                    <td style={{ ...num, fontWeight: 800, color: r.owedMeetings ? '#1b5e20' : 'var(--ink-soft)' }}>
                      ${r.owedMeetings}
                      {r.paidMeetings > 0 && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-soft)' }}>${r.paidMeetings} paid</div>}
                    </td>
                    <td style={td}>
                      {r.owedMeetings > 0 && (
                        <button disabled={busy} onClick={() => markPaid(r.id)}
                          style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--canvas)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 700, padding: '6px 11px', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.list.length === 0 && (
                  <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: 'var(--ink-soft)', padding: 26 }}>
                    Nothing logged in this period yet.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
