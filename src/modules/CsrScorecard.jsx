// src/modules/CsrScorecard.jsx
// GarageCo CSR coaching scorecard (2026-09-27).
//
// One module, three audiences — the DATABASE decides what each can see:
//   mode="csr"      CSR login: their own scorecard only (csr_scorecard() with no id).
//   mode="manager"  Client login (portal): picker of CSRs they may view (csr_roster()),
//                   read-only. Enterprise logins see every brand, location managers
//                   only their brand. Enforced in csr_viewer_can_see().
//   mode="staff"    Opsis QA staff inside Command Center: picker + coach editing
//                   (weekly focus, notes, activities, first-1:1 date).
// Scoring starts the MONDAY AFTER the CSR's first 1:1 (csr_program_start, server-side). The week of
// the 1:1 is rubric review: the CSR sees their start date, notes and activities, but no numbers.

import { useCallback, useEffect, useMemo, useState } from 'react'

const TZ = 'America/New_York'

// ---------- formatting helpers ----------
function fmtDur(sec) {
  if (sec == null || isNaN(sec)) return '—'
  const s = Math.max(0, Math.round(Number(sec)))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function parseDay(d) {
  // 'YYYY-MM-DD' as a calendar date (no timezone drift)
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd, 12))
}
function fmtDay(d, opts = { month: 'short', day: 'numeric' }) {
  if (!d) return ''
  return parseDay(d).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}
function weekRange(weekStart) {
  if (!weekStart) return ''
  const s = parseDay(weekStart)
  const e = new Date(s.getTime() + 6 * 86400000)
  const f = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${f(s)} – ${f(e)}`
}
function fmtCallTime(iso) {
  // Compact so a call row fits on one line: "Sat 9/26 · 11:36 AM"
  if (!iso) return ''
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric' }).replace(',', '')
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}
function stepName(label) {
  // "Step 9 Capture Payment: get payment on file…" -> "Capture Payment"
  const head = String(label || '').split(':')[0]
  return head.replace(/^Step\s*\d+\s*/i, '').trim() || head
}
function stepNum(label) {
  const m = String(label || '').match(/^Step\s*(\d+)/i)
  return m ? m[1] : ''
}
function addDays(d, n) {
  if (!d) return d
  const x = parseDay(d); x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

// ---------- small presentational pieces (module scope) ----------
function Delta({ cur, prev, unit = '', lowerIsBetter = false, decimals = 1 }) {
  if (cur == null || prev == null) return null
  const d = Number(cur) - Number(prev)
  if (Math.abs(d) < 0.05) return <span className="csr-delta flat">no change vs last week</span>
  const good = lowerIsBetter ? d < 0 : d > 0
  const txt = unit === 'time' ? fmtDur(Math.abs(d)) : `${Math.abs(d).toFixed(decimals)}${unit}`
  return <span className={`csr-delta ${good ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {txt} vs last week</span>
}

function Tile({ label, value, sub, children }) {
  return (
    <div className="csr-card csr-tile">
      <div className="csr-lbl">{label}</div>
      <div className="csr-val">{value}</div>
      {children}
      {sub ? <div className="csr-sub">{sub}</div> : null}
    </div>
  )
}

// Plays one call's recording on demand. The recording function enforces who may
// hear which call (a CSR only their own calls, a manager only their brand).
function RecordingPlayer({ supabase, callId }) {
  const [src, setSrc] = useState(null)
  const [state, setState] = useState('idle') // idle | loading | error
  const load = async (e) => {
    e?.stopPropagation?.()
    setState('loading')
    try {
      // One quiet retry: a login token refreshing at the same moment can fail the first try.
      let { data, error } = await supabase.functions.invoke('callqa-recording', { body: { call_id: callId } })
      if (error) {
        await new Promise(r => setTimeout(r, 600))
        ;({ data, error } = await supabase.functions.invoke('callqa-recording', { body: { call_id: callId } }))
      }
      if (error) throw error
      let url = null
      if (data && typeof data === 'object' && data.url) url = data.url
      else if (data instanceof Blob) url = URL.createObjectURL(data)
      if (!url) throw new Error('No recording')
      setSrc(url); setState('idle')
    } catch {
      setState('error')
    }
  }
  if (src) return <audio className="csr-audio" src={src} controls autoPlay onClick={(e) => e.stopPropagation()} />
  return (
    <button className="csr-play" onClick={load} disabled={state === 'loading'}>
      {state === 'loading' ? 'Loading…' : state === 'error' ? "Couldn't load. Tap to retry" : '▶ Play recording'}
    </button>
  )
}

// ---------- "This doesn't look right" (CSR / manager flags a grade; Opsis QA reviews) ----------
const FLAG_REASONS = [
  ['step_wrong', 'This step was graded wrong'],
  ['not_customer', "This wasn't a customer call (tech, coworker, vendor, extension)"],
  ['transcript_wrong', "The transcript doesn't match what was said"],
  ['other', 'Something else'],
]
const FLAG_STATUS = {
  open: ['Sent for review', 'We’ll check this call before your next session.', 'open'],
  fixed: ['Fixed', 'Thanks for flagging it. Your score has been updated.', 'fixed'],
  removed: ['Removed from your score', 'This call no longer counts toward your scorecard.', 'fixed'],
  kept: ['Reviewed: grade stands', '', 'kept'],
}
function flagKey(callId, stepKey) { return `${callId}|${stepKey || ''}` }

function FlagStatus({ flag }) {
  const [t, sub, tone] = FLAG_STATUS[flag.status] || FLAG_STATUS.open
  return (
    <div className={`csr-flagst ${tone}`}>
      <b>{t}</b>{sub ? <span> · {sub}</span> : null}
      {flag.resolution_note ? <div className="csr-flagnote">Coach: {flag.resolution_note}</div> : null}
    </div>
  )
}

function FlagButton({ supabase, callId, stepKey, steps, flags, onFlagged }) {
  const existing = flags?.[flagKey(callId, stepKey)]
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(stepKey || '')
  const [reason, setReason] = useState(stepKey ? 'step_wrong' : '')
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (existing && !open) return <FlagStatus flag={existing} />
  const tooShort = context.trim().length < 10
  const submit = async (e) => {
    e?.stopPropagation?.()
    if (!reason) { setErr('Pick what looks wrong.'); return }
    if (tooShort) { setErr('Please add a sentence or two so we know what to check.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('csr_flag_call', { p_call: callId, p_step_key: step || null, p_reason: reason, p_context: context.trim() })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOpen(false); setContext('')
    onFlagged && onFlagged()
  }
  if (!open) return <button className="csr-flagbtn" onClick={(e) => { e.stopPropagation(); setOpen(true) }}>This doesn’t look right</button>
  return (
    <div className="csr-flagform" onClick={(e) => e.stopPropagation()}>
      <div className="csr-edit-h">What doesn’t look right?</div>
      {!stepKey && steps?.length ? (
        <label className="csr-flagrow">Which step?
          <select value={step} onChange={(e) => setStep(e.target.value)}>
            <option value="">The whole call</option>
            {steps.map((s) => <option key={s.key} value={s.key}>Step {stepNum(s.label)} · {stepName(s.label)}</option>)}
          </select>
        </label>
      ) : null}
      <div className="csr-flagreasons">
        {FLAG_REASONS.map(([k, label]) => (
          <label key={k}><input type="radio" name={`r-${callId}-${stepKey || 'all'}`} checked={reason === k} onChange={() => setReason(k)} /> {label}</label>
        ))}
      </div>
      <textarea rows={3} value={context} maxLength={2000} onChange={(e) => setContext(e.target.value)}
        placeholder="Tell us what happened on this call. Example: “This was Mike, one of our techs, calling from the field.” or “I did give my name, it’s at the very start of the recording.”" />
      <div className="csr-sub">{tooShort ? 'A sentence or two is required so your coach knows what to check.' : 'Your coach will listen to the call and let you know.'}</div>
      {err ? <div className="csr-err">{err}</div> : null}
      <div className="csr-row">
        <button className="csr-btn" disabled={busy || tooShort || !reason} onClick={submit}>{busy ? 'Sending…' : 'Send for review'}</button>
        <button className="csr-btn ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); setOpen(false); setErr('') }}>Cancel</button>
      </div>
    </div>
  )
}

// Opsis QA staff: open flags, with the call and the AI's reasoning, and the three decisions.
function FlagQueue({ supabase, csrId, onChanged, title = 'Flagged calls to review' }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [hidden, setHidden] = useState(false)
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('csr_flags', { p_csr: csrId || null, p_open_only: !csrId })
    if (error) { if (!csrId) setHidden(true); else setErr(error.message); return }
    setRows(data || [])
  }, [supabase, csrId])
  useEffect(() => { load() }, [load])
  if (hidden) return null
  if (err) return <div className="csr-card csr-err">{err}</div>
  if (!rows) return null
  const open = rows.filter((r) => r.status === 'open')
  if (!csrId && !open.length) return null
  const decide = async (f, decision) => {
    setBusy(f.id)
    const { error } = await supabase.rpc('csr_resolve_flag', { p_flag: f.id, p_decision: decision, p_note: notes[f.id] || null })
    setBusy(null)
    if (error) { setErr(error.message); return }
    await load(); onChanged && onChanged()
  }
  return (
    <div className="csr-card csr-flagq">
      <h2>{title} {open.length ? <span className="csr-pill">{open.length} open</span> : null}</h2>
      {!rows.length ? <div className="csr-sub">No calls have been flagged.</div> : null}
      {rows.map((f) => (
        <div key={f.id} className={`csr-flagitem ${f.status}`}>
          <div className="csr-ex-h">
            {!csrId ? <span className="csr-rname">{f.csr_name}</span> : null}
            <span>{fmtCallTime(f.call_started_at)}</span>
            <span className="csr-sub">{f.direction || ''} · {fmtDur(f.duration_sec)} · {f.step_label ? `Step ${stepNum(f.step_label)} ${stepName(f.step_label)}` : 'Whole call'}{f.step_answer ? ` (graded ${f.step_answer})` : ''}</span>
            <b>{f.score != null ? `${Math.round(f.score)}%` : ''}</b>
          </div>
          <div className="csr-flagctx"><b>{(FLAG_REASONS.find(([k]) => k === f.reason) || [])[1] || f.reason}</b> · {f.flagged_by || 'CSR'}: “{f.context}”</div>
          {f.ai_why ? <div className="csr-why">AI said: {f.ai_why}</div> : null}
          {f.transcript_start ? <details className="csr-sub"><summary>Transcript (start)</summary><div className="csr-pre">{f.transcript_start}</div></details> : null}
          <RecordingPlayer supabase={supabase} callId={f.call_id} />
          {f.status === 'open' ? (
            <div className="csr-flagact">
              <input placeholder="Note to the CSR (optional, they'll see this)" value={notes[f.id] || ''} onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} />
              <div className="csr-row">
                <button className="csr-btn" disabled={busy === f.id} onClick={() => decide(f, 'remove_call')}>Remove call from score</button>
                {f.step_key ? <button className="csr-btn" disabled={busy === f.id} onClick={() => decide(f, 'fix_step')}>Fix step (give credit)</button> : null}
                <button className="csr-btn ghost" disabled={busy === f.id} onClick={() => decide(f, 'keep')}>Keep grade</button>
              </div>
            </div>
          ) : <FlagStatus flag={f} />}
        </div>
      ))}
    </div>
  )
}

