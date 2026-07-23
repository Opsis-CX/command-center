import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'

// ============================================================
// CALL QA (AI) — automated call scoring, opportunity/outcome & coaching
// Pipeline: CallRail pull -> (Deepgram transcribe) -> Claude score (ai_qa_rubric,
// the door form) -> ai_qa_reviews. Managers (quality_audit.call_reviews) see all;
// agents see only their own. RLS-enforced.
// ============================================================

const SECTIONS = [
  { key: 'greeting_compliance', label: 'Greeting & Compliance' },
  { key: 'discovery_needs', label: 'Discovery & Needs' },
  { key: 'solution_pitch', label: 'Solution & Pitch' },
  { key: 'close_next_steps', label: 'Close & Next Steps' },
]
const RUBRIC_ORDER = ['greeting', 'verify', 'callflow', 'knowledge', 'appointment', 'professionalism', 'rebuttals', 'hold', 'nextsteps', 'closing']
const TEAL = '#0f766e'
const canViewAll = (r) => can(r, 'quality_audit.call_reviews') || can(r, 'service_performance_scorecard.view_all_scorecards')

const scoreColor = (v) => (v == null ? '#94a3b8' : v >= 85 ? '#1b5e20' : v >= 70 ? '#8d6e00' : '#b71c1c')
const scoreBg = (v) => (v == null ? '#f1f5f9' : v >= 85 ? '#e8f5e9' : v >= 70 ? '#fff8e1' : '#fdecea')
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')
const fmtDur = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
// Put each speaker turn on its own line with a blank line between, for readability.
const formatTranscript = (t) => {
  if (!t) return ''
  return t
    .replace(/\s*\b(Agent|Caller|Customer|Rep|Speaker\s*\d+)\s*:\s*/g, '\n\n$1: ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
const OUTCOME_STYLE = {
  'Booked': { bg: '#e8f5e9', fg: '#1b5e20' }, 'Not Booked': { bg: '#fdecea', fg: '#b71c1c' },
  'Transferred': { bg: '#e3f2fd', fg: '#0d47a1' }, 'No Opportunity': { bg: '#f1f5f9', fg: '#64748b' }, 'Other': { bg: '#f1f5f9', fg: '#64748b' },
}
const agentOf = (r) => r.call?.agent_name || r.extracted_agent_name || 'Unknown'
// A review counts toward scores only if it's a real conversation and not manually excluded.
const isScored = (r) => r.scoreable !== false && !r.excluded && r.score_pct != null
const CLASS_LABEL = { wrong_number: 'Wrong number', ivr_only: 'IVR only', voicemail: 'Voicemail', no_agent: 'No agent', spam: 'Spam' }
const ynLabel = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'na' ? 'N/A' : '—')
// Recompute a review's totals from (possibly manager-edited) answers.
function recomputeReview(answers) {
  let earned = 0, max = 0; const sec = {}
  Object.values(answers || {}).forEach((a) => {
    const na = a.na || a.answer === 'na'
    const itemMax = Number(a.max) || 0
    const got = na ? 0 : (a.answer === 'yes' ? itemMax : (a.answer === 'no' ? 0 : Number(a.points) || 0))
    if (!na) { max += itemMax; earned += got }
    const s = a.section || 'other'; sec[s] ??= { earned: 0, max: 0 }; if (!na) { sec[s].max += itemMax; sec[s].earned += got }
  })
  const pct = max > 0 ? Math.round((earned / max) * 1000) / 10 : 0
  const section_scores = {}; for (const [s, v] of Object.entries(sec)) section_scores[s] = { earned: v.earned, max: v.max, pct: v.max ? Math.round((v.earned / v.max) * 1000) / 10 : null }
  return { earned, max, pct, section_scores }
}

const Card = ({ children, style }) => <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, ...style }}>{children}</div>
const Tile = ({ label, value, sub, color }) => (
  <Card style={{ flex: 1, minWidth: 130 }}>
    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 700, color: color || '#0f172a', marginTop: 4 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
  </Card>
)
const Bar = ({ v, color }) => <div style={{ background: '#eef2f7', borderRadius: 6, height: 8, overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, v || 0))}%`, height: '100%', background: color || TEAL }} /></div>
const Pill = ({ children, bg, fg }) => <span style={{ background: bg, color: fg, fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>

export default function CallQA({ portal = false } = {}) {
  const { appRole, user, isClientPortal } = useAuth()
  // Portal mode = an external client login. They see ALL of their client's calls
  // and the agent names (their own reception staff), can export and add notes —
  // but never the manager controls (re-score / exclude / adjust) or Settings.
  const portalMode = portal || isClientPortal || appRole === 'client'
  const canManage = canViewAll(appRole) && !portalMode   // Opsis manager edit rights
  const viewAll = canViewAll(appRole) || portalMode       // see all rows + agent names + agent filter
  const [meName, setMeName] = useState('')
  const [exporting, setExporting] = useState(false)
  const [tab, setTab] = useState('overview')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [settings, setSettings] = useState([])
  const [secretKeys, setSecretKeys] = useState([])
  const [pipeline, setPipeline] = useState({})
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState('')
  const [days, setDays] = useState(30)
  const [brand, setBrand] = useState('all')
  const [agent, setAgent] = useState('all')
  const [topic, setTopic] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    // Supabase caps a single response at 1000 rows, so page through ALL reviews.
    // The heavy per-question `answers` blob and the `transcript` are fetched lazily
    // (in the detail drawer, and on demand at CSV-export time) to keep this initial
    // payload light — it makes the first load noticeably faster at scale.
    const sel = 'id, campaign, score_pct, earned_points, max_points, auto_fail, section_scores, strengths, improvements, strength_tags, improvement_tags, coaching_note, risk_flags, summary, status, opportunity, outcome, not_booked_reason, opportunity_context, extracted_agent_name, call_class, scoreable, excluded, manager_adjusted, adjustment_note, topics, objections, asked_for_booking, info_before_pricing, set_fee_expectations, winnable, revenue_tip, created_at, call:ai_qa_calls(id, agent_name, profile_id, brand, source, direction, disposition, call_date, duration_seconds, recording_url, customer_name, customer_number)'
    const page = 1000; let from = 0; let all = []
    for (;;) {
      const { data, error } = await supabase.from('ai_qa_reviews').select(sel).order('created_at', { ascending: false }).range(from, from + page - 1)
      if (error) { setErr(error.message); setLoading(false); return }
      all = all.concat(data || [])
      if (!data || data.length < page) break
      from += page
    }
    setRows(all)
    const [{ data: st }, { data: sk }] = await Promise.all([
      supabase.from('ai_qa_settings').select('*').order('campaign'),
      supabase.from('integration_secrets').select('key'),
    ])
    setSettings(st || []); setSecretKeys((sk || []).map((r) => r.key))
    // exact pipeline counts (head:true transfers no rows, so no 1000-row cap)
    const statuses = ['ingested', 'needs_transcription', 'transcribing', 'ready', 'scoring', 'scored', 'error']
    const counts = {}
    await Promise.all(statuses.map(async (s) => {
      const { count } = await supabase.from('ai_qa_calls').select('id', { count: 'exact', head: true }).eq('status', s)
      counts[s] = count || 0
    }))
    setPipeline(counts)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  // Current user's display name, used when they add a note.
  useEffect(() => {
    let active = true
    if (!user?.id) return
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (active) setMeName(data?.full_name || user.email || 'User') })
      .catch(() => { if (active) setMeName(user.email || 'User') })
    return () => { active = false }
  }, [user?.id])

  const filtered = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
    return rows.filter((r) => {
      const c = r.call || {}
      const d = c.call_date ? new Date(c.call_date) : new Date(r.created_at)
      if (d < cutoff) return false
      if (brand !== 'all' && c.brand !== brand) return false
      if (agent !== 'all' && agentOf(r) !== agent) return false
      if (topic !== 'all' && !(r.topics || []).includes(topic)) return false
      return true
    })
  }, [rows, days, brand, agent, topic])

  const agents = useMemo(() => Array.from(new Set(rows.map(agentOf).filter(Boolean))).sort(), [rows])
  const brands = useMemo(() => Array.from(new Set(rows.map((r) => r.call?.brand).filter(Boolean))).sort(), [rows])
  const topicList = useMemo(() => Array.from(new Set(rows.flatMap((r) => r.topics || []))).sort(), [rows])

  const agg = useMemo(() => {
    const scored = filtered.filter(isScored)
    const n = scored.length
    const avg = n ? scored.reduce((s, r) => s + (Number(r.score_pct) || 0), 0) / n : null
    const opps = filtered.filter((r) => r.opportunity)
    const booked = opps.filter((r) => r.outcome === 'Booked')
    const conv = opps.length ? (booked.length / opps.length) * 100 : null
    const sec = {}
    for (const s of SECTIONS) { const v = scored.map((r) => r.section_scores?.[s.key]?.pct).filter((x) => x != null); sec[s.key] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
    const outcomes = {}; filtered.forEach((r) => { if (r.outcome) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1 })
    const reasons = {}; opps.filter((r) => r.outcome === 'Not Booked').forEach((r) => { const k = r.not_booked_reason || 'Unspecified'; reasons[k] = (reasons[k] || 0) + 1 })
    const topics = {}; filtered.forEach((r) => (r.topics || []).forEach((t) => { topics[t] = (topics[t] || 0) + 1 }))
    return { n, avg, total: filtered.length, excluded: filtered.length - n, opps: opps.length, booked: booked.length, conv, sec, outcomes, reasons, topics, flags: filtered.filter((r) => (r.risk_flags || []).length).length }
  }, [filtered])

  const trend = useMemo(() => {
    const m = new Map()
    filtered.filter(isScored).forEach((r) => { const d = (r.call?.call_date) || r.created_at.slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(Number(r.score_pct) || 0) })
    return Array.from(m.entries()).map(([d, arr]) => ({ d, avg: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length })).sort((a, b) => a.d.localeCompare(b.d))
  }, [filtered])

  const byAgent = useMemo(() => {
    const m = new Map()
    filtered.forEach((r) => {
      const a = agentOf(r); if (!m.has(a)) m.set(a, { name: a, scores: [], improvements: {}, strengths: {}, calls: 0, opps: 0, booked: 0 })
      const o = m.get(a); o.calls++
      if (isScored(r)) o.scores.push(Number(r.score_pct) || 0)
      if (r.opportunity) { o.opps++; if (r.outcome === 'Booked') o.booked++ }
      if (isScored(r)) { (r.improvements || []).forEach((i) => o.improvements[i] = (o.improvements[i] || 0) + 1); (r.strengths || []).forEach((i) => o.strengths[i] = (o.strengths[i] || 0) + 1) }
    })
    return Array.from(m.values()).map((o) => ({
      ...o, avg: o.scores.length ? o.scores.reduce((a, b) => a + b, 0) / o.scores.length : null,
      conv: o.opps ? (o.booked / o.opps) * 100 : null,
      topWeak: Object.entries(o.improvements).sort((a, b) => b[1] - a[1]).slice(0, 3),
      topStrong: Object.entries(o.strengths).sort((a, b) => b[1] - a[1]).slice(0, 3),
    })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
  }, [filtered])

  async function rescore(callId) { setBusy(callId); try { const { error } = await supabase.functions.invoke('callqa-score', { body: { call_id: callId } }); if (error) throw error; await load() } catch (e) { alert('Re-score failed: ' + (e.message || e)) } setBusy('') }
  async function setReviewStatus(reviewId, status) { await supabase.from('ai_qa_reviews').update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reviewId); await load() }
  async function setExcluded(reviewId, val) { setBusy(reviewId); await supabase.from('ai_qa_reviews').update({ excluded: val, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reviewId); await load(); setBusy('') }
  async function saveAdjustment(reviewId, answers, note) {
    setBusy(reviewId)
    const { earned, max, pct, section_scores } = recomputeReview(answers)
    await supabase.from('ai_qa_reviews').update({ answers, earned_points: earned, max_points: max, score_pct: pct, section_scores, manager_adjusted: true, adjustment_note: note || null, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reviewId)
    await load(); setBusy('')
  }
  async function saveSetting(s) { setBusy('settings'); await supabase.from('ai_qa_settings').upsert(s, { onConflict: 'campaign' }); await load(); setBusy('') }

  async function exportCSV() {
    // `answers` is no longer in the bulk load, so pull it just for the rows being
    // exported (batched to stay under URL limits), then merge for the per-item columns.
    setExporting(true)
    const ansById = {}
    try {
      const ids = filtered.map((r) => r.id)
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400)
        const { data } = await supabase.from('ai_qa_reviews').select('id, answers').in('id', chunk)
        ;(data || []).forEach((r) => { ansById[r.id] = r.answers || {} })
      }
    } catch { /* fall through — per-item columns just come out blank */ }
    const cols = ['call_date', 'brand', 'agent', 'source', 'direction', 'duration_sec', 'disposition',
      'call_class', 'scoreable', 'excluded', 'manager_adjusted', 'topics',
      'score_pct', 'earned', 'max', 'opportunity', 'outcome', 'not_booked_reason', 'opportunity_context',
      'objections', 'asked_for_booking', 'info_before_pricing', 'set_fee_expectations', 'winnable', 'revenue_tip',
      'sec_greeting_compliance', 'sec_discovery_needs', 'sec_solution_pitch', 'sec_close_next_steps',
      ...RUBRIC_ORDER, ...RUBRIC_ORDER.map((k) => k + '_missed'),
      'strengths', 'improvements', 'coaching_note', 'risk_flags', 'summary', 'recording_url', 'status', 'review_id', 'call_id']
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const lines = [cols.join(',')]
    filtered.forEach((r) => {
      const c = r.call || {}, a = ansById[r.id] || r.answers || {}, ss = r.section_scores || {}
      const row = {
        call_date: c.call_date, brand: c.brand, agent: agentOf(r), source: c.source, direction: c.direction,
        duration_sec: c.duration_seconds, disposition: c.disposition,
        call_class: r.call_class, scoreable: r.scoreable, excluded: r.excluded, manager_adjusted: r.manager_adjusted, topics: (r.topics || []).join(' | '),
        score_pct: r.score_pct, earned: r.earned_points, max: r.max_points,
        opportunity: r.opportunity, outcome: r.outcome, not_booked_reason: r.not_booked_reason, opportunity_context: r.opportunity_context,
        objections: (r.objections || []).join(' | '), asked_for_booking: r.asked_for_booking, info_before_pricing: r.info_before_pricing,
        set_fee_expectations: r.set_fee_expectations, winnable: r.winnable, revenue_tip: r.revenue_tip,
        sec_greeting_compliance: ss.greeting_compliance?.pct, sec_discovery_needs: ss.discovery_needs?.pct,
        sec_solution_pitch: ss.solution_pitch?.pct, sec_close_next_steps: ss.close_next_steps?.pct,
        strengths: (r.strengths || []).join(' | '), improvements: (r.improvements || []).join(' | '),
        coaching_note: r.coaching_note, risk_flags: (r.risk_flags || []).join(' | '), summary: r.summary,
        recording_url: c.recording_url, status: r.status, review_id: r.id, call_id: c.id,
      }
      RUBRIC_ORDER.forEach((k) => { row[k] = a[k]?.answer || ''; row[k + '_missed'] = (a[k]?.misses || []).join('; ') })
      lines.push(cols.map((k) => esc(row[k])).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `call-qa-export-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url)
    setExporting(false)
  }

  const base = import.meta.env.VITE_SUPABASE_URL || ''
  const inFlight = (pipeline.needs_transcription || 0) + (pipeline.transcribing || 0) + (pipeline.ready || 0) + (pipeline.scoring || 0)
  const TABS = [['overview', 'Overview'], ['opportunities', 'Opportunities'], ['conversion', 'Conversion'], ['calls', 'Calls'], ['coaching', 'Coaching'], ...(canManage ? [['settings', 'Settings']] : [])]

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Call QA <span style={{ color: TEAL }}>(AI)</span></h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Every call scored on the 10-point door rubric, with sales-opportunity outcomes and coaching.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {inFlight > 0 && <Pill bg="#fff8e1" fg="#8d6e00">⏳ {inFlight} in queue</Pill>}
          <button onClick={exportCSV} disabled={exporting} style={{ ...btn('ghost'), opacity: exporting ? 0.6 : 1 }}>{exporting ? 'Preparing…' : '⬇ Export CSV'}</button>
          <button onClick={load} style={btn('ghost')}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
        <Select label="Range" value={days} onChange={(v) => setDays(Number(v))} opts={[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [3650, 'All time']]} />
        <Select label="Brand" value={brand} onChange={setBrand} opts={[['all', 'All brands'], ...brands.map((c) => [c, c])]} />
        <Select label="Topic" value={topic} onChange={setTopic} opts={[['all', 'All topics'], ...topicList.map((t) => [t, t])]} />
        {viewAll && <Select label="Agent" value={agent} onChange={setAgent} opts={[['all', 'All agents'], ...agents.map((a) => [a, a])]} />}
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', padding: '10px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: tab === k ? TEAL : '#64748b', borderBottom: tab === k ? `2px solid ${TEAL}` : '2px solid transparent' }}>{l}</button>)}
      </div>

      {loading ? <div style={{ color: '#64748b' }}>Loading…</div> : err ? <Card style={{ color: '#b71c1c' }}>Error: {err}</Card> : (
        <>
          {tab === 'overview' && <Overview agg={agg} trend={trend} />}
          {tab === 'opportunities' && <Opportunities rows={filtered} agg={agg} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'conversion' && <Conversion rows={filtered} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'calls' && <Calls rows={filtered} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'coaching' && <Coaching byAgent={byAgent} />}
          {tab === 'settings' && canManage && <SettingsTab settings={settings} secretKeys={secretKeys} pipeline={pipeline} base={base} onSave={saveSetting} busy={busy} />}
        </>
      )}
      {selected && <Detail row={selected} onClose={() => setSelected(null)} onRescore={rescore} onExclude={setExcluded} onAdjust={saveAdjustment} busy={busy} canManage={canManage} meName={meName} userId={user?.id} />}
    </div>
  )
}

