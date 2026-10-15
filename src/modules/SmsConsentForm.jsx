// ============================================================
//  SMS Consent form — PUBLIC page at /sms-consent (no login).
//
//  This is the opt-in page Twilio / carriers review for A2P 10DLC.
//  It must stay reachable without signing in, the checkbox must start
//  UNCHECKED, and the disclosures below must match the campaign text.
//
//  Saves through the submit_sms_consent RPC (Supabase). The database
//  stores the exact wording shown (CONSENT_TEXT) + CONSENT_VERSION, so
//  if you ever change the wording, bump CONSENT_VERSION.
//
//  If the visitor happens to be signed in, the RPC links the consent to
//  their own profile automatically; otherwise it matches by phone, then
//  by exact name, else it lands in the admin "Unmatched" queue.
// ============================================================
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export const CONSENT_VERSION = '2026-10-15'

export const CONSENT_TEXT =
  'I agree to receive scheduling and operational text messages from Opsis CX at the mobile number provided, ' +
  'including messages about previously selected shifts, upcoming shift reminders, scheduling changes, ' +
  'cancellations, and operational updates. Message frequency varies. Message and data rates may apply. ' +
  'Reply STOP to unsubscribe or HELP for help. Consent is optional and is not a condition of employment or engagement.'

const PRIVACY_URL = 'https://opsiscx.com/privacy'
const TERMS_URL = 'https://opsiscx.com/terms'

function formatPhone(v) {
  const d = v.replace(/\D/g, '').replace(/^1(?=\d{10})/, '').slice(0, 10)
  if (d.length < 4) return d
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

export default function SmsConsentForm() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [agree, setAgree] = useState(false)   // MUST default to false (unchecked)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const digits = phone.replace(/\D/g, '')
  const canSubmit = name.trim().length > 1 && digits.length === 10 && agree && !busy

  async function submit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true); setError('')
    const { error: err } = await supabase.rpc('submit_sms_consent', {
      p_full_name: name.trim(),
      p_phone: digits,
      p_opt_in: true,
      p_consent_version: CONSENT_VERSION,
      p_consent_text: CONSENT_TEXT,
      p_source: 'public_form',
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    setBusy(false)
    if (err) { setError(err.message || 'Something went wrong. Please try again.'); return }
    setDone(true)
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.brand}>Opsis CX</div>
        <h1 style={S.h1}>Agent Text Message Opt-In</h1>
        <p style={S.sub}>
          Opsis CX sends text messages to agents about scheduling and operations. Signing up is optional.
        </p>

        {done ? (
          <div style={S.success}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>You're opted in. Thank you!</div>
            <div>
              You'll receive scheduling and operational texts from Opsis CX at the number you provided.
              Reply <strong>STOP</strong> at any time to unsubscribe, or <strong>HELP</strong> for help.
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={S.label} htmlFor="sms-name">Full name</label>
            <input id="sms-name" style={S.input} value={name} onChange={e => setName(e.target.value)}
              autoComplete="name" placeholder="First and last name" maxLength={200} required />

            <label style={S.label} htmlFor="sms-phone">Mobile phone number</label>
            <input id="sms-phone" style={S.input} value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
              autoComplete="tel" inputMode="tel" placeholder="(555) 555-5555" required />

            <label style={S.checkRow}>
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={S.checkbox} />
              <span>{CONSENT_TEXT}</span>
            </label>

            <div style={S.fine}>
              <div><strong>Program:</strong> Opsis CX Agent Scheduling Notifications</div>
              <div><strong>Sender:</strong> Opsis CX, LLC</div>
              <div><strong>Message frequency:</strong> varies based on your schedule.</div>
              <div><strong>Cost:</strong> Message and data rates may apply.</div>
              <div><strong>Opt out:</strong> Reply STOP to any message. <strong>Help:</strong> Reply HELP to any message.</div>
              <div>Mobile numbers and opt-in consent are never sold or shared with third parties or affiliates for marketing purposes.</div>
              <div style={{ marginTop: 6 }}>
                <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={S.link}>Privacy Policy</a>
                {' · '}
                <a href={TERMS_URL} target="_blank" rel="noreferrer" style={S.link}>Terms &amp; Conditions</a>
              </div>
            </div>

            {error && <div style={S.error}>{error}</div>}

            <button type="submit" disabled={!canSubmit} style={{ ...S.button, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
              {busy ? 'Saving…' : 'Opt in to text messages'}
            </button>
          </form>
        )}
      </div>
      <div style={S.footer}>© Opsis CX, LLC</div>
    </div>
  )
}

const S = {
  page: { minHeight: '100vh', background: 'radial-gradient(ellipse at top, #0b2a33 0%, #05080c 60%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', boxSizing: 'border-box' },
  card: { width: '100%', maxWidth: 520, background: '#fff', borderRadius: 20, padding: '32px 28px', boxSizing: 'border-box', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', color: '#0f172a' },
  brand: { fontWeight: 800, fontSize: 14, letterSpacing: 1, textTransform: 'uppercase', color: '#0891b2', marginBottom: 6 },
  h1: { fontSize: 24, margin: '0 0 8px', fontWeight: 800 },
  sub: { fontSize: 14, color: '#475569', margin: '0 0 20px', lineHeight: 1.5 },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#134e4a', margin: '14px 0 6px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15, borderRadius: 10, border: '1px solid #cbd5e1', outline: 'none' },
  checkRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 13.5, lineHeight: 1.5, color: '#1e293b', cursor: 'pointer' },
  checkbox: { marginTop: 3, width: 18, height: 18, flexShrink: 0, cursor: 'pointer' },
  fine: { marginTop: 14, padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12.5, color: '#475569', lineHeight: 1.6 },
  link: { color: '#0e7490', fontWeight: 600 },
  error: { marginTop: 14, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, fontSize: 13 },
  button: { marginTop: 18, width: '100%', padding: '13px 0', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, color: '#0f172a', background: 'linear-gradient(90deg, #22e3ec, #12b5d6)' },
  success: { padding: '16px 18px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#14532d', borderRadius: 12, fontSize: 14, lineHeight: 1.5 },
  footer: { marginTop: 18, color: '#64748b', fontSize: 12 },
}
