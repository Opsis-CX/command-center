import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// NEW HIRE SURVEY — anonymous check-in sent N days after start.
//
// Anonymity is enforced in the DB, not here: nh_survey_responses
// stores (survey_id, answers, date) with NO profile_id and no link
// back to the dispatch row. The only write path is nh_survey_submit,
// which verifies the caller was actually asked, inserts the answers
// without identity, then flips their dispatch row to responded.
// Nobody — including an admin with SQL access — can attribute a
// response to a person. Say so plainly on the form, because people
// only answer honestly if they believe it.
//
// This page serves two audiences off one route:
//   • anyone with a pending survey → the form
//   • admins / reporting staff     → aggregate results
// ============================================================

export default function NewHireSurvey() {
  const [pending, setPending] = useState(null)   // null = loading, {} = nothing to answer
  const [answers, setAnswers] = useState({})
  const [other, setOther] = useState({})         // key -> free-text for "Other"
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let active = true
    supabase.rpc('nh_survey_pending')
      .then(({ data, error }) => {
        if (!active) return
        if (error) { setErr(error.message); setPending({}); return }
        setPending(data || {})
      })
      .catch((e) => { if (active) { setErr(e.message || String(e)); setPending({}) } })
    return () => { active = false }
  }, [])

  const setA = (k, v) => setAnswers((p) => ({ ...p, [k]: v }))

  async function submit() {
    const qs = pending?.questions || []
    // Everything is optional except: don't submit a completely blank survey.
    const payload = {}
    for (const q of qs) {
      let v = answers[q.key]
      if (v === 'Other' && q.allow_other) v = (other[q.key] || '').trim()
      if (v == null) continue
      v = String(v).trim()
      if (v) payload[q.key] = v
    }
    if (!Object.keys(payload).length) { setErr('Answer at least one question before submitting.'); return }
    setSubmitting(true); setErr('')
    const { data, error } = await supabase.rpc('nh_survey_submit', { p_survey_id: pending.survey_id, p_answers: payload })
    setSubmitting(false)
    if (error) { setErr(error.message); return }
    if (data && data.ok === false) {
      setErr(data.error === 'no_pending_survey'
        ? 'This survey has already been submitted, or it is no longer being asked of you.'
        : (data.error || 'Could not submit.'))
      return
    }
    setDone(true)
  }

  if (pending === null) return <div className="page"><h1 className="page-title">New Hire Survey</h1><p className="page-sub">Loading…</p></div>

  const hasSurvey = !!pending?.survey_id && !done

  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <h1 className="page-title">New Hire Survey</h1>

      {done && (
        <div className="card" style={{ background: 'var(--surface)', borderLeft: '3px solid var(--passed, #1b5e20)', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Thank you — your answers are in.</div>
          <p className="page-sub" style={{ margin: 0 }}>They were saved without your name attached. Nothing here can be traced back to you.</p>
        </div>
      )}

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      {hasSurvey ? (
        <>
          <div className="card" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>🔒 This is anonymous</div>
            <div style={{ fontSize: 13.5 }}>{pending.intro || 'Your answers are stored without your name attached.'}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(pending.questions || []).map((q, i) => (
              <div key={q.key} className="card">
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
                  <span style={{ color: 'var(--ink-soft)', fontWeight: 500 }}>{i + 1}. </span>{q.label}
                </div>

                {q.type === 'scale' && (
                  <div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {Array.from({ length: 10 }, (_, n) => String(n + 1)).map((n) => (
                        <button key={n} type="button" onClick={() => setA(q.key, answers[q.key] === n ? undefined : n)}
                          style={{
                            width: 36, height: 36, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                            border: `1px solid ${answers[q.key] === n ? 'var(--accent, #0077B6)' : 'var(--line)'}`,
                            background: answers[q.key] === n ? 'var(--accent, #0077B6)' : 'var(--surface)',
                            color: answers[q.key] === n ? '#fff' : 'var(--ink)',
                          }}>{n}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)', marginTop: 5 }}>
                      <span>1 — {q.min_label || 'Low'}</span><span>{q.max_label || 'High'} — 10</span>
                    </div>
                  </div>
                )}

                {q.type === 'choice' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[...(q.options || []), ...(q.allow_other ? ['Other'] : [])].map((opt) => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, cursor: 'pointer' }}>
                        <input type="radio" name={q.key} checked={answers[q.key] === opt} onChange={() => setA(q.key, opt)}
                          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent, #0077B6)' }} />
                        <span>{opt}</span>
                      </label>
                    ))}
                    {q.allow_other && answers[q.key] === 'Other' && (
                      <input type="text" value={other[q.key] || ''} onChange={(e) => setOther((p) => ({ ...p, [q.key]: e.target.value }))}
                        placeholder="Tell us what would motivate you" style={inp} />
                    )}
                  </div>
                )}

                {q.type === 'text' && (
                  <textarea rows={3} value={answers[q.key] || ''} onChange={(e) => setA(q.key, e.target.value)}
                    placeholder="Optional — but this is the useful part" style={{ ...inp, width: '100%', resize: 'vertical' }} />
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
            <button className="btn btn-primary" disabled={submitting} onClick={submit}>{submitting ? 'Submitting…' : 'Submit anonymously'}</button>
            <span className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>You can only submit once.</span>
          </div>
        </>
      ) : !done && (
        <p className="page-sub">You don't have a survey waiting right now. We send this once, about a month after you start.</p>
      )}

      {/* Who may see results is decided by the server (nh_survey_results checks
          is_admin_user() OR is_reporting_staff()). Guessing from the role string
          here got it wrong both ways — profiles.role never contains "reporting",
          and is_reporting_staff() covers anyone at level >= 40 (Support, QA
          Reviewer, App Reviewer). Results renders nothing when the RPC says no. */}
      <Results />
    </div>
  )
}

// ---- Aggregate results (admins / reporting staff) --------------------------
// nh_survey_results returns counts, averages, distributions, and free text
// shuffled by md5 so row order can't be lined up against send order.
function Results() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    setErr('')
    supabase.rpc('nh_survey_results', { p_survey_id: null })
      .then(({ data, error }) => {
        if (error) { setErr(error.message); return }
        // 'forbidden' just means this person isn't reporting staff — render nothing
        // rather than telling an agent about a results page they can't use.
        if (data?.error) { if (data.error !== 'forbidden') setErr(data.error); return }
        setData(data)
      })
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <div style={{ marginTop: 32, fontSize: 12.5, color: 'var(--ink-soft)' }}>{err}</div>
  if (!data) return null

  return (
    <div style={{ marginTop: 36, borderTop: '1px solid var(--line)', paddingTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 className="page-title" style={{ fontSize: 19, margin: 0 }}>Results — {data.title}</h2>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={load}>↻ Refresh</button>
      </div>
      <p className="page-sub" style={{ marginTop: 4 }}>
        Sent to <strong>{data.sent}</strong> · <strong>{data.responses}</strong> responses
        {data.response_rate != null && <> · <strong>{data.response_rate}%</strong> response rate</>}
        {' '}· sent {data.send_after_days} days after start date.
      </p>

      {data.responses === 0 && <div className="card" style={{ textAlign: 'center', padding: 24 }}><p className="page-sub" style={{ margin: 0 }}>No responses yet.</p></div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(data.questions || []).map((q) => (
          <div key={q.key} className="card">
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{q.label}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>
              {q.answered} answered{q.average != null && <> · average <strong style={{ color: 'var(--ink)', fontSize: 13 }}>{q.average}</strong>{q.type === 'scale' ? ' / 10' : ''}</>}
            </div>

            {q.distribution && Object.keys(q.distribution).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.entries(q.distribution)
                  .sort((a, b) => (q.type === 'scale' ? Number(a[0]) - Number(b[0]) : b[1] - a[1]))
                  .map(([val, n]) => {
                    const pctW = q.answered ? Math.round((n / q.answered) * 100) : 0
                    return (
                      <div key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <div style={{ minWidth: 160, color: 'var(--ink-soft)' }}>{val}</div>
                        <div style={{ flex: 1, background: 'var(--line)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${pctW}%`, background: 'var(--accent, #0077B6)', height: '100%' }} />
                        </div>
                        <div style={{ minWidth: 54, textAlign: 'right' }}>{n} ({pctW}%)</div>
                      </div>
                    )
                  })}
              </div>
            )}

            {Array.isArray(q.texts) && q.texts.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {q.texts.map((t, i) => <li key={i} style={{ fontSize: 13, marginBottom: 5, color: 'var(--ink)' }}>{t}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="page-sub" style={{ fontSize: 11.5, marginTop: 12 }}>
        Free-text answers are shuffled so they can't be matched to the order the survey was sent in.
      </p>
    </div>
  )
}

const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }
