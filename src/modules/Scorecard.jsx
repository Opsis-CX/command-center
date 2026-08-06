import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'

// Google Calendar appointment schedule for 1:1 coaching sessions.
const COACHING_BOOKING_URL = 'https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ3P6W-GsPBWhYjGd6hZ0Tc-QZbGsL09mvQEIhQM7F-VyBeCtt4S4THBAJTMolouBe7YF1lfztrl'

// ============================================================
// SERVICE PERFORMANCE SCORECARD
// - Managers (asc/certification/marketing/admin) see the whole team.
// - Agents see only their own card (RLS-enforced).
// - Admins can add coaching notes.
// Data comes from the sc_* tables (seeded now, BigQuery-fed later);
// tier/rank/schedule-release are computed by the sc_scorecard view.
// ============================================================

// Who can see the WHOLE team's scorecards vs. only their own. Sourced from the
// permission matrix (view_all_scorecards = asc/certification/quality/marketing/admin).
// Everyone else — agents included — may only ever see their own card. This is also
// enforced server-side by the sc_scorecard view (can_view_all_scorecards()).
const canViewAll = (r) => can(r, 'service_performance_scorecard.view_all_scorecards')
const isAdmin = (r) => String(r || 'agent').trim().toLowerCase() === 'admin'
// Notes & Anecdotal Feedback is limited to ASC and admins (plus the agent
// viewing their own card). Certification/marketing managers can open the rest
// of a scorecard but must not see this section.
const canCoachNotes = (r) => ['asc', 'admin'].includes(String(r || '').trim().toLowerCase())

const pct = (v, dp = 1) => (v == null ? '—' : (v * 100).toFixed(dp) + '%')
const num = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp))
// ACW% and NR% are "higher = worse": color low (good) → high (bad).
const badColor = (v) => (v == null ? 'inherit' : v >= 0.20 ? '#b71c1c' : v >= 0.10 ? '#8d6e00' : '#1b5e20')
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const qaFilterInp = { padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }

const TIER_STYLE = {
  'Top Performer': { bg: '#e8f5e9', fg: '#1b5e20' },
  'High Performer': { bg: '#fff8e1', fg: '#8d6e00' },
  // Nesting: new agents without ranked data yet — sits between High and Developing.
  'Nesting': { bg: '#ede7f6', fg: '#4527a0' },
  'Developing Performer': { bg: '#e3f2fd', fg: '#0d47a1' },
  'Improvement Opportunity': { bg: '#fdecea', fg: '#b71c1c' },
}

