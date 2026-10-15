// ============================================================
//  SmsConsentBanner — a small, dismissible banner at the top of the app
//  for signed-in team members who have never answered the SMS opt-in.
//
//  It never opts anyone in by itself: "Opt in" opens the real consent form
//  (/sms-consent), where the person ticks the unchecked box. Because they're
//  signed in, the form links the consent to their own profile automatically.
//  "Not now" hides it for 14 days on this browser.
// ============================================================
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DISMISS_KEY = 'sms_consent_banner_dismissed_until'
const DISMISS_DAYS = 14

function dismissedRecently() {
  try { return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now() } catch { return false }
}

export default function SmsConsentBanner({ userId }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!userId || dismissedRecently()) return
    let active = true
    // Own rows only (RLS). Any record at all — opt in OR opt out — means they've answered.
    supabase.from('sms_consents').select('id').eq('profile_id', userId).limit(1)
      .then(({ data, error }) => { if (active && !error && (!data || data.length === 0)) setShow(true) })
    return () => { active = false }
  }, [userId])

  if (!show) return null

  function notNow() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000)) } catch { /* ignore */ }
    setShow(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 14, borderRadius: 12, border: '1px solid rgba(8,145,178,0.35)', background: 'rgba(8,145,178,0.08)', fontSize: 14 }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        📱 Want shift reminders and schedule changes by text? Opt in to Opsis CX text messages — it's optional.
      </span>
      <a href="/sms-consent" target="_blank" rel="noreferrer" onClick={() => setShow(false)}
        style={{ padding: '6px 12px', borderRadius: 8, background: '#0891b2', color: '#fff', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
        Opt in
      </a>
      <button onClick={notNow} style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.7, cursor: 'pointer', fontSize: 13 }}>Not now</button>
    </div>
  )
}
