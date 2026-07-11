import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import LiveStatus from './LiveStatus'

// ============================================================
// DASHBOARD — role-aware command center home.
// Admin/Owner: operational overview. Agent: personal home.
// Pulls live data from schedule, certs, notifications, activity.
// ============================================================

function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return `${d}d ago`
}
const VERBS = {
  claimed: 'claimed', released: 'released', released_late: 'released (late)', checked_in: 'checked in to',
  marked_no_show: 'marked no-show in', schedule_created: 'created', schedule_published: 'published',
  block_created: 'added an interval to', block_deleted: 'removed an interval from',
}

export default function Dashboard() {
  const { isAdmin } = useAuth()
  const [me, setMe] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const meRes = await supabase.from('profiles').select('*').eq('id', user.id).single()
      const today = isoDate(etNow())

      const [schRes, blkRes, clmRes, actRes, recRes, certRes, profRes, notifRes] = await Promise.all([
        supabase.from('schedules').select('*').eq('status', 'published'),
        supabase.from('shift_blocks').select('*'),
        supabase.from('shift_claims').select('*'),
        supabase.from('schedule_activity_log').select('*').order('created_at', { ascending: false }).limit(8),
        supabase.from('agent_cert_records').select('*'),
        supabase.from('certifications').select('id, name, active'),
        supabase.from('profiles').select('id, full_name, is_active'),
        supabase.from('notifications').select('*').eq('recipient_id', user.id).is('read_at', null),
      ])

      setMe(meRes.data)
      setData({
        today,
        schedules: schRes.data || [],
        blocks: blkRes.data || [],
        claims: clmRes.data || [],
        activity: actRes.data || [],
        certRecords: recRes.data || [],
        certifications: certRes.data || [],
        profiles: profRes.data || [],
        unread: notifRes.data || [],
        userId: user.id,
      })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading || !data) return <p className="page-sub">Loading your dashboard…</p>

  const firstName = (me?.full_name || 'there').split(' ')[0]

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 className="page-title">Welcome back, {firstName}</h1>
        <p className="page-sub">{isAdmin ? "Here's how operations look right now." : "Here's your day at a glance."}</p>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{isAdmin ? 'On now' : 'My status'}</h2>
        </div>
        <LiveStatus />
      </div>

      {isAdmin
        ? <AdminDashboard data={data} navigate={navigate} />
        : <AgentDashboard data={data} me={me} navigate={navigate} />}
    </div>
  )
}

