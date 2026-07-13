import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { canAny } from '../lib/permissions'

// ============================================================
// QUALITY AUDIT
// Replaces the Google Form. Auditors score calls natively; results
// roll up into sc_quality -> sc_scorecard (no BigQuery for scoring).
// The call FEED (which calls to audit) is still BQ-fed into qa_call_queue.
//
// Tabs:
//   New audit  — data-driven scorecard from qa_questions, live score + auto-fail
//   Queue      — unaudited calls from qa_call_queue (BQ feed)
//   Results    — recent audits + per-agent averages
//
// AI phase later: audits with source='ai' and a transcript plug into the
// same qa_audits table with no schema change.
// ============================================================

const AUDIT_TYPES = [
  ['conversation', 'Conversation'],
  ['voicemail', 'Voicemail'],
  ['no_answer', 'No Answer / Missed'],
  ['disposition', 'Disposition Correction'],
]
const typeLabel = (t) => (AUDIT_TYPES.find(x => x[0] === t)?.[1] || t)

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

function scoreColor(score) {
  if (score == null) return { bg: 'var(--canvas)', text: 'var(--ink-soft)' }
  if (score >= 90) return { bg: 'var(--passed-bg)', text: 'var(--passed)' }
  if (score >= 80) return { bg: 'var(--accent-bg)', text: 'var(--accent)' }
  if (score >= 70) return { bg: 'var(--needed-bg)', text: 'var(--needed)' }
  return { bg: 'var(--failed-bg)', text: 'var(--failed)' }
}
function tierText(score) {
  if (score == null) return '—'
  if (score >= 90) return 'Great · Token Eligible'
  if (score >= 80) return 'Meets Expectations'
  if (score >= 70) return 'Needs Improvement'
  return 'Coaching Offered'
}