export default function Scorecard() {
  const { appRole, user } = useAuth()
  const viewAll = canViewAll(appRole)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState(null)   // agent_name to view in detail

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    // Agents may only ever load their OWN row (also enforced by the sc_scorecard
    // view server-side); managers/admins load the whole team.
    let query = supabase.from('sc_scorecard').select('*')
    if (!viewAll) query = query.eq('profile_id', user?.id)
    const { data, error } = await query
    if (error) { setErr(error.message); setLoading(false); return }
    // sort: active by rank, then others
    const sorted = (data || []).slice().sort((a, b) => {
      if (a.agent_rank == null && b.agent_rank == null) return (a.agent_name || '').localeCompare(b.agent_name || '')
      if (a.agent_rank == null) return 1
      if (b.agent_rank == null) return -1
      return a.agent_rank - b.agent_rank
    })
    setRows(sorted)
    // Non-managers always land straight on their own card (never the team table).
    if (!viewAll) {
      const mine = sorted.find(r => r.profile_id === user?.id) || sorted[0] || null
      setSelected(mine ? mine.agent_name : null)
    }
    setLoading(false)
  }, [viewAll, user])
  useEffect(() => { load() }, [load])

  if (loading) return <div><h1 className="page-title">Service Performance Scorecard</h1><p className="page-sub">Loading…</p></div>
  if (err) return <div><h1 className="page-title">Service Performance Scorecard</h1><div className="card" style={{ borderColor: 'var(--failed)', marginTop: 16 }}><b style={{ color: 'var(--failed)' }}>Couldn't load.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div></div>

  if (selected) {
    const row = rows.find(r => r.agent_name === selected)
    const coach = canCoachNotes(appRole)
    const ownCard = row?.profile_id === user?.id
    return <AgentScorecard row={row} canCoach={coach} canSeeNotes={coach || ownCard} isOwn={ownCard} onBack={viewAll ? () => setSelected(null) : null} />
  }

  // Agents never see the team table. If their row isn't available yet, show an
  // empty own-state rather than falling through to the full-team view.
  if (!viewAll) {
    return (
      <div>
        <h1 className="page-title">Service Performance Scorecard</h1>
        <div className="card" style={{ marginTop: 16 }}>
          <p className="page-sub">Your scorecard isn't available yet. Once you've been scheduled and started taking calls, your personal scorecard will appear here.</p>
        </div>
      </div>
    )
  }

  // Manager team view
  return (
    <div>
      <h1 className="page-title">Service Performance Scorecard</h1>
      <p className="page-sub">Team performance — last 30 days. Ranked by weighted score (Conversion 30% · Quality 20% · ACW% 20% · Not Ready% 10% · Adherence 20%). ACW% and Not Ready% are measured against login time — higher is worse.</p>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 20 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 860 }}>
            <thead>
              <tr style={{ background: 'var(--canvas)', textAlign: 'left' }}>
                <Th>#</Th><Th>Agent</Th><Th>Tier</Th><Th right>Conversion</Th><Th right>Quality</Th><Th right>ACW%</Th><Th right>NR%</Th><Th right>Adherence</Th><Th right>Calls</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const ts = TIER_STYLE[r.performance_tier] || null
                return (
                  <tr key={r.agent_name} onClick={() => setSelected(r.agent_name)}
                    style={{ borderTop: '1px solid var(--line-soft)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--canvas)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <Td>{r.agent_rank ?? '—'}</Td>
                    <Td><span style={{ fontWeight: 600 }}>{r.agent_name}</span>{r.status !== 'Active' && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-soft)' }}>{r.status}</span>}</Td>
                    <Td>{r.performance_tier ? <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: ts?.bg, color: ts?.fg }}>{r.performance_tier}</span> : <span style={{ color: 'var(--ink-soft)' }}>—</span>}</Td>
                    <Td right>{pct(r.conversion_rate_last_30_days)}</Td>
                    <Td right>{pct(r.avg_clean_qa_score_last_30_days)}</Td>
                    <Td right><span style={{ color: badColor(r.acw_pct_last_30_days), fontWeight: 600 }}>{pct(r.acw_pct_last_30_days)}</span></Td>
                    <Td right><span style={{ color: badColor(r.nr_pct_last_30_days), fontWeight: 600 }}>{pct(r.nr_pct_last_30_days)}</span></Td>
                    <Td right>{pct(r.schedule_adherence_last_30_days)}</Td>
                    <Td right>{r.calls_handled_last_30_days ?? '—'}</Td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><Td>—</Td><Td>No scorecard data yet.</Td><Td /><Td /><Td /><Td /><Td /><Td /><Td /></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Th({ children, right }) {
  return <th style={{ padding: '11px 14px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, right }) {
  return <td style={{ padding: '11px 14px', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</td>
}

// ---------------- SINGLE AGENT SCORECARD ----------------
function AgentScorecard({ row, canCoach, canSeeNotes, isOwn, onBack }) {
  const [notes, setNotes] = useState([])
  const [loadingNotes, setLoadingNotes] = useState(true)
  const [qaAudits, setQaAudits] = useState([])
  const [aiAudits, setAiAudits] = useState([])
  const [subItemLabels, setSubItemLabels] = useState({})
  const [meetings, setMeetings] = useState([])
  const [loadingMtg, setLoadingMtg] = useState(true)

  // Quality Feedback: read-acknowledgment + search + "show only last 2"
  const agentId = row?.profile_id
  const [reads, setReads] = useState(new Set())   // audit_ids this agent has marked read
  const [kw, setKw] = useState('')
  const [dFrom, setDFrom] = useState('')
  const [dTo, setDTo] = useState('')
  const [showAllQa, setShowAllQa] = useState(false)

  const loadReads = useCallback(async () => {
    if (!agentId) return
    const { data } = await supabase.from('qa_audit_reads').select('audit_id').eq('profile_id', agentId)
    setReads(new Set((data || []).map(r => r.audit_id)))
  }, [agentId])
  useEffect(() => { loadReads() }, [loadReads])

  async function toggleRead(auditId) {
    if (!isOwn || !agentId) return
    const has = reads.has(auditId)
    setReads(prev => { const n = new Set(prev); has ? n.delete(auditId) : n.add(auditId); return n })
    if (has) await supabase.from('qa_audit_reads').delete().eq('audit_id', auditId).eq('profile_id', agentId)
    else await supabase.from('qa_audit_reads').insert({ audit_id: auditId, profile_id: agentId })
  }

  // labels of the sub-items an audit marked "missed" (used for display + search)
  const missedFor = useCallback((a) => {
    const out = []
    Object.values(a.answers || {}).forEach(v => {
      if (v && v.value === 'no' && Array.isArray(v.missed)) {
        v.missed.forEach(id => { if (subItemLabels[id]) out.push(subItemLabels[id]) })
      }
    })
    return out
  }, [subItemLabels])

  // Manual (qa_audits) + AI (ai_qa_reviews via RPC) normalized into one list.
  const mergedAudits = useMemo(() => {
    const man = (qaAudits || []).map(a => ({
      key: 'man:' + a.id, kind: 'manual', auditId: a.id, aiCallId: null,
      recordingUrl: a.recording_link || null, hasRecording: !!a.recording_link,
      score: a.clean_qa_score == null ? null : Number(a.clean_qa_score), autoFail: !!a.auto_fail,
      auditType: a.audit_type, brand: a.brand, campaign: a.campaign,
      feedback: a.feedback, missed: missedFor(a), missedLabel: 'Missed:',
      date: a.call_date || a.created_at,
      editCount: a.edit_count, editedAt: a.edited_at, editorName: a.editor_name,
    }))
    const ai = (aiAudits || []).map(a => ({
      key: 'ai:' + a.id, kind: 'ai', auditId: null, aiCallId: a.ai_call_id,
      recordingUrl: null, hasRecording: !!a.has_recording,
      score: a.score == null ? null : Number(a.score), autoFail: !!a.auto_fail,
      auditType: a.audit_type, brand: a.brand, campaign: a.campaign,
      feedback: a.feedback, missed: Array.isArray(a.improvements) ? a.improvements : [], missedLabel: 'Focus:',
      date: a.call_date || a.created_at,
      editCount: 0, editedAt: null, editorName: null,
    }))
    return [...man, ...ai].sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')))
  }, [qaAudits, aiAudits, missedFor])

  const filteredQa = useMemo(() => {
    const k = kw.trim().toLowerCase()
    return mergedAudits.filter(a => {
      const d = String(a.date || '').slice(0, 10)
      if (dFrom && d && d < dFrom) return false
      if (dTo && d && d > dTo) return false
      if (k) {
        const hay = [a.feedback, a.brand, a.auditType, a.campaign, ...(a.missed || [])].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(k)) return false
      }
      return true
    })
  }, [mergedAudits, kw, dFrom, dTo])

  const filtersActive = !!(kw.trim() || dFrom || dTo)
  const visibleQa = showAllQa ? filteredQa : filteredQa.slice(0, 2)

  const loadNotes = useCallback(async () => {
    if (!row) return
    setLoadingNotes(true)
    const { data } = await supabase.from('sc_coaching_notes').select('*').eq('agent_name', row.agent_name).order('note_date', { ascending: false })
    setNotes(data || []); setLoadingNotes(false)
  }, [row])
  useEffect(() => { loadNotes() }, [loadNotes])

  const loadQa = useCallback(async () => {
    if (!row) return
    const [aRes, sRes, aiRes] = await Promise.all([
      supabase.from('qa_audits')
        .select('id, audit_type, campaign, clean_qa_score, auto_fail, brand, feedback, answers, created_at, call_date, edited_at, editor_name, edit_count, recording_link')
        .eq('agent_name', row.agent_name)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('qa_sub_items').select('id, label'),
      // AI QA audits for this agent (matched by profile or name server-side).
      supabase.rpc('agent_scorecard_ai_audits', { p_profile_id: row.profile_id, p_agent_name: row.agent_name }),
    ])
    setQaAudits(aRes.data || [])
    const map = {}; (sRes.data || []).forEach(s => { map[s.id] = s.label })
    setSubItemLabels(map)
    setAiAudits(Array.isArray(aiRes.data) ? aiRes.data : [])
  }, [row])
  useEffect(() => { loadQa() }, [loadQa])

  // Coaching & Feedback: meetings this agent was part of (notetaker summary +
  // action items + recording). The RPC gates access to the agent themselves or
  // a manager, and matches the agent to meetings.participants server-side.
  const loadMeetings = useCallback(async () => {
    if (!agentId) { setMeetings([]); setLoadingMtg(false); return }
    setLoadingMtg(true)
    const { data, error } = await supabase.rpc('agent_coaching_meetings', { p_profile_id: agentId })
    setMeetings(error ? [] : (Array.isArray(data) ? data : []))
    setLoadingMtg(false)
  }, [agentId])
  useEffect(() => { loadMeetings() }, [loadMeetings])

  if (!row) return (
    <div>
      {onBack && <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }}>← Team</button>}
      <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-soft)' }}>No scorecard available for you yet.</div>
    </div>
  )

  const ts = TIER_STYLE[row.performance_tier] || { bg: 'var(--line-soft)', fg: 'var(--ink-soft)' }

  return (
    <div style={{ maxWidth: 1080 }}>
      {onBack && <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 14 }}>← Team</button>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>{row.agent_name}</h1>
          <p className="page-sub">Service Performance Scorecard — last 30 days</p>
        </div>
        {row.performance_tier && (
          <div style={{ textAlign: 'center', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 18px', minWidth: 200 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>Performance Tier</div>
            <div style={{ fontSize: 19, fontWeight: 800, margin: '4px 0', padding: '3px 10px', borderRadius: 8, background: ts.bg, color: ts.fg, display: 'inline-block' }}>{row.performance_tier}</div>
            {row.schedule_release_text && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{row.schedule_release_text}</div>}
          </div>
        )}
      </div>

      {/* Performance summary — the four headline metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 14 }}>
        <SummaryCard label="Conversion Rate" big={pct(row.conversion_rate_last_30_days, 2)} />
        <SummaryCard label="Quality Score" big={pct(row.avg_clean_qa_score_last_30_days, 2)} />
        <SummaryCard label="Schedule Adherence" big={pct(row.schedule_adherence_last_30_days, 2)} />
        <SummaryCard label="ACW % (of login)" big={pct(row.acw_pct_last_30_days, 2)} bigColor={badColor(row.acw_pct_last_30_days)} />
        <SummaryCard label="Not Ready % (of login)" big={pct(row.nr_pct_last_30_days, 2)} bigColor={badColor(row.nr_pct_last_30_days)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 14 }}>
        {/* Agent info */}
        <div className="card">
          <SectionTitle>Agent Information</SectionTitle>
          <InfoRow k="Project" v={row.project} />
          <InfoRow k="Status" v={row.status} />
          <InfoRow k="Start date" v={fmtDate(row.start_date)} />
          <InfoRow k="Last serviced" v={fmtDate(row.last_date_worked)} />
          <InfoRow k="Days serviced (30d)" v={row.days_worked_last_30_days ?? '—'} />
          <InfoRow k="Avg days / week" v={num(row.avg_days_worked_per_week_last_30_days, 2)} />
          <InfoRow k="Avg hours / day" v={num(row.avg_hours_per_worked_day_last_30_days, 2)} />
        </div>

        {/* Volume */}
        <div className="card">
          <SectionTitle>Volume (30 days)</SectionTitle>
          <InfoRow k="Total hours serviced" v={num(row.total_actual_hours_last_30_days, 2)} />
          <InfoRow k="Calls handled" v={row.calls_handled_last_30_days ?? '—'} />
          <InfoRow k="Bookings" v={row.bookings_last_30_days ?? '—'} />
          <InfoRow k="Bookings / hour" v={num(row.bookings_per_hour_last_30_days, 3)} />
        </div>

        {/* Reliability */}
        <div className="card">
          <SectionTitle>Reliability (30 days)</SectionTitle>
          <InfoRow k="Schedule adherence" v={pct(row.schedule_adherence_last_30_days, 2)} />
          <InfoRow k="ACW % (of login)" v={pct(row.acw_pct_last_30_days, 2)} vColor={badColor(row.acw_pct_last_30_days)} />
          <InfoRow k="Not Ready % (of login)" v={pct(row.nr_pct_last_30_days, 2)} vColor={badColor(row.nr_pct_last_30_days)} />
          <InfoRow k="Weighted score" v={row.weighted_score == null ? '—' : (row.weighted_score * 100).toFixed(1)} />
          <InfoRow k="Team rank" v={row.agent_rank ?? '—'} />
        </div>
      </div>

      {/* Quality focus */}
      {row.coaching_focus_last_30_days && (
        <div className="card" style={{ marginTop: 14 }}>
          <SectionTitle>Quality Focus</SectionTitle>
          <p style={{ fontSize: 14, lineHeight: 1.65, margin: 0 }}>{row.coaching_focus_last_30_days}</p>
        </div>
      )}

      {/* QA Feedback — the agent's own audited calls + written feedback.
          Shows the 2 most recent by default; search by keyword or date range;
          the agent can acknowledge each with "I've read this feedback." */}
      <div className="card" style={{ marginTop: 14 }}>
        <SectionTitle>Quality Feedback</SectionTitle>

        {mergedAudits.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 8px' }}>
            <input value={kw} onChange={e => { setKw(e.target.value); setShowAllQa(true) }} placeholder="Search feedback, brand, missed items…"
              style={{ ...qaFilterInp, flex: '1 1 220px', minWidth: 150 }} />
            <input type="date" value={dFrom} onChange={e => { setDFrom(e.target.value); setShowAllQa(true) }} title="From date" style={qaFilterInp} />
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>to</span>
            <input type="date" value={dTo} onChange={e => { setDTo(e.target.value); setShowAllQa(true) }} title="To date" style={qaFilterInp} />
            {filtersActive && (
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
                onClick={() => { setKw(''); setDFrom(''); setDTo(''); setShowAllQa(false) }}>Clear</button>
            )}
          </div>
        )}

        {mergedAudits.length === 0 ? (
          <p className="page-sub" style={{ fontSize: 13 }}>No quality reviews yet.</p>
        ) : filteredQa.length === 0 ? (
          <p className="page-sub" style={{ fontSize: 13 }}>No quality reviews match your search.</p>
        ) : (
          <div>
            {visibleQa.map(a => {
              const s = a.score
              const col = a.autoFail ? { bg: '#fdecea', fg: '#b71c1c' }
                : s == null ? { bg: 'var(--line-soft)', fg: 'var(--ink-soft)' }
                : s >= 90 ? { bg: '#e8f5e9', fg: '#1b5e20' }
                : s >= 80 ? { bg: '#fff8e1', fg: '#8d6e00' }
                : s >= 70 ? { bg: '#e3f2fd', fg: '#0d47a1' }
                : { bg: '#fdecea', fg: '#b71c1c' }
              const isRead = a.auditId ? reads.has(a.auditId) : false
              return (
                <div key={a.key} style={{ padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: col.bg, color: col.fg }}>
                      {a.autoFail ? 'Auto-fail' : (s == null ? '—' : (Math.round(s * 10) / 10) + '%')}
                    </span>
                    <span title={a.kind === 'ai' ? 'Scored by the AI QA tool' : 'Manually audited'}
                      style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: a.kind === 'ai' ? '#ede7f6' : 'var(--line-soft)', color: a.kind === 'ai' ? '#5e35b1' : 'var(--ink-soft)' }}>
                      {a.kind === 'ai' ? 'AI' : 'Manual'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{(a.auditType || '').replace('_', ' ')}</span>
                    {a.brand && <span className="page-sub" style={{ fontSize: 12 }}>· {a.brand}</span>}
                    {a.editCount > 0 && (
                      <span title={`Score updated ${fmtDate(a.editedAt)}${a.editorName ? ' by ' + a.editorName : ''}`}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--needed-bg)', color: 'var(--needed)' }}>
                        updated
                      </span>
                    )}
                    <span className="page-sub" style={{ fontSize: 12, marginLeft: 'auto' }}>{fmtDate(a.date)}</span>
                  </div>
                  {a.feedback && <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '6px 0 0', color: 'var(--ink)' }}>{a.feedback}</p>}
                  {a.missed.length > 0 && <p style={{ fontSize: 12.5, margin: '5px 0 0', color: 'var(--ink-soft)' }}><b>{a.missedLabel}</b> {a.missed.join(', ')}</p>}

                  {a.hasRecording && <AuditPlay kind={a.kind} recordingUrl={a.recordingUrl} aiCallId={a.aiCallId} />}

                  {a.auditId && isOwn ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12.5, cursor: 'pointer', color: isRead ? 'var(--passed)' : 'var(--ink-soft)', fontWeight: isRead ? 600 : 400 }}>
                      <input type="checkbox" checked={isRead} onChange={() => toggleRead(a.auditId)} style={{ width: 15, height: 15 }} />
                      {isRead ? '✓ I’ve read this feedback' : 'I’ve read this feedback'}
                    </label>
                  ) : (a.auditId && canCoach) ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: isRead ? 'var(--passed)' : 'var(--ink-soft)', fontWeight: isRead ? 600 : 400 }}>
                      {isRead ? '✓ Agent marked as read' : 'Not yet read by agent'}
                    </div>
                  ) : null}
                </div>
              )
            })}

            {filteredQa.length > 2 && (
              <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12.5 }}
                onClick={() => setShowAllQa(v => !v)}>
                {showAllQa ? 'Show less' : `More… (${filteredQa.length - 2} more)`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Coaching & Feedback — meetings this agent was part of (notetaker
          summary + action items + recording). Same audience as Notes: the
          agent on their own card, plus coaches/admins. */}
      {canSeeNotes && (
      <div className="card" style={{ marginTop: 14 }}>
        <SectionTitle>Coaching &amp; Feedback</SectionTitle>
        {loadingMtg ? (
          <p className="page-sub" style={{ fontSize: 13 }}>Loading…</p>
        ) : meetings.length === 0 ? (
          <p className="page-sub" style={{ fontSize: 13 }}>No coaching sessions yet. When you're part of a recorded meeting, its notes and recording appear here.</p>
        ) : (
          <div>
            {meetings.map(m => (
              <div key={m.id} style={{ padding: '12px 0', borderTop: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{m.title || 'Meeting'}</span>
                  {m.duration_min != null && <span className="page-sub" style={{ fontSize: 12 }}>· {Math.round(m.duration_min)} min</span>}
                  <span className="page-sub" style={{ fontSize: 12, marginLeft: 'auto' }}>{fmtDate(m.meeting_date || m.started_at)}</span>
                </div>
                {m.summary && <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '8px 0 0', color: 'var(--ink)' }}>{m.summary}</p>}
                {Array.isArray(m.action_items) && m.action_items.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 4 }}>Action items</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {m.action_items.map((ai, i) => (
                        <li key={i} style={{ fontSize: 13, marginBottom: 3, textDecoration: ai.done ? 'line-through' : 'none', color: ai.done ? 'var(--ink-soft)' : 'var(--ink)' }}>
                          {ai.text}
                          {ai.owner_name ? <span className="page-sub" style={{ fontSize: 12 }}> — {ai.owner_name}</span> : null}
                          {ai.due_date ? <span className="page-sub" style={{ fontSize: 12 }}> (due {fmtDate(ai.due_date)})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.recording_link && (
                  <a href={m.recording_link} target="_blank" rel="noreferrer" className="btn btn-ghost"
                    style={{ marginTop: 10, fontSize: 12.5, padding: '5px 12px', textDecoration: 'none', display: 'inline-block' }}>
                    ▶ Watch recording
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Notes & Anecdotal Feedback — ASC, admins, and the agent on their own
          card only. Certification/marketing must not see this section. */}
      {canSeeNotes && (
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SectionTitle>Notes &amp; Anecdotal Feedback</SectionTitle>
          {/* Book a coaching session — right where you're reading the scores
              that prompt one. */}
          <a href={COACHING_BOOKING_URL} target="_blank" rel="noreferrer"
            className="btn btn-ghost"
            style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}>
            📅 Book a coaching session
          </a>
        </div>
        {canCoach && <AddNote agentName={row.agent_name} onAdded={loadNotes} />}
        {loadingNotes ? <p className="page-sub" style={{ fontSize: 13 }}>Loading…</p> : notes.length === 0 ? (
          <p className="page-sub" style={{ fontSize: 13 }}>No feedback recorded yet.</p>
        ) : (
          <div style={{ marginTop: canCoach ? 12 : 0 }}>
            {notes.map(n => (
              <div key={n.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', flex: 'none', width: 90 }}>{fmtDate(n.note_date)}</div>
                <div style={{ fontSize: 14, flex: 1 }}>
                  {n.focus && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#ede7f6', color: '#4527a0', marginRight: 8 }}>{n.focus}</span>}
                  {n.body}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

// Play a call recording inline. Manual audits carry a direct storage link; AI
// audits resolve through callqa-recording (signed URL + on-demand transcode of
// GSM). Playback is access-controlled server-side (agents hear only their own).
function AuditPlay({ kind, recordingUrl, aiCallId }) {
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    if (url || busy) return
    setErr('')
    if (kind === 'manual') { if (recordingUrl) setUrl(recordingUrl); else setErr('No recording'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('callqa-recording', { body: { call_id: aiCallId } })
      if (error || !data?.url) throw new Error(error?.message || data?.error || 'Recording unavailable')
      setUrl(data.url)
    } catch (e) { setErr(e.message || 'Recording unavailable') }
    setBusy(false)
  }
  if (url) return <audio controls autoPlay src={url} style={{ height: 34, marginTop: 8, maxWidth: '100%', display: 'block' }} />
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px' }} onClick={go} disabled={busy}>
        {busy ? 'Loading…' : '▶ Listen to call'}
      </button>
      {err && <span style={{ fontSize: 12, color: 'var(--failed)', marginLeft: 8 }}>{err}</span>}
    </div>
  )
}

function SummaryCard({ label, big, sub, bigColor }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, margin: '6px 0 2px', color: bigColor || 'inherit' }}>{big}</div>
      {sub ? <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{sub}</div> : null}
    </div>
  )
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)', marginBottom: 10 }}>{children}</div>
}
function InfoRow({ k, v, vColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 13.5 }}>
      <span style={{ color: 'var(--ink-soft)' }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', color: vColor || 'inherit' }}>{v}</span>
    </div>
  )
}

// Coaching focus categories (ASC SOP). Shown as a tag on the agent's scorecard.
const COACHING_FOCUS = ['Low QA', 'Call review — concern identified', 'Adherence', 'High AHT', 'Low AHT', 'ASC judgement']

function AddNote({ agentName, onAdded }) {
  const { user } = useAuth()
  const [body, setBody] = useState('')
  const [focus, setFocus] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    if (!body.trim()) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('sc_coaching_notes').insert({
      agent_name: agentName, note_date: date, body: body.trim(), focus: focus || null, author_id: user?.id,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setBody(''); setFocus(''); onAdded()
  }

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)', flex: 'none' }} />
        <select value={focus} onChange={e => setFocus(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)', flex: 'none' }}>
          <option value="">Focus…</option>
          {COACHING_FOCUS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input value={body} onChange={e => setBody(e.target.value)} placeholder="Coaching note (the agent will see this)…" onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ flex: 1, minWidth: 200, padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--canvas)' }} />
        <button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add note'}</button>
        {err && <div style={{ color: 'var(--failed)', fontSize: 12.5, width: '100%' }}>{err}</div>}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>Agents see these notes on their own scorecard — keep it constructive and contractor-friendly.</div>
    </div>
  )
}
