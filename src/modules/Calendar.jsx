import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { COMPANY_TZ, companyTimeToInstant, formatInTZ, detectedTZ, wallTimeToViewerHHMM } from '../lib/tz'
// Convert a wall-clock time stored in `srcTZ` on `dateStr` into "HH:MM" as seen
// in `viewerTZ` (robust/browser-safe, from tz.js).
function toViewerHHMM(dateStr, timeStr, srcTZ, viewerTZ) {
  if (!timeStr || !dateStr) return timeStr
  if (!viewerTZ || viewerTZ === (srcTZ || COMPANY_TZ)) return timeStr
  return wallTimeToViewerHHMM(dateStr, timeStr, srcTZ || COMPANY_TZ, viewerTZ)
}
// ============================================================
// CALENDAR — Phase 1 (Artful Agenda-style planner)
// Two-page "book" spread with Month / Week / Day views.
// Sources: manual events (calendar_events), Command Center tasks
// (by due_date, split into Priority / Other), and claimed intervals.
// Times are Eastern, matching the rest of the app.
//
// Requires table calendar_events:
//   id uuid pk default gen_random_uuid()
//   owner_id uuid references profiles(id)
//   scope text check (scope in ('personal','team')) default 'personal'
//   title text not null
//   event_date date not null
//   start_time time, end_time time, all_day boolean default false
//   notes text, color text
//   created_at timestamptz default now()
// Plus a customizable day-tracker table day_trackers:
//   id uuid pk, owner_id uuid, tracker_date date, label text, body text
// ============================================================
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// series_id is a uuid column, so the fallback has to be a real UUID — not the
// Date.now()+random string used elsewhere in the app for text ids. crypto.randomUUID
// is missing in non-secure contexts and older Safari; getRandomValues is not.
function newUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
function mondayOf(d) { const x = new Date(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1 - day); x.setDate(x.getDate() + diff); x.setHours(0, 0, 0, 0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'p' : 'a'; const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}
function parseHour(t) { return t ? parseInt(t.slice(0, 2), 10) : null }
// Minutes since midnight from an "HH:MM" / "HH:MM:SS" string. Minute-precision is
// what makes a 9:30 event land on the half-hour and a 10a-12p event render two
// hours tall instead of one generic hour-sized chip.
function minsOf(t) {
  if (!t) return null
  const [h, m] = String(t).split(':').map(Number)
  if (!Number.isFinite(h)) return null
  return h * 60 + (Number.isFinite(m) ? m : 0)
}
// Lay timed items into side-by-side columns so overlaps are visible instead of
// silently stacking on top of each other. Standard interval-graph sweep: build
// clusters of mutually-overlapping items, then pack each cluster into the fewest
// columns. Returns [{ i, s, e, col, cols, overlapped }].
const MIN_EVENT_MINS = 20 // floor so zero/short/missing-end events stay clickable
function layoutTimed(items) {
  const rows = items
    .map(i => {
      const s = minsOf(i.start)
      if (s === null) return null
      let e = minsOf(i.end)
      if (e === null || e <= s) e = s + MIN_EVENT_MINS
      return { i, s, e: Math.max(e, s + MIN_EVENT_MINS) }
    })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s || b.e - a.e)
  const out = []
  let group = []
  let groupEnd = -1
  const flush = () => {
    if (!group.length) return
    const colEnds = [] // colEnds[k] = end minute of the last item placed in column k
    for (const r of group) {
      let k = 0
      while (k < colEnds.length && colEnds[k] > r.s) k++
      colEnds[k] = r.e
      r.col = k
    }
    const cols = colEnds.length
    for (const r of group) out.push({ ...r, cols, overlapped: cols > 1 })
    group = []
    groupEnd = -1
  }
  for (const r of rows) {
    if (group.length && r.s >= groupEnd) flush()
    group.push(r)
    groupEnd = Math.max(groupEnd, r.e)
  }
  flush()
  return out
}
// Minutes since midnight in the viewer's own zone — the day grid renders viewer
// local wall time, so the "now" line has to be measured the same way.
function localNowMins() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }
// Command Center accent palette (from the app's design tokens)
const COLORS = {
  event: 'var(--accent, #0077B6)',
  eventBg: 'var(--accent, #0077B6)',
  interval: '#16A34A',
  priority: '#B91C1C',
  team: '#7C3AED',
}
// Personal colors (🎨 Colors, saved on profiles.calendar_colors) — 2026-10-27, Brittney.
// Kinds a person can recolor, with the built-in defaults.
const CAL_COLOR_KINDS = [
  ['event', 'My events', '#0077B6'],
  ['team', 'Team events', '#7C3AED'],
  ['coaching', 'Coaching sessions', '#DB2777'],
  ['mock', 'Mock calls', '#7C3AED'],
  ['birthday', 'Birthdays (Team calendar)', '#EC4899'],
  ['anniversary', 'Work anniversaries (Team calendar)', '#D97706'],
]
const CAL_SWATCHES = ['#0077B6', '#0891B2', '#14B8A6', '#16A34A', '#65A30D', '#D97706', '#EA580C', '#DC2626', '#DB2777', '#9333EA', '#7C3AED', '#4F46E5', '#475569', '#94A3B8']
let CAL_STYLE = 'solid'   // set by <Calendar> each render; read by the views when drawing blocks
// 🌈 'rainbow' can be picked as a color for any kind.
const RAINBOW = 'rainbow'
const RAINBOW_GRAD = 'linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899)'
const RAINBOW_SOFT = 'linear-gradient(90deg, #fee2e2, #ffedd5, #fef9c3, #dcfce7, #cffafe, #dbeafe, #ede9fe, #fce7f3)'
// Anything that paints a background (blocks, dots, swatches) can use this.
const paint = (color) => color === RAINBOW ? RAINBOW_GRAD : color
// For text drawn in the item's color (Month view times): rainbow becomes gradient text.
function textColor(color) {
  if (color === RAINBOW) return { backgroundImage: RAINBOW_GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontWeight: 600 }
  return { color }
}
// Solid = filled block with white text. Soft = light tint, colored left edge, dark text.
function blockStyle(color) {
  if (color === RAINBOW) return CAL_STYLE === 'soft'
    ? { background: RAINBOW_SOFT, color: '#3b2a5a', borderLeft: '3px solid #8b5cf6' }
    : { background: RAINBOW_GRAD, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.45)' }
  if (CAL_STYLE === 'soft') return {
    background: `color-mix(in srgb, ${color} 18%, var(--cal-paper, #fff))`,
    color: `color-mix(in srgb, ${color} 70%, #111)`,
    borderLeft: `3px solid ${color}`,
  }
  return { background: color, color: '#fff' }
}
// 🎨 Colors — pick a color per kind of calendar item, and Solid vs Soft blocks.
function CalendarColors({ value, onChange, onClose }) {
  const v = value || {}
  const soft = v.style === 'soft'
  const set = (k, c) => onChange({ ...v, [k]: c })
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  const styleBtn = (key, label) => (
    <button onClick={() => onChange({ ...v, style: key })}
      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        border: '1.5px solid ' + ((v.style || 'solid') === key ? 'var(--accent)' : 'var(--line)'),
        background: (v.style || 'solid') === key ? 'var(--accent-bg)' : 'transparent', color: 'var(--ink)' }}>{label}</button>
  )
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div role="dialog" aria-label="Calendar colors" className="card" style={{ width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 17, flex: 1 }}>🎨 Calendar colors</h3>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="page-sub" style={{ margin: '0 0 14px', fontSize: 12.5 }}>Only changes how your calendar looks to you. Events you colored one by one keep their color. Google and subscribed calendars are colored under Connected calendars.</p>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6 }}>Block style</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {styleBtn('solid', 'Solid blocks')}{styleBtn('soft', 'Soft (light tint)')}
        </div>
        {CAL_COLOR_KINDS.map(([k, label, def]) => {
          const cur = v[k] || def
          const prev = cur === RAINBOW
            ? (soft ? { background: RAINBOW_SOFT, color: '#3b2a5a', borderLeft: '3px solid #8b5cf6' } : { background: RAINBOW_GRAD, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.45)' })
            : soft
              ? { background: `color-mix(in srgb, ${cur} 18%, #fff)`, color: `color-mix(in srgb, ${cur} 70%, #111)`, borderLeft: `3px solid ${cur}` }
              : { background: cur, color: '#fff' }
          return (
            <div key={k} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{label}</span>
                <span style={{ ...prev, fontSize: 11, padding: '3px 10px', borderRadius: 4 }}>8a–4p · Preview</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {CAL_SWATCHES.map(c => {
                  const on = cur.toLowerCase() === c.toLowerCase()
                  return <button key={c} onClick={() => set(k, c)} aria-label={`${label}: ${c}`} title={c}
                    style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                      border: on ? '2px solid var(--ink)' : '2px solid transparent', boxShadow: on ? '0 0 0 2px var(--surface) inset' : 'none' }} />
                })}
                <button onClick={() => set(k, RAINBOW)} aria-label={`${label}: rainbow`} title="🌈 Rainbow"
                  style={{ width: 24, height: 24, borderRadius: '50%', background: RAINBOW_GRAD, cursor: 'pointer', padding: 0,
                    border: cur === RAINBOW ? '2px solid var(--ink)' : '2px solid transparent', boxShadow: cur === RAINBOW ? '0 0 0 2px var(--surface) inset' : 'none' }} />
                <label title="Pick any color" style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', position: 'relative', cursor: 'pointer', border: '1.5px dashed var(--ink-soft)', display: 'grid', placeItems: 'center', color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1 }}>
                  ＋
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(cur) ? cur : def} onChange={e => set(k, e.target.value)} aria-label={`${label}: custom color`}
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                </label>
                {v[k] && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '2px 8px', marginLeft: 4 }} onClick={() => { const n = { ...v }; delete n[k]; onChange(n) }}>Reset</button>}
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => onChange({})}>Reset all to defaults</button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