function ExampleCard({ supabase, ex, kind, stepKey, flags, onFlagged, canFlag }) {
  return (
    <div className={`csr-ex ${kind}`}>
      <div className="csr-ex-h">
        <span>{fmtCallTime(ex.started_at)}</span>
        <span className="csr-sub">{ex.direction || ''} · {fmtDur(ex.duration_sec)}{ex.outcome ? ` · ${ex.outcome}` : ''}</span>
        <b className={ex.score < 60 ? 'csr-lowtxt' : ''}>{ex.score != null ? `${Math.round(ex.score)}%` : ''}</b>
      </div>
      {ex.evidence ? <div className="csr-quote">"{ex.evidence}"</div> : null}
      {ex.why ? <div className="csr-why">{ex.why}</div> : null}
      <RecordingPlayer supabase={supabase} callId={ex.call_id} />
      {canFlag && kind === 'bad' ? <FlagButton supabase={supabase} callId={ex.call_id} stepKey={stepKey} flags={flags} onFlagged={onFlagged} /> : null}
    </div>
  )
}

function StepRow({ step, examples, supabase, open, onToggle, flags, onFlagged, canFlag }) {
  const pct = step.pct
  const tone = pct == null ? '' : pct < 60 ? 'low' : pct < 80 ? 'mid' : ''
  const ex = examples || { right: [], missed: [] }
  const hasEx = (ex.right?.length || 0) + (ex.missed?.length || 0) > 0
  return (
    <div className={`csr-stepwrap ${open ? 'open' : ''}`}>
      <button className="csr-step" onClick={hasEx ? onToggle : undefined} style={{ cursor: hasEx ? 'pointer' : 'default' }}>
        <span className="csr-stepn">{stepNum(step.label)}</span>
        <span className="csr-stepname">{stepName(step.label)} <span className="csr-pts">· {step.points} pts</span>
          {hasEx ? <span className="csr-exlink">{open ? 'Hide examples' : 'See examples'}</span> : null}</span>
        {step.applicable > 0 ? (
          <>
            <div className={`csr-bar ${tone}`}><i style={{ width: `${pct}%` }} /></div>
            <span className="csr-steppct">{pct}%<small>{step.done} of {step.applicable}</small></span>
          </>
        ) : (
          <span className="csr-na">No calls where this applied</span>
        )}
      </button>
      {open ? (
        <div className="csr-exgrid">
          <div>
            <div className="csr-exhead good">✓ Done well</div>
            {ex.right?.length ? ex.right.map((e) => <ExampleCard key={e.call_id} supabase={supabase} ex={e} kind="good" stepKey={step.key} />)
              : <div className="csr-sub">No examples this week.</div>}
          </div>
          <div>
            <div className="csr-exhead bad">✗ Missed</div>
            {ex.missed?.length ? ex.missed.map((e) => <ExampleCard key={e.call_id} supabase={supabase} ex={e} kind="bad" stepKey={step.key} flags={flags} onFlagged={onFlagged} canFlag={canFlag} />)
              : <div className="csr-sub">Nothing missed this week.</div>}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Welcome({ name, brand }) {
  return (
    <div className="csr-card csr-welcome">
      <h2>Welcome{name ? `, ${name.split(' ')[0]}` : ''}!</h2>
      <p>Your coaching scorecard starts after your first 1:1 coaching session{brand ? ` with the ${brand} coaching team` : ''}.</p>
      <p className="csr-sub">Once we've met, you'll see your weekly call quality, your coaching focus, notes from our sessions, and activities here.</p>
    </div>
  )
}

// ---------- coach (staff) editors ----------
function FocusEditor({ supabase, csrId, week, fromWeek, focus, steps, onSaved }) {
  const [title, setTitle] = useState(focus?.title || '')
  const [body, setBody] = useState(focus?.body || '')
  const [goal, setGoal] = useState(focus?.goal || '')
  const [stepKey, setStepKey] = useState(focus?.step_key || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setTitle(focus?.title || ''); setBody(focus?.body || ''); setGoal(focus?.goal || ''); setStepKey(focus?.step_key || '') }, [focus, week])
  const save = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('csr_set_focus', { p_csr: csrId, p_week: week, p_title: title, p_body: body || null, p_goal: goal || null, p_step_key: stepKey || null })
    setBusy(false)
    if (error) setErr(error.message); else onSaved()
  }
  const generate = async () => {
    if (focus && !window.confirm('Replace this focus with one built from the audits?')) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('csr_generate_focus', { p_csr: csrId, p_from_week: fromWeek, p_for_week: week })
    setBusy(false)
    if (error) setErr(error.message)
    else if (data?.skipped) setErr('Not enough scored calls in that week to pick a focus.')
    else onSaved()
  }
  return (
    <div className="csr-edit">
      <div className="csr-edit-h">Focus for the week of {weekRange(week)}</div>
      <div className="csr-row">
        <button className="csr-btn ghost" disabled={busy} onClick={generate}>Build from week of {weekRange(fromWeek)} audits</button>
        <span className="csr-sub">Picks the step that cost the most points and writes a script line. Edit anything below.</span>
      </div>
      <select value={stepKey} onChange={(e) => { setStepKey(e.target.value); if (!title) { const s = steps.find((x) => x.key === e.target.value); if (s) setTitle(stepName(s.label)) } }}>
        <option value="">Rubric step (optional)</option>
        {steps.map((s) => <option key={s.key} value={s.key}>Step {stepNum(s.label)} · {stepName(s.label)}</option>)}
      </select>
      <input placeholder="Focus headline, e.g. Capture payment once the appointment is booked" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea rows={3} placeholder="What to do differently (example wording helps)" value={body} onChange={(e) => setBody(e.target.value)} />
      <input placeholder="Goal for the week" value={goal} onChange={(e) => setGoal(e.target.value)} />
      <div className="csr-row">
        <button className="csr-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save focus'}</button>
        {focus ? <button className="csr-btn ghost" disabled={busy} onClick={async () => { setTitle(''); setBusy(true); const { error } = await supabase.rpc('csr_set_focus', { p_csr: csrId, p_week: week, p_title: '' }); setBusy(false); if (error) setErr(error.message); else onSaved() }}>Clear</button> : null}
        {err ? <span className="csr-err">{err}</span> : null}
      </div>
    </div>
  )
}

function NoteEditor({ supabase, csrId, onSaved }) {
  const [date, setDate] = useState(todayET())
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!body.trim()) { setErr('Write the note first'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('csr_add_note', { p_csr: csrId, p_session_date: date, p_body: body, p_title: title || null })
    setBusy(false)
    if (error) setErr(error.message); else { setTitle(''); setBody(''); onSaved() }
  }
  return (
    <div className="csr-edit">
      <div className="csr-edit-h">Add a coaching note (the CSR and their managers will see it)</div>
      <div className="csr-row"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} /><input placeholder="Session title, e.g. Week 1 intro" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <textarea rows={3} placeholder="What you covered, wins, what to work on" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="csr-row"><button className="csr-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add note'}</button>{err ? <span className="csr-err">{err}</span> : null}</div>
    </div>
  )
}

function ActivityEditor({ supabase, csrId, brand, onSaved }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState('ahaslides')
  const [due, setDue] = useState('')
  const [scope, setScope] = useState('csr')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!title.trim()) { setErr('Give it a title'); return }
    if (url && !/^https?:\/\//i.test(url)) { setErr('Link must start with http:// or https://'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('csr_add_activity', {
      p_title: title, p_url: url || null, p_kind: kind,
      p_csr: scope === 'csr' ? csrId : null, p_brand: scope === 'brand' ? brand : null, p_due: due || null,
    })
    setBusy(false)
    if (error) setErr(error.message); else { setTitle(''); setUrl(''); setDue(''); onSaved() }
  }
  return (
    <div className="csr-edit">
      <div className="csr-edit-h">Add an activity</div>
      <input placeholder="Title, e.g. Objection handling quiz" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder="Link (AhaSlides, word search PDF, video…)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="csr-row">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="ahaslides">AhaSlides</option><option value="word_search">Word search</option>
          <option value="video">Video</option><option value="pdf">PDF</option><option value="link">Link</option>
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Due date (optional)" style={{ maxWidth: 170 }} />
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="csr">Just this CSR</option>
          <option value="brand">Every CSR at {brand}</option>
          <option value="all">Every CSR (all brands)</option>
        </select>
      </div>
      <div className="csr-row"><button className="csr-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add activity'}</button>{err ? <span className="csr-err">{err}</span> : null}</div>
    </div>
  )
}

