import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'

// ============================================================
// CALL QA (AI) — automated call scoring, coaching & trends
// - Ingests recordings/transcripts from CallRail / Lightspeed / Five9 via the
//   `callqa-ingest` edge function into ai_qa_calls.
// - Scores each transcript against the qa_questions rubric via `callqa-score`,
//   writing ai_qa_reviews (per-question + 4 canonical sections + coaching).
// - Managers (quality_audit.call_reviews) see all; agents see only their own.
//   Server-side RLS enforces this regardless of the UI.
// ============================================================

const SECTIONS = [
  { key: 'greeting_compliance', label: 'Greeting & Compliance' },
  { key: 'discovery_needs', label: 'Discovery & Needs' },
  { key: 'solution_pitch', label: 'Solution & Pitch' },
  { key: 'close_next_steps', label: 'Close & Next Steps' },
]
const TEAL = '#0f766e'
const canViewAll = (r) => can(r, 'quality_audit.call_reviews') || can(r, 'service_performance_scorecard.view_all_scorecards')

const scoreColor = (v) => (v == null ? '#94a3b8' : v >= 85 ? '#1b5e20' : v >= 70 ? '#8d6e00' : '#b71c1c')
const scoreBg = (v) => (v == null ? '#f1f5f9' : v >= 85 ? '#e8f5e9' : v >= 70 ? '#fff8e1' : '#fdecea')
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')
const fmtDur = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const SENTIMENT = { positive: { t: '🙂 Positive', c: '#1b5e20' }, neutral: { t: '😐 Neutral', c: '#8d6e00' }, negative: { t: '🙁 Negative', c: '#b71c1c' } }