function StatCard({ label, value, sub, color, onClick }) {
  return (
    <div onClick={onClick} className="card" style={{ cursor: onClick ? 'pointer' : 'default', flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--ink)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, action, onAction, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h2>
        {action && <button onClick={onAction} style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{action}</button>}
      </div>
      {children}
    </div>
  )
}

// ---------- ADMIN ----------
function AdminDashboard({ data, navigate }) {
  const { today, schedules, blocks, claims, activity, certRecords, certifications, profiles, unread } = data
  const pubIds = new Set(schedules.map(s => s.id))
  const pubBlocks = blocks.filter(b => pubIds.has(b.schedule_id))
  const todayBlocks = pubBlocks.filter(b => b.block_date === today)
  const todaySpots = todayBlocks.reduce((s, b) => s + b.total_spots, 0)
  const todayClaimed = todayBlocks.reduce((s, b) => s + claims.filter(c => c.shift_block_id === b.id).length, 0)
  const fillPct = todaySpots ? Math.round((todayClaimed / todaySpots) * 100) : 0

  // open intervals across all published (future/today)
  const openBlocks = pubBlocks.filter(b => b.block_date >= today && claims.filter(c => c.shift_block_id === b.id).length < b.total_spots)
    .sort((a, b) => (a.block_date + a.start_time).localeCompare(b.block_date + b.start_time))

  const activeGatingCertIds = new Set(certifications.filter(c => c.active !== false).map(c => c.id))
  const pendingCerts = certRecords.filter(r => activeGatingCertIds.has(r.certification_id) && (r.status === 'needed' || r.status === 'failed')).length
  const activePeople = profiles.filter(p => p.is_active !== false).length

  return (
    <div>
      <WalkNudge />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <StatCard label="Today's fill rate" value={`${fillPct}%`} sub={`${todayClaimed}/${todaySpots} spots claimed`} color={fillPct >= 80 ? 'var(--passed)' : fillPct >= 50 ? 'var(--needed)' : 'var(--failed)'} onClick={() => navigate('/insights')} />
        <StatCard label="Open intervals" value={openBlocks.length} sub="today & upcoming" color="var(--accent)" onClick={() => navigate('/insights')} />
        <StatCard label="Certs needing attention" value={pendingCerts} sub="needed or failed" color={pendingCerts ? 'var(--needed)' : 'var(--passed)'} onClick={() => navigate('/certifications')} />
        <StatCard label="Active people" value={activePeople} sub="on the team" onClick={() => navigate('/people')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 18 }}>
        <Section title="Open intervals to fill" action="Schedule insights →" onAction={() => navigate('/insights')}>
          <div className="card">
            {openBlocks.length === 0 ? <div className="page-sub" style={{ padding: 8 }}>Everything's covered. 🎉</div>
              : openBlocks.slice(0, 6).map(b => {
                const left = b.total_spots - claims.filter(c => c.shift_block_id === b.id).length
                return (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                    <div>
                      <b>{formatTime(b.start_time)}–{formatTime(b.end_time)}</b>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{new Date(b.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{b.role ? ` · ${b.role}` : ''}</div>
                    </div>
                    <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)' }}>{left} open</span>
                  </div>
                )
              })}
            {openBlocks.length > 6 && <div className="page-sub" style={{ paddingTop: 8, fontSize: 12 }}>+{openBlocks.length - 6} more</div>}
          </div>
        </Section>

        <Section title="Recent activity" action="View log →" onAction={() => navigate('/insights')}>
          <div className="card">
            {activity.length === 0 ? <div className="page-sub" style={{ padding: 8 }}>No recent activity.</div>
              : activity.map(a => (
                <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 12.5 }}>
                  <div><b>{a.affected_profile_name || 'Someone'}</b> {VERBS[a.action] || a.action} {a.schedule_title || ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>{timeAgo(a.created_at)}</div>
                </div>
              ))}
          </div>
        </Section>
      </div>

      {unread.length > 0 && (
        <Section title={`Unread notifications (${unread.length})`} action="Open chat →" onAction={() => navigate('/chat')}>
          <div className="card">
            {unread.slice(0, 4).map(n => (
              <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                <b>{n.title}</b>{n.body && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{n.body}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ---------- AGENT ----------
function AgentDashboard({ data, me, navigate }) {
  const { today, schedules, blocks, claims, certRecords, certifications, unread, userId } = data
  const pubIds = new Set(schedules.map(s => s.id))
  const pubBlocks = blocks.filter(b => pubIds.has(b.schedule_id))

  // my upcoming claimed intervals
  const myClaims = claims.filter(c => c.profile_id === userId)
  const myUpcoming = myClaims
    .map(c => ({ claim: c, block: pubBlocks.find(b => b.id === c.shift_block_id) }))
    .filter(e => e.block && e.block.block_date >= today)
    .sort((a, b) => (a.block.block_date + a.block.start_time).localeCompare(b.block.block_date + b.block.start_time))

  const nextShift = myUpcoming[0]

  // open intervals I could claim (any published, has room, not mine, not started)
  const openForMe = pubBlocks.filter(b => {
    if (b.block_date < today) return false
    const cl = claims.filter(c => c.shift_block_id === b.id)
    return cl.length < b.total_spots && !cl.some(c => c.profile_id === userId)
  }).sort((a, b) => (a.block_date + a.start_time).localeCompare(b.block_date + b.start_time))

  // my certs
  const myRecords = certRecords.filter(r => r.profile_id === userId)
  const certName = (id) => certifications.find(c => c.id === id)?.name || 'Certification'
  const passed = myRecords.filter(r => r.status === 'passed')
  const needed = myRecords.filter(r => r.status === 'needed' || r.status === 'failed')

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <StatCard label="My upcoming intervals" value={myUpcoming.length} sub="claimed & upcoming" color="var(--accent)" onClick={() => navigate('/schedule')} />
        <StatCard label="Open to claim" value={openForMe.length} sub="available now" color="var(--passed)" onClick={() => navigate('/schedule')} />
        <StatCard label="Certs to complete" value={needed.length} sub={`${passed.length} passed`} color={needed.length ? 'var(--needed)' : 'var(--passed)'} onClick={() => navigate('/my-certifications')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 18 }}>
        <Section title="Your next interval" action="My schedule →" onAction={() => navigate('/schedule')}>
          <div className="card">
            {!nextShift ? <div className="page-sub" style={{ padding: 8 }}>No upcoming intervals. Claim some time in Schedule.</div>
              : <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{formatTime(nextShift.block.start_time)} – {formatTime(nextShift.block.end_time)}</div>
                <div className="page-sub">{new Date(nextShift.block.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}{nextShift.block.role ? ` · ${nextShift.block.role}` : ''}</div>
                <div style={{ marginTop: 8 }}>
                  {nextShift.claim.checked_in_at
                    ? <span className="badge" style={{ background: 'var(--passed-bg)', color: 'var(--passed)' }}>✓ Checked in</span>
                    : nextShift.claim.status === 'no_show'
                      ? <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)' }}>No-show</span>
                      : <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>Claimed</span>}
                </div>
              </div>}
          </div>
        </Section>

        <Section title="Open intervals you can claim" action="Go claim →" onAction={() => navigate('/schedule')}>
          <div className="card">
            {openForMe.length === 0 ? <div className="page-sub" style={{ padding: 8 }}>Nothing open right now.</div>
              : openForMe.slice(0, 6).map(b => {
                const left = b.total_spots - claims.filter(c => c.shift_block_id === b.id).length
                return (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                    <div>
                      <b>{formatTime(b.start_time)}–{formatTime(b.end_time)}</b>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{new Date(b.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{b.role ? ` · ${b.role}` : ''}</div>
                    </div>
                    <span className="badge" style={{ background: 'var(--passed-bg)', color: 'var(--passed)' }}>{left} open</span>
                  </div>
                )
              })}
          </div>
        </Section>
      </div>

      {needed.length > 0 && (
        <Section title="Certifications to complete" action="My courses →" onAction={() => navigate('/my-courses')}>
          <div className="card">
            {needed.map(r => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                <span>{certName(r.certification_id)}</span>
                <span className="badge" style={{ background: r.status === 'failed' ? 'var(--failed-bg)' : 'var(--needed-bg)', color: r.status === 'failed' ? 'var(--failed)' : 'var(--needed)' }}>{r.status === 'failed' ? 'Retry' : 'To do'}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {unread.length > 0 && (
        <Section title={`Unread (${unread.length})`} action="Open chat →" onAction={() => navigate('/chat')}>
          <div className="card">
            {unread.slice(0, 4).map(n => (
              <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                <b>{n.title}</b>{n.body && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{n.body}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// Gentle daily walk reminder (wellbeing). Reads today's day_planner row.
function WalkNudge() {
  const [state, setState] = useState(null) // null=loading, {done, id}
  const [userId, setUserId] = useState(null)

  const todayISO = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!active || !user) return
      setUserId(user.id)
      const { data } = await supabase.from('day_planner').select('walk_done').eq('owner_id', user.id).eq('day', todayISO()).maybeSingle()
      if (active) setState({ done: !!data?.walk_done })
    })()
    return () => { active = false }
  }, [])

  async function markDone() {
    if (!userId) return
    setState({ done: true })
    await supabase.from('day_planner').upsert(
      { owner_id: userId, day: todayISO(), walk_done: true, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id,day' }
    )
  }

  if (!state) return null

  if (state.done) {
    return (
      <div style={{ background: 'rgba(22,163,74,.08)', border: '1px solid #16A34A', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>🌿</span>
        <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>You took your 15-minute walk today — nicely done. Your wellbeing matters to us.</span>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--accent-bg, rgba(0,119,182,.06))', border: '1px solid var(--accent, #0077B6)', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 18 }}>🚶</span>
      <span style={{ fontSize: 13.5, color: 'var(--ink)', flex: 1, minWidth: 200 }}>
        Have you taken your 15-minute walk today? A little movement is good for the body and mind — we care about your wellbeing.
      </span>
      <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={markDone}>I took my walk ✓</button>
    </div>
  )
}
