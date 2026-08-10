// Presence.jsx — Slack-style team presence + self-set status (incl. Out of Office).
//
// Three things live here, all self-contained:
//   1. usePresenceHeartbeat()  — mount once (in App). Pings profiles.last_seen_at
//      every 60s so others can see you're online. Uses the existing self-update RLS.
//   2. MyStatusButton()        — header chip showing your own dot + emoji; opens the
//      status picker (presets, custom emoji + text, and OOO with an end date).
//   3. TeamStatus()            — the "Team" board: everyone grouped into Out of office /
//      Online / Offline, with each person's status and last-active time.
//
// Presence data is just columns on `profiles` (last_seen_at, status_emoji, status_text,
// status_type, status_until). Everyone can read all profiles and update their own row,
// so no special backend is needed. Expired statuses auto-clear (UI-side here + an hourly
// cron server-side).
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const ONLINE_MS = 5 * 60 * 1000   // "online" = active within the last 5 minutes
const SELECT = 'id, full_name, email, role, is_active, last_seen_at, status_emoji, status_text, status_type, status_until, custom_status_presets'

// Preset statuses. `clearsBy` is a hint for the default auto-clear in the picker.
const PRESETS = [
  { key: 'wfh',     emoji: '🏠',  text: 'Working from home', clearsBy: 'today' },
  { key: 'meeting', emoji: '🔴',  text: 'In a meeting',      clearsBy: '1h' },
  { key: 'lunch',   emoji: '🍽️', text: 'Out for lunch',     clearsBy: '1h' },
  { key: 'focus',   emoji: '🎧',  text: 'Heads-down / focusing', clearsBy: 'today' },
  { key: 'ooo',     emoji: '🌴',  text: 'Out of office',     clearsBy: 'date' },
]
const QUICK_EMOJI = ['💬', '🏠', '🔴', '🍽️', '🎧', '🌴', '🤒', '✈️', '📅', '🚗', '☕', '🎉']

// ---- helpers ----
export function effStatus(p) {
  if (!p) return null
  if (p.status_until && new Date(p.status_until) < new Date()) return null   // expired → treat as cleared
  if (!p.status_emoji && !p.status_text && !p.status_type) return null
  return { emoji: p.status_emoji || '', text: p.status_text || '', type: p.status_type || 'custom', until: p.status_until || null }
}
export function isOnline(p) {
  return !!(p?.last_seen_at) && (Date.now() - new Date(p.last_seen_at).getTime()) < ONLINE_MS
}
function isOoo(p) { return effStatus(p)?.type === 'ooo' }

function relSeen(p) {
  if (!p?.last_seen_at) return 'never'
  const ms = Date.now() - new Date(p.last_seen_at).getTime()
  if (ms < ONLINE_MS) return 'active now'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(p.last_seen_at).toLocaleDateString()
}
function untilLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}
function endOfLocalDay(dateStr) {           // 'YYYY-MM-DD' -> ISO at 23:59 local
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 0, 0).toISOString()
}
function computeUntil(kind, dateStr) {
  const now = new Date()
  if (kind === '30m') return new Date(now.getTime() + 30 * 60000).toISOString()
  if (kind === '1h')  return new Date(now.getTime() + 60 * 60000).toISOString()
  if (kind === '4h')  return new Date(now.getTime() + 4 * 60 * 60000).toISOString()
  if (kind === 'today') { const e = new Date(now); e.setHours(23, 59, 0, 0); return e.toISOString() }
  if (kind === 'week')  { const e = new Date(now); e.setDate(e.getDate() + 7); return e.toISOString() }
  if (kind === 'date' && dateStr) return endOfLocalDay(dateStr)
  return null   // "don't clear"
}

// ---- presence dot ----
export function PresenceDot({ profile, size = 10, ring = 'var(--surface)' }) {
  const ooo = isOoo(profile)
  const online = isOnline(profile)
  const color = ooo ? '#a855f7' : online ? '#22c55e' : '#cbd5e1'
  return (
    <span
      title={ooo ? 'Out of office' : online ? 'Online' : 'Offline'}
      style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: `0 0 0 2px ${ring}`, flex: 'none' }}
    />
  )
}

