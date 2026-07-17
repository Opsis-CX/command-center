import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// MY CERTIFICATIONS (agent-facing)
// Shows the logged-in person the certifications they've been assigned or
// earned, with status, and a way to jump into the course to complete one.
// Reads the person's own agent_cert_records (RLS: acr_read_own) joined to
// the certification; the course link comes from published courses whose
// certification_id matches. A "needed" record with no attempt shows as
// "Not started", with an attempt as "In progress".
// ============================================================
 
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)

function statusView(r) {
  if (r.status === 'passed') return { label: 'Certified', cls: 'passed' }
  if (r.status === 'failed') return { label: 'Not passed', cls: 'failed' }
  const started = (r.attempts && r.attempts > 0) || r.last_attempt_at
  return started ? { label: 'In progress', cls: 'needed' } : { label: 'Not started', cls: 'needed', muted: true }
}

export default function MyCertifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!user) return
    let cancel = false
    ;(async () => {
      setLoading(true); setErr('')
      const [recRes, coRes] = await Promise.all([
        supabase.from('agent_cert_records')
          .select('id, certification_id, status, best_score_pct, attempts, last_attempt_at, passed_at, expires_at, certifications(name, description)')
          .eq('profile_id', user.id),
        supabase.from('courses').select('id, title, certification_id').eq('status', 'published').order('sort_order'),
      ])
      if (cancel) return
      if (recRes.error) { setErr(recRes.error.message); setLoading(false); return }
      // sort: not-passed first (action needed), then certified; then by name
      const sorted = (recRes.data || []).slice().sort((a, b) => {
        const rank = (s) => (s === 'passed' ? 1 : 0)
        if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status)
        return (a.certifications?.name || '').localeCompare(b.certifications?.name || '')
      })
      setRows(sorted)
      setCourses(coRes.data || [])
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [user])

  const coursesFor = (certId) => courses.filter(c => c.certification_id === certId)

  return (
    <div>
      <h1 className="page-title">My certifications</h1>
      <p className="page-sub">The certifications assigned to you and where you stand on each.</p>

      {loading && <p className="page-sub" style={{ marginTop: 16 }}>Loading…</p>}
      {err && (
        <div className="card" style={{ borderColor: 'var(--failed)', marginTop: 16 }}>
          <b style={{ color: 'var(--failed)' }}>Couldn’t load your certifications.</b>
          <p className="page-sub" style={{ marginTop: 6 }}>{err}</p>
        </div>
      )}

      {!loading && !err && rows.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="page-sub" style={{ textAlign: 'center', padding: 22 }}>
            You don’t have any certifications assigned yet. When one is assigned to you, it’ll show up here.
          </div>
        </div>
      )}

      <div className="cards" style={{ marginTop: 18 }}>
        {rows.map(r => {
          const s = statusView(r)
          const cert = r.certifications || {}
          const linked = coursesFor(r.certification_id)
          const passed = r.status === 'passed'
          const attempted = (r.attempts && r.attempts > 0) || r.last_attempt_at
          return (
            <div className="card" key={r.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{cert.name || 'Certification'}</h3>
                <span className={'badge ' + s.cls} style={s.muted ? { background: 'var(--line-soft)', color: 'var(--ink-soft)' } : undefined}>{s.label}</span>
              </div>
              {cert.description && <p className="page-sub" style={{ marginTop: 6 }}>{cert.description}</p>}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                {passed && r.passed_at && <span>Earned {fmtDate(r.passed_at)}</span>}
                {passed && r.expires_at && <span>Expires {fmtDate(r.expires_at)}</span>}
                {r.best_score_pct != null && <span>Best score {r.best_score_pct}%</span>}
                {attempted && r.attempts != null && <span>{r.attempts} attempt{r.attempts === 1 ? '' : 's'}</span>}
              </div>

              {!passed && (
                <div style={{ marginTop: 14 }}>
                  <button className="btn btn-primary"
                    onClick={() => navigate('/my-courses')}
                    style={{ fontSize: 13.5 }}>
                    {attempted ? 'Continue in My courses →' : 'Start the course →'}
                  </button>
                  {linked.length > 0 && (
                    <div className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>
                      Course{linked.length > 1 ? 's' : ''}: {linked.map(c => c.title).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
