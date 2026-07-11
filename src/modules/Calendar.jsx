import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

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
  const [view, setView] = useState('month')          // month | week | day
  const [cursor, setCursor] = useState(etNow())      // anchor date
  const [userId, setUserId] = useState(null)
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [assignees, setAssignees] = useState([])
  const [claims, setClaims] = useState([])
  const [blocks, setBlocks] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editEvent, setEditEvent] = useState(null)   // event obj or {} for new

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const uid = user?.id || null
    setUserId(uid)
    const [evRes, taskRes, taRes, clmRes, blkRes, profRes] = await Promise.all([
      supabase.from('calendar_events').select('*'),
      supabase.from('tasks').select('id, name, due_date, priority, status, project_id').is('deleted_at', null),
      supabase.from('task_assignees').select('task_id, profile_id'),
      supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at'),
      supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role'),
      supabase.from('profiles').select('id, full_name'),
    ])
    setEvents(evRes.data || [])
    setTasks(taskRes.data || [])
    setAssignees(taRes.data || [])
    setClaims(clmRes.data || [])
    setBlocks(blkRes.data || [])
    setProfiles(profRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ---- visibility: events (personal to me OR team), tasks (mine or admin), intervals (mine) ----
  const myEvents = useMemo(() => events.filter(e => e.scope === 'team' || e.owner_id === userId), [events, userId])
  const myTaskIds = useMemo(() => new Set(assignees.filter(a => a.profile_id === userId).map(a => a.task_id)), [assignees, userId])
  // Personal calendar: always only the current user's own tasks, even for admins.
  const myTasks = useMemo(() => tasks.filter(t => myTaskIds.has(t.id)), [tasks, myTaskIds])
  const myClaims = useMemo(() => claims.filter(c => c.profile_id === userId), [claims, userId])

  // items on a given ISO date
  const itemsOn = useCallback((ds) => {
    const evs = myEvents.filter(e => e.event_date === ds).map(e => ({
      kind: 'event', id: e.id, title: e.title, allDay: e.all_day, start: e.start_time, end: e.end_time,
      color: e.scope === 'team' ? COLORS.team : COLORS.event, scope: e.scope, raw: e,
    }))
    const ivs = myClaims.map(c => ({ c, b: blocks.find(b => b.id === c.shift_block_id) }))
      .filter(x => x.b && x.b.block_date === ds)
      .map(({ c, b }) => ({
        kind: 'interval', id: c.id, title: `${b.role || 'Interval'}`, allDay: false,
        start: b.start_time, end: b.end_time, color: COLORS.interval,
      }))
    return [...evs, ...ivs].sort((a, b) => {
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      return (a.start || '').localeCompare(b.start || '')
    })
  }, [myEvents, myClaims, blocks])

  const tasksOn = useCallback((ds) => {
    const due = myTasks.filter(t => t.due_date === ds && t.status !== 'done')
    return {
      priority: due.filter(t => t.priority === 'high'),
      other: due.filter(t => t.priority !== 'high'),
    }
  }, [myTasks])

  if (loading) return <div className="page-sub" style={{ padding: 30 }}>Loading calendar…</div>

  const shared = { cursor, setCursor, itemsOn, tasksOn, onAddEvent: (d) => setEditEvent({ event_date: isoDate(d || cursor) }), onEditEvent: setEditEvent }

  return (
    <div>
      <BookFrame view={view} setView={setView}>
        {view === 'month' && <MonthView {...shared} />}
        {view === 'week' && <WeekView {...shared} />}
        {view === 'day' && <DayView {...shared} />}
      </BookFrame>

      {editEvent && (
        <EventModal event={editEvent} userId={userId} isAdmin={isAdmin}
          onClose={() => setEditEvent(null)}
          onSaved={() => { setEditEvent(null); load() }} />
      )}
    </div>
  )
}

