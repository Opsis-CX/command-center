
import React, { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { celebrate, SeasonHeaderDecor } from '../components/Seasonal'

// ============================================================
// MY PROFILE — dashboard pieces (2026-10-26 redesign)
//   ProfileHeader  full-width header: photo, name, status, project/task counts, 4 action buttons
//   Drawer         slide-over panel used by the header buttons (Escape / backdrop closes)
//   RemindersPanel personal reminders (table personal_reminders). Admins can set them for others.
//                  Warnings 30 and 10 minutes before (DB cron reminder-warnings). No email, no recurrence.
//   MyWeek         the person's scheduled shifts only (RPC profile_week_shifts), with week paging
//   MyMeetings     upcoming meetings from the existing calendar sources: Command Center events,
//                  synced Google events and coaching sessions. Editing reuses the Calendar editor.
//   Section        collapsible profile section that remembers open/closed per device
// Calendar, My Notes and Updates open inside the Drawer as the existing modules, so their
// sync rules, permissions and acknowledgment workflow are unchanged.
// ============================================================

const Calendar = lazy(() => import('./Calendar'))
const Notes = lazy(() => import('./Notes'))
const Updates = lazy(() => import('./Updates'))
const WeeklySync = lazy(() => import('./WeeklySync'))
const EodReport = lazy(() => import('./EodReports'))

const COMPANY_TZ = 'America/New_York'
export const viewerTZ = (pref) => pref || Intl.DateTimeFormat().resolvedOptions().timeZone || COMPANY_TZ

// ---------- time helpers ----------
function tzOffsetMs(ms, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))
  const g = (k) => +p.find(x => x.type === k).value
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - ms
}
// A wall-clock date + time in a given zone → the real moment (handles daylight saving).
export function zonedInstant(dateStr, timeStr, tz = COMPANY_TZ) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const [h, mi] = String(timeStr || '00:00').split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0)
  let inst = guess - tzOffsetMs(guess, tz)
  const off2 = tzOffsetMs(inst, tz)
  if (guess - off2 !== inst) inst = guess - off2
  return new Date(inst)
}
const fmtClock = (dt, tz) => dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
// "11:00 – 11:30 AM" (drops the first AM/PM when both match)
const fmtRange = (a, b, tz) => { const x = fmtClock(a, tz), y = fmtClock(b, tz); return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}` }
const ymdIn = (dt, tz) => dt.toLocaleDateString('en-CA', { timeZone: tz })
const addDaysStr = (ds, n) => { const x = new Date(ds + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const mondayOf = (ds) => { const x = new Date(ds + 'T12:00:00Z'); const w = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - w); return x.toISOString().slice(0, 10) }
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: COMPANY_TZ })
const dayLabel = (ds, opts) => new Date(ds + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })

// ---------- shared styles ----------
export const PD_CSS = `
.pd { container-type: inline-size; width: 100%; }
.pd-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; margin-top: 16px; }
.pd-main, .pd-aside { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@container (min-width: 1000px) { .pd-grid { grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); } .pd-aside { position: sticky; top: 16px; } }
.pd-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; }
.pd-hdr { background: linear-gradient(120deg, #0B2533 0%, #0E3A48 55%, #0F4C57 100%); color: #fff; border-radius: 16px; padding: 22px 24px;
  display: flex; flex-wrap: wrap; gap: 18px 26px; align-items: center; position: relative; overflow: hidden; box-shadow: 0 10px 30px -18px rgba(8,30,40,.7); }
.pd-hdr::after { content: ''; position: absolute; inset: auto -60px -80px auto; width: 280px; height: 280px; border-radius: 50%; background: radial-gradient(circle, rgba(34,227,227,.16), transparent 70%); pointer-events: none; }
.pd-hdr a { color: #9FF3F0; }
.pd-stat { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 14px; border-radius: 12px; text-decoration: none; color: #fff !important; min-width: 82px; }
.pd-stat:hover, .pd-stat:focus-visible { background: rgba(255,255,255,.08); outline: none; }
.pd-act { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; width: 96px; height: 80px;
  border-radius: 12px; border: 1.5px solid rgba(94,234,212,.55); background: rgba(255,255,255,.03); color: #fff; font: 600 13px/1 inherit; white-space: nowrap; padding: 0 6px; cursor: pointer; transition: background .15s, border-color .15s, transform .12s; }
.pd-act:hover { background: rgba(94,234,212,.12); border-color: #5EEAD4; }
.pd-act:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
.pd-badge { position: absolute; top: -7px; right: -7px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #EF4444; color: #fff; font: 700 11px/20px inherit; text-align: center; box-shadow: 0 0 0 2px #0E3A48; }
.pd-sec-h { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 18px; cursor: pointer; border-radius: 14px; }
.pd-sec-h:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.pd-sec-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .22s ease; }
.pd-sec-body.open { grid-template-rows: 1fr; }
.pd-sec-body > div { overflow: hidden; }
.pd-chev { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; color: var(--ink-soft); transition: transform .2s; flex: none; }
.pd-chev.open { transform: rotate(180deg); }
.pd-days { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
.pd-day { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.pd-day.today { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, var(--surface)); box-shadow: 0 0 0 1px var(--accent) inset; }
.pd-shift { margin-top: 8px; border-radius: 8px; padding: 7px 9px; background: color-mix(in srgb, #14B8A6 12%, var(--surface)); font-size: 12.5px; }
.pd-meets { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.pd-meet { position: relative; border: 1px solid var(--line); border-left: 4px solid var(--m, #3B82F6); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.pd-meet.now { box-shadow: 0 0 0 2px color-mix(in srgb, #22C55E 60%, transparent); }
.pd-iconbtn { all: unset; cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; color: var(--ink-soft); }
.pd-iconbtn:hover, .pd-iconbtn:focus-visible { background: var(--canvas); outline: none; }
.pd-menu { position: absolute; right: 6px; top: 34px; z-index: 30; min-width: 190px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,.16); padding: 4px; }
.pd-menu button, .pd-menu a { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 8px 10px; border-radius: 7px; font-size: 13px; cursor: pointer; color: var(--ink); }
.pd-menu button:hover, .pd-menu a:hover, .pd-menu button:focus-visible, .pd-menu a:focus-visible { background: var(--canvas); }
.pd-tabs { display: inline-flex; gap: 4px; background: var(--canvas); padding: 3px; border-radius: 10px; }
.pd-tabs button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--ink-soft); }
.pd-tabs button[aria-selected="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
@media (max-width: 640px) { .pd-hdr { padding: 18px; } .pd-act { width: calc(50% - 6px); height: 70px; } .pd-acts { width: 100%; } }
`

// ---------- icons (stroke, 24px box) ----------
const I = {
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
  note: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  mega: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  cam: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  chev: 'M6 9l6 6 6-6', left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6',
  dots: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  video: 'M23 7l-7 5 7 5zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
  plus: 'M12 5v14M5 12h14', x: 'M18 6L6 18M6 6l12 12',
  sync: 'M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5',
  eod: 'M17 18a5 5 0 0 0-10 0M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4',
}
export const Icon = ({ d, size = 20, color = 'currentColor', sw = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)

// ---------- photo upload (same storage + event as Settings) ----------
async function uploadAvatar(file, userId) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  if (file.size > 5 * 1024 * 1024) throw new Error('Please choose an image under 5 MB.')
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${userId}/avatar-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
  if (upErr) throw upErr
  const url = supabase.storage.from('avatars').getPublicUrl(path)?.data?.publicUrl
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
  if (error) throw error
  window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: url }))
  return url
}

// ============================================================
// HEADER
// ============================================================
export function ProfileHeader({ person, isSelf, userId, projectCount, openTasks, onPhotoChanged, onEditProfile, badges = {}, onOpen, weekStats, bg = {}, onBgChange, canProjects = true, canWeeklySync = false, canEod = false }) {
  const [bgOpen, setBgOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [photoMenu, setPhotoMenu] = useState(false)
  const fileRef = useRef(null)
  useEffect(() => {
    if (!isSelf) return
    const t = setTimeout(() => { import('./Calendar'); import('./Notes'); import('./Updates'); if (canWeeklySync) import('./WeeklySync'); if (canEod) import('./EodReports') }, 1200)
    return () => clearTimeout(t)
  }, [isSelf, canWeeklySync, canEod])
  const initials = (person.full_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  async function onPick(e) {
    const file = e.target.files?.[0]; if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try { onPhotoChanged(await uploadAvatar(file, userId)) } catch (e2) { setErr(e2?.message || 'Upload failed. Please try again.') } finally { setBusy(false) }
  }
  async function onRemove() {
    setPhotoMenu(false); setBusy(true); setErr('')
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
    setBusy(false)
    if (error) return setErr(error.message)
    onPhotoChanged(null); window.dispatchEvent(new CustomEvent('cc:avatar-updated', { detail: null }))
  }
  const acts = [
    ['reminders', 'Reminders', I.bell, badges.reminders],
    ['calendar', 'Calendar', I.cal],
    ['notes', 'Notes', I.note],
    ['updates', 'Updates', I.mega, badges.updates],
    ...(canWeeklySync ? [['weeklysync', 'Weekly Sync', I.sync]] : []),
    ...(canEod ? [['eod', 'EOD Report', I.eod]] : []),
  ]
  return (
    <div style={{ position: 'relative' }}>
    {bgOpen && <BackgroundPicker bg={bg} userId={userId} onChange={onBgChange} onClose={() => setBgOpen(false)} />}
    <header className="pd-hdr" aria-label="Profile" style={headerBgStyle(bg)}>
      <SeasonHeaderDecor />
      <div style={{ position: 'relative', flex: 'none' }}>
        {person.avatar_url
          ? <img src={person.avatar_url} alt={person.full_name} style={{ width: 104, height: 104, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 3px rgba(255,255,255,.85)' }} />
          : <span aria-label={`${person.full_name} (no photo)`} style={{ width: 104, height: 104, borderRadius: '50%', background: 'rgba(255,255,255,.12)', fontSize: 36, fontWeight: 700, display: 'grid', placeItems: 'center', boxShadow: '0 0 0 3px rgba(255,255,255,.6)' }}>{initials}</span>}
        {isSelf && (
          <>
            <button onClick={() => person.avatar_url ? setPhotoMenu(v => !v) : fileRef.current?.click()} disabled={busy} aria-label={person.avatar_url ? 'Change profile photo' : 'Add profile photo'} title="Change profile photo"
              style={{ position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRadius: '50%', border: '2px solid #0E3A48', background: '#fff', color: '#0E3A48', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              {busy ? '…' : <Icon d={I.cam} size={16} />}
            </button>
            {photoMenu && (
              <div className="pd-menu" style={{ left: 70, right: 'auto', top: 104 }} onMouseLeave={() => setPhotoMenu(false)}>
                <button onClick={() => { setPhotoMenu(false); fileRef.current?.click() }}>Change photo</button>
                <button onClick={onRemove}>Remove photo</button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" aria-label="Choose a photo" onChange={onPick} style={{ display: 'none' }} />
          </>
        )}
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        {isSelf && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#BFEFE9' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E' }} />Online</div>}
        <h1 style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', color: '#fff', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          {person.full_name}{person.pronouns && <span style={{ fontSize: 14, fontWeight: 500, color: '#CFE7EA' }}>({person.pronouns})</span>}
        </h1>
        <div style={{ fontSize: 16, marginTop: 4, color: '#E6F4F6' }}>{person.job_title || <span style={{ color: '#9FBFC6' }}>No job title yet</span>}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 13.5, color: '#CFE7EA' }}>
          {(person.status_emoji || person.status_text) && <span>{person.status_emoji} {person.status_text}</span>}
          {isSelf && <button onClick={onEditProfile} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, color: '#9FF3F0', textDecoration: 'underline', textUnderlineOffset: 3 }}><Icon d={I.pen} size={14} />Edit profile</button>}
          {isSelf && <button onClick={() => setBgOpen(v => !v)} aria-label="Change header background" aria-expanded={bgOpen} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, color: '#9FF3F0', textDecoration: 'underline', textUnderlineOffset: 3 }}>🎨 Background</button>}
        </div>
        {err && <div role="alert" style={{ marginTop: 6, fontSize: 12.5, color: '#FCA5A5' }}>{err}</div>}
      </div>

      {weekStats && (
        <div aria-label="This week, Monday to Sunday" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9FD8D3', paddingLeft: 14 }}>This week · Mon–Sun</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canProjects && <a className="pd-stat" href="/time" title="Time tracked on tasks this week" aria-label={`${hrs(weekStats.task_minutes)} task hours this week`}>
              <b style={{ fontSize: 22, lineHeight: 1 }}>{hrs(weekStats.task_minutes)}</b><span style={{ fontSize: 12, color: '#CFE7EA' }}>Task hours</span>
            </a>}
            <a className="pd-stat" href="/schedule" title="Hours on your schedule this week" aria-label={`${hrs(weekStats.scheduled_minutes)} scheduled hours this week`}>
              <b style={{ fontSize: 22, lineHeight: 1 }}>{hrs(weekStats.scheduled_minutes)}</b><span style={{ fontSize: 12, color: '#CFE7EA' }}>Scheduled hrs</span>
            </a>
          </div>
        </div>
      )}

      {isSelf && canProjects && (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, paddingLeft: 18, borderLeft: '1px solid rgba(255,255,255,.18)' }}>
          <a className="pd-stat" href="/projects" aria-label={`${projectCount} projects. Open Project Management`}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(94,234,212,.14)', display: 'grid', placeItems: 'center', color: '#5EEAD4' }}><Icon d={I.folder} size={18} /></span>
            <b style={{ fontSize: 24, lineHeight: 1 }}>{projectCount}</b><span style={{ fontSize: 12, color: '#CFE7EA' }}>Projects</span>
          </a>
          <a className="pd-stat" href="/projects" aria-label={`${openTasks} open tasks. Open Project Management`}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(94,234,212,.14)', display: 'grid', placeItems: 'center', color: '#5EEAD4' }}><Icon d={I.check} size={18} /></span>
            <b style={{ fontSize: 24, lineHeight: 1 }}>{openTasks}</b><span style={{ fontSize: 12, color: '#CFE7EA' }}>Tasks</span>
          </a>
        </div>
      )}

      {isSelf && (
        <div className="pd-acts" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {acts.map(([k, label, d, n]) => (
            <button key={k} className="pd-act" onClick={() => onOpen(k)} aria-label={label + (n ? ` (${n})` : '')}>
              <Icon d={d} size={24} />{label}
              {n > 0 && <span className="pd-badge" aria-hidden="true">{n > 99 ? '99+' : n}</span>}
            </button>
          ))}
        </div>
      )}
    </header>
    </div>
  )
}

const hrs = (m) => { const h = (Number(m) || 0) / 60; return h % 1 === 0 ? String(h) : h.toFixed(1) }

// Background: an uploaded image (darkened so the white text stays readable) or a color.
// Light colors get a soft dark tint for the same reason. Nothing set = the default teal.
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function headerBgStyle(bg) {
  if (bg?.image) return { background: `linear-gradient(90deg, rgba(5,18,26,.78) 0%, rgba(5,18,26,.55) 55%, rgba(5,18,26,.45) 100%), url("${bg.image}") center / cover no-repeat` }
  if (bg?.color && /^#[0-9a-f]{6}$/i.test(bg.color)) {
    const a = Math.min(0.55, Math.max(0, (luminance(bg.color) - 0.18) * 0.9))
    return { background: `linear-gradient(rgba(0,0,0,${a.toFixed(2)}), rgba(0,0,0,${a.toFixed(2)})), linear-gradient(120deg, ${bg.color}, ${bg.color}dd)` }
  }
  return undefined
}
const BG_PRESETS = [
  ['Default teal', null], ['Navy', '#1E3A8A'], ['Ocean', '#0E7490'], ['Forest', '#166534'], ['Plum', '#6B21A8'],
  ['Berry', '#9D174D'], ['Sunset', '#C2410C'], ['Charcoal', '#1F2937'], ['Slate', '#475569'], ['Gold', '#A16207'],
]
async function shrinkImage(file, maxW = 2400) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url })
    const scale = Math.min(1, maxW / img.width)
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85))
  } finally { URL.revokeObjectURL(url) }
}
function BackgroundPicker({ bg, userId, onChange, onClose }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const boxRef = useRef(null)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    const out = (e) => { if (boxRef.current && !boxRef.current.contains(e.target) && !e.target.closest('[aria-label="Change header background"]')) onClose() }
    document.addEventListener('keydown', k); document.addEventListener('mousedown', out)
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', out) }
  }, [onClose])
  async function save(fields) {
    setBusy(true); setErr('')
    const { error } = await supabase.from('profiles').update(fields).eq('id', userId)
    setBusy(false)
    if (error) setErr(error.message); else onChange({ color: 'header_bg_color' in fields ? fields.header_bg_color : bg.color, image: 'header_bg_image' in fields ? fields.header_bg_image : bg.image })
  }
  async function onPick(e) {
    const file = e.target.files?.[0]; if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('Please choose an image file.')
    if (file.size > 15 * 1024 * 1024) return setErr('Please choose an image under 15 MB.')
    setBusy(true); setErr('')
    try {
      const blob = await shrinkImage(file)
      const path = `${userId}/header-${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const url = supabase.storage.from('avatars').getPublicUrl(path)?.data?.publicUrl
      await save({ header_bg_image: url })
    } catch (e2) { setBusy(false); setErr(e2?.message || 'Upload failed. Please try again.') }
  }
  const sw = (on) => ({ width: 34, height: 34, borderRadius: 9, cursor: 'pointer', border: on ? '2px solid var(--ink)' : '1px solid var(--line)', boxShadow: on ? '0 0 0 2px var(--surface) inset' : 'none', padding: 0 })
  return (
    <div ref={boxRef} role="dialog" aria-label="Header background" className="pd-card"
      style={{ position: 'absolute', top: 'calc(100% - 4px)', left: 'min(150px, 4vw)', zIndex: 40, width: 'min(320px, calc(100% - 24px))', color: 'var(--ink)', boxShadow: '0 18px 40px rgba(0,0,0,.28)' }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Header background</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6 }}>Color</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {BG_PRESETS.map(([name, c]) => (
          <button key={name} title={name} aria-label={name} disabled={busy} onClick={() => save({ header_bg_color: c, ...(c === null ? { header_bg_image: null } : {}) })}
            style={{ ...sw(!bg.image && (bg.color || null) === c), background: c || 'linear-gradient(120deg, #0B2533, #0F4C57)' }} />
        ))}
        <label title="Custom color" style={{ ...sw(false), position: 'relative', overflow: 'hidden', background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', display: 'block' }}>
          <input type="color" aria-label="Custom color" value={bg.color || '#0E3A48'} disabled={busy}
            onChange={e => save({ header_bg_color: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
        </label>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', margin: '14px 0 6px' }}>Image</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 12px' }} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Saving…' : bg.image ? 'Change image' : 'Upload image'}</button>
        {bg.image && <button className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 12px' }} disabled={busy} onClick={() => save({ header_bg_image: null })}>Remove image</button>}
        <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} aria-label="Choose a background image" />
      </div>
      <p className="page-sub" style={{ margin: '10px 0 0', fontSize: 12 }}>Images are darkened a little so your name stays easy to read. A wide photo (landscape) works best. An image shows instead of the color.</p>
      {err && <div role="alert" className="login-err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  )
}

// ============================================================
// DRAWER — slide-over panel (Escape / backdrop / ✕ closes)
// ============================================================
export function Drawer({ title, onClose, children, width = 1100, closeDelay = 0, footer, guardUnsaved = false }) {
  const dirty = useRef(false)
  const closeRef = useRef(null)
  const bodyRef = useRef(null)
  const [closing, setClosing] = useState(false)
  const close = useCallback(() => {
    // Forms that only save on a button click (Weekly Sync, EOD): don't lose typed text by accident.
    if (guardUnsaved && dirty.current && !window.confirm('You have changes that aren’t saved yet. Close anyway?')) return
    if (!closeDelay) return onClose()
    setClosing(true); setTimeout(onClose, closeDelay)        // lets autosaving editors finish
  }, [onClose, closeDelay, guardUnsaved])
  useEffect(() => {
    const prev = document.activeElement
    closeRef.current?.focus()
    // Escape closes the panel only when nothing is open on top of it (the embedded modules'
    // own pop-ups are full-screen fixed layers inside the panel, or .modal-back overlays).
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (bodyRef.current?.querySelector('[style*="position: fixed"]') || document.querySelector('.modal-back')) return
      close()
    }
    document.addEventListener('keydown', onKey)
    const ov = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ov; prev && prev.focus && prev.focus() }
  }, [close])
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(6,18,24,.45)', display: 'flex', justifyContent: 'flex-end' }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ width: width > 1400 ? '96vw' : `min(${width}px, 100%)`, maxWidth: '100%', height: '100%', background: 'var(--canvas, var(--surface))', boxShadow: '-12px 0 40px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>{title}</h2>
          {footer}
          {closing && <span className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>Saving…</span>}
          <button ref={closeRef} className="pd-iconbtn" onClick={close} aria-label={`Close ${title}`}><Icon d={I.x} /></button>
        </div>
        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 20 }}
          onInput={guardUnsaved ? () => { dirty.current = true } : undefined}
          onClickCapture={guardUnsaved ? (e) => { const b = e.target.closest('button'); if (b && /save|submit/i.test(b.textContent || '')) setTimeout(() => { dirty.current = false }, 0) } : undefined}>
          <Suspense fallback={<p className="page-sub">Loading…</p>}>{children}</Suspense>
        </div>
      </div>
    </div>
  )
}
export const CalendarPanel = (props) => <Calendar {...props} />
export const NotesPanel = () => <Notes />
export const UpdatesPanel = () => <Updates />
export const WeeklySyncPanel = () => <WeeklySync />
export const EodPanel = () => <EodReport />

// ============================================================
// REMINDERS
// ============================================================
export async function reminderBadgeCount() {
  const end = new Date(); end.setHours(23, 59, 59, 999)
  const { data: { user } = {} } = await supabase.auth.getUser()
  if (!user?.id) return 0
  const { count } = await supabase.from('personal_reminders').select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id).is('done_at', null).lte('remind_at', end.toISOString())
  return count || 0
}
const toLocalInput = (iso) => { const d = iso ? new Date(iso) : new Date(Date.now() + 3600e3); d.setSeconds(0, 0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
// Repeat choices (personal_reminders.repeat). Checking off a repeating reminder rolls it to the
// next time; an ignored one moves forward on its own ~1 hour after it's due.
const REPEATS = [['none', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday (Mon–Fri)'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']]
const repeatLabel = (r) => ({ daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' })[r] || ''
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function RemindersPanel() {
  const { user, isAdmin } = useAuth()
  const me = user?.id
  const [list, setList] = useState(null)
  const [names, setNames] = useState({})
  const [tab, setTab] = useState('upcoming')
  const [edit, setEdit] = useState(null)        // {} new, or a reminder
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('personal_reminders').select('*').order('remind_at')
    if (error) { setErr(error.message); return }
    setList(data || [])
    const ids = [...new Set((data || []).flatMap(r => [r.owner_id, r.created_by]).filter(x => x && x !== me))]
    if (ids.length) { const { data: p } = await supabase.from('profiles').select('id, full_name').in('id', ids); const m = {}; (p || []).forEach(x => { m[x.id] = x.full_name }); setNames(m) }
  }, [me])
  useEffect(() => { load() }, [load])
  const now = Date.now()
  const groups = useMemo(() => {
    const L = list || []
    const mine = L.filter(r => r.owner_id === me)
    return {
      upcoming: mine.filter(r => !r.done_at && new Date(r.remind_at).getTime() >= now),
      overdue: mine.filter(r => !r.done_at && new Date(r.remind_at).getTime() < now),
      completed: mine.filter(r => r.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at)),
      others: L.filter(r => r.owner_id !== me && r.created_by === me),
    }
  }, [list, now, me])
  async function toggle(r) {
    const { data, error } = await supabase.from('personal_reminders').update({ done_at: r.done_at ? null : new Date().toISOString() }).eq('id', r.id).select('remind_at, done_at').maybeSingle()
    if (error) return setErr(error.message)
    if (!r.done_at) celebrate()
    if (!r.done_at && r.repeat && r.repeat !== 'none' && data && !data.done_at) setErr('')
    load()
  }
  async function del(r) {
    const forWho = r.owner_id !== me ? ` for ${names[r.owner_id] || 'them'}` : ''
    if (!window.confirm(`Delete the reminder "${r.title}"${forWho}? This can't be undone.`)) return
    const { error } = await supabase.from('personal_reminders').delete().eq('id', r.id)
    if (error) setErr(error.message); else load()
  }
  const tabs = [['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['completed', 'Completed']].concat(isAdmin || groups.others.length ? [['others', 'Set for others']] : [])
  const rows = groups[tab] || []
  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="pd-tabs" role="tablist" aria-label="Reminders">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l} <span style={{ opacity: .7 }}>{list ? groups[k].length : ''}</span></button>
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEdit({})}>+ Add reminder</button>
      </div>
      <p className="page-sub" style={{ margin: '0 0 12px', fontSize: 12.5 }}>
        {tab === 'others' ? 'Reminders you set for teammates. They see them in their own Reminders and can check them off; only you can change or delete them.'
          : 'Private to you. You’ll get a notification 30 minutes and 10 minutes before each reminder (in Command Center and as a push alert if you have them on). Times are in your computer’s time zone.'}
      </p>
      {err && <div className="login-err" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
      {edit && <ReminderForm r={edit} me={me} isAdmin={isAdmin} onCancel={() => setEdit(null)} onSaved={(forOther) => { setEdit(null); if (forOther) setTab('others'); load() }} />}
      {!list ? <p className="page-sub">Loading…</p> : rows.length === 0 ? (
        <div className="pd-card" style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>
          {tab === 'upcoming' ? 'No upcoming reminders. Add one to stay on top of things.' : tab === 'overdue' ? 'Nothing overdue. 🎉' : tab === 'others' ? 'You haven’t set any reminders for teammates.' : 'No completed reminders yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const over = !r.done_at && new Date(r.remind_at).getTime() < now
            const setByAdmin = r.owner_id === me && r.created_by && r.created_by !== me
            const forOther = r.owner_id !== me
            const canChange = !setByAdmin
            return (
              <div key={r.id} className="pd-card" style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {forOther
                  ? <span title={r.done_at ? 'Completed' : 'Not done yet'} style={{ width: 18, height: 18, marginTop: 2, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 12, background: r.done_at ? 'var(--passed, #16A34A)' : 'transparent', border: r.done_at ? 0 : '1.5px solid var(--line)', color: '#fff', flex: 'none' }}>{r.done_at ? '✓' : ''}</span>
                  : <input type="checkbox" checked={!!r.done_at} onChange={() => toggle(r)} aria-label={r.done_at ? `Mark "${r.title}" not done` : `Mark "${r.title}" done`} style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--accent)' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, textDecoration: r.done_at ? 'line-through' : 'none', color: r.done_at ? 'var(--ink-soft)' : 'var(--ink)', overflowWrap: 'anywhere' }}>{r.title}</span>
                    {setByAdmin && <span className="badge" style={{ fontSize: 11 }}>Set by {names[r.created_by] || 'an admin'}</span>}
                    {forOther && <span className="badge" style={{ fontSize: 11 }}>For {names[r.owner_id] || 'a teammate'}{r.done_at ? ' · done' : ''}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 2, color: over ? 'var(--failed, #DC2626)' : 'var(--ink-soft)', fontWeight: over ? 600 : 400 }}>
                    {over ? 'Overdue · ' : ''}{r.repeat && r.repeat !== 'none' && !r.done_at ? 'Next: ' : ''}{fmtWhen(r.remind_at)}
                    {r.repeat && r.repeat !== 'none' && <span style={{ marginLeft: 8, fontWeight: 600, color: 'var(--accent)' }}>🔁 {repeatLabel(r.repeat)}{r.repeat_until ? ` until ${new Date(r.repeat_until + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>}
                    {r.last_done_at && !r.done_at && <span style={{ marginLeft: 8 }}>· last done {new Date(r.last_done_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                  </div>
                  {r.notes && <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.notes}</div>}
                </div>
                {canChange && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '4px 10px' }} onClick={() => setEdit(r)}>Edit</button>}
                {canChange && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '4px 10px', color: 'var(--failed, #DC2626)' }} onClick={() => del(r)}>Delete</button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
function ReminderForm({ r, me, isAdmin, onCancel, onSaved }) {
  const [title, setTitle] = useState(r.title || '')
  const [when, setWhen] = useState(toLocalInput(r.remind_at))
  const [notes, setNotes] = useState(r.notes || '')
  const [repeat, setRepeat] = useState(r.repeat || 'none')
  const [until, setUntil] = useState(r.repeat_until || '')
  const [owner, setOwner] = useState(r.owner_id || me)
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!isAdmin || r.id) return
    supabase.from('profiles').select('id, full_name').eq('is_active', true).is('client_id', null).order('full_name')
      .then(({ data }) => setPeople((data || []).filter(p => p.id !== me && !/\btest$/i.test((p.full_name || '').trim()))))
  }, [isAdmin, r.id, me])
  async function save() {
    if (!title.trim()) return setErr('Add a title.')
    if (!when) return setErr('Pick a date and time.')
    setBusy(true); setErr('')
    if (repeat !== 'none' && until && until < when.slice(0, 10)) { setBusy(false); return setErr('“Until” must be on or after the first reminder.') }
    const row = { title: title.trim(), notes: notes.trim() || null, remind_at: new Date(when).toISOString(), repeat, repeat_until: repeat !== 'none' && until ? until : null }
    const q = r.id ? supabase.from('personal_reminders').update(row).eq('id', r.id) : supabase.from('personal_reminders').insert({ ...row, owner_id: owner })
    const { error } = await q
    setBusy(false)
    if (error) setErr(error.message); else onSaved(!r.id && owner !== me)
  }
  return (
    <div className="pd-card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{r.id ? 'Edit reminder' : 'New reminder'}</div>
      {isAdmin && !r.id && (
        <div className="field"><label htmlFor="rm-o">For</label>
          <select id="rm-o" value={owner} onChange={e => setOwner(e.target.value)}>
            <option value={me}>Me</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          {owner !== me && <div className="hint" style={{ marginTop: 4 }}>They’ll get a notification and see it in their Reminders. They can check it off; only you can change or delete it.</div>}
        </div>
      )}
      <div className="field"><label htmlFor="rm-t">Title</label><input id="rm-t" autoFocus maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Send the weekly report" /></div>
      <div className="field"><label htmlFor="rm-w">Date and time</label><input id="rm-w" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="rm-r">Repeat</label>
          <select id="rm-r" value={repeat} onChange={e => setRepeat(e.target.value)}>{REPEATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {repeat !== 'none' && <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="rm-u">Until (optional)</label>
          <input id="rm-u" type="date" value={until} onChange={e => setUntil(e.target.value)} /></div>}
      </div>
      {repeat !== 'none' && <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>Check it off and it jumps to the next time. If you don’t, it moves forward on its own about an hour after it’s due — you’ll get the 30- and 10-minute warnings every time.</div>}
      <div className="field"><label htmlFor="rm-n">Details (optional)</label><textarea id="rm-n" maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      {err && <div className="login-err" role="alert" style={{ marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : owner !== me && !r.id ? 'Set reminder' : 'Save reminder'}</button>
      </div>
    </div>
  )
}

// ============================================================
// MY WEEK — shifts only
// ============================================================
function mergeDay(blocks) {
  const list = blocks.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)))
  const out = []
  for (const b of list) {
    const last = out[out.length - 1]
    if (last && String(b.start).slice(0, 5) <= String(last.end).slice(0, 5)) { if (String(b.end) > String(last.end)) last.end = b.end; last.roles.add(b.role) }
    else out.push({ start: b.start, end: b.end, roles: new Set([b.role]), noShow: b.status === 'no_show' })
  }
  return out
}
export function MyWeek({ profileId, isSelf, firstName, tz }) {
  const [week, setWeek] = useState(() => mondayOf(todayET()))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true; setData(null); setErr('')
    supabase.rpc('profile_week_shifts', { p_profile: profileId || null, p_week_start: week })
      .then(({ data: d, error }) => { if (!alive) return; if (error) setErr(error.message); else setData(d) })
    return () => { alive = false }
  }, [profileId, week])
  const today = todayET()
  const vtz = viewerTZ(tz)
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(week, i))
  const byDay = {}; (data?.shifts || []).forEach(s => { (byDay[s.date] = byDay[s.date] || []).push(s) })
  const shown = days.filter((d, i) => i < 5 || byDay[d])       // weekends only when there's a shift
  const label = `${dayLabel(week, { month: 'short', day: 'numeric' })} – ${dayLabel(addDaysStr(week, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`
  const navBtn = { all: 'unset', cursor: 'pointer', width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 8 }
  return (
    <section className="pd-card" aria-label={isSelf ? 'My week' : `${firstName}'s week`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ color: 'var(--ink)' }}><Icon d={I.cal} size={22} /></span>
        <div style={{ flex: 1, minWidth: 160 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isSelf ? 'My Week' : `${firstName}'s Week`}</h2>
          <div className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>Scheduled shifts for the week</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid var(--line)', borderRadius: 10, padding: '2px 4px' }}>
          <button style={navBtn} onClick={() => setWeek(addDaysStr(week, -7))} aria-label="Previous week"><Icon d={I.left} size={18} /></button>
          <span style={{ fontSize: 13, fontWeight: 600, padding: '0 6px', whiteSpace: 'nowrap' }}>{label}</span>
          <button style={navBtn} onClick={() => setWeek(addDaysStr(week, 7))} aria-label="Next week"><Icon d={I.right} size={18} /></button>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 14px' }} onClick={() => setWeek(mondayOf(todayET()))} disabled={week === mondayOf(today)}>Today</button>
      </div>
      {err ? <div className="login-err" role="alert">{err}</div> : !data ? <p className="page-sub" style={{ margin: 0 }}>Loading shifts…</p> : (
        <div className="pd-days">
          {shown.map(ds => {
            const shifts = mergeDay(byDay[ds] || [])
            const isToday = ds === today
            const mins = shifts.reduce((t, s) => t + (zonedInstant(ds, s.end) - zonedInstant(ds, s.start)) / 60000, 0)
            return (
              <div key={ds} className={'pd-day' + (isToday ? ' today' : '')} aria-current={isToday ? 'date' : undefined}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--ink)' }}>{dayLabel(ds, { weekday: 'short' })}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{dayLabel(ds, { month: 'short', day: 'numeric' })}</div>
                  </div>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 4, background: isToday ? 'var(--accent)' : 'var(--line)' }} aria-hidden="true" />
                </div>
                {shifts.length === 0 ? <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-soft)' }}>Not scheduled</div>
                  : shifts.map((s, i) => (
                    <div key={i} className="pd-shift" title={[...s.roles].filter(Boolean).join(', ')}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtRange(zonedInstant(ds, s.start), zonedInstant(ds, s.end), vtz)}</div>
                      {s.noShow && <span className="badge failed" style={{ fontSize: 11 }}>No-show</span>}
                    </div>
                  ))}
                {mins > 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>{Math.round(mins / 6) / 10} hrs</div>}
              </div>
            )
          })}
        </div>
      )}
      {isSelf && <div style={{ marginTop: 12 }}><a href="/schedule" style={{ fontSize: 13, fontWeight: 600 }}>Open Schedule →</a></div>}
    </section>
  )
}

// ============================================================
// MY MEETINGS — from the existing calendar sources
// ============================================================
const URL_RX = /https?:\/\/[^\s<>"']+/i
function platformOf(url) {
  if (!url) return null
  if (/zoom\.us/i.test(url)) return { name: 'Zoom', color: '#2D8CFF' }
  if (/meet\.google\.com/i.test(url)) return { name: 'Google Meet', color: '#16A34A' }
  if (/teams\.(microsoft|live)\.com/i.test(url)) return { name: 'Teams', color: '#6264A7' }
  if (/webex\.com/i.test(url)) return { name: 'Webex', color: '#0F766E' }
  return { name: 'Online meeting', color: '#3B82F6' }
}
async function loadMeetings(userId, days = 30) {
  const from = todayET(), to = addDaysStr(from, days)
  const [cc, gc, co] = await Promise.all([
    supabase.from('calendar_events').select('id, owner_id, title, event_date, start_time, end_time, all_day, tz, notes, invitee_ids, guest_emails, meeting_url, google_event_id, scope')
      .gte('event_date', from).lte('event_date', to).or(`owner_id.eq.${userId},invitee_ids.cs.{${userId}}`),
    supabase.from('google_calendar_events').select('id, google_id, title, event_date, start_time, end_time, all_day, description, location, hangout_link, html_link, attendees, organizer_email, calendar_name')
      .eq('owner_id', userId).gte('event_date', from).lte('event_date', to),
    supabase.from('coaching_sessions').select('id, kind, asc_id, agent_id, applicant_name, session_date, start_time, end_time, status, topic, meeting_url')
      .eq('status', 'booked').gte('session_date', from).lte('session_date', to).or(`asc_id.eq.${userId},agent_id.eq.${userId}`),
  ])
  const err = cc.error || gc.error || co.error
  const ids = new Set(); (cc.data || []).forEach(e => (e.invitee_ids || []).concat(e.owner_id).forEach(x => x && ids.add(x)))
  ;(co.data || []).forEach(s => { s.asc_id && ids.add(s.asc_id); s.agent_id && ids.add(s.agent_id) })
  let names = {}
  if (ids.size) { const { data } = await supabase.from('profiles').select('id, full_name').in('id', [...ids]); (data || []).forEach(p => { names[p.id] = p.full_name }) }
  const items = []
  const ccGoogleIds = new Set((cc.data || []).map(e => e.google_event_id).filter(Boolean))
  ;(cc.data || []).filter(e => !e.all_day && e.start_time).forEach(e => {
    const tz = e.tz || COMPANY_TZ
    const people = (e.invitee_ids || []).filter(x => x !== userId).map(x => names[x]).filter(Boolean)
    if (e.owner_id !== userId && names[e.owner_id]) people.unshift(names[e.owner_id])
    items.push({ key: 'c' + e.id, source: 'cc', id: e.id, title: e.title || '(No title)', start: zonedInstant(e.event_date, e.start_time, tz), end: zonedInstant(e.event_date, e.end_time || e.start_time, tz),
      url: e.meeting_url || (String(e.notes || '').match(URL_RX) || [])[0] || null, people, guests: (e.guest_emails || []).length, canEdit: e.owner_id === userId, notes: e.notes })
  })
  const seen = new Set()
  ;(gc.data || []).filter(g => !g.all_day && g.start_time && !ccGoogleIds.has(g.google_id)).forEach(g => {
    const k = `${g.title}|${g.event_date}|${g.start_time}`; if (seen.has(k)) return; seen.add(k)
    const att = Array.isArray(g.attendees) ? g.attendees : []
    items.push({ key: 'g' + g.id, source: 'google', id: g.id, title: g.title || '(No title)', start: zonedInstant(g.event_date, g.start_time), end: zonedInstant(g.event_date, g.end_time || g.start_time),
      url: g.hangout_link || (String(g.location || '').match(URL_RX) || [])[0] || (String(g.description || '').match(URL_RX) || [])[0] || null,
      people: att.map(a => a.displayName || a.email).filter(Boolean).slice(0, 6), organizer: g.organizer_email, htmlLink: g.html_link, notes: g.description, calendarName: g.calendar_name })
  })
  ;(co.data || []).forEach(s => {
    const other = s.asc_id === userId ? (names[s.agent_id] || s.applicant_name) : names[s.asc_id]
    items.push({ key: 's' + s.id, source: 'coaching', id: s.id, title: s.topic || (s.kind === 'mock' ? 'Mock call' : 'Coaching session'), start: zonedInstant(s.session_date, s.start_time), end: zonedInstant(s.session_date, s.end_time || s.start_time),
      url: s.meeting_url || null, people: other ? [other] : [] })
  })
  const now = Date.now()
  return { error: err, items: items.filter(m => m.end.getTime() > now).sort((a, b) => a.start - b.start) }
}

function MeetingCard({ m, tz, onEdit, onDetails, compact }) {
  const [menu, setMenu] = useState(false)
  const now = Date.now(), live = m.start.getTime() <= now && m.end.getTime() > now
  const isToday = ymdIn(m.start, tz) === ymdIn(new Date(), tz)
  const plat = platformOf(m.url)
  return (
    <div className={'pd-meet' + (live ? ' now' : '')} style={{ '--m': plat?.color || (m.source === 'coaching' ? '#E0662A' : '#94A3B8') }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, minWidth: 0 }}>
          <div style={{ color: live ? '#16A34A' : isToday ? 'var(--accent)' : 'var(--ink-soft)' }}>{live ? '● Happening now' : isToday ? 'Today' : m.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })}</div>
          <div style={{ whiteSpace: 'nowrap' }}>{fmtRange(m.start, m.end, tz)}</div>
        </div>
        <button className="pd-iconbtn" onClick={() => setMenu(v => !v)} aria-label={`Actions for ${m.title}`} aria-expanded={menu}><Icon d={I.dots} size={18} /></button>
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compact ? 'nowrap' : 'normal' }} title={m.title}>{m.title}</div>
      {m.people.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}><Icon d={I.users} size={14} />{m.people.slice(0, 2).join(', ')}{m.people.length > 2 ? ` +${m.people.length - 2}` : ''}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {plat && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-soft)' }}><Icon d={I.video} size={14} color={plat.color} />{plat.name}</span>}
        {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}>Join</a>}
      </div>
      {menu && (
        <div className="pd-menu" onMouseLeave={() => setMenu(false)} role="menu">
          <button role="menuitem" onClick={() => { setMenu(false); onDetails(m) }}>View details</button>
          {m.url && <a role="menuitem" href={m.url} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>Join meeting</a>}
          {m.source === 'cc' && m.canEdit && <button role="menuitem" onClick={() => { setMenu(false); onEdit(m.id) }}>Edit or cancel meeting</button>}
          {m.source === 'google' && m.htmlLink && <a role="menuitem" href={m.htmlLink} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>Edit in Google Calendar</a>}
        </div>
      )}
    </div>
  )
}

function MeetingDetails({ m, tz, onClose, onEdit }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }; document.addEventListener('keydown', k, true); return () => document.removeEventListener('keydown', k, true) }, [onClose])
  const plat = platformOf(m.url)
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={m.title} className="pd-card" style={{ width: 'min(480px, 100%)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 17, flex: 1 }}>{m.title}</h3>
          <button className="pd-iconbtn" onClick={onClose} aria-label="Close" autoFocus><Icon d={I.x} /></button>
        </div>
        <div style={{ fontSize: 13.5, marginTop: 8 }}>{m.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })} · {fmtRange(m.start, m.end, tz)}</div>
        <div className="page-sub" style={{ margin: '4px 0 0', fontSize: 12.5 }}>{m.source === 'google' ? `From Google Calendar${m.calendarName ? ` · ${m.calendarName}` : ''}` : m.source === 'coaching' ? 'Coaching session' : 'Command Center calendar'}</div>
        {m.organizer && <div style={{ fontSize: 13, marginTop: 10 }}><b>Organizer:</b> {m.organizer}</div>}
        {m.people.length > 0 && <div style={{ fontSize: 13, marginTop: 8 }}><b>Participants:</b> {m.people.join(', ')}{m.guests ? ` +${m.guests} guest${m.guests === 1 ? '' : 's'}` : ''}</div>}
        {plat && <div style={{ fontSize: 13, marginTop: 8 }}><b>Platform:</b> {plat.name}</div>}
        {m.notes && <div style={{ fontSize: 13, marginTop: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflowY: 'auto', background: 'var(--canvas)', borderRadius: 8, padding: 10 }}>{String(m.notes).replace(/<[^>]+>/g, ' ')}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ textDecoration: 'none' }}>Join meeting</a>}
          {m.source === 'cc' && m.canEdit && <button className="btn btn-ghost" onClick={() => { onClose(); onEdit(m.id) }}>Edit or cancel</button>}
          {m.source === 'google' && m.htmlLink && <a href={m.htmlLink} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ textDecoration: 'none' }}>Open in Google Calendar</a>}
        </div>
        {m.source === 'google' && <p className="page-sub" style={{ margin: '10px 0 0', fontSize: 12 }}>Google events are edited in Google Calendar; changes sync back here.</p>}
      </div>
    </div>
  )
}

