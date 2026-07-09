import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { LessonView, useScrolledToBottom } from './CourseBuilder'

export default function MyCourses() {
  const [courses, setCourses] = useState([])
  const [status, setStatus] = useState({})   // course_id -> attempt status
  const [openCourse, setOpenCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [coRes, stRes] = await Promise.all([
        supabase.from('courses').select('*').eq('status', 'published').order('title'),
        supabase.from('quiz_attempt_status').select('*').eq('profile_id', user.id),
      ])
      if (coRes.error) throw coRes.error
      setCourses(coRes.data || [])
      const byCourse = {}
      for (const r of (stRes.data || [])) byCourse[r.course_id] = r
      setStatus(byCourse)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  // No row in the view = never attempted.
  const statusFor = (id) => status[id] || { attempts_used: 0, attempts_left: 2, has_passed: false }

  if (openCourse) {
    return <CourseRunner course={openCourse}
      status={statusFor(openCourse.id)}
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

          {courses.map(c => {
            const s = statusFor(c.id)
            const locked = !s.has_passed && s.attempts_left === 0
            return (
              <div className="card" key={c.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{c.title}</h3>
                  {s.has_passed && <span className="badge passed">Passed</span>}
                  {locked && <span className="badge failed">Locked</span>}
                </div>

                {c.description && <p className="page-sub" style={{ marginTop: 5 }}>{c.description}</p>}

                <p className="page-sub" style={{ marginTop: 10, fontSize: 12.5 }}>
                  {s.has_passed
                    ? `Certified — scored ${s.best_score_pct ?? ''}%`
                    : locked
                      ? 'You have used both attempts. Ask an admin to reset your quiz.'
                      : s.attempts_used === 0
                        ? 'Pass mark ' + c.pass_threshold + '%. You get 2 attempts.'
                        : `${s.attempts_left} attempt${s.attempts_left === 1 ? '' : 's'} remaining.`}
                </p>

                <div style={{ marginTop: 14 }}>
                  <button className="btn btn-primary" disabled={locked}
                    style={locked ? { opacity: .45, cursor: 'not-allowed' } : undefined}
                    onClick={() => setOpenCourse(c)}>
                    {s.has_passed ? 'Review lessons' : s.attempts_used > 0 ? 'Continue' : 'Start course'}
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

// Lessons, then quiz, then results.
function CourseRunner({ course, status, onExit }) {
  const [lessons, setLessons] = useState([])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState('lessons')   // lessons | quiz | done
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const scrollRef = useRef(null)
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [idx])
  const readToEnd = useScrolledToBottom(scrollRef, idx)

  useEffect(() => {
    supabase.from('lessons').select('*').eq('course_id', course.id).order('sort_order')
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        setLessons(data || []); setLoading(false)
      })
  }, [course.id])

  if (loading) return <p className="page-sub">Loading course…</p>

  const total = lessons.length
  const lesson = lessons[idx]
  const pct = total ? Math.round(((idx + 1) / total) * 100) : 0

  if (phase === 'done') {
    return <Results course={course} result={result} onExit={onExit} />
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

            {!readToEnd && <span className="page-sub" style={{ fontSize: 12.5 }}>Scroll to the bottom to continue</span>}

            {idx < total - 1
              ? <button className="btn btn-primary" disabled={!readToEnd}
                  style={!readToEnd ? { opacity: .45, cursor: 'not-allowed' } : undefined}
                  onClick={() => setIdx(i => i + 1)}>Next →</button>
              : status.has_passed
                ? <span className="page-sub">You've already passed this course.</span>
                : <button className="btn btn-cta" disabled={!readToEnd}
                    style={!readToEnd ? { opacity: .45, cursor: 'not-allowed' } : undefined}
                    onClick={() => setPhase('quiz')}>Start quiz →</button>}
          </div>
        </div>
      )}
    </div>
  )
}

function QuizRunner({ course, onDone, onBack }) {
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})   // question_id -> option_id
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [course.id])

  async function load() {
    try {
      const { data: qs, error } = await supabase.from('quiz_questions')
        .select('id, prompt, points, sort_order').eq('course_id', course.id).order('sort_order')
      if (error) throw error
      // Deliberately does not select is_correct — the answer key stays server-side.
      const withOpts = await Promise.all((qs || []).map(async q => {
        const { data: opts } = await supabase.from('quiz_options')
          .select('id, label, sort_order').eq('question_id', q.id).order('sort_order')
        return { ...q, options: opts || [] }
      }))
      setQuestions(withOpts)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  async function submit() {
    setSubmitting(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('submit_quiz', {
        p_course_id: course.id,
        p_answers: answers,
      })
      if (error) throw error
      onDone(data)
    } catch (e) {
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

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }}>← Lessons</button>
      <h1 className="page-title" style={{ fontSize: 20 }}>{course.title} — quiz</h1>
      <p className="page-sub">Pass mark {course.pass_threshold}%. Answer every question, then submit.</p>

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
              onClick={submit}>{submitting ? 'Submitting…' : 'Submit quiz'}</button>
            <span className="page-sub" style={{ fontSize: 12.5 }}>
              {answered} of {questions.length} answered
            </span>
          </div>}
    </div>
  )
}

function Results({ course, result, onExit }) {
  const passed = result?.passed
  return (
    <div>
      <div className="card" style={{ textAlign: 'center', padding: '40px 30px', maxWidth: 480, margin: '30px auto' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>{passed ? '✓' : '✕'}</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600, color: passed ? 'var(--passed)' : 'var(--failed)' }}>
          {passed ? 'Passed' : 'Not passed'}
        </h2>
        <p className="page-sub">You scored {result?.score_pct}%. Pass mark is {course.pass_threshold}%.</p>

        <p className="page-sub" style={{ marginTop: 14 }}>
          {passed
            ? 'Your certification has been recorded.'
            : result?.attempts_left > 0
              ? `You have ${result.attempts_left} attempt remaining.`
              : 'You have used both attempts. Ask an admin to reset your quiz.'}
        </p>

        <button className="btn btn-primary" style={{ marginTop: 22 }} onClick={onExit}>Back to my courses</button>
      </div>
    </div>
  )
}