function StartDateEditor({ supabase, csrId, value, onSaved }) {
  const [d, setD] = useState(value || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => setD(value || ''), [value])
  const save = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('csr_set_start_date', { p_csr: csrId, p_date: d || null })
    setBusy(false)
    if (error) setErr(error.message); else onSaved()
  }
  return (
    <div className="csr-row csr-start">
      <span className="csr-sub">First 1:1 date</span>
      <input type="date" value={d} onChange={(e) => setD(e.target.value)} style={{ maxWidth: 170 }} />
      {d ? <span className="csr-sub">Scoring starts Monday, {fmtDay(addDays(d, 7 - ((parseDay(d).getUTCDay() + 6) % 7)), { month: 'short', day: 'numeric' })}</span> : null}
      <button className="csr-btn ghost" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      {err ? <span className="csr-err">{err}</span> : null}
    </div>
  )
}

const KIND_STYLE = {
  ahaslides: ['AS', '#7c3aed', 'AhaSlides'], word_search: ['WS', '#0284c7', 'Word search'],
  video: ['▶', '#dc2626', 'Video'], pdf: ['PDF', '#b45309', 'PDF'], link: ['↗', '#0f766e', 'Link'],
}

function ActivityRow({ a, canMark, canArchive, onMark, onArchive }) {
  const [ab, color, kindLabel] = KIND_STYLE[a.kind] || KIND_STYLE.link
  const done = !!a.done_at
  return (
    <div className={`csr-act ${done ? 'done' : ''}`}>
      <div className="csr-ic" style={{ background: done ? '#64748b' : color }}>{done ? '✓' : ab}</div>
      <div className="csr-act-body">
        <div className="csr-act-t">{a.title}</div>
        <div className="csr-sub">{kindLabel}{a.due_date ? ` · Due ${fmtDay(a.due_date)}` : ''}{done ? ` · Done ${new Date(a.done_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })}` : ''}</div>
        {a.description ? <div className="csr-sub">{a.description}</div> : null}
      </div>
      <div className="csr-act-actions">
        {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">Open ↗</a> : null}
        {canMark ? <button className="csr-link" onClick={() => onMark(a, !done)}>{done ? 'Undo' : 'Mark done'}</button> : null}
        {canArchive ? <button className="csr-link muted" onClick={() => onArchive(a)}>Remove</button> : null}
      </div>
    </div>
  )
}

function CallsList({ calls, loading, supabase, steps, flags, onFlagged, canFlag }) {
  const [open, setOpen] = useState(null)
  if (loading) return <div className="csr-sub">Loading calls…</div>
  if (!calls?.length) return <div className="csr-sub">No scored calls this week yet.</div>
  return (
    <div className="csr-calls">
      {calls.map((c) => (
        <div key={c.id} className="csr-call">
          <button className="csr-call-h" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span>{fmtCallTime(c.started_at)}</span>
            <span className="csr-sub">{c.direction || ''} · {fmtDur(c.duration_sec)}{c.hold_count > 0 ? ` · ${c.hold_count} hold` : ''}</span>
            <span className="csr-sub">{c.outcome || ''}</span>
            <b className={c.score < 60 ? 'csr-lowtxt' : ''}>{Object.values(flags || {}).some((f) => f.call_id === c.id && f.status === 'open') ? <span className="csr-flagdot" title="Flagged for review">⚑ </span> : null}{c.score != null ? `${Math.round(c.score)}%` : '—'}</b>
          </button>
          {open === c.id ? (
            <div className="csr-call-b">
              {c.coaching_note ? <p><b>Coaching tip:</b> {c.coaching_note}</p> : null}
              {c.missed?.length ? <p><b>Steps missed:</b> {c.missed.map(stepName).join(', ')}</p> : <p>No steps missed.</p>}
              <RecordingPlayer supabase={supabase} callId={c.id} />
              {canFlag ? <FlagButton supabase={supabase} callId={c.id} stepKey={null} steps={steps} flags={flags} onFlagged={onFlagged} /> : null}
              {canFlag ? Object.values(flags || {}).filter((f) => f.call_id === c.id && f.step_key).map((f) => (
                <div key={f.id} className="csr-sub">Step {stepNum(f.step_label)} {stepName(f.step_label)}: <FlagStatus flag={f} /></div>
              )) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ---------- one CSR's scorecard ----------
function Scorecard({ supabase, csrId, isCsr, onBack }) {
  const [week, setWeek] = useState(null)
  const [data, setData] = useState(null)
  const [calls, setCalls] = useState([])
  const [callsLoading, setCallsLoading] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [examples, setExamples] = useState({})
  const [openStep, setOpenStep] = useState(null)
  const [flags, setFlags] = useState({})
  const loadFlags = useCallback(async (cid) => {
    const { data: f, error } = await supabase.rpc('csr_flags', { p_csr: cid || csrId || null })
    if (error) { setFlags({}); return }
    const map = {}
    for (const x of f || []) { const k = flagKey(x.call_id, x.step_key); if (!map[k] || x.status === 'open') map[k] = x }
    setFlags(map)
  }, [supabase, csrId])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data: d, error } = await supabase.rpc('csr_scorecard', { p_csr: csrId || null, p_week: week || null })
    setLoading(false)
    if (error) { setErr(error.message); return }
    setData(d)
    if (d?.status === 'active') {
      setCallsLoading(true)
      const [{ data: c, error: ce }, { data: ex, error: ee }] = await Promise.all([
        supabase.rpc('csr_calls', { p_csr: csrId || null, p_week: d.week }),
        supabase.rpc('csr_step_examples', { p_csr: csrId || null, p_week: d.week }),
      ])
      setCallsLoading(false)
      setCalls(ce ? [] : (c || []))
      setExamples(ee ? {} : (ex || {}))
      loadFlags(d?.csr?.id)
    } else {
      setCalls([]); setExamples({})
    }
  }, [supabase, csrId, week])

  useEffect(() => { load() }, [load])

  const onMark = async (a, done) => {
    const { error } = await supabase.rpc('csr_mark_activity', { p_activity: a.id, p_done: done })
    if (error) setErr(error.message); else load()
  }
  const onArchive = async (a) => {
    if (!window.confirm(`Remove "${a.title}"${a.for_everyone ? ' for everyone it was assigned to' : ''}?`)) return
    const { error } = await supabase.rpc('csr_archive_activity', { p_activity: a.id })
    if (error) setErr(error.message); else load()
  }
  const onDeleteNote = async (n) => {
    if (!window.confirm('Delete this coaching note?')) return
    const { error } = await supabase.rpc('csr_delete_note', { p_note: n.id })
    if (error) setErr(error.message); else load()
  }

  if (loading && !data) return <div className="csr-card">Loading scorecard…</div>
  if (err && !data) return <div className="csr-card csr-err">Couldn't load this scorecard: {err}</div>
  if (!data) return null

  const canEdit = !!data.can_edit && !isCsr
  const csr = data.csr || {}

  const header = (
    <div className="csr-hello">
      <div>
        {onBack ? <button className="csr-link" onClick={onBack}>← All CSRs</button> : null}
        <h1>{isCsr ? `Hi ${String(csr.full_name || '').split(' ')[0]}` : csr.full_name}</h1>
        <div className="csr-sub">{csr.brand}{data.status === 'active' ? ` · Coaching week ${data.week_number}: ${weekRange(data.week)}` : ''}</div>
      </div>
      {data.status === 'active' ? (
        <div className="csr-row">
          <span className="csr-pill">Week {data.week_number}{data.week === data.current_week ? ' · in progress' : ''}</span>
          {data.weeks?.length > 1 ? (
            <select value={data.week} onChange={(e) => setWeek(e.target.value)}>
              {data.weeks.map((w) => <option key={w.week_start} value={w.week_start}>Week {w.week_number} · {weekRange(w.week_start)}</option>)}
            </select>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  if (data.status === 'not_started') {
    return (
      <>
        {header}
        {canEdit ? <div className="csr-card"><StartDateEditor supabase={supabase} csrId={csr.id} value={null} onSaved={load} /></div> : null}
        <Welcome name={isCsr ? csr.full_name : ''} brand={csr.brand} />
      </>
    )
  }

  if (data.status === 'pre_start') {
    return (
      <>
        {header}
        {canEdit ? <div className="csr-card"><StartDateEditor supabase={supabase} csrId={csr.id} value={csr.coaching_start_date} onSaved={load} /></div> : null}
        <div className="csr-card csr-welcome">
          <h2>{isCsr ? `Welcome, ${String(csr.full_name || '').split(' ')[0]}!` : `${csr.full_name}'s scoring hasn't started yet`}</h2>
          <p>{isCsr ? 'Your' : 'Their'} scoring starts <b>Monday, {fmtDay(data.program_start, { month: 'long', day: 'numeric' })}</b>. Calls from that day on will show up here each week.</p>
          <p className="csr-sub">{isCsr ? 'Until then, look over the Call Flow Guide tab to see the 11 steps every call is scored on.' : 'The week of their first 1:1 is for reviewing the rubric, so it is never scored.'}</p>
        </div>
        {data.focus ? (
          <div className="csr-card csr-focus">
            <div className="csr-focus-l">THIS WEEK'S FOCUS</div>
            <div className="csr-focus-t">{data.focus.title}</div>
            {data.focus.body ? <div className="csr-pre">{data.focus.body}</div> : null}
          </div>
        ) : null}
        <div className="csr-grid csr-g2">
          <div className="csr-card">
            <h2>Coaching notes</h2>
            {canEdit ? <NoteEditor supabase={supabase} csrId={csr.id} onSaved={load} /> : null}
            {data.notes?.length ? data.notes.map((n) => (
              <div key={n.id} className="csr-note">
                <div className="csr-sub">{fmtDay(n.session_date, { month: 'short', day: 'numeric', year: 'numeric' })}{n.coach ? ` · Coach: ${n.coach}` : ''}
                  {canEdit ? <button className="csr-link muted" onClick={() => onDeleteNote(n)}>Delete</button> : null}</div>
                {n.title ? <div className="csr-note-t">{n.title}</div> : null}
                <div className="csr-pre">{n.body}</div>
              </div>
            )) : <div className="csr-sub">Notes from your coaching sessions will show here.</div>}
          </div>
          <div className="csr-card">
            <h2>Activities</h2>
            {data.activities?.length ? data.activities.map((a) => (
              <ActivityRow key={a.id} a={a} canMark={isCsr} canArchive={canEdit} onMark={onMark} onArchive={onArchive} />
            )) : <div className="csr-sub">Activities from your coach will show here.</div>}
            {canEdit ? <ActivityEditor supabase={supabase} csrId={csr.id} brand={csr.brand} onSaved={load} /> : null}
          </div>
        </div>
      </>
    )
  }

  const m = data.metrics || {}
  const p = data.prev_metrics
  const steps = m.steps || []
  const focus = data.focus

  return (
    <>
      {header}
      {err ? <div className="csr-banner csr-err">{err}</div> : null}
      {!csr.has_lines ? <div className="csr-banner">This CSR isn't linked to a phone line yet, so call numbers will stay empty until they are.</div> : null}
      {data.week === data.current_week ? <div className="csr-banner info">This week is still in progress. Numbers update as calls are scored.</div> : null}
      {canEdit ? <div className="csr-card"><StartDateEditor supabase={supabase} csrId={csr.id} value={csr.coaching_start_date} onSaved={load} /></div> : null}
      {canEdit ? <FlagQueue supabase={supabase} csrId={csr.id} title={`Calls ${String(csr.full_name || '').split(' ')[0]} flagged`} onChanged={load} /> : null}

      <div className="csr-grid csr-g5">
        <Tile label="Call Quality" value={m.qa_avg != null ? `${Number(m.qa_avg).toFixed(1)}%` : '—'}
          sub={p ? null : (data.week_number === 1 ? 'Baseline week · change vs last week starts week 2' : null)}>
          <Delta cur={m.qa_avg} prev={p?.qa_avg} unit=" pts" />
          <div className="csr-sub">{m.scored_calls || 0} scored calls</div>
        </Tile>
        <Tile label="Calls Answered" value={m.calls_answered ?? 0}>
          <Delta cur={m.calls_answered} prev={p?.calls_answered} decimals={0} />
        </Tile>
        <Tile label="Avg Talk Time" value={fmtDur(m.avg_talk_sec)} sub="Total talk time ÷ calls answered">
          <Delta cur={m.avg_talk_sec} prev={p?.avg_talk_sec} unit="time" lowerIsBetter={false} />
        </Tile>
        <Tile label="Calls Put on Hold" value={m.hold_count_known ? (m.calls_on_hold ?? 0) : '—'}
          sub={m.hold_count_known ? (m.scored_calls ? `${Math.round(100 * (m.calls_on_hold || 0) / m.scored_calls)}% of scored calls` : null) : 'Not enough scored calls yet'}>
          {m.hold_count_known && p?.hold_count_known ? <Delta cur={m.calls_on_hold} prev={p.calls_on_hold} decimals={0} lowerIsBetter /> : null}
        </Tile>
        <Tile label="Avg Hold Time" value={m.hold_time_known ? fmtDur(m.avg_hold_sec) : '—'}
          sub={m.hold_time_known ? 'Total hold time ÷ calls put on hold' : 'Hold times are tracked from the week of Sep 28'}>
          {m.hold_time_known && p?.hold_time_known ? <Delta cur={m.avg_hold_sec} prev={p.avg_hold_sec} unit="time" lowerIsBetter /> : null}
        </Tile>
      </div>

      <div className="csr-grid csr-g2">
        <div>
          <div className="csr-card csr-focus">
            <div className="csr-focus-l">THIS WEEK'S FOCUS{focus?.week_start ? ` · WEEK OF ${fmtDay(focus.week_start).toUpperCase()}` : ''}{focus?.step_key ? ` · STEP ${stepNum((steps.find((s) => s.key === focus.step_key) || {}).label)}` : ''}</div>
            {focus ? (
              <>
                <div className="csr-focus-t">{focus.title}</div>
                {focus.body ? <div className="csr-pre">{focus.body}</div> : null}
                {focus.goal ? <div className="csr-goal"><b>Goal:</b> {focus.goal}</div> : null}
              </>
            ) : <div className="csr-sub">Your coach will set your focus for this week at your next session.</div>}
            {canEdit ? <FocusEditor supabase={supabase} csrId={csr.id} week={focus?.week_start || addDays(data.current_week, 7)}
              fromWeek={data.week} focus={focus} steps={steps} onSaved={load} /> : null}
          </div>

          <div className="csr-card">
            <h2>Your Call Flow ({data.week === data.current_week ? 'this week so far' : `week ${data.week_number}`})</h2>
            <div className="csr-sub" style={{ marginBottom: 8 }}>% of calls where each step was done. Calls where a step didn't apply aren't counted. Click a step to see call examples.</div>
            {steps.map((s) => (
              <StepRow key={s.key} step={s} examples={examples[s.key]} supabase={supabase}
                open={openStep === s.key} onToggle={() => setOpenStep(openStep === s.key ? null : s.key)}
                flags={flags} onFlagged={() => loadFlags(csr.id)} canFlag />
            ))}
            {m.hold_time_known && m.hold_events > 0 ? (
              <div className="csr-holdpol">Hold policy: asked permission on {m.hold_asked_permission} of {m.hold_events} holds, thanked the caller on {m.hold_thanked} of {m.hold_events}.</div>
            ) : m.legacy_hold_calls > 0 ? (
              <div className="csr-holdpol">Hold policy: followed on {m.legacy_hold_policy_ok} of {m.legacy_hold_calls} calls with a hold or transfer (ask permission first, thank them after).</div>
            ) : null}
          </div>

          <div className="csr-card">
            <h2>Coaching notes</h2>
            {canEdit ? <NoteEditor supabase={supabase} csrId={csr.id} onSaved={load} /> : null}
            {data.notes?.length ? data.notes.map((n) => (
              <div key={n.id} className="csr-note">
                <div className="csr-sub">{fmtDay(n.session_date, { month: 'short', day: 'numeric', year: 'numeric' })}{n.coach ? ` · Coach: ${n.coach}` : ''}
                  {canEdit ? <button className="csr-link muted" onClick={() => onDeleteNote(n)}>Delete</button> : null}</div>
                {n.title ? <div className="csr-note-t">{n.title}</div> : null}
                <div className="csr-pre">{n.body}</div>
              </div>
            )) : <div className="csr-sub">Notes from your coaching sessions will show here.</div>}
          </div>
        </div>

        <div>
          <div className="csr-card">
            <h2>Activities</h2>
            {data.activities?.length ? data.activities.map((a) => (
              <ActivityRow key={a.id} a={a} canMark={isCsr} canArchive={canEdit} onMark={onMark} onArchive={onArchive} />
            )) : <div className="csr-sub">Activities from your coach will show here.</div>}
            {canEdit ? <ActivityEditor supabase={supabase} csrId={csr.id} brand={csr.brand} onSaved={load} /> : null}
          </div>

          <div className="csr-card">
            <h2>{isCsr ? 'My calls' : 'Calls'} · {weekRange(data.week)}</h2>
            <div className="csr-sub" style={{ marginBottom: 8 }}>Something graded wrong? Open the call and tap “This doesn’t look right.”</div>
            <CallsList calls={calls} loading={callsLoading} supabase={supabase} steps={steps} flags={flags} onFlagged={() => loadFlags(csr.id)} canFlag />
          </div>
        </div>
      </div>
    </>
  )
}

// ---------- roster (managers / staff) ----------
function Roster({ supabase, onPick, isStaff }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    let alive = true
    supabase.rpc('csr_roster').then(({ data, error }) => { if (!alive) return; if (error) setErr(error.message); else setRows(data || []) })
    return () => { alive = false }
  }, [supabase])
  const groups = useMemo(() => {
    const g = {}
    for (const r of rows || []) {
      if (q && !`${r.full_name} ${r.brand}`.toLowerCase().includes(q.toLowerCase())) continue
      ;(g[r.brand || 'Other'] ||= []).push(r)
    }
    return g
  }, [rows, q])
  if (err) return <div className="csr-card csr-err">{err}</div>
  if (!rows) return <div className="csr-card">Loading CSRs…</div>
  if (!rows.length) return <div className="csr-card">No CSR scorecards available for your account.</div>
  return (
    <>
      <div className="csr-hello"><div><h1>CSR Scorecards</h1><div className="csr-sub">{rows.length} CSRs</div></div>
        <input className="csr-search" placeholder="Search name or brand" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {isStaff ? <FlagQueue supabase={supabase} /> : null}
      {Object.entries(groups).map(([brand, list]) => (
        <div key={brand} className="csr-card">
          <h2>{brand}</h2>
          {list.map((r) => (
            <button key={r.id} className="csr-rrow" onClick={() => onPick(r.id)}>
              <span className="csr-rname">{r.full_name}</span>
              <span className="csr-sub">{r.week_number ? `Coaching week ${r.week_number}` : r.program_start ? `Scoring starts ${fmtDay(r.program_start)}` : 'Not started'}{!r.has_lines ? ' · no phone line linked' : ''}</span>
              <span className="csr-link">Open →</span>
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

// ---------- reference tabs: Call Flow Guide + How to Use ----------
function CallFlowGuide({ supabase }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    supabase.rpc('csr_rubric').then(({ data, error }) => { if (!alive) return; if (error) setErr(error.message); else setRows(data || []) })
    return () => { alive = false }
  }, [supabase])
  if (err) return <div className="csr-card csr-err">Couldn't load the call flow guide: {err}</div>
  if (!rows) return <div className="csr-card">Loading…</div>
  const total = rows.reduce((a, r) => a + (Number(r.points) || 0), 0)
  return (
    <div className="csr-card">
      <h2>Universal CSR Call Flow · the 11 steps every call is scored on</h2>
      <div className="csr-sub" style={{ marginBottom: 10 }}>
        Every call is worth {total} points. If a step doesn't apply to a call, you still get its points. Outbound calls use the same steps in a different order:
        Opener → Empathy → Discovery → Verify → Expectations + Fee → Offer → Ask for the Booking → Payment → Confirm → Thank.
      </div>
      <div className="csr-guide">
        {rows.map((r) => (
          <div key={r.key} className="csr-guide-row">
            <div className="csr-guide-n">{r.step}</div>
            <div className="csr-guide-b">
              <div className="csr-guide-t">{r.beat} <span className="csr-pts">· {r.points} pts</span></div>
              <div>{r.goal}</div>
              {r.sounds_like ? <div className="csr-guide-say"><b>Sounds like:</b> {r.sounds_like}</div> : null}
              {r.na_when ? <div className="csr-sub"><b>Doesn't count against you:</b> {r.na_when}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HowToUse({ audience }) {
  const csr = (
    <div className="csr-card csr-howto">
      <h2>{audience === 'csr' ? 'How to use your scorecard' : 'How CSRs use their scorecard'}</h2>
      <p>Your scorecard shows how your calls went each week, starting the Monday after your first coaching session. Only you, your manager and your coach can see it.</p>
      <h3>What you'll see</h3>
      <ul>
        <li><b>Top tiles:</b> Call Quality, Calls Answered, Avg Talk Time, Calls Put on Hold and Avg Hold Time. Week 1 is your starting point. From week 2 on, each tile shows whether you went up or down from the week before.</li>
        <li><b>This week's focus:</b> the one skill to work on this week, and your goal for it.</li>
        <li><b>Your Call Flow:</b> the 11 steps of a great call, and how often you did each one. Click a step to see 3 calls where you nailed it and 3 where you missed it, each with the recording. Calls where a step didn't apply don't count against you. Calls with techs, coworkers or vendors aren't graded at all.</li>
        <li><b>My calls:</b> every graded call this week. Tap a call for a coaching tip, the steps you missed and the recording.</li>
        <li><b>Activities:</b> practice your coach assigns, like AhaSlides or word searches. Open it, then tap <b>Mark done</b>.</li>
        <li><b>Coaching notes:</b> a recap of each coaching session.</li>
        <li><b>Call Flow Guide</b> (tab above): what each of the 11 steps means and what it sounds like.</li>
      </ul>
      <h3>Think a call was graded wrong?</h3>
      <ol>
        <li>Open the call in <b>My calls</b>, or a missed example under a step.</li>
        <li>Tap <b>This doesn't look right</b>.</li>
        <li>Pick what's wrong, then write a sentence or two about what happened. Example: <i>"This was Mike, one of our techs."</i></li>
        <li>Tap <b>Send for review</b>. It will show "Sent for review" until your coach checks it. If the grade is changed, your score updates on its own.</li>
      </ol>
    </div>
  )
  if (audience === 'csr') return csr
  return (
    <>
      {audience === 'staff' ? (
        <div className="csr-card csr-howto">
          <h2>For the Opsis team</h2>
          <p>Click <b>Open</b> on any CSR to see their scorecard exactly as they see it, plus your coach tools. No need to log in as the CSR.</p>
          <h3>Before a CSR's first session</h3>
          <ul>
            <li>Set <b>First 1:1 date</b>. Scoring starts the Monday after it. The week of the 1:1 is for reviewing the rubric and is never scored.</li>
            <li>Hand over their login at the session. Nothing is emailed to CSRs.</li>
          </ul>
          <h3>Each week</h3>
          <ol>
            <li><b>Focus:</b> click <b>Build from audits</b> to draft it from their weakest step, then edit it and save. You can also write your own.</li>
            <li><b>Coaching notes:</b> add a note after each session. The CSR sees it.</li>
            <li><b>Activities:</b> add a link (AhaSlides, word search, etc.) for one CSR or their whole brand. You'll see when they mark it done.</li>
          </ol>
          <h3>Flagged calls</h3>
          <p>Flagged calls show under <b>Flagged calls to review</b>, on the CSR list and inside that CSR's scorecard. Listen to the recording, read their note and the AI's reasoning, then pick one:</p>
          <ul>
            <li><b>Remove call from score:</b> it wasn't a customer call, or it shouldn't count.</li>
            <li><b>Fix step (give credit):</b> the AI graded that step wrong. Their score recalculates right away.</li>
            <li><b>Keep grade:</b> the grade was right.</li>
          </ul>
          <p>Add a short note when you can. The CSR sees your decision and your note.</p>
          <h3>Good to know</h3>
          <ul>
            <li>Every call is out of 100. A step that didn't apply earns full points.</li>
            <li>Internal calls aren't graded: extension-to-extension calls, and techs, coworkers or vendors calling about a job.</li>
            <li>GarageCo managers see their location's CSRs in the <b>CSR Scorecards</b> tab at garageco.opsiscx.com. Enterprise logins see every brand.</li>
          </ul>
        </div>
      ) : (
        <div className="csr-card csr-howto">
          <h2>For managers</h2>
          <p>Click <b>Open</b> on any of your CSRs to see their scorecard exactly as they see it. It's read-only: their coach sets the weekly focus, notes and activities. If one of your CSR's calls looks graded wrong, you can tap <b>This doesn't look right</b> on it too.</p>
        </div>
      )}
      {csr}
    </>
  )
}

function Tabs({ tabs, value, onChange }) {
  return (
    <div className="csr-tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={`csr-tab ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

// ---------- entry point ----------
export default function CsrScorecard({ supabase, mode = 'csr', accent = '#0f766e' }) {
  const [picked, setPicked] = useState(null)
  const [tab, setTab] = useState('card')
  const isCsr = mode === 'csr'
  const tabs = [['card', isCsr ? 'My scorecard' : 'Scorecards'], ['guide', 'Call Flow Guide'], ['howto', 'How to use']]
  return (
    <div className="csr-root" style={{ '--csr-accent': accent }}>
      <style>{CSS}</style>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'guide' ? <CallFlowGuide supabase={supabase} />
      : tab === 'howto' ? <HowToUse audience={mode} />
      : isCsr ? (
        <Scorecard supabase={supabase} csrId={null} isCsr />
      ) : picked ? (
        <Scorecard supabase={supabase} csrId={picked} isCsr={false} onBack={() => setPicked(null)} />
      ) : (
        <Roster supabase={supabase} onPick={setPicked} isStaff={mode === 'staff'} />
      )}
    </div>
  )
}

const CSS = `
.csr-root{--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--card:#fff;--bg:#f8fafc;color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1280px;margin:0 auto;padding:16px}
.csr-root *{box-sizing:border-box}
.csr-root h1{margin:4px 0 2px;font-size:22px}.csr-root h2{font-size:15px;margin:0 0 8px}
.csr-sub{color:var(--mut);font-size:12px}
.csr-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
.csr-hello{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.csr-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.csr-pill{background:color-mix(in srgb,var(--csr-accent) 14%,white);color:var(--csr-accent);font-weight:600;font-size:12px;padding:3px 10px;border-radius:99px}
.csr-grid{display:grid;gap:12px}.csr-g5{grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:12px}
.csr-g2{grid-template-columns:1fr 1fr}@media(max-width:900px){.csr-g2{grid-template-columns:1fr}}
.csr-tile{margin-bottom:0}.csr-lbl{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.csr-val{font-size:26px;font-weight:700;margin:4px 0 2px}
.csr-delta{display:block;font-size:12px;font-weight:600}.csr-delta.up{color:#15803d}.csr-delta.down{color:#b91c1c}.csr-delta.flat{color:var(--mut);font-weight:500}
.csr-focus{border-left:4px solid var(--csr-accent);background:color-mix(in srgb,var(--csr-accent) 6%,white)}
.csr-focus-l{color:var(--csr-accent);font-weight:700;font-size:12px}.csr-focus-t{font-size:18px;font-weight:700;margin:2px 0 6px}
.csr-goal{margin-top:6px}.csr-pre{white-space:pre-wrap}
.csr-stepwrap{border-top:1px solid var(--line)}.csr-stepwrap:first-of-type{border-top:0}.csr-stepwrap.open{background:#f8fafc;border-radius:8px}
.csr-step{width:100%;display:grid;grid-template-columns:22px 1fr 110px 70px;gap:8px;align-items:center;padding:7px 4px;font:inherit;font-size:13px;color:inherit;background:none;border:0;text-align:left}.csr-stepn{color:var(--mut);font-weight:700}.csr-pts{font-size:11px;color:var(--mut)}
.csr-bar{height:8px;background:var(--line);border-radius:99px;overflow:hidden}.csr-bar i{display:block;height:100%;background:var(--csr-accent)}
.csr-bar.mid i{background:#d97706}.csr-bar.low i{background:#dc2626}
.csr-steppct{text-align:right;font-weight:700}.csr-steppct small{display:block;font-weight:400;color:var(--mut);font-size:11px}
.csr-na{grid-column:3/5;text-align:right;color:var(--mut);font-style:italic;font-size:12px}
@media(max-width:520px){.csr-step{grid-template-columns:22px 1fr 60px}.csr-step .csr-bar{display:none}}
.csr-holdpol{margin-top:10px;font-size:13px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px}
.csr-note{border-top:1px solid var(--line);padding:10px 0}.csr-note:first-of-type{border-top:0}.csr-note-t{font-weight:600}
.csr-act{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.csr-act.done{opacity:.6}.csr-ic{width:36px;height:36px;border-radius:8px;display:grid;place-items:center;font-weight:700;color:#fff;flex:none;font-size:12px}
.csr-act-body{flex:1;min-width:0}.csr-act-t{font-weight:600}
.csr-act-actions{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.csr-act-actions a{color:var(--csr-accent);font-weight:600;text-decoration:none;white-space:nowrap}
.csr-link{background:none;border:0;color:var(--csr-accent);font-weight:600;cursor:pointer;padding:0;font:inherit}.csr-link.muted{color:var(--mut);font-weight:500;margin-left:8px}
.csr-btn{background:var(--csr-accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
.csr-btn.ghost{background:#fff;color:var(--csr-accent);border:1px solid var(--csr-accent)}.csr-btn:disabled{opacity:.6;cursor:default}
.csr-edit{margin-top:12px;padding:12px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}
.csr-edit-h{font-size:12px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.03em}
.csr-root input,.csr-root select,.csr-root textarea{border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;font:inherit;background:#fff;flex:1;min-width:0}
.csr-root select{flex:0 1 auto}
.csr-banner{background:#fef3c7;border:1px solid #fcd34d;color:#78350f;border-radius:10px;padding:9px 13px;margin-bottom:12px;font-size:13px}
.csr-banner.info{background:#eff6ff;border-color:#bfdbfe;color:#1e3a8a}
.csr-err{color:#b91c1c;font-size:13px}.csr-lowtxt{color:#b91c1c}
.csr-welcome h2{font-size:20px}
.csr-calls{display:flex;flex-direction:column;gap:6px;max-height:520px;overflow:auto}
.csr-call{border:1px solid var(--line);border-radius:8px}
.csr-call-h{width:100%;display:grid;grid-template-columns:auto 1fr auto 60px;gap:12px;align-items:center;background:none;border:0;padding:8px 10px;text-align:left;cursor:pointer;font:inherit;color:inherit;white-space:nowrap}
.csr-call-h>*{overflow:hidden;text-overflow:ellipsis}.csr-call-h b{text-align:right}
.csr-call-b{padding:0 10px 10px;font-size:13px}.csr-call-b p{margin:4px 0}
.csr-rrow{width:100%;display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center;background:none;border:0;border-top:1px solid var(--line);padding:10px 2px;text-align:left;cursor:pointer;font:inherit;color:inherit}
.csr-rrow:first-of-type{border-top:0}.csr-rname{font-weight:600}.csr-search{max-width:260px}
.csr-start{justify-content:flex-start}
.csr-exlink{margin-left:8px;font-size:11px;color:var(--csr-accent);font-weight:600}
.csr-exgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:4px 6px 12px}@media(max-width:620px){.csr-exgrid{grid-template-columns:1fr}}
.csr-exhead{font-size:12px;font-weight:700;margin:4px 0 6px}.csr-exhead.good{color:#15803d}.csr-exhead.bad{color:#b91c1c}
.csr-ex{background:#fff;border:1px solid var(--line);border-left:3px solid #16a34a;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:12.5px}
.csr-ex.bad{border-left-color:#dc2626}
.csr-ex-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;white-space:nowrap}.csr-ex-h b{margin-left:auto}
.csr-quote{margin-top:4px;font-style:italic;color:#334155}.csr-why{margin-top:4px;color:var(--mut)}
.csr-play{margin-top:6px;background:none;border:1px solid var(--csr-accent);color:var(--csr-accent);border-radius:6px;padding:3px 9px;font-size:12px;font-weight:600;cursor:pointer}
.csr-play:disabled{opacity:.6;cursor:default}
.csr-audio{margin-top:6px;width:100%;height:32px}
.csr-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:14px;overflow-x:auto}
.csr-tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;font:inherit;font-weight:600;color:var(--mut);cursor:pointer;white-space:nowrap;margin-bottom:-1px}
.csr-tab.on{color:var(--csr-accent);border-bottom-color:var(--csr-accent)}
@media(max-width:420px){.csr-tab{padding:8px 7px;font-size:13px}}
.csr-guide-row{display:grid;grid-template-columns:32px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--line)}.csr-guide-row:first-child{border-top:0}
.csr-guide-n{width:28px;height:28px;border-radius:99px;background:color-mix(in srgb,var(--csr-accent) 14%,white);color:var(--csr-accent);font-weight:700;display:grid;place-items:center}
.csr-guide-t{font-weight:700}.csr-guide-say{margin-top:4px;font-style:italic;color:#334155}.csr-guide-say b{font-style:normal}
.csr-howto h3{font-size:14px;margin:14px 0 4px}.csr-howto p{margin:4px 0}.csr-howto ul,.csr-howto ol{margin:4px 0;padding-left:20px}.csr-howto li{margin:3px 0}
.csr-flagbtn{display:block;margin-top:6px;background:none;border:0;padding:0;color:var(--mut);font:inherit;font-size:12px;text-decoration:underline;cursor:pointer}
.csr-flagbtn:hover{color:var(--csr-accent)}
.csr-flagform{margin-top:8px;padding:10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;display:flex;flex-direction:column;gap:8px;font-size:12.5px}
.csr-flagform textarea{width:100%;resize:vertical}
.csr-flagreasons{display:flex;flex-direction:column;gap:4px}.csr-flagreasons label{display:flex;gap:6px;align-items:flex-start;cursor:pointer}
.csr-flagreasons input{flex:none;margin-top:2px}
.csr-flagrow{display:flex;gap:8px;align-items:center}
.csr-flagst{margin-top:6px;font-size:12px;border-radius:6px;padding:5px 8px;background:#eff6ff;color:#1e3a8a;display:inline-block}
.csr-flagst.fixed{background:#f0fdf4;color:#166534}.csr-flagst.kept{background:#f1f5f9;color:#334155}
.csr-flagnote{margin-top:2px;font-style:italic}
.csr-flagdot{color:#d97706}
.csr-flagq{border-left:4px solid #d97706}
.csr-flagitem{border-top:1px solid var(--line);padding:10px 0;font-size:13px}.csr-flagitem:first-of-type{border-top:0}
.csr-flagctx{margin-top:4px}.csr-flagact{margin-top:8px;display:flex;flex-direction:column;gap:6px}
`
