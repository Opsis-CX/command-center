import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
// ============================================================
//  PUBLIC APPLICATION FORM  (Stage 2)
//  No login required. On submit it uploads the resume, inserts a
//  row into hiring_applications, then runs the auto-screen:
//    - state in EXCLUDED_STATES     -> 'out_of_area'  (+ email later)
//    - not authorized to work in US -> 'auto_denied'  (+ email later)
//    - otherwise                    -> 'pending_review'
//  Emails are STUBBED for now (see sendHiringEmail) and wired to an
//  Edge Function in a later stage.
// ============================================================

// States we do NOT contract in. Anyone here is screened out automatically.
const EXCLUDED_STATES = [
  'AK', 'AR', 'CA', 'CT', 'DE', 'HI', 'IL', 'IN', 'KS', 'LA', 'ME', 'MD',
  'MA', 'NE', 'NV', 'NH', 'NJ', 'NM', 'OH', 'OR', 'RI', 'TN', 'UT', 'VT',
  'WA', 'WV',
]
// All US states + DC for the dropdown.
const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]
const ROLES = [
  'Outbound Sales Representative',
  'Inbound Customer Service',
  'Appointment Setter',
  'Retention Specialist',
  'Other / Not sure',
]
const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Either', '1099 Contractor']
const MAX_RESUME_BYTES = 15 * 1024 * 1024 // 15MB

// --- STUB: replace with a real email send (Edge Function) later ---
async function sendHiringEmail(kind, to, data) {
  // kind: 'out_of_area' | 'auto_denied' | 'received'
  console.log(`[stub] would email "${kind}" to ${to}`, data)
  // TODO: call supabase.functions.invoke('send-hiring-email', { body: {...} })
}

async function uploadResume(file) {
  if (!file) return null
  if (file.size > MAX_RESUME_BYTES) throw new Error('Resume must be under 15MB.')
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'pdf'
  const rand = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())
  const path = `resumes/${rand}.${ext}`
  const { error } = await supabase.storage.from('hiring-files').upload(path, file, {
    contentType: file.type || undefined, upsert: false,
  })
  if (error) throw error
  return path
}

// Shared styles + Section defined at MODULE level (not inside the component),
// so React doesn't re-create them on every keystroke — that re-creation was
// what stole focus and limited typing to one character at a time.
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 5 }
const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)' }
const reqMark = <span style={{ color: '#DC2626' }}> *</span>
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingBottom: 6, borderBottom: '1px solid var(--line)' }}>{title}</h2>
      <div style={{ display: 'grid', gap: 16 }}>{children}</div>
    </div>
  )
}

