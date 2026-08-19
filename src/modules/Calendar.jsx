import React, { useEffect, useState, useCallback, useMemo } from 'react'
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
// Command Center accent palette (from the app's design tokens)
const COLORS = {
  event: 'var(--accent, #0077B6)',
  eventBg: 'var(--accent, #0077B6)',
  interval: '#16A34A',
  priority: '#B91C1C',
  team: '#7C3AED',
}
export default function Calendar() {
  const { isAdmin } = useAuth()
  const [view, setView] = useState('day')             // month | week | day (default to Day)
  const [cursor, setCursor] = useState(etNow())      // anchor date
  const [userId, setUserId] = useState(null)
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [assignees, setAssignees] = useState([])
  const [claims, setClaims] = useState([])
  const [blocks, setBlocks] = useState([])
  const [coaching, setCoaching] = useState([])   // coaching sessions (own or team) — CC-only, never Google
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editEvent, setEditEvent] = useState(null)   // event obj or {} for new
  const [detailItem, setDetailItem] = useState(null) // item to show read-only detail
  const [subs, setSubs] = useState([])
  const [feedEvents, setFeedEvents] = useState([])
  const [showSubs, setShowSubs] = useState(false)
  const [gcalConn, setGcalConn] = useState(null)
  const [gcalAccounts, setGcalAccounts] = useState([])
  const [gcalEvents, setGcalEvents] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [sharedWithMe, setSharedWithMe] = useState([])   // shares where I'm the viewer
  const [mySharedOut, setMySharedOut] = useState([])     // shares I've granted
  const [hiddenShares, setHiddenShares] = useState({})   // ownerId -> true (toggled off in my view)
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
    const [evRes, taskRes, taRes, clmRes, blkRes, profRes, subRes, feedRes, gtRes, geRes, timeRes, shareInRes, shareOutRes, coachRes] = await Promise.all([
      supabase.from('calendar_events').select('*'),
      fetchAllRows(() => supabase.from('tasks').select('id, name, due_date, priority, status, project_id').is('deleted_at', null).order('id')),
      fetchAllRows(() => supabase.from('task_assignees').select('task_id, profile_id').order('id')),
      fetchAllRows(() => supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at').order('id')),
      fetchAllRows(() => supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role').order('id')),
      supabase.from('profiles').select('id, full_name'),
      supabase.from('calendar_subscriptions').select('*'),
      supabase.from('calendar_feed_events').select('*'),
      supabase.from('calendar_accounts').select('id, provider, account_email, color, is_default, target_calendar_name, last_synced_at, last_error, sync_enabled, connected_at').eq('provider', 'google'),
      fetchAllRows(() => supabase.from('google_calendar_events').select('*').order('id')),
      fetchAllRows(() => supabase.from('time_entries').select('id, task_id, user_id, started_at, ended_at, duration_minutes').order('id')),
      supabase.from('calendar_shares').select('*').eq('viewer_id', uid),
      supabase.from('calendar_shares').select('*').eq('owner_id', uid),
      supabase.from('coaching_sessions').select('id, kind, asc_id, agent_id, applicant_name, session_date, start_time, end_time, status, topic, meeting_url').eq('status', 'booked'),
    ])
    setEvents(evRes.data || [])
    setTasks(taskRes.data || [])
    setAssignees(taRes.data || [])
    setClaims(clmRes.data || [])
    setBlocks(blkRes.data || [])
    setProfiles(profRes.data || [])
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
      color: e.color || (e.scope === 'team' ? COLORS.team : COLORS.event), scope: e.scope, raw: e,
    }))
    const ivs = myClaims.map(c => ({ c, b: blocks.find(b => b.id === c.shift_block_id) }))
      .filter(x => x.b && x.b.block_date === ds)
      .map(({ c, b }) => ({
        kind: 'interval', id: c.id, title: `${b.role || 'Interval'}`, allDay: false,
        start: toViewerHHMM(b.block_date, b.start_time, COMPANY_TZ, viewerTZ),
        end: toViewerHHMM(b.block_date, b.end_time, COMPANY_TZ, viewerTZ),
        color: COLORS.interval,
      }))
    const feeds = feedEvents.filter(f => f.event_date === ds).map(f => {
      const sub = subs.find(s => s.id === f.subscription_id)
      return {
        kind: 'feed', id: f.id, title: f.title, allDay: f.all_day,
        start: f.start_time, end: f.end_time, color: sub?.color || COLORS.team,
      }
    })
    const gcal = gcalEvents.filter(g => g.event_date === ds && (!g.owner_id || g.owner_id === userId)).map(g => ({
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
    const activeShareOwners = new Set(sharedWithMe.filter(s => !hiddenShares[s.owner_id]).map(s => s.owner_id))
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
      .filter(g => g.event_date === ds && g.owner_id && activeShareOwners.has(g.owner_id) && g.owner_id !== userId)
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
        color: isMock ? '#7C3AED' : '#DB2777', hangoutLink: s.meeting_url || undefined,
      }
    })
    return [...evs, ...ivs, ...feeds, ...gcal, ...sharedEvs, ...sharedGcal, ...sharedIvs, ...coachIvs].sort((a, b) => {
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      return (a.start || '').localeCompare(b.start || '')
    })
  }, [myEvents, myClaims, blocks, feedEvents, subs, gcalEvents, gcalConn, events, claims, coaching, sharedWithMe, hiddenShares, profiles, userId, viewerTZ])
  const tasksOn = useCallback((ds) => {
    const due = myTasks.filter(t => t.due_date === ds)
    return {
      priority: due.filter(t => t.priority === 'high'),
      other: due.filter(t => t.priority !== 'high'),
    }
  }, [myTasks])
  if (loading) return <div className="page-sub" style={{ padding: 30 }}>Loading calendar…</div>
  const shared = { cursor, setCursor, itemsOn, tasksOn, userId, allTasks: myTasks, onAddEvent: (d) => setEditEvent({ event_date: isoDate(d || cursor) }), onEditEvent: setEditEvent, onShowDetail: setDetailItem, onToggleTaskDone: toggleTaskDone, onToggleTaskTimer: toggleTaskTimer, runningEntry, timeEntries }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        <button className="btn btn-ghost" onClick={() => setShowShares(true)} style={{ fontSize: 13 }}>👥 Shared calendars</button>
        <button className="btn btn-ghost" onClick={() => setShowSubs(true)} style={{ fontSize: 13 }}>⚙ Connected calendars</button>
      </div>
      <BookFrame view={view} setView={setView}>
        {view === 'month' && <MonthView {...shared} />}
        {view === 'week' && <WeekView {...shared} />}
        {view === 'day' && <DayView {...shared} />}
      </BookFrame>
      {showShares && (
        <SharesModal userId={userId} profiles={profiles} sharedWithMe={sharedWithMe} mySharedOut={mySharedOut}
          hiddenShares={hiddenShares} setHiddenShares={setHiddenShares}
          onClose={() => setShowShares(false)} onChanged={() => load()} />
      )}
      {showSubs && (
        <SubscriptionsModal subs={subs} userId={userId} gcalConn={gcalConn} setGcalConn={setGcalConn} gcalAccounts={gcalAccounts} setSubs={setSubs}
          onClose={() => setShowSubs(false)}
          onChanged={() => load()} />
      )}
      {detailItem && <EventDetailModal item={detailItem} onClose={() => setDetailItem(null)}
        onEdit={(raw) => { setDetailItem(null); setEditEvent(raw) }} />}
      {editEvent && (
        <EventModal event={editEvent} userId={userId} isAdmin={isAdmin} gcalConn={gcalConn} profiles={profiles}
          onClose={() => setEditEvent(null)}
          onSaved={() => { setEditEvent(null); load() }} />
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
function quoteFor(d) {
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
                background: i.allDay ? i.color : 'transparent', color: i.allDay ? '#fff' : i.color,
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
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: i.color, marginTop: 4, flexShrink: 0 }} />
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
          {timed.map(i => {
            const startH = parseHour(i.start)
            const endH = i.end ? parseHour(i.end) : startH + 1
            const top = Math.max(0, (startH - START_HOUR) * ROW)
            const h = Math.max(18, ((endH || startH + 1) - startH) * ROW - 2)
            return (
              <div key={i.kind + i.id} onClick={(e) => openItem(i, e)} title={`${fmtTime(i.start)} ${i.title}`}
                style={{
                  position: 'absolute', top, left: 1, right: 1, height: h, background: i.color, color: '#fff',
                  fontSize: narrow ? 8.5 : 10, lineHeight: 1.15, padding: narrow ? '1px 2px' : '2px 4px',
                  borderRadius: 3, overflow: 'hidden', cursor: 'pointer',
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
                      background: i.color, color: '#fff', fontSize: narrow ? 8.5 : 10, lineHeight: 1.25,
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
          <div key={i.id} onClick={(e) => openItem(i, e)} style={{ background: i.color, color: '#fff', fontSize: 11, padding: '3px 6px', borderRadius: 3, marginBottom: 4, cursor: 'pointer' }}>{i.title}</div>
        ))}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 760 }}>
          {hours.map(h => (
            <div key={h} style={{ display: 'flex', borderTop: '1px solid var(--cal-line-3)', flex: 1, minHeight: 34 }}>
              <div style={{ width: 44, fontSize: 11, color: 'var(--cal-ink-mute)', paddingTop: 2 }}>{h === 0 ? '12 am' : h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}</div>
              <div style={{ flex: 1 }} onClick={() => onAddEvent(cursor)}>
                {timed.filter(i => parseHour(i.start) === h).map(i => (
                  <div key={i.id} onClick={(e) => openItem(i, e)}
                    style={{ background: i.color, color: '#fff', fontSize: 11, padding: '3px 6px', borderRadius: 3, margin: '1px 0', cursor: 'pointer' }}>
                    {fmtTime(i.start)} {i.title}
                  </div>
                ))}
              </div>
            </div>
          ))}
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
function SharesModal({ userId, profiles, sharedWithMe, mySharedOut, hiddenShares, setHiddenShares, onClose, onChanged }) {
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const nameOf = (pid) => (profiles.find(p => p.id === pid) || {}).full_name || 'Unknown'
  const alreadyShared = new Set(mySharedOut.map(s => s.viewer_id))
  const candidates = profiles.filter(p => p.id !== userId && !alreadyShared.has(p.id))
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
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={connectGoogle}>
              {gcalAccounts.length ? '+ Connect another Google account' : 'Connect Google'}
            </button>
          </div>
          {gcalConn && gcals && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
              <label style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}>New Command Center events are added to ({gcalConn.google_email}):</label>
              <select value={target} onChange={e => setTargetCalendar(e.target.value)}
                style={{ display: 'block', marginTop: 4, fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line)', width: '100%' }}>
                {gcals.map(c => <option key={c.id} value={c.id}>{c.name}{c.primary ? ' (primary)' : ''}</option>)}
              </select>
            </div>
          )}
        </div>
        {subs.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            {subs.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                    {s.last_synced_at ? `Synced ${new Date(s.last_synced_at).toLocaleString()}` : 'Not synced yet'}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={syncing === s.id} onClick={() => sync(s.id)}>{syncing === s.id ? 'Syncing…' : 'Sync'}</button>
                <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--failed)' }} onClick={() => remove(s.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Add a calendar</div>
          <div className="field"><label>Name</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. My Google Calendar" />
          </div>
          <div className="field"><label>Secret .ics URL</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://calendar.google.com/…/basic.ics" />
          </div>
          <div className="field"><label>Color</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {PRESET.map(([c, name]) => (
                <span key={c} onClick={() => setColor(c)} title={name}
                  style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: color === c ? '3px solid var(--ink)' : '3px solid transparent' }} />
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={add} disabled={busy} style={{ marginTop: 6 }}>{busy ? 'Adding…' : 'Add calendar'}</button>
        </div>
        <details style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-soft)' }}>
          <summary style={{ cursor: 'pointer' }}>Where do I find my .ics link?</summary>
          <div style={{ marginTop: 8, lineHeight: 1.6 }}>
            <b>Google:</b> Settings → click your calendar → &ldquo;Secret address in iCal format.&rdquo;<br />
            <b>Outlook:</b> Calendar settings → Shared calendars → Publish → copy the ICS link.<br />
            <b>Apple iCloud:</b> Share the calendar as a Public Calendar, then copy the webcal:// link.
          </div>
        </details>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
// ---------- EVENT DETAIL (read-only popup) ----------
function EventDetailModal({ item, onClose, onEdit }) {
  // linkify a description that may contain a URL (Zoom, Meet, etc.)
  const urlRe = /(https?:\/\/[^\s]+)/g
  const desc = item.description || item.raw?.notes || ''
  const parts = desc ? desc.split(urlRe) : []
  const zoom = item.hangoutLink || (desc.match(/https?:\/\/[^\s]*(zoom\.us|meet\.google|teams\.microsoft)[^\s]*/) || [])[0]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3100 }} onClick={onClose}>
      <div className="card" style={{ width: 440, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: item.color, marginTop: 5, flexShrink: 0 }} />
          <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>{item.title}</h3>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 14 }}>
          {item.allDay ? 'All day' : `${item.start ? fmtTime(item.start) : ''}${item.end ? ' – ' + fmtTime(item.end) : ''}`}
          {item.kind === 'gcal' && <span> · Google Calendar</span>}
          {item.kind === 'interval' && <span> · Scheduled interval</span>}
          {item.kind === 'feed' && <span> · Subscribed calendar</span>}
        </div>
        {zoom && (
          <a href={zoom} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', background: '#2D8CFF', color: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', marginBottom: 14 }}>
            Join video call
          </a>
        )}
        {item.location && (
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            <span style={{ color: 'var(--ink-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Location</span>
            <div>{item.location}</div>
          </div>
        )}
        {desc && (
          <div style={{ fontSize: 13, marginBottom: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--ink-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Details</span>
            {parts.map((p, idx) => urlRe.test(p)
              ? <a key={idx} href={p} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, #0077B6)', wordBreak: 'break-all' }}>{p}</a>
              : <span key={idx}>{p}</span>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          {item.htmlLink && <a href={item.htmlLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Open in Google ↗</a>}
          {item.kind === 'event' && item.raw && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => onEdit(item.raw)}>Edit</button>}
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
// ---------- EVENT DETAIL end ----------
// ---------- INVITEE PICKER ----------
// A compact searchable multi-select over team members. Selected people show as
// removable chips; the list below toggles membership. Excludes the current user
// (the owner is implicitly attending their own event).
function InviteePicker({ profiles, userId, value, onChange }) {
  const [q, setQ] = useState('')
  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || 'Unknown'
  const list = profiles
    .filter(p => p.id !== userId)
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  const needle = q.trim().toLowerCase()
  const shown = needle ? list.filter(p => (p.full_name || '').toLowerCase().includes(needle)) : list
  const toggle = (id) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
  return (
    <div>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {value.map(id => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 999, padding: '3px 4px 3px 9px' }}>
              {nameOf(id)}
              <span onClick={() => toggle(id)} title="Remove" style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: '0 3px' }}>×</span>
            </span>
          ))}
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people to invite…" />
      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, marginTop: 6 }}>
        {shown.length === 0 ? (
          <div style={{ padding: 8, fontSize: 12, color: 'var(--ink-soft)' }}>No matches</div>
        ) : shown.map(p => {
          const on = value.includes(p.id)
          return (
            <div key={p.id} onClick={() => toggle(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, background: on ? 'var(--accent-bg)' : 'transparent', borderBottom: '1px solid var(--line-soft)' }}>
              <input type="checkbox" checked={on} readOnly style={{ width: 'auto' }} />
              <span style={{ color: on ? 'var(--accent)' : 'var(--ink)', fontWeight: on ? 600 : 400 }}>{p.full_name || 'Unknown'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
// ---------- EVENT MODAL ----------
function EventModal({ event, userId, isAdmin, gcalConn, profiles = [], onClose, onSaved }) {
  const isNew = !event.id
  // Only the owner (or a brand-new event) can edit; invitees see it read-only.
  const isOwner = isNew || event.owner_id === userId
  const [title, setTitle] = useState(event.title || '')
  const [date, setDate] = useState(event.event_date || isoDate(etNow()))
  const [allDay, setAllDay] = useState(event.all_day || false)
  const [start, setStart] = useState(event.start_time || '09:00')
  const [end, setEnd] = useState(event.end_time || '10:00')
  const [notes, setNotes] = useState(event.notes || '')
  const [meetingUrl, setMeetingUrl] = useState(event.meeting_url || '')
  const [scope, setScope] = useState(event.scope || 'personal')
  const [color, setColor] = useState(event.color || '#0077B6')
  const [invitees, setInvitees] = useState(event.invitee_ids || [])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // --- recurrence (new events only) ---------------------------------------
  // Occurrences are written as real rows sharing a series_id rather than
  // expanded on read, so invitees, Google push, meeting links and the T-10/T-2
  // reminders all keep working with no special cases, and any single occurrence
  // can be moved or edited on its own.
  const [repeat, setRepeat] = useState('none')   // none | daily | weekdays | weekly | biweekly | monthly
  const [repeatUntil, setRepeatUntil] = useState('')
  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || 'Unknown'
  // Dates after the first for the chosen pattern, capped so a typo can't create
  // thousands of rows.
  function occurrenceDates() {
    if (repeat === 'none' || !repeatUntil) return []
    const out = []
    const last = new Date(repeatUntil + 'T00:00:00')
    const cur = new Date(date + 'T00:00:00')
    const MAX = 366
    while (out.length < MAX) {
      if (repeat === 'daily') cur.setDate(cur.getDate() + 1)
      else if (repeat === 'weekdays') { do { cur.setDate(cur.getDate() + 1) } while (cur.getDay() === 0 || cur.getDay() === 6) }
      else if (repeat === 'weekly') cur.setDate(cur.getDate() + 7)
      else if (repeat === 'biweekly') cur.setDate(cur.getDate() + 14)
      else if (repeat === 'monthly') {
        // Clamp instead of letting Date roll over: naive setMonth on Jan 31 gives
        // Mar 3, skipping February entirely and permanently drifting the series
        // onto the 3rd. Anchor to the ORIGINAL day-of-month each time and clamp to
        // the target month's length.
        const anchorDay = new Date(date + 'T00:00:00').getDate()
        const y = cur.getFullYear(), m = cur.getMonth() + 1
        const daysInTarget = new Date(y, m + 1, 0).getDate()
        cur.setDate(1) // avoid rolling over while we move the month
        cur.setFullYear(y, m, Math.min(anchorDay, daysInTarget))
      }
      else break
      if (cur > last) break
      out.push(isoDate(cur))
    }
    return out
  }
  async function save() {
    if (!title.trim()) { setErr('Give the event a title.'); return }
    if (isNew && repeat !== 'none') {
      if (!repeatUntil) { setErr('Pick an end date for the repeat, or set Repeat to "Does not repeat".'); return }
      if (repeatUntil < date) { setErr('The repeat end date is before the event date.'); return }
    }
    setSaving(true)
    const payload = {
      title: title.trim(), event_date: date, all_day: allDay,
      start_time: allDay ? null : start, end_time: allDay ? null : end,
      notes: notes.trim() || null, scope, color, owner_id: userId, tz: detectedTZ(),
      invitee_ids: invitees, meeting_url: meetingUrl.trim() || null,
    }
    let savedId = event.id
    let res
    let madeExtras = []
    if (isNew) {
      const extras = occurrenceDates()
      // Give the whole series one id up front so the first row carries it too —
      // that's what makes "delete the whole series" find every occurrence.
      const seriesId = extras.length ? newUuid() : null
      // ONE insert for the whole series. Inserting the base row first and the
      // repeats second left a window where a failure on the second call had
      // already committed the base row — the modal stayed open with isNew still
      // true, so pressing Save again created a duplicate. A single statement is
      // all-or-nothing.
      const rows = [{ ...payload, series_id: seriesId }, ...extras.map(d => ({ ...payload, event_date: d, series_id: seriesId }))]
      const { data: made, error: insErr } = await supabase.from('calendar_events').insert(rows).select()
      res = { data: (made || []).find(r => r.event_date === date) || (made || [])[0], error: insErr }
      savedId = res.data?.id
      madeExtras = (made || []).filter(r => r.id !== savedId)
    } else {
      res = await supabase.from('calendar_events').update(payload).eq('id', event.id).select().single()
    }
    if (res.error) { setSaving(false); setErr(res.error.message); return }
    // push to Google if connected
    if (gcalConn && savedId) {
      try {
        const { data: pushed } = await supabase.functions.invoke('google-calendar-write', {
          body: { action: 'push', op: isNew ? 'create' : 'update', event: { ...res.data, google_event_id: event.google_event_id } },
        })
        if (pushed?.google_event_id) {
          await supabase.from('calendar_events').update({
            google_event_id: pushed.google_event_id, google_calendar_id: pushed.google_calendar_id,
          }).eq('id', savedId)
        }
      } catch { /* non-fatal: local save already succeeded */ }
    }
    // Push the rest of the series to Google too — a recurring meeting that shows
    // up once in Google would be worse than not syncing at all. Bounded at 60:
    // past that we skip and TELL the user, rather than firing hundreds of invokes
    // or leaving them to discover the gap in Google weeks later.
    let gcalSkipped = 0
    if (gcalConn && madeExtras.length) {
      if (madeExtras.length > 60) {
        gcalSkipped = madeExtras.length
      } else {
        const pushOne = async (row) => {
          try {
            const { data: pushed } = await supabase.functions.invoke('google-calendar-write', { body: { action: 'push', op: 'create', event: row } })
            if (pushed?.google_event_id) {
              await supabase.from('calendar_events').update({
                google_event_id: pushed.google_event_id, google_calendar_id: pushed.google_calendar_id,
              }).eq('id', row.id)
            }
          } catch { /* non-fatal */ }
        }
        // Small concurrent batches so a 60-occurrence series doesn't sit on
        // "Saving…" through 60 sequential round trips.
        for (let i = 0; i < madeExtras.length; i += 5) {
          await Promise.all(madeExtras.slice(i, i + 5).map(pushOne))
        }
      }
    }
    setSaving(false)
    if (gcalSkipped) {
      window.alert(`Saved ${gcalSkipped + 1} events in Command Center.\n\nThey were not added to your Google Calendar — that's only done automatically for series of 60 or fewer. Shorten the repeat, or add it in Google directly.`)
    }
    onSaved()
  }
  async function del(whole = false) {
    if (!event.id) return
    // push delete to Google first (while we still have the id), then remove locally
    if (gcalConn && event.google_event_id) {
      try { await supabase.functions.invoke('google-calendar-write', { body: { action: 'push', op: 'delete', event } }) } catch { /* non-fatal */ }
    }
    if (whole && event.series_id) {
      // Google copies of the other occurrences are removed on the next sync;
      // clearing the local rows is what the user asked for here.
      await supabase.from('calendar_events').delete().eq('series_id', event.series_id)
    } else {
      await supabase.from('calendar_events').delete().eq('id', event.id)
    }
    onSaved()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="card" style={{ width: 420, maxWidth: '90vw', padding: 20 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>{isNew ? 'Add event' : isOwner ? 'Edit event' : 'Event details'}</h3>
        {!isOwner && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
            You're invited to this event{event.owner_id ? ` by ${nameOf(event.owner_id)}` : ''}. View only.
          </div>
        )}
        {err && <div style={{ color: 'var(--failed)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div className="field"><label>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" autoFocus={isOwner} disabled={!isOwner} />
        </div>
        <div className="field"><label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!isOwner} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} disabled={!isOwner} style={{ width: 'auto' }} /> All day
        </label>
        {!allDay && (
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}><label>Start</label><input type="time" value={start} onChange={e => setStart(e.target.value)} disabled={!isOwner} /></div>
            <div className="field" style={{ flex: 1 }}><label>End</label><input type="time" value={end} onChange={e => setEnd(e.target.value)} disabled={!isOwner} /></div>
          </div>
        )}
        {isNew && isOwner && (
          <>
            <div className="field"><label>Repeat</label>
              <select value={repeat} onChange={e => setRepeat(e.target.value)}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Every weekday (Mon–Fri)</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {repeat !== 'none' && (
              <div className="field"><label>Repeat until</label>
                <input type="date" value={repeatUntil} min={date} onChange={e => setRepeatUntil(e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
                  {repeatUntil && repeatUntil >= date
                    ? `Creates ${occurrenceDates().length + 1} events. Each one can be edited or deleted on its own.`
                    : 'Pick the last date this should appear on.'}
                </div>
              </div>
            )}
          </>
        )}
        {!isNew && event.series_id && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
            🔁 Part of a repeating series. Editing here changes <strong>only this date</strong>.
          </div>
        )}
        <div className="field"><label>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} disabled={!isOwner} />
        </div>
        <div className="field"><label>Meeting link</label>
          <input value={meetingUrl} onChange={e => setMeetingUrl(e.target.value)} placeholder="Paste a Zoom / Teams / Meet link (optional)" disabled={!isOwner} />
          {isOwner && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>Add a video link and the notetaker will join and record this meeting into Command Center. Leave blank for none.</div>}
          {meetingUrl && /^https?:\/\//i.test(meetingUrl.trim()) && (
            <a href={meetingUrl.trim()} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: 'var(--accent, #0077B6)', wordBreak: 'break-all' }}>Join meeting ↗</a>
          )}
        </div>
        <div className="field"><label>Invitees</label>
          {isOwner ? (
            <>
              <InviteePicker profiles={profiles} userId={userId} value={invitees} onChange={setInvitees} />
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>Invited people see this event on their calendar, even if it's set to Personal.</div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: invitees.length ? 'var(--ink)' : 'var(--ink-soft)' }}>
              {invitees.length ? invitees.map(nameOf).join(', ') : 'No invitees'}
            </div>
          )}
        </div>
        <div className="field"><label>Color</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', pointerEvents: isOwner ? 'auto' : 'none', opacity: isOwner ? 1 : .7 }}>
            {['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D', '#4B5563'].map(c => (
              <span key={c} onClick={() => setColor(c)} title={c}
                style={{ width: 26, height: 26, borderRadius: 6, background: c, cursor: 'pointer', border: color === c ? '3px solid var(--ink)' : '3px solid transparent' }} />
            ))}
            <label title="Custom color" style={{ position: 'relative', width: 26, height: 26, borderRadius: 6, cursor: 'pointer', border: '2px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>+</span>
            </label>
            <span style={{ width: 18, height: 18, borderRadius: 4, background: color, marginLeft: 4 }} />
          </div>
        </div>
        <div className="field"><label>Visibility</label>
          <select value={scope} onChange={e => setScope(e.target.value)} disabled={!isOwner || (!isAdmin && scope !== 'team')}>
            <option value="personal">Personal{invitees.length ? ' + invitees' : ' (only me)'}</option>
            <option value="team">Team (everyone)</option>
          </select>
        </div>
        {isOwner && !isAdmin && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: -6, marginBottom: 8 }}>Only admins can create team events, but you can invite specific people above.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {isOwner ? (
            <>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              {!isNew && <button className="btn btn-ghost" style={{ marginLeft: 'auto', color: 'var(--failed)' }} onClick={() => del(false)}>{event.series_id ? 'Delete this date' : 'Delete'}</button>}
              {!isNew && event.series_id && (
                <button className="btn btn-ghost" style={{ color: 'var(--failed)' }}
                  onClick={() => { if (window.confirm('Delete every date in this repeating series? This cannot be undone.')) del(true) }}>Delete series</button>
              )}
            </>
          ) : (
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
