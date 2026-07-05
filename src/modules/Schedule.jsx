import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { notifyIntervalReleased } from '../lib/notify'

// ============================================================
// SCHEDULE — Stage 1
// Agent claim grid + My Schedule + release locking + 40h cap
// + overlap prevention + check-in. Admin sees full team grid.
// Ported from the standalone Opsis Schedule app into React.
// ============================================================

const WEEKLY_HOUR_CAP = 40

// ---------- date helpers (Eastern Time) ----------
function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
function mondayOf(d) {
  const x = new Date(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1 - day)
  x.setDate(x.getDate() + diff); x.setHours(0, 0, 0, 0); return x
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d })
}
function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function formatReleaseTime(date) {
  if (!date) return ''
  const isToday = date.toDateString() === etNow().toDateString()
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  return isToday ? `today at ${timeStr} ET` : `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${timeStr} ET`
}
function initials(name) {
  const p = (name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
function avatarColor(name) {
  const colors = ['#0077B6', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']
  let h = 0; for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}
function blockHours(b) {
  const [sh, sm] = b.start_time.split(':').map(Number)
  const [eh, em] = b.end_time.split(':').map(Number)
  return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60)
}
function toMin(t) { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m }

export default function Schedule() {
  const { isAdmin } = useAuth()
  const [me, setMe] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [tiers, setTiers] = useState([])
  const [schedules, setSchedules] = useState([])
  const [blocks, setBlocks] = useState([])
  const [claims, setClaims] = useState([])
  const [audience, setAudience] = useState([])
  const [certRecords, setCertRecords] = useState([])
  const [certifications, setCertifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('claim') // claim | myshifts
  const [weekStart, setWeekStart] = useState(mondayOf(etNow()))
  const [toast, setToast] = useState('')
  const [adminView, setAdminView] = useState('team') // team | mine (admins only)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [meRes, profRes, tierRes, schRes, blkRes, clmRes, audRes, recRes, certRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('id, full_name, email, tier_id, is_admin, is_active, release_penalty_until_thu').order('full_name'),
        supabase.from('performance_tiers').select('*').order('sort_order'),
        supabase.from('schedules').select('*').order('week_start_date', { ascending: false }),
        supabase.from('shift_blocks').select('*').order('block_date').order('start_time'),
        supabase.from('shift_claims').select('*'),
        supabase.from('schedule_audience').select('*'),
        supabase.from('agent_cert_records').select('*'),
        supabase.from('certifications').select('id, call_type_id, active'),
      ])
      if (meRes.error) throw meRes.error
      setMe(meRes.data)
      setProfiles(profRes.data || [])
      setTiers(tierRes.data || [])
      setSchedules(schRes.data || [])
      setBlocks(blkRes.data || [])
      setClaims(clmRes.data || [])
      setAudience(audRes.data || [])
      setCertRecords(recRes.data || [])
      setCertifications(certRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function flash(m) { setToast(m); setTimeout(() => setToast(''), 3000) }

  // ---------- visibility: audience AND passed-cert (admin bypass) ----------
  function hasPassedCertForCallType(callTypeId) {
    // Graceful gating: if NO active certification gates this call type,
    // the schedule is open to everyone. Once a gating cert is defined,
    // the person must have PASSED it.
    const gatingCertIds = certifications.filter(c => c.call_type_id === callTypeId && c.active !== false).map(c => c.id)
    if (!gatingCertIds.length) return true
    return certRecords.some(r => r.profile_id === me?.id && gatingCertIds.includes(r.certification_id) && r.status === 'passed')
  }
  function inAudience(scheduleId) {
    return audience.some(a => a.schedule_id === scheduleId && a.profile_id === me?.id)
  }
  function myVisibleSchedules(forceMine) {
    const published = schedules.filter(s => s.status === 'published')
    if (isAdmin && !forceMine) return published
    // agent (or admin in 'my view'): must hold the cert (graceful) — audience check
    // applies to non-admins; admins in my-view can claim any they're certified for.
    return published.filter(s => hasPassedCertForCallType(s.call_type_id) && (isAdmin || inAudience(s.id)))
  }

  // ---------- release status ----------
  function getMyReleaseStatus() {
    const tier = tiers.find(t => t.id === me?.tier_id)
    if (isAdmin) return { unlocked: true, tier, releaseDate: null }
    if (!tier) return { unlocked: false, tier: null, releaseDate: null }
    const now = etNow(); const day = now.getDay()
    const penalized = me?.release_penalty_until_thu === true
    if (penalized) {
      const [ph, pm] = [11, 0]
      let daysUntilThu = (4 - day + 7) % 7
      const thu = new Date(now); thu.setDate(now.getDate() + daysUntilThu); thu.setHours(ph, pm, 0, 0)
      const unlocked = day === 4 && now >= thu
      return { unlocked, tier, releaseDate: unlocked ? null : thu, penalized: true }
    }
    const [h, m] = (tier.release_time || '00:00').split(':').map(Number)
    const isWed = day === 3
    const todayRelease = new Date(now); todayRelease.setHours(h, m, 0, 0)
    // next Wednesday release
    let daysUntilWed = (3 - day + 7) % 7
    const nextWed = new Date(now); nextWed.setDate(now.getDate() + daysUntilWed); nextWed.setHours(h, m, 0, 0)
    if (daysUntilWed === 0 && nextWed < now) nextWed.setDate(nextWed.getDate() + 7)
    const unlocked = isWed && now >= todayRelease
    return { unlocked, tier, releaseDate: isWed && !unlocked ? todayRelease : nextWed }
  }

  // ---------- claim helpers ----------
  function hasIntervalStarted(block) {
    const now = etNow(); const todayStr = isoDate(now)
    if (block.block_date < todayStr) return true
    if (block.block_date > todayStr) return false
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const [h, m] = block.start_time.slice(0, 5).split(':').map(Number)
    return (h * 60 + m) <= nowMinutes
  }
  function claimedHoursInWeek(profileId, monday) {
    const wkStart = isoDate(monday); const sun = new Date(monday); sun.setDate(monday.getDate() + 6); const wkEnd = isoDate(sun)
    return blocks.filter(b => b.block_date >= wkStart && b.block_date <= wkEnd)
      .filter(b => claims.some(c => c.shift_block_id === b.id && c.profile_id === profileId))
      .reduce((s, b) => s + blockHours(b), 0)
  }
  function overlapsExisting(profileId, candidate) {
    const cs = toMin(candidate.start_time), ce = toMin(candidate.end_time)
    return blocks.some(b => {
      if (b.id === candidate.id) return false
      if (b.block_date !== candidate.block_date) return false
      if (!claims.some(c => c.shift_block_id === b.id && c.profile_id === profileId)) return false
      const bs = toMin(b.start_time), be = toMin(b.end_time)
      return cs < be && bs < ce
    })
  }

  async function claimBlock(block) {
    const existing = claims.filter(c => c.shift_block_id === block.id)
    if (existing.length >= block.total_spots) { flash('That interval just filled up'); load(); return }
    if (hasIntervalStarted(block)) { flash('That interval already started'); load(); return }
    if (overlapsExisting(me.id, block)) { flash('Overlaps an interval you already have that day'); return }
    const weekMonday = mondayOf(new Date(block.block_date + 'T00:00:00'))
    if (claimedHoursInWeek(me.id, weekMonday) + blockHours(block) > WEEKLY_HOUR_CAP) {
      flash(`No more than ${WEEKLY_HOUR_CAP} hours per week`); return
    }
    const { error } = await supabase.from('shift_claims').insert({ shift_block_id: block.id, profile_id: me.id, status: 'claimed' })
    if (error) { flash(error.code === '23505' ? 'You already claimed this' : 'That interval is full'); load(); return }
    logActivity('claimed', block)
    flash('Interval claimed'); load()
  }

  async function unclaimBlock(block) {
    if (hasIntervalStarted(block)) { flash("That interval already started — can't release"); return }
    const startsAt = new Date(`${block.block_date}T${block.start_time.slice(0, 5)}:00`)
    const hoursUntil = (startsAt.getTime() - Date.now()) / 3600000
    const wasLate = hoursUntil <= 12
    const msg = wasLate
      ? 'This is within 12 hours of start, so it counts as a late cancellation. Release anyway?'
      : 'Release this interval? Someone else may claim it.'
    if (!window.confirm(msg)) return
    await supabase.from('shift_cancellations').insert({
      shift_block_id: block.id, profile_id: me.id, schedule_id: block.schedule_id,
      block_date: block.block_date, start_time: block.start_time,
      released_at: new Date().toISOString(), was_late: wasLate,
    })
    const { error } = await supabase.from('shift_claims').delete().eq('shift_block_id', block.id).eq('profile_id', me.id)
    if (error) { flash('Could not release'); return }
logActivity(wasLate ? 'released_late' : 'released', block)
    // notify the schedule's audience that an interval opened up
    try {
      const { data: aud } = await supabase.from('schedule_audience').select('profile_id').eq('schedule_id', block.schedule_id)
      notifyIntervalReleased({
        eligibleIds: (aud || []).map(a => a.profile_id),
        actorId: me.id, actorName: me.full_name,
        when: `${formatTime(block.start_time)}–${formatTime(block.end_time)} on ${block.block_date}`,
        position: block.role || null,
      })
    } catch (e) { /* non-blocking */ }
    flash(wasLate ? 'Released (late cancellation)' : 'Interval released'); load()
  }

  async function checkIn(claimId, block) {
    const { error } = await supabase.from('shift_claims').update({ checked_in_at: new Date().toISOString(), status: 'checked_in' }).eq('id', claimId)
    if (error) { flash('Error checking in'); return }
    if (block) logActivity('checked_in', block)
    flash("You're checked in!"); load()
  }

  async function logActivity(action, block) {
    try {
      const schedule = block ? schedules.find(s => s.id === block.schedule_id) : null
      const blockLabel = block ? `${formatTime(block.start_time)}–${formatTime(block.end_time)} on ${block.block_date}` : null
      await supabase.from('schedule_activity_log').insert({
        actor_id: me.id, action, schedule_id: schedule?.id || null, schedule_title: schedule?.title || null,
        shift_block_id: block?.id || null, block_label: blockLabel,
        affected_profile_name: me.full_name || null,
      })
    } catch (e) { /* non-blocking */ }
  }

  if (loading) return <p className="page-sub">Loading schedule…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Schedule</h1>
          <p className="page-sub">Claim your intervals for the week. First come, first served.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={'btn ' + (tab === 'claim' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('claim')}>Schedule</button>
          <button className={'btn ' + (tab === 'myshifts' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('myshifts')}>My schedule</button>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--ink)', color: '#fff', padding: '11px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>{toast}</div>}

      {tab === 'claim' ? (
        <ClaimView
          isAdmin={isAdmin} adminView={adminView} setAdminView={setAdminView}
          me={me} profiles={profiles} tiers={tiers}
          schedules={myVisibleSchedules(isAdmin && adminView === 'mine')} blocks={blocks} claims={claims}
          weekStart={weekStart} setWeekStart={setWeekStart}
          releaseStatus={getMyReleaseStatus()}
          claimedHoursInWeek={claimedHoursInWeek} hasIntervalStarted={hasIntervalStarted}
          onClaim={claimBlock} onUnclaim={unclaimBlock} onCheckIn={checkIn}
        />
      ) : (
        <MyScheduleView me={me} blocks={blocks} claims={claims} hasIntervalStarted={hasIntervalStarted} onUnclaim={unclaimBlock} onCheckIn={checkIn} />
      )}
    </div>
  )
}

// Sub-components live in the same file (Stage 1). Placeholder imports resolved below.
function ClaimView(props) {
  const { isAdmin, adminView, setAdminView, me, profiles, schedules, blocks, claims, weekStart, setWeekStart, releaseStatus,
    claimedHoursInWeek, hasIntervalStarted, onClaim, onUnclaim, onCheckIn } = props
  const [popBlock, setPopBlock] = useState(null)
  // Admins in 'team' view see the team grid; everyone else (agents, and
  // admins who switched to 'My view') see the personal claim grid.
  const teamMode = isAdmin && adminView === 'team'

  if (!schedules.length) {
    return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>
      {isAdmin ? 'No published schedules yet. Create one in the Schedule Builder (coming in the next stage).' : "No schedule published for you yet. Check back once your admin publishes one you're part of."}
    </div></div>
  }
  if (!isAdmin && !releaseStatus.unlocked) {
    return <ReleaseLocked status={releaseStatus} />
  }

  const monday = weekStart
  const days = weekDates(monday)
  const todayStr = isoDate(etNow())
  const scheduleIds = new Set(schedules.map(s => s.id))
  const weekBlocks = blocks.filter(b => scheduleIds.has(b.schedule_id))

  function shiftWeek(dir) { const d = new Date(monday); d.setDate(monday.getDate() + dir * 7); setWeekStart(d) }

  return (
    <div>
      {!teamMode && !isAdmin && <ReleaseBanner status={releaseStatus} />}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button className={'btn ' + (adminView === 'team' ? 'btn-primary' : 'btn-ghost')} onClick={() => setAdminView('team')}>Team view</button>
          <button className={'btn ' + (adminView === 'mine' ? 'btn-primary' : 'btn-ghost')} onClick={() => setAdminView('mine')}>My view</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn btn-ghost" onClick={() => shiftWeek(-1)}>‹</button>
          <div style={{ fontSize: 13, fontWeight: 600, minWidth: 150, textAlign: 'center' }}>
            {days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
          <button className="btn btn-ghost" onClick={() => shiftWeek(1)}>›</button>
        </div>
        <button className="btn btn-ghost" onClick={() => setWeekStart(mondayOf(etNow()))}>Today</button>
        {!teamMode && <HoursCap hours={claimedHoursInWeek(me.id, monday)} />}
      </div>

      {teamMode
        ? <AdminGrid days={days} todayStr={todayStr} weekBlocks={weekBlocks} claims={claims} profiles={profiles} onPop={setPopBlock} />
        : <AgentGrid days={days} todayStr={todayStr} weekBlocks={weekBlocks} claims={claims} me={me} hasIntervalStarted={hasIntervalStarted} onPop={setPopBlock} />}

      {popBlock && <IntervalPopover
        block={popBlock} claims={claims} profiles={profiles} me={me} canClaim={!teamMode}
        hasIntervalStarted={hasIntervalStarted}
        onClose={() => setPopBlock(null)}
        onClaim={(b) => { onClaim(b); setPopBlock(null) }}
        onUnclaim={(b) => { onUnclaim(b); setPopBlock(null) }}
        onCheckIn={(cid, b) => { onCheckIn(cid, b); setPopBlock(null) }}
      />}
    </div>
  )
}

function HoursCap({ hours }) {
  const pct = Math.min(100, Math.round((hours / WEEKLY_HOUR_CAP) * 100))
  const over = hours >= WEEKLY_HOUR_CAP
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: over ? 'var(--failed)' : 'var(--ink-soft)' }}>{hours.toFixed(2) * 1} / {WEEKLY_HOUR_CAP} h</span>
      <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: over ? 'var(--failed)' : 'var(--accent)', borderRadius: 3 }} />
      </div>
    </div>
  )
}