// Small emoji badge for a person's status (used inline next to names).
export function StatusBadge({ profile, showText = false, style }) {
  const s = effStatus(profile)
  if (!s || (!s.emoji && !s.text)) return null
  return (
    <span title={s.text || ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--ink-soft)', ...style }}>
      {s.emoji && <span style={{ fontSize: 13 }}>{s.emoji}</span>}
      {showText && s.text && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{s.text}</span>}
    </span>
  )
}

// ---- heartbeat (mount once) ----
export function usePresenceHeartbeat() {
  const { session } = useAuth()
  const uid = session?.user?.id
  useEffect(() => {
    if (!uid) return
    const ping = () => {
      if (document.visibilityState === 'hidden') return
      supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', uid).then(() => {}, () => {})
    }
    ping()
    const iv = setInterval(ping, 60000)
    const onVis = () => { if (document.visibilityState === 'visible') ping() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [uid])
}

// ---- data hook: whole team, polled so online/offline transitions surface ----
export function useTeamPresence(pollMs = 30000) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select(SELECT).eq('is_active', true).order('full_name')
    setRows(data || [])
    setLoading(false)
  }, [])
  useEffect(() => {
    load()
    const iv = setInterval(load, pollMs)
    return () => clearInterval(iv)
  }, [load, pollMs])
  return { rows, loading, reload: load }
}

// Just the current user's own profile row (for the header chip).
function useMyProfile() {
  const { session } = useAuth()
  const uid = session?.user?.id
  const [me, setMe] = useState(null)
  const load = useCallback(async () => {
    if (!uid) return
    const { data } = await supabase.from('profiles').select(SELECT).eq('id', uid).maybeSingle()
    setMe(data || null)
  }, [uid])
  useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv) }, [load])
  return { me, reload: load, uid }
}

