import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
// ============================================================
//  ADMIN HIRING DASHBOARD  (Stage 3)
//  Kanban pipeline board. Screened-out applicants (out_of_area,
//  auto_denied, denied, assessment_denied, mock_failed, withdrawn)
//  are hidden behind a toggle. First review = approve / deny.
//  Emails on each transition are STUBBED (see sendHiringEmail).
// ============================================================

async function sendHiringEmail(kind, to, data) {
  try {
    const { error } = await supabase.functions.invoke('send-hiring-email', { body: { kind, to, data } })
    if (error) console.error('email send failed:', error)
  } catch (e) { console.error('email send failed:', e) }
}

// The board columns, in pipeline order. Each maps to one status.
const COLUMNS = [
  { key: 'pending_review', title: 'Pending review', hint: 'New applicants to approve or deny' },
  { key: 'approved', title: 'Approved', hint: 'Assessment goes out' },
  { key: 'assessment_review', title: 'Assessment', hint: 'Submitted, needs review' },
  { key: 'assessment_passed', title: 'Onboarding', hint: 'Rippling invite' },
  { key: 'certifying', title: 'Certifying', hint: 'Doing certification' },
  { key: 'cert_complete', title: 'Five9 setup', hint: 'Create Five9 account' },
  { key: 'mock_requested', title: 'Mock call', hint: 'Scheduling / grading' },
  { key: 'hired', title: 'Hired', hint: 'Active' },
]
// Statuses considered "screened out" — hidden unless the toggle is on.
const SCREENED_OUT = ['out_of_area', 'auto_denied', 'denied', 'assessment_denied', 'mock_failed', 'withdrawn']

// Some statuses live under a column even though the column key differs
// (e.g. assessment_sent belongs under "Approved" until it comes back).
const STATUS_TO_COLUMN = {
  pending_review: 'pending_review',
  approved: 'approved',
  assessment_sent: 'approved',
  assessment_review: 'assessment_review',
  assessment_passed: 'assessment_passed',
  rippling_invited: 'assessment_passed',
  onboarding: 'assessment_passed',
  certifying: 'certifying',
  cert_complete: 'cert_complete',
  five9_pending: 'cert_complete',
  mock_requested: 'mock_requested',
  mock_scheduled: 'mock_requested',
  mock_passed: 'hired',
  hired: 'hired',
}

const STATUS_LABEL = {
  applied: 'Applied', out_of_area: 'Out of area', auto_denied: 'Auto-denied',
  pending_review: 'Pending review', denied: 'Denied', approved: 'Approved',
  assessment_sent: 'Assessment sent', assessment_review: 'Assessment in review',
  assessment_denied: 'Assessment denied', assessment_passed: 'Assessment passed',
  rippling_invited: 'Rippling invited', onboarding: 'Onboarding', certifying: 'Certifying',
  cert_complete: 'Certification complete', five9_pending: 'Five9 pending',
  mock_requested: 'Mock requested', mock_scheduled: 'Mock scheduled',
  mock_passed: 'Mock passed', mock_failed: 'Mock failed', hired: 'Hired', withdrawn: 'Withdrawn',
}