// small inline UI atoms -----------------------------------------------------
const Card = ({ children, style }) => (
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, ...style }}>{children}</div>
)
const Tile = ({ label, value, sub, color }) => (
  <Card style={{ flex: 1, minWidth: 140 }}>
    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: color || '#0f172a', marginTop: 4 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
  </Card>
)
const Bar = ({ v, color }) => (
  <div style={{ background: '#eef2f7', borderRadius: 6, height: 8, overflow: 'hidden' }}>
    <div style={{ width: `${Math.max(0, Math.min(100, v || 0))}%`, height: '100%', background: color || TEAL }} />
  </div>
)
const Pill = ({ children, bg, fg }) => (
  <span style={{ background: bg, color: fg, fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>{children}</span>
)

export default function CallQA() {
  const { appRole, user } = useAuth()
  const viewAll = canViewAll(appRole)
  const [tab, setTab] = useState('overview')
  const [rows, setRows] = useState([])          // reviews with embedded call
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [settings, setSettings] = useState([])
  const [secretKeys, setSecretKeys] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState('')

  // filters
  const [days, setDays] = useState(30)
  const [campaign, setCampaign] = useState('all')
  const [agent, setAgent] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase
      .from('ai_qa_reviews')
      .select('id, campaign, score_pct, auto_fail, section_scores, strengths, improvements, coaching_note, sentiment, risk_flags, summary, status, created_at, call:ai_qa_calls(id, agent_name, profile_id, brand, source, direction, disposition, call_date, duration_seconds, recording_url, transcript, campaign)')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) { setErr(error.message); setLoading(false); return }
    setRows(data || [])
    const [{ data: st }, { data: sk }] = await Promise.all([
      supabase.from('ai_qa_settings').select('*').order('campaign'),
      supabase.from('integration_secrets').select('key'),
    ])
    setSettings(st || [])
    setSecretKeys((sk || []).map((r) => r.key))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // filtered set ------------------------------------------------------------
  const filtered = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
    return rows.filter((r) => {
      const c = r.call || {}
      const d = c.call_date ? new Date(c.call_date) : new Date(r.created_at)
      if (d < cutoff) return false
      if (campaign !== 'all' && r.campaign !== campaign) return false
      if (agent !== 'all' && c.agent_name !== agent) return false
      return true
    })
  }, [rows, days, campaign, agent])

  const agents = useMemo(() => Array.from(new Set(rows.map((r) => r.call?.agent_name).filter(Boolean))).sort(), [rows])
  const campaigns = useMemo(() => Array.from(new Set(rows.map((r) => r.campaign).filter(Boolean))).sort(), [rows])

  // aggregates --------------------------------------------------------------
  const agg = useMemo(() => {
    const n = filtered.length
    const avg = n ? filtered.reduce((s, r) => s + (Number(r.score_pct) || 0), 0) / n : null
    const passThresh = 85
    const passRate = n ? (filtered.filter((r) => Number(r.score_pct) >= passThresh).length / n) * 100 : null
    const autoFails = filtered.filter((r) => r.auto_fail).length
    const flags = filtered.filter((r) => (r.risk_flags || []).length).length
    const sec = {}
    for (const s of SECTIONS) {
      const vals = filtered.map((r) => r.section_scores?.[s.key]?.pct).filter((v) => v != null)
      sec[s.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    const sentiments = { positive: 0, neutral: 0, negative: 0 }
    filtered.forEach((r) => { if (sentiments[r.sentiment] != null) sentiments[r.sentiment]++ })
    return { n, avg, passRate, autoFails, flags, sec, sentiments }
  }, [filtered])

  // score trend by day
  const trend = useMemo(() => {
    const m = new Map()
    filtered.forEach((r) => {
      const d = (r.call?.call_date) || r.created_at.slice(0, 10)
      if (!m.has(d)) m.set(d, [])
      m.get(d).push(Number(r.score_pct) || 0)
    })
    return Array.from(m.entries())
      .map(([d, arr]) => ({ d, avg: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length }))
      .sort((a, b) => a.d.localeCompare(b.d))
  }, [filtered])

  // per-agent coaching rollup
  const byAgent = useMemo(() => {
    const m = new Map()
    filtered.forEach((r) => {
      const a = r.call?.agent_name || 'Unknown'
      if (!m.has(a)) m.set(a, { name: a, scores: [], improvements: {}, calls: 0, autoFails: 0 })
      const o = m.get(a)
      o.calls++; o.scores.push(Number(r.score_pct) || 0)
      if (r.auto_fail) o.autoFails++
      ;(r.improvements || []).forEach((i) => { o.improvements[i] = (o.improvements[i] || 0) + 1 })
    })
    return Array.from(m.values()).map((o) => {
      const avg = o.scores.reduce((a, b) => a + b, 0) / o.scores.length
      const half = Math.floor(o.scores.length / 2)
      const recent = o.scores.slice(0, Math.max(1, half))
      const older = o.scores.slice(half)
      const rAvg = recent.reduce((a, b) => a + b, 0) / recent.length
      const oAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : rAvg
      const topThemes = Object.entries(o.improvements).sort((a, b) => b[1] - a[1]).slice(0, 3)
      return { ...o, avg, trend: rAvg - oAvg, topThemes }
    }).sort((a, b) => b.avg - a.avg)
  }, [filtered])

  // actions -----------------------------------------------------------------
  async function rescore(callId) {
    setBusy(callId)
    try {
      const { error } = await supabase.functions.invoke('callqa-score', { body: { call_id: callId } })
      if (error) throw error
      await load()
    } catch (e) { alert('Re-score failed: ' + (e.message || e)) }
    setBusy('')
  }
  async function setReviewStatus(reviewId, status) {
    await supabase.from('ai_qa_reviews').update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reviewId)
    await load()
  }
  async function saveSetting(s) {
    setBusy('settings')
    await supabase.from('ai_qa_settings').upsert(s, { onConflict: 'campaign' })
    await load(); setBusy('')
  }

  const base = import.meta.env.VITE_SUPABASE_URL || ''
  const TABS = [
    ['overview', 'Overview & Trends'],
    ['calls', 'Calls'],
    ['coaching', 'Coaching'],
    ...(viewAll ? [['settings', 'Settings']] : []),
  ]

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Call QA <span style={{ color: TEAL }}>(AI)</span></h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Automated scoring, coaching &amp; trends from CallRail / Lightspeed / Five9 transcripts.</div>
        </div>
        <button onClick={load} style={btn('ghost')}>↻ Refresh</button>
      </div>

      {/* filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
        <Select label="Range" value={days} onChange={(v) => setDays(Number(v))} opts={[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [3650, 'All time']]} />
        <Select label="Campaign" value={campaign} onChange={setCampaign} opts={[['all', 'All campaigns'], ...campaigns.map((c) => [c, c])]} />
        {viewAll && <Select label="Agent" value={agent} onChange={setAgent} opts={[['all', 'All agents'], ...agents.map((a) => [a, a])]} />}
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            border: 'none', background: 'none', padding: '10px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
            color: tab === k ? TEAL : '#64748b', borderBottom: tab === k ? `2px solid ${TEAL}` : '2px solid transparent',
          }}>{l}</button>
        ))}
      </div>

      {loading ? <div style={{ color: '#64748b' }}>Loading…</div> : err ? <Card style={{ color: '#b71c1c' }}>Error: {err}</Card> : (
        <>
          {tab === 'overview' && <Overview agg={agg} trend={trend} />}
          {tab === 'calls' && <Calls rows={filtered} onOpen={setSelected} viewAll={viewAll} />}
          {tab === 'coaching' && <Coaching byAgent={byAgent} />}
          {tab === 'settings' && viewAll && <SettingsTab settings={settings} secretKeys={secretKeys} base={base} onSave={saveSetting} busy={busy} />}
        </>
      )}

      {selected && (
        <Detail row={selected} onClose={() => setSelected(null)} onRescore={rescore} onStatus={setReviewStatus} busy={busy} viewAll={viewAll} />
      )}
    </div>
  )
}

// ---------------- Overview ----------------
function Overview({ agg, trend }) {
  const maxN = Math.max(1, ...trend.map((t) => t.n))
  const sTotal = agg.sentiments.positive + agg.sentiments.neutral + agg.sentiments.negative || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Calls scored" value={agg.n} />
        <Tile label="Avg QA score" value={agg.avg == null ? '—' : pct(agg.avg)} color={scoreColor(agg.avg)} />
        <Tile label="Pass rate (≥85%)" value={agg.passRate == null ? '—' : pct(agg.passRate)} />
        <Tile label="Auto-fails" value={agg.autoFails} color={agg.autoFails ? '#b71c1c' : '#0f172a'} />
        <Tile label="Risk flags" value={agg.flags} color={agg.flags ? '#8d6e00' : '#0f172a'} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 2, minWidth: 340 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Score by section</div>
          {SECTIONS.map((s) => (
            <div key={s.key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>{s.label}</span><b style={{ color: scoreColor(agg.sec[s.key]) }}>{pct(agg.sec[s.key])}</b>
              </div>
              <Bar v={agg.sec[s.key]} color={scoreColor(agg.sec[s.key])} />
            </div>
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Customer sentiment</div>
          {Object.entries(agg.sentiments).map(([k, v]) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: SENTIMENT[k].c }}>{SENTIMENT[k].t}</span><b>{v}</b>
              </div>
              <Bar v={(v / sTotal) * 100} color={SENTIMENT[k].c} />
            </div>
          ))}
        </Card>
      </div>

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

// ---------------- Calls list ----------------
function Calls({ rows, onOpen, viewAll }) {
  if (!rows.length) return <Card style={{ color: '#64748b' }}>No scored calls in this range.</Card>
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#475569' }}>
            {['Date', ...(viewAll ? ['Agent'] : []), 'Client', 'Campaign', 'Source', 'Disp.', 'Sentiment', 'Score', ''].map((h) => (
              <th key={h} style={{ padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = r.call || {}
            return (
              <tr key={r.id} onClick={() => onOpen(r)} style={{ borderTop: '1px solid #eef2f7', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.call_date)}</td>
                {viewAll && <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{c.agent_name}</td>}
                <td style={{ padding: '9px 12px' }}>{c.brand || '—'}</td>
                <td style={{ padding: '9px 12px' }}>{r.campaign}</td>
                <td style={{ padding: '9px 12px' }}><Pill bg="#eef2f7" fg="#475569">{c.source}</Pill></td>
                <td style={{ padding: '9px 12px', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.disposition || '—'}</td>
                <td style={{ padding: '9px 12px', color: SENTIMENT[r.sentiment]?.c }}>{SENTIMENT[r.sentiment]?.t.split(' ')[0] || '—'}</td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{ background: scoreBg(r.score_pct), color: scoreColor(r.score_pct), fontWeight: 700, padding: '3px 9px', borderRadius: 8 }}>
                    {r.auto_fail ? 'FAIL' : pct(r.score_pct)}
                  </span>
                </td>
                <td style={{ padding: '9px 12px', color: '#94a3b8' }}>›</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

// ---------------- Coaching rollup ----------------
function Coaching({ byAgent }) {
  const [open, setOpen] = useState(null)
  if (!byAgent.length) return <Card style={{ color: '#64748b' }}>No data in range.</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {byAgent.map((a) => (
        <Card key={a.name} style={{ padding: 0 }}>
          <div onClick={() => setOpen(open === a.name ? null : a.name)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, cursor: 'pointer' }}>
            <div style={{ width: 48, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(a.avg) }}>{Math.round(a.avg)}</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>avg</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{a.name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{a.calls} calls scored{a.autoFails ? ` · ${a.autoFails} auto-fail` : ''}</div>
            </div>
            <Pill bg={a.trend >= 0 ? '#e8f5e9' : '#fdecea'} fg={a.trend >= 0 ? '#1b5e20' : '#b71c1c'}>
              {a.trend >= 0 ? '▲' : '▼'} {Math.abs(a.trend).toFixed(1)} pts
            </Pill>
            <span style={{ color: '#94a3b8' }}>{open === a.name ? '▾' : '›'}</span>
          </div>
          {open === a.name && (
            <div style={{ padding: '0 14px 14px 76px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Top coaching themes</div>
              {a.topThemes.length ? a.topThemes.map(([t, n]) => (
                <div key={t} style={{ fontSize: 13, marginBottom: 4 }}>• {t} <span style={{ color: '#94a3b8' }}>×{n}</span></div>
              )) : <div style={{ fontSize: 13, color: '#64748b' }}>No recurring issues — solid across the board.</div>}
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

// ---------------- Detail drawer ----------------
function Detail({ row, onClose, onRescore, onStatus, busy, viewAll }) {
  const c = row.call || {}
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 100%)', background: '#f8fafc', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #e2e8f0', padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{c.agent_name} · {c.brand}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(c.call_date)} · {c.source} · {c.direction} · {fmtDur(c.duration_seconds)} · {row.campaign}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: scoreColor(row.score_pct) }}>{row.auto_fail ? 'FAIL' : pct(row.score_pct)}</div>
            <button onClick={onClose} style={{ ...btn('ghost'), padding: '2px 8px', marginTop: 2 }}>Close ✕</button>
          </div>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(row.risk_flags || []).length > 0 && (
            <Card style={{ background: '#fdecea', border: '1px solid #f5c6cb' }}>
              <b style={{ color: '#b71c1c' }}>⚠ Risk flags</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{row.risk_flags.map((f, i) => <li key={i} style={{ fontSize: 13 }}>{f}</li>)}</ul>
            </Card>
          )}

          <Card>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Summary</div>
            <div style={{ fontSize: 13.5, color: '#334155' }}>{row.summary || '—'}</div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Section breakdown</div>
            {SECTIONS.map((s) => {
              const sc = row.section_scores?.[s.key]
              return (
                <div key={s.key} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>{s.label}</span>
                    <b style={{ color: scoreColor(sc?.pct) }}>{sc ? `${sc.earned}/${sc.max} · ${pct(sc.pct)}` : '—'}</b>
                  </div>
                  <Bar v={sc?.pct} color={scoreColor(sc?.pct)} />
                </div>
              )
            })}
          </Card>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#1b5e20' }}>What went well</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{(row.strengths || []).map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{s}</li>)}</ul>
            </Card>
            <Card style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#b71c1c' }}>Opportunities</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{(row.improvements || []).map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{s}</li>)}</ul>
            </Card>
          </div>

          <Card style={{ background: '#f0fdfa', border: '1px solid #99f6e4' }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: TEAL }}>Coaching note</div>
            <div style={{ fontSize: 13.5, color: '#134e4a' }}>{row.coaching_note || '—'}</div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>Transcript</div>
              {c.recording_url && <a href={c.recording_url} target="_blank" rel="noreferrer" style={{ color: TEAL, fontSize: 13 }}>▶ Recording</a>}
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: '#334155', margin: 0, maxHeight: 320, overflowY: 'auto' }}>{c.transcript || 'No transcript.'}</pre>
          </Card>

          {viewAll && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button disabled={busy === c.id} onClick={() => onRescore(c.id)} style={btn('primary')}>{busy === c.id ? 'Scoring…' : '↻ Re-score with AI'}</button>
              <button onClick={() => onStatus(row.id, 'approved')} style={btn('ghost')}>✓ Approve</button>
              <button onClick={() => onStatus(row.id, 'rejected')} style={btn('ghost')}>Dismiss</button>
              <Pill bg="#eef2f7" fg="#475569">status: {row.status}</Pill>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------- Settings ----------------
function SettingsTab({ settings, secretKeys, base, onSave, busy }) {
  const required = [
    ['callqa_webhook_secret', 'Shared secret validating inbound webhooks'],
    ['anthropic_api_key', 'LLM key for scoring (Claude) — or openai_api_key'],
    ['callrail_api_key', 'CallRail API key (pull mode, optional)'],
    ['lightspeed_api_key', 'Lightspeed API key (optional)'],
  ]
  const ingest = `${base}/functions/v1/callqa-ingest`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Integration status</div>
        {required.map(([k, d]) => {
          const on = secretKeys.includes(k)
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
              <Pill bg={on ? '#e8f5e9' : '#fdecea'} fg={on ? '#1b5e20' : '#b71c1c'}>{on ? 'SET' : 'MISSING'}</Pill>
              <code style={{ fontSize: 13 }}>{k}</code>
              <span style={{ fontSize: 12, color: '#64748b' }}>{d}</span>
            </div>
          )
        })}
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>
          Add keys in Supabase → <code>integration_secrets</code> (same table as Fathom/Tremendous). Webhook endpoint:
          <div style={{ marginTop: 6 }}><code style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: 6, display: 'inline-block' }}>{ingest}?provider=callrail</code></div>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Per-campaign automation</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#475569' }}>
            {['Campaign', 'Enabled', 'Auto-score', 'Min sec', 'Pass %', 'Model', ''].map((h) => <th key={h} style={{ padding: '6px 8px' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {settings.map((s) => <SettingRow key={s.campaign} s={s} onSave={onSave} busy={busy} />)}
            {!settings.length && <tr><td colSpan={7} style={{ color: '#64748b', padding: 8 }}>No campaigns configured.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
function SettingRow({ s, onSave, busy }) {
  const [d, setD] = useState(s)
  const dirty = JSON.stringify(d) !== JSON.stringify(s)
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

// ---------------- shared bits ----------------
function Select({ label, value, onChange, opts }) {
  return (
    <label style={{ fontSize: 12, color: '#64748b' }}>
      <div style={{ marginBottom: 3, fontWeight: 600 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13 }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}
const inp = (w) => ({ padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', width: w, fontSize: 13 })
function btn(kind) {
  if (kind === 'primary') return { background: TEAL, color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
  return { background: '#fff', color: '#334155', border: '1px solid #cbd5e1', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
}