export default function QualityAudit() {
  const { appRole } = useAuth()
  const isAuditor = canAny(appRole, 'quality_audit')
  const [tab, setTab] = useState(isAuditor ? 'new' : 'results')

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title">Quality</h1>
        <p className="page-sub">Score calls, work the audit queue, and track quality — feeding the scorecard directly.</p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {isAuditor && <button className={'btn ' + (tab === 'new' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('new')}>New audit</button>}
        {isAuditor && <button className={'btn ' + (tab === 'queue' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('queue')}>Queue</button>}
        <button className={'btn ' + (tab === 'results' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('results')}>Results</button>
      </div>

      {tab === 'new' && isAuditor && <NewAudit onDone={() => setTab('results')} />}
      {tab === 'queue' && isAuditor && <Queue onPick={() => setTab('new')} />}
      {tab === 'results' && <Results isAuditor={isAuditor} />}
    </div>
  )
}

// ---------------- NEW AUDIT ----------------
function NewAudit({ prefill, onDone }) {
  const { user } = useAuth()
  const [questions, setQuestions] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const [auditType, setAuditType] = useState('conversation')
  const [agentName, setAgentName] = useState(prefill?.agent_name || '')
  const [callId, setCallId] = useState(prefill?.call_id || '')
  const [callDate, setCallDate] = useState(prefill?.call_date || new Date().toISOString().slice(0, 10))
  const [recording, setRecording] = useState(prefill?.recording_link || '')
  const [brand, setBrand] = useState(prefill?.brand || '')
  const [answers, setAnswers] = useState({})       // { question_id: true|false|null }
  const [autoFail, setAutoFail] = useState(false)
  const [curDisp, setCurDisp] = useState(prefill?.disposition || '')
  const [correctDisp, setCorrectDisp] = useState('')
  const [feedback, setFeedback] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [qRes, aRes] = await Promise.all([
        supabase.from('qa_questions').select('*').eq('active', true).order('sort_order'),
        supabase.from('sc_agents').select('agent_name, profile_id, status').order('agent_name'),
      ])
      if (qRes.error) throw qRes.error
      setQuestions(qRes.data || [])
      setAgents(aRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const typeQuestions = useMemo(
    () => questions.filter(q => q.audit_type === auditType).sort((a, b) => a.sort_order - b.sort_order),
    [questions, auditType]
  )

  // reset answers when the audit type changes
  useEffect(() => { setAnswers({}); setAutoFail(false) }, [auditType])

  // live score: earned / max of ANSWERED questions * 100; auto-fail forces 0
  const { earned, max, score } = useMemo(() => {
    let e = 0, m = 0
    for (const q of typeQuestions) {
      const v = answers[q.id]
      if (v === true) { e += Number(q.points); m += Number(q.points) }
      else if (v === false) { m += Number(q.points) }
      // null/unanswered doesn't count toward max, so partial audits still read sensibly
    }
    const s = autoFail ? 0 : (m > 0 ? Math.round((e / m) * 100) : null)
    return { earned: e, max: m, score: s }
  }, [typeQuestions, answers, autoFail])

  function setAnswer(qid, val) {
    setAnswers(prev => ({ ...prev, [qid]: prev[qid] === val ? null : val }))
  }

  async function save() {
    if (!agentName) { setErr('Pick an agent.'); return }
    setSaving(true); setErr(''); setSavedMsg('')
    const agent = agents.find(a => a.agent_name === agentName)
    const row = {
      agent_name: agentName,
      profile_id: agent?.profile_id || null,
      auditor_id: user?.id || null,
      audit_type: auditType,
      source: 'manual',
      call_id: callId || null,
      call_date: callDate || null,
      recording_link: recording || null,
      brand: brand || null,
      answers,
      earned_points: earned,
      max_points: max,
      clean_qa_score: score,
      auto_fail: autoFail,
      current_disposition: curDisp || null,
      correct_disposition: correctDisp || null,
      feedback: feedback || null,
    }
    const { error } = await supabase.from('qa_audits').insert(row)
    // if this call came from the queue, it will simply stop showing as unaudited
    setSaving(false)
    if (error) { setErr(error.message); return }
    setSavedMsg(`Saved — ${agentName}: ${score == null ? 'n/a' : score + '%'}${autoFail ? ' (auto-fail)' : ''}`)
    // reset the scoring part but keep type + agent for fast consecutive audits
    setAnswers({}); setAutoFail(false); setCallId(''); setRecording(''); setFeedback('')
    setCurDisp(''); setCorrectDisp('')
    if (onDone) setTimeout(onDone, 900)
  }

  if (loading) return <p className="page-sub">Loading form…</p>

  const sc = scoreColor(score)
  const showDisposition = auditType === 'disposition' || auditType === 'voicemail' || auditType === 'no_answer'

  return (
    <div style={{ maxWidth: 880 }}>
      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 14 }}><b style={{ color: 'var(--failed)' }}>Error.</b> <span className="page-sub">{err}</span></div>}
      {savedMsg && <div className="card" style={{ borderColor: 'var(--passed)', marginBottom: 14 }}><b style={{ color: 'var(--passed)' }}>{savedMsg}</b></div>}

      {/* audit type */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {AUDIT_TYPES.map(([k, label]) => (
          <button key={k} className={'btn ' + (auditType === k ? 'btn-primary' : 'btn-ghost')} onClick={() => setAuditType(k)}>{label}</button>
        ))}
      </div>

      {/* call meta */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Field label="Agent">
            <select value={agentName} onChange={e => setAgentName(e.target.value)} style={inputStyle}>
              <option value="">Select agent…</option>
              {agents.map(a => <option key={a.agent_name} value={a.agent_name}>{a.agent_name}{a.status !== 'Active' ? ` (${a.status})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Call ID / Link"><input value={callId} onChange={e => setCallId(e.target.value)} style={inputStyle} placeholder="Call ID" /></Field>
          <Field label="Call date"><input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} style={inputStyle} /></Field>
          <Field label="Brand"><input value={brand} onChange={e => setBrand(e.target.value)} style={inputStyle} placeholder="Brand / lead type" /></Field>
          <Field label="Recording link"><input value={recording} onChange={e => setRecording(e.target.value)} style={inputStyle} placeholder="https://…" /></Field>
        </div>
      </div>

      {/* questions */}
      <div className="card" style={{ marginBottom: 14 }}>
        <SectionTitle>{typeLabel(auditType)} scorecard</SectionTitle>
        {typeQuestions.map(q => {
          const v = answers[q.id]
          return (
            <div key={q.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220, fontSize: 13.5 }}>
                {q.label}
                {Number(q.points) > 0 && <span className="page-sub" style={{ marginLeft: 8, fontSize: 12 }}>({q.points} pts)</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={'btn ' + (v === true ? 'btn-primary' : 'btn-ghost')} style={{ padding: '5px 14px' }} onClick={() => setAnswer(q.id, true)}>Yes</button>
                <button className={'btn ' + (v === false ? 'btn-primary' : 'btn-ghost')} style={{ padding: '5px 14px' }} onClick={() => setAnswer(q.id, false)}>No</button>
              </div>
            </div>
          )
        })}

        {showDisposition && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14, borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
            <Field label="Current disposition"><input value={curDisp} onChange={e => setCurDisp(e.target.value)} style={inputStyle} /></Field>
            <Field label="Correct disposition"><input value={correctDisp} onChange={e => setCorrectDisp(e.target.value)} style={inputStyle} /></Field>
          </div>
        )}
      </div>

      {/* feedback + auto-fail + live score */}
      <div className="card" style={{ marginBottom: 14 }}>
        <SectionTitle>Feedback</SectionTitle>
        <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3} placeholder="Coaching notes for this call…"
          style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoFail} onChange={e => setAutoFail(e.target.checked)} />
          <b>Auto-fail</b> <span className="page-sub">— forces this audit's clean score to 0%</span>
        </label>
      </div>

      {/* sticky-ish score summary + save */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'center', padding: '8px 18px', borderRadius: 10, background: sc.bg, color: sc.text, minWidth: 96 }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{score == null ? '—' : score + '%'}</div>
            <div style={{ fontSize: 11, fontWeight: 700 }}>{tierText(score)}</div>
          </div>
          <div className="page-sub" style={{ fontSize: 12.5 }}>
            {autoFail ? 'Auto-fail applied' : `${earned} / ${max} pts answered`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save audit'}</button>
      </div>
    </div>
  )
}

// ---------------- QUEUE (BQ-fed) ----------------
function Queue({ onPick }) {
  const [rows, setRows] = useState([])
  const [audited, setAudited] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [qRes, aRes] = await Promise.all([
        supabase.from('qa_call_queue').select('*').order('call_date', { ascending: false }).limit(500),
        supabase.from('qa_audits').select('call_id'),
      ])
      if (qRes.error) throw qRes.error
      setRows(qRes.data || [])
      setAudited(new Set((aRes.data || []).map(a => a.call_id).filter(Boolean)))
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <p className="page-sub">Loading queue…</p>
  if (err) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load queue.</b> <span className="page-sub">{err}</span><p className="page-sub" style={{ marginTop: 8 }}>The queue is fed from BigQuery into <code>qa_call_queue</code>. If it's empty, the feed may not be connected yet.</p></div>

  const pending = rows.filter(r => !audited.has(r.call_id))

  if (picked) return (
    <div>
      <button className="btn btn-ghost" onClick={() => setPicked(null)} style={{ marginBottom: 12 }}>← Queue</button>
      <NewAudit prefill={picked} onDone={() => { setPicked(null); load() }} />
    </div>
  )

  if (!pending.length) return (
    <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>
      {rows.length ? 'All queued calls have been audited. 🎉' : 'No calls in the queue yet. This feed comes from BigQuery.'}
    </div></div>
  )

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 720 }}>
          <thead><tr style={{ background: 'var(--canvas)', textAlign: 'left' }}>
            <Th>Date</Th><Th>Agent</Th><Th>Brand</Th><Th>Customer</Th><Th>Disposition</Th><Th></Th>
          </tr></thead>
          <tbody>
            {pending.map(r => (
              <tr key={r.call_id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                <Td>{fmtDate(r.call_date)}</Td>
                <Td><b>{r.agent_name || '—'}</b></Td>
                <Td>{r.brand || '—'}</Td>
                <Td>{[r.customer_first_name, r.customer_last_name].filter(Boolean).join(' ') || '—'}</Td>
                <Td>{r.disposition || '—'}</Td>
                <Td><button className="btn btn-primary" style={{ padding: '5px 12px' }} onClick={() => setPicked(r)}>Audit</button></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------- RESULTS ----------------
function Results({ isAuditor }) {
  const [audits, setAudits] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.from('qa_audits').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) setErr(error.message)
    setAudits(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const byAgent = useMemo(() => {
    const conv = audits.filter(a => a.audit_type === 'conversation' && a.clean_qa_score != null)
    const m = {}
    conv.forEach(a => { (m[a.agent_name] = m[a.agent_name] || []).push(a.clean_qa_score) })
    return Object.entries(m).map(([name, arr]) => ({
      name, n: arr.length, avg: Math.round(arr.reduce((s, x) => s + x, 0) / arr.length),
    })).sort((a, b) => b.avg - a.avg)
  }, [audits])

  if (loading) return <p className="page-sub">Loading results…</p>
  if (err) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load.</b> <span className="page-sub">{err}</span></div>
  if (!audits.length) return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No audits yet.</div></div>

  return (
    <div>
      {isAuditor && byAgent.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <SectionTitle>Average clean score by agent (conversation audits)</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {byAgent.map(a => {
              const c = scoreColor(a.avg)
              return (
                <div key={a.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--line-soft)', borderRadius: 8 }}>
                  <div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div><div className="page-sub" style={{ fontSize: 11.5 }}>{a.n} audit{a.n !== 1 ? 's' : ''}</div></div>
                  <span className="badge" style={{ background: c.bg, color: c.text, fontWeight: 800 }}>{a.avg}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 760 }}>
            <thead><tr style={{ background: 'var(--canvas)', textAlign: 'left' }}>
              <Th>When</Th><Th>Agent</Th><Th>Type</Th><Th>Brand</Th><Th right>Score</Th><Th>Flags</Th>
            </tr></thead>
            <tbody>
              {audits.map(a => {
                const c = scoreColor(a.clean_qa_score)
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                    <Td>{fmtDateTime(a.created_at)}</Td>
                    <Td><b>{a.agent_name}</b></Td>
                    <Td>{typeLabel(a.audit_type)}</Td>
                    <Td>{a.brand || '—'}</Td>
                    <Td right>{a.clean_qa_score == null ? '—' : <span className="badge" style={{ background: c.bg, color: c.text, fontWeight: 700 }}>{a.clean_qa_score}%</span>}</Td>
                    <Td>{a.auto_fail ? <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)' }}>Auto-fail</span> : (a.source === 'ai' ? <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>AI</span> : '')}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------- shared bits ----------------
const inputStyle = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--canvas)', width: '100%' }
function Field({ label, children }) {
  return <label style={{ display: 'block' }}><div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--ink-soft)', marginBottom: 5 }}>{label}</div>{children}</label>
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)', marginBottom: 10 }}>{children}</div>
}
function Th({ children, right }) {
  return <th style={{ padding: '11px 14px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, right }) {
  return <td style={{ padding: '11px 14px', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</td>
}
