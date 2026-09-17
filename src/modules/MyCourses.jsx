import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { LessonView, useScrolledToBottom } from './CourseBuilder'

export default function MyCourses() {
  const [courses, setCourses] = useState([])
  const [status, setStatus] = useState({})   // course_id -> attempt status
  const [progress, setProgress] = useState({}) // course_id -> { last_lesson_idx, completed_lessons }
  const [openCourse, setOpenCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [coRes, stRes, prRes] = await Promise.all([
        supabase.from('courses').select('*').eq('status', 'published').order('sort_order').order('title'),
        supabase.from('quiz_attempt_status').select('*').eq('profile_id', user.id),
        supabase.from('course_progress').select('*').eq('profile_id', user.id),
      ])
      if (coRes.error) throw coRes.error
      setCourses(coRes.data || [])
      const byCourse = {}
      for (const r of (stRes.data || [])) byCourse[r.course_id] = r
      setStatus(byCourse)
      const prByCourse = {}
      for (const r of (prRes.data || [])) prByCourse[r.course_id] = r
      setProgress(prByCourse)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  // No row in the view = never attempted.
  const statusFor = (id) => status[id] || { attempts_used: 0, attempts_left: 2, has_passed: false }
  const progressFor = (id) => progress[id] || { last_lesson_idx: 0, completed_lessons: false }

  // Prerequisites are scoped WITHIN a certification: a course opens only once
  // every earlier course in the SAME certification has been passed. Courses in
  // other certifications never gate each other, and a standalone course (no
  // certification_id) has no prerequisites and gates nothing. Returns the
  // course blocking this one, or null if it's open.
  function blockedBy(course, index) {
    if (!course.certification_id) return null
    for (let i = 0; i < index; i++) {
      const prev = courses[i]
      if (prev.certification_id !== course.certification_id) continue
      if (!statusFor(prev.id).has_passed) return prev
    }
    return null
  }

  if (openCourse) {
    return <CourseRunner course={openCourse}
      status={statusFor(openCourse.id)}
      progress={progressFor(openCourse.id)}
      onExit={() => { setOpenCourse(null); load() }} />
  }

  return (
    <div>
      <h1 className="page-title">My courses</h1>
      <p className="page-sub">Work through the lessons, then take the quiz.</p>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', margin: '16px 0' }}>
        <b style={{ color: 'var(--failed)' }}>Error.</b>
        <p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      {loading ? <p className="page-sub" style={{ marginTop: 20 }}>Loading…</p> : (
        <div className="cards" style={{ marginTop: 22 }}>
          {courses.length === 0 && <div className="card">
            <div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>
              No courses assigned to you yet.
            </div></div>}

          {courses.map((c, ci) => {
            const s = statusFor(c.id)
            const pr = progressFor(c.id)
            const started = pr.last_lesson_idx > 0 || pr.completed_lessons
            const outOfAttempts = !s.has_passed && s.attempts_left === 0
            const prereq = s.has_passed ? null : blockedBy(c, ci)
            const locked = outOfAttempts || !!prereq
            // New course types. Both still gate on a quiz_attempts row, so the
            // status view / attempt cap / cert grant work exactly as for a quiz.
            const isTyping = c.course_type === 'typing_test'
            const isTimed = c.course_type === 'timed_quiz'
            return (
              <div className="card" key={c.id} style={{ display: 'flex', flexDirection: 'column', opacity: prereq ? .72 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                    <span className="page-sub" style={{ fontWeight: 600 }}>{ci + 1}. </span>{c.title}
                  </h3>
                  {s.has_passed && <span className="badge passed">Passed</span>}
                  {prereq && <span className="badge" style={{ background: 'var(--line-soft)', color: 'var(--ink-soft)' }}>🔒 Locked</span>}
                  {outOfAttempts && !prereq && <span className="badge failed">Locked</span>}
                </div>

                {(isTyping || isTimed) && (
                  <div style={{ marginTop: 6 }}>
                    <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                      {isTyping ? '⌨ Typing test' : '⏱ Timed test'}
                    </span>
                  </div>
                )}

                {c.description && <p className="page-sub" style={{ marginTop: 5 }}>{c.description}</p>}

                <p className="page-sub" style={{ marginTop: 10, fontSize: 12.5 }}>
                  {s.has_passed
                    ? (isTyping ? `Passed — ${s.best_score_pct ?? ''}% accuracy`
                        : c.quiz_required ? `Certified — scored ${s.best_score_pct ?? ''}%`
                        : 'Completed ✓')
                    : prereq
                      ? <>Finish <b>{prereq.title}</b> first.</>
                      : outOfAttempts
                        ? `You have used both attempts. Ask an admin to reset your ${isTyping ? 'typing test' : 'quiz'}.`
                        : isTyping
                          ? `Type at ${c.typing_min_wpm ?? 35} WPM with ${c.typing_min_accuracy ?? 95}% accuracy in ${c.typing_duration_seconds ?? 60}s. ${s.attempts_used === 0 ? 'You get 2 attempts.' : `${s.attempts_left} attempt${s.attempts_left === 1 ? '' : 's'} remaining.`}`
                          : !c.quiz_required
                            ? 'Informational — finish the lessons to complete. No quiz.'
                            : s.attempts_used === 0
                              ? `Pass mark ${c.pass_threshold}%.${isTimed && c.time_limit_seconds ? ` ${Math.round(c.time_limit_seconds / 60)}-minute timer.` : ''} You get 2 attempts.`
                              : `${s.attempts_left} attempt${s.attempts_left === 1 ? '' : 's'} remaining.`}
                </p>

                {!s.has_passed && started && !locked && !isTyping && (
                  <p className="page-sub" style={{ marginTop: 6, fontSize: 12, color: 'var(--accent)' }}>
                    {pr.completed_lessons ? (c.quiz_required ? 'Lessons finished — quiz is next.' : 'Lessons finished — ready to complete.') : `Resume at lesson ${pr.last_lesson_idx + 1}.`}
                  </p>
                )}
                <div style={{ marginTop: 'auto', paddingTop: 14 }}>
                  <button className="btn btn-primary" disabled={locked}
                    title={prereq ? `Finish ${prereq.title} first` : undefined}
                    style={locked ? { opacity: .45, cursor: 'not-allowed' } : undefined}
                    onClick={() => { if (!locked) setOpenCourse(c) }}>
                    {prereq ? '🔒 Locked'
                      : s.has_passed ? (isTyping ? 'Review' : 'Review lessons')
                      : (started || s.attempts_used > 0) ? 'Continue'
                      : isTyping ? 'Start typing test'
                      : 'Start course'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Lessons, then quiz/typing test, then results.
function CourseRunner({ course, status, progress, onExit }) {
  const isTyping = course.course_type === 'typing_test'
  const [lessons, setLessons] = useState([])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState('lessons')   // lessons | quiz | typing | done
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [err, setErr] = useState('')
  const furthestRef = useRef(progress?.last_lesson_idx || 0)

  const scrollRef = useRef(null)
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [idx])
  const readToEnd = useScrolledToBottom(scrollRef, idx)

  useEffect(() => {
    supabase.from('lessons').select('*').eq('course_id', course.id).order('sort_order')
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        const list = data || []
        setLessons(list)
        // resume at the saved lesson, clamped to the available range
        if (!status?.has_passed && list.length) {
          const start = Math.min(Math.max(progress?.last_lesson_idx || 0, 0), list.length - 1)
          setIdx(start)
        }
        setLoading(false)
      })
  }, [course.id])

  // A typing test with no instructional lessons goes straight to the test.
  useEffect(() => {
    if (!loading && isTyping && lessons.length === 0 && phase === 'lessons') setPhase('typing')
  }, [loading, isTyping, lessons.length, phase])

  // Persist the furthest lesson reached (never moves backward).
  async function saveProgress(newIdx, finishedLessons) {
    const furthest = Math.max(furthestRef.current, newIdx)
    furthestRef.current = furthest
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('course_progress').upsert({
        profile_id: user.id, course_id: course.id,
        last_lesson_idx: furthest,
        completed_lessons: !!finishedLessons || furthest >= (lessons.length - 1),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,course_id' })
    } catch { /* progress is best-effort; never block the learner */ }
  }
  function goNext() {
    const next = idx + 1
    setIdx(next)
    saveProgress(next, false)
  }

  // Informational course (no quiz): finishing the lessons completes it and
  // records the certification via the same server-side pass path.
  async function completeInformational() {
    setCompleting(true); setErr('')
    try {
      await saveProgress(total - 1, true)
      const { data, error } = await supabase.rpc('complete_informational_course', { p_course_id: course.id })
      if (error) throw error
      setResult(data); setPhase('done')
    } catch (e) { setErr(e.message); setCompleting(false) }
  }

  if (loading) return <p className="page-sub">Loading course…</p>

  const total = lessons.length
  const lesson = lessons[idx]
  const pct = total ? Math.round(((idx + 1) / total) * 100) : 0

  if (phase === 'done') {
    return <Results course={course} result={result} onExit={onExit} />
  }

  if (phase === 'typing') {
    return <TypingRunner course={course}
      onDone={(r) => { setResult(r); setPhase('done') }}
      onBack={() => (total ? setPhase('lessons') : onExit())} />
  }

  if (phase === 'quiz') {
    return <QuizRunner course={course} onDone={(r) => { setResult(r); setPhase('done') }}
      onBack={() => setPhase('lessons')} />
  }

  return (
    <div>
      <button className="btn btn-ghost" onClick={onExit} style={{ marginBottom: 12 }}>← My courses</button>
      <h1 className="page-title" style={{ fontSize: 20 }}>{course.title}</h1>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', margin: '12px 0' }}>
        <p className="page-sub">{err}</p></div>}

      <div style={{ height: 5, background: 'var(--line-soft)', borderRadius: 3, margin: '14px 0' }}>
        <div style={{ height: '100%', width: pct + '%', background: 'var(--cta)', borderRadius: 3, transition: 'width .2s' }} />
      </div>

      {total === 0 ? <div className="card"><p className="page-sub">This course has no lessons yet.</p></div> : (
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
          <div ref={scrollRef} style={{ padding: '22px 26px', overflow: 'auto', flex: 1 }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 4 }}>Lesson {idx + 1} of {total}</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>{lesson?.title}</h2>
            <LessonView blocks={lesson?.content_blocks} />
          </div>

          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-ghost" disabled={idx === 0}
              onClick={() => setIdx(i => Math.max(0, i - 1))}>← Back</button>

            {!readToEnd && <span className="page-sub" style={{ fontSize: 12.5 }}>Read to the bottom before continuing</span>}

            {idx < total - 1
              ? <button className="btn btn-primary" onClick={goNext}>Next →</button>
              : status.has_passed
                ? <span className="page-sub">You've already {course.quiz_required ? 'passed' : 'completed'} this course.</span>
                : isTyping
                  ? <button className="btn btn-cta"
                      onClick={() => { saveProgress(total - 1, true); setPhase('typing') }}>Start typing test →</button>
                  : course.quiz_required
                    ? <button className="btn btn-cta"
                        onClick={() => { saveProgress(total - 1, true); setPhase('quiz') }}>Start quiz →</button>
                    : <button className="btn btn-cta" disabled={completing}
                        style={completing ? { opacity: .6, cursor: 'not-allowed' } : undefined}
                        onClick={completeInformational}>{completing ? 'Completing…' : 'Complete course →'}</button>}
          </div>
        </div>
      )}
    </div>
  )
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`

function QuizRunner({ course, onDone, onBack }) {
  const timeLimit = course.time_limit_seconds || null   // seconds; null = untimed
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})   // question_id -> option_id
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [remaining, setRemaining] = useState(timeLimit)
  const [err, setErr] = useState('')
  const submittedRef = useRef(false)

  useEffect(() => { load() }, [course.id])

  async function load() {
    try {
      // The server picks this attempt's questions (random subset, random order)
      // and remembers them — grading only counts the served set, so the client
      // can't influence which questions appear. Refreshing returns the SAME set.
      const { data: served, error: startErr } = await supabase.rpc('start_quiz', { p_course_id: course.id })
      if (startErr) throw startErr
      const servedIds = (served?.question_ids || []).map(String)

      const { data: qs, error } = await supabase.from('quiz_questions')
        .select('id, prompt, points, sort_order').eq('course_id', course.id).in('id', servedIds)
      if (error) throw error
      // Deliberately does not select is_correct — the answer key stays server-side.
      const byId = Object.fromEntries((qs || []).map(q => [q.id, q]))
      const ordered = servedIds.map(id => byId[id]).filter(Boolean)
      const withOpts = await Promise.all(ordered.map(async q => {
        const { data: opts } = await supabase.from('quiz_options_public')
          .select('id, label, sort_order').eq('question_id', q.id).order('sort_order')
        // Shuffle answer options too, so "the answer is always B" can't circulate.
        const shuffled = (opts || []).map(o => ({ o, r: Math.random() }))
          .sort((a, b) => a.r - b.r).map(x => x.o)
        return { ...q, options: shuffled }
      }))
      setQuestions(withOpts)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  // Countdown for a timed quiz. Ticks once questions are on screen; when it
  // reaches zero the attempt auto-submits with whatever is answered so far.
  useEffect(() => {
    if (!timeLimit || loading || questions.length === 0 || remaining == null) return
    if (remaining <= 0) { doSubmit(true); return }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [timeLimit, loading, questions.length, remaining])

  async function doSubmit(auto) {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('submit_quiz', {
        p_course_id: course.id,
        p_answers: answers,
      })
      if (error) throw error
      onDone({ ...data, timed_out: !!auto })
    } catch (e) {
      submittedRef.current = false
      setErr(e.message.includes('Attempt limit')
        ? 'You have used both attempts on this quiz. Ask an admin to reset it for you.'
        : e.message.includes('already passed')
          ? 'You have already passed this course.'
          : e.message)
      setSubmitting(false)
    }
  }

  if (loading) return <p className="page-sub">Loading quiz…</p>

  const answered = Object.keys(answers).length
  const complete = answered === questions.length && questions.length > 0
  const low = timeLimit && remaining != null && remaining <= 30

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }} disabled={!!timeLimit}>← Lessons</button>
      <h1 className="page-title" style={{ fontSize: 20 }}>{course.title} — {timeLimit ? 'timed test' : 'quiz'}</h1>
      <p className="page-sub">Pass mark {course.pass_threshold}%. Answer every question, then submit.</p>

      {timeLimit && (
        <div className="card" style={{ margin: '12px 0', borderColor: low ? 'var(--failed)' : 'var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <b style={{ color: low ? 'var(--failed)' : 'var(--accent)', fontSize: 15 }}>⏱ Time remaining: {mmss(Math.max(0, remaining || 0))}</b>
          <span className="page-sub" style={{ fontSize: 12.5 }}>The test submits automatically when the timer reaches zero.</span>
        </div>
      )}

      {err && <div className="card" style={{ borderColor: 'var(--failed)', margin: '14px 0' }}>
        <b style={{ color: 'var(--failed)' }}>Could not submit.</b>
        <p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      <div style={{ marginTop: 18 }}>
        {questions.map((q, qi) => (
          <div className="card" key={q.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{qi + 1}</span>
              <div style={{ fontSize: 15, fontWeight: 500, paddingTop: 2 }}>{q.prompt}</div>
            </div>
            {q.options.map(o => {
              const picked = answers[q.id] === o.id
              return (
                <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: picked ? 'var(--accent-bg)' : 'transparent', marginBottom: 2 }}>
                  <input type="radio" name={q.id} checked={picked}
                    onChange={() => setAnswers(a => ({ ...a, [q.id]: o.id }))} />
                  <span style={{ fontSize: 14 }}>{o.label}</span>
                </label>
              )
            })}
          </div>
        ))}
      </div>

      {questions.length === 0
        ? <div className="card"><p className="page-sub">This course has no quiz questions yet.</p></div>
        : <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
            <button className="btn btn-cta" disabled={!complete || submitting}
              style={!complete || submitting ? { opacity: .45, cursor: 'not-allowed' } : undefined}
              onClick={() => doSubmit(false)}>{submitting ? 'Submitting…' : timeLimit ? 'Submit test' : 'Submit quiz'}</button>
            <span className="page-sub" style={{ fontSize: 12.5 }}>
              {answered} of {questions.length} answered
            </span>
          </div>}
    </div>
  )
}

// Count characters typed that match the passage at the same position. Anything
// typed past the end of the passage counts as an error. Mirrors the server so
// the live accuracy the agent sees matches their graded score.
function countMatches(typed, passage) {
  const p = passage || ''
  let m = 0
  for (let i = 0; i < typed.length; i++) if (typed[i] === p[i]) m++
  return m
}

// ============ TYPING SPEED TEST ============
// A fixed-duration test: the agent types the passage; when the timer runs out
// (or they submit) the server grades WPM + accuracy and records a quiz_attempts
// row, so the attempt cap and certification grant behave exactly like a quiz.
function TypingRunner({ course, onDone, onBack }) {
  const durationSec = course.typing_duration_seconds || 60
  const passage = course.typing_passage || ''
  const minWpm = course.typing_min_wpm ?? 35
  const minAcc = course.typing_min_accuracy ?? 95

  const [typed, setTyped] = useState('')
  const [started, setStarted] = useState(false)
  const [remaining, setRemaining] = useState(durationSec)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const startAtRef = useRef(null)
  const taRef = useRef(null)
  const submittedRef = useRef(false)

  const elapsed = started ? Math.min(durationSec, durationSec - remaining) : 0
  const chars = typed.length
  const liveWpm = elapsed > 0 ? Math.round((chars / 5) / (elapsed / 60)) : 0
  const liveAcc = chars > 0 ? Math.round(countMatches(typed, passage) * 100 / chars) : 100

  useEffect(() => {
    if (!started) return
    if (remaining <= 0) { finish(); return }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [started, remaining])

  function begin() {
    setStarted(true)
    startAtRef.current = Date.now()
    setTimeout(() => taRef.current?.focus(), 30)
  }

  async function finish() {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true); setErr('')
    const elapsedSec = startAtRef.current
      ? Math.min(durationSec, (Date.now() - startAtRef.current) / 1000)
      : durationSec
    try {
      const { data, error } = await supabase.rpc('submit_typing_test', {
        p_course_id: course.id,
        p_typed: typed,
        p_elapsed_seconds: elapsedSec,
      })
      if (error) throw error
      onDone(data)
    } catch (e) {
      submittedRef.current = false
      setErr(e.message.includes('Attempt limit')
        ? 'You have used both attempts on this test. Ask an admin to reset it for you.'
        : e.message.includes('already passed')
          ? 'You have already passed this test.'
          : e.message)
      setSubmitting(false)
    }
  }

  const low = started && remaining <= 10

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }} disabled={started}>← Back</button>
      <h1 className="page-title" style={{ fontSize: 20 }}>{course.title} — typing test</h1>
      <p className="page-sub">
        Type the passage exactly. You need <b>{minWpm} WPM</b> and <b>{minAcc}% accuracy</b> to pass. You have {durationSec} seconds.
      </p>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', margin: '14px 0' }}>
        <b style={{ color: 'var(--failed)' }}>Could not submit.</b>
        <p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      {/* Live stat bar */}
      <div className="card" style={{ margin: '14px 0', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', borderColor: low ? 'var(--failed)' : undefined }}>
        <div>
          <div className="page-sub" style={{ fontSize: 11.5 }}>Time left</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: low ? 'var(--failed)' : 'var(--accent)' }}>{mmss(Math.max(0, remaining))}</div>
        </div>
        <div>
          <div className="page-sub" style={{ fontSize: 11.5 }}>WPM</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: liveWpm >= minWpm ? 'var(--passed)' : 'var(--ink)' }}>{liveWpm}</div>
        </div>
        <div>
          <div className="page-sub" style={{ fontSize: 11.5 }}>Accuracy</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: liveAcc >= minAcc ? 'var(--passed)' : 'var(--ink)' }}>{liveAcc}%</div>
        </div>
      </div>

      {/* Passage to copy */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="page-sub" style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Passage</div>
        <PassageDisplay passage={passage} typed={typed} />
      </div>

      <textarea
        ref={taRef}
        value={typed}
        disabled={!started || submitting}
        onChange={e => setTyped(e.target.value)}
        onPaste={e => e.preventDefault()}
        onCopy={e => e.preventDefault()}
        placeholder={started ? 'Start typing…' : 'Press Start to begin.'}
        rows={5}
        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 15, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical', background: started ? 'var(--surface)' : 'var(--canvas)' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        {!started
          ? <button className="btn btn-cta" onClick={begin}>Start typing test →</button>
          : <button className="btn btn-cta" disabled={submitting} onClick={finish}
              style={submitting ? { opacity: .5, cursor: 'not-allowed' } : undefined}>
              {submitting ? 'Submitting…' : 'Submit now'}
            </button>}
        {started && <span className="page-sub" style={{ fontSize: 12.5 }}>Pasting is disabled — the test submits automatically at 0:00.</span>}
      </div>
    </div>
  )
}

// Renders the passage with each character tinted green/red as the agent types,
// so they can see where they've drifted from the text.
function PassageDisplay({ passage, typed }) {
  const p = passage || ''
  return (
    <div style={{ fontSize: 15.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {p.split('').map((ch, i) => {
        let color = 'var(--ink-soft)'
        let bg = 'transparent'
        if (i < typed.length) {
          const ok = typed[i] === ch
          color = ok ? 'var(--passed)' : '#fff'
          bg = ok ? 'transparent' : 'var(--failed)'
        }
        const cur = i === typed.length
        return (
          <span key={i} style={{ color, background: bg, borderLeft: cur ? '2px solid var(--accent)' : 'none' }}>{ch}</span>
        )
      })}
    </div>
  )
}

function Results({ course, result, onExit }) {
  const passed = result?.passed
  const isTyping = result?.wpm != null || course.course_type === 'typing_test'
  // Informational courses have no score/pass-mark to report.
  const informational = result?.informational || (course.quiz_required === false && !isTyping)
  return (
    <div>
      <div className="card" style={{ textAlign: 'center', padding: '40px 30px', maxWidth: 480, margin: '30px auto' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>{passed ? '✓' : '✕'}</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600, color: passed ? 'var(--passed)' : 'var(--failed)' }}>
          {informational ? 'Course complete' : passed ? 'Passed' : 'Not passed'}
        </h2>

        {isTyping
          ? <p className="page-sub">
              You typed <b>{result?.wpm} WPM</b> at <b>{result?.accuracy_pct}% accuracy</b>.
              {result?.min_wpm != null && <> Pass mark is {result.min_wpm} WPM and {result.min_accuracy}% accuracy.</>}
            </p>
          : informational
            ? <p className="page-sub">You've finished this course.</p>
            : <p className="page-sub">You scored {result?.score_pct}%. Pass mark is {course.pass_threshold}%.{result?.timed_out ? ' (Time ran out.)' : ''}</p>}

        <p className="page-sub" style={{ marginTop: 14 }}>
          {passed
            ? 'Your certification has been recorded.'
            : result?.attempts_left > 0
              ? `You have ${result.attempts_left} attempt remaining.`
              : `You have used both attempts. Ask an admin to reset your ${isTyping ? 'typing test' : 'quiz'}.`}
        </p>

        <button className="btn btn-primary" style={{ marginTop: 22 }} onClick={onExit}>Back to my courses</button>
      </div>
    </div>
  )
}
