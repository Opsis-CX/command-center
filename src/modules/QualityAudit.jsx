import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import ExternalQA, { ClientRecaps } from './ExternalQA'
import QualityReporting from './QualityReporting'
import { canAny } from '../lib/permissions'
import { notifyCallReviewAssigned, notifyCallReviewSubmitted } from '../lib/notify'
import { downloadCSV } from './projectCsv'

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

const CAMPAIGNS = [
  ['lavin', 'Lavin'],
  ['open_invoices', 'Open Invoices'],
]
const BRANDS = {
  lavin: ['Apple', 'Cedar Park', 'Cheney', 'Cunningham', 'Genson', 'Omaha', 'TVG', 'Quality', 'PDQ', 'Inbound - No Brand'],
  open_invoices: ['Cedar Park', 'Omaha', 'Inbound - No Brand'],
}
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
  const canSeeResults = canAny(appRole, 'quality_audit.view_own')
  // Agents land straight on their call reviews; auditors keep their old default.
  const [tab, setTab] = useState(isAuditor ? 'new' : canSeeResults ? 'results' : 'reviews')
  const [editing, setEditing] = useState(null)  // qa_audits row being corrected

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title">Quality</h1>
        <p className="page-sub">{isAuditor
          ? 'Score calls, work the audit queue, assign call reviews, and track quality — feeding the scorecard directly.'
          : 'Review your assigned calls and reflect on what went well and what to improve.'}</p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {isAuditor && <button className={'btn ' + (tab === 'new' ? 'btn-primary' : 'btn-ghost')} onClick={() => { setEditing(null); setTab('new') }}>New audit</button>}
        {isAuditor && <button className={'btn ' + (tab === 'queue' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('queue')}>Queue</button>}
        {canSeeResults && <button className={'btn ' + (tab === 'results' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('results')}>Results</button>}
        <button className={'btn ' + (tab === 'reviews' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('reviews')}>Call reviews</button>
        {isAuditor && <button className={'btn ' + (tab === 'external' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('external')}>External QA</button>}
        {isAuditor && <button className={'btn ' + (tab === 'recaps' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('recaps')}>Client recaps</button>}
        {isAuditor && <button className={'btn ' + (tab === 'reporting' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('reporting')}>Reporting</button>}
      </div>

      {tab === 'new' && isAuditor && (
        <NewAudit
          key={editing?.id || 'new'}   // remount so the form seeds from the audit being edited
          editAudit={editing}
          onDone={() => { setEditing(null); setTab('results') }}
        />
      )}
      {tab === 'queue' && isAuditor && <Queue onPick={() => { setEditing(null); setTab('new') }} />}
      {tab === 'results' && canSeeResults && (
        <Results isAuditor={isAuditor} onEdit={(a) => { setEditing(a); setTab('new') }} />
      )}
      {tab === 'reviews' && <CallReviews isAuditor={isAuditor} />}
      {tab === 'external' && isAuditor && <ExternalQA />}
      {tab === 'recaps' && isAuditor && <ClientRecaps />}
      {tab === 'reporting' && isAuditor && <QualityReporting />}
    </div>
  )
}

// Manager-only editor for the Brand / Location dropdown options (qa_brands).
// Changes apply immediately for everyone; RLS limits writes to managers.
function BrandManager({ campaign, onClose, onChanged }) {
  const [rows, setRows] = useState(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('qa_brands').select('*').eq('campaign', campaign).order('sort_order')
    if (error) setErr(error.message); else setRows(data || [])
  }, [campaign])
  useEffect(() => { load() }, [load])
  async function add() {
    const n = name.trim(); if (!n) return
    const sort_order = rows && rows.length ? Math.max(...rows.map(r => r.sort_order || 0)) + 1 : 1
    const { error } = await supabase.from('qa_brands').insert({ campaign, name: n, sort_order })
    if (error) setErr(error.message); else { setName(''); await load(); onChanged && onChanged() }
  }
  async function remove(r) {
    const { error } = await supabase.from('qa_brands').delete().eq('id', r.id)
    if (error) setErr(error.message); else { await load(); onChanged && onChanged() }
  }
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: 420, maxWidth: '100%', maxHeight: '85vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <b>Manage brands · {campaign}</b>
          <button onClick={onClose} style={{ border: 0, background: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>Options in the Brand / Location dropdown for this campaign. Changes apply immediately for everyone.</div>
        {err && <div style={{ color: 'var(--failed)', fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
        {rows == null ? <div style={{ color: 'var(--ink-soft)' }}>Loading…</div> : rows.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 14 }}>{r.name}</span>
            <button onClick={() => remove(r)} style={{ border: 0, background: 'none', color: 'var(--failed)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="Add a brand / location…" style={{ ...inputStyle, flex: 1 }} />
          <button className="btn btn-primary" onClick={add} disabled={!name.trim()}>Add</button>
        </div>
      </div>
    </div>
  )
}

// ---------------- NEW AUDIT ----------------
function NewAudit({ prefill, editAudit, onDone }) {
  const { user } = useAuth()
  const [questions, setQuestions] = useState([])
  const [subItems, setSubItems] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [meName, setMeName] = useState('')
  const [brandsByCampaign, setBrandsByCampaign] = useState({})
  const [managingBrands, setManagingBrands] = useState(false)

  // editAudit = a submitted audit being corrected; prefill = a queued call.
  const [campaign, setCampaign] = useState(editAudit?.campaign || 'lavin')
  const [auditType, setAuditType] = useState(editAudit?.audit_type || 'conversation')
  const [agentName, setAgentName] = useState(editAudit?.agent_name || prefill?.agent_name || '')
  const [callId, setCallId] = useState(editAudit?.call_id || prefill?.call_id || '')
  const [callDate, setCallDate] = useState(editAudit?.call_date || prefill?.call_date || new Date().toISOString().slice(0, 10))
  const [recording, setRecording] = useState(editAudit?.recording_link || prefill?.recording_link || '')
  const [uploadingRec, setUploadingRec] = useState(false)
  const [recError, setRecError] = useState('')
  const [brand, setBrand] = useState(editAudit?.brand || prefill?.brand || '')
  const [answers, setAnswers] = useState(editAudit?.answers || {})  // { question_id: { value:'yes'|'no'|'na', missed:[subItemId] } }
  const [autoFail, setAutoFail] = useState(!!editAudit?.auto_fail)
  const [curDisp, setCurDisp] = useState(editAudit?.current_disposition || prefill?.disposition || '')
  const [correctDisp, setCorrectDisp] = useState(editAudit?.correct_disposition || '')
  const [feedback, setFeedback] = useState(editAudit?.feedback || '')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [qRes, sRes, aRes, meRes, brRes] = await Promise.all([
        supabase.from('qa_questions').select('*').eq('active', true).order('sort_order'),
        supabase.from('qa_sub_items').select('*').eq('active', true).order('sort_order'),
        supabase.from('profiles').select('id, full_name, role, is_active').eq('role', 'agent').order('full_name'),
        supabase.from('profiles').select('full_name').eq('id', user?.id).maybeSingle(),
        supabase.from('qa_brands').select('campaign, name').eq('active', true).order('sort_order'),
      ])
      setMeName(meRes.data?.full_name || '')
      if (qRes.error) throw qRes.error
      setQuestions(qRes.data || [])
      setSubItems(sRes.error ? [] : (sRes.data || []))
      setAgents((aRes.data || []).map(p => ({ agent_name: p.full_name, profile_id: p.id, status: p.is_active ? 'Active' : 'Inactive' })))
      const bmap = {}; (brRes.data || []).forEach(r => { if (!bmap[r.campaign]) bmap[r.campaign] = []; bmap[r.campaign].push(r.name) }); setBrandsByCampaign(bmap)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [user?.id])
  useEffect(() => { load() }, [load])

  // Conversation questions are campaign-specific; other audit types are 'all'.
  const typeQuestions = useMemo(() => {
    return questions
      .filter(q => q.audit_type === auditType)
      .filter(q => auditType !== 'conversation' || q.campaign === campaign || q.campaign === 'all')
      .sort((a, b) => a.sort_order - b.sort_order)
  }, [questions, auditType, campaign])

  const subItemsFor = useCallback((qid) => subItems.filter(s => s.question_id === qid).sort((a, b) => a.sort_order - b.sort_order), [subItems])

  // Reset answers when the auditor switches audit type/campaign — but never on
  // the first render of an edit, which would wipe the audit we just loaded.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setAnswers({}); setAutoFail(false)
  }, [auditType, campaign])

  // live score: N/A excluded from both earned and denominator; auto-fail forces 0
  const { earned, max, score } = useMemo(() => {
    let e = 0, m = 0
    for (const q of typeQuestions) {
      const a = answers[q.id]
      const v = a?.value
      if (v === 'yes') { e += Number(q.points); m += Number(q.points) }
      else if (v === 'no') { m += Number(q.points) }
      // 'na' or unanswered: excluded from the denominator
    }
    const s = autoFail ? 0 : (m > 0 ? Math.round((e / m) * 100) : null)
    return { earned: e, max: m, score: s }
  }, [typeQuestions, answers, autoFail])

  function setAnswer(qid, val) {
    setAnswers(prev => {
      const cur = prev[qid] || {}
      // toggling the same value clears it
      const value = cur.value === val ? null : val
      return { ...prev, [qid]: { ...cur, value, missed: value === 'no' ? (cur.missed || []) : [] } }
    })
  }
  function toggleMissed(qid, subId) {
    setAnswers(prev => {
      const cur = prev[qid] || { value: 'no', missed: [] }
      const missed = cur.missed || []
      const next = missed.includes(subId) ? missed.filter(x => x !== subId) : [...missed, subId]
      return { ...prev, [qid]: { ...cur, missed: next } }
    })
  }

  async function uploadRecording(file) {
    if (!file) return
    setRecError(''); setUploadingRec(true)
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
      const rand = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))
      const path = `${new Date().toISOString().slice(0, 10)}/${rand}.${ext}`
      const { error: upErr } = await supabase.storage.from('qa-recordings').upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('qa-recordings').getPublicUrl(path)
      setRecording(pub.publicUrl)
    } catch (e) {
      setRecError(e.message || 'Upload failed')
    } finally {
      setUploadingRec(false)
    }
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
      campaign: auditType === 'conversation' ? campaign : null,
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
    if (editAudit) {
      // Correction: preserve the original auditor, log what changed (the agent
      // may have already discussed this score in coaching), then update.
      const { error: logErr } = await supabase.from('qa_audit_edits').insert({
        audit_id: editAudit.id, editor_id: user?.id || null, editor_name: meName || null,
        old_score: editAudit.clean_qa_score, new_score: score,
        old_answers: editAudit.answers, old_feedback: editAudit.feedback,
      })
      if (logErr) { setSaving(false); setErr(logErr.message); return }
      const { auditor_id, ...editable } = row   // keep the original auditor
      const { error } = await supabase.from('qa_audits').update({
        ...editable,
        edited_at: new Date().toISOString(), edited_by: user?.id || null, editor_name: meName || null,
        edit_count: (editAudit.edit_count || 0) + 1,
      }).eq('id', editAudit.id)
      setSaving(false)
      if (error) { setErr(error.message); return }
      const was = editAudit.clean_qa_score
      setSavedMsg(`Updated — ${agentName}: ${was == null ? 'n/a' : was + '%'} → ${score == null ? 'n/a' : score + '%'}${autoFail ? ' (auto-fail)' : ''}. Their scorecard now shows the corrected score.`)
      if (onDone) setTimeout(onDone, 1400)
      return
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
  const showDisposition = auditType === 'conversation' || auditType === 'disposition' || auditType === 'voicemail' || auditType === 'no_answer'

  return (
    <div style={{ maxWidth: 880 }}>
      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 14 }}><b style={{ color: 'var(--failed)' }}>Error.</b> <span className="page-sub">{err}</span></div>}
      {savedMsg && <div className="card" style={{ borderColor: 'var(--passed)', marginBottom: 14 }}><b style={{ color: 'var(--passed)' }}>{savedMsg}</b></div>}
      {editAudit && (
        <div className="card" style={{ borderColor: 'var(--needed)', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <b style={{ color: 'var(--needed)' }}>Correcting a submitted audit — {editAudit.agent_name}, {editAudit.call_date || fmtDateTime(editAudit.created_at)}</b>
            <div className="page-sub" style={{ fontSize: 12.5 }}>
              Originally {editAudit.clean_qa_score == null ? 'n/a' : editAudit.clean_qa_score + '%'}. Saving updates their scorecard and records who made the change.
            </div>
          </div>
          {onDone && <button className="btn btn-ghost" onClick={onDone}>Cancel edit</button>}
        </div>
      )}

      {/* campaign (conversation audits are campaign-specific) */}
      {auditType === 'conversation' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--ink-soft)', marginBottom: 5 }}>Campaign</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CAMPAIGNS.map(([k, label]) => (
              <button key={k} className={'btn ' + (campaign === k ? 'btn-primary' : 'btn-ghost')} onClick={() => setCampaign(k)}>{label}</button>
            ))}
          </div>
        </div>
      )}

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
          <Field label="Brand / Location">
            <select value={brand} onChange={e => setBrand(e.target.value)} style={inputStyle}>
              <option value="">Select…</option>
              {((brandsByCampaign[campaign] && brandsByCampaign[campaign].length) ? brandsByCampaign[campaign] : (BRANDS[campaign] || [])).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            {auditType === 'conversation' && <button type="button" onClick={() => setManagingBrands(true)} style={{ marginTop: 5, background: 'none', border: 0, color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>+ Manage brands…</button>}
            {managingBrands && <BrandManager campaign={campaign} onClose={() => setManagingBrands(false)} onChanged={load} />}
          </Field>
          <Field label="Call recording">
            <input type="file" accept="audio/*,video/*" onChange={e => uploadRecording(e.target.files?.[0])} disabled={uploadingRec}
              style={{ ...inputStyle, padding: '6px 8px' }} />
            {uploadingRec && <div className="page-sub" style={{ fontSize: 12, marginTop: 4 }}>Uploading…</div>}
            {recError && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--failed)' }}>{recError}</div>}
            {recording && !uploadingRec && <div className="page-sub" style={{ fontSize: 12, marginTop: 4 }}>✓ Recording attached — <a href={recording} target="_blank" rel="noreferrer">preview</a></div>}
          </Field>
        </div>
      </div>

      {/* questions */}
      <div className="card" style={{ marginBottom: 14 }}>
        <SectionTitle>{typeLabel(auditType)} scorecard</SectionTitle>
        {typeQuestions.map(q => {
          const a = answers[q.id] || {}
          const v = a.value
          const subs = subItemsFor(q.id)
          return (
            <div key={q.id} style={{ padding: '9px 0', borderTop: '1px solid var(--line-soft)' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220, fontSize: 13.5 }}>
                  {q.label}
                  {Number(q.points) > 0 && <span className="page-sub" style={{ marginLeft: 8, fontSize: 12 }}>({q.points} pts)</span>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={'btn ' + (v === 'yes' ? 'btn-primary' : 'btn-ghost')} style={{ padding: '5px 14px' }} onClick={() => setAnswer(q.id, 'yes')}>Yes</button>
                  <button className={'btn ' + (v === 'no' ? 'btn-primary' : 'btn-ghost')} style={{ padding: '5px 14px' }} onClick={() => setAnswer(q.id, 'no')}>No</button>
                  {q.allow_na && <button className={'btn ' + (v === 'na' ? 'btn-primary' : 'btn-ghost')} style={{ padding: '5px 14px' }} onClick={() => setAnswer(q.id, 'na')}>N/A</button>}
                </div>
              </div>
              {v === 'no' && subs.length > 0 && (
                <div style={{ marginTop: 8, paddingLeft: 4, display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                  <span className="page-sub" style={{ fontSize: 12, width: '100%' }}>What was missed?</span>
                  {subs.map(s => (
                    <label key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={(a.missed || []).includes(s.id)} onChange={() => toggleMissed(q.id, s.id)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              )}
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
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editAudit ? 'Save changes' : 'Save audit'}</button>
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
function Results({ isAuditor, onEdit }) {
  const [audits, setAudits] = useState([])
  const [auditorMap, setAuditorMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const [{ data, error }, { data: profs }] = await Promise.all([
      supabase.from('qa_audits').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('profiles').select('id, full_name'),
    ])
    if (error) setErr(error.message)
    setAudits(data || [])
    const m = {}; (profs || []).forEach(p => { m[p.id] = p.full_name }); setAuditorMap(m)
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

  const dispRows = () => audits.filter(a => a.correct_disposition && String(a.correct_disposition).trim())
  const exportDay = () => new Date().toISOString().slice(0, 10)
  function exportFull() {
    const header = ['Audited On', 'Agent', 'Auditor', 'Campaign', 'Brand', 'Call Date', 'Current Disposition', 'Correct Disposition', 'Changed?', 'QA Score', 'Feedback', 'Call ID', 'Recording']
    const rows = dispRows().map(a => [
      a.created_at ? a.created_at.slice(0, 10) : '', a.agent_name || '', auditorMap[a.auditor_id] || '',
      a.campaign || '', a.brand || '', a.call_date || '', a.current_disposition || '', a.correct_disposition || '',
      ((a.current_disposition || '') !== (a.correct_disposition || '')) ? 'Yes' : 'No',
      a.clean_qa_score == null ? '' : a.clean_qa_score, a.feedback || '', a.call_id || '', a.recording_link || '',
    ])
    downloadCSV(`disposition-corrections-${exportDay()}.csv`, [header, ...rows])
  }
  function exportSlim() {
    const header = ['Call ID', 'Current Disposition', 'Correct Disposition']
    const rows = dispRows().map(a => [a.call_id || '', a.current_disposition || '', a.correct_disposition || ''])
    downloadCSV(`disposition-corrections-slim-${exportDay()}.csv`, [header, ...rows])
  }

  if (loading) return <p className="page-sub">Loading results…</p>
  if (err) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load.</b> <span className="page-sub">{err}</span></div>
  if (!audits.length) return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No audits yet.</div></div>

  return (
    <div>
      {isAuditor && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>Disposition corrections ({dispRows().length}):</span>
          <button className="btn btn-ghost" onClick={exportFull}>⭳ Export (full)</button>
          <button className="btn btn-ghost" onClick={exportSlim}>⭳ Export (Call ID + dispositions)</button>
        </div>
      )}
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
              <Th>When</Th><Th>Agent</Th><Th>Type</Th><Th>Brand</Th><Th right>Score</Th><Th>Flags</Th>{isAuditor && <Th right>{''}</Th>}
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
                    <Td>
                      {a.auto_fail ? <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)' }}>Auto-fail</span> : (a.source === 'ai' ? <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>AI</span> : '')}
                      {a.edit_count > 0 && (
                        <span className="badge" title={`Edited ${a.edit_count === 1 ? 'once' : a.edit_count + ' times'}${a.editor_name ? ' by ' + a.editor_name : ''}`}
                          style={{ background: 'var(--needed-bg)', color: 'var(--needed)', marginLeft: 4 }}>edited</span>
                      )}
                    </Td>
                    {isAuditor && (
                      <Td right>
                        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 9px' }} onClick={() => onEdit?.(a)}>Edit</button>
                      </Td>
                    )}
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

// ============================================================
// CALL REVIEWS — self-review of a recorded call.
// Auditors assign a recording to an agent; the agent listens and
// submits 3 things done well + 3 things to improve. RLS keeps
// agents scoped to their own rows.
// ============================================================
const MAX_REVIEW_AUDIO_BYTES = 50 * 1024 * 1024 // 50MB

function CallReviews({ isAuditor }) {
  const { user } = useAuth()
  const [me, setMe] = useState(null)
  const [reviews, setReviews] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const meRes = await supabase.from('profiles').select('id, full_name').eq('id', user.id).single()
      setMe(meRes.data)
      const [rRes, pRes] = await Promise.all([
        supabase.from('call_reviews').select('*').order('created_at', { ascending: false }),
        isAuditor
          ? supabase.from('profiles').select('id, full_name, role, is_active').order('full_name')
          : Promise.resolve({ data: [] }),
      ])
      if (rRes.error) throw rRes.error
      setReviews(rRes.data || [])
      setProfiles(pRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [user.id, isAuditor])
  useEffect(() => { load() }, [load])

  const nameOf = (id) => profiles.find(p => p.id === id)?.full_name || (id === user.id ? 'You' : 'Someone')

  if (loading) return <p className="page-sub">Loading call reviews…</p>
  if (err) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load.</b> <span className="page-sub">{err}</span></div>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isAuditor && <AssignReview me={me} profiles={profiles} onAssigned={load} />}
      {isAuditor
        ? <AuditorReviewList reviews={reviews} nameOf={nameOf} onChanged={load} />
        : <AgentReviewList reviews={reviews} me={me} onChanged={load} />}
    </div>
  )
}

// ---- Auditor: assign a call to an agent ----
function AssignReview({ me, profiles, onAssigned }) {
  const [agentId, setAgentId] = useState('')
  const [callDate, setCallDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [recordingUrl, setRecordingUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const agents = profiles.filter(p => String(p.role || '').toLowerCase() === 'agent' && p.is_active !== false)

  async function uploadRecording(file) {
    if (!file) return
    setErr('')
    if (file.size > MAX_REVIEW_AUDIO_BYTES) { setErr(`"${file.name}" is over 50MB.`); return }
    setUploading(true)
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'dat'
      const rand = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())
      const path = `call-reviews/${rand}.${ext}`
      const { error: upErr } = await supabase.storage.from('qa-recordings').upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('qa-recordings').getPublicUrl(path)
      setRecordingUrl(pub.publicUrl)
    } catch (e) { setErr('Upload failed: ' + e.message) } finally { setUploading(false) }
  }

  async function assign() {
    setErr(''); setMsg('')
    if (!agentId) { setErr('Pick an agent.'); return }
    if (!recordingUrl.trim()) { setErr('Upload a recording or paste a recording link.'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('call_reviews').insert({
        agent_id: agentId, assigned_by: me.id,
        call_date: callDate || null, note: note.trim() || null,
        recording_url: recordingUrl.trim(),
      })
      if (error) throw error
      try {
        await notifyCallReviewAssigned({ recipientId: agentId, actorId: me.id, actorName: me.full_name })
      } catch (e) { console.error('Review assigned, but notification failed', e) }
      setMsg('Review assigned ✓')
      setAgentId(''); setNote(''); setRecordingUrl('')
      onAssigned?.()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card">
      <b style={{ fontSize: 14 }}>Assign a call review</b>
      <p className="page-sub" style={{ fontSize: 12.5, margin: '3px 0 14px' }}>The agent listens to the call and submits 3 things they did well and 3 things to improve.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Agent</label>
            <select value={agentId} onChange={e => setAgentId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--surface)' }}>
              <option value="">Select agent…</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Call date</label>
            <input type="date" value={callDate} onChange={e => setCallDate(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--surface)', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Recording</label>
          <input type="file" accept="audio/*,video/*" disabled={uploading} onChange={e => { uploadRecording(e.target.files?.[0]); e.target.value = '' }}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', boxSizing: 'border-box' }} />
          {uploading && <div className="page-sub" style={{ fontSize: 12, marginTop: 4 }}>Uploading…</div>}
          {recordingUrl && !uploading && <div className="page-sub" style={{ fontSize: 12, marginTop: 4 }}>✓ Recording attached — <a href={recordingUrl} target="_blank" rel="noreferrer">preview</a></div>}
          <input placeholder="…or paste a recording link" value={recordingUrl} onChange={e => setRecordingUrl(e.target.value)}
            style={{ width: '100%', marginTop: 6, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Note to the agent <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(optional)</span></label>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Focus on the opening and how the objection was handled."
            style={{ width: '100%', minHeight: 54, resize: 'vertical', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', boxSizing: 'border-box' }} />
        </div>
        {err && <div style={{ color: 'var(--failed)', fontSize: 12.5 }}>{err}</div>}
        {msg && <div style={{ color: 'var(--passed)', fontSize: 12.5, fontWeight: 600 }}>{msg}</div>}
        <div><button className="btn btn-primary" onClick={assign} disabled={saving || uploading}>{saving ? 'Assigning…' : 'Assign review'}</button></div>
      </div>
    </div>
  )
}

// ---- Auditor: all reviews with status + submitted answers ----
function AuditorReviewList({ reviews, nameOf, onChanged }) {
  const [openId, setOpenId] = useState(null)

  async function remove(r) {
    if (!window.confirm(`Delete this call review for ${nameOf(r.agent_id)}? This can't be undone.`)) return
    const { error } = await supabase.from('call_reviews').delete().eq('id', r.id)
    if (error) { window.alert('Could not delete: ' + error.message); return }
    onChanged?.()
  }

  if (!reviews.length) return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No call reviews assigned yet.</div></div>

  return (
    <div className="card">
      <b style={{ fontSize: 14 }}>Assigned reviews</b>
      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
        {reviews.map(r => {
          const submitted = r.status === 'submitted'
          const open = openId === r.id
          return (
            <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13.5 }}>{nameOf(r.agent_id)}</b>
                <span className="page-sub" style={{ fontSize: 12 }}>{fmtDate(r.call_date)} · assigned {fmtDate(r.created_at)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: submitted ? 'var(--passed-bg)' : 'var(--needed-bg)', color: submitted ? 'var(--passed)' : 'var(--needed)' }}>
                  {submitted ? 'Submitted' : 'Waiting on agent'}
                </span>
                {submitted && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => setOpenId(open ? null : r.id)}>{open ? 'Hide' : 'View answers'}</button>}
                <button onClick={() => remove(r)} title="Delete review"
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: '2px 4px' }}>🗑</button>
              </div>
              {r.note && <div className="page-sub" style={{ fontSize: 12.5, marginTop: 5 }}>Note: {r.note}</div>}
              <audio controls src={r.recording_url} style={{ width: '100%', maxWidth: 420, marginTop: 8 }} />
              {open && submitted && (
                <div style={{ marginTop: 10, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  <ReviewAnswers title="✅ Did well" items={r.went_well} />
                  <ReviewAnswers title="🔧 To improve" items={r.improvements} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewAnswers({ title, items }) {
  return (
    <div style={{ background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
      <b style={{ fontSize: 12.5 }}>{title}</b>
      <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
        {(items || []).map((x, i) => <li key={i}>{x}</li>)}
      </ol>
    </div>
  )
}

// ---- Agent: my reviews (pending form / submitted read-only) ----
function AgentReviewList({ reviews, me, onChanged }) {
  if (!reviews.length) {
    return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No call reviews assigned to you yet. When a call is ready to review, it appears here (you'll also get a notification).</div></div>
  }
  const pending = reviews.filter(r => r.status !== 'submitted')
  const doneOnes = reviews.filter(r => r.status === 'submitted')
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {pending.map(r => <AgentReviewForm key={r.id} review={r} me={me} onChanged={onChanged} />)}
      {doneOnes.length > 0 && (
        <div className="card">
          <b style={{ fontSize: 14 }}>Completed reviews</b>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {doneOnes.map(r => (
              <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="page-sub" style={{ fontSize: 12 }}>Call {fmtDate(r.call_date)} · submitted {fmtDate(r.submitted_at)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'var(--passed-bg)', color: 'var(--passed)' }}>Submitted</span>
                </div>
                <div style={{ marginTop: 8, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  <ReviewAnswers title="✅ Did well" items={r.went_well} />
                  <ReviewAnswers title="🔧 To improve" items={r.improvements} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AgentReviewForm({ review, me, onChanged }) {
  const [well, setWell] = useState(['', '', ''])
  const [improve, setImprove] = useState(['', '', ''])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const setAt = (setter) => (i) => (e) => setter(prev => prev.map((x, j) => j === i ? e.target.value : x))

  async function submit() {
    setErr('')
    if (well.some(x => !x.trim()) || improve.some(x => !x.trim())) {
      setErr('Please fill in all three strengths and all three improvements.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('call_reviews').update({
        went_well: well.map(x => x.trim()),
        improvements: improve.map(x => x.trim()),
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      }).eq('id', review.id)
      if (error) throw error
      try {
        await notifyCallReviewSubmitted({ recipientId: review.assigned_by, actorId: me.id, actorName: me.full_name })
      } catch (e) { console.error('Review submitted, but notification failed', e) }
      onChanged?.()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--surface)', boxSizing: 'border-box' }

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>Call review — {fmtDate(review.call_date)}</b>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'var(--needed-bg)', color: 'var(--needed)' }}>Needs your review</span>
      </div>
      {review.note && <p className="page-sub" style={{ fontSize: 12.5, margin: '6px 0 0' }}>Note from your coach: {review.note}</p>}
      <p className="page-sub" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>Listen to your call, then share 3 things you did well and 3 things you'd improve.</p>
      <audio controls src={review.recording_url} style={{ width: '100%', maxWidth: 460 }} />
      <div style={{ marginTop: 14, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        <div>
          <b style={{ fontSize: 13 }}>✅ 3 things I did well</b>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {well.map((v, i) => <input key={i} style={inputStyle} placeholder={`${i + 1}.`} value={v} onChange={setAt(setWell)(i)} />)}
          </div>
        </div>
        <div>
          <b style={{ fontSize: 13 }}>🔧 3 things I can improve</b>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {improve.map((v, i) => <input key={i} style={inputStyle} placeholder={`${i + 1}.`} value={v} onChange={setAt(setImprove)(i)} />)}
          </div>
        </div>
      </div>
      {err && <div style={{ color: 'var(--failed)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit review'}</button>
    </div>
  )
}