function Overview({ agg, trend }) {
  const maxN = Math.max(1, ...trend.map((t) => t.n))
  const topReasons = Object.entries(agg.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const topTopics = Object.entries(agg.topics).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const maxTopic = Math.max(1, ...topTopics.map((t) => t[1]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Calls scored" value={agg.n} />
        <Tile label="Not scored" value={agg.excluded} sub="wrong # / IVR / excluded" />
        <Tile label="Avg QA score" value={agg.avg == null ? '—' : pct(agg.avg)} color={scoreColor(agg.avg)} />
        <Tile label="Opportunities" value={agg.opps} sub="calls with a booking/sale chance" />
        <Tile label="Booked" value={agg.booked} color="#1b5e20" />
        <Tile label="Conversion" value={agg.conv == null ? '—' : pct(agg.conv)} color={TEAL} sub="booked ÷ opportunities" />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 2, minWidth: 340 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Score by section</div>
          {SECTIONS.map((s) => (
            <div key={s.key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>{s.label}</span><b style={{ color: scoreColor(agg.sec[s.key]) }}>{pct(agg.sec[s.key])}</b></div>
              <Bar v={agg.sec[s.key]} color={scoreColor(agg.sec[s.key])} />
            </div>
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Top “not booked” reasons</div>
          {topReasons.length ? topReasons.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}><span>{k}</span><b>{v}</b></div>
          )) : <div style={{ color: '#64748b', fontSize: 13 }}>No missed opportunities in range.</div>}
        </Card>
      </div>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 14 }}>What calls are about</div>
        {topTopics.length === 0 ? <div style={{ color: '#64748b' }}>No topics yet.</div> : topTopics.map(([t, v]) => (
          <div key={t} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>{t}</span><b>{v}</b></div>
            <Bar v={(v / maxTopic) * 100} color={TEAL} />
          </div>
        ))}
      </Card>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 14 }}>Daily QA score trend</div>
        {trend.length === 0 ? <div style={{ color: '#64748b' }}>No calls in range.</div> : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, borderBottom: '1px solid #e2e8f0', paddingBottom: 4 }}>
            {trend.map((t) => (
              <div key={t.d} title={`${t.d}: ${pct(t.avg)} (${t.n} calls)`} style={{ flex: 1, minWidth: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ fontSize: 9, color: '#94a3b8' }}>{Math.round(t.avg)}</div>
                <div style={{ width: '80%', background: scoreColor(t.avg), height: `${t.avg}%`, borderRadius: '3px 3px 0 0', opacity: 0.35 + 0.65 * (t.n / maxN) }} />
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, transform: 'rotate(-40deg)', whiteSpace: 'nowrap' }}>{fmtDate(t.d)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ---- Opportunities: every opportunity call → booked/sold or not ----
function Opportunities({ rows, agg, onOpen, viewAll }) {
  const opps = rows.filter((r) => r.opportunity)
  const byBrand = useMemo(() => {
    const m = new Map()
    opps.forEach((r) => { const b = r.call?.brand || '—'; if (!m.has(b)) m.set(b, { brand: b, opps: 0, booked: 0 }); const o = m.get(b); o.opps++; if (r.outcome === 'Booked') o.booked++ })
    return Array.from(m.values()).map((o) => ({ ...o, conv: o.opps ? (o.booked / o.opps) * 100 : 0 })).sort((a, b) => b.opps - a.opps)
  }, [rows])
  if (!opps.length) return <Card style={{ color: '#64748b' }}>No opportunity calls scored in this range yet.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Opportunities" value={agg.opps} />
        <Tile label="Booked / Sold" value={agg.booked} color="#1b5e20" />
        <Tile label="Missed" value={agg.opps - agg.booked} color="#b71c1c" />
        <Tile label="Conversion" value={agg.conv == null ? '—' : pct(agg.conv)} color={TEAL} />
      </div>
      <Card style={{ padding: 0 }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Conversion by brand</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569' }}>{['Brand', 'Opportunities', 'Booked', 'Conversion'].map((h) => <th key={h} style={{ padding: '8px 12px' }}>{h}</th>)}</tr></thead>
          <tbody>{byBrand.map((b) => (
            <tr key={b.brand} style={{ borderTop: '1px solid #eef2f7' }}>
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{b.brand}</td><td style={{ padding: '8px 12px' }}>{b.opps}</td><td style={{ padding: '8px 12px' }}>{b.booked}</td>
              <td style={{ padding: '8px 12px' }}><span style={{ color: b.conv >= 50 ? '#1b5e20' : b.conv >= 30 ? '#8d6e00' : '#b71c1c', fontWeight: 700 }}>{pct(b.conv)}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Opportunity calls</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569' }}>{['Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'What they wanted', 'Outcome', 'Reason', 'Score'].map((h) => <th key={h} style={{ padding: '8px 12px' }}>{h}</th>)}</tr></thead>
          <tbody>{opps.map((r) => {
            const c = r.call || {}; const os = OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.Other
            return (
              <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                {viewAll && <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{agentOf(r)}</td>}
                <td style={{ padding: '8px 12px' }}>{c.brand}</td>
                <td style={{ padding: '8px 12px', maxWidth: 220, color: '#475569' }}>{r.opportunity_context || '—'}</td>
                <td style={{ padding: '8px 12px' }}><Pill bg={os.bg} fg={os.fg}>{r.outcome}</Pill></td>
                <td style={{ padding: '8px 12px', color: '#64748b' }}>{r.outcome === 'Not Booked' ? (r.not_booked_reason || '—') : ''}</td>
                <td style={{ padding: '8px 12px' }}><span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{pct(r.score_pct)}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
      </Card>
    </div>
  )
}

// ---- Conversion: revenue intelligence (win/loss drivers + leaks) ----
function Conversion({ rows, onOpen, viewAll }) {
  const opps = rows.filter((r) => r.opportunity)
  const booked = opps.filter((r) => r.outcome === 'Booked')
  const lost = opps.filter((r) => r.outcome !== 'Booked')
  const conv = opps.length ? (booked.length / opps.length) * 100 : 0
  const pctOf = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)

  const noAsk = opps.filter((r) => r.asked_for_booking === false).length
  const priceBeforeInfo = rows.filter((r) => r.info_before_pricing === 'no').length
  const noFee = rows.filter((r) => r.set_fee_expectations === 'no').length
  const winnableLost = lost.filter((r) => r.winnable).length
  const priceDiscussed = rows.filter((r) => r.info_before_pricing === 'yes' || r.info_before_pricing === 'no').length
  const feeApplicable = rows.filter((r) => r.set_fee_expectations === 'yes' || r.set_fee_expectations === 'no').length
  const scoredCount = rows.filter(isScored).length

  const objections = {}; opps.forEach((r) => (r.objections || []).forEach((o) => { objections[o] = (objections[o] || 0) + 1 }))
  const topObj = Object.entries(objections).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxObj = Math.max(1, ...topObj.map((t) => t[1]))
  const tags = {}; rows.forEach((r) => (r.improvement_tags || []).forEach((t) => { tags[t] = (tags[t] || 0) + 1 }))
  const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxTag = Math.max(1, ...topTags.map((t) => t[1]))

  const am = new Map()
  opps.forEach((r) => { const a = agentOf(r); if (!am.has(a)) am.set(a, { name: a, opps: 0, booked: 0, asked: 0 }); const o = am.get(a); o.opps++; if (r.outcome === 'Booked') o.booked++; if (r.asked_for_booking) o.asked++ })
  const agents = Array.from(am.values()).map((o) => ({ ...o, conv: pctOf(o.booked, o.opps), askRate: pctOf(o.asked, o.opps) })).sort((a, b) => b.opps - a.opps)

  const winList = lost.filter((r) => r.winnable)
  const Leak = ({ label, n, sub, of }) => (
    <Card style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#b71c1c' }}>{n}</div>
      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{of ? `${pctOf(n, of)}% of ${sub}` : sub}</div>
    </Card>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* funnel */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Tile label="Opportunities" value={opps.length} />
        <div style={{ color: '#94a3b8', fontSize: 20 }}>→</div>
        <Tile label="Booked / Sold" value={booked.length} color="#1b5e20" />
        <div style={{ color: '#94a3b8', fontSize: 20 }}>→</div>
        <Tile label="Conversion" value={`${conv.toFixed(1)}%`} color={TEAL} sub={`${booked.length} of ${opps.length} opps`} />
        <Tile label="Winnable lost" value={winnableLost} color="#b71c1c" sub={`${pctOf(winnableLost, lost.length)}% of lost · recoverable`} />
      </div>

      <Card style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Where revenue is leaking</div>
        <div style={{ fontSize: 12.5, color: '#9a3412', marginBottom: 12 }}>The biggest, most fixable gaps across these calls — each one is money left on the table.</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Leak label="Didn't ask for the booking" n={noAsk} of={opps.length} sub="opportunities" />
          <Leak label="Quoted price before collecting info" n={priceBeforeInfo} of={priceDiscussed} sub="calls where price came up" />
          <Leak label="Fee expectations not set" n={noFee} of={feeApplicable} sub="calls where a fee applied" />
          <Leak label="Winnable calls lost" n={winnableLost} of={lost.length} sub="lost opps" />
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>What's stopping the sale (objections)</div>
          {topObj.length === 0 ? <div style={{ color: '#64748b' }}>No objections captured yet.</div> : topObj.map(([o, v]) => (
            <div key={o} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>{o}</span><b>{v} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({pctOf(v, opps.length)}% of opps)</span></b></div>
              <Bar v={(v / maxObj) * 100} color="#c2410c" />
            </div>
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Biggest revenue coaching gaps</div>
          {topTags.length === 0 ? <div style={{ color: '#64748b' }}>No coaching data yet.</div> : topTags.map(([t, v]) => (
            <div key={t} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>{t}</span><b>{v} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({pctOf(v, scoredCount)}% of calls)</span></b></div>
              <Bar v={(v / maxTag) * 100} color={TEAL} />
            </div>
          ))}
        </Card>
      </div>

      {viewAll && (
        <Card style={{ padding: 0 }}>
          <div style={{ fontWeight: 700, padding: 14 }}>Conversion by agent</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569' }}>{['Agent', 'Opportunities', 'Booked', 'Conversion', 'Asked for booking'].map((h) => <th key={h} style={{ padding: '8px 12px' }}>{h}</th>)}</tr></thead>
            <tbody>{agents.map((a) => (
              <tr key={a.name} style={{ borderTop: '1px solid #eef2f7' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.name}</td>
                <td style={{ padding: '8px 12px' }}>{a.opps}</td>
                <td style={{ padding: '8px 12px' }}>{a.booked}</td>
                <td style={{ padding: '8px 12px' }}><b style={{ color: a.conv >= 50 ? '#1b5e20' : a.conv >= 30 ? '#8d6e00' : '#b71c1c' }}>{a.conv.toFixed(0)}%</b></td>
                <td style={{ padding: '8px 12px', color: a.askRate < 50 ? '#b71c1c' : '#334155' }}>{a.askRate.toFixed(0)}%</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ fontWeight: 700, padding: 14 }}>Winnable calls you lost <span style={{ color: '#94a3b8', fontWeight: 400 }}>— recoverable with better handling</span></div>
        {winList.length === 0 ? <div style={{ padding: 14, color: '#64748b' }}>None flagged in range.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569' }}>{['Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'What they wanted', 'What would have won it'].map((h) => <th key={h} style={{ padding: '8px 12px' }}>{h}</th>)}</tr></thead>
            <tbody>{winList.map((r) => {
              const c = r.call || {}
              return (
                <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                  {viewAll && <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{agentOf(r)}</td>}
                  <td style={{ padding: '8px 12px' }}>{c.brand}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 180, color: '#475569' }}>{r.opportunity_context || '—'}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 320, color: TEAL }}>{r.revenue_tip || '—'}</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function Calls({ rows, onOpen, viewAll }) {
  if (!rows.length) return <Card style={{ color: '#64748b' }}>No scored calls in this range.</Card>
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569' }}>{['Date', ...(viewAll ? ['Agent'] : []), 'Brand', 'Opp.', 'Outcome', 'Score', ''].map((h) => <th key={h} style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => {
          const c = r.call || {}; const os = OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.Other
          return (
            <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
              <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
              {viewAll && <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{agentOf(r)}</td>}
              <td style={{ padding: '9px 12px' }}>{c.brand || '—'}{(r.topics || [])[0] && <div style={{ fontSize: 11, color: '#94a3b8' }}>🏷 {r.topics[0]}</div>}</td>
              <td style={{ padding: '9px 12px' }}>{r.opportunity ? '✅' : '—'}</td>
              <td style={{ padding: '9px 12px' }}>{r.outcome ? <Pill bg={os.bg} fg={os.fg}>{r.outcome}</Pill> : '—'}</td>
              <td style={{ padding: '9px 12px' }}>{isScored(r)
                ? <span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 9px', borderRadius: 8 }}>{r.auto_fail ? 'FAIL' : pct(r.score_pct)}{r.manager_adjusted ? ' *' : ''}</span>
                : <Pill bg="#f1f5f9" fg="#64748b">{r.excluded ? 'Excluded' : (CLASS_LABEL[r.call_class] || 'Not scored')}</Pill>}</td>
              <td style={{ padding: '9px 12px', color: '#94a3b8' }}>›</td>
            </tr>
          )
        })}</tbody>
      </table>
    </Card>
  )
}

function Coaching({ byAgent }) {
  const [open, setOpen] = useState(null)
  if (!byAgent.length) return <Card style={{ color: '#64748b' }}>No data in range.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {byAgent.map((a) => (
        <Card key={a.name} style={{ padding: 0 }}>
          <div onClick={() => setOpen(open === a.name ? null : a.name)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, cursor: 'pointer' }}>
            <div style={{ width: 46, textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(a.avg) }}>{a.avg == null ? '—' : Math.round(a.avg)}</div><div style={{ fontSize: 10, color: '#94a3b8' }}>avg</div></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{a.name}</div><div style={{ fontSize: 12, color: '#64748b' }}>{a.calls} calls · {a.opps} opportunities · {a.booked} booked{a.conv != null ? ` (${pct(a.conv)})` : ''}</div></div>
            <span style={{ color: '#94a3b8' }}>{open === a.name ? '▾' : '›'}</span>
          </div>
          {open === a.name && (
            <div style={{ padding: '0 14px 14px 74px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1b5e20', marginBottom: 6 }}>Strengths</div>
                {a.topStrong.length ? a.topStrong.map(([t, n]) => <div key={t} style={{ fontSize: 13, marginBottom: 4 }}>• {t} <span style={{ color: '#94a3b8' }}>×{n}</span></div>) : <div style={{ fontSize: 13, color: '#64748b' }}>—</div>}
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b71c1c', marginBottom: 6 }}>Weaknesses / coaching focus</div>
                {a.topWeak.length ? a.topWeak.map(([t, n]) => <div key={t} style={{ fontSize: 13, marginBottom: 4 }}>• {t} <span style={{ color: '#94a3b8' }}>×{n}</span></div>) : <div style={{ fontSize: 13, color: '#64748b' }}>Solid across the board.</div>}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

function Detail({ row, onClose, onRescore, onExclude, onAdjust, busy, canManage, meName, userId }) {
  const c = row.call || {}
  const os = OUTCOME_STYLE[row.outcome] || OUTCOME_STYLE.Other
  const [transcript, setTranscript] = useState(c.transcript ?? null)
  useEffect(() => {
    let active = true
    if (transcript == null && c.id) supabase.from('ai_qa_calls').select('transcript').eq('id', c.id).single().then(({ data }) => { if (active) setTranscript(data?.transcript || '') })
    return () => { active = false }
  }, [c.id])
  // Per-question answers are lazy-loaded (they're excluded from the list payload
  // to keep the initial load fast). null = not yet fetched.
  const [ans, setAns] = useState(row.answers ?? null)
  const [origAns, setOrigAns] = useState(row.answers ?? null)
  useEffect(() => {
    let active = true
    if (ans == null && row.id) supabase.from('ai_qa_reviews').select('answers').eq('id', row.id).single()
      .then(({ data }) => { if (active) { const v = data?.answers || {}; setAns(v); setOrigAns(v) } })
    return () => { active = false }
  }, [row.id])
  const [note, setNote] = useState(row.adjustment_note || '')
  const dirty = origAns != null && JSON.stringify(ans) !== JSON.stringify(origAns)
  const preview = recomputeReview(ans)
  const notScored = row.scoreable === false || row.excluded
  const setItem = (k, answer) => setAns((p) => ({ ...p, [k]: { ...p[k], answer, na: answer === 'na', points: answer === 'yes' ? (Number(p[k].max) || 0) : 0 } }))
  const items = Object.entries(ans || {}).sort((a, b) => {
    const ia = RUBRIC_ORDER.indexOf(a[0]), ib = RUBRIC_ORDER.indexOf(b[0])
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const shownPct = dirty ? preview.pct : row.score_pct
  const headerText = row.excluded ? 'Excluded' : (row.scoreable === false ? (CLASS_LABEL[row.call_class] || 'Not scored') : (row.auto_fail && !dirty ? 'FAIL' : pct(shownPct)))
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', background: '#f8fafc', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #e2e8f0', padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{agentOf(row)} · {c.brand}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(c.call_date)} · {c.source} · {c.direction} · {fmtDur(c.duration_seconds)}{c.customer_number ? ` · 📞 ${c.customer_number}` : ''}{c.customer_name ? ` · ${c.customer_name}` : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: notScored ? 15 : 26, fontWeight: 800, color: notScored ? '#64748b' : scoreColor(shownPct) }}>{headerText}</div>
            {dirty && !notScored && <div style={{ fontSize: 11, color: '#8d6e00' }}>adjusted preview</div>}
            {row.manager_adjusted && !dirty && <div style={{ fontSize: 11, color: '#8d6e00' }}>manager-adjusted</div>}
            <button onClick={onClose} style={{ ...btn('ghost'), padding: '2px 8px', marginTop: 2 }}>Close ✕</button>
          </div>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {notScored && <Card style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}><b style={{ color: '#475569' }}>Not counted toward the agent's score</b> <span style={{ fontSize: 13, color: '#64748b' }}>— {row.excluded ? 'manually excluded' : (CLASS_LABEL[row.call_class] || 'non-conversation')}. Still shown here for reporting.</span></Card>}

          <Card style={{ background: os.bg, border: `1px solid ${os.fg}33` }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>CALL TYPE</div><div style={{ fontWeight: 700 }}>{CLASS_LABEL[row.call_class] || 'Conversation'}</div></div>
              <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>OPPORTUNITY</div><div style={{ fontWeight: 700 }}>{row.opportunity ? 'Yes' : 'No'}</div></div>
              <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>OUTCOME</div><div style={{ fontWeight: 700, color: os.fg }}>{row.outcome || '—'}</div></div>
              {row.outcome === 'Not Booked' && <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>REASON</div><div style={{ fontWeight: 700 }}>{row.not_booked_reason || '—'}</div></div>}
              {row.opportunity_context && <div style={{ flex: 1, minWidth: 180 }}><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>CALLER WANTED</div><div>{row.opportunity_context}</div></div>}
            </div>
            {(row.topics || []).length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{row.topics.map((t, i) => <Pill key={i} bg="#e0f2fe" fg="#075985">🏷 {t}</Pill>)}</div>}
          </Card>

          {(row.opportunity || row.revenue_tip) && (
            <Card style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: '#9a3412' }}>Revenue &amp; conversion</div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>ASKED FOR BOOKING</div><b style={{ color: row.asked_for_booking ? '#1b5e20' : '#b71c1c' }}>{row.asked_for_booking == null ? '—' : (row.asked_for_booking ? 'Yes' : 'No')}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>INFO BEFORE PRICING</div><b>{ynLabel(row.info_before_pricing)}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>FEE EXPECTATIONS SET</div><b>{ynLabel(row.set_fee_expectations)}</b></div>
                <div><div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>WINNABLE</div><b>{row.winnable == null ? '—' : (row.winnable ? 'Yes' : 'No')}</b></div>
              </div>
              {(row.objections || []).length > 0 && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{row.objections.map((o, i) => <Pill key={i} bg="#fee2e2" fg="#991b1b">⛔ {o}</Pill>)}</div>}
              {row.revenue_tip && <div style={{ marginTop: 10, fontSize: 13.5, color: '#7c2d12' }}><b>Biggest revenue lever:</b> {row.revenue_tip}</div>}
            </Card>
          )}

          {(row.risk_flags || []).length > 0 && <Card style={{ background: '#fdecea', border: '1px solid #f5c6cb' }}><b style={{ color: '#b71c1c' }}>⚠ Risk flags</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{row.risk_flags.map((f, i) => <li key={i} style={{ fontSize: 13 }}>{f}</li>)}</ul></Card>}

          <Card><div style={{ fontWeight: 700, marginBottom: 4 }}>Summary</div><div style={{ fontSize: 13.5, color: '#334155' }}>{row.summary || '—'}</div></Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><div style={{ fontWeight: 700 }}>Detailed scoring</div>{canManage && ans != null && <span style={{ fontSize: 12, color: '#94a3b8' }}>managers can change any item ↓</span>}</div>
            {ans == null && <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading detailed scoring…</div>}
            {items.map(([k, a]) => {
              const isNa = a.na || a.answer === 'na'; const isYes = a.answer === 'yes'
              const col = isNa ? '#64748b' : isYes ? '#1b5e20' : '#b71c1c'
              return (
                <div key={k} style={{ padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.label || k}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                      {canManage
                        ? <select value={isNa ? 'na' : (isYes ? 'yes' : 'no')} onChange={(e) => setItem(k, e.target.value)} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #cbd5e1', color: col, fontWeight: 700 }}><option value="yes">✓ Yes</option><option value="no">✗ No</option><option value="na">N/A</option></select>
                        : <span style={{ fontWeight: 700, color: col }}>{isNa ? 'N/A' : (isYes ? '✓' : '✗')}</span>}
                      <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>({isNa ? 0 : a.max} pts)</span>
                    </div>
                  </div>
                  {a.rationale && <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>{a.rationale}</div>}
                  {(a.misses || []).length > 0 && !isNa && !isYes && <div style={{ fontSize: 12, color: '#b71c1c', marginTop: 2 }}>Missed: {a.misses.join(', ')}</div>}
                  {a.evidence && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>“{a.evidence}”</div>}
                </div>
              )
            })}
          </Card>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card style={{ flex: 1, minWidth: 240 }}><div style={{ fontWeight: 700, marginBottom: 6, color: '#1b5e20' }}>What went well</div><ul style={{ margin: 0, paddingLeft: 18 }}>{(row.strengths || []).map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{s}</li>)}</ul></Card>
            <Card style={{ flex: 1, minWidth: 240 }}><div style={{ fontWeight: 700, marginBottom: 6, color: '#b71c1c' }}>Coaching focus (revenue)</div><ul style={{ margin: 0, paddingLeft: 18 }}>{(row.improvements || []).map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{s}</li>)}</ul></Card>
          </div>

          <Card style={{ background: '#f0fdfa', border: '1px solid #99f6e4' }}><div style={{ fontWeight: 700, marginBottom: 4, color: TEAL }}>Coaching note</div><div style={{ fontSize: 13.5, color: '#134e4a' }}>{row.coaching_note || '—'}</div></Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><div style={{ fontWeight: 700 }}>Transcript</div>{c.recording_url && <RecordingBtn callId={c.id} />}</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: '#334155', margin: 0, maxHeight: 320, overflowY: 'auto', lineHeight: 1.5 }}>{transcript == null ? 'Loading transcript…' : (formatTranscript(transcript) || 'No transcript.')}</pre>
          </Card>

          <NotesCard callId={c.id} meName={meName} userId={userId} canDelete={canManage} />

          {canManage && (
            <Card>
              {dirty && <input placeholder="Why are you adjusting this? (optional note)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} />}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {dirty && <button disabled={busy === row.id} onClick={() => onAdjust(row.id, ans, note)} style={btn('primary')}>{busy === row.id ? 'Saving…' : `Save adjustments → ${pct(preview.pct)}`}</button>}
                <button disabled={busy === c.id} onClick={() => onRescore(c.id)} style={btn('ghost')}>{busy === c.id ? 'Scoring…' : '↻ Re-score with AI'}</button>
                {row.excluded
                  ? <button disabled={busy === row.id} onClick={() => onExclude(row.id, false)} style={btn('ghost')}>Include in scoring</button>
                  : <button disabled={busy === row.id} onClick={() => onExclude(row.id, true)} style={btn('ghost')}>Exclude from scoring</button>}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// Notes thread on a single call. Shared between managers and the client portal:
// anyone who can see the call can read and add notes; only managers can delete.
// Backed by ai_qa_notes (RLS-scoped to the caller's client / staff role).
function NotesCard({ callId, meName, userId, canDelete }) {
  const [notes, setNotes] = useState(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const loadNotes = useCallback(async () => {
    if (!callId) return
    const { data } = await supabase.from('ai_qa_notes').select('*').eq('call_id', callId).order('created_at', { ascending: true })
    setNotes(data || [])
  }, [callId])
  useEffect(() => { loadNotes() }, [loadNotes])
  async function add() {
    const text = body.trim(); if (!text || !callId) return
    setSaving(true)
    const { error } = await supabase.from('ai_qa_notes').insert({ call_id: callId, author_id: userId || null, author_name: meName || 'User', body: text })
    setSaving(false)
    if (error) { alert('Could not save note: ' + error.message); return }
    setBody(''); loadNotes()
  }
  async function del(id) {
    setSaving(true)
    await supabase.from('ai_qa_notes').delete().eq('id', id)
    setSaving(false); loadNotes()
  }
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Notes {notes && notes.length > 0 && <span style={{ color: '#94a3b8', fontWeight: 600 }}>({notes.length})</span>}</div>
      {notes == null ? <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</div> : notes.length === 0
        ? <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>No notes yet. Add the first one below.</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{n.author_name || 'User'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{n.created_at ? new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>
                    {canDelete && <button onClick={() => del(n.id)} style={{ border: 'none', background: 'none', color: '#b71c1c', cursor: 'pointer', fontSize: 12, padding: 0 }}>Delete</button>}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, color: '#0f172a', marginTop: 3, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              </div>
            ))}
          </div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note about this call…" rows={2}
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
        <button disabled={saving || !body.trim()} onClick={add} style={{ ...btn('primary'), opacity: saving || !body.trim() ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Add note'}</button>
      </div>
    </Card>
  )
}

function SettingsTab({ settings, secretKeys, pipeline, base, onSave, busy }) {
  const required = [['callqa_webhook_secret', 'Inbound webhook secret'], ['anthropic_api_key', 'Claude scoring'], ['deepgram_api_key', 'Deepgram transcription'], ['callrail_api_key', 'CallRail API']]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Pipeline</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {['ingested', 'needs_transcription', 'transcribing', 'ready', 'scoring', 'scored', 'error'].map((s) => (
            <Pill key={s} bg="#f1f5f9" fg="#475569">{s}: {pipeline[s] || 0}</Pill>
          ))}
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Integration status</div>
        {required.map(([k, d]) => { const on = secretKeys.includes(k); return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
            <Pill bg={on ? '#e8f5e9' : '#fdecea'} fg={on ? '#1b5e20' : '#b71c1c'}>{on ? 'SET' : 'MISSING'}</Pill><code style={{ fontSize: 13 }}>{k}</code><span style={{ fontSize: 12, color: '#64748b' }}>{d}</span>
          </div>
        )})}
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Per-campaign automation</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#475569' }}>{['Campaign', 'Enabled', 'Auto-score', 'Min sec', 'Pass %', 'Model', ''].map((h) => <th key={h} style={{ padding: '6px 8px' }}>{h}</th>)}</tr></thead>
          <tbody>{settings.map((s) => <SettingRow key={s.campaign} s={s} onSave={onSave} busy={busy} />)}{!settings.length && <tr><td colSpan={7} style={{ color: '#64748b', padding: 8 }}>No campaigns.</td></tr>}</tbody>
        </table>
      </Card>
    </div>
  )
}
function SettingRow({ s, onSave, busy }) {
  const [d, setD] = useState(s); const dirty = JSON.stringify(d) !== JSON.stringify(s)
  return (
    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.campaign}</td>
      <td style={{ padding: '6px 8px' }}><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /></td>
      <td style={{ padding: '6px 8px' }}><input type="checkbox" checked={d.auto_score} onChange={(e) => setD({ ...d, auto_score: e.target.checked })} /></td>
      <td style={{ padding: '6px 8px' }}><input type="number" value={d.min_duration_seconds} onChange={(e) => setD({ ...d, min_duration_seconds: Number(e.target.value) })} style={inp(60)} /></td>
      <td style={{ padding: '6px 8px' }}><input type="number" value={d.pass_threshold} onChange={(e) => setD({ ...d, pass_threshold: Number(e.target.value) })} style={inp(60)} /></td>
      <td style={{ padding: '6px 8px' }}><input value={d.model} onChange={(e) => setD({ ...d, model: e.target.value })} style={inp(200)} /></td>
      <td style={{ padding: '6px 8px' }}>{dirty && <button disabled={busy === 'settings'} onClick={() => onSave(d)} style={{ ...btn('primary'), padding: '4px 10px' }}>Save</button>}</td>
    </tr>
  )
}

function Select({ label, value, onChange, opts }) {
  return (
    <label style={{ fontSize: 12, color: '#64748b' }}>
      <div style={{ marginBottom: 3, fontWeight: 600 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13 }}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  )
}
function RecordingBtn({ callId }) {
  const [url, setUrl] = useState(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState(false)
  async function loadRec() {
    setLoading(true); setErr(false)
    try {
      const { data, error } = await supabase.functions.invoke('callqa-recording', { body: { call_id: callId } })
      if (error) throw error
      // proxy returns either {url} (signed, seekable) or the audio bytes as a Blob
      if (data && !(data instanceof Blob) && data.url) setUrl(data.url)
      else { const blob = data instanceof Blob ? data : new Blob([data], { type: 'audio/mpeg' }); setUrl(URL.createObjectURL(blob)) }
    } catch (e) { setErr(true) }
    setLoading(false)
  }
  if (url) return <audio controls autoPlay src={url} style={{ height: 34 }} />
  return <button onClick={loadRec} disabled={loading} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 13 }}>{loading ? 'Loading…' : (err ? '↻ Retry' : '▶ Recording')}</button>
}
const inp = (w) => ({ padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', width: w, fontSize: 13 })
function btn(kind) {
  if (kind === 'primary') return { background: TEAL, color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
  return { background: '#fff', color: '#334155', border: '1px solid #cbd5e1', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
}