// ---- avatar w/ dot ----
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?'
}
function avatarColor(name) {
  let h = 0; const s = String(name || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `hsl(${h} 55% 45%)`
}
function Avatar({ profile, size = 34 }) {
  const name = profile?.full_name || profile?.email || '?'
  return (
    <span style={{ position: 'relative', display: 'inline-block', flex: 'none' }}>
      <span style={{ width: size, height: size, borderRadius: '50%', background: avatarColor(name), color: '#fff', display: 'grid', placeItems: 'center', fontSize: size * 0.36, fontWeight: 700 }}>{initials(name)}</span>
      <span style={{ position: 'absolute', right: -1, bottom: -1 }}><PresenceDot profile={profile} size={Math.max(9, size * 0.3)} /></span>
    </span>
  )
}

// ---- status picker modal ----
function StatusPicker({ me, uid, onClose, onSaved }) {
  const cur = effStatus(me)
  const [emoji, setEmoji] = useState(cur?.emoji || '')
  const [text, setText] = useState(cur?.text || '')
  const [type, setType] = useState(cur?.type || 'custom')
  const [clearKind, setClearKind] = useState('none')
  const [dateStr, setDateStr] = useState(() => {
    const t = new Date(); t.setDate(t.getDate() + 1)
    return t.toISOString().slice(0, 10)
  })
  const [saving, setSaving] = useState(false)
  // The user's own saved custom presets (array of { emoji, text }).
  const [myPresets, setMyPresets] = useState(() => Array.isArray(me?.custom_status_presets) ? me.custom_status_presets : [])

  const pickPreset = (p) => {
    setEmoji(p.emoji); setText(p.text); setType(p.key)
    setClearKind(p.clearsBy === 'date' ? 'date' : p.clearsBy || 'none')
  }
  const applyMyPreset = (p) => {
    setEmoji(p.emoji || ''); setText(p.text || ''); setType('custom')
  }
  // Save the currently typed emoji + text as a reusable preset chip.
  const savePreset = async () => {
    const e = (emoji || '').trim(); const t = (text || '').trim()
    if (!e && !t) return
    if (myPresets.some(p => (p.emoji || '') === e && (p.text || '') === t)) return  // no dupes
    const next = [...myPresets, { emoji: e, text: t }].slice(-12)  // keep the 12 most recent
    setMyPresets(next)
    await supabase.from('profiles').update({ custom_status_presets: next }).eq('id', uid)
  }
  const removePreset = async (idx) => {
    const next = myPresets.filter((_, i) => i !== idx)
    setMyPresets(next)
    await supabase.from('profiles').update({ custom_status_presets: next }).eq('id', uid)
  }
  const canSavePreset = !!((emoji || '').trim() || (text || '').trim())
  const alreadySaved = myPresets.some(p => (p.emoji || '') === (emoji || '').trim() && (p.text || '') === (text || '').trim())
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }
  const save = async () => {
    setSaving(true)
    const until = computeUntil(clearKind, dateStr)
    const payload = { status_emoji: emoji || null, status_text: text?.trim() || null, status_type: (emoji || text) ? type : null, status_until: (emoji || text) ? until : null }
    await supabase.from('profiles').update(payload).eq('id', uid)
    setSaving(false); onSaved?.(); onClose()
  }
  const clearAll = async () => {
    setSaving(true)
    await supabase.from('profiles').update({ status_emoji: null, status_text: null, status_type: null, status_until: null }).eq('id', uid)
    setSaving(false); onSaved?.(); onClose()
  }

  const isOooSel = type === 'ooo'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, overflowY: 'auto', padding: '24px 16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)', margin: '0 auto', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 15 }}>Set your status</b>
          <button onClick={onClose} style={{ border: 0, background: 'transparent', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: 'var(--ink-soft)' }}>×</button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* custom status — type your own emoji + text */}
          <div>
            <div style={lbl}>Custom</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 4))} placeholder="🙂" aria-label="Status emoji"
                style={{ width: 46, textAlign: 'center', fontSize: 20, padding: '8px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--canvas)', color: 'var(--ink)' }} />
              <input value={text} onChange={(e) => { setText(e.target.value); if (type !== 'ooo') setType('custom') }} placeholder="What's your status?" maxLength={80}
                style={{ flex: 1, fontSize: 14, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--canvas)', color: 'var(--ink)' }} />
              <button onClick={savePreset} disabled={!canSavePreset || alreadySaved}
                title={alreadySaved ? 'Already saved as a preset' : 'Save this as a reusable preset'}
                style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--canvas)', color: 'var(--ink-soft)', cursor: (!canSavePreset || alreadySaved) ? 'default' : 'pointer', opacity: (!canSavePreset || alreadySaved) ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                {alreadySaved ? '★ Saved' : '☆ Save'}
              </button>
            </div>
          </div>
          {/* quick emoji */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {QUICK_EMOJI.map(e => (
              <button key={e} onClick={() => setEmoji(e)} style={{ fontSize: 18, width: 34, height: 34, borderRadius: 8, border: '1px solid ' + (emoji === e ? 'var(--accent)' : 'var(--line)'), background: emoji === e ? 'var(--accent-bg)' : 'var(--canvas)', cursor: 'pointer' }}>{e}</button>
            ))}
          </div>
          {/* my saved presets */}
          {myPresets.length > 0 && (
            <div>
              <div style={lbl}>My presets</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {myPresets.map((p, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--canvas)', overflow: 'hidden' }}>
                    <button onClick={() => applyMyPreset(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 4px 6px 10px', border: 0, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>
                      {p.emoji && <span>{p.emoji}</span>}{p.text}
                    </button>
                    <button onClick={() => removePreset(i)} title="Remove preset" aria-label="Remove preset"
                      style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '6px 9px 6px 5px' }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* presets */}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Quick presets</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESETS.map(p => (
                <button key={p.key} onClick={() => pickPreset(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, border: '1px solid ' + (type === p.key ? 'var(--accent)' : 'var(--line)'), background: type === p.key ? 'var(--accent-bg)' : 'var(--canvas)', color: 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>
                  <span>{p.emoji}</span>{p.text}
                </button>
              ))}
            </div>
          </div>
          {/* clear-after / OOO end date */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{isOooSel ? 'Back on' : 'Clear after'}</label>
            {isOooSel ? (
              <input type="date" value={dateStr} onChange={(e) => { setDateStr(e.target.value); setClearKind('date') }}
                style={{ fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--canvas)', color: 'var(--ink)' }} />
            ) : (
              <select value={clearKind} onChange={(e) => setClearKind(e.target.value)}
                style={{ fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--canvas)', color: 'var(--ink)' }}>
                <option value="none">Don't clear</option>
                <option value="30m">30 minutes</option>
                <option value="1h">1 hour</option>
                <option value="4h">4 hours</option>
                <option value="today">Today</option>
                <option value="week">1 week</option>
              </select>
            )}
            {isOooSel && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>auto-clears the evening of that day</span>}
          </div>
        </div>
        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={clearAll} disabled={saving} style={{ border: '1px solid var(--line)', background: 'var(--canvas)', color: 'var(--ink-soft)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>Clear status</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ border: '1px solid var(--line)', background: 'var(--canvas)', color: 'var(--ink)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ border: 0, background: 'var(--accent, #0f766e)', color: '#fff', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- header chip ----
export function MyStatusButton() {
  const { me, reload, uid } = useMyProfile()
  const [open, setOpen] = useState(false)
  const s = effStatus(me)
  return (
    <>
      <button onClick={() => setOpen(true)} title="Set your status"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 210 }}>
        <PresenceDot profile={{ last_seen_at: new Date().toISOString(), status_type: s?.type }} size={9} />
        {s ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
            {s.emoji && <span>{s.emoji}</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.text || 'Status'}</span>
          </span>
        ) : (
          <span style={{ color: 'var(--ink-soft)' }}>＋ Status</span>
        )}
      </button>
      {open && <StatusPicker me={me} uid={uid} onClose={() => setOpen(false)} onSaved={reload} />}
    </>
  )
}

// ---- Team board ----
function PersonRow({ p }) {
  const s = effStatus(p)
  const ooo = s?.type === 'ooo'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
      <Avatar profile={p} size={36} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || p.email || 'Unknown'}</span>
          {s && (s.emoji || s.text) && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--ink-soft)', minWidth: 0 }}>
              {s.emoji && <span style={{ fontSize: 13 }}>{s.emoji}</span>}
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.text}</span>
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          {ooo && s.until ? `Back ${untilLabel(s.until)}` : relSeen(p)}
        </div>
      </div>
      {ooo && <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', background: 'rgba(168,85,247,0.12)', padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>OOO</span>}
    </div>
  )
}

export function TeamStatus() {
  const { rows, loading } = useTeamPresence()
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const match = (p) => !ql || (p.full_name || '').toLowerCase().includes(ql) || (p.email || '').toLowerCase().includes(ql) || (effStatus(p)?.text || '').toLowerCase().includes(ql)
  const people = rows.filter(match)

  const ooo = people.filter(isOoo)
  const online = people.filter(p => !isOoo(p) && isOnline(p))
  const offline = people.filter(p => !isOoo(p) && !isOnline(p))
  const byName = (a, b) => (a.full_name || '').localeCompare(b.full_name || '')
  ooo.sort(byName); online.sort(byName); offline.sort(byName)

  const Group = ({ label, list, tint }) => list.length === 0 ? null : (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: tint, display: 'inline-block' }} />
        {label} <span style={{ color: 'var(--ink-soft)', fontWeight: 500 }}>· {list.length}</span>
      </div>
      {list.map(p => <PersonRow key={p.id} p={p} />)}
    </div>
  )

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or status…"
        style={{ width: '100%', maxWidth: 340, fontSize: 14, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink)' }} />
      {loading && !rows.length ? <div style={{ color: 'var(--ink-soft)' }}>Loading team…</div> : (
        <>
          <Group label="Out of office" list={ooo} tint="#a855f7" />
          <Group label="Online" list={online} tint="#22c55e" />
          <Group label="Offline" list={offline} tint="#cbd5e1" />
          {people.length === 0 && <div style={{ color: 'var(--ink-soft)' }}>No one matches “{q}”.</div>}
        </>
      )}
    </div>
  )
}
