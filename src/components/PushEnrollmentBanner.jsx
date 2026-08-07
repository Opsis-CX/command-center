import { useState, useEffect } from 'react'
import { pushSupported, pushPermission, enablePush, isPushEnabled } from '../lib/push'

// ============================================================
// PushEnrollmentBanner
//
// 37 of 41 active people had never registered a device for push, so
// notifications were reaching almost nobody. The cause is structural: browsers
// only grant push permission per-device, per-browser, from a user gesture. It
// cannot be enabled centrally — the ask has to reach each person on each device
// they use, and buried in Settings it never did.
//
// So: a dismissible banner that appears wherever they already are. It checks
// THIS device (isPushEnabled hits the browser's own subscription), which is why
// registering a desktop does not stop the banner appearing on a phone. That is
// correct, not a bug — they are genuinely two separate registrations.
// ============================================================

const SNOOZE_KEY = 'oc_push_prompt_snoozed_until'
const SNOOZE_DAYS = 7

// iOS refuses web push unless the site is installed to the home screen first,
// so those users need different instructions rather than a button that fails.
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export default function PushEnrollmentBanner({ profileId }) {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!profileId || !pushSupported()) return
      // Someone who actively said "no" at the browser prompt should not be nagged;
      // they have to undo that in browser settings, which a banner cannot do.
      if (pushPermission() === 'denied') return
      try {
        const until = Number(localStorage.getItem(SNOOZE_KEY) || 0)
        if (until && Date.now() < until) return
      } catch { /* private mode — just show it */ }
      try {
        const on = await isPushEnabled(profileId)
        if (!cancelled && !on) setShow(true)
      } catch { /* if the check fails, stay quiet rather than nag wrongly */ }
    })()
    return () => { cancelled = true }
  }, [profileId])

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400000)) } catch { /* ignore */ }
    setShow(false)
  }

  const turnOn = async () => {
    setBusy(true); setErr('')
    try {
      await enablePush(profileId)
      setDone(true)
      setTimeout(() => setShow(false), 2500)
    } catch (e) {
      setErr(e?.message || 'Could not turn on notifications on this device.')
    }
    setBusy(false)
  }

  if (!show) return null

  const iosNeedsInstall = isIOS() && !isStandalone()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10,
      padding: '11px 14px', margin: '0 0 14px',
    }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>🔔</span>
      <div style={{ flex: 1, minWidth: 200 }}>
        {done ? (
          <div style={{ fontSize: 13.5, color: '#92400E', fontWeight: 600 }}>
            Notifications are on for this device.
          </div>
        ) : iosNeedsInstall ? (
          <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.45 }}>
            <b>Turn on notifications for this iPhone.</b> Tap the Share button, choose
            “Add to Home Screen”, then open Command Center from that icon and come back here.
            iOS only allows notifications for installed apps.
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.45 }}>
            <b>You won't get notifications on this device yet.</b> Permission is granted per
            device, so turning it on elsewhere doesn't cover this one. You'll only be alerted
            for things aimed at you — DMs, mentions, assignments and open intervals.
          </div>
        )}
        {err && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 5 }}>{err}</div>}
      </div>
      {!done && !iosNeedsInstall && (
        <button onClick={turnOn} disabled={busy}
          style={{
            border: 0, borderRadius: 8, background: '#0077B6', color: '#fff', fontWeight: 700,
            fontSize: 13.5, padding: '9px 16px', cursor: busy ? 'default' : 'pointer',
            fontFamily: 'inherit', flexShrink: 0, opacity: busy ? 0.6 : 1,
          }}>
          {busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
      )}
      {!done && (
        <button onClick={snooze} title={`Ask again in ${SNOOZE_DAYS} days`}
          style={{
            border: '1px solid #FDE68A', borderRadius: 8, background: 'transparent',
            color: '#92400E', fontSize: 13, padding: '8px 12px', cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
          }}>
          Later
        </button>
      )}
    </div>
  )
}
