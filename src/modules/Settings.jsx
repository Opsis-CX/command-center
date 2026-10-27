import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { US_ZONES, detectedTZ, tzAbbrev, COMPANY_TZ } from '../lib/tz'
import { NOTIF_CATEGORIES } from '../lib/notify'
import { loadNotifPrefs, saveNotifPref } from '../lib/notif_prefs'
import { pushSupported, pushPermission, enablePush, disablePush, isPushEnabled, currentDeviceKey, isNativeApp, needsIosHomeScreen, describeDevice } from '../lib/push'
import { isStaffProfile, isAgentProfile } from './Chat'
import { SOUNDS, DEFAULT_SOUND_PREFS, loadSoundPrefs, saveSoundPrefs, playSound, primeAudio } from '../lib/sounds'


// ---- Notification sounds (Slack-style picker) ----
function SoundPicker({ value, onChange, volume }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
      {SOUNDS.map(snd => {
        const on = value === snd.key
        return (
          <div key={snd.key} onClick={() => { onChange(snd.key); primeAudio(); playSound(snd.key, volume) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              border: on ? '2px solid var(--accent)' : '1px solid var(--line)', background: on ? 'var(--accent-bg)' : 'var(--surface)' }}>
            <span style={{ width: 16, flex: 'none', color: 'var(--accent)' }}>{on ? '●' : '○'}</span>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: on ? 600 : 500 }}>{snd.label}</span>
            {snd.key !== 'none' && (
              <button title={`Play ${snd.label}`} onClick={(e) => { e.stopPropagation(); primeAudio(); playSound(snd.key, volume) }}
                style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 999, width: 26, height: 26, cursor: 'pointer', fontSize: 10, color: 'var(--ink-soft)', flex: 'none' }}>▶</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SoundCard({ userId }) {
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { if (userId) loadSoundPrefs(userId).then(v => setP({ ...v })) }, [userId])
  if (!p) return null

  async function save(next) {
    const merged = { ...p, ...next }
    setP(merged); setErr('')
    try { await saveSoundPrefs(userId, next) } catch (e) { setErr(e.message) }
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Notification sound</div>
      <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 14 }}>
        Plays whenever Command Center is open — even minimized or in another tab. If Command Center is fully closed,
        pop-ups use your computer's notification sound. Turn sounds on or off per type in the Notifications table above.
      </p>

      <SoundPicker value={p.sound} volume={p.volume} onChange={(k) => save({ sound: k })} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, width: 60 }}>Volume</span>
        <span>🔈</span>
        <input type="range" min={0} max={100} step={5} value={p.volume}
          onChange={e => setP({ ...p, volume: Number(e.target.value) })}
          onMouseUp={e => { save({ volume: Number(e.target.value) }); playSound(p.sound === 'none' ? 'chime' : p.sound, Number(e.target.value)) }}
          onTouchEnd={e => { save({ volume: Number(e.target.value) }); playSound(p.sound === 'none' ? 'chime' : p.sound, Number(e.target.value)) }}
          onKeyUp={e => save({ volume: Number(e.target.value) })}
          style={{ flex: 1, maxWidth: 280 }} />
        <span>🔊</span>
        <span className="page-sub" style={{ fontSize: 12, width: 34 }}>{p.volume}%</span>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={!!p.direct_sound} style={{ width: 18, height: 18 }}
          onChange={e => save({ direct_sound: e.target.checked ? (p.sound === 'doorbell' ? 'kalimba' : 'doorbell') : null })} />
        <span><b>Use a different sound for DMs &amp; @mentions</b>
          <span className="page-sub" style={{ display: 'block', fontSize: 12.5 }}>Also replies to you, @here, @update, and tasks assigned to you.</span></span>
      </label>
      {p.direct_sound && (
        <div style={{ marginTop: 10, marginLeft: 28 }}>
          <SoundPicker value={p.direct_sound} volume={p.volume} onChange={(k) => save({ direct_sound: k })} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }}
          onClick={() => save({ ...DEFAULT_SOUND_PREFS })}>Reset to default</button>
      </div>
      {err && <div style={{ color: '#DC2626', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </div>
  )
}

// ---- Direct messages from agents (internal staff only) ----
// Main switch + per-agent exceptions. The database enforces it: a blocked agent
// can read the DM but can't send in it (1:1 and group DMs). Staff-to-staff DMs
// can never be turned off, and agents never see this card.
function AgentDmCard({ userId }) {
  const [loaded, setLoaded] = useState(false)
  const [blockAll, setBlockAll] = useState(false)
  const [overrides, setOverrides] = useState({})   // agentId -> blocked
  const [agents, setAgents] = useState([])
  const [pick, setPick] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!userId) return
    ;(async () => {
      const [sRes, oRes, aRes] = await Promise.all([
        supabase.from('dm_agent_settings').select('block_all').eq('profile_id', userId).maybeSingle(),
        supabase.from('dm_agent_overrides').select('agent_id, blocked').eq('staff_id', userId),
        supabase.from('profiles').select('id, full_name, role, is_admin').eq('is_active', true).ilike('role', '%agent%').order('full_name'),
      ])
      setBlockAll(!!sRes.data?.block_all)
      const o = {}; (oRes.data || []).forEach(r => { o[r.agent_id] = r.blocked }); setOverrides(o)
      setAgents((aRes.data || []).filter(isAgentProfile))
      setLoaded(true)
    })()
  }, [userId])

  async function saveMain(v) {
    setErr(''); setBlockAll(v)
    const { error } = await supabase.from('dm_agent_settings')
      .upsert({ profile_id: userId, block_all: v, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
    if (error) { setErr(error.message); setBlockAll(!v) }
  }
  async function setOverride(agentId, blocked) {
    setErr(''); setOverrides(prev => ({ ...prev, [agentId]: blocked }))
    const { error } = await supabase.from('dm_agent_overrides')
      .upsert({ staff_id: userId, agent_id: agentId, blocked, updated_at: new Date().toISOString() }, { onConflict: 'staff_id,agent_id' })
    if (error) setErr(error.message)
  }
  async function removeOverride(agentId) {
    setErr(''); setOverrides(prev => { const n = { ...prev }; delete n[agentId]; return n })
    const { error } = await supabase.from('dm_agent_overrides').delete().eq('staff_id', userId).eq('agent_id', agentId)
    if (error) setErr(error.message)
  }

  if (!loaded) return null
  // An exception is any agent whose setting differs from the main switch.
  const exceptions = agents.filter(a => overrides[a.id] !== undefined && overrides[a.id] !== blockAll)
  const addable = agents.filter(a => !exceptions.some(e => e.id === a.id))
  const pill = (blocked) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: blocked ? '#fde8e8' : '#e7f3e7', color: blocked ? '#b42318' : '#2e7d32' }}>
      {blocked ? '🔕 Off' : '🔔 On'}
    </span>
  )

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Direct messages from agents</div>
      <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 14 }}>
        Turn this off to stop agents from messaging you directly, so questions go to their team channel. Agents can still read
        your past conversations, and you can still message them. Messages from staff are never affected.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={!blockAll} onChange={e => saveMain(!e.target.checked)} style={{ width: 18, height: 18 }} />
        <span><b>Allow agents to message me</b> {pill(blockAll)}</span>
      </label>

      <div style={{ marginTop: 18, fontSize: 13.5, fontWeight: 600 }}>
        Exceptions <span className="page-sub" style={{ fontWeight: 400, fontSize: 12.5 }}>
          — {blockAll ? 'agents who CAN still message you' : 'agents who CAN’T message you'}
        </span>
      </div>
      {exceptions.length === 0 && <div className="page-sub" style={{ fontSize: 12.5, marginTop: 6 }}>None.</div>}
      {exceptions.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ flex: 1, fontSize: 13.5 }}>{a.full_name}</span>
          {pill(overrides[a.id])}
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => removeOverride(a.id)}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <select value={pick} onChange={e => setPick(e.target.value)}
          style={{ fontSize: 13.5, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', minWidth: 220 }}>
          <option value="">Add an agent…</option>
          {addable.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <button className="btn" disabled={!pick} onClick={() => { setOverride(pick, !blockAll); setPick('') }}>
          {blockAll ? 'Allow this agent' : 'Turn off this agent'}
        </button>
      </div>
      <p className="page-sub" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
        Tip: you can also turn one agent on or off from the ⋯ menu next to your DM with them in Chat.
      </p>
      {err && <div style={{ color: '#DC2626', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </div>
  )
}

// Push on every device you use (web, desktop app, phone) — 2026-10-27, Brittney.
// Each browser / phone registers itself; this lists all of yours, lets you turn on the one
// you're using, remove old ones, and send a test that rings all of them.
function PushCard({ userId }) {
  const [enabled, setEnabled] = React.useState(false)
  const [perm, setPerm] = React.useState('default')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')
  const [devices, setDevices] = React.useState(null)
  const [hereKey, setHereKey] = React.useState(null)
  const supported = pushSupported()
  const iosNeedsInstall = needsIosHomeScreen()

  const loadDevices = React.useCallback(async () => {
    if (!userId) return
    const [w, n, key] = await Promise.all([
      supabase.from('push_subscriptions').select('id, endpoint, user_agent, created_at').eq('profile_id', userId).order('created_at', { ascending: false }),
      supabase.from('device_push_tokens').select('id, token, platform, user_agent, updated_at, created_at').eq('profile_id', userId).order('updated_at', { ascending: false }),
      currentDeviceKey(),
    ])
    setHereKey(key)
    setDevices([
      ...(w.data || []).map(d => ({ id: d.id, table: 'push_subscriptions', key: 'web:' + d.endpoint, name: describeDevice(d.user_agent, 'web'), since: d.created_at })),
      ...(n.data || []).map(d => ({ id: d.id, table: 'device_push_tokens', key: 'fcm:' + d.token, name: describeDevice(d.user_agent, 'native') + (d.platform === 'ios' ? '' : ''), since: d.updated_at || d.created_at })),
    ])
  }, [userId])

  React.useEffect(() => {
    if (supported) { setPerm(pushPermission()); isPushEnabled(userId).then(setEnabled) }
    loadDevices()
  }, [userId, supported, loadDevices])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 5000) }
  const denied = perm === 'denied'

  async function toggle() {
    setBusy(true); setMsg('')
    try {
      if (enabled) { await disablePush(userId); setEnabled(false); flash('Turned off for this device. Your other devices still get alerts.') }
      else { await enablePush(userId); setEnabled(true); setPerm('granted'); flash('Turned on for this device ✓') }
      await loadDevices()
    } catch (e) { flash(e.message) }
    finally { setBusy(false) }
  }
  async function remove(d) {
    if (!window.confirm(`Stop sending notifications to "${d.name}"?`)) return
    const { error } = await supabase.from(d.table).delete().eq('id', d.id)
    if (error) return flash(error.message)
    if (d.key === hereKey) setEnabled(false)
    loadDevices()
  }
  async function test(d) {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('send_test_push', d ? { p_table: d.table, p_id: d.id } : {})
    setBusy(false)
    if (error) return flash(error.message)
    if (d) return flash(`Test sent to ${d.name}. It should arrive in a few seconds.`)
    flash(data ? `Test sent to ${data} device${data === 1 ? '' : 's'}. It should arrive in a few seconds.` : 'No devices are turned on yet. Turn this device on first.')
  }
  const btn = (on) => ({ border: '1px solid var(--line)', background: on ? 'var(--accent-bg)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--ink)',
    borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
  const icon = (n) => /app/.test(n) ? '📱' : /iPhone|Android|iPad/.test(n) ? '📱' : '💻'

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line-soft)' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Push notifications on your devices</div>
      <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 12 }}>
        Turn this on once on <b>each</b> device you use (the website, the desktop app, your phone). Every device that's on gets alerts, even when Command Center isn't open.
      </p>

      {/* this device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {iosNeedsInstall ? (
          <div className="card" style={{ padding: '10px 12px', fontSize: 13 }}>
            📱 <b>On iPhone:</b> tap <b>Share</b> → <b>Add to Home Screen</b>, open Command Center from that new icon, then come back here to turn notifications on. (Apple only allows notifications for apps added to the Home Screen.)
          </div>
        ) : !supported ? (
          <span className="page-sub" style={{ margin: 0, fontSize: 13 }}>This browser doesn't support notifications. Try Chrome, Edge, or the Command Center app.</span>
        ) : (
          <button onClick={toggle} disabled={busy || denied} style={{ ...btn(enabled), cursor: denied ? 'not-allowed' : 'pointer' }}>
            {denied ? '🚫 Blocked in this browser\u2019s settings' : enabled ? '🔔 On for this device — turn off' : `🔕 Turn on for this device${isNativeApp() ? ' (app)' : ''}`}
          </button>
        )}
        <button onClick={() => test()} disabled={busy} style={btn(false)}>Send a test to all my devices</button>
      </div>
      {denied && <p className="page-sub" style={{ margin: '0 0 10px', fontSize: 12.5 }}>To unblock: click the 🔒 lock icon left of the web address → <b>Notifications</b> → <b>Allow</b>, then reload.</p>}
      {msg && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>{msg}</div>}

      {/* all devices */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0 6px' }}>Your devices</div>
      {!devices ? <p className="page-sub" style={{ margin: 0, fontSize: 13 }}>Loading…</p>
        : devices.length === 0 ? <p className="page-sub" style={{ margin: 0, fontSize: 13 }}>No devices are getting notifications yet.</p>
        : (
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            {devices.map((d, i) => (
              <div key={d.table + d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
                <span aria-hidden="true">{icon(d.name)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.name}{d.key === hereKey && <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>This device</span>}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>On since {new Date(d.since).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                </div>
                <button onClick={() => test(d)} disabled={busy} style={{ ...btn(false), padding: '4px 10px', fontSize: 12 }}>Test</button>
                <button onClick={() => remove(d)} style={{ ...btn(false), padding: '4px 10px', fontSize: 12, color: 'var(--ink-soft)' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      <p className="page-sub" style={{ margin: '8px 0 0', fontSize: 12 }}>
        Tip: the desktop app installed from Chrome or Edge shares that browser's setting — if it's on in that browser, the app gets alerts too.
        On iPhone, also check Settings → Notifications → Command Center: Allow Notifications, Sounds, and Banners should be on, and Focus / Do Not Disturb can hide them.
      </p>
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

// ---- Profile photo (avatar) ----
// Users upload a photo that replaces their coloured initials everywhere an
// avatar shows. Stored in the public "avatars" bucket under "<uid>/..." so the
// storage policy lets each person manage only their own file.
function initialsFrom(name) {
  return (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function PhotoCard({ userId }) {
  const [url, setUrl] = useState(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2563EB')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loaded, setLoaded] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!userId) return
    let active = true
    supabase.from('profiles').select('avatar_url, full_name, color').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setUrl(data?.avatar_url || null)
        setName(data?.full_name || '')
        if (data?.color) setColor(data.color)
        setLoaded(true)
      })
    return () => { active = false }
  }, [userId])

  async function onPick(e) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setErr('')
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { setErr('Please choose an image under 5 MB.'); return }
    setBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      // A fresh filename each time busts any CDN/browser cache of the old photo.
      const path = `${userId}/avatar-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const publicUrl = pub?.publicUrl
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId)
      if (dbErr) throw dbErr
      setUrl(publicUrl)
      window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: publicUrl }))
    } catch (e) {
      setErr(e?.message || 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
      if (error) throw error
      setUrl(null)
      window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: null }))
    } catch (e) {
      setErr(e?.message || 'Could not remove photo.')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Your photo</div>
      <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 14 }}>
        Add a profile photo — it replaces your initials across Command Center. Square images look best (JPG or PNG, up to 5 MB).
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {url
          ? <img src={url} alt={name} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 2px var(--line)' }} />
          : <span style={{ width: 72, height: 72, borderRadius: '50%', background: color + '22', color, fontSize: 26, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initialsFrom(name)}</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : url ? 'Change photo' : 'Upload photo'}
          </button>
          {url && <button className="btn btn-ghost" disabled={busy} onClick={onRemove}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
        </div>
      </div>
      {err && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--failed, #c0392b)' }}>{err}</div>}
    </div>
  )
}

export default function Settings() {
  const { user, appRole, isAdmin } = useAuth()
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

      <PhotoCard userId={user?.id} />

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Your timezone</div>
        <p className="page-sub" style={{ marginTop: 0, fontSize: 13, marginBottom: 14 }}>
          Schedules are set in company time ({tzAbbrev(COMPANY_TZ)}). Choose your timezone and all times across
          Command Center — your calendar, intervals, and check-in — will show in your local time.
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

      <SoundCard userId={user?.id} />

      {isStaffProfile({ role: appRole, is_admin: isAdmin }) && <AgentDmCard userId={user?.id} />}
    </div>
  )
}
