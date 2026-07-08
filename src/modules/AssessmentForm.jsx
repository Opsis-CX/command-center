import { useState } from 'react'
import { supabase } from '../lib/supabase'
// ============================================================
//  ASSESSMENT FORM  (trimmed)
//  Shown to APPROVED applicants. Only asks things the application
//  did NOT already collect, plus the 4 voice recordings.
//  On submit: inserts into hiring_assessments and moves the
//  application to 'assessment_review'.
//  Reaches this page with the application id (/assessment/:appId).
// ============================================================

async function sendHiringEmail(kind, to, data) {
  try {
    const { error } = await supabase.functions.invoke('send-hiring-email', { body: { kind, to, data } })
    if (error) console.error('email send failed:', error)
  } catch (e) { console.error('email send failed:', e) }
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024    // 25MB per recording
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SLOTS = ['Morning', 'Afternoon', 'Evening']
const YEARS = ['Less than 1 year', '1–2 years', '3–5 years', '5–10 years', '10+ years']
const CALL_TYPES = ['Warm leads', 'Cold calls', 'Appointment setting', 'Direct Sales', 'Customer Service / Retention', 'Other']

async function uploadFile(file, folder, maxBytes) {
  if (!file) return null
  if (file.size > maxBytes) throw new Error(`"${file.name}" is too large.`)
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'dat'
  const rand = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())
  const path = `${folder}/${rand}.${ext}`
  const { error } = await supabase.storage.from('hiring-files').upload(path, file, {
    contentType: file.type || undefined, upsert: false,
  })
  if (error) throw error
  return path
}

// Module-level styles + Section so React keeps input focus while typing.
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 5 }
const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)' }
const reqMark = <span style={{ color: '#DC2626' }}> *</span>
function Section({ title, sub, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: sub ? 3 : 14, paddingBottom: 6, borderBottom: '1px solid var(--line)' }}>{title}</h2>
      {sub && <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px' }}>{sub}</p>}
      <div style={{ display: 'grid', gap: 16 }}>{children}</div>
    </div>
  )
}