function timeAgo(iso) {
  const d = new Date(iso), now = new Date(), s = Math.floor((now - d) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  if (s < 604800) return Math.floor(s / 86400) + 'd ago'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function initials(name) {
  const p = (name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
function avatarColor(name) {
  const colors = ['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']
  let h = 0; for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}

export default function HiringDashboard() {
  const { user } = useAuth()
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showScreened, setShowScreened] = useState(false)
  const [selected, setSelected] = useState(null)  // application being viewed
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.from('hiring_applications')
      .select('*').order('created_at', { ascending: false })
    if (error) setErr(error.message)
    else setApps(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // realtime: refresh when applications change
  useEffect(() => {
    const ch = supabase.channel('hiring-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hiring_applications' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // move an application to a new status, log the event, fire the stubbed email
  async function transition(app, toStatus, { email, note } = {}) {
    setBusy(true)
    const from = app.status
    const patch = { status: toStatus, reviewer_id: user?.id, reviewed_at: new Date().toISOString() }
    const { error } = await supabase.from('hiring_applications').update(patch).eq('id', app.id)
    if (error) { setErr(error.message); setBusy(false); return }
    await supabase.from('hiring_stage_events').insert({
      application_id: app.id, from_status: from, to_status: toStatus, actor_id: user?.id, note: note || null,
    })
    if (email) await sendHiringEmail(email, app.email, { name: app.full_name, appId: app.id, state: app.state })
    setApps(prev => prev.map(a => a.id === app.id ? { ...a, ...patch } : a))
    setSelected(prev => prev && prev.id === app.id ? { ...prev, ...patch } : prev)
    setBusy(false)
  }

  const approve = (app) => transition(app, 'approved', { email: 'approved', note: 'approved at first review' })
  const deny = (app) => {
    if (!window.confirm(`Deny ${app.full_name}'s application? They'll get a decline email.`)) return
    transition(app, 'denied', { email: 'denied', note: 'denied at first review' })
  }

  // group visible apps by column
  const visible = apps.filter(a => showScreened ? true : !SCREENED_OUT.includes(a.status))
  const byColumn = {}
  COLUMNS.forEach(c => { byColumn[c.key] = [] })
  const screenedOut = []
  visible.forEach(a => {
    if (SCREENED_OUT.includes(a.status)) { screenedOut.push(a); return }
    const col = STATUS_TO_COLUMN[a.status]
    if (col && byColumn[col]) byColumn[col].push(a)
  })

  const activeCount = apps.filter(a => !SCREENED_OUT.includes(a.status)).length
  const screenedCount = apps.filter(a => SCREENED_OUT.includes(a.status)).length

  if (loading) return <p className="page-sub" style={{ padding: 20 }}>Loading applicants…</p>

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Hiring pipeline</h1>
          <p className="page-sub" style={{ margin: '4px 0 0', fontSize: 13.5 }}>{activeCount} active · {screenedCount} screened out</p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', color: 'var(--ink-soft)' }}>
          <input type="checkbox" checked={showScreened} onChange={e => setShowScreened(e.target.checked)} />
          Show screened-out ({screenedCount})
        </label>
      </div>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{err}</div>}

      {/* Kanban board */}
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
        {COLUMNS.map(col => (
          <div key={col.key} style={{ flex: 'none', width: 260, background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 12, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100dvh - 220px)' }}>
            <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <b style={{ fontSize: 13.5 }}>{col.title}</b>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--surface)', borderRadius: 10, padding: '1px 8px', border: '1px solid var(--line)' }}>{byColumn[col.key].length}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{col.hint}</div>
            </div>
            <div style={{ padding: 10, overflowY: 'auto', display: 'grid', gap: 8, flex: 1, minHeight: 60 }}>
              {byColumn[col.key].length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: '16px 0' }}>—</div>}
              {byColumn[col.key].map(app => (
                <ApplicantCard key={app.id} app={app} onClick={() => setSelected(app)}
                  onApprove={col.key === 'pending_review' ? () => approve(app) : null}
                  onDeny={col.key === 'pending_review' ? () => deny(app) : null}
                  busy={busy} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Screened-out list */}
      {showScreened && screenedOut.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Screened out</h2>
          <div style={{ display: 'grid', gap: 6 }}>
            {screenedOut.map(app => (
              <button key={app.id} onClick={() => setSelected(app)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColor(app.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: 'none' }}>{initials(app.full_name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{app.full_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{app.state} · {STATUS_LABEL[app.status]}{app.screen_reason ? ` · ${app.screen_reason}` : ''}</div>
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{timeAgo(app.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && <DetailPanel app={selected} onClose={() => setSelected(null)}
        onApprove={approve} onDeny={deny} onTransition={transition} busy={busy} />}
    </div>
  )
}

function ApplicantCard({ app, onClick, onApprove, onDeny, busy }) {
  return (
    <div style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 10, padding: 10, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(app.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{initials(app.full_name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.full_name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.role_applying || '—'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
        <span>{app.city ? app.city + ', ' : ''}{app.state}</span>
        <span style={{ marginLeft: 'auto' }}>{timeAgo(app.created_at)}</span>
      </div>
      {(onApprove || onDeny) && (
        <div style={{ display: 'flex', gap: 6, marginTop: 9 }} onClick={e => e.stopPropagation()}>
          <button disabled={busy} onClick={onApprove}
            style={{ flex: 1, border: 0, borderRadius: 7, background: '#16A34A', color: '#fff', fontSize: 12.5, fontWeight: 700, padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit' }}>Approve</button>
          <button disabled={busy} onClick={onDeny}
            style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface)', color: '#DC2626', fontSize: 12.5, fontWeight: 700, padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit' }}>Deny</button>
        </div>
      )}
    </div>
  )
}

function DetailPanel({ app, onClose, onApprove, onDeny, onTransition, busy }) {
  const [resumeUrl, setResumeUrl] = useState(null)
  const [assessment, setAssessment] = useState(null)
  const [assessLoading, setAssessLoading] = useState(false)
  useEffect(() => {
    if (app.resume_path) {
      const { data } = supabase.storage.from('hiring-files').getPublicUrl(app.resume_path)
      setResumeUrl(data?.publicUrl || null)
    } else setResumeUrl(null)
  }, [app.resume_path])
  // Load this applicant's assessment (if they've submitted one) so we can
  // show their answers and play their voice recordings.
  useEffect(() => {
    let active = true
    setAssessment(null)
    ;(async () => {
      setAssessLoading(true)
      const { data } = await supabase.from('hiring_assessments')
        .select('*').eq('application_id', app.id).order('created_at', { ascending: false }).limit(1)
      if (!active) return
      const a = (data && data[0]) || null
      if (a) {
        // turn each recording's storage path into a playable URL
        const paths = ['rec_outbound_path', 'rec_inbound_path', 'rec_rebuttal1_path', 'rec_rebuttal2_path']
        a._urls = {}
        for (const p of paths) {
          if (a[p]) {
            const { data: pub } = supabase.storage.from('hiring-files').getPublicUrl(a[p])
            a._urls[p] = pub?.publicUrl || null
          }
        }
      }
      setAssessment(a)
      setAssessLoading(false)
    })()
    return () => { active = false }
  }, [app.id])

  const Row = ({ label, value }) => value ? (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  ) : null

  const Recording = ({ label, url }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {url
        ? <audio controls src={url} style={{ width: '100%', height: 38 }} />
        : <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Not submitted</div>}
    </div>
  )

  // "advance" options for stages past first review (simple move-forward controls)
  const advanceMap = {
    approved: { to: 'assessment_sent', label: 'Mark assessment sent', email: 'assessment_link' },
    assessment_review: { to: 'assessment_passed', label: 'Pass assessment', email: 'assessment_passed', deny: { to: 'assessment_denied', label: 'Reject assessment', email: 'assessment_denied' } },
    assessment_passed: { to: 'rippling_invited', label: 'Mark Rippling invited', email: null },
    rippling_invited: { to: 'onboarding', label: 'Mark onboarding started', email: null },
    onboarding: { to: 'certifying', label: 'Start certification', email: null },
    certifying: { to: 'cert_complete', label: 'Mark certification complete', email: null },
    cert_complete: { to: 'five9_pending', label: 'Begin Five9 setup', email: null },
    mock_requested: { to: 'mock_passed', label: 'Pass mock call', email: 'mock_passed', deny: { to: 'mock_failed', label: 'Fail mock call', email: 'mock_failed' } },
    mock_scheduled: { to: 'mock_passed', label: 'Pass mock call', email: 'mock_passed', deny: { to: 'mock_failed', label: 'Fail mock call', email: 'mock_failed' } },
  }
  const adv = advanceMap[app.status]

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 460, maxWidth: '92%', height: '100%', background: 'var(--surface)', overflowY: 'auto', boxShadow: '-10px 0 30px rgba(0,0,0,.15)' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 2 }}>
          <span style={{ width: 40, height: 40, borderRadius: '50%', background: avatarColor(app.full_name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, flex: 'none' }}>{initials(app.full_name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{app.full_name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{STATUS_LABEL[app.status]} · applied {timeAgo(app.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 22, color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* action bar */}
          {app.status === 'pending_review' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button disabled={busy} onClick={() => onApprove(app)} style={{ flex: 1, border: 0, borderRadius: 8, background: '#16A34A', color: '#fff', fontSize: 14, fontWeight: 700, padding: '10px 0', cursor: 'pointer', fontFamily: 'inherit' }}>Approve</button>
              <button disabled={busy} onClick={() => onDeny(app)} style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: '#DC2626', fontSize: 14, fontWeight: 700, padding: '10px 0', cursor: 'pointer', fontFamily: 'inherit' }}>Deny</button>
            </div>
          )}
          {adv && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              <button disabled={busy} onClick={() => onTransition(app, adv.to, { email: adv.email, note: adv.label })}
                style={{ flex: 1, border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit', minWidth: 160 }}>{adv.label}</button>
              {adv.deny && (
                <button disabled={busy} onClick={() => onTransition(app, adv.deny.to, { email: adv.deny.email, note: adv.deny.label })}
                  style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: '#DC2626', fontSize: 13.5, fontWeight: 700, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit', minWidth: 140 }}>{adv.deny.label}</button>
              )}
            </div>
          )}

          <Row label="Email" value={app.email} />
          <Row label="Phone" value={app.phone} />
          <Row label="Location" value={[app.city, app.state].filter(Boolean).join(', ')} />
          <Row label="Work authorized" value={app.work_authorized ? 'Yes' : 'No'} />
          <Row label="Role applying for" value={app.role_applying} />
          <Row label="Open to other roles" value={app.open_to_other_roles ? 'Yes' : 'No'} />
          <Row label="Employment type" value={app.employment_type} />
          <Row label="Years experience" value={app.years_experience} />
          <Row label="Tools & platforms" value={app.tools_platforms} />
          <Row label="Staying organized" value={app.organization_answer} />
          <Row label="Working remotely" value={app.remote_answer} />
          <Row label="Problem solved" value={app.problem_answer} />
          <Row label="Available to start" value={app.available_start} />
          <Row label="Time zone" value={app.time_zone} />
          <Row label="Working hours" value={app.working_hours} />
          <Row label="Compensation" value={app.compensation} />
          <Row label="Why Opsis" value={app.why_opsis} />
          {app.linkedin_url && (
            <Row label="LinkedIn" value={<a href={app.linkedin_url.startsWith('http') ? app.linkedin_url : 'https://' + app.linkedin_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{app.linkedin_url}</a>} />
          )}
          {resumeUrl && (
            <div style={{ marginTop: 14 }}>
              <a href={resumeUrl} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 600, textDecoration: 'none', color: 'var(--ink)', background: 'var(--canvas)' }}>
                📄 View resume
              </a>
            </div>
          )}

          {/* ---- Assessment (answers + voice recordings) ---- */}
          {assessLoading && <div style={{ marginTop: 20, fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading assessment…</div>}
          {assessment && (
            <div style={{ marginTop: 24, paddingTop: 18, borderTop: '2px solid var(--line)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 14px' }}>Assessment</h3>
              <Row label="Outbound / call-center experience" value={assessment.years_outbound} />
              <Row label="Call types handled" value={assessment.call_types} />
              <Row label="Systems / dialers / CRMs" value={assessment.systems_dialers} />
              <Row label="Performance metrics" value={assessment.performance_metrics} />
              <Row label="Hours per week" value={assessment.hours_per_week} />
              <Row label="Quiet workspace" value={assessment.quiet_workspace ? 'Yes' : 'No'} />
              <Row label="Own computer & headset" value={assessment.own_equipment ? 'Yes' : 'No'} />
              <Row label="Comfortable as 1099" value={assessment.comfortable_1099 ? 'Yes' : 'No'} />
              <Row label="Desired rate" value={assessment.desired_rate} />
              {assessment.availability && (
                <Row label="Availability" value={
                  ['Morning', 'Afternoon', 'Evening']
                    .map(s => (assessment.availability[s]?.length ? `${s}: ${assessment.availability[s].join(', ')}` : null))
                    .filter(Boolean).join('\n') || '—'
                } />
              )}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 10 }}>Voice recordings</div>
                <Recording label="1. Outbound greeting" url={assessment._urls?.rec_outbound_path} />
                <Recording label="2. Inbound greeting" url={assessment._urls?.rec_inbound_path} />
                <Recording label='3. Rebuttal — "I&apos;m not interested"' url={assessment._urls?.rec_rebuttal1_path} />
                <Recording label='4. Rebuttal — "How much does it cost?"' url={assessment._urls?.rec_rebuttal2_path} />
              </div>
            </div>
          )}
          {!assessLoading && !assessment && ['assessment_review', 'assessment_passed', 'assessment_denied'].includes(app.status) && (
            <div style={{ marginTop: 20, fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>No assessment record found for this applicant.</div>
          )}

          {app.screen_reason && (
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Auto-screen note: {app.screen_reason}</div>
          )}
        </div>
      </div>
    </div>
  )
}