export default function ApplicationForm() {
  const [f, setF] = useState({
    full_name: '', email: '', phone: '', city: '', state: '',
    work_authorized: '', role_applying: '', open_to_other_roles: '',
    employment_type: '', years_experience: '', tools_platforms: '',
    organization_answer: '', remote_answer: '', problem_answer: '',
    available_start: '', time_zone: '', working_hours: '', compensation: '',
    linkedin_url: '', why_opsis: '', info_confirmed: false,
  })
  const [resume, setResume] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)   // 'received' | 'out_of_area' | 'auto_denied'
  const resumeRef = useRef(null)
  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target?.value ?? e }))

  function validate() {
    if (!f.full_name.trim()) return 'Please enter your full name.'
    if (!f.email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return 'Please enter a valid email address.'
    if (!f.state) return 'Please select your state of residence.'
    if (!f.work_authorized) return 'Please answer the work authorization question.'
    if (!f.role_applying) return 'Please choose the role you are applying for.'
    if (!f.info_confirmed) return 'Please confirm your information is accurate.'
    return ''
  }

  async function submit() {
    const v = validate()
    if (v) { setErr(v); return }
    setSaving(true); setErr('')
    try {
      // upload resume first (optional)
      let resume_path = null
      try { resume_path = await uploadResume(resume) }
      catch (e) { setErr(e.message); setSaving(false); return }

      // decide the screening outcome
      const authorized = f.work_authorized === 'yes'
      const excluded = EXCLUDED_STATES.includes(f.state)
      let status = 'pending_review'
      let screen_reason = null
      if (!authorized) { status = 'auto_denied'; screen_reason = 'not_authorized' }
      else if (excluded) { status = 'out_of_area'; screen_reason = 'state:' + f.state }

      const newId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
      const row = {
        id: newId,
        status, screen_reason,
        full_name: f.full_name.trim(),
        email: f.email.trim(),
        phone: f.phone.trim() || null,
        city: f.city.trim() || null,
        state: f.state,
        work_authorized: authorized,
        role_applying: f.role_applying,
        open_to_other_roles: f.open_to_other_roles === 'yes',
        employment_type: f.employment_type || null,
        years_experience: f.years_experience || null,
        tools_platforms: f.tools_platforms.trim() || null,
        organization_answer: f.organization_answer.trim() || null,
        remote_answer: f.remote_answer.trim() || null,
        problem_answer: f.problem_answer.trim() || null,
        available_start: f.available_start.trim() || null,
        time_zone: f.time_zone.trim() || null,
        working_hours: f.working_hours.trim() || null,
        compensation: f.compensation.trim() || null,
        resume_path,
        linkedin_url: f.linkedin_url.trim() || null,
        why_opsis: f.why_opsis.trim() || null,
        info_confirmed: true,
      }
      // NOTE: no .select() here — anonymous applicants can insert but cannot
      // read the table back (reads are admin-only), so selecting the new row
      // would fail RLS. We generated the id ourselves instead.
      const { error } = await supabase.from('hiring_applications').insert(row)
      if (error) throw error

      // record the first stage event (system actor)
      await supabase.from('hiring_stage_events').insert({
        application_id: newId, from_status: 'applied', to_status: status, note: screen_reason,
      })

      // fire the right stubbed email
      if (status === 'out_of_area') await sendHiringEmail('out_of_area', f.email, { name: f.full_name, state: f.state })
      else if (status === 'auto_denied') await sendHiringEmail('auto_denied', f.email, { name: f.full_name })
      else await sendHiringEmail('received', f.email, { name: f.full_name })

      setDone(status)
    } catch (e) {
      setErr(e.message || 'Something went wrong submitting your application.')
    } finally { setSaving(false) }
  }

  // ---- confirmation screens ----
  if (done) {
    const msg = done === 'out_of_area'
      ? { title: 'Thank you for applying', body: `We're not currently contracting in ${US_STATES.find(s => s[0] === f.state)?.[1] || 'your state'}. We've kept your information and will reach out if that changes. We appreciate your interest in Opsis.` }
      : done === 'auto_denied'
      ? { title: 'Thank you for applying', body: `We're unable to move forward with your application at this time. We appreciate the time you took to apply.` }
      : { title: 'Application received', body: `Thanks, ${f.full_name.split(' ')[0]}! We've got your application and our team will review it shortly. If it's a match, you'll hear from us by email with the next step.` }
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{done === 'received' ? '✅' : '📩'}</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>{msg.title}</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--ink-soft)' }}>{msg.body}</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <img src="/opsis-logo.png" alt="Opsis" style={{ maxHeight: 56, width: 'auto', objectFit: 'contain' }} />
      </div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Join the Opsis team</h1>
        <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          Tell us a bit about you. It takes about 5 minutes, and everything you share helps us find the right fit.
        </p>
      </div>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13.5, marginBottom: 20 }}>{err}</div>}

      <Section title="About you">
        <div><label style={labelStyle}>Full name{reqMark}</label><input style={inputStyle} value={f.full_name} onChange={set('full_name')} placeholder="First and last name" /></div>
        <div><label style={labelStyle}>Email address{reqMark}</label><input style={inputStyle} type="email" value={f.email} onChange={set('email')} placeholder="you@example.com" /></div>
        <div><label style={labelStyle}>Phone number</label><input style={inputStyle} value={f.phone} onChange={set('phone')} placeholder="(555) 555-5555" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={labelStyle}>City</label><input style={inputStyle} value={f.city} onChange={set('city')} placeholder="City" /></div>
          <div><label style={labelStyle}>State of residence{reqMark}</label>
            <select style={inputStyle} value={f.state} onChange={set('state')}>
              <option value="">Select your state…</option>
              {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </div>
        </div>
      </Section>

      <Section title="Eligibility & role">
        <div><label style={labelStyle}>Are you legally authorized to work in the United States?{reqMark}</label>
          <select style={inputStyle} value={f.work_authorized} onChange={set('work_authorized')}>
            <option value="">Select…</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </div>
        <div><label style={labelStyle}>Which role are you applying for?{reqMark}</label>
          <select style={inputStyle} value={f.role_applying} onChange={set('role_applying')}>
            <option value="">Select a role…</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div><label style={labelStyle}>Open to being considered for other roles if a better fit comes up?</label>
          <select style={inputStyle} value={f.open_to_other_roles} onChange={set('open_to_other_roles')}>
            <option value="">Select…</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </div>
        <div><label style={labelStyle}>Employment type preference</label>
          <select style={inputStyle} value={f.employment_type} onChange={set('employment_type')}>
            <option value="">Select…</option>
            {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </Section>

      <Section title="Experience">
        <div><label style={labelStyle}>How many years of relevant work experience do you have?</label>
          <select style={inputStyle} value={f.years_experience} onChange={set('years_experience')}>
            <option value="">Select…</option>
            {['Less than 1 year', '1–2 years', '3–5 years', '5–10 years', '10+ years'].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div><label style={labelStyle}>Tools and platforms you've used in previous roles</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={f.tools_platforms} onChange={set('tools_platforms')} placeholder="CRMs, dialers, help desks, etc." /></div>
        <div><label style={labelStyle}>How do you stay organized managing multiple tasks or deadlines?</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={f.organization_answer} onChange={set('organization_answer')} /></div>
        <div><label style={labelStyle}>This is a fully remote role. How do you stay productive and communicate well remotely?</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={f.remote_answer} onChange={set('remote_answer')} /></div>
        <div><label style={labelStyle}>Tell us about a time you solved a problem or improved a process at work.</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={f.problem_answer} onChange={set('problem_answer')} /></div>
      </Section>

      <Section title="Availability & logistics">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={labelStyle}>When could you start?</label><input style={inputStyle} value={f.available_start} onChange={set('available_start')} placeholder="e.g. Immediately, or a date" /></div>
          <div><label style={labelStyle}>What time zone are you in?</label><input style={inputStyle} value={f.time_zone} onChange={set('time_zone')} placeholder="e.g. Eastern (ET)" /></div>
        </div>
        <div><label style={labelStyle}>Your typical working hours</label><input style={inputStyle} value={f.working_hours} onChange={set('working_hours')} placeholder="e.g. 9am–5pm weekdays" /></div>
        <div><label style={labelStyle}>Compensation expectations</label><input style={inputStyle} value={f.compensation} onChange={set('compensation')} placeholder="Hourly or per-project" /></div>
      </Section>

      <Section title="Wrap-up">
        <div>
          <label style={labelStyle}>Upload your resume</label>
          <input ref={resumeRef} type="file" accept=".pdf,.doc,.docx" onChange={e => setResume(e.target.files?.[0] || null)}
            style={{ ...inputStyle, padding: '8px 11px' }} />
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>PDF or Word, up to 15MB.</div>
        </div>
        <div><label style={labelStyle}>LinkedIn profile</label><input style={inputStyle} value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="linkedin.com/in/you" /></div>
        <div><label style={labelStyle}>Why are you interested in working with Opsis?</label>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={f.why_opsis} onChange={set('why_opsis')} /></div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.info_confirmed} onChange={e => setF(prev => ({ ...prev, info_confirmed: e.target.checked }))} style={{ marginTop: 3 }} />
          <span>I confirm the information in this application is accurate to the best of my knowledge.{reqMark}</span>
        </label>
      </Section>

      <button onClick={submit} disabled={saving}
        style={{ width: '100%', padding: '13px', border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'inherit' }}>
        {saving ? 'Submitting…' : 'Submit application'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 12 }}>
        We'll email you at the address above with next steps.
      </p>
    </div>
  )
}