function ReleaseBanner({ status }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (status.unlocked || !status.releaseDate) return
    const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t)
  }, [status])
  if (status.unlocked) {
    return <div style={{ background: 'var(--passed-bg)', border: '1px solid var(--passed)', borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--passed)' }}>Schedule is open</div>
      <div style={{ fontSize: 13, color: 'var(--passed)' }}>As a {status.tier?.name}, you can claim intervals now.</div>
    </div>
  }
  if (!status.releaseDate) return null
  const diff = status.releaseDate.getTime() - now
  const h = String(Math.max(0, Math.floor(diff / 3600000))).padStart(2, '0')
  const m = String(Math.max(0, Math.floor((diff % 3600000) / 60000))).padStart(2, '0')
  const s = String(Math.max(0, Math.floor((diff % 60000) / 1000))).padStart(2, '0')
  return <div style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
    <div style={{ fontSize: 13, color: 'var(--accent)' }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>Schedule unlocks soon</div>
      As a {status.tier?.name}, your release is {formatReleaseTime(status.releaseDate)}.{status.penalized ? ' (Held to Thursday due to recent no-shows.)' : ''}
    </div>
    <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--accent)' }}>{h}:{m}:{s}</div>
  </div>
}

function ReleaseLocked({ status }) {
  return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>
    <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}>Schedule locks until your release time</div>
    {status.tier
      ? <>As a {status.tier.name}, you can view and claim intervals starting {formatReleaseTime(status.releaseDate)}.</>
      : 'No tier is assigned to your account yet — contact your admin.'}
  </div></div>
}