// Optional props (used by My Profile's calendar panel; the /calendar page passes none):
//   openEventId — open this Command Center event's editor once loaded
//   startNew    — open the "new event" editor once loaded
//   onChanged   — called after an event is saved or deleted
export default function Calendar({ openEventId = null, startNew = false, onChanged } = {}) {
  const { isAdmin } = useAuth()
  const [view, setView] = useState('day')             // month | week | day (default to Day)
  const [cursor, setCursor] = useState(etNow())      // anchor date
  const [userId, setUserId] = useState(null)
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [assignees, setAssignees] = useState([])
  const [claims, setClaims] = useState([])
  const [blocks, setBlocks] = useState([])
  const [coaching, setCoaching] = useState([])   // coaching sessions the viewer is on — CC-only, never Google
  const [profiles, setProfiles] = useState([])       // name lookup for historical rows — NOT a picker
  const [invitable, setInvitable] = useState([])     // staff-only picker list (people_assignable view)
  const [loading, setLoading] = useState(true)
  const [editEvent, setEditEvent] = useState(null)   // event obj or {} for new
  const [detailItem, setDetailItem] = useState(null) // item to show read-only detail
  const [subs, setSubs] = useState([])
  const [feedEvents, setFeedEvents] = useState([])
  const [showSubs, setShowSubs] = useState(false)
  const [showColors, setShowColors] = useState(false)
  // My calendar vs 🎉 Team calendar (team events + birthdays + work anniversaries, same for everyone)
  const [calMode, setCalMode] = useState(() => { try { return localStorage.getItem('cc.cal.mode') === 'team' ? 'team' : 'mine' } catch { return 'mine' } })
  const [teamPeople, setTeamPeople] = useState(null)
  useEffect(() => { try { localStorage.setItem('cc.cal.mode', calMode) } catch { /* ignore */ } }, [calMode])
  useEffect(() => {
    if (calMode !== 'team' || teamPeople) return
    supabase.rpc('team_calendar_people').then(({ data }) => setTeamPeople(data || []))
  }, [calMode, teamPeople])
  const [calColors, setCalColors] = useState({})
  CAL_STYLE = calColors.style === 'soft' ? 'soft' : 'solid'
  useEffect(() => {
    if (!userId) return
    supabase.from('profiles').select('calendar_colors').eq('id', userId).maybeSingle()
      .then(({ data }) => { if (data?.calendar_colors) setCalColors(data.calendar_colors) })
  }, [userId])
  const saveCalColors = useCallback(async (next) => {
    setCalColors(next)
    if (userId) await supabase.from('profiles').update({ calendar_colors: next }).eq('id', userId)
  }, [userId])
  const [gcalConn, setGcalConn] = useState(null)
  const [gcalAccounts, setGcalAccounts] = useState([])
  const [gcalEvents, setGcalEvents] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [sharedWithMe, setSharedWithMe] = useState([])   // shares where I'm the viewer
  const [mySharedOut, setMySharedOut] = useState([])     // shares I've granted
  // Shared calendars start hidden; you pick whose to view (search box above the calendar).
  const [hiddenShares, setHiddenShares] = useState({})   // ownerId -> true while NOT being viewed (kept for the Shares modal)
  const [viewShares, setViewShares] = useState({})       // ownerId -> true while being viewed
  const [shareQ, setShareQ] = useState('')
  const [showShares, setShowShares] = useState(false)
  const [viewerTZ, setViewerTZ] = useState(COMPANY_TZ)
  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const uid = user?.id || null
    setUserId(uid)
    // viewer's timezone (for converting shift/event times to their local clock)
    if (uid) {
      const { data: prof } = await supabase.from('profiles').select('timezone').eq('id', uid).maybeSingle()
      setViewerTZ(prof?.timezone || COMPANY_TZ)
    }
    // Speed (2026-10-26): load only what this calendar shows — my tasks, my running timer,
    // and intervals for me + people who share their calendar with me — instead of every
    // task, assignment, interval and time entry in the company (~22k rows for admins).
    const chunked = async (ids, size, fn) => {
      const out = []
      for (let i = 0; i < ids.length; i += size) { const { data } = await fn(ids.slice(i, i + size)); if (data) out.push(...data) }
      return { data: out }
    }
    const shareInPre = uid ? await supabase.from('calendar_shares').select('*').eq('viewer_id', uid) : { data: [] }
    const intervalPeople = [uid, ...(shareInPre.data || []).map(sh => sh.owner_id)].filter(Boolean)
    const [evRes, taRes, clmRes, profRes, invRes, subRes, feedRes, gtRes, geRes, timeRes, shareOutRes, coachRes] = await Promise.all([
      supabase.from('calendar_events').select('*'),
      uid ? fetchAllRows(() => supabase.from('task_assignees').select('task_id, profile_id').eq('profile_id', uid).order('id')) : { data: [] },
      intervalPeople.length ? fetchAllRows(() => supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at').in('profile_id', intervalPeople).order('id')) : { data: [] },
      supabase.from('profiles').select('id, full_name'),
      // Invitee picker: active staff only — agents, clients and deactivated accounts are
      // excluded by the view (2026-09-02, Becky). `profiles` above stays unfiltered so
      // existing invitees who have since left still render by name.
      supabase.from('people_assignable').select('id, full_name'),
      supabase.from('calendar_subscriptions').select('*'),
      supabase.from('calendar_feed_events').select('*'),
      supabase.from('calendar_accounts').select('id, provider, account_email, color, is_default, target_calendar_name, last_synced_at, last_error, sync_enabled, connected_at').eq('provider', 'google'),
      fetchAllRows(() => supabase.from('google_calendar_events').select('*').order('id')),
      // only the timer that's running right now matters here (start/stop + "running" badge)
      uid ? supabase.from('time_entries').select('id, task_id, user_id, started_at, ended_at, duration_minutes').eq('user_id', uid).is('ended_at', null) : { data: [] },
      supabase.from('calendar_shares').select('*').eq('owner_id', uid),
      // Only sessions the viewer is actually on (as coach/ASC or as agent). Admins can read every
      // session via RLS, so without this filter every mock call / coaching session in the company
      // would land on an admin's personal calendar.
      supabase.from('coaching_sessions').select('id, kind, asc_id, agent_id, applicant_name, session_date, start_time, end_time, status, topic, meeting_url').eq('status', 'booked').or(`asc_id.eq.${uid},agent_id.eq.${uid}`),
    ])
    const myTaskIdList = [...new Set((taRes.data || []).map(a => a.task_id))]
    const blockIdList = [...new Set((clmRes.data || []).map(c => c.shift_block_id).filter(Boolean))]
    const [taskRes, blkRes] = await Promise.all([
      chunked(myTaskIdList, 200, (ids) => supabase.from('tasks').select('id, name, due_date, priority, status, project_id').is('deleted_at', null).in('id', ids)),
      chunked(blockIdList, 300, (ids) => supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role').in('id', ids)),
    ])
    const shareInRes = shareInPre
    setEvents(evRes.data || [])
    setTasks(taskRes.data || [])
    setAssignees(taRes.data || [])
    setClaims(clmRes.data || [])
    setBlocks(blkRes.data || [])
    setProfiles(profRes.data || [])
    setInvitable((invRes.data || []).filter(p => !/\btest$/i.test((p.full_name || '').trim())))
    setSubs(subRes.data || [])
    setFeedEvents(feedRes.data || [])
    // Multi-account Google: gtRes is now a list of connected google accounts.
    const gAccts = gtRes.data || []
    setGcalAccounts(gAccts)
    const defAcct = gAccts.find(a => a.is_default) || gAccts[0] || null
    // Keep gcalConn in the legacy shape so push-gating / color display keep working.
    setGcalConn(defAcct ? { google_email: defAcct.account_email, connected_at: defAcct.connected_at, color: defAcct.color } : null)
    setGcalEvents(geRes.data || [])
    setTimeEntries(timeRes.data || [])
    setSharedWithMe(shareInRes.data || [])
    setMySharedOut(shareOutRes.data || [])
    setCoaching(coachRes.data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  // --- task actions from the calendar (mirror the project tool) ---
  const runningEntry = timeEntries.find(e => e.user_id === userId && e.started_at && !e.ended_at)
  async function toggleTaskDone(task) {
    const next = task.status === 'done' ? 'todo' : 'done'
    await supabase.from('tasks').update({ status: next }).eq('id', task.id)
    load()
  }
  async function toggleTaskTimer(task) {
    const mine = timeEntries.find(e => e.task_id === task.id && e.user_id === userId && e.started_at && !e.ended_at)
    if (mine) {
      // stop
      const endedAt = new Date()
      const mins = Math.max(1, Math.round((endedAt - new Date(mine.started_at)) / 60000))
      await supabase.from('time_entries').update({ ended_at: endedAt.toISOString(), duration_minutes: mins }).eq('id', mine.id)
    } else {
      // stop any other running timer first (one at a time), then start
      if (runningEntry) {
        const endedAt = new Date()
        const mins = Math.max(1, Math.round((endedAt - new Date(runningEntry.started_at)) / 60000))
        await supabase.from('time_entries').update({ ended_at: endedAt.toISOString(), duration_minutes: mins }).eq('id', runningEntry.id)
      }
      await supabase.from('time_entries').insert({ task_id: task.id, user_id: userId, started_at: new Date().toISOString(), is_manual: false })
    }
    load()
  }
  // After Google OAuth redirects back (?gcal=connected), sync once and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('gcal') === 'connected') {
      supabase.functions.invoke('google-calendar-sync', { body: {} }).finally(() => {
        window.history.replaceState({}, '', window.location.pathname)
        load()
      })
    }
  }, [load])
  // ---- visibility: events (personal to me OR team), tasks (mine or admin), intervals (mine) ----
  const myEvents = useMemo(() => events.filter(e => e.scope === 'team' || e.owner_id === userId || (e.invitee_ids || []).includes(userId)), [events, userId])
  const myTaskIds = useMemo(() => new Set(assignees.filter(a => a.profile_id === userId).map(a => a.task_id)), [assignees, userId])
  // Personal calendar: always only the current user's own tasks, even for admins.
  const myTasks = useMemo(() => tasks.filter(t => myTaskIds.has(t.id)), [tasks, myTaskIds])
  const myClaims = useMemo(() => claims.filter(c => c.profile_id === userId), [claims, userId])
  // items on a given ISO date
  const itemsOn = useCallback((ds) => {
    const evs = myEvents.filter(e => e.event_date === ds).map(e => ({
      kind: 'event', id: e.id, title: e.title, allDay: e.all_day,
      start: e.all_day ? e.start_time : toViewerHHMM(e.event_date, e.start_time, e.tz || COMPANY_TZ, viewerTZ),
      end: e.all_day ? e.end_time : toViewerHHMM(e.event_date, e.end_time, e.tz || COMPANY_TZ, viewerTZ),
      color: e.color || (e.scope === 'team' ? (calColors.team || COLORS.team) : (calColors.event || COLORS.event)), scope: e.scope, raw: e,
    }))
    const ivs = myClaims.map(c => ({ c, b: blocks.find(b => b.id === c.shift_block_id) }))
      .filter(x => x.b && x.b.block_date === ds)
      .map(({ c, b }) => ({
        kind: 'interval', id: c.id, title: `${b.role || 'Interval'}`, allDay: false,
        start: toViewerHHMM(b.block_date, b.start_time, COMPANY_TZ, viewerTZ),
        end: toViewerHHMM(b.block_date, b.end_time, COMPANY_TZ, viewerTZ),
        color: calColors.interval || COLORS.interval,
      }))
    const feeds = feedEvents.filter(f => f.event_date === ds).map(f => {
      const sub = subs.find(s => s.id === f.subscription_id)
      return {
        kind: 'feed', id: f.id, title: f.title, allDay: f.all_day,
        start: f.start_time, end: f.end_time, color: sub?.color || COLORS.team,
      }
    })
    // A Command Center event is also pushed to Google, so the same meeting comes back in the
    // Google sync. Skip the Google copy of anything already on the calendar. (2026-10-27)
    const idsOf = (list) => new Set(list.map(e => e.google_event_id).filter(Boolean))
    const myCcIds = idsOf(myEvents), allCcIds = idsOf(events)
    const copyOf = (ids) => (g) => ids.has(g.google_id) || (g.ical_uid && ids.has(String(g.ical_uid).replace(/@google\.com$/i, '')))
    const isMyCcCopy = copyOf(myCcIds), isCcCopy = copyOf(allCcIds)
    const gcal = gcalEvents.filter(g => g.event_date === ds && (!g.owner_id || g.owner_id === userId) && !isMyCcCopy(g)).map(g => ({
      kind: 'gcal', id: g.id, title: g.title, allDay: g.all_day,
      // Stored in company time (sync v5) — show in the viewer's zone like everything else.
      start: g.all_day ? g.start_time : toViewerHHMM(g.event_date, g.start_time, COMPANY_TZ, viewerTZ),
      end: g.all_day ? g.end_time : toViewerHHMM(g.event_date, g.end_time, COMPANY_TZ, viewerTZ),
      color: gcalConn?.color || '#EA4335', calendarName: g.calendar_name,
      description: g.description, location: g.location, hangoutLink: g.hangout_link, htmlLink: g.html_link,
    }))
    // Shared calendars: other people's manual events + intervals + Google events,
    // when they've shared with me and I haven't toggled them off.
    const shareByOwner = {}; sharedWithMe.forEach(s => { shareByOwner[s.owner_id] = s })
    const activeShareOwners = new Set(sharedWithMe.filter(s => viewShares[s.owner_id]).map(s => s.owner_id))
    const nameOf = (pid) => (profiles.find(p => p.id === pid) || {}).full_name || 'Someone'
    const sharedEvs = events
      .filter(e => e.event_date === ds && e.owner_id && activeShareOwners.has(e.owner_id) && e.owner_id !== userId)
      .map(e => ({
        kind: 'shared', id: 'se-' + e.id, title: `${e.title} · ${nameOf(e.owner_id)}`, allDay: e.all_day,
        start: e.all_day ? e.start_time : toViewerHHMM(e.event_date, e.start_time, e.tz || COMPANY_TZ, viewerTZ),
        end: e.all_day ? e.end_time : toViewerHHMM(e.event_date, e.end_time, e.tz || COMPANY_TZ, viewerTZ),
        color: shareByOwner[e.owner_id]?.color || '#0891B2',
        description: e.notes, sharedFrom: nameOf(e.owner_id),
      }))
    const sharedGcal = gcalEvents
      .filter(g => g.event_date === ds && g.owner_id && activeShareOwners.has(g.owner_id) && g.owner_id !== userId && !isCcCopy(g))
      .map(g => ({
        kind: 'shared', id: 'sg-' + g.id, title: `${g.title} · ${nameOf(g.owner_id)}`, allDay: g.all_day,
        start: g.all_day ? g.start_time : toViewerHHMM(g.event_date, g.start_time, COMPANY_TZ, viewerTZ),
        end: g.all_day ? g.end_time : toViewerHHMM(g.event_date, g.end_time, COMPANY_TZ, viewerTZ),
        color: shareByOwner[g.owner_id]?.color || '#0891B2',
        description: g.description, location: g.location, hangoutLink: g.hangout_link, htmlLink: g.html_link,
        sharedFrom: nameOf(g.owner_id),
      }))
    const sharedIvs = claims
      .filter(c => c.profile_id && activeShareOwners.has(c.profile_id) && c.profile_id !== userId)
      .map(c => ({ c, b: blocks.find(b => b.id === c.shift_block_id) }))
      .filter(x => x.b && x.b.block_date === ds)
      .map(({ c, b }) => ({
        kind: 'shared', id: 'si-' + c.id, title: `${nameOf(c.profile_id)} working`, allDay: false,
        start: toViewerHHMM(b.block_date, b.start_time, COMPANY_TZ, viewerTZ),
        end: toViewerHHMM(b.block_date, b.end_time, COMPANY_TZ, viewerTZ),
        color: shareByOwner[c.profile_id]?.color || '#0891B2',
      }))
    const coachIvs = coaching.filter(s => s.session_date === ds).map(s => {
      const isMock = s.kind === 'mock_call'
      const title = isMock
        ? (s.agent_id === userId ? `🎧 Mock call with ${nameOf(s.asc_id)}` : `🎧 Mock call: ${s.applicant_name || 'candidate'}`)
        : (s.agent_id === userId ? `🎯 Coaching with ${nameOf(s.asc_id)}` : `🎯 Coaching: ${nameOf(s.agent_id)}`)
      return {
        kind: 'coaching', id: 'co-' + s.id, title, allDay: false,
        start: toViewerHHMM(s.session_date, s.start_time, COMPANY_TZ, viewerTZ),
        end: toViewerHHMM(s.session_date, s.end_time, COMPANY_TZ, viewerTZ),
        color: isMock ? (calColors.mock || '#7C3AED') : (calColors.coaching || '#DB2777'), hangoutLink: s.meeting_url || undefined,
      }
    })
    const order = (a, b) => {
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      return (a.start || '').localeCompare(b.start || '')
    }
    if (calMode === 'team') {
      // Team calendar: the same for everyone — team events, birthdays, work anniversaries.
      const [y, mo, d] = ds.split('-').map(Number)
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
      const people = teamPeople || []
      const bdays = people.filter(p => p.birthday_month === mo && (p.birthday_day === d || (!leap && mo === 2 && d === 28 && p.birthday_day === 29)))
        .map(p => ({ kind: 'birthday', id: 'bd-' + p.profile_id, title: `🎂 ${p.full_name}'s birthday`, allDay: true, color: calColors.birthday || '#EC4899' }))
      const annis = people.filter(p => p.start_date && +p.start_date.slice(5, 7) === mo && +p.start_date.slice(8, 10) === d && +p.start_date.slice(0, 4) < y)
        .map(p => { const n = y - +p.start_date.slice(0, 4); return { kind: 'anniversary', id: 'an-' + p.profile_id, title: `🎉 ${p.full_name} · ${n} year${n === 1 ? '' : 's'} at Opsis`, allDay: true, color: calColors.anniversary || '#D97706' } })
      return [...bdays, ...annis, ...evs.filter(e => e.scope === 'team')].sort(order)
    }
    // Intervals (shifts) are kept off the calendar (2026-10-27) — they live in Schedule and My Week.
    void ivs; void sharedIvs
    return [...evs, ...feeds, ...gcal, ...sharedEvs, ...sharedGcal, ...coachIvs].sort(order)
  }, [myEvents, myClaims, blocks, feedEvents, subs, gcalEvents, gcalConn, events, claims, coaching, sharedWithMe, viewShares, profiles, userId, viewerTZ, calColors, calMode, teamPeople])
  const tasksOn = useCallback((ds) => {
    const due = myTasks.filter(t => t.due_date === ds)
    return {
      priority: due.filter(t => t.priority === 'high'),
      other: due.filter(t => t.priority !== 'high'),
    }
  }, [myTasks])
  const openedRef = useRef(false)
  useEffect(() => {
    if (loading || openedRef.current) return
    openedRef.current = true
    if (openEventId) { const ev = events.find(e => e.id === openEventId); if (ev) setEditEvent(ev) }
    else if (startNew) setEditEvent({ event_date: isoDate(etNow()) })
  }, [loading, openEventId, startNew, events])
  if (loading) return <div className="page-sub" style={{ padding: 30 }}>Loading calendar…</div>
  const shared = { cursor, setCursor, itemsOn, tasksOn, userId, allTasks: myTasks, onAddEvent: (d) => setEditEvent({ event_date: isoDate(d || cursor), ...(calMode === 'team' && isAdmin ? { scope: 'team' } : {}) }), onEditEvent: setEditEvent, onShowDetail: setDetailItem, onToggleTaskDone: toggleTaskDone, onToggleTaskTimer: toggleTaskTimer, runningEntry, timeEntries }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="Which calendar" style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: 3, marginRight: 'auto' }}>
          {[['mine', '📅 My calendar'], ['team', '🎉 Team calendar']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={calMode === k} onClick={() => setCalMode(k)}
              style={{ border: 0, borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: calMode === k ? 'var(--accent)' : 'transparent', color: calMode === k ? '#fff' : 'var(--ink)' }}>{l}</button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => setShowColors(true)} style={{ fontSize: 13 }}>🎨 Colors</button>
        <button className="btn btn-ghost" onClick={() => setShowShares(true)} style={{ fontSize: 13 }}>👥 Shared calendars</button>
        <button className="btn btn-ghost" onClick={() => setShowSubs(true)} style={{ fontSize: 13 }}>⚙ Connected calendars</button>
      </div>
      {calMode === 'mine' && (() => {
        const nm = (pid) => (profiles.find(p => p.id === pid) || {}).full_name || 'Someone'
        const viewing = sharedWithMe.filter(s => viewShares[s.owner_id])
        const t = shareQ.trim().toLowerCase()
        const hits = t ? sharedWithMe.filter(s => !viewShares[s.owner_id] && nm(s.owner_id).toLowerCase().includes(t)).slice(0, 8) : []
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ position: 'relative' }}>
              <input value={shareQ} onChange={e => setShareQ(e.target.value)} aria-label="Search people's calendars"
                placeholder={sharedWithMe.length ? "🔍 Search people's calendars…" : '🔍 No calendars shared with you yet'} disabled={!sharedWithMe.length}
                style={{ width: 280, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }} />
              {t && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 280, zIndex: 40, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,.14)', padding: 4 }}>
                  {hits.length ? hits.map(s => (
                    <button key={s.owner_id} onClick={() => { setViewShares(v => ({ ...v, [s.owner_id]: true })); setShareQ('') }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '7px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color || '#0891B2' }} />{nm(s.owner_id)}
                    </button>
                  )) : <div className="page-sub" style={{ fontSize: 12.5, padding: '7px 10px' }}>No match. Only people who’ve shared their calendar with you show up here.</div>}
                </div>
              )}
            </div>
            {viewing.map(s => (
              <span key={s.owner_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                background: `color-mix(in srgb, ${s.color || '#0891B2'} 14%, var(--surface))`, border: `1px solid ${s.color || '#0891B2'}` }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color || '#0891B2' }} />{nm(s.owner_id)}
                <button onClick={() => setViewShares(v => { const n = { ...v }; delete n[s.owner_id]; return n })} aria-label={`Stop viewing ${nm(s.owner_id)}`}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 12, padding: '0 4px' }}>✕</button>
              </span>
            ))}
            {viewing.length > 1 && <button className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => setViewShares({})}>Clear all</button>}
          </div>
        )
      })()}
      <BookFrame view={view} setView={setView}>
        {view === 'month' && <MonthView {...shared} />}
        {view === 'week' && <WeekView {...shared} />}
        {view === 'day' && <DayView {...shared} />}
      </BookFrame>
      {showShares && (
        <SharesModal userId={userId} profiles={profiles} invitable={invitable} sharedWithMe={sharedWithMe} mySharedOut={mySharedOut}
          hiddenShares={Object.fromEntries(sharedWithMe.map(s => [s.owner_id, !viewShares[s.owner_id]]))}
          setHiddenShares={(fn) => { const cur = Object.fromEntries(sharedWithMe.map(s => [s.owner_id, !viewShares[s.owner_id]])); const next = typeof fn === 'function' ? fn(cur) : fn; setViewShares(Object.fromEntries(Object.entries(next).filter(([, hid]) => !hid).map(([k]) => [k, true]))) }}
          onClose={() => setShowShares(false)} onChanged={() => load()} />
      )}
      {showColors && <CalendarColors value={calColors} onChange={saveCalColors} onClose={() => setShowColors(false)} />}
      {showSubs && (
        <SubscriptionsModal subs={subs} userId={userId} gcalConn={gcalConn} setGcalConn={setGcalConn} gcalAccounts={gcalAccounts} setSubs={setSubs}
          onClose={() => setShowSubs(false)}
          onChanged={() => load()} />
      )}
      {detailItem && <EventDetailModal item={detailItem} onClose={() => setDetailItem(null)}
        onEdit={(raw) => { setDetailItem(null); setEditEvent(raw) }} />}
      {editEvent && (
        <EventModal event={editEvent} userId={userId} isAdmin={isAdmin} gcalConn={gcalConn} profiles={profiles} invitable={invitable}
          onClose={() => setEditEvent(null)}
          onSaved={() => { setEditEvent(null); load(); onChanged && onChanged() }} />
      )}
    </div>
  )
}
// ---------- BOOK FRAME (leather cover + tabs) ----------
function BookFrame({ view, setView, children }) {
  const narrow = useNarrow(700)
  const tabs = ['month', 'week', 'day']
  // On phones the vertical "spine" tabs + big leather margins waste the little
  // width there is. Switch to a compact horizontal tab bar above the page.
  if (narrow) {
    return (
      <div style={{ background: '#4a6178', borderRadius: 12, padding: 8 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, position: 'sticky', top: 60, zIndex: 5, background: '#4a6178', paddingBottom: 4 }}>
          {tabs.map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{
                flex: 1, border: 'none', cursor: 'pointer', borderRadius: 8,
                background: view === v ? 'var(--cal-paper)' : 'var(--cal-panel)', color: 'var(--cal-ink)',
                padding: '10px 6px', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600,
              }}>{v}</button>
          ))}
        </div>
        <div style={{ background: 'var(--cal-paper)', borderRadius: 8, overflow: 'hidden' }}>{children}</div>
      </div>
    )
  }
  return (
    <div style={{ background: '#4a6178', borderRadius: 16, padding: 18, boxShadow: 'inset 0 0 40px rgba(0,0,0,.22)', position: 'relative' }}>
      <div style={{ display: 'flex', background: 'var(--cal-paper)', borderRadius: 8, overflow: 'hidden', minHeight: 560 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '30px 0', background: '#4a6178' }}>
          {tabs.map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{
                writingMode: 'vertical-rl', textOrientation: 'mixed', border: 'none', cursor: 'pointer',
                background: view === v ? 'var(--cal-paper)' : 'var(--cal-panel)', color: 'var(--cal-ink)',
                padding: '14px 6px', borderRadius: '0 6px 6px 0', fontSize: 12, letterSpacing: 2,
                textTransform: 'uppercase', fontWeight: 600,
              }}>{v}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
// ---------- shared left-rail (mini month + quote) ----------
// A large curated library so the calendar shows a genuinely fresh quote each
// day. quoteFor() advances by exactly one entry per calendar day and cycles
// through the whole list before repeating — deterministic, so everyone sees the
// same quote on a given date, with no network call.
const QUOTES = [
  ["Success is no accident. It is hard work, perseverance, learning, studying, sacrifice, and most of all, loving what you are doing.", "Pelé"],
  ["Discipline is deciding between what you want now and what you want most.", "Abraham Lincoln"],
  ["If you are working on something exciting that you really care about, you don't have to be pushed. The vision pulls you.", "Steve Jobs"],
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["Quality means doing it right when no one is looking.", "Henry Ford"],
  ["It always seems impossible until it's done.", "Nelson Mandela"],
  ["Well done is better than well said.", "Benjamin Franklin"],
  ["The way to get started is to quit talking and begin doing.", "Walt Disney"],
  ["Whether you think you can or you think you can't, you're right.", "Henry Ford"],
  ["Great things are done by a series of small things brought together.", "Vincent van Gogh"],
  ["Do the hard jobs first. The easy jobs will take care of themselves.", "Dale Carnegie"],
  ["You don't have to be great to start, but you have to start to be great.", "Zig Ziglar"],
  ["Success usually comes to those who are too busy to be looking for it.", "Henry David Thoreau"],
  ["The future depends on what you do today.", "Mahatma Gandhi"],
  ["Amateurs sit and wait for inspiration; the rest of us just get up and go to work.", "Stephen King"],
  ["Motivation is what gets you started. Habit is what keeps you going.", "Jim Ryun"],
  ["Don't watch the clock; do what it does. Keep going.", "Sam Levenson"],
  ["Either you run the day or the day runs you.", "Jim Rohn"],
  ["Opportunities don't happen. You create them.", "Chris Grosser"],
  ["The only way to do great work is to love what you do.", "Steve Jobs"],
  ["Perseverance is not a long race; it is many short races one after the other.", "Walter Elliot"],
  ["Focus on being productive instead of busy.", "Tim Ferriss"],
  ["A goal without a plan is just a wish.", "Antoine de Saint-Exupéry"],
  ["What gets measured gets managed.", "Peter Drucker"],
  ["The best way to predict the future is to create it.", "Peter Drucker"],
  ["Excellence is not a skill. It's an attitude.", "Ralph Marston"],
  ["Start where you are. Use what you have. Do what you can.", "Arthur Ashe"],
  ["It's not that I'm so smart, it's just that I stay with problems longer.", "Albert Einstein"],
  ["Setting goals is the first step in turning the invisible into the visible.", "Tony Robbins"],
  ["Action is the foundational key to all success.", "Pablo Picasso"],
  ["The difference between ordinary and extraordinary is that little extra.", "Jimmy Johnson"],
  ["Hard work beats talent when talent doesn't work hard.", "Tim Notke"],
  ["Done is better than perfect.", "Sheryl Sandberg"],
  ["If you want to lift yourself up, lift up someone else.", "Booker T. Washington"],
  ["Nothing will work unless you do.", "Maya Angelou"],
  ["Believe you can and you're halfway there.", "Theodore Roosevelt"],
  ["Efficiency is doing things right; effectiveness is doing the right things.", "Peter Drucker"],
  ["We are what we repeatedly do. Excellence, then, is not an act, but a habit.", "Will Durant"],
  ["A year from now you may wish you had started today.", "Karen Lamb"],
  ["The expert in anything was once a beginner.", "Helen Hayes"],
  ["Small daily improvements over time lead to stunning results.", "Robin Sharma"],
  ["You miss 100% of the shots you don't take.", "Wayne Gretzky"],
  ["Courage is one step ahead of fear.", "Coleman Young"],
  ["Success is the sum of small efforts repeated day in and day out.", "Robert Collier"],
  ["The harder you work for something, the greater you'll feel when you achieve it.", "Anonymous"],
  ["Don't be afraid to give up the good to go for the great.", "John D. Rockefeller"],
  ["I never dreamed about success. I worked for it.", "Estée Lauder"],
  ["Do what you can, with what you have, where you are.", "Theodore Roosevelt"],
  ["Great teams do not hold back with one another.", "Patrick Lencioni"],
  ["Alone we can do so little; together we can do so much.", "Helen Keller"],
  ["Coming together is a beginning, staying together is progress, working together is success.", "Henry Ford"],
  ["Feedback is the breakfast of champions.", "Ken Blanchard"],
  ["The strength of the team is each individual member. The strength of each member is the team.", "Phil Jackson"],
  ["If everyone is moving forward together, then success takes care of itself.", "Henry Ford"],
  ["Talent wins games, but teamwork and intelligence win championships.", "Michael Jordan"],
  ["People who feel appreciated will always do more than what is expected.", "Anonymous"],
  ["Progress is impossible without change.", "George Bernard Shaw"],
  ["The best preparation for tomorrow is doing your best today.", "H. Jackson Brown Jr."],
  ["Consistency is the true foundation of trust.", "Roy T. Bennett"],
  ["Clarity precedes success.", "Robin Sharma"],
  ["Details create the big picture.", "Sanford I. Weill"],
  ["Take care of the minutes and the hours will take care of themselves.", "Lord Chesterfield"],
  ["Ideas are easy. Implementation is hard.", "Guy Kawasaki"],
  ["Simplicity is the soul of efficiency.", "Austin Freeman"],
  ["The way to achieve your own success is to be willing to help somebody else get it first.", "Iyanla Vanzant"],
  ["Make each day your masterpiece.", "John Wooden"],
  ["Success is walking from failure to failure with no loss of enthusiasm.", "Winston Churchill"],
  ["The only place where success comes before work is in the dictionary.", "Vidal Sassoon"],
  ["Winners are not people who never fail, but people who never quit.", "Anonymous"],
  ["The road to success is always under construction.", "Lily Tomlin"],
  ["Be so good they can't ignore you.", "Steve Martin"],
  ["Push yourself, because no one else is going to do it for you.", "Anonymous"],
  ["Sometimes later becomes never. Do it now.", "Anonymous"],
  ["Great things never come from comfort zones.", "Anonymous"],
  ["Little things make big days.", "Anonymous"],
  ["Don't stop when you're tired. Stop when you're done.", "Anonymous"],
  ["Wake up with determination. Go to bed with satisfaction.", "Anonymous"],
  ["Do something today that your future self will thank you for.", "Sean Patrick Flanery"],
  ["Learn as if you will live forever, live like you will die tomorrow.", "Mahatma Gandhi"],
  ["Strive for progress, not perfection.", "Anonymous"],
  ["The comeback is always stronger than the setback.", "Anonymous"],
  ["A little progress each day adds up to big results.", "Anonymous"],
  ["Work hard in silence, let your success be your noise.", "Frank Ocean"],
  ["The key is not to prioritize what's on your schedule, but to schedule your priorities.", "Stephen Covey"],
  ["You don't need to see the whole staircase, just take the first step.", "Martin Luther King Jr."],
  ["Everything you've ever wanted is on the other side of fear.", "George Addair"],
  ["Success is liking yourself, liking what you do, and liking how you do it.", "Maya Angelou"],
  ["Don't count the days, make the days count.", "Muhammad Ali"],
  ["Fall seven times, stand up eight.", "Japanese Proverb"],
  ["The secret of change is to focus all of your energy not on fighting the old, but on building the new.", "Socrates"],
  ["Quality is not an act, it is a habit.", "Aristotle"],
  ["What we fear doing most is usually what we most need to do.", "Tim Ferriss"],
  ["Do the best you can until you know better. Then when you know better, do better.", "Maya Angelou"],
  ["If it doesn't challenge you, it won't change you.", "Fred DeVito"],
  ["The only limit to our realization of tomorrow is our doubts of today.", "Franklin D. Roosevelt"],
  ["Success is not final, failure is not fatal: it is the courage to continue that counts.", "Winston Churchill"],
  ["You are never too old to set another goal or to dream a new dream.", "C.S. Lewis"],
  ["Well begun is half done.", "Aristotle"],
  ["The man who moves a mountain begins by carrying away small stones.", "Confucius"],
  ["It does not matter how slowly you go as long as you do not stop.", "Confucius"],
  ["Success seems to be connected with action. Successful people keep moving.", "Conrad Hilton"],
  ["Trust the process. Your time is coming.", "Anonymous"],
  ["Energy and persistence conquer all things.", "Benjamin Franklin"],
  ["Discipline equals freedom.", "Jocko Willink"],
]
export function quoteFor(d) {
  const dayNum = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
  return QUOTES[((dayNum % QUOTES.length) + QUOTES.length) % QUOTES.length]
}
function LeftRail({ cursor, setCursor, onAddEvent, tasksOn, allTasks = [] }) {
  const today = etNow()
  const ds = isoDate(today)
  const { priority, other } = tasksOn(ds)
  const dueTasks = [...priority, ...other]
  // Past due = my unfinished tasks whose due date is before today.
  const pastDue = (allTasks || [])
    .filter(t => t.status !== 'done' && t.due_date && t.due_date < ds)
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const fmtDue = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return d } }
  // Task line that WRAPS (no truncation) so the text is always readable.
  const TaskRow = ({ t, overdue }) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '6px 0', fontSize: 12.5, lineHeight: 1.35 }}>
      <span style={{ width: 13, height: 13, marginTop: 2, borderRadius: '50%', border: '1.5px solid ' + (overdue ? '#DC2626' : (t.priority === 'high' ? COLORS.priority : 'var(--cal-line)')), flexShrink: 0 }} />
      <span style={{ minWidth: 0, color: overdue ? '#DC2626' : 'var(--cal-ink)', fontWeight: overdue ? 600 : 400 }}>
        {t.name}{overdue && <span style={{ color: '#DC2626', fontWeight: 400 }}> · due {fmtDue(t.due_date)}</span>}
      </span>
    </div>
  )
  return (
    <div style={{ width: 220, flexShrink: 0, padding: '20px 18px', borderRight: '1px solid var(--cal-line-2)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: 'var(--cal-ink-soft)', marginBottom: 2 }}>Today</div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 19, color: 'var(--cal-ink)', lineHeight: 1.2, marginBottom: 14 }}>{dateLabel}</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setCursor(etNow())} style={railBtn}>TODAY</button>
        <button onClick={() => onAddEvent()} style={railBtn}>ADD EVENT</button>
      </div>
      {pastDue.length > 0 && (
        <>
          <div style={{ color: '#DC2626', fontSize: 11, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>PAST DUE ({pastDue.length})</div>
          {pastDue.map(t => <TaskRow key={t.id} t={t} overdue />)}
        </>
      )}
      <div style={{ color: '#c07a5a', fontSize: 11, letterSpacing: 2, margin: (pastDue.length ? '18px 0 6px' : '0 0 6px') }}>DUE TODAY</div>
      {dueTasks.length ? dueTasks.map(t => <TaskRow key={t.id} t={t} />)
        : <div style={{ fontSize: 12, color: 'var(--cal-ink-mute)', fontStyle: 'italic' }}>Nothing due today. 🎉</div>}
    </div>
  )
}
const railBtn = { border: '1px solid var(--cal-line)', borderRadius: 14, padding: '4px 12px', fontSize: 11, color: 'var(--cal-ink-soft)', letterSpacing: '.5px', background: 'transparent', cursor: 'pointer' }
// ---------- MONTH VIEW ----------
function MonthView({ cursor, setCursor, itemsOn, tasksOn, onAddEvent, onEditEvent, onShowDetail, allTasks }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = mondayOf(first)
  const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
  const weekCount = Math.ceil((((lastOfMonth - gridStart) / 86400000) + 1) / 7)
  const days = Array.from({ length: weekCount * 7 }, (_, i) => addDays(gridStart, i))
  const todayStr = isoDate(etNow())
  const [dayPopup, setDayPopup] = React.useState(null) // {date, items}
  const narrow = useNarrow(700)
  const CELL_H = narrow ? 86 : 132
  const MAX_SHOWN = narrow ? 2 : 4
  function openItem(i, e) {
    e.stopPropagation()
    if (i.kind === 'event' && i.raw) onEditEvent(i.raw)   // manual event → edit
    else onShowDetail(i)                                   // gcal/feed/interval → read-only detail
  }
  function DayCell({ d }) {
    const ds = isoDate(d)
    const items = itemsOn(ds)
    const inMonth = d.getMonth() === cursor.getMonth()
    const isToday = ds === todayStr
    const shown = items.slice(0, MAX_SHOWN)
    const more = items.length - shown.length
    return (
      <div style={{ background: inMonth ? 'var(--cal-paper)' : 'var(--cal-line-3)', height: CELL_H, padding: '4px 6px', cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={() => onAddEvent(d)}>
        <div style={{ fontSize: 12, color: isToday ? '#fff' : 'var(--cal-ink-mute)', background: isToday ? COLORS.event : 'transparent', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {d.getDate()}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {shown.map(i => (
            <div key={i.kind + i.id} onClick={(e) => openItem(i, e)}
              title={i.title}
              style={{
                fontSize: 10.5, lineHeight: 1.15, margin: '2px 0', padding: i.allDay ? '2px 4px' : '1px 2px', borderRadius: 2,
                ...(i.allDay ? blockStyle(i.color) : { background: 'transparent', ...textColor(i.color) }),
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
              {!i.allDay && i.start ? fmtTime(i.start) + ' ' : ''}{i.title}
            </div>
          ))}
        </div>
        {more > 0 && (
          <div onClick={(e) => { e.stopPropagation(); setDayPopup({ date: d, items }) }}
            style={{ fontSize: 10, color: 'var(--cal-ink-soft)', fontWeight: 600, padding: '1px 2px', flexShrink: 0, cursor: 'pointer' }}>
            + {more} more
          </div>
        )}
      </div>
    )
  }
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const dayHeadNames = narrow ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : dayNames
  return (
    <div style={{ display: 'flex' }}>
      {/* The "today" rail eats ~40% of a phone's width — hide it on mobile so
          the month grid itself is actually legible. */}
      {!narrow && <LeftRail cursor={cursor} setCursor={setCursor} onAddEvent={onAddEvent} tasksOn={tasksOn} allTasks={allTasks} />}
      <div style={{ flex: 1, padding: narrow ? '8px 8px' : '16px 18px', minWidth: 0 }}>
        <ViewNav cursor={cursor} setCursor={setCursor}
          label={`${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`}
          onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {dayHeadNames.map((d, di) => (
            <div key={di} style={{ textAlign: 'center', color: 'var(--cal-ink-soft)', fontSize: narrow ? 10 : 11, letterSpacing: narrow ? 0 : 1.5, paddingBottom: 8 }}>{narrow ? d : d.toUpperCase()}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: 'var(--cal-panel)', border: '1px solid var(--cal-line-2)' }}>
          {days.map((d, i) => <DayCell key={i} d={d} />)}
        </div>
      </div>
      {dayPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={() => setDayPopup(null)}>
          <div className="card" style={{ width: 380, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', padding: 18 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 10 }}>
              {dayPopup.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            {dayPopup.items.map(i => (
              <div key={i.kind + i.id} onClick={(e) => { setDayPopup(null); openItem(i, e) }}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 4px', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', fontSize: 13 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: paint(i.color), marginTop: 4, flexShrink: 0 }} />
                <div>
                  <div style={{ color: 'var(--ink)' }}>{i.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{i.allDay ? 'All day' : (i.start ? fmtTime(i.start) : '')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
// shared nav bar: ‹ label › + Today
function ViewNav({ cursor, setCursor, label, onPrev, onNext }) {
  const narrow = useNarrow(700)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: narrow ? 8 : 14, marginBottom: 14, flexWrap: 'nowrap' }}>
      <button onClick={onPrev} style={{ ...navArrow, flexShrink: 0 }}>‹</button>
      <div style={{
        fontFamily: 'Georgia, "Playfair Display", serif', fontSize: narrow ? 20 : 34, fontStyle: 'italic',
        color: 'var(--cal-ink)', minWidth: 0, flex: '1 1 auto', letterSpacing: '.5px', lineHeight: 1.15,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
      <button onClick={onNext} style={{ ...navArrow, flexShrink: 0 }}>›</button>
      <button onClick={() => setCursor(etNow())} style={{ ...railBtn, marginLeft: narrow ? 0 : 8, flexShrink: 0, whiteSpace: 'nowrap' }}>TODAY</button>
    </div>
  )
}
const navArrow = { border: '1px solid var(--cal-line)', background: 'transparent', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', color: 'var(--cal-ink-soft)', fontSize: 16, lineHeight: 1 }
// ---------- WEEK VIEW ----------
function WeekView({ cursor, setCursor, itemsOn, tasksOn, onAddEvent, onEditEvent, onShowDetail, allTasks }) {
  const openItem = (i, e) => { e.stopPropagation(); if (i.kind === 'event' && i.raw) onEditEvent(i.raw); else onShowDetail(i) }
  const narrow = useNarrow(700)
  const mon = mondayOf(cursor)
  const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
  const START_HOUR = 7, END_HOUR = 22 // 7a–10p window for week grid
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => i + START_HOUR)
  const ROW = 40
  const AXIS_W = narrow ? 24 : 38
  const todayStr = isoDate(etNow())
  const hourLabel = (h) => h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`
  const allDayByDay = week.map(d => itemsOn(isoDate(d)).filter(i => i.allDay))
  const hasAllDay = allDayByDay.some(a => a.length > 0)
  const cellStyle = { flex: 1, minWidth: 0, borderRight: '1px solid var(--cal-line-2)' }
  const axisSpacer = { width: AXIS_W, flexShrink: 0 }
  // ---- day-name header row (own row so the all-day band can line up under it)
  function DayHead({ d }) {
    const isToday = isoDate(d) === todayStr
    return (
      <div style={{
        ...cellStyle, textAlign: 'center', padding: '6px 0', overflow: 'hidden',
        color: isToday ? COLORS.event : 'var(--cal-ink-soft)', fontWeight: isToday ? 700 : 400,
      }}>
        <div style={{ fontSize: narrow ? 9 : 11, letterSpacing: narrow ? 0 : 1 }}>
          {d.toLocaleDateString('en-US', { weekday: narrow ? 'narrow' : 'short' }).toUpperCase()}
        </div>
        <div style={{ fontSize: narrow ? 12 : 11, lineHeight: 1.3 }}>{d.getDate()}</div>
      </div>
    )
  }
  // ---- timed-events column
  function DayCol({ d }) {
    const ds = isoDate(d)
    const timed = itemsOn(ds).filter(i => !i.allDay && i.start)
    return (
      <div style={cellStyle}>
        <div style={{ position: 'relative', height: hours.length * ROW, borderTop: '1px solid var(--cal-line-2)' }} onClick={() => onAddEvent(d)}>
          {hours.map((h, i) => <div key={h} style={{ position: 'absolute', top: i * ROW, left: 0, right: 0, height: ROW, borderBottom: '1px solid var(--cal-line-3)' }} />)}
          {layoutTimed(timed).map(({ i, s, e, col, cols, overlapped }) => {
            const top = (s / 60 - START_HOUR) * ROW
            const h = Math.max(14, ((e - s) / 60) * ROW - 2)
            // Clip to the visible 7a–10p window rather than dropping the event.
            const clippedTop = Math.max(0, top)
            const clippedH = Math.max(14, h - (clippedTop - top))
            const widthPct = 100 / cols
            return (
              <div key={i.kind + i.id} onClick={(ev) => openItem(i, ev)}
                title={`${fmtTime(i.start)}${i.end ? ' – ' + fmtTime(i.end) : ''} · ${i.title}`}
                style={{
                  position: 'absolute', top: clippedTop, height: clippedH,
                  left: `calc(${col * widthPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`,
                  ...blockStyle(i.color),
                  fontSize: narrow ? 8.5 : 10, lineHeight: 1.15, padding: narrow ? '1px 2px' : '2px 4px',
                  borderRadius: 3, overflow: 'hidden', cursor: 'pointer',
                  boxShadow: overlapped ? 'inset 2px 0 0 rgba(255,255,255,.9)' : 'none',
                }}>
                {narrow ? i.title : `${fmtTime(i.start)} ${i.title}`}
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  // ---- per-day PRIORITY footer (wide screens only — 45px-wide columns can't hold it)
  function PriorityCol({ d }) {
    const { priority } = tasksOn(isoDate(d))
    return (
      <div style={{ ...cellStyle, borderTop: '1px solid var(--cal-line-2)', padding: 6, minHeight: 70 }}>
        <div style={{ fontSize: 10, color: 'var(--cal-ink-mute)', letterSpacing: 1 }}>PRIORITY</div>
        {priority.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--cal-ink)', margin: '3px 0' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid var(--cal-line)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
          </div>
        ))}
      </div>
    )
  }
  // ---- left hour-label axis, aligned to the same rows
  function HourAxis() {
    return (
      <div style={axisSpacer}>
        <div style={{ position: 'relative', height: hours.length * ROW, borderTop: '1px solid transparent' }}>
          {hours.map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: i * ROW - 6, right: 3, fontSize: narrow ? 9 : 10, color: 'var(--cal-ink-mute)', whiteSpace: 'nowrap' }}>{hourLabel(h)}</div>
          ))}
        </div>
      </div>
    )
  }
  // On phones the priority columns collapse into one readable list under the grid.
  function PriorityList() {
    const rows = week.map(d => ({ d, tasks: tasksOn(isoDate(d)).priority })).filter(r => r.tasks.length)
    if (!rows.length) return null
    return (
      <div style={{ borderTop: '1px solid var(--cal-line-2)', marginTop: 8, paddingTop: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--cal-ink-mute)', letterSpacing: 1, marginBottom: 4 }}>PRIORITY THIS WEEK</div>
        {rows.map(({ d, tasks }) => (
          <div key={isoDate(d)} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--cal-ink-soft)' }}>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}</div>
            {tasks.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cal-ink)', margin: '3px 0' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid var(--cal-line)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex' }}>
      {/* The rail eats ~2/3 of a phone's width and crushes the 7 day columns. */}
      {!narrow && <LeftRail cursor={cursor} setCursor={setCursor} onAddEvent={onAddEvent} tasksOn={tasksOn} allTasks={allTasks} />}
      <div style={{ flex: 1, padding: narrow ? '8px 6px' : '12px 12px', minWidth: 0 }}>
        <ViewNav cursor={cursor} setCursor={setCursor}
          label={`${MONTHS[mon.getMonth()].slice(0, 3)} ${mon.getDate()} – ${MONTHS[week[6].getMonth()].slice(0, 3)} ${week[6].getDate()}`}
          onPrev={() => setCursor(addDays(cursor, -7))}
          onNext={() => setCursor(addDays(cursor, 7))} />
        {/* day names */}
        <div style={{ display: 'flex' }}>
          <div style={axisSpacer} />
          {week.map(d => <DayHead key={'h' + isoDate(d)} d={d} />)}
        </div>
        {/* all-day band — these events used to be dropped from week view entirely */}
        {hasAllDay && (
          <div style={{ display: 'flex', borderTop: '1px solid var(--cal-line-2)', background: 'var(--cal-line-3)' }}>
            <div style={{ ...axisSpacer, fontSize: 8, color: 'var(--cal-ink-mute)', textAlign: 'right', paddingRight: 3, paddingTop: 4 }}>all-day</div>
            {week.map((d, wi) => (
              <div key={'ad' + isoDate(d)} style={{ ...cellStyle, padding: '2px 2px', minHeight: 20 }}>
                {allDayByDay[wi].map(i => (
                  <div key={i.kind + i.id} onClick={(e) => openItem(i, e)} title={i.title}
                    style={{
                      ...blockStyle(i.color), fontSize: narrow ? 8.5 : 10, lineHeight: 1.25,
                      borderRadius: 2, padding: '1px 3px', margin: '1px 0', cursor: 'pointer',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{i.title}</div>
                ))}
              </div>
            ))}
          </div>
        )}
        {/* hour grid */}
        <div style={{ display: 'flex' }}>
          <HourAxis />
          {week.map(d => <DayCol key={isoDate(d)} d={d} />)}
        </div>
        {/* priority tasks */}
        {narrow ? <PriorityList /> : (
          <div style={{ display: 'flex' }}>
            <div style={axisSpacer} />
            {week.map(d => <PriorityCol key={'p' + isoDate(d)} d={d} />)}
          </div>
        )}
      </div>
    </div>
  )
}
// Responsive: stack the day-view pages and the planner columns when the
// viewport is narrow (small window or mobile) instead of crushing them
// side-by-side until the text overlaps.
function useNarrow(breakpoint = 900) {
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth <= breakpoint)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= breakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])
  return narrow
}
// ---------- DAY VIEW ----------
function DayView({ cursor, setCursor, itemsOn, tasksOn, userId, allTasks, onAddEvent, onEditEvent, onShowDetail, onToggleTaskDone, onToggleTaskTimer, runningEntry, timeEntries }) {
  const openItem = (i, e) => { if (e) e.stopPropagation(); if (i.kind === 'event' && i.raw) onEditEvent(i.raw); else onShowDetail(i) }
  const ds = isoDate(cursor)
  const items = itemsOn(ds)
  const allDay = items.filter(i => i.allDay)
  const timed = items.filter(i => !i.allDay && i.start)
  const { priority, other } = tasksOn(ds)
  const hours = Array.from({ length: 24 }, (_, i) => i) // 12a–11p (full day)
  const [q, who] = quoteFor(cursor)
  const narrow = useNarrow(900)
  // Fixed pixels-per-hour so block height == duration. (The old grid used flex:1
  // rows, which meant a row grew when events stacked in it and the timeline was
  // no longer linear.)
  const ROW = narrow ? 52 : 40
  const AXIS_W = 46
  const laid = layoutTimed(timed)
  const isToday = ds === isoDate(new Date())
  const [nowMins, setNowMins] = useState(localNowMins())
  useEffect(() => {
    if (!isToday) return
    const t = setInterval(() => setNowMins(localNowMins()), 60000)
    return () => clearInterval(t)
  }, [isToday])
  return (
    <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: narrow ? 0 : 820 }}>
      {/* left page: hourly column */}
      <div style={{ flex: 1, padding: narrow ? '12px 10px' : '18px 20px', borderRight: narrow ? 'none' : '1px solid var(--cal-line-2)', borderBottom: narrow ? '1px solid var(--cal-line-2)' : 'none', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: narrow ? 19 : 24, color: 'var(--cal-ink)' }}>{DOW[(cursor.getDay() + 6) % 7]}</span>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: narrow ? 14 : 18, color: 'var(--cal-ink-soft)', marginLeft: 8 }}>{MONTHS[cursor.getMonth()]} {cursor.getDate()}, {cursor.getFullYear()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button onClick={() => setCursor(addDays(cursor, -1))} style={navArrow}>‹</button>
            <button onClick={() => setCursor(addDays(cursor, 1))} style={navArrow}>›</button>
            <button onClick={() => setCursor(etNow())} style={railBtn}>TODAY</button>
            <button onClick={() => onAddEvent(cursor)} style={railBtn}>ADD EVENT</button>
          </div>
        </div>
        {allDay.map(i => (
          <div key={i.id} onClick={(e) => openItem(i, e)} style={{ ...blockStyle(i.color), fontSize: 11, padding: '3px 6px', borderRadius: 3, marginBottom: 4, cursor: 'pointer' }}>{i.title}</div>
        ))}
        <div style={{ position: 'relative', height: 24 * ROW }}>
          {/* hour gutter + gridlines */}
          {hours.map(h => (
            <div key={h} style={{ position: 'absolute', top: h * ROW, left: 0, right: 0, height: ROW, borderTop: '1px solid var(--cal-line-3)' }}>
              <div style={{ width: AXIS_W, fontSize: 11, color: 'var(--cal-ink-mute)', paddingTop: 2 }}>
                {h === 0 ? '12 am' : h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}
              </div>
              <div style={{ position: 'absolute', top: ROW / 2, left: AXIS_W, right: 0, borderTop: '1px dotted var(--cal-line-3)', opacity: 0.5 }} />
            </div>
          ))}
          {/* event surface — click empty space to add */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: AXIS_W, right: 0 }} onClick={() => onAddEvent(cursor)}>
            {laid.map(({ i, s, e, col, cols, overlapped }) => {
              const top = (s / 60) * ROW
              const height = Math.max(16, ((e - s) / 60) * ROW - 2)
              const widthPct = 100 / cols
              return (
                <div key={i.kind + i.id} onClick={(ev) => openItem(i, ev)}
                  title={`${fmtTime(i.start)}${i.end ? ' – ' + fmtTime(i.end) : ''} · ${i.title}`}
                  style={{
                    position: 'absolute', top, height,
                    left: `${col * widthPct}%`, width: `calc(${widthPct}% - 3px)`,
                    ...blockStyle(i.color), fontSize: 11, lineHeight: 1.2,
                    padding: '2px 6px', borderRadius: 3, overflow: 'hidden', cursor: 'pointer',
                    // Overlap indicator: a bright inset rail + ring so a shared slot
                    // reads as shared even when the columns are narrow on a phone.
                    boxShadow: overlapped
                      ? 'inset 3px 0 0 rgba(255,255,255,.9), 0 0 0 1px var(--cal-paper, rgba(0,0,0,.35))'
                      : 'none',
                  }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fmtTime(i.start)}{i.end ? `–${fmtTime(i.end)}` : ''}{overlapped && cols > 1 ? ` · ${col + 1}/${cols}` : ''}
                  </div>
                  {height > 26 && <div style={{ opacity: 0.95 }}>{i.title}</div>}
                </div>
              )
            })}
            {/* current-time line */}
            {isToday && (
              <div style={{ position: 'absolute', top: (nowMins / 60) * ROW, left: 0, right: 0, pointerEvents: 'none', zIndex: 5 }}>
                <div style={{ borderTop: '2px solid ' + COLORS.priority }} />
                <div style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, borderRadius: '50%', background: COLORS.priority }} />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* right page: panels */}
      <div style={{ flex: 1, padding: narrow ? '12px 10px' : '18px 20px', minWidth: 0 }}>
        <DayPlanner userId={userId} ds={ds} priority={priority} other={other} quote={[q, who]} dayItems={items} onOpenItem={openItem}
          onToggleTaskDone={onToggleTaskDone} onToggleTaskTimer={onToggleTaskTimer} runningEntry={runningEntry} timeEntries={timeEntries} />
      </div>
    </div>
  )
}
// ---------- DAY PLANNER (interactive: tasks + quick todos + meals + water) ----------
const MEAL_FIELDS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']]
const WATER_GOAL = 8
function DayPlanner({ userId, ds, priority, other, quote, dayItems = [], onOpenItem, onToggleTaskDone, onToggleTaskTimer, runningEntry, timeEntries }) {
  const narrow = useNarrow(700)
  const [water, setWater] = useState(0)
  const [meals, setMeals] = useState({})
  const [todos, setTodos] = useState([])   // {id, text, done, priority}
  const [newTodo, setNewTodo] = useState('')
  const [newOtherTodo, setNewOtherTodo] = useState('')
  const [walkDone, setWalkDone] = useState(false)
  const [walkNote, setWalkNote] = useState('')
  const [wellbeing, setWellbeing] = useState({})   // {break, air, connect} check-offs + goodThing note
  const [loaded, setLoaded] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoaded(false)
      if (!userId) return
      const { data } = await supabase.from('day_planner').select('*').eq('owner_id', userId).eq('day', ds).maybeSingle()
      if (!active) return
      setWater(data?.water || 0)
      setMeals(data?.meals || {})
      setTodos(Array.isArray(data?.quick_todos) ? data.quick_todos : [])
      setWalkDone(data?.walk_done || false)
      setWellbeing(data?.wellbeing || {})
      setWalkNote(data?.walk_note || '')
      setLoaded(true)
    })()
    return () => { active = false }
  }, [userId, ds])
  const save = useCallback(async (patch) => {
    if (!userId) return
    const { error } = await supabase.from('day_planner').upsert({
      owner_id: userId, day: ds, water, meals, quick_todos: todos, walk_done: walkDone, walk_note: walkNote, wellbeing, updated_at: new Date().toISOString(), ...patch,
    }, { onConflict: 'owner_id,day' })
    // This failed silently for a long time (the walk columns didn't exist in
    // the DB, so EVERY save was rejected and lost on refresh). Never again:
    if (error) {
      console.error('day_planner save failed:', error.message, error)
      setSaveErr("Couldn't save your changes — they may not survive a refresh. " + error.message)
    } else {
      setSaveErr('')
    }
  }, [userId, ds, water, meals, todos, walkDone, walkNote, wellbeing])
  function toggleWalk() { const v = !walkDone; setWalkDone(v); save({ walk_done: v }) }
  function toggleWell(key) { const w = { ...wellbeing, [key]: !wellbeing[key] }; setWellbeing(w); save({ wellbeing: w }) }
  function setWaterTo(n) { const v = water === n ? n - 1 : n; setWater(v); save({ water: v }) }
  function setMeal(key, val) { const m = { ...meals, [key]: val }; setMeals(m) }
  function addTodo(pri) {
    const val = pri === 'high' ? newTodo : newOtherTodo
    if (!val.trim()) return
    const next = [...todos, { id: crypto.randomUUID(), text: val.trim(), done: false, priority: pri }]
    setTodos(next)
    if (pri === 'high') setNewTodo(''); else setNewOtherTodo('')
    save({ quick_todos: next })
  }
  function toggleTodo(id) { const next = todos.map(t => t.id === id ? { ...t, done: !t.done } : t); setTodos(next); save({ quick_todos: next }) }
  function delTodo(id) { const next = todos.filter(t => t.id !== id); setTodos(next); save({ quick_todos: next }) }
  const [q, who] = quote
  const myPriorityTodos = todos.filter(t => t.priority === 'high')
  const myOtherTodos = todos.filter(t => t.priority !== 'high')
  return (
    <div>
      {saveErr && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--failed)', background: 'var(--failed-bg)', color: 'var(--failed)', fontSize: 12.5, fontWeight: 600 }}>
          ⚠ {saveErr}
        </div>
      )}
    <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 20 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <PanelHead>PRIORITY TASKS</PanelHead>
        <TaskAndTodoList tasks={priority} todos={myPriorityTodos} onToggle={toggleTodo} onDel={delTodo} emptyBoth="No priority items."
          onToggleTaskDone={onToggleTaskDone} onToggleTaskTimer={onToggleTaskTimer} runningEntry={runningEntry} />
        <QuickAdd value={newTodo} setValue={setNewTodo} onAdd={() => addTodo('high')} placeholder="Add a priority to-do…" />
        <div style={{ height: 22 }} />
        <PanelHead>OTHER TASKS</PanelHead>
        <TaskAndTodoList tasks={other} todos={myOtherTodos} onToggle={toggleTodo} onDel={delTodo} emptyBoth="Nothing else today."
          onToggleTaskDone={onToggleTaskDone} onToggleTaskTimer={onToggleTaskTimer} runningEntry={runningEntry} />
        <QuickAdd value={newOtherTodo} setValue={setNewOtherTodo} onAdd={() => addTodo('other')} placeholder="Add a to-do…" />
      </div>
      <div style={{ width: narrow ? '100%' : 250, flexShrink: 0 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--cal-ink-soft)', lineHeight: 1.5 }}>
          &ldquo;{q}&rdquo;
          <div style={{ marginTop: 6, fontStyle: 'normal', fontSize: 12, color: 'var(--cal-ink-mute)' }}>— {who}</div>
        </div>
        <div style={{ marginTop: 22 }}>
          <PanelHead>MEALS</PanelHead>
          {MEAL_FIELDS.map(([key, label]) => (
            <div key={key} style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--cal-ink-mute)', letterSpacing: 1 }}>{label.toUpperCase()}</div>
              <input value={meals[key] || ''} onChange={e => setMeal(key, e.target.value)} onBlur={() => save({ meals })}
                placeholder="…" style={{ width: '100%', fontSize: 12, border: 'none', borderBottom: '1px solid var(--cal-line-2)', background: 'transparent', padding: '2px 0', outline: 'none', color: 'var(--cal-ink)' }} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 22 }}>
          <PanelHead>WATER</PanelHead>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 8 }}>
            {Array.from({ length: WATER_GOAL }).map((_, i) => {
              const filled = i < water
              return (
                <span key={i} onClick={() => setWaterTo(i + 1)} title={`${i + 1} of ${WATER_GOAL}`}
                  style={{ cursor: 'pointer', width: 22, height: 26, borderRadius: '3px 3px 8px 8px', border: '2px solid ' + (filled ? COLORS.event : 'var(--cal-line)'), background: filled ? COLORS.event : 'transparent' }} />
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cal-ink-mute)', marginTop: 6 }}>{water} of {WATER_GOAL} glasses</div>
        </div>
        <div style={{ marginTop: 22 }}>
          <PanelHead>WELLBEING</PanelHead>
          <div onClick={toggleWalk}
            style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, background: walkDone ? 'rgba(22,163,74,.08)' : 'transparent', border: '1px solid ' + (walkDone ? '#16A34A' : 'var(--cal-line-2)') }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: '2px solid ' + (walkDone ? '#16A34A' : 'var(--cal-line)'), background: walkDone ? '#16A34A' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12 }}>{walkDone ? '✓' : ''}</span>
            <span style={{ fontSize: 12.5, color: 'var(--cal-ink)' }}>15-minute walk today</span>
          </div>
          {walkDone && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: '#16A34A', fontStyle: 'italic', marginBottom: 6 }}>Way to go — your body and mind thank you! 🌿</div>
              <input value={walkNote} onChange={e => setWalkNote(e.target.value)} onBlur={() => save({ walk_note: walkNote })}
                placeholder="How was it? (optional)"
                style={{ width: '100%', fontSize: 12, border: 'none', borderBottom: '1px solid var(--cal-line-2)', background: 'transparent', padding: '3px 0', outline: 'none', color: 'var(--cal-ink)' }} />
            </div>
          )}
          {[['break', 'Took a real break'], ['air', 'Got fresh air / sunlight'], ['connect', 'Connected with someone']].map(([key, label]) => (
            <div key={key} onClick={() => toggleWell(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, background: wellbeing[key] ? 'rgba(22,163,74,.08)' : 'transparent', border: '1px solid ' + (wellbeing[key] ? '#16A34A' : 'var(--cal-line-2)') }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: '2px solid ' + (wellbeing[key] ? '#16A34A' : 'var(--cal-line)'), background: wellbeing[key] ? '#16A34A' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12 }}>{wellbeing[key] ? '✓' : ''}</span>
              <span style={{ fontSize: 12.5, color: 'var(--cal-ink)' }}>{label}</span>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--cal-ink-mute)', letterSpacing: 1 }}>ONE GOOD THING TODAY</div>
            <input value={wellbeing.goodThing || ''} onChange={e => setWellbeing({ ...wellbeing, goodThing: e.target.value })} onBlur={() => save({ wellbeing })}
              placeholder="Something that went well…"
              style={{ width: '100%', fontSize: 12, border: 'none', borderBottom: '1px solid var(--cal-line-2)', background: 'transparent', padding: '3px 0', outline: 'none', color: 'var(--cal-ink)', marginTop: 4 }} />
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
function QuickAdd({ value, setValue, onAdd, placeholder }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onAdd() }}
        placeholder={placeholder} style={{ flex: 1, fontSize: 12, border: 'none', borderBottom: '1px solid var(--cal-line-2)', background: 'transparent', padding: '3px 0', outline: 'none', color: 'var(--cal-ink)' }} />
      <button onClick={onAdd} style={{ border: '1px solid var(--cal-line)', borderRadius: 12, background: 'transparent', color: 'var(--cal-ink-soft)', fontSize: 11, padding: '2px 10px', cursor: 'pointer' }}>Add</button>
    </div>
  )
}
function TaskAndTodoList({ tasks, todos, onToggle, onDel, emptyBoth, onToggleTaskDone, onToggleTaskTimer, runningEntry }) {
  if (!tasks.length && !todos.length) return <div style={{ fontSize: 12, color: 'var(--cal-ink-mute)', fontStyle: 'italic', margin: '8px 0' }}>{emptyBoth}</div>
  return (
    <div style={{ marginTop: 6 }}>
      {tasks.map(t => {
        const done = t.status === 'done'
        const isRunning = runningEntry && runningEntry.task_id === t.id
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: done ? 'var(--cal-ink-mute)' : 'var(--cal-ink)', margin: '5px 0' }}>
            <span onClick={() => onToggleTaskDone && onToggleTaskDone(t)}
              style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid ' + (done ? '#16A34A' : 'var(--cal-line)'), background: done ? '#16A34A' : 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>{done ? '✓' : ''}</span>
            <span style={{ textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {onToggleTaskTimer && !done && (
              <button onClick={() => onToggleTaskTimer(t)} title={isRunning ? 'Stop timer' : 'Start timer'}
                style={{ marginLeft: 'auto', flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: isRunning ? '#DC2626' : '#16A34A' }}>
                {isRunning ? '■ stop' : '▶ start'}
              </button>
            )}
          </div>
        )
      })}
      {todos.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.done ? 'var(--cal-ink-mute)' : 'var(--cal-ink)', margin: '5px 0' }}>
          <span onClick={() => onToggle(t.id)} style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid ' + (t.done ? COLORS.event : 'var(--cal-line)'), background: t.done ? COLORS.event : 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>{t.done ? '✓' : ''}</span>
          <span style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
          <span onClick={() => onDel(t.id)} style={{ marginLeft: 'auto', color: 'var(--cal-ink-mute)', cursor: 'pointer', fontSize: 14 }}>×</span>
        </div>
      ))}
    </div>
  )
}
function PanelHead({ children }) {
  return <div style={{ color: '#c07a5a', fontSize: 12, letterSpacing: 2, fontWeight: 500 }}>{children}</div>
}
// ---------- SHARED CALENDARS ----------
function SharesModal({ userId, profiles, invitable = [], sharedWithMe, mySharedOut, hiddenShares, setHiddenShares, onClose, onChanged }) {
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const nameOf = (pid) => (profiles.find(p => p.id === pid) || {}).full_name || 'Unknown'
  const alreadyShared = new Set(mySharedOut.map(s => s.viewer_id))
  const candidates = invitable.filter(p => p.id !== userId && !alreadyShared.has(p.id))   // staff only
  async function shareWith() {
    if (!pick) return
    setBusy(true)
    await supabase.from('calendar_shares').insert({ owner_id: userId, viewer_id: pick })
    setPick(''); setBusy(false); onChanged()
  }
  async function unshare(viewerId) {
    await supabase.from('calendar_shares').delete().eq('owner_id', userId).eq('viewer_id', viewerId)
    onChanged()
  }
  function toggleHidden(ownerId) { setHiddenShares(prev => ({ ...prev, [ownerId]: !prev[ownerId] })) }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="card" style={{ width: 480, maxWidth: '92vw', padding: 22, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>Shared calendars</h3>
        <p className="page-sub" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>Share your meetings and work times with teammates so they can see your availability. Read-only.</p>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>People viewing my calendar</div>
        {mySharedOut.length ? mySharedOut.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
            <span style={{ flex: 1, fontSize: 13 }}>{nameOf(s.viewer_id)}</span>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--failed)' }} onClick={() => unshare(s.viewer_id)}>Stop sharing</button>
          </div>
        )) : <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: 6 }}>You haven't shared with anyone yet.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 20 }}>
          <select value={pick} onChange={e => setPick(e.target.value)} style={{ flex: 1, fontSize: 13, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--line)' }}>
            <option value="">Share my calendar with…</option>
            {candidates.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <button className="btn btn-primary" onClick={shareWith} disabled={!pick || busy}>Share</button>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, borderTop: '1px solid var(--line)', paddingTop: 16 }}>Calendars shared with me</div>
        {sharedWithMe.length ? sharedWithMe.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, opacity: hiddenShares[s.owner_id] ? 0.5 : 1 }}>{nameOf(s.owner_id)}</span>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleHidden(s.owner_id)}>{hiddenShares[s.owner_id] ? 'Show' : 'Hide'}</button>
          </div>
        )) : <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>No one has shared their calendar with you yet.</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
// ---------- CONNECTED CALENDARS (external .ics feeds) ----------
function SubscriptionsModal({ subs, userId, gcalConn, setGcalConn, gcalAccounts = [], setSubs, onClose, onChanged }) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState('#7C3AED')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [syncing, setSyncing] = useState(null)
  const [gcalSyncing, setGcalSyncing] = useState(false)
  const [gcals, setGcals] = useState(null)   // list of google calendars
  const [target, setTarget] = useState('primary')
  // load the user's Google calendars (for picking the push target)
  const isConnected = !!gcalConn
  useEffect(() => {
    if (!isConnected) return
    let active = true
    supabase.functions.invoke('google-calendar-write', { body: { action: 'list-calendars' } }).then(({ data }) => {
      if (active && data?.calendars) { setGcals(data.calendars); setTarget(data.current || 'primary') }
    }).catch(() => {})
    return () => { active = false }
  }, [isConnected])
  async function setTargetCalendar(id) {
    setTarget(id)
    const cal = (gcals || []).find(c => c.id === id)
    await supabase.functions.invoke('google-calendar-write', { body: { action: 'set-target', calendar_id: id, calendar_name: cal?.name } })
  }
  // Google OAuth: send the user to Google's consent screen. state = user id so
  // the callback knows who connected. client id is public (only secret is sensitive).
  function connectGoogle() {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    const supaUrl = import.meta.env.VITE_SUPABASE_URL
    if (!clientId) { setErr('Google client ID not configured (VITE_GOOGLE_CLIENT_ID).'); return }
    const redirect = `${supaUrl}/functions/v1/google-oauth-callback`
    const scope = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email'
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirect)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', scope)
    authUrl.searchParams.set('access_type', 'offline')   // get a refresh token
    // 'select_account' lets you pick WHICH Google account to add, so you can
    // connect several (turritopsis, opsiscx, personal, etc.) one after another.
    authUrl.searchParams.set('prompt', 'consent select_account')
    authUrl.searchParams.set('state', userId)
    window.location.href = authUrl.toString()
  }
  async function syncGoogle() {
    setGcalSyncing(true); setErr('')
    const { data, error } = await supabase.functions.invoke('google-calendar-sync', { body: {} })
    setGcalSyncing(false)
    if (error) { setErr('Google sync failed: ' + error.message); return }
    if (data?.error) { setErr('Google sync failed: ' + data.error); return }
    onChanged()
  }
  async function disconnectGoogle(acct) {
    if (acct?.id) {
      // Disconnect one specific account + drop its pulled events.
      await supabase.from('calendar_accounts').delete().eq('id', acct.id)
      await supabase.from('google_calendar_events').delete().eq('owner_id', userId).eq('account_email', acct.account_email)
    } else {
      // Fallback: disconnect everything Google for this user.
      await supabase.from('calendar_accounts').delete().eq('owner_id', userId).eq('provider', 'google')
      await supabase.from('google_calendar_tokens').delete().eq('owner_id', userId)
      await supabase.from('google_calendar_events').delete().eq('owner_id', userId)
    }
    onChanged()
  }
  async function add() {
    setErr('')
    if (!label.trim() || !url.trim()) { setErr('Add a name and an .ics URL.'); return }
    if (!/^https?:\/\/|^webcal:\/\//i.test(url.trim())) { setErr('That doesn’t look like a calendar URL.'); return }
    setBusy(true)
    const { data, error } = await supabase.from('calendar_subscriptions')
      .insert({ owner_id: userId, label: label.trim(), ics_url: url.trim(), color })
      .select().single()
    if (error) { setErr(error.message); setBusy(false); return }
    // immediately sync the new feed
    await sync(data.id, true)
    setLabel(''); setUrl(''); setBusy(false)
    onChanged()
  }
  async function sync(id, silent) {
    setSyncing(id); setErr('')
    const { data, error } = await supabase.functions.invoke('sync-calendar-feed', { body: { subscription_id: id } })
    setSyncing(null)
    if (error) { setErr('Sync failed: ' + error.message); return }
    if (data?.error) { setErr('Sync failed: ' + data.error); return }
    if (!silent) onChanged()
  }
  async function remove(id) {
    await supabase.from('calendar_subscriptions').delete().eq('id', id)
    onChanged()
  }
  const PRESET = [['#7C3AED', 'Purple'], ['#0077B6', 'Blue'], ['#16A34A', 'Green'], ['#D97706', 'Amber'], ['#DC2626', 'Red']]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="card" style={{ width: 500, maxWidth: '92vw', padding: 22, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>Connected calendars</h3>
        <p className="page-sub" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>Subscribe to Google, Outlook, or Apple calendars by their secret .ics link. Events show up on your calendar (read-only).</p>
        {err && <div style={{ color: 'var(--failed)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        {/* Google Calendar (OAuth) — multiple accounts */}
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, background: 'var(--canvas)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#EA4335', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Google Calendar</div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                {gcalAccounts.length ? `${gcalAccounts.length} account${gcalAccounts.length > 1 ? 's' : ''} connected · two-way sync` : 'Two-way sync across your Google accounts'}
              </div>
            </div>
            {gcalAccounts.length > 0 && (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={gcalSyncing} onClick={syncGoogle}>{gcalSyncing ? 'Syncing…' : 'Sync all'}</button>
            )}
          </div>
          {/* per-account rows */}
          {gcalAccounts.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color || '#EA4335', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.account_email}{a.is_default ? ' · default' : ''}
                </div>
                <div style={{ fontSize: 11, color: a.last_error ? 'var(--failed)' : 'var(--ink-soft)' }}>
                  {a.last_error ? 'Sync error — reconnect' : a.last_synced_at ? `Synced ${new Date(a.last_synced_at).toLocaleString()}` : 'Not synced yet'}
                </div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--failed)' }} onClick={() => disconnectGoogle(a)}>Disconnect</button>
            </div>
          ))}
          {/* connect another / first account */}
     
