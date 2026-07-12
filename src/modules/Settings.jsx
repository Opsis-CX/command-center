import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { US_ZONES, detectedTZ, tzAbbrev, COMPANY_TZ } from '../lib/tz'
import { NOTIF_CATEGORIES } from '../lib/notify'
import { loadNotifPrefs, saveNotifPref } from '../lib/notif_prefs'
import { pushSupported, pushPermission, enablePush, disablePush, isPushEnabled } from '../lib/push'


function PushCard({ userId }) {
  const [enabled, setEnabled] = React.useState(false)
  const [perm, setPerm] = React.useState('default')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')

  React.useEffect(() => {
    if (!pushSupported()) return
    setPerm(pushPermission())
    isPushEnabled(userId).then(setEnabled)
  }, [userId])

  if (!pushSupported()) return null
  const denied = perm === 'denied'

  async function toggle() {
    setBusy(true); setMsg('')
    try {
      if (enabled) { await disablePush(userId); setEnabled(false); setMsg('Push turned off for this device') }
      else { await enablePush(userId); setEnabled(true); setPerm('granted'); setMsg('Push turned on for this device') }
    } catch (e) { setMsg(e.message) }
    finally { setBusy(false); setTimeout(() => setMsg(''), 3500) }
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line-soft)' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Push notifications on this device</div>
      <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 12 }}>
        Get browser notifications on this device even when Command Center isn't open.
        This is per-device; enable it on each computer or phone you use.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={toggle} disabled={busy || denied}
          style={{ border: '1px solid var(--line)', background: enabled ? 'var(--accent-bg)' : 'var(--surface)',
            color: enabled ? 'var(--accent)' : 'var(--ink-soft)', borderRadius: 8, padding: '7px 12px',
            fontSize: 13, fontWeight: 600, cursor: denied ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {denied ? 'Blocked in browser settings' : enabled ? '🔔 Push is on — turn off' : '🔕 Enable push on this device'}
        </button>
        {msg && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{msg}</span>}
      </div>
    </div>
  )
}

function NotificationPrefsCard({ userId }) {
  const [prefs, setPrefs] = React.useState(null)
  const [savingKey, setSavingKey] = React.useState(null)

  React.useEffect(() => { if (userId) loadNotifPrefs(userId).then(setPrefs) }, [userId])

  async function flip(category, field) {
    const current = prefs[category]
    const next = { ...current, [field]: !current[field] }
    setPrefs(p => ({ ...p, [category]: next }))
    setSavingKey(category + ':' + field)
    try { await saveNotifPref(userId, category, next) }
    catch (e) { setPrefs(p => ({ ...p, [category]: current })) }  // roll back
    finally { setSavingKey(null) }
  }

  const Toggle = ({ on, onClick, busy }) => (
    <button onClick={onClick} disabled={busy} aria-pressed={on}
      style={{ width: 40, height: 22, borderRadius: 11, border: '1px solid var(--line)',
        background: on ? 'var(--accent, #0077B6)' : 'var(--surface)', position: 'relative',
        cursor: busy ? 'default' : 'pointer', flex: 'none', transition: 'background .15s', opacity: busy ? 0.6 : 1 }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
    </button>
  )

  return (
    <div className="card" style={{ padding: 20, marginTop: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Notifications</div>
      <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 16 }}>
        Choose how each kind of notification reaches you. <b>In-app</b> shows it in your bell and history.
        <b> Push</b> sends a browser notification. <b>Sound</b> plays a chime when it arrives.
        Per-channel chat settings still live inside each chat channel.
      </p>

      {!prefs ? <p className="page-sub">Loading…</p> : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '10px 18px', alignItems: 'center' }}>
            <span />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textAlign: 'center' }}>IN-APP</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textAlign: 'center' }}>PUSH</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textAlign: 'center' }}>SOUND</span>
            {NOTIF_CATEGORIES.map(cat => (
              <React.Fragment key={cat.key}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{cat.label}</span>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  <Toggle on={prefs[cat.key].in_app} busy={savingKey === cat.key + ':in_app'} onClick={() => flip(cat.key, 'in_app')} />
                </div>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  <Toggle on={prefs[cat.key].push} busy={savingKey === cat.key + ':push'} onClick={() => flip(cat.key, 'push')} />
                </div>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  <Toggle on={prefs[cat.key].sound} busy={savingKey === cat.key + ':sound'} onClick={() => flip(cat.key, 'sound')} />
                </div>
              </React.Fragment>
            ))}
          </div>
          <PushCard userId={userId} />
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const [tz, setTz] = useState(COMPANY_TZ)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const detected = detectedTZ()

  useEffect(() => {
    (async () => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle()
      setTz(data?.timezone || COMPANY_TZ)
      setLoaded(true)
    })()
  }, [user])

  async function save(newTz) {
    setTz(newTz)
    await supabase.from('profiles').update({ timezone: newTz }).eq('id', user.id)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!loaded) return <div className="page-sub" style={{ padding: 30 }}>Loading settings…</div>

  const detectedInList = US_ZONES.some(([v]) => v === detected)

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>Settings</h2>
      <p className="page-sub" style={{ marginTop: 0, marginBottom: 24 }}>Your preferences for Command Center.</p>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Your timezone</div>
        <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 14 }}>
          Schedules are set in company time ({tzAbbrev(COMPANY_TZ)}). Choose your timezone and all times across
          Command Center — your calendar, shifts, and check-in — will show in your local time.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={tz} onChange={e => save(e.target.value)}
            style={{ fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', minWidth: 240 }}>
            {US_ZONES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            {!detectedInList && <option value={detected}>{detected}</option>}
          </select>
          {saved && <span style={{ fontSize: 13, color: 'var(--passed, #16A34A)' }}>✓ Saved</span>}
        </div>

        {detected && detected !== tz && (
          <button onClick={() => save(detected)}
            style={{ marginTop: 12, border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>
            Use my detected timezone ({detected}, {tzAbbrev(detected)})
          </button>
        )}

        <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          Currently showing times in: <b>{tzAbbrev(tz)}</b> ({tz})
        </div>
      </div>

      <NotificationPrefsCard userId={user?.id} />
    </div>
  )
}
