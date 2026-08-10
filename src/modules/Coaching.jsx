import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// COACHING — agents book coaching sessions with their ASC.
//
// Model (all backend-enforced, see migrations coaching_scheduling_*):
//  - Each agent is assigned to ONE ASC via profiles.coaching_asc_id
//    ("which team the agent is on"). Set on the Teams tab (admin/ASC).
//  - An ASC's bookable availability = the "Agent Support Coordinator"
//    intervals she has ACCEPTED (claimed) on the Schedule board, sliced
//    into 30-min slots. No accepted interval → no availability, period.
//  - Isolation: an agent only ever sees / books their own ASC. Kerri's
//    team can't see Sylvia's calendar, and vice-versa. Enforced in the
//    get_coaching_availability RPC + coaching_sessions RLS.
//
// RPCs: get_coaching_availability, book_coaching_session,
//       cancel_coaching_session, set_coaching_team, list_ascs,
//       get_my_coach, get_coaching_teams.
// ============================================================

const SLOT_MIN = 30

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function fmtDate(ds) {
  if (!ds) return ''
  const [y, m, d] = ds.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function todayET() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// small shared style tokens (consistent with the app's accent vars)
const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 16, marginBottom: 16 }
const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border,#e5e7eb)', background: 'var(--card,#fff)', cursor: 'pointer', fontWeight: 600 }
const btnPrimary = { ...btn, background: 'var(--accent, #0077B6)', color: '#fff', border: 'none' }
const slotBtn = { ...btn, padding: '6px 10px', margin: '0 8px 8px 0', fontSize: 13 }

export default function Coaching() {
  const { user, isAdmin, appRole } = useAuth()
  const isAsc = String(appRole || '').toLowerCase().includes('asc')
  const canManage = isAdmin || isAsc

  const tabs = useMemo(() => {
    const t = []
    if (!isAsc) t.push({ k: 'book', label: 'Book a session' })
    if (isAsc) t.push({ k: 'calendar', label: 'My coaching calendar' })
    t.push({ k: 'mine', label: isAsc ? 'All my sessions' : 'My sessions' })
    if (canManage) t.push({ k: 'teams', label: 'Teams' })
    return t
  }, [isAsc, canManage])

  const [tab, setTab] = useState(tabs[0]?.k || 'book')

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 12px 40px' }}>
      <h1 style={{ margin: '4px 0 2px' }}>🧑‍🏫 Coaching</h1>
      <p style={{ color: 'var(--muted,#6b7280)', marginTop: 0 }}>
        Schedule coaching sessions with your Agent Support Coordinator.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 16px' }}>
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ ...btn, ...(tab === t.k ? btnPrimary : {}) }}>{t.label}</button>
        ))}
      </div>

      {tab === 'book' && <BookPanel user={user} />}
      {tab === 'calendar' && <SessionsPanel user={user} mode="asc" />}
      {tab === 'mine' && <SessionsPanel user={user} mode={isAsc ? 'asc' : 'agent'} />}
      {tab === 'teams' && <TeamsPanel />}
    </div>
  )
}

// ---------- profile-name cache ----------
async function loadNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', uniq)
  const map = {}
  ;(data || []).forEach(p => { map[p.id] = p.full_name })
  return map
}