// ---------- AGENT GRID ----------
function AgentGrid({ days, todayStr, weekBlocks, claims, me, hasIntervalStarted, onPop }) {
  const dayHeads = days.map(d => {
    const ds = isoDate(d)
    const mine = weekBlocks.filter(b => b.block_date === ds && claims.some(c => c.shift_block_id === b.id && c.profile_id === me.id))
    return <div key={ds} className={'wg-dayhead' + (ds === todayStr ? ' today' : '')}>
      <div className="wg-dayname">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
      <div className="wg-daydate">{d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</div>
      <div className="wg-daymeta">{mine.length} interval{mine.length !== 1 ? 's' : ''}</div>
    </div>
  })

  const myCells = days.map(d => {
    const ds = isoDate(d)
    const items = weekBlocks.filter(b => b.block_date === ds && claims.some(c => c.shift_block_id === b.id && c.profile_id === me.id))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map(b => {
        const claim = claims.find(c => c.shift_block_id === b.id && c.profile_id === me.id)
        let cls = 'mine'; if (claim?.checked_in_at) cls += ' checkedin'; if (claim?.status === 'no_show') cls = 'noshow'
        return <Iv key={b.id} block={b} cls={cls} time={`${formatTime(b.start_time)}–${formatTime(b.end_time)}`} role={b.role} onPop={onPop} />
      })
    return <div key={ds} className={'wg-cell' + (ds === todayStr ? ' today' : '') + (items.length ? '' : ' dim')}>{items}</div>
  })

  const openCells = days.map(d => {
    const ds = isoDate(d)
    const items = weekBlocks.filter(b => {
      if (b.block_date !== ds) return false
      if (hasIntervalStarted(b)) return false
      const cl = claims.filter(c => c.shift_block_id === b.id)
      if (cl.length >= b.total_spots) return false
      if (cl.some(c => c.profile_id === me.id)) return false
      return true
    }).sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map(b => {
        const left = b.total_spots - claims.filter(c => c.shift_block_id === b.id).length
        return <Iv key={b.id} block={b} cls="open" spots={`${left} open`} time={`${formatTime(b.start_time)}–${formatTime(b.end_time)}`} role={b.role} onPop={onPop} />
      })
    return <div key={ds} className={'wg-cell' + (ds === todayStr ? ' today' : '') + (items.length ? '' : ' dim')}>{items}</div>
  })

  return <div className="grid-scroll">
    <div className="week-grid">
      <div className="wg-corner">Schedule</div>
      {dayHeads}
      <div className="wg-rowlabel">
        <div className="wg-avatar" style={{ background: avatarColor(me.full_name || 'You') }}>{initials(me.full_name || 'You')}</div>
        <div><div className="wg-person-name">Your intervals</div></div>
      </div>
      {myCells}
      <div className="wg-rowlabel" style={{ background: 'var(--canvas)' }}>
        <div className="wg-avatar" style={{ background: 'var(--ink-soft)' }}>+</div>
        <div><div className="wg-person-name">Open intervals</div><div className="wg-person-sub">Available to claim</div></div>
      </div>
      {openCells}
    </div>
  </div>
}

// ---------- ADMIN GRID ----------
function AdminGrid({ days, todayStr, weekBlocks, claims, profiles, onPop }) {
  const wkStart = isoDate(days[0]); const wkEnd = isoDate(days[6])
  const inWeek = weekBlocks.filter(b => b.block_date >= wkStart && b.block_date <= wkEnd)
  const claimantIds = new Set(inWeek.flatMap(b => claims.filter(c => c.shift_block_id === b.id).map(c => c.profile_id)))
  const rows = [{ id: '__open__', full_name: 'Open intervals', __open: true }, ...profiles.filter(p => claimantIds.has(p.id))]

  const dayHeads = days.map(d => {
    const ds = isoDate(d); const db = inWeek.filter(b => b.block_date === ds)
    const spots = db.reduce((s, b) => s + b.total_spots, 0)
    const claimed = db.reduce((s, b) => s + claims.filter(c => c.shift_block_id === b.id).length, 0)
    return <div key={ds} className={'wg-dayhead' + (ds === todayStr ? ' today' : '')}>
      <div className="wg-dayname">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
      <div className="wg-daydate">{d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</div>
      <div className="wg-daymeta">{claimed}/{spots} claimed</div>
    </div>
  })

  const body = rows.map(person => {
    const label = person.__open
      ? <div className="wg-rowlabel" style={{ background: 'var(--canvas)' }}>
          <div className="wg-avatar" style={{ background: 'var(--ink-soft)' }}>+</div>
          <div><div className="wg-person-name">Open intervals</div><div className="wg-person-sub">Unclaimed</div></div>
        </div>
      : <div className="wg-rowlabel">
          <div className="wg-avatar" style={{ background: avatarColor(person.full_name) }}>{initials(person.full_name)}</div>
          <div><div className="wg-person-name">{person.full_name}</div></div>
        </div>
    const cells = days.map(d => {
      const ds = isoDate(d)
      const cellBlocks = inWeek.filter(b => b.block_date === ds).sort((a, b) => a.start_time.localeCompare(b.start_time))
      const items = cellBlocks.map(b => {
        const cl = claims.filter(c => c.shift_block_id === b.id)
        const left = b.total_spots - cl.length
        if (person.__open) {
          if (left <= 0) return null
          return <Iv key={b.id} block={b} cls="open" spots={`${left} open`} time={`${formatTime(b.start_time)}–${formatTime(b.end_time)}`} role={b.role} onPop={onPop} />
        }
        const theirs = cl.find(c => c.profile_id === person.id)
        if (!theirs) return null
        let cls = 'taken'; if (theirs.checked_in_at) cls += ' checkedin'; if (theirs.status === 'no_show') cls = 'noshow'
        return <Iv key={b.id} block={b} cls={cls} time={`${formatTime(b.start_time)}–${formatTime(b.end_time)}`} role={b.role} onPop={onPop} />
      })
      return <div key={ds} className={'wg-cell' + (ds === todayStr ? ' today' : '') + (items.some(Boolean) ? '' : ' dim')}>{items}</div>
    })
    return <React.Fragment key={person.id}>{label}{cells}</React.Fragment>
  })

  return <div className="grid-scroll">
    <div className="week-grid">
      <div className="wg-corner">Team</div>
      {dayHeads}
      {body}
    </div>
  </div>
}

function Iv({ block, cls, spots, time, role, onPop }) {
  return <div className={'iv ' + cls} onClick={() => onPop(block)}>
    <div className="iv-time">{time}</div>
    {role && <div className="iv-sub">{role}</div>}
    {spots && <div className="iv-spots">{spots}</div>}
  </div>
}

// ---------- INTERVAL POPOVER ----------
function IntervalPopover({ block, claims, profiles, me, canClaim, hasIntervalStarted, onClose, onClaim, onUnclaim, onCheckIn }) {
  const cl = claims.filter(c => c.shift_block_id === block.id)
  const mine = cl.find(c => c.profile_id === me.id)
  const left = block.total_spots - cl.length
  const isFull = left <= 0
  const started = hasIntervalStarted(block)
  const names = cl.map(c => profiles.find(p => p.id === c.profile_id)?.full_name?.split(' ')[0] || '').filter(Boolean).join(', ')

  return <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
    <div className="modal" style={{ width: 380 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{formatTime(block.start_time)} – {formatTime(block.end_time)}</div>
      <div className="page-sub" style={{ marginBottom: 14 }}>{new Date(block.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, marginBottom: 16 }}>
        {block.role && <Row k="Role" v={block.role} />}
        <Row k="Spots" v={`${left > 0 ? left : 0} of ${block.total_spots} open`} />
        {names && <Row k="Claimed by" v={names} />}
        {block.notes && <Row k="Notes" v={block.notes} />}
        {mine?.checked_in_at && <Row k="Status" v="Checked in" />}
        {mine?.status === 'no_show' && <Row k="Status" v="No-show" />}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        {mine ? <>
          {!started && !mine.checked_in_at && mine.status !== 'no_show' && <button className="btn btn-ghost" style={{ color: 'var(--failed)' }} onClick={() => onUnclaim(block)}>Release spot</button>}
          {started && !mine.checked_in_at && mine.status !== 'no_show' && <button className="btn btn-primary" onClick={() => onCheckIn(mine.id, block)}>Check in</button>}
        </> : (!isFull && !started && canClaim && <button className="btn btn-primary" onClick={() => onClaim(block)}>Claim this interval</button>)}
      </div>
    </div>
  </div>
}
function Row({ k, v }) { return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ color: 'var(--ink-soft)' }}>{k}</span><span>{v}</span></div> }

// ---------- MY SCHEDULE ----------
function MyScheduleView({ me, blocks, claims, hasIntervalStarted, onUnclaim, onCheckIn }) {
  const myClaims = claims.filter(c => c.profile_id === me.id)
  if (!myClaims.length) return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>No intervals claimed yet. Head to Schedule to pick up some time.</div></div>
  const entries = myClaims.map(c => ({ claim: c, block: blocks.find(b => b.id === c.shift_block_id) })).filter(e => e.block)
  const todayStr = isoDate(etNow())
  const upcoming = entries.filter(e => e.block.block_date >= todayStr).sort((a, b) => (a.block.block_date + a.block.start_time).localeCompare(b.block.block_date + b.block.start_time))
  const past = entries.filter(e => e.block.block_date < todayStr).sort((a, b) => (b.block.block_date + b.block.start_time).localeCompare(a.block.block_date + a.block.start_time))

  const byDate = {}
  upcoming.forEach(e => { (byDate[e.block.block_date] = byDate[e.block.block_date] || []).push(e) })

  return <div>
    {Object.keys(byDate).length ? Object.keys(byDate).sort().map(date => (
      <div key={date} style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginBottom: 10 }}>
          {date === todayStr ? 'Today · ' : ''}{new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 12 }}>
          {byDate[date].map(e => <ShiftCard key={e.claim.id} block={e.block} claim={e.claim} isPast={false} started={hasIntervalStarted(e.block)} onUnclaim={onUnclaim} onCheckIn={onCheckIn} />)}
        </div>
      </div>
    )) : <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 20 }}>No upcoming intervals.</div></div>}

    {past.length > 0 && <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginBottom: 10, opacity: .6 }}>Past intervals</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 12 }}>
        {past.slice(0, 12).map(e => <ShiftCard key={e.claim.id} block={e.block} claim={e.claim} isPast={true} started={true} onUnclaim={onUnclaim} onCheckIn={onCheckIn} />)}
      </div>
    </div>}
  </div>
}

