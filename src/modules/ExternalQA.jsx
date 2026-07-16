import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// EXTERNAL QA — audits of client CSRs (GarageCo brands).
// Mirrors Sarah's 100-point form. On submit, the CSR is emailed their
// results directly (send-quality-email), recording attached.
// ClientRecaps below: the Monday AI exec recap (draft → review → send).
// ============================================================

const BRANDS = [
  'Apple Door', 'Cedar Park: Main', 'Cedar Park: Marble Falls', 'Cheney Doors and Windows',
  'Cunningham Door', 'Dans Doors Iowa', 'Genson Door', 'Omaha Door', 'PDQ Door',
  'Quality Overhead', 'Thomas V Giel',
]
const CALL_TYPES = ['Commercial', 'Residential', 'Emergency', 'Sales', 'Other']
const OUTCOMES = ['Booked', 'Not Booked', 'Transferred', 'Other']
const NOT_BOOKED_REASONS = [
  'Appointment Booked', 'Canceling Appointment', 'Check Status of Parts', 'Check Status Of Tech',
  'Follow up needed by customer', 'Follow up is needed by different department', 'Gates Team',
  'Invoice Request', 'Knowledge Gap', 'Needs to speak to homeowner', 'Policy', 'Price',
  'Provided Payment', 'Quote Request', 'Reschedule', 'Sales Team', 'Transferred', 'Other',
]

// The scored rubric — 100 points total. N/A removes the section from the
// possible points (standard QA math), so scores stay fair.
export const QA_SECTIONS = [
  { key: 'greeting', label: 'Did the agent use an appropriate greeting?', points: 5, na: false,
    misses: ['Branding', 'Name', 'Offering Assistance', 'Acknowledged the reason for the call'] },
  { key: 'verify', label: "Did the agent verify the customer's information?", points: 10, na: true,
    misses: ['Name', 'Phone Number', 'Email', 'Address', 'Preferred contact method — New Customer Only', 'How they heard about GarageCo — New Customer Only'] },
  { key: 'callflow', label: 'Did the agent follow the correct call flow and set expectations?', points: 15, na: false,
    misses: ['Provided cost before gathering information', 'Did not set expectations for appointment'] },
  { key: 'knowledge', label: 'Was the agent knowledgeable about the request?', points: 15, na: true,
    misses: ['Did not ask probing questions', 'Provided troubleshooting vs scheduling an appointment', 'Diagnostic fee not explained properly', 'Emergency fee not explained'] },
  { key: 'appointment', label: "Did the agent offer the next best available appointment? (Including if it's an emergency)", points: 12, na: true, misses: [] },
  { key: 'professionalism', label: 'Agent displayed professionalism while on the call', points: 10, na: false,
    misses: ['Tone', 'Talking Over', 'Dead Air', 'Filler Words', 'Active Listening', 'Empathy'] },
  { key: 'rebuttals', label: 'Did the agent attempt to secure an appointment by using rebuttals?', points: 15, na: true, misses: [] },
  { key: 'hold', label: 'Did the agent follow hold policy?', points: 5, na: true,
    misses: ['Did not ask permission before placing them on hold', 'Did not thank the customer for holding'] },
  { key: 'nextsteps', label: 'Did the agent provide clear next steps?', points: 8, na: true,
    misses: ['Appointment Date', 'Appointment Window', 'Address', 'Contact information'] },
  { key: 'closing', label: 'Did the agent provide a proper closing?', points: 5, na: true,
    misses: ['Thanking the customer for calling', 'Showing appreciation'] },
]

const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', background: 'var(--surface)', boxSizing: 'border-box' }
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }

export default function ExternalQA() {
  const { user } = useAuth()
  const [me, setMe] = useState(null)
  const [csrs, setCsrs] = useState([])
  const [recent, setRecent] = useState([])

  const [brand, setBrand] = useState('')
  const [csrId, setCsrId] = useState('')       // roster pick
  const [csrManual, setCsrManual] = useState({ name: '', email: '' })
  const [callDate, setCallDate] = useState(new Date().toISOString().slice(0, 10))
  const [callTime, setCallTime] = useState('')
  const [direction, setDirection] = useState('')
  const [callType, setCallType] = useState('')
  const [callTypeOther, setCallTypeOther] = useState('')
  const [answers, setAnswers] = useState({})   // key -> 'yes'|'no'|'na'
  const [misses, setMisses] = useState({})     // key -> Set of strings
  const [outcome, setOutcome] = useState('')
  const [outcomeOther, setOutcomeOther] = useState('')
  const [notBooked, setNotBooked] = useState('')
  const [notes, setNotes] = useState('')
  const [recFile, setRecFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)       // {score, emailed, emailErr}

  const load = useCallback(async () => {
    const [meRes, csrRes, recentRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('id', user.id).single(),
      supabase.from('external_csrs').select('*').eq('active', true).order('full_name'),
      supabase.from('external_qa_audits').select('id, csr_name, brand, call_date, score_pct, email_sent_at, email_error, created_at').order('created_at', { ascending: false }).limit(12),
    ])
    setMe(meRes.data); setCsrs(csrRes.data || []); setRecent(recentRes.data || [])
  }, [user.id])
  useEffect(() => { load() }, [load])

  const brandCsrs = csrs.filter(c => !brand || c.brand === brand)
  const pickedCsr = csrs.find(c => c.id === csrId) || null

  const setAnswer = (key, val) => setAnswers(prev => ({ ...prev, [key]: val }))
  const toggleMiss = (key, item) => setMisses(prev => {
    const s = new Set(prev[key] || []); s.has(item) ? s.delete(item) : s.add(item)
    return { ...prev, [key]: s }
  })

  // Live score
  let possible = 0, earned = 0
  QA_SECTIONS.forEach(sec => {
    const a = answers[sec.key]
    if (a === 'na') return
    possible += sec.points
    if (a === 'yes') earned += sec.points
  })
  const allAnswered = QA_SECTIONS.every(sec => answers[sec.key])
  const scorePct = possible ? Math.round((earned / possible) * 100) : 0

  async function submit() {
    setErr('')
    if (!brand) { setErr('Pick a brand.'); return }
    const csrName = pickedCsr?.full_name || csrManual.name.trim()
    const csrEmail = pickedCsr?.email || csrManual.email.trim() || null
    if (!csrName) { setErr("Pick the agent, or enter their name."); return }
    if (!callDate || !direction) { setErr('Call date and direction are required.'); return }
    if (!allAnswered) { setErr('Answer every scored question (use N/A where it doesn\u2019t apply).'); return }
    setSaving(true)
    try {
      // recording upload (optional but encouraged — it goes to the CSR)
      let recordingUrl = null
      if (recFile) {
        const ext = recFile.name.includes('.') ? recFile.name.split('.').pop() : 'dat'
        const path = `external-qa/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from('qa-recordings').upload(path, recFile, { contentType: recFile.type || undefined })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('qa-recordings').getPublicUrl(path)
        recordingUrl = pub.publicUrl
      }

      const sections = {}
      QA_SECTIONS.forEach(sec => {
        sections[sec.key] = { answer: answers[sec.key], misses: answers[sec.key] === 'no' ? [...(misses[sec.key] || [])] : [] }
      })

      const { data: audit, error } = await supabase.from('external_qa_audits').insert({
        auditor_id: me.id, auditor_name: me.full_name,
        brand, csr_name: csrName, csr_email: csrEmail, agent_number: pickedCsr?.agent_number || null,
        call_date: callDate, call_time: callTime || null, direction,
        call_type: callType === 'Other' ? (callTypeOther.trim() || 'Other') : callType || null,
        sections, points_earned: earned, points_possible: possible, score_pct: scorePct,
        outcome: outcome === 'Other' ? (outcomeOther.trim() || 'Other') : outcome || null,
        not_booked_reason: outcome === 'Not Booked' ? (notBooked || null) : null,
        notes: notes.trim() || null, recording_url: recordingUrl,
      }).select().single()
      if (error) throw error

      // Email the CSR their results
      let emailed = false, emailErr = null
      if (csrEmail) {
        const { data: sendRes, error: sendErr } = await supabase.functions.invoke('send-quality-email', { body: { audit_id: audit.id } })
        if (sendErr || sendRes?.error) emailErr = sendErr?.message || sendRes?.error
        else emailed = true
      }

      setDone({ score: scorePct, emailed, emailErr, csrName })
      // reset the scoring parts, keep brand/auditor context
      setCsrId(''); setCsrManual({ name: '', email: '' }); setCallTime(''); setDirection(''); setCallType(''); setCallTypeOther('')
      setAnswers({}); setMisses({}); setOutcome(''); setOutcomeOther(''); setNotBooked(''); setNotes(''); setRecFile(null)
      load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {done && (
        <div className="card" style={{ borderColor: 'var(--passed)' }}>
          <b style={{ color: 'var(--passed)' }}>Audit saved — {done.csrName} scored {done.score}%.</b>{' '}
          <span className="page-sub" style={{ fontSize: 13 }}>
            {done.emailed ? 'Their feedback email is on its way. ✉️'
              : done.emailErr ? `Saved, but the email failed: ${done.emailErr}`
                : 'No email on file for this agent, so nothing was sent.'}
          </span>
          <button className="btn btn-ghost" style={{ marginLeft: 10, fontSize: 12, padding: '3px 9px' }} onClick={() => setDone(null)}>Dismiss</button>
        </div>
      )}

      <div className="card">
        <b style={{ fontSize: 14 }}>External QA audit</b>
        <p className="page-sub" style={{ fontSize: 12.5, margin: '3px 0 14px' }}>Score a client CSR's call. On submit, they receive their results and the recording by email — questions route to their manager.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div><label style={labelStyle}>Brand *</label>
            <select style={inputStyle} value={brand} onChange={e => { setBrand(e.target.value); setCsrId('') }}>
              <option value="">Select…</option>{BRANDS.map(b => <option key={b}>{b}</option>)}
            </select></div>
          <div><label style={labelStyle}>Agent *</label>
            <select style={inputStyle} value={csrId} onChange={e => setCsrId(e.target.value)}>
              <option value="">{brandCsrs.length ? 'Select…' : 'No roster for this brand — enter below'}</option>
              {brandCsrs.map(c => <option key={c.id} value={c.id}>{c.agent_number ? `${c.agent_number} — ` : ''}{c.full_name}</option>)}
            </select></div>
          <div><label style={labelStyle}>Date of call *</label>
            <input type="date" style={inputStyle} value={callDate} onChange={e => setCallDate(e.target.value)} /></div>
          <div><label style={labelStyle}>Call time</label>
            <input type="time" style={inputStyle} value={callTime} onChange={e => setCallTime(e.target.value)} /></div>
        </div>

        {!csrId && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div><label style={labelStyle}>Agent name (manual)</label>
              <input style={inputStyle} value={csrManual.name} onChange={e => setCsrManual(m => ({ ...m, name: e.target.value }))} placeholder="If not in the roster" /></div>
            <div><label style={labelStyle}>Agent email (for their results)</label>
              <input style={inputStyle} type="email" value={csrManual.email} onChange={e => setCsrManual(m => ({ ...m, email: e.target.value }))} placeholder="first.last@…" /></div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 4 }}>
          <div><label style={labelStyle}>Call direction *</label>
            <select style={inputStyle} value={direction} onChange={e => setDirection(e.target.value)}>
              <option value="">Select…</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option>
            </select></div>
          <div><label style={labelStyle}>Call type</label>
            <select style={inputStyle} value={callType} onChange={e => setCallType(e.target.value)}>
              <option value="">Select…</option>{CALL_TYPES.map(t => <option key={t}>{t}</option>)}
            </select></div>
          {callType === 'Other' && <div><label style={labelStyle}>Call type — other</label>
            <input style={inputStyle} value={callTypeOther} onChange={e => setCallTypeOther(e.target.value)} /></div>}
          <div><label style={labelStyle}>Call recording (sent to the agent)</label>
            <input type="file" accept="audio/*,video/*" style={{ ...inputStyle, padding: '6px 10px' }} onChange={e => setRecFile(e.target.files?.[0] || null)} /></div>
        </div>
      </div>

      {/* Scored sections */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <b style={{ fontSize: 14 }}>Scoring</b>
          <span style={{ fontSize: 15, fontWeight: 800, color: !allAnswered ? 'var(--ink-soft)' : scorePct >= 90 ? 'var(--passed)' : scorePct >= 75 ? 'var(--needed)' : 'var(--failed)' }}>
            {allAnswered ? `${scorePct}% · ${earned}/${possible} pts` : `${earned}/${possible} pts so far`}
          </span>
        </div>
        {QA_SECTIONS.map(sec => {
          const a = answers[sec.key]
          return (
            <div key={sec.key} style={{ padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240, fontSize: 13.5, fontWeight: 600 }}>{sec.label} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>({sec.points} pts)</span></div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['yes', 'no', ...(sec.na ? ['na'] : [])].map(v => (
                    <button key={v} type="button" onClick={() => setAnswer(sec.key, v)}
                      style={{ border: '1px solid ' + (a === v ? (v === 'yes' ? 'var(--passed)' : v === 'no' ? 'var(--failed)' : 'var(--line)') : 'var(--line)'),
                        background: a === v ? (v === 'yes' ? 'var(--passed-bg)' : v === 'no' ? 'var(--failed-bg)' : 'var(--canvas)') : 'var(--surface)',
                        color: a === v ? (v === 'yes' ? 'var(--passed)' : v === 'no' ? 'var(--failed)' : 'var(--ink-soft)') : 'var(--ink)',
                        borderRadius: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase' }}>
                      {v === 'na' ? 'N/A' : v}
                    </button>
                  ))}
                </div>
              </div>
              {a === 'no' && sec.misses.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {sec.misses.map(m => {
                    const on = (misses[sec.key] || new Set()).has(m)
                    return (
                      <button key={m} type="button" onClick={() => toggleMiss(sec.key, m)}
                        style={{ border: '1px solid ' + (on ? 'var(--needed)' : 'var(--line)'), background: on ? 'var(--needed-bg)' : 'var(--surface)', color: on ? 'var(--needed)' : 'var(--ink-soft)', borderRadius: 999, padding: '4px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {m}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div><label style={labelStyle}>Call outcome</label>
            <select style={inputStyle} value={outcome} onChange={e => setOutcome(e.target.value)}>
              <option value="">Select…</option>{OUTCOMES.map(o => <option key={o}>{o}</option>)}
            </select></div>
          {outcome === 'Other' && <div><label style={labelStyle}>Outcome — other</label>
            <input style={inputStyle} value={outcomeOther} onChange={e => setOutcomeOther(e.target.value)} /></div>}
          {outcome === 'Not Booked' && <div><label style={labelStyle}>Reason for not being booked</label>
            <select style={inputStyle} value={notBooked} onChange={e => setNotBooked(e.target.value)}>
              <option value="">Select…</option>{NOT_BOOKED_REASONS.map(r => <option key={r}>{r}</option>)}
            </select></div>}
        </div>
        <div><label style={labelStyle}>Coaching notes <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(included in the agent's email)</span></label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="What they did well, and specifically what to work on…" /></div>
        {err && <div style={{ color: 'var(--failed)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
        <button className="btn btn-cta" style={{ marginTop: 12 }} onClick={submit} disabled={saving}>
          {saving ? 'Saving & emailing…' : 'Submit audit & email the agent'}
        </button>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <b style={{ fontSize: 14 }}>Recent external audits</b>
          <div style={{ marginTop: 8 }}>
            {recent.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                <b style={{ width: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.csr_name}</b>
                <span className="page-sub" style={{ fontSize: 12 }}>{r.brand} · {r.call_date}</span>
                <b style={{ marginLeft: 'auto', color: r.score_pct >= 90 ? 'var(--passed)' : r.score_pct >= 75 ? 'var(--needed)' : 'var(--failed)' }}>{r.score_pct}%</b>
                <span style={{ fontSize: 11.5, color: r.email_sent_at ? 'var(--passed)' : r.email_error ? 'var(--failed)' : 'var(--ink-soft)' }}>
                  {r.email_sent_at ? '✉ sent' : r.email_error ? '✉ failed' : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// CLIENT RECAPS — the Monday exec email (draft → review → send).
// A cron generates the draft Monday 8am ET; this panel previews it,
// lets you set recipients (Mark, Rob, Marcus, Macy), and send.
// ============================================================
export function ClientRecaps() {
  const [recaps, setRecaps] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [recipientsText, setRecipientsText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('quality_recaps').select('*').order('created_at', { ascending: false }).limit(10)
    if (error) setErr(error.message)
    setRecaps(data || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const open = recaps.find(r => r.id === openId)
  useEffect(() => { if (open) setRecipientsText((open.recipients || []).join(', ')) }, [openId]) // eslint-disable-line

  async function generate() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.functions.invoke('weekly-quality-recap', { body: { action: 'generate' } })
    setBusy(false)
    if (error || data?.error) { setErr(error?.message || data?.error); return }
    await load(); setOpenId(data.recap.id)
  }

  async function send() {
    const recipients = recipientsText.split(/[,;\s]+/).map(s => s.trim()).filter(s => /@/.test(s))
    if (!recipients.length) { setErr('Add at least one recipient email.'); return }
    if (!window.confirm(`Send this recap to: ${recipients.join(', ')}?`)) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.functions.invoke('weekly-quality-recap', { body: { action: 'send', recap_id: openId, recipients } })
    setBusy(false)
    if (error || data?.error) { setErr(error?.message || data?.error); return }
    load()
  }

  if (loading) return <p className="page-sub">Loading recaps…</p>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <b style={{ fontSize: 14 }}>Weekly client recap (CPOD)</b>
          <p className="page-sub" style={{ fontSize: 12.5, margin: '3px 0 0' }}>Auto-drafts every Monday 8:00 AM ET from the past week's external audits. Review it here, then send to the GarageCo execs.</p>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? 'Working…' : '⚡ Generate now'}</button>
      </div>
      {err && <div className="card" style={{ borderColor: 'var(--failed)' }}><span style={{ color: 'var(--failed)', fontSize: 13 }}>{err}</span></div>}

      {recaps.length === 0
        ? <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No recaps yet — generate one to see this week's draft.</div></div>
        : recaps.map(r => (
          <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div onClick={() => setOpenId(openId === r.id ? null : r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer' }}>
              <b style={{ fontSize: 13.5 }}>{r.subject || `${r.client_label} — ${r.period_start} → ${r.period_end}`}</b>
              <span className="badge" style={{ background: r.status === 'sent' ? 'var(--passed-bg)' : 'var(--needed-bg)', color: r.status === 'sent' ? 'var(--passed)' : 'var(--needed)', fontSize: 10.5, fontWeight: 700 }}>
                {r.status === 'sent' ? `Sent ${new Date(r.sent_at).toLocaleDateString()}` : 'Draft — not sent'}
              </span>
              {r.ai_used && <span className="page-sub" style={{ fontSize: 11 }}>✨ AI narrative</span>}
              <span style={{ marginLeft: 'auto', color: 'var(--ink-soft)' }}>{openId === r.id ? '▾' : '▸'}</span>
            </div>
            {openId === r.id && (
              <div style={{ borderTop: '1px solid var(--line)' }}>
                <iframe title="recap preview" srcDoc={r.html || '<p>No content</p>'} style={{ width: '100%', height: 520, border: 0, background: '#fff' }} />
                {r.status !== 'sent' && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input style={{ ...inputStyle, flex: 1, minWidth: 260 }} value={recipientsText} onChange={e => setRecipientsText(e.target.value)}
                      placeholder="Recipient emails, comma-separated (Mark, Rob, Marcus, Macy)" />
                    <button className="btn btn-cta" onClick={send} disabled={busy}>{busy ? 'Sending…' : '📨 Send to client'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
    </div>
  )
}