// ============================================================
// BOOK PANEL — agent picks an open slot on their ASC's calendar
// ============================================================
function BookPanel({ user }) {
  const { isAdmin, appRole } = useAuth()
  const isAsc = String(appRole || '').toLowerCase().includes('asc')
  const canPickAsc = isAdmin || isAsc

  const [coach, setCoach] = useState(null)      // {asc_id, asc_name}
  const [ascs, setAscs] = useState([])          // for admin/asc picker
  const [ascId, setAscId] = useState(null)
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data: mc } = await supabase.rpc('get_my_coach')
      const my = Array.isArray(mc) ? mc[0] : mc
      setCoach(my || null)
      if (canPickAsc) {
        const { data: a } = await supabase.rpc('list_ascs')
        setAscs(a || [])
        setAscId(my?.asc_id || (a && a[0]?.id) || null)
      } else {
        setAscId(my?.asc_id || null)
      }
      setLoading(false)
    })()
  }, [canPickAsc])

  const loadSlots = useCallback(async (id) => {
    if (!id) { setSlots([]); return }
    const to = new Date(); to.setDate(to.getDate() + 21)
    const toStr = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`
    const { data, error } = await supabase.rpc('get_coaching_availability', {
      p_asc_id: id, p_from: todayET(), p_to: toStr, p_slot_min: SLOT_MIN,
    })
    if (error) { setMsg(error.message); setSlots([]); return }
    setSlots(data || [])
  }, [])

  useEffect(() => { loadSlots(ascId) }, [ascId, loadSlots])

  const byDate = useMemo(() => {
    const g = {}
    for (const s of slots) { (g[s.session_date] ||= []).push(s) }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
  }, [slots])

  async function book(s) {
    if (busy) return
    const topic = window.prompt('What would you like to focus on? (optional)') ?? ''
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('book_coaching_session', {
      p_asc_id: s.asc_id, p_date: s.session_date, p_start: s.start_time, p_slot_min: SLOT_MIN, p_topic: topic,
    })
    if (error) { setBusy(false); setMsg(error.message); return }
    const when = `${fmtDate(s.session_date)} at ${fmtTime(s.start_time)}`
    setMsg(`Booked ${when} ✓ — scheduling notetaker…`)
    loadSlots(ascId)
    // Dispatch the Recall notetaker (mints/uses a video link + schedules the bot).
    const sid = Array.isArray(data) ? data[0]?.id : data?.id
    if (sid) {
      try {
        const { data: d2 } = await supabase.functions.invoke('coaching-dispatch', { body: { coaching_session_id: sid } })
        if (d2?.ok) setMsg(`Booked ${when} ✓ · 🎙️ notetaker will join & record`)
        else setMsg(`Booked ${when} ✓ · notetaker not set (${d2?.note || 'no room/link'})`)
      } catch { setMsg(`Booked ${when} ✓ (notetaker will be scheduled shortly)`) }
    }
    setBusy(false)
  }

  if (loading) return <div style={card}>Loading…</div>

  if (!canPickAsc && !coach) {
    return (
      <div style={card}>
        <b>You're not on a coaching team yet.</b>
        <p style={{ color: 'var(--muted,#6b7280)' }}>
          An admin needs to assign you to an ASC before you can book coaching. Ask your lead to add you on the Teams tab.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div style={card}>
        {canPickAsc ? (
          <label style={{ display: 'block' }}>
            <span style={{ fontWeight: 600, marginRight: 8 }}>Coach:</span>
            <select value={ascId || ''} onChange={e => setAscId(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
              {ascs.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </label>
        ) : (
          <div>Your coach: <b>{coach?.asc_name}</b></div>
        )}
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted,#6b7280)' }}>
          🎙️ A notetaker automatically joins and records each session. The recording &amp; summary are private to you and your coach.
        </div>
        {msg && <div style={{ marginTop: 10, color: msg.includes('✓') ? '#16a34a' : '#b91c1c' }}>{msg}</div>}
      </div>

      {byDate.length === 0 ? (
        <div style={card}>
          <b>No open coaching times right now.</b>
          <p style={{ color: 'var(--muted,#6b7280)', marginBottom: 0 }}>
            {(coach?.asc_name) || 'Your coach'} has no accepted ASC intervals coming up, or every slot is already booked.
            Availability appears automatically once an ASC interval is picked up on the Schedule board.
          </p>
        </div>
      ) : byDate.map(([date, list]) => (
        <div key={date} style={card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{fmtDate(date)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {list.map(s => (
              <button key={s.start_time} style={slotBtn} disabled={busy} onClick={() => book(s)}>
                {fmtTime(s.start_time)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// SESSIONS PANEL — upcoming/past coaching sessions for the viewer
//   mode 'agent'  -> sessions where I'm the agent
//   mode 'asc'    -> sessions on my coaching calendar
// ============================================================
function SessionsPanel({ user, mode }) {
  const [rows, setRows] = useState([])
  const [names, setNames] = useState({})
  const [meetings, setMeetings] = useState({})   // meeting_id -> {status, recording_link, summary}
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('coaching_sessions').select('*').order('session_date').order('start_time')
    if (mode === 'agent') q = q.eq('agent_id', user.id)
    else q = q.eq('asc_id', user.id)
    const { data, error } = await q
    if (error) { setMsg(error.message); setLoading(false); return }
    const list = data || []
    setRows(list)
    setNames(await loadNames(list.flatMap(r => [r.agent_id, r.asc_id])))
    // pull the linked private meeting rows (recording + summary) — RLS lets participants read
    const mids = [...new Set(list.map(r => r.meeting_id).filter(Boolean))]
    if (mids.length) {
      const { data: mts } = await supabase.from('meetings').select('id, status, recording_link, summary').in('id', mids)
      const map = {}; (mts || []).forEach(m => { map[m.id] = m }); setMeetings(map)
    } else setMeetings({})
    setLoading(false)
  }, [mode, user.id])

  useEffect(() => { load() }, [load])

  async function cancel(r) {
    if (!window.confirm('Cancel this coaching session?')) return
    const { error } = await supabase.rpc('cancel_coaching_session', { p_id: r.id, p_reason: null })
    if (error) { setMsg(error.message); return }
    load()
  }

  if (loading) return <div style={card}>Loading…</div>

  const today = todayET()
  const upcoming = rows.filter(r => r.status === 'booked' && r.session_date >= today)
  const past = rows.filter(r => !(r.status === 'booked' && r.session_date >= today))

  const captureLabel = (r) => {
    const m = r.meeting_id ? meetings[r.meeting_id] : null
    if (m && (m.status === 'done' || m.status === 'ready') && m.recording_link) return { text: '🎙️ Recorded', color: '#16a34a' }
    if (m && m.status === 'error') return { text: '🎙️ not captured', color: '#b91c1c' }
    if (r.capture === 'scheduled') return { text: '🎙️ notetaker scheduled', color: 'var(--muted,#6b7280)' }
    if (r.capture === 'recording' || (m && (m.status === 'new' || m.status === 'transcribing' || m.status === 'summarizing'))) return { text: '🎙️ recording…', color: 'var(--muted,#6b7280)' }
    if (r.capture === 'none') return { text: 'no notetaker (set ASC room)', color: 'var(--muted,#6b7280)' }
    return null
  }

  const Row = ({ r }) => {
    const m = r.meeting_id ? meetings[r.meeting_id] : null
    const cap = captureLabel(r)
    return (
      <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border,#eee)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{fmtDate(r.session_date)} · {fmtTime(r.start_time)}–{fmtTime(r.end_time)}</div>
            <div style={{ fontSize: 13, color: 'var(--muted,#6b7280)' }}>
              {mode === 'asc' ? `Agent: ${names[r.agent_id] || '—'}` : `Coach: ${names[r.asc_id] || '—'}`}
              {r.topic ? ` · ${r.topic}` : ''}
              {r.status !== 'booked' ? ` · ${r.status}` : ''}
              {cap ? <span style={{ color: cap.color }}> · {cap.text}</span> : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {r.status === 'booked' && r.meeting_url && r.session_date >= today && (
              <a href={r.meeting_url} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none' }}>Join</a>
            )}
            {m && m.recording_link && (
              <a href={m.recording_link} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none' }}>▶ Recording</a>
            )}
            {r.status === 'booked' && r.session_date >= today && (
              <button style={btn} onClick={() => cancel(r)}>Cancel</button>
            )}
          </div>
        </div>
        {m && m.summary && (
          <div style={{ marginTop: 6, fontSize: 13, background: 'var(--bg,#f9fafb)', borderRadius: 8, padding: '8px 10px' }}>{m.summary}</div>
        )}
      </div>
    )
  }

  return (
    <div>
      {msg && <div style={{ ...card, color: '#b91c1c' }}>{msg}</div>}
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Upcoming</div>
        {upcoming.length ? upcoming.map(r => <Row key={r.id} r={r} />) : <div style={{ color: 'var(--muted,#6b7280)' }}>Nothing scheduled.</div>}
      </div>
      {past.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Past & cancelled</div>
          {past.map(r => <Row key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// ============================================================
// TEAMS PANEL — assign agents to an ASC's team (admin / ASC)
// ============================================================
function TeamsPanel() {
  const [teams, setTeams] = useState([])       // rows: {asc_id, asc_name, asc_room_url, agent_id, agent_name, agent_active}
  const [ascs, setAscs] = useState([])
  const [agents, setAgents] = useState([])     // all assignable agents
  const [rooms, setRooms] = useState({})       // asc_id -> room url (draft)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: t }, { data: a }, { data: ag }] = await Promise.all([
      supabase.rpc('get_coaching_teams'),
      supabase.rpc('list_ascs'),
      supabase.from('profiles').select('id, full_name, coaching_asc_id').eq('role', 'agent').eq('is_active', true).order('full_name'),
    ])
    setTeams(t || [])
    setAscs(a || [])
    setAgents(ag || [])
    const rm = {}; (t || []).forEach(r => { if (!(r.asc_id in rm)) rm[r.asc_id] = r.asc_room_url || '' }); setRooms(rm)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function assign(agentId, ascId) {
    setMsg('')
    const { error } = await supabase.rpc('set_coaching_team', { p_agent_id: agentId, p_asc_id: ascId || null })
    if (error) { setMsg(error.message); return }
    load()
  }

  async function saveRoom(ascId) {
    setMsg('')
    const { error } = await supabase.rpc('set_coaching_room', { p_asc_id: ascId, p_url: rooms[ascId] || '' })
    setMsg(error ? error.message : 'Room saved ✓')
  }

  if (loading) return <div style={card}>Loading…</div>

  // group agents by ASC for a quick roster overview
  const byAsc = {}
  for (const a of ascs) byAsc[a.id] = { name: a.full_name, members: [] }
  const unassigned = []
  for (const ag of agents) {
    if (ag.coaching_asc_id && byAsc[ag.coaching_asc_id]) byAsc[ag.coaching_asc_id].members.push(ag)
    else unassigned.push(ag)
  }

  return (
    <div>
      {msg && <div style={{ ...card, color: '#b91c1c' }}>{msg}</div>}

      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Assign agents to a coach</div>
        <p style={{ color: 'var(--muted,#6b7280)', marginTop: 0 }}>
          Each agent can only book coaching with the ASC selected here.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 12px', alignItems: 'center' }}>
          {agents.map(ag => (
            <React.Fragment key={ag.id}>
              <div>{ag.full_name}</div>
              <select value={ag.coaching_asc_id || ''} onChange={e => assign(ag.id, e.target.value)}
                style={{ padding: 6, borderRadius: 8, minWidth: 180 }}>
                <option value="">— No team —</option>
                {ascs.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Coaching video rooms</div>
        <p style={{ color: 'var(--muted,#6b7280)', marginTop: 0, fontSize: 13 }}>
          Optional. If set, the notetaker joins this standing room (Zoom/Meet/Teams) for every session.
          Leave blank to auto-generate a Google Meet link per session. Either way the session stays in Command Center only.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: '8px 10px', alignItems: 'center' }}>
          {ascs.map(a => (
            <React.Fragment key={a.id}>
              <div>{a.full_name}</div>
              <input value={rooms[a.id] || ''} placeholder="https://…  (blank = auto Meet link)"
                onChange={e => setRooms(r => ({ ...r, [a.id]: e.target.value }))}
                style={{ padding: 6, borderRadius: 8, border: '1px solid var(--border,#e5e7eb)' }} />
              <button style={btn} onClick={() => saveRoom(a.id)}>Save</button>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Rosters</div>
        {ascs.map(a => (
          <div key={a.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{a.full_name}’s team <span style={{ color: 'var(--muted,#6b7280)' }}>({byAsc[a.id].members.length})</span></div>
            <div style={{ color: 'var(--muted,#6b7280)', fontSize: 14 }}>
              {byAsc[a.id].members.length ? byAsc[a.id].members.map(m => m.full_name).join(', ') : 'No agents yet'}
            </div>
          </div>
        ))}
        {unassigned.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600 }}>Unassigned <span style={{ color: 'var(--muted,#6b7280)' }}>({unassigned.length})</span></div>
            <div style={{ color: 'var(--muted,#6b7280)', fontSize: 14 }}>{unassigned.map(m => m.full_name).join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