function ShiftCard({ block, claim, isPast, started, onUnclaim, onCheckIn }) {
  const checkedIn = claim?.checked_in_at; const noShow = claim?.status === 'no_show'
  return <div className="iv mine" style={{ cursor: 'default', padding: '14px 16px' }}>
    <div className="iv-time" style={{ fontSize: 15 }}>{formatTime(block.start_time)} – {formatTime(block.end_time)}</div>
    {block.role && <div className="iv-sub" style={{ fontSize: 12, marginBottom: 4 }}>{block.role}</div>}
    {!isPast && (checkedIn
      ? <div style={{ fontSize: 12, color: 'var(--passed)', fontWeight: 600, margin: '8px 0' }}>✓ Checked in</div>
      : noShow ? <div style={{ fontSize: 12, color: 'var(--failed)', fontWeight: 600, margin: '8px 0' }}>Marked no-show</div>
        : <button className="btn btn-primary" style={{ width: '100%', fontSize: 12, marginTop: 8 }} onClick={() => onCheckIn(claim.id, block)}>I'm here — check in</button>)}
    {!isPast && !started && <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, marginTop: 6, color: 'var(--failed)' }} onClick={() => onUnclaim(block)}>Release this spot</button>}
    {block.notes && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>{block.notes}</div>}
  </div>
}