export function MyMeetings({ userId, tz, onOpenCalendar, refreshKey }) {
  const [res, setRes] = useState(null)
  const [all, setAll] = useState(false)
  const [details, setDetails] = useState(null)
  const [addMenu, setAddMenu] = useState(false)
  const vtz = viewerTZ(tz)
  useEffect(() => { if (!userId) return; let alive = true; loadMeetings(userId).then(r => { if (alive) setRes(r) }); return () => { alive = false } }, [userId, refreshKey])
  const items = res?.items || []
  const edit = (id) => onOpenCalendar({ openEventId: id })
  return (
    <section className="pd-card" aria-label="My meetings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ color: 'var(--accent)' }}><Icon d={I.cal} size={22} /></span>
        <div style={{ flex: 1, minWidth: 160 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>My Meetings</h2>
          <div className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>Your upcoming meetings and appointments</div>
        </div>
        <div style={{ position: 'relative', display: 'flex' }}>
          <button className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 12px', borderTopRightRadius: 0, borderBottomRightRadius: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={() => onOpenCalendar({ startNew: true })}><Icon d={I.plus} size={16} />Add Meeting</button>
          <button className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 8px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 0 }} onClick={() => setAddMenu(v => !v)} aria-label="More meeting options" aria-expanded={addMenu}><Icon d={I.chev} size={16} /></button>
          {addMenu && (
            <div className="pd-menu" onMouseLeave={() => setAddMenu(false)} role="menu">
              <button role="menuitem" onClick={() => { setAddMenu(false); onOpenCalendar({ startNew: true }) }}>New meeting or event</button>
              <button role="menuitem" onClick={() => { setAddMenu(false); onOpenCalendar({}) }}>Open my calendar</button>
              <a role="menuitem" href="/calendar">Go to the Calendar page</a>
            </div>
          )}
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 12px', border: 0, color: 'var(--accent)', fontWeight: 600 }} onClick={() => setAll(true)}>View All</button>
      </div>
      {!res ? <p className="page-sub" style={{ margin: 0 }}>Loading meetings…</p>
        : res.error ? <div className="login-err" role="alert">Couldn't load meetings: {res.error.message}</div>
        : items.length === 0 ? <div style={{ textAlign: 'center', padding: '14px 0', color: 'var(--ink-soft)', fontSize: 13.5 }}>No upcoming meetings in the next 30 days.</div>
        : <div className="pd-meets">{items.slice(0, 4).map(m => <MeetingCard key={m.key} m={m} tz={vtz} compact onEdit={edit} onDetails={setDetails} />)}</div>}
      {details && <MeetingDetails m={details} tz={vtz} onClose={() => setDetails(null)} onEdit={edit} />}
      {all && (
        <Drawer title="All meetings · next 30 days" width={760} onClose={() => setAll(false)}
          footer={<button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => { setAll(false); onOpenCalendar({ startNew: true }) }}>+ Add Meeting</button>}>
          {items.length === 0 ? <p className="page-sub">No upcoming meetings.</p> : (() => {
            const groups = {}; items.forEach(m => { const d = ymdIn(m.start, vtz); (groups[d] = groups[d] || []).push(m) })
            return Object.keys(groups).map(d => (
              <div key={d} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)', marginBottom: 8 }}>
                  {d === ymdIn(new Date(), vtz) ? 'Today' : dayLabel(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
                <div className="pd-meets" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>{groups[d].map(m => <MeetingCard key={m.key} m={m} tz={vtz} onEdit={(id) => { setAll(false); edit(id) }} onDetails={setDetails} />)}</div>
              </div>
            ))
          })()}
        </Drawer>
      )}
    </section>
  )
}

