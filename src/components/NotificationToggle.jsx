import React, { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { pushSupported, pushPermission, enablePush, disablePush, isPushEnabled, registerServiceWorker } from '../lib/push'

// Small bell-with-toggle for enabling/disabling push notifications on this device.
export default function NotificationToggle() {
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [perm, setPerm] = useState('default')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    registerServiceWorker()
    setPerm(pushPermission())
    isPushEnabled().then(setEnabled)
  }, [])

  if (!pushSupported()) return null

  async function toggle() {
    setBusy(true); setMsg('')
    try {
      if (enabled) {
        await disablePush()
        setEnabled(false); setMsg('Notifications off for this device')
      } else {
        await enablePush(user.id)
        setEnabled(true); setPerm('granted'); setMsg('Notifications on for this device')
      }
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(''), 3500)
    }
  }

  const denied = perm === 'denied'

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button onClick={toggle} disabled={busy || denied}
        title={denied ? 'Notifications are blocked in your browser settings' : enabled ? 'Push notifications on — click to turn off' : 'Enable push notifications on this device'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)',
          background: enabled ? 'var(--accent-bg)' : 'var(--surface)', color: enabled ? 'var(--accent)' : 'var(--ink-soft)',
          borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontWeight: 600, cursor: denied ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        }}>
        <span style={{ fontSize: 14 }}>{enabled ? '🔔' : '🔕'}</span>
        {denied ? 'Blocked' : enabled ? 'Alerts on' : 'Enable alerts'}
      </button>
      {msg && (
        <span style={{ position: 'absolute', top: '110%', right: 0, whiteSpace: 'nowrap', fontSize: 11, color: 'var(--ink-soft)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', zIndex: 50, marginTop: 4 }}>{msg}</span>
      )}
    </div>
  )
}