// ---------- BOOK FRAME (leather cover + tabs) ----------
function BookFrame({ view, setView, children }) {
  return (
    <div style={{ background: '#4a6178', borderRadius: 16, padding: 18, boxShadow: 'inset 0 0 40px rgba(0,0,0,.22)', position: 'relative' }}>
      <div style={{ display: 'flex', background: '#fdfcfa', borderRadius: 8, overflow: 'hidden', minHeight: 560 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '30px 0', background: '#4a6178' }}>
          {['month', 'week', 'day'].map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{
                writingMode: 'vertical-rl', textOrientation: 'mixed', border: 'none', cursor: 'pointer',
                background: view === v ? '#fdfcfa' : '#e8e4dc', color: '#5a5650',
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
const QUOTES = [
  ['Success is no accident. It is hard work, perseverance, learning, studying, sacrifice, and most of all, loving what you are doing.', 'Pelé'],
  ['Discipline is deciding between what you want now and what you want most.', 'Abraham Lincoln'],
  ['If you are working on something exciting that you really care about, you don\u2019t have to be pushed. The vision pulls you.', 'Steve Jobs'],
]
function quoteFor(d) { return QUOTES[(d.getFullYear() + d.getMonth() + d.getDate()) % QUOTES.length] }

function LeftRail({ cursor, setCursor, onAddEvent, itemsOn, tasksOn }) {
  const today = etNow()
  const ds = isoDate(today)
  const items = itemsOn(ds)
  const { priority, other } = tasksOn(ds)
  const dueTasks = [...priority, ...other]
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div style={{ width: 216, flexShrink: 0, padding: '20px 18px', borderRight: '1px solid #ece8e0', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: '#7a94ab', marginBottom: 2 }}>Today</div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 19, color: '#3a3a38', lineHeight: 1.2, marginBottom: 14 }}>{dateLabel}</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setCursor(etNow())} style={railBtn}>TODAY</button>
        <button onClick={() => onAddEvent()} style={railBtn}>ADD EVENT</button>
      </div>

      <div style={{ color: '#c07a5a', fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>ON THE CALENDAR</div>
      {items.length ? items.map(i => (
        <div key={i.kind + i.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '5px 0', fontSize: 12.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: i.color, marginTop: 4, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#4a4640', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</div>
            <div style={{ color: '#9a968c', fontSize: 11 }}>{i.allDay ? 'All day' : fmtTime(i.start)}</div>
          </div>
        </div>
      )) : <div style={{ fontSize: 12, color: '#c3bfb5', fontStyle: 'italic' }}>Nothing scheduled.</div>}

      <div style={{ color: '#c07a5a', fontSize: 11, letterSpacing: 2, margin: '18px 0 6px' }}>DUE TODAY</div>
      {dueTasks.length ? dueTasks.map(t => (
        <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '5px 0', fontSize: 12.5 }}>
          <span style={{ width: 13, height: 13, borderRadius: '50%', border: '1.5px solid ' + (t.priority === 'high' ? COLORS.priority : '#c3bfb5'), flexShrink: 0 }} />
          <span style={{ color: '#4a4640', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
        </div>
      )) : <div style={{ fontSize: 12, color: '#c3bfb5', fontStyle: 'italic' }}>No tasks due.</div>}
    </div>
  )
}
const railBtn = { border: '1px solid #c3bfb5', borderRadius: 14, padding: '4px 12px', fontSize: 11, color: '#6a665e', letterSpacing: '.5px', background: 'transparent', cursor: 'pointer' }

// ---------- MONTH VIEW ----------
function MonthView({ cursor, setCursor, itemsOn, tasksOn, onAddEvent, onEditEvent }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = mondayOf(first)
  // only render weeks that actually contain days of this month (5 or 6 rows)
  const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
  const weekCount = Math.ceil((((lastOfMonth - gridStart) / 86400000) + 1) / 7)
  const days = Array.from({ length: weekCount * 7 }, (_, i) => addDays(gridStart, i))
  const todayStr = isoDate(etNow())

  function DayCell({ d }) {
    const ds = isoDate(d)
    const items = itemsOn(ds)
    const inMonth = d.getMonth() === cursor.getMonth()
    const allDay = items.filter(i => i.allDay)
    const timed = items.filter(i => !i.allDay)
    const shown = timed.slice(0, 5)
    const more = timed.length - shown.length
    return (
      <div style={{ background: inMonth ? '#fff' : '#faf8f4', minHeight: 130, padding: '5px 7px', cursor: 'pointer' }}
        onClick={() => onAddEvent(d)}>
        <div style={{ fontSize: 12, color: isoDate(d) === todayStr ? '#fff' : '#9a968c', background: isoDate(d) === todayStr ? COLORS.event : 'transparent', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {d.getDate()}
        </div>
        {allDay.map(i => (
          <div key={i.id} onClick={(e) => { e.stopPropagation(); i.raw && onEditEvent(i.raw) }}
            style={{ background: i.color, color: '#fff', fontSize: 11, padding: '2px 5px', borderRadius: 2, margin: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</div>
        ))}
        {shown.map(i => (
          <div key={i.id} onClick={(e) => { e.stopPropagation(); i.raw && onEditEvent(i.raw) }}
            style={{ fontSize: 11, color: i.color, padding: '1px 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i.start ? fmtTime(i.start) + ' ' : ''}{i.title}
          </div>
        ))}
        {more > 0 && <div style={{ fontSize: 10, color: '#9a968c', padding: 2, textAlign: 'right' }}>+ {more} MORE</div>}
      </div>
    )
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  return (
    <div style={{ display: 'flex' }}>
      <LeftRail cursor={cursor} setCursor={setCursor} onAddEvent={onAddEvent} itemsOn={itemsOn} tasksOn={tasksOn} />
      <div style={{ flex: 1, padding: '16px 18px', minWidth: 0 }}>
        <ViewNav cursor={cursor} setCursor={setCursor}
          label={`${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`}
          onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {dayNames.map(d => (
            <div key={d} style={{ textAlign: 'center', color: '#7a94ab', fontSize: 11, letterSpacing: 1.5, paddingBottom: 8 }}>{d.toUpperCase()}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: '#ece8e0', border: '1px solid #ece8e0' }}>
          {days.map((d, i) => <DayCell key={i} d={d} />)}
        </div>
      </div>
    </div>
  )
}

// shared nav bar: ‹ label › + Today
function ViewNav({ cursor, setCursor, label, onPrev, onNext }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
      <button onClick={onPrev} style={navArrow}>‹</button>
      <div style={{ fontFamily: 'Georgia, "Playfair Display", serif', fontSize: 34, fontStyle: 'italic', color: '#3a3a38', minWidth: 220, letterSpacing: '.5px', lineHeight: 1 }}>{label}</div>
      <button onClick={onNext} style={navArrow}>›</button>
      <button onClick={() => setCursor(etNow())} style={{ ...railBtn, marginLeft: 8 }}>TODAY</button>
    </div>
  )
}
const navArrow = { border: '1px solid #c3bfb5', background: 'transparent', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', color: '#6a665e', fontSize: 16, lineHeight: 1 }

// ---------- WEEK VIEW ----------
function WeekView({ cursor, setCursor, itemsOn, tasksOn, onAddEvent, onEditEvent }) {
  const mon = mondayOf(cursor)
  const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
  const hours = Array.from({ length: 10 }, (_, i) => i + 9)   // 9a–6p
  const todayStr = isoDate(etNow())

  function DayCol({ d }) {
    const ds = isoDate(d)
    const timed = itemsOn(ds).filter(i => !i.allDay && i.start)
    const { priority } = tasksOn(ds)
    return (
      <div style={{ flex: 1, borderRight: '1px solid #ece8e0', minWidth: 0 }}>
        <div style={{ textAlign: 'center', fontSize: 11, letterSpacing: 1, color: isoDate(d) === todayStr ? COLORS.event : '#7a94ab', fontWeight: isoDate(d) === todayStr ? 700 : 400, padding: '6px 0' }}>
          {d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}. {MONTHS[d.getMonth()].slice(0, 3).toUpperCase()} {d.getDate()}
        </div>
        <div style={{ position: 'relative', height: hours.length * 42, borderTop: '1px solid #ece8e0' }} onClick={() => onAddEvent(d)}>
          {hours.map((h, i) => <div key={h} style={{ position: 'absolute', top: i * 42, left: 0, right: 0, height: 42, borderBottom: '1px solid #f2efe9' }} />)}
          {timed.map(i => {
            const startH = parseHour(i.start)
            const endH = i.end ? parseHour(i.end) : startH + 1
            const top = Math.max(0, (startH - 9) * 42)
            const h = Math.max(20, ((endH || startH + 1) - startH) * 42 - 2)
            return (
              <div key={i.id} onClick={(e) => { e.stopPropagation(); i.raw && onEditEvent(i.raw) }}
                style={{ position: 'absolute', top, left: 2, right: 2, height: h, background: i.color, color: '#fff', fontSize: 10, padding: '2px 4px', borderRadius: 3, overflow: 'hidden' }}>
                {fmtTime(i.start)} {i.title}
              </div>
            )
          })}
        </div>
        <div style={{ borderTop: '1px solid #ece8e0', padding: '6px', minHeight: 70 }}>
          <div style={{ fontSize: 10, color: '#b0aca4', letterSpacing: 1 }}>PRIORITY</div>
          {priority.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5a5650', margin: '3px 0' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid #c3bfb5', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex' }}>
      <LeftRail cursor={cursor} setCursor={setCursor} onAddEvent={onAddEvent} itemsOn={itemsOn} tasksOn={tasksOn} />
      <div style={{ flex: 1, padding: '12px 12px', minWidth: 0 }}>
        <ViewNav cursor={cursor} setCursor={setCursor}
          label={`${MONTHS[mon.getMonth()].slice(0, 3)} ${mon.getDate()} – ${MONTHS[week[6].getMonth()].slice(0, 3)} ${week[6].getDate()}`}
          onPrev={() => setCursor(addDays(cursor, -7))}
          onNext={() => setCursor(addDays(cursor, 7))} />
        <div style={{ display: 'flex' }}>{week.map(d => <DayCol key={isoDate(d)} d={d} />)}</div>
      </div>
    </div>
  )
}

// ---------- DAY VIEW ----------
function DayView({ cursor, setCursor, itemsOn, tasksOn, onAddEvent, onEditEvent }) {
  const ds = isoDate(cursor)
  const items = itemsOn(ds)
  const allDay = items.filter(i => i.allDay)
  const timed = items.filter(i => !i.allDay && i.start)
  const { priority, other } = tasksOn(ds)
  const hours = Array.from({ length: 16 }, (_, i) => i + 8) // 8a–11p
  const [q, who] = quoteFor(cursor)

  return (
    <div style={{ display: 'flex', minHeight: 680 }}>
      {/* left page: hourly column */}
      <div style={{ flex: 1, padding: '18px 20px', borderRight: '1px solid #ece8e0', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 24, color: '#3a3a38' }}>{DOW[(cursor.getDay() + 6) % 7]}</span>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 18, color: '#7a94ab', marginLeft: 8 }}>{MONTHS[cursor.getMonth()]} {cursor.getDate()}, {cursor.getFullYear()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setCursor(addDays(cursor, -1))} style={navArrow}>‹</button>
            <button onClick={() => setCursor(addDays(cursor, 1))} style={navArrow}>›</button>
            <button onClick={() => setCursor(etNow())} style={railBtn}>TODAY</button>
            <button onClick={() => onAddEvent(cursor)} style={railBtn}>ADD EVENT</button>
          </div>
        </div>
        {allDay.map(i => (
          <div key={i.id} onClick={() => i.raw && onEditEvent(i.raw)} style={{ background: i.color, color: '#fff', fontSize: 11, padding: '3px 6px', borderRadius: 3, marginBottom: 4, cursor: 'pointer' }}>{i.title}</div>
        ))}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 620 }}>
          {hours.map(h => (
            <div key={h} style={{ display: 'flex', borderTop: '1px solid #f2efe9', flex: 1, minHeight: 34 }}>
              <div style={{ width: 44, fontSize: 11, color: '#b0aca4', paddingTop: 2 }}>{h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}</div>
              <div style={{ flex: 1 }} onClick={() => onAddEvent(cursor)}>
                {timed.filter(i => parseHour(i.start) === h).map(i => (
                  <div key={i.id} onClick={(e) => { e.stopPropagation(); i.raw && onEditEvent(i.raw) }}
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
      <div style={{ flex: 1, padding: '18px 20px', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PanelHead>PRIORITY TASKS</PanelHead>
            <TaskList tasks={priority} empty="No priority tasks due." />
            <div style={{ height: 20 }} />
            <PanelHead>OTHER TASKS</PanelHead>
            <TaskList tasks={other} empty="Nothing else due today." />
          </div>
          <div style={{ width: 150, flexShrink: 0 }}>
            <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 13, color: '#6a665e', lineHeight: 1.5 }}>
              &ldquo;{q}&rdquo;
              <div style={{ marginTop: 6, fontStyle: 'normal', fontSize: 12, color: '#9a968c' }}>— {who}</div>
            </div>
            <div style={{ marginTop: 20 }}><PanelHead>MEALS</PanelHead></div>
            <div style={{ marginTop: 20 }}>
              <PanelHead>WATER</PanelHead>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginTop: 6 }}>
                {Array.from({ length: 8 }).map((_, i) => <span key={i} style={{ fontSize: 18, color: '#dcd8d0' }}>▽</span>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelHead({ children }) {
  return <div style={{ color: '#c07a5a', fontSize: 12, letterSpacing: 2, fontWeight: 500 }}>{children}</div>
}
function TaskList({ tasks, empty }) {
  if (!tasks.length) return <div style={{ fontSize: 12, color: '#c3bfb5', fontStyle: 'italic', margin: '8px 0' }}>{empty}</div>
  return (
    <div style={{ marginTop: 6 }}>
      {tasks.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#4a4640', margin: '5px 0' }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid #c3bfb5', flexShrink: 0 }} />
          <span>{t.name}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- EVENT MODAL ----------
function EventModal({ event, userId, isAdmin, onClose, onSaved }) {
  const isNew = !event.id
  const [title, setTitle] = useState(event.title || '')
  const [date, setDate] = useState(event.event_date || isoDate(etNow()))
  const [allDay, setAllDay] = useState(event.all_day || false)
  const [start, setStart] = useState(event.start_time || '09:00')
  const [end, setEnd] = useState(event.end_time || '10:00')
  const [notes, setNotes] = useState(event.notes || '')
  const [scope, setScope] = useState(event.scope || 'personal')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!title.trim()) { setErr('Give the event a title.'); return }
    setSaving(true)
    const payload = {
      title: title.trim(), event_date: date, all_day: allDay,
      start_time: allDay ? null : start, end_time: allDay ? null : end,
      notes: notes.trim() || null, scope, owner_id: userId,
    }
    const res = isNew
      ? await supabase.from('calendar_events').insert(payload)
      : await supabase.from('calendar_events').update(payload).eq('id', event.id)
    setSaving(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }
  async function del() {
    if (!event.id) return
    await supabase.from('calendar_events').delete().eq('id', event.id)
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="card" style={{ width: 420, maxWidth: '90vw', padding: 20 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>{isNew ? 'Add event' : 'Edit event'}</h3>
        {err && <div style={{ color: 'var(--failed)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div className="field"><label>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" autoFocus />
        </div>
        <div className="field"><label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} style={{ width: 'auto' }} /> All day
        </label>
        {!allDay && (
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}><label>Start</label><input type="time" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label>End</label><input type="time" value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
        )}
        <div className="field"><label>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </div>
        <div className="field"><label>Visibility</label>
          <select value={scope} onChange={e => setScope(e.target.value)} disabled={!isAdmin && scope !== 'team'}>
            <option value="personal">Personal (only me)</option>
            <option value="team">Team (everyone)</option>
          </select>
        </div>
        {!isAdmin && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: -6, marginBottom: 8 }}>Only admins can create team events.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {!isNew && <button className="btn btn-ghost" style={{ marginLeft: 'auto', color: 'var(--failed)' }} onClick={del}>Delete</button>}
        </div>
      </div>
    </div>
  )
}