// ============================================================
// COLLAPSIBLE SECTION — remembers open/closed per device
// ============================================================
export function openSection(id) { window.dispatchEvent(new CustomEvent('pd:open-section', { detail: id })) }
export function Section({ id, icon, iconColor, title, summary, children, defaultOpen = false }) {
  const key = 'cc.profile.sec.' + id
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen } })
  const set = (v) => { setOpen(v); try { localStorage.setItem(key, v ? '1' : '0') } catch { /* ignore */ } }
  const ref = useRef(null)
  useEffect(() => {
    const on = (e) => { if (e.detail === id) { set(true); setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60) } }
    window.addEventListener('pd:open-section', on); return () => window.removeEventListener('pd:open-section', on)
  }, [id]) // eslint-disable-line
  const bodyId = 'pd-sec-' + id
  const bodyRef = useRef(null)
  useEffect(() => { const el = bodyRef.current; if (!el) return; if (open) el.removeAttribute('inert'); else el.setAttribute('inert', '') }, [open])
  return (
    <section ref={ref} className="pd-card" style={{ padding: 0, scrollMarginTop: 80 }}>
      <button className="pd-sec-h" onClick={() => set(!open)} aria-expanded={open} aria-controls={bodyId}>
        <span style={{ width: 28, display: 'grid', placeItems: 'center', fontSize: 22, color: iconColor }} aria-hidden="true">{icon}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
        {summary != null && <span style={{ marginLeft: 'auto', fontSize: 13.5, color: 'var(--ink-soft)', textAlign: 'right' }}>{summary}</span>}
        <span className={'pd-chev' + (open ? ' open' : '')} style={summary == null ? { marginLeft: 'auto' } : null}><Icon d={I.chev} size={20} sw={2.2} /></span>
      </button>
      <div id={bodyId} ref={bodyRef} className={'pd-sec-body' + (open ? ' open' : '')} aria-hidden={!open}>
        <div><div style={{ padding: '0 20px 18px' }}>{children}</div></div>
      </div>
    </section>
  )
}