export default function AssessmentForm({ applicationId }) {
  const [f, setF] = useState({
    full_name: '',
    years_outbound: '',
    systems_dialers: '', performance_metrics: '',
    hours_per_week: '',
    quiet_workspace: '', own_equipment: '', comfortable_1099: '', desired_rate: '',
  })
  const [callTypes, setCallTypes] = useState([])
  const [availability, setAvailability] = useState({})  // "Morning-Mon": true
  const [files, setFiles] = useState({ rec_outbound: null, rec_inbound: null, rec_rebuttal1: null, rec_rebuttal2: null })
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target?.value ?? e }))
  const setFile = (k) => (e) => setFiles(prev => ({ ...prev, [k]: e.target.files?.[0] || null }))
  const toggleCallType = (t) => setCallTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  const toggleAvail = (slot, day) => {
    const key = `${slot}-${day}`
    setAvailability(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function validate() {
    if (!f.full_name.trim()) return 'Please enter your full name.'
    if (!f.years_outbound) return 'Please select your outbound/call-center experience.'
    if (!f.quiet_workspace) return 'Please answer the quiet workspace question.'
    if (!f.own_equipment) return 'Please answer the equipment question.'
    if (!f.comfortable_1099) return 'Please answer the 1099 question.'
    if (!files.rec_outbound || !files.rec_inbound || !files.rec_rebuttal1 || !files.rec_rebuttal2)
      return 'Please upload all four voice recordings.'
    return ''
  }

  async function submit() {
    const v = validate()
    if (v) { setErr(v); return }
    setSaving(true); setErr('')
    try {
      setProgress('Uploading recording 1 of 4…')
      const rec_outbound_path = await uploadFile(files.rec_outbound, 'assess-audio', MAX_AUDIO_BYTES)
      setProgress('Uploading recording 2 of 4…')
      const rec_inbound_path = await uploadFile(files.rec_inbound, 'assess-audio', MAX_AUDIO_BYTES)
      setProgress('Uploading recording 3 of 4…')
      const rec_rebuttal1_path = await uploadFile(files.rec_rebuttal1, 'assess-audio', MAX_AUDIO_BYTES)
      setProgress('Uploading recording 4 of 4…')
      const rec_rebuttal2_path = await uploadFile(files.rec_rebuttal2, 'assess-audio', MAX_AUDIO_BYTES)

      // availability grouped by slot
      const avail = { Morning: [], Afternoon: [], Evening: [] }
      SLOTS.forEach(slot => DAYS.forEach(day => { if (availability[`${slot}-${day}`]) avail[slot].push(day) }))

      setProgress('Saving your assessment…')
      const row = {
        application_id: applicationId || null,
        full_name: f.full_name.trim(),
        years_outbound: f.years_outbound,
        call_types: callTypes.join(', ') || null,
        systems_dialers: f.systems_dialers.trim() || null,
        performance_metrics: f.performance_metrics.trim() || null,
        hours_per_week: f.hours_per_week.trim() || null,
        availability: avail,
        quiet_workspace: f.quiet_workspace === 'yes',
        own_equipment: f.own_equipment === 'yes',
        comfortable_1099: f.comfortable_1099 === 'yes',
        desired_rate: f.desired_rate.trim() || null,
        rec_outbound_path, rec_inbound_path, rec_rebuttal1_path, rec_rebuttal2_path,
      }
      const { error: aErr } = await supabase.from('hiring_assessments').insert(row)
      if (aErr) throw aErr

      if (applicationId) {
        await supabase.from('hiring_applications').update({ status: 'assessment_review' }).eq('id', applicationId)
        await supabase.from('hiring_stage_events').insert({
          application_id: applicationId, from_status: 'assessment_sent', to_status: 'assessment_review', note: 'assessment submitted',
        })
      }
      setDone(true)
    } catch (e) {
      setErr(e.message || 'Something went wrong submitting your assessment.')
    } finally { setSaving(false); setProgress('') }
  }

  if (done) {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>Assessment received</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
          Thanks for completing the Opsis assessment. Our team will review your responses and recordings, and we'll be in touch by email with next steps.
        </p>
      </div>
    )
  }

  const yesNo = (k) => (
    <select style={inputStyle} value={f[k]} onChange={set(k)}>
      <option value="">Select…</option><option value="yes">Yes</option><option value="no">No</option>
    </select>
  )
  const fileField = (k, accept, hint) => (
    <div>
      <input type="file" accept={accept} onChange={setFile(k)} style={{ ...inputStyle, padding: '8px 11px' }} />
      {files[k] && <div style={{ fontSize: 12, color: '#16A34A', marginTop: 4 }}>✓ {files[k].name}</div>}
      {hint && !files[k] && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>{hint}</div>}
    </div>
  )

  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <img src="/opsis-logo.png" alt="Opsis" style={{ maxHeight: 56, width: 'auto', objectFit: 'contain' }} />
      </div>
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Opsis Assessment</h1>
        <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          Thanks for moving forward! This short assessment covers a few role-specific questions and four quick voice recordings. It takes about 15–20 minutes.
        </p>
      </div>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13.5, marginBottom: 20 }}>{err}</div>}

      <Section title="Your name">
        <div><label style={labelStyle}>Full name{reqMark}</label><input style={inputStyle} value={f.full_name} onChange={set('full_name')} placeholder="First and last name" /></div>
      </Section>

      <Section title="Call experience">
        <div><label style={labelStyle}>Years of outbound sales or call center experience{reqMark}</label>
          <select style={inputStyle} value={f.years_outbound} onChange={set('years_outbound')}>
            <option value="">Select…</option>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>What type of outbound calls have you handled?</label>
          <div style={{ display: 'grid', gap: 6 }}>
            {CALL_TYPES.map(t => (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={callTypes.includes(t)} onChange={() => toggleCallType(t)} />{t}
              </label>
            ))}
          </div>
        </div>
        <div><label style={labelStyle}>What systems, dialers, or CRMs have you used?</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={f.systems_dialers} onChange={set('systems_dialers')} /></div>
        <div><label style={labelStyle}>What performance metrics were you responsible for meeting?</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={f.performance_metrics} onChange={set('performance_metrics')} /></div>
      </Section>

      <Section title="Availability" sub="Check every time block you can consistently work.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--ink-soft)' }}></th>
                {DAYS.map(d => <th key={d} style={{ padding: '6px 4px', fontWeight: 600 }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {SLOTS.map(slot => (
                <tr key={slot}>
                  <td style={{ padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{slot}</td>
                  {DAYS.map(day => (
                    <td key={day} style={{ textAlign: 'center', padding: '4px' }}>
                      <input type="checkbox" checked={!!availability[`${slot}-${day}`]} onChange={() => toggleAvail(slot, day)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><label style={labelStyle}>Hours per week you can commit</label><input style={inputStyle} value={f.hours_per_week} onChange={set('hours_per_week')} placeholder="e.g. 30" /></div>
      </Section>

      <Section title="Work setup">
        <div><label style={labelStyle}>Do you have a quiet workspace and reliable internet for handling calls?{reqMark}</label>{yesNo('quiet_workspace')}</div>
        <div><label style={labelStyle}>Do you have your own computer and headset?{reqMark}</label>{yesNo('own_equipment')}</div>
        <div><label style={labelStyle}>Are you comfortable working as a 1099 independent contractor?{reqMark}</label>{yesNo('comfortable_1099')}</div>
        <div><label style={labelStyle}>Your desired hourly or performance-based rate</label><input style={inputStyle} value={f.desired_rate} onChange={set('desired_rate')} /></div>
      </Section>

      <Section title="Voice recordings" sub="Record each in your customer-service voice, then upload the audio file (MP3 or WAV). Read the script exactly as written.">
        <div>
          <label style={labelStyle}>1. Outbound greeting{reqMark}</label>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.5 }}>
            "Hi Becky, this is [Your Name] with Opsis. I'm calling about your request for a [home improvement project of your choice]. I just want to get a quick idea of what you're looking for so we can get you set up properly."
          </div>
          {fileField('rec_outbound', 'audio/*,.mp3,.wav,.m4a', 'MP3, WAV, or M4A.')}
        </div>
        <div>
          <label style={labelStyle}>2. Inbound greeting{reqMark}</label>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.5 }}>
            "Thank you for calling Opsis. This is [Your Name]. How can I help you today?"
          </div>
          {fileField('rec_inbound', 'audio/*,.mp3,.wav,.m4a', 'MP3, WAV, or M4A.')}
        </div>
        <div>
          <label style={labelStyle}>3. Rebuttal — "I'm not interested"{reqMark}</label>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.5 }}>
            If someone on the phone says "I'm not interested," what's a good response to try to regain their interest? Record your answer.
          </div>
          {fileField('rec_rebuttal1', 'audio/*,.mp3,.wav,.m4a', 'MP3, WAV, or M4A.')}
        </div>
        <div>
          <label style={labelStyle}>4. Rebuttal — "How much does it cost?"{reqMark}</label>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.5 }}>
            We can't give quotes over the phone — someone needs to inspect the area (for free) to give an exact quote. If someone asks "How much does it cost?", how would you respond? Record your answer.
          </div>
          {fileField('rec_rebuttal2', 'audio/*,.mp3,.wav,.m4a', 'MP3, WAV, or M4A.')}
        </div>
      </Section>

      <button onClick={submit} disabled={saving}
        style={{ width: '100%', padding: '13px', border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'inherit' }}>
        {saving ? (progress || 'Submitting…') : 'Submit assessment'}
      </button>
      {saving && <p style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 10 }}>Uploading files can take a moment — please don't close this page.</p>}
    </div>
  )
}
