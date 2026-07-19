import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'
import { notifyIntervalReleased, notifyNoShow, notifyIntervalAssigned } from '../lib/notify'
import { COMPANY_TZ, wallTimeToViewer } from '../lib/tz'

// Convert a company-zone wall time on a given date to the viewer's local "h:mm AM".
function blockTimeInViewer(dateStr, timeStr, viewerTZ) {
  if (!timeStr) return ''
  if (!viewerTZ || viewerTZ === COMPANY_TZ) return formatTime(timeStr)
  return wallTimeToViewer(dateStr, timeStr, COMPANY_TZ, viewerTZ)
}

// ============================================================
// SCHEDULE
// Agent claim grid + My Schedule + release locking + 40h cap
// + overlap prevention + check-in. Admin sees full team grid.
//
// SAFETY NOTE: the checks in this file give agents instant
// feedback, but the DATABASE is the real authority. A trigger
// (schedule_guards.sql) enforces capacity, same-day overlap, and
// the 40-hour cap inside Postgres, so a stale page can't sneak a
// bad claim through. claimBlock() surfaces those errors clearly.
// ============================================================

const WEEKLY_HOUR_CAP = 40

// While realtime postgres_changes delivery is unreliable, poll so the
// grid doesn't go stale and agents rarely collide. Remove once realtime works.
const POLL_MS = 20000

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

// Hours a person has claimed inside one Mon–Sun window.
// Counts every claim status: claimed, checked_in, and no_show. A no-show still
// occupied the seat, so it still counts against their week.
function personWeekHours(profileId, weekBlocks, claims, mondayIso, sundayIso) {
  return weekBlocks
    .filter(b => b.block_date >= mondayIso && b.block_date <= sundayIso)
    .filter(b => claims.some(c => c.shift_block_id === b.id && c.profile_id === profileId))
    .reduce((s, b) => s + blockHours(b), 0)
}

// 40 -> "40", 7.5 -> "7.5", 7.25 -> "7.25". The rounding also scrubs float
// drift, so 39.999999999 renders as "40" rather than "40.00".
function fmtHours(h) { return (Math.round(h * 100) / 100).toString() }

// Map a tier's release_day text ('wednesday') to JS getDay() (0=Sun … 6=Sat).
// Falls back to Wednesday if the value is missing or unrecognized.
const DAY_INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
function releaseDayIndex(tier) {
  const key = (tier?.release_day || '').trim().toLowerCase()
  return key in DAY_INDEX ? DAY_INDEX[key] : 3
}

export default function Schedule() {
  const { isAdmin, appRole } = useAuth()
  // Certification (and admin) can VIEW every published schedule read-only,
  // even ones they're not in the audience for. Claiming stays audience-gated.
  const canViewAll = isAdmin || can(appRole, 'schedule.view_all_schedules')
  // Roles with no release times (e.g. ASC) always have the full rolling window
  // unlocked — no daily release-time wait, no release banner.
  const noReleaseTimes = isAdmin || can(appRole, 'schedule.no_release_times')
  // Managers who can place agents directly onto intervals (Admin + ASC).
  const canAssign = isAdmin || can(appRole, 'schedule.ability_to_assign_intervals_to_agents')
  // Fill Rate command panel — Admin + ASC (schedule insights).
  const canFillRate = isAdmin || can(appRole, 'schedule.view_insights_assigned')
  const [me, setMe] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [tiers, setTiers] = useState([])
  const [schedules, setSchedules] = useState([])
  const [blocks, setBlocks] = useState([])
  const [claims, setClaims] = useState([])
  const [trades, setTrades] = useState([])   // open interval-trade offers
  const [audience, setAudience] = useState([])
  const [certRecords, setCertRecords] = useState([])
  const [certifications, setCertifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('claim') // claim | myshifts | trade
  const [weekStart, setWeekStart] = useState(mondayOf(etNow()))

  // Once the data loads, jump to the first week that actually has intervals the
  // person can claim, so nobody opens to an empty grid. Only fires once — after
  // that the agent's own ‹ › navigation is left alone.
  const didAutoJump = React.useRef(false)
  const [toast, setToast] = useState('')
  const [adminView, setAdminView] = useState('team') // team | mine (admins only)

  // `silent` skips the loading spinner, so background polling doesn't flicker
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [meRes, profRes, tierRes, schRes, blkRes, clmRes, audRes, recRes, certRes, trdRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('id, full_name, email, tier_id, is_admin, is_active, release_penalty_until_thu').order('full_name'),
        supabase.from('performance_tiers').select('*').order('sort_order'),
        supabase.from('schedules').select('*').order('week_start_date', { ascending: false }),
        supabase.from('shift_blocks').select('*').order('block_date').order('start_time'),
        supabase.from('shift_claims').select('*'),
        supabase.from('schedule_audience').select('*'),
        supabase.from('agent_cert_records').select('*'),
        supabase.from('certifications').select('id, call_type_id, active'),
        supabase.from('interval_trades').select('*').eq('status', 'open'),
      ])
      if (meRes.error) throw meRes.error
      setMe(meRes.data)
      setProfiles(profRes.data || [])
      setTiers(tierRes.data || [])
      setSchedules(schRes.data || [])
      setBlocks(blkRes.data || [])
      setClaims(clmRes.data || [])
      setTrades(trdRes.data || [])
      setAudience(audRes.data || [])
      setCertRecords(recRes.data || [])
      setCertifications(certRes.data || [])
    } catch (e) { setErr(e.message) } finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Keep the grid fresh: realtime + a polling fallback. Whichever fires first
  // wins; both just call load(). Polling covers us while realtime is unreliable.
  useEffect(() => {
    const ch = supabase.channel('schedule-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_claims' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_blocks' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interval_trades' }, () => load(true))
      .subscribe()
    const t = setInterval(() => load(true), POLL_MS)
    return () => { supabase.removeChannel(ch); clearInterval(t) }
  }, [load])

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
    // View-all roles (e.g. Certification) see every published schedule read-only.
    // They can only CLAIM where inAudience() — enforced in the claim handler.
    if (canViewAll && !forceMine) return published
    // Agents must hold the gating cert (graceful) + be in the audience.
    // All other roles skip the cert gate — their assigned schedules are
    // always available to them. Audience membership is still required.
    return published.filter(s => (noReleaseTimes || hasPassedCertForCallType(s.call_type_id)) && (isAdmin || inAudience(s.id)))
  }

  // ---------- open on the first week that has intervals ----------
  // Agents shouldn't land on an empty grid just because this week's shifts are
  // over and next week's haven't been reached yet. Find the soonest interval
  // (today or later) in a schedule they can see, and open that week instead.
  // Runs once, after the first load — manual ‹ › navigation is never overridden.
  useEffect(() => {
    if (didAutoJump.current) return
    if (loading || !me || !schedules.length || !blocks.length) return
    didAutoJump.current = true
    const visibleIds = new Set(myVisibleSchedules(isAdmin && adminView === 'mine').map(s => s.id))
    if (!visibleIds.size) return
    const todayStr = isoDate(etNow())
    const upcoming = blocks
      .filter(b => visibleIds.has(b.schedule_id) && b.block_date >= todayStr)
      .sort((a, b) => (a.block_date + a.start_time).localeCompare(b.block_date + b.start_time))
    if (!upcoming.length) return   // nothing ahead; stay on the current week
    const firstWeek = mondayOf(new Date(upcoming[0].block_date + 'T00:00:00'))
    if (isoDate(firstWeek) !== isoDate(weekStart)) setWeekStart(firstWeek)
  }, [loading, me, schedules, blocks, audience, certRecords, certifications, isAdmin, adminView]) // eslint-disable-line

  // ---------- release status (daily 14-day rolling window) ----------
  // Each agent sees unfilled intervals from today through today+13 always,
  // and today+14 once the current time passes their tier release time today.
  // Tier release_time staggers WHEN each new day unlocks; no more weekly day.
  // No-tier (new) agents default to 11:45. Times are Eastern.
  function getMyReleaseStatus() {
    const tier = tiers.find(t => t.id === me?.tier_id)
    // No-release-time roles (everyone except agents) see every interval on
    // their schedules with no rolling-window cutoff at all.
    if (noReleaseTimes) return { unlocked: true, tier, horizonDays: 3650, releaseDate: null, nextUnlock: null }
    const now = etNow()

    let h, m
    if (tier && tier.release_time) { [h, m] = tier.release_time.split(':').map(Number) }
    else { h = 11; m = 45 }   // no-tier default

    const todayRelease = new Date(now); todayRelease.setHours(h, m, 0, 0)
    const passedToday = now >= todayRelease
    // horizon: +14 once today's release time has passed, else +13
    const horizonDays = passedToday ? 14 : 13
    // next unlock moment: today's release if not yet passed, else tomorrow's
    const nextUnlock = new Date(todayRelease)
    if (passedToday) nextUnlock.setDate(nextUnlock.getDate() + 1)

    return { unlocked: true, tier, horizonDays, releaseDate: nextUnlock, nextUnlock, releaseTime: { h, m } }
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
    return personWeekHours(profileId, blocks, claims, wkStart, wkEnd)
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
    // Audience guard: view-all roles (Certification) can SEE every schedule,
    // but may only claim intervals on schedules they're in the audience for.
    // Admins bypass. This mirrors the DB guard and gives instant feedback.
    if (!isAdmin && !inAudience(block.schedule_id)) {
      flash("You can view this schedule but can't claim intervals on it."); return
    }
    // Fast client-side checks: instant feedback, no round trip. These can be
    // wrong if the page is stale — the database trigger is the real guard.
    if (!noReleaseTimes) {
      const rs = getMyReleaseStatus()
      const horizon = etNow(); horizon.setDate(horizon.getDate() + (rs.horizonDays ?? 13))
      if (block.block_date > isoDate(horizon)) {
        flash(`That interval isn't available yet — it unlocks at your release time.`); return
      }
    }
    const existing = claims.filter(c => c.shift_block_id === block.id)
    if (existing.length >= block.total_spots) { flash('That interval just filled up'); load(true); return }
    // NOTE: intentionally no "already started" block here — agents may pick up
    // an interval at any time, including after it has started or ended. Late
    // check-in flagging still applies, so lateness stays visible to managers.
    if (hasIntervalStarted(block)) { /* allowed: late pickup */ }
    if (overlapsExisting(me.id, block)) { flash('Overlaps an interval you already have that day'); return }
    const weekMonday = mondayOf(new Date(block.block_date + 'T00:00:00'))
    if (claimedHoursInWeek(me.id, weekMonday) + blockHours(block) > WEEKLY_HOUR_CAP) {
      flash(`No more than ${WEEKLY_HOUR_CAP} hours per week`); return
    }

    const { error } = await supabase.from('shift_claims').insert({ shift_block_id: block.id, profile_id: me.id, status: 'claimed' })
    if (error) {
      // The database rejected it — it knows the truth even when this page
      // doesn't (e.g. someone took the last spot a second ago). Show why.
      const msg = error.message || ''
      if (error.code === '23505') flash('You already claimed this')
      else if (msg.includes('already full')) flash('That interval just filled up')
      else if (msg.includes('overlaps')) flash('That overlaps an interval you already claimed')
      else if (msg.includes('40 hours')) flash('That would put you over 40 hours this week')
      else if (msg.includes('no longer exists')) flash('That interval was removed')
      else flash('Could not claim that interval')
      load(true)
      return
    }
    logActivity('claimed', block)
    flash('Interval claimed'); load(true)
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

    // Deleting the claim frees the seat. The block reappears in "Open intervals"
    // for everyone whose tier has already unlocked — first come, first served.
    const { error } = await supabase.from('shift_claims').delete().eq('shift_block_id', block.id).eq('profile_id', me.id)
    if (error) { flash('Could not release'); return }
    logActivity(wasLate ? 'released_late' : 'released', block)

    try {
      const { data: aud } = await supabase.from('schedule_audience').select('profile_id').eq('schedule_id', block.schedule_id)
      notifyIntervalReleased({
        eligibleIds: (aud || []).map(a => a.profile_id),
        actorId: me.id, actorName: me.full_name,
        when: `${formatTime(block.start_time)}–${formatTime(block.end_time)} on ${block.block_date}`,
        position: block.role || null,
      })
    } catch (e) { /* non-blocking */ }

    flash(wasLate ? 'Released (late cancellation)' : 'Interval released'); load(true)
  }

  // ---------- interval trading ----------
  // Put your interval up for others to take WITHOUT releasing it. If nobody
  // accepts, you still hold it and stay accountable.
  const scheduleOf = (block) => schedules.find(s => s.id === block?.schedule_id)
  const certOkForBlock = (block) => { const s = scheduleOf(block); return s ? hasPassedCertForCallType(s.call_type_id) : true }
  const myOpenTradeFor = (blockId) => trades.find(tr => tr.shift_block_id === blockId && tr.offered_by === me?.id)

  async function offerTrade(block) {
    const { error } = await supabase.rpc('offer_interval_trade', { p_shift_block_id: block.id })
    if (error) { flash(error.message || 'Could not put that up for trade'); return }
    flash('Put on the trade board — you still hold it until someone takes it'); load(true)
  }
  async function cancelTrade(trade) {
    const { error } = await supabase.rpc('cancel_interval_trade', { p_trade_id: trade.id })
    if (error) { flash(error.message || 'Could not cancel that offer'); return }
    flash('Taken off the trade board'); load(true)
  }
  async function acceptTrade(trade) {
    const { error } = await supabase.rpc('accept_interval_trade', { p_trade_id: trade.id })
    if (error) { flash(error.message || 'Could not accept that interval'); return }
    flash("Interval accepted — it's yours now"); load(true)
  }

  async function markNoShow(claim, block) {
    if (!window.confirm('Mark this person as a no-show for this interval?')) return
    const { error } = await supabase.from('shift_claims').update({ status: 'no_show' }).eq('id', claim.id)
    if (error) { flash('Could not mark no-show'); return }
    logActivity('marked_no_show', block)
    try {
      notifyNoShow({
        recipientId: claim.profile_id,
        when: `${formatTime(block.start_time)}–${formatTime(block.end_time)} on ${block.block_date}`,
      })
    } catch (e) { /* non-blocking */ }
    flash('Marked as no-show'); load(true)
  }

  async function checkIn(claimId, block) {
    const { error } = await supabase.from('shift_claims').update({ checked_in_at: new Date().toISOString(), status: 'checked_in' }).eq('id', claimId)
    if (error) { flash('Error checking in'); return }
    if (block) logActivity('checked_in', block)
    flash("You're checked in!"); load(true)
  }

  // ---- Unpaid breaks: pause the check-in, resume when back ----
  const [openBreaks, setOpenBreaks] = useState({}) // claim_id -> open break row
  const loadBreaks = useCallback(async () => {
    const { data } = await supabase.from('shift_breaks').select('*').is('ended_at', null)
    const map = {}; (data || []).forEach(b => { map[b.claim_id] = b })
    setOpenBreaks(map)
  }, [])
  useEffect(() => { loadBreaks() }, [loadBreaks])

  async function startBreak(claim, block) {
    const { error } = await supabase.from('shift_breaks')
      .insert({ claim_id: claim.id, profile_id: claim.profile_id })
    if (error) { flash(error.message.includes('duplicate') ? "You're already on a break." : 'Could not start break'); return }
    if (block) logActivity('break_started', block)
    flash('Break started — see you soon! ☕'); loadBreaks()
  }

  async function endBreak(claim, block) {
    const { error } = await supabase.from('shift_breaks')
      .update({ ended_at: new Date().toISOString() })
      .eq('claim_id', claim.id).is('ended_at', null)
    if (error) { flash('Could not end break'); return }
    if (block) logActivity('break_ended', block)
    flash("Welcome back — you're checked in!"); loadBreaks()
  }

  // Grace window (minutes) on each side of scheduled end. Within → clean 'completed'.
  // Outside (early or late) → requires a note, lands as 'pending_review' for admin approval.
  const GRACE_MIN = 15

  async function checkOut(claimId, block, note) {
    const nowISO = new Date().toISOString()
    let status = 'completed'
    if (block) {
      const end = new Date(`${block.block_date}T${block.end_time.slice(0, 5)}:00`)
      const diffMin = Math.abs((etNow() - end) / 60000)
      if (diffMin > GRACE_MIN) status = 'pending_review'
    }
    if (status === 'pending_review' && !(note && note.trim())) {
      flash('A note is required when checking out well outside your scheduled time.')
      return { needsNote: true }
    }
    const payload = { checked_out_at: nowISO, status }
    if (note && note.trim()) payload.checkout_note = note.trim()
    const { error } = await supabase.from('shift_claims').update(payload).eq('id', claimId)
    if (error) { flash('Error checking out'); return {} }
    // Checking out while on a break ends the break too.
    await supabase.from('shift_breaks').update({ ended_at: nowISO }).eq('claim_id', claimId).is('ended_at', null)
    loadBreaks()
    if (block) logActivity('checked_out', block)
    flash(status === 'pending_review' ? "Checked out — sent to admin for review." : "You're checked out — nice work!")
    load(true)
    return { ok: true }
  }

  // ---------- manager assignment (Admin + ASC) ----------
  async function assignBlock(block, profileId) {
    const target = profiles.find(p => p.id === profileId)
    if (!target) { flash('Pick a person to assign'); return }
    const existing = claims.filter(c => c.shift_block_id === block.id)
    if (existing.length >= block.total_spots) { flash('That interval is already full'); load(true); return }
    if (existing.some(c => c.profile_id === profileId)) { flash(`${target.full_name} is already on this interval`); return }
    if (overlapsExisting(profileId, block)) { flash(`${target.full_name} already has an overlapping interval that day`); return }
    const weekMonday = mondayOf(new Date(block.block_date + 'T00:00:00'))
    if (claimedHoursInWeek(profileId, weekMonday) + blockHours(block) > WEEKLY_HOUR_CAP) {
      flash(`That would put ${target.full_name} over ${WEEKLY_HOUR_CAP} hours this week`); return
    }

    const { error } = await supabase.from('shift_claims').insert({ shift_block_id: block.id, profile_id: profileId, status: 'claimed' })
    if (error) {
      const msg = error.message || ''
      if (error.code === '23505') flash(`${target.full_name} already claimed this`)
      else if (msg.includes('already full')) flash('That interval just filled up')
      else if (msg.includes('overlaps')) flash(`That overlaps an interval ${target.full_name} already has`)
      else if (msg.includes('40 hours')) flash(`That would put ${target.full_name} over 40 hours this week`)
      else flash('Could not assign that interval')
      load(true)
      return
    }
    logActivity('assigned', block, target.full_name)
    try {
      notifyIntervalAssigned({
        recipientId: profileId, actorId: me.id, actorName: me.full_name,
        when: `${formatTime(block.start_time)}–${formatTime(block.end_time)} on ${block.block_date}`,
      })
    } catch (e) { /* non-blocking */ }
    flash(`Assigned to ${target.full_name}`); load(true)
  }

  async function unassignBlock(claim, block) {
    const target = profiles.find(p => p.id === claim.profile_id)
    if (!window.confirm(`Remove ${target?.full_name || 'this person'} from this interval?`)) return
    // Manager removal — intentionally NO shift_cancellations row, so the agent
    // isn't penalized for a scheduling decision they didn't make.
    const { error } = await supabase.from('shift_claims').delete().eq('id', claim.id)
    if (error) { flash('Could not remove them from this interval'); return }
    logActivity('unassigned', block, target?.full_name)
    flash('Removed from interval'); load(true)
  }

  async function logActivity(action, block, affectedName) {
    try {
      const schedule = block ? schedules.find(s => s.id === block.schedule_id) : null
      const blockLabel = block ? `${formatTime(block.start_time)}–${formatTime(block.end_time)} on ${block.block_date}` : null
      await supabase.from('schedule_activity_log').insert({
        actor_id: me.id, action, schedule_id: schedule?.id || null, schedule_title: schedule?.title || null,
        shift_block_id: block?.id || null, block_label: blockLabel,
        affected_profile_name: affectedName || me.full_name || null,
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
          <button className={'btn ' + (tab === 'trade' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('trade')} style={{ position: 'relative' }}>
            Trade board
            {trades.filter(tr => tr.offered_by !== me?.id).length > 0 && (
              <span style={{ marginLeft: 7, background: 'var(--cta)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 7px' }}>
                {trades.filter(tr => tr.offered_by !== me?.id).length}
              </span>
            )}
          </button>
          {canFillRate && (
            <button className={'btn ' + (tab === 'fillrate' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('fillrate')}>Fill Rate</button>
          )}
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--ink)', color: '#fff', padding: '11px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>{toast}</div>}

      {tab === 'fillrate' ? (
        <FillRateView />
      ) : tab === 'claim' ? (
        <ClaimView
          isAdmin={isAdmin} adminView={adminView} setAdminView={setAdminView}
          me={me} profiles={profiles} tiers={tiers}
          schedules={myVisibleSchedules(isAdmin && adminView === 'mine')} blocks={blocks} claims={claims}
          weekStart={weekStart} setWeekStart={setWeekStart}
          releaseStatus={getMyReleaseStatus()}
          claimedHoursInWeek={claimedHoursInWeek} hasIntervalStarted={hasIntervalStarted}
          onClaim={claimBlock} onUnclaim={unclaimBlock} onCheckIn={checkIn} onCheckOut={checkOut} onNoShow={markNoShow}
          canAssign={canAssign} audience={audience} onAssign={assignBlock} onUnassign={unassignBlock}
        />
      ) : tab === 'trade' ? (
        <TradeBoardView me={me} trades={trades} blocks={blocks} profiles={profiles}
          certOkForBlock={certOkForBlock} hasIntervalStarted={hasIntervalStarted}
          onAccept={acceptTrade} onCancel={cancelTrade} viewerTZ={me?.timezone} />
      ) : (
        <MyScheduleView me={me} blocks={blocks} claims={claims} hasIntervalStarted={hasIntervalStarted} onUnclaim={unclaimBlock} onCheckIn={checkIn} onCheckOut={checkOut} openBreaks={openBreaks} onStartBreak={startBreak} onEndBreak={endBreak}
          onOfferTrade={offerTrade} onCancelTrade={cancelTrade} myOpenTradeFor={myOpenTradeFor} />
      )}
    </div>
  )
}

function ClaimView(props) {
  const { isAdmin, adminView, setAdminView, me, profiles, schedules, blocks, claims, weekStart, setWeekStart, releaseStatus,
    claimedHoursInWeek, hasIntervalStarted, onClaim, onUnclaim, onCheckIn, onCheckOut, onNoShow,
    canAssign, audience, onAssign, onUnassign } = props
  const [popBlock, setPopBlock] = useState(null)

  // Admins in 'team' view see the team grid; everyone else (agents, and
  // admins who switched to 'My view') see the personal claim grid.
  const teamMode = isAdmin && adminView === 'team'

  if (!schedules.length) {
    return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 30 }}>
      {isAdmin ? 'No published schedules yet. Create one in the Schedule Builder.' : "No schedule published for you yet. Check back once your admin publishes one you're part of."}
    </div></div>
  }

  const monday = weekStart
  const days = weekDates(monday)
  const todayStr = isoDate(etNow())
  const scheduleIds = new Set(schedules.map(s => s.id))
  const weekBlocks = blocks.filter(b => scheduleIds.has(b.schedule_id))

  function shiftWeek(dir) { const d = new Date(monday); d.setDate(monday.getDate() + dir * 7); setWeekStart(d) }

  return (
    <div>
      {!teamMode && !isAdmin && releaseStatus?.releaseDate && <ReleaseBanner status={releaseStatus} />}

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
        ? <AdminGrid days={days} todayStr={todayStr} weekBlocks={weekBlocks} claims={claims} profiles={profiles} me={me} onPop={setPopBlock} />
        : <AgentGrid days={days} todayStr={todayStr} weekBlocks={weekBlocks} claims={claims} me={me} hasIntervalStarted={hasIntervalStarted} horizonDays={releaseStatus.horizonDays} onPop={setPopBlock} />}

      {popBlock && <IntervalPopover
        block={popBlock} claims={claims} profiles={profiles} me={me} canClaim={!teamMode} isAdmin={isAdmin}
        canAssign={canAssign} audience={audience}
        hasIntervalStarted={hasIntervalStarted}
        onClose={() => setPopBlock(null)}
        onClaim={(b) => { onClaim(b); setPopBlock(null) }}
        onUnclaim={(b) => { onUnclaim(b); setPopBlock(null) }}
        onCheckIn={(cid, b) => { onCheckIn(cid, b); setPopBlock(null) }}
        onCheckOut={(cid, b, note) => { onCheckOut(cid, b, note); setPopBlock(null) }}
        onNoShow={(claim, b) => { onNoShow(claim, b); setPopBlock(null) }}
        onAssign={(b, pid) => { onAssign(b, pid); setPopBlock(null) }}
        onUnassign={(claim, b) => { onUnassign(claim, b); setPopBlock(null) }}
      />}
    </div>
  )
}

function HoursCap({ hours }) {
  const pct = Math.min(100, Math.round((hours / WEEKLY_HOUR_CAP) * 100))
  const over = hours >= WEEKLY_HOUR_CAP
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: over ? 'var(--failed)' : 'var(--ink-soft)' }}>{fmtHours(hours)} / {WEEKLY_HOUR_CAP} h</span>
      <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: over ? 'var(--failed)' : 'var(--accent)', borderRadius: 3 }} />
      </div>
    </div>
  )
}

function ReleaseBanner({ status }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t)
  }, [])

  const noTier = !status.tier
  const relStr = status.releaseDate ? formatReleaseTime(status.releaseDate) : ''

  // New-agent welcome (no tier assigned)
  if (noTier) {
    return <div style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)', marginBottom: 3 }}>Welcome to the team!</div>
      <div style={{ fontSize: 13, color: 'var(--accent)' }}>
        As a new agent, your schedule releases at 11:45 AM EST each day. Intervals are first come, first served, so be here on time to select your schedule. Your next release is {relStr}.
      </div>
    </div>
  }

  // Countdown to the next daily unlock
  const diff = status.releaseDate ? status.releaseDate.getTime() - now : 0
  const h = String(Math.max(0, Math.floor(diff / 3600000))).padStart(2, '0')
  const m = String(Math.max(0, Math.floor((diff % 3600000) / 60000))).padStart(2, '0')
  const s = String(Math.max(0, Math.floor((diff % 60000) / 1000))).padStart(2, '0')

  return <div style={{ background: 'var(--passed-bg)', border: '1px solid var(--passed)', borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
    <div style={{ fontSize: 13, color: 'var(--passed)' }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>Open intervals are available now</div>
      As a {status.tier?.name}, a new day of intervals unlocks daily at your release time. Next release: {relStr}.
    </div>
    <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--passed)' }}>{h}:{m}:{s}</div>
  </div>
}

// ---------- AGENT GRID ----------
function AgentGrid({ days, todayStr, weekBlocks, claims, me, hasIntervalStarted, horizonDays, onPop }) {
  // Rolling-window cutoff: open intervals are visible only through today + horizonDays.
  const horizonStr = (() => {
    const d = etNow(); d.setDate(d.getDate() + (horizonDays ?? 13)); return isoDate(d)
  })()
  // Mon–Sun total for the week on screen. Shown under "Your intervals".
  const myHours = personWeekHours(me.id, weekBlocks, claims, isoDate(days[0]), isoDate(days[6]))
  const myOver = myHours > WEEKLY_HOUR_CAP

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
        return <Iv key={b.id} block={b} cls={cls} time={`${blockTimeInViewer(b.block_date, b.start_time, me?.timezone)}–${blockTimeInViewer(b.block_date, b.end_time, me?.timezone)}`} role={b.role} onPop={onPop} />
      })
    return <div key={ds} className={'wg-cell' + (ds === todayStr ? ' today' : '') + (items.length ? '' : ' dim')}>{items}</div>
  })

  const openCells = days.map(d => {
    const ds = isoDate(d)
    const items = weekBlocks.filter(b => {
      if (b.block_date !== ds) return false
      if (b.block_date > horizonStr) return false   // beyond the rolling window — not visible yet
      // (started/ended intervals stay claimable — late pickup is allowed)
      const cl = claims.filter(c => c.shift_block_id === b.id)
      if (cl.length >= b.total_spots) return false
      if (cl.some(c => c.profile_id === me.id)) return false
      return true
    }).sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map(b => {
        const left = b.total_spots - claims.filter(c => c.shift_block_id === b.id).length
        return <Iv key={b.id} block={b} cls="open" spots={`${left} open`} time={`${blockTimeInViewer(b.block_date, b.start_time, me?.timezone)}–${blockTimeInViewer(b.block_date, b.end_time, me?.timezone)}`} role={b.role} onPop={onPop} />
      })
    return <div key={ds} className={'wg-cell' + (ds === todayStr ? ' today' : '') + (items.length ? '' : ' dim')}>{items}</div>
  })

  return <div className="grid-scroll">
    <div className="week-grid">
      <div className="wg-corner">Schedule</div>
      {dayHeads}

      <div className="wg-rowlabel">
        <div className="wg-avatar" style={{ background: avatarColor(me.full_name || 'You') }}>{initials(me.full_name || 'You')}</div>
        <div style={{ minWidth: 0 }}>
          <div className="wg-person-name">Your intervals</div>
          <div className="wg-person-sub" style={{ color: myOver ? 'var(--failed)' : undefined, fontWeight: myOver ? 700 : undefined }}>
            {fmtHours(myHours)} / {WEEKLY_HOUR_CAP} h
          </div>
        </div>
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
function AdminGrid({ days, todayStr, weekBlocks, claims, profiles, me, onPop }) {
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
    // Mon–Sun total for this person, in the week currently on screen.
    // Counts claimed + checked_in + no_show: a no-show still held the seat.
    const hrs = person.__open ? 0 : personWeekHours(person.id, inWeek, claims, wkStart, wkEnd)
    const over = hrs > WEEKLY_HOUR_CAP

    const label = person.__open
      ? <div className="wg-rowlabel" style={{ background: 'var(--canvas)' }}>
          <div className="wg-avatar" style={{ background: 'var(--ink-soft)' }}>+</div>
          <div><div className="wg-person-name">Open intervals</div><div className="wg-person-sub">Unclaimed</div></div>
        </div>
      : <div className="wg-rowlabel">
          <div className="wg-avatar" style={{ background: avatarColor(person.full_name) }}>{initials(person.full_name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="wg-person-name">{person.full_name}</div>
            <div className="wg-person-sub" style={{ color: over ? 'var(--failed)' : undefined, fontWeight: over ? 700 : undefined }}>
              {fmtHours(hrs)} / {WEEKLY_HOUR_CAP} h
            </div>
          </div>
        </div>

    const cells = days.map(d => {
      const ds = isoDate(d)
      const cellBlocks = inWeek.filter(b => b.block_date === ds).sort((a, b) => a.start_time.localeCompare(b.start_time))
      const items = cellBlocks.map(b => {
        const cl = claims.filter(c => c.shift_block_id === b.id)
        const left = b.total_spots - cl.length
        if (person.__open) {
          if (left <= 0) return null
          return <Iv key={b.id} block={b} cls="open" spots={`${left} open`} time={`${blockTimeInViewer(b.block_date, b.start_time, me?.timezone)}–${blockTimeInViewer(b.block_date, b.end_time, me?.timezone)}`} role={b.role} onPop={onPop} />
        }
        const theirs = cl.find(c => c.profile_id === person.id)
        if (!theirs) return null
        let cls = 'taken'; if (theirs.checked_in_at) cls += ' checkedin'; if (theirs.status === 'no_show') cls = 'noshow'
        return <Iv key={b.id} block={b} cls={cls} time={`${blockTimeInViewer(b.block_date, b.start_time, me?.timezone)}–${blockTimeInViewer(b.block_date, b.end_time, me?.timezone)}`} role={b.role} onPop={onPop} />
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
function IntervalPopover({ block, claims, profiles, me, canClaim, isAdmin, canAssign, audience, hasIntervalStarted, onClose, onClaim, onUnclaim, onCheckIn, onCheckOut, onNoShow, onAssign, onUnassign }) {
  const [assignTo, setAssignTo] = React.useState('')
  const cl = claims.filter(c => c.shift_block_id === block.id)
  const mine = cl.find(c => c.profile_id === me.id)
  const left = block.total_spots - cl.length
  const isFull = left <= 0
  const started = hasIntervalStarted(block)
  const names = cl.map(c => profiles.find(p => p.id === c.profile_id)?.full_name?.split(' ')[0] || '').filter(Boolean).join(', ')

  return <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
    <div className="modal" style={{ width: 380 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{blockTimeInViewer(block.block_date, block.start_time, me?.timezone)} – {blockTimeInViewer(block.block_date, block.end_time, me?.timezone)}</div>
      <div className="page-sub" style={{ marginBottom: 14 }}>{new Date(block.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, marginBottom: 16 }}>
        {block.role && <Row k="Role" v={block.role} />}
        <Row k="Spots" v={`${left > 0 ? left : 0} of ${block.total_spots} open`} />
        {names && <Row k="Claimed by" v={names} />}
        {block.notes && <Row k="Notes" v={block.notes} />}
        {mine?.checked_in_at && <Row k="Status" v="Checked in" />}
        {mine?.status === 'no_show' && <Row k="Status" v="No-show" />}
      </div>

      {(isAdmin || canAssign) && cl.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Claimants</div>
          {cl.map(c => {
            const p = profiles.find(x => x.id === c.profile_id)
            const status = c.status === 'no_show' ? 'No-show' : c.checked_in_at ? 'Checked in' : started ? 'Not checked in' : 'Claimed'
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{p?.full_name || 'Unknown'}</span>
                <span style={{ color: c.status === 'no_show' ? 'var(--failed)' : c.checked_in_at ? 'var(--passed)' : 'var(--ink-soft)' }}>{status}</span>
                {started && c.status !== 'no_show' && !c.checked_in_at &&
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--failed)' }} onClick={() => onNoShow(c, block)}>No-show</button>}
                {canAssign && !started && !c.checked_in_at &&
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--failed)' }} onClick={() => onUnassign(c, block)}>Remove</button>}
              </div>
            )
          })}
        </div>
      )}

      {canAssign && !isFull && (() => {
        const audienceIds = new Set((audience || []).filter(a => a.schedule_id === block.schedule_id).map(a => a.profile_id))
        const claimedIds = new Set(cl.map(c => c.profile_id))
        const eligible = profiles.filter(p => p.is_active !== false && audienceIds.has(p.id) && !claimedIds.has(p.id))
        return (
          <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Assign to agent</div>
            {eligible.length ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="input" style={{ flex: 1, fontSize: 13 }} value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                  <option value="">Select a person…</option>
                  {eligible.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
                </select>
                <button className="btn btn-primary" style={{ fontSize: 12.5 }} disabled={!assignTo} onClick={() => onAssign(block, assignTo)}>Assign</button>
              </div>
            ) : (
              <div className="page-sub" style={{ fontSize: 12.5 }}>No eligible people — everyone assigned to this schedule already has this interval.</div>
            )}
          </div>
        )
      })()}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        {mine ? <>
          {!started && !mine.checked_in_at && mine.status !== 'no_show' && <button className="btn btn-ghost" style={{ color: 'var(--failed)' }} onClick={() => onUnclaim(block)}>Release spot</button>}
          {started && !mine.checked_in_at && mine.status !== 'no_show' && <button className="btn btn-primary" onClick={() => onCheckIn(mine.id, block)}>Check in</button>}
          {mine.checked_in_at && !mine.checked_out_at && mine.status !== 'no_show' && <button className="btn btn-primary" onClick={() => {
            const end = new Date(`${block.block_date}T${block.end_time.slice(0, 5)}:00`)
            const out = Math.abs((etNow() - end) / 60000) > 15
            let note = ''
            if (out) { note = window.prompt("You're outside your scheduled time. Add a note (required):") || ''; if (!note.trim()) return }
            onCheckOut(mine.id, block, note)
          }}>Check out</button>}
        </> : (!isFull && canClaim && <button className="btn btn-primary" onClick={() => onClaim(block)}>{hasIntervalStarted(block) ? 'Claim (already started)' : 'Claim this interval'}</button>)}
      </div>
    </div>
  </div>
}

function Row({ k, v }) { return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ color: 'var(--ink-soft)' }}>{k}</span><span>{v}</span></div> }

// ---------- TRADE BOARD ----------
// Intervals other agents have offered up for someone else to take, WITHOUT
// releasing them. Accepting transfers the seat (same rules as claiming). If
// nobody accepts, the offering agent still holds it and stays accountable.
function TradeBoardView({ me, trades, blocks, profiles, certOkForBlock, hasIntervalStarted, onAccept, onCancel, viewerTZ }) {
  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || 'Someone'
  const dayLabel = (block) => new Date(block.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const todayStr = isoDate(etNow())

  const rows = trades
    .map(tr => ({ tr, block: blocks.find(b => b.id === tr.shift_block_id) }))
    .filter(x => x.block && x.block.block_date >= todayStr && !hasIntervalStarted(x.block))
    .sort((a, b) => (a.block.block_date + a.block.start_time).localeCompare(b.block.block_date + b.block.start_time))
  const mine = rows.filter(x => x.tr.offered_by === me?.id)
  const others = rows.filter(x => x.tr.offered_by !== me?.id)

  return <div>
    <div className="card" style={{ marginBottom: 16 }}>
      <p className="page-sub" style={{ margin: 0 }}>
        Intervals other agents have put up for grabs. Accepting one makes it yours — the same rules as claiming apply (certified for the position, under 40 hours, no overlap). Putting an interval here <b>isn’t</b> releasing it: if nobody takes it, the original agent still holds it and stays responsible for showing up.
      </p>
    </div>

    {mine.length > 0 && <>
      <div style={sectionHdr}>Your offers</div>
      <div style={tradeGrid}>
        {mine.map(({ tr, block }) => (
          <div key={tr.id} className="iv mine" style={{ padding: '14px 16px' }}>
            <div className="iv-time" style={{ fontSize: 14, fontWeight: 700 }}>{dayLabel(block)}</div>
            <div className="iv-time" style={{ fontSize: 15 }}>{blockTimeInViewer(block.block_date, block.start_time, viewerTZ)} – {blockTimeInViewer(block.block_date, block.end_time, viewerTZ)}</div>
            {block.role && <div className="iv-sub" style={{ fontSize: 12, marginBottom: 6 }}>{block.role}</div>}
            <div style={{ fontSize: 11, color: 'var(--cta)', fontWeight: 700, marginBottom: 8 }}>🔁 On the trade board — you still hold it</div>
            <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, border: '1px solid var(--line)' }} onClick={() => onCancel(tr)}>Take back</button>
          </div>
        ))}
      </div>
    </>}

    <div style={sectionHdr}>Available to take {others.length ? `(${others.length})` : ''}</div>
    {others.length === 0
      ? <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>Nothing on the trade board right now.</div></div>
      : <div style={tradeGrid}>
          {others.map(({ tr, block }) => {
            const eligible = certOkForBlock(block)
            return (
              <div key={tr.id} className="iv" style={{ padding: '14px 16px' }}>
                <div className="iv-time" style={{ fontSize: 14, fontWeight: 700 }}>{dayLabel(block)}</div>
                <div className="iv-time" style={{ fontSize: 15 }}>{blockTimeInViewer(block.block_date, block.start_time, viewerTZ)} – {blockTimeInViewer(block.block_date, block.end_time, viewerTZ)}</div>
                {block.role && <div className="iv-sub" style={{ fontSize: 12, marginBottom: 4 }}>{block.role}</div>}
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>Offered by {nameOf(tr.offered_by)}</div>
                {eligible
                  ? <button className="btn btn-primary" style={{ width: '100%', fontSize: 12 }} onClick={() => onAccept(tr)}>Accept this interval</button>
                  : <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontStyle: 'italic' }}>You’re not certified for this position yet.</div>}
              </div>
            )
          })}
        </div>}
  </div>
}
const sectionHdr = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', margin: '4px 0 10px' }
const tradeGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 12, marginBottom: 22 }

// ---------- MY SCHEDULE ----------
function MyScheduleView({ me, blocks, claims, hasIntervalStarted, onUnclaim, onCheckIn, onCheckOut, openBreaks = {}, onStartBreak, onEndBreak, onOfferTrade, onCancelTrade, myOpenTradeFor }) {
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
          {byDate[date].map(e => <ShiftCard key={e.claim.id} block={e.block} claim={e.claim} isPast={false} started={hasIntervalStarted(e.block)} viewerTZ={me?.timezone} onUnclaim={onUnclaim} onCheckIn={onCheckIn} onCheckOut={onCheckOut} openBreak={openBreaks[e.claim.id]} onStartBreak={onStartBreak} onEndBreak={onEndBreak} onOfferTrade={onOfferTrade} onCancelTrade={onCancelTrade} myTrade={myOpenTradeFor ? myOpenTradeFor(e.block.id) : null} />)}
        </div>
      </div>
    )) : <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 20 }}>No upcoming intervals.</div></div>}

    {past.length > 0 && <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginBottom: 10, opacity: .6 }}>Past intervals</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 12 }}>
        {past.slice(0, 12).map(e => <ShiftCard key={e.claim.id} block={e.block} claim={e.claim} isPast={true} started={true} viewerTZ={me?.timezone} onUnclaim={onUnclaim} onCheckIn={onCheckIn} onCheckOut={onCheckOut} />)}
      </div>
    </div>}
  </div>
}

function workedLabel(claim) {
  if (!claim?.checked_in_at || !claim?.checked_out_at) return null
  const mins = Math.max(0, Math.round((new Date(claim.checked_out_at) - new Date(claim.checked_in_at)) / 60000))
  const h = Math.floor(mins / 60), m = mins % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

function ShiftCard({ block, claim, isPast, started, viewerTZ, onUnclaim, onCheckIn, onCheckOut, openBreak, onStartBreak, onEndBreak, onOfferTrade, onCancelTrade, myTrade }) {
  const checkedIn = claim?.checked_in_at; const checkedOut = claim?.checked_out_at
  const noShow = claim?.status === 'no_show'
  const pending = claim?.status === 'pending_review'
  const approved = claim?.status === 'approved'
  const worked = workedLabel(claim)
  const [note, setNote] = React.useState('')
  const [showNote, setShowNote] = React.useState(false)

  // is now outside the 15-min grace window around scheduled end?
  const outOfWindow = (() => {
    const end = new Date(`${block.block_date}T${block.end_time.slice(0, 5)}:00`)
    return Math.abs((etNow() - end) / 60000) > 15
  })()

  async function doCheckout() {
    if (outOfWindow && !showNote) { setShowNote(true); return }   // reveal note field first
    const res = await onCheckOut(claim.id, block, note)
    if (res?.ok) { setShowNote(false); setNote('') }
  }

  return <div className="iv mine" style={{ cursor: 'default', padding: '14px 16px' }}>
    <div className="iv-time" style={{ fontSize: 15 }}>{blockTimeInViewer(block.block_date, block.start_time, viewerTZ)} – {blockTimeInViewer(block.block_date, block.end_time, viewerTZ)}</div>
    {block.role && <div className="iv-sub" style={{ fontSize: 12, marginBottom: 4 }}>{block.role}</div>}

    {checkedOut ? (
      <div style={{ fontSize: 12, margin: '8px 0', fontWeight: 600, color: pending ? 'var(--needed)' : 'var(--passed)' }}>
        {pending ? '⏳ Pending review' : approved ? '✓ Approved' : '✓ Completed'}{worked ? ` · ${worked}` : ''}
      </div>
    ) : !isPast && checkedIn ? (
      <>
        {openBreak ? (
          <div style={{ fontSize: 12, color: 'var(--needed)', fontWeight: 700, margin: '8px 0 6px' }}>
            ☕ On unpaid break · since {new Date(openBreak.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--passed)', fontWeight: 600, margin: '8px 0 6px' }}>✓ Checked in</div>
        )}
        {openBreak ? (
          <button className="btn btn-primary" style={{ width: '100%', fontSize: 12, marginBottom: 6 }}
            onClick={() => onEndBreak?.(claim, block)}>I'm back — resume interval</button>
        ) : (
          <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, marginBottom: 6, border: '1px solid var(--line)' }}
            onClick={() => onStartBreak?.(claim, block)}>☕ Take unpaid break</button>
        )}
        {showNote && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--needed)', marginBottom: 4 }}>You're outside your scheduled time — add a note (required):</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="e.g. Stayed late to finish a call"
              style={{ width: '100%', fontSize: 12, padding: 6, borderRadius: 6, border: '1px solid var(--line)', resize: 'vertical' }} />
          </div>
        )}
        <button className="btn btn-primary" style={{ width: '100%', fontSize: 12 }} onClick={doCheckout}>
          {showNote ? 'Submit checkout for review' : 'Check out'}
        </button>
      </>
    ) : !isPast && noShow ? (
      <div style={{ fontSize: 12, color: 'var(--failed)', fontWeight: 600, margin: '8px 0' }}>Marked no-show</div>
    ) : !isPast ? (
      <button className="btn btn-primary" style={{ width: '100%', fontSize: 12, marginTop: 8 }} onClick={() => onCheckIn(claim.id, block)}>I'm here — check in</button>
    ) : null}

    {isPast && checkedIn && !checkedOut && (
      <div style={{ fontSize: 12, color: 'var(--needed)', fontWeight: 600, margin: '8px 0' }}>Never checked out — admin will review</div>
    )}

    {!isPast && !started && !checkedIn && onOfferTrade && (
      myTrade
        ? <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--cta)', fontWeight: 700, marginBottom: 4 }}>🔁 On the trade board</div>
            <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, border: '1px solid var(--line)' }} onClick={() => onCancelTrade(myTrade)}>Take back from trade board</button>
          </div>
        : <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, marginTop: 6, border: '1px solid var(--line)' }} onClick={() => onOfferTrade(block)} title="Offer this interval to others without giving it up — if nobody takes it, you still hold it.">🔁 Put up for trade</button>
    )}
    {!isPast && !started && !checkedIn && <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, marginTop: 6, color: 'var(--failed)' }} onClick={() => onUnclaim(block)}>Release this spot</button>}
    {block.notes && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>{block.notes}</div>}
  </div>
}

// ============================================================
// FILL RATE — ASC command panel. Live schedule coverage + occupancy fill rate
// (staffed hrs ÷ scheduled slot-hrs, to-date), tier mix, and open intervals.
// Occupancy is refreshed hourly from Five9/BigQuery into sc_occupancy_today.
// One-click "Copy update" replaces the manual tracker-sheet hourly post.
// ============================================================
const TIER_ORDER = ['Top Performer', 'High Performer', 'Nesting', 'Developing Performer', 'Improvement Opportunity', 'Unranked']
const TIER_COLOR = {
  'Top Performer': '#1b5e20', 'High Performer': '#8d6e00', 'Nesting': '#4527a0',
  'Developing Performer': '#0d47a1', 'Improvement Opportunity': '#b71c1c', 'Unranked': '#6b7280',
}
// Fill rate / coverage colour: target is ~100%. Green ≥95, amber 90–95, red <90.
function rateColor(v) { return v == null ? 'var(--ink)' : v >= 95 ? '#1b5e20' : v >= 90 ? '#8d6e00' : '#b71c1c' }

function FillRateView() {
  const [day, setDay] = useState(() => isoDate(etNow()))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('get_asc_fill_rate', { p_day: day })
    if (error) { setErr(error.message); setData(null) } else { setData(data) }
    setLoading(false)
  }, [day])
  useEffect(() => { load() }, [load])

  const nowEt = new Date().toLocaleString('en-US', { timeZone: COMPANY_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const tiers = (data?.tier_mix || []).slice().sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
  const opens = data?.open_intervals || []

  function buildUpdate() {
    if (!data) return ''
    const fr = data.fill_rate == null ? 'n/a (schedule-only)' : data.fill_rate + '%'
    const openStr = opens.length ? opens.map(o => `${o.start}–${o.end} (${o.open})`).join(', ') : 'none — fully covered'
    const tierStr = tiers.length ? tiers.map(t => `${t.tier.replace(' Performer', '')} ${t.pct}%`).join(' · ') : 'n/a'
    return [
      `GarageCo Fill Rate — ${dayLabel}${data.is_today ? ` · as of ${nowEt}` : ''}`,
      ``,
      `Fill rate: ${fr}  (${data.occupancy_hours_todate} / ${data.scheduled_hours_todate} staffed hrs to-date)`,
      `Coverage: ${data.coverage_pct ?? 'n/a'}%  (${data.filled_spots} of ${data.total_spots} slots · ${data.open_spots} open)`,
      `Open intervals: ${openStr}`,
      `Tier mix: ${tierStr}`,
      ``,
      `@Corinne Kerper @Becky Jackson @Brittney Thompson`,
    ].join('\n')
  }
  async function copyUpdate() {
    try { await navigator.clipboard.writeText(buildUpdate()); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setErr('Could not copy — select and copy manually.') }
  }

  if (loading) return <p className="page-sub">Loading fill rate…</p>
  if (err) return <div className="card" style={{ borderColor: 'var(--failed)' }}><b style={{ color: 'var(--failed)' }}>Couldn't load fill rate.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>
  if (!data) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <input type="date" value={day} onChange={e => setDay(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)' }} />
        <button className="btn btn-ghost" onClick={load}>↻ Refresh</button>
        {data.is_today && <span className="page-sub" style={{ fontSize: 12 }}>as of {nowEt} · occupancy synced {data.occupancy_updated_at ? new Date(data.occupancy_updated_at).toLocaleTimeString('en-US', { timeZone: COMPANY_TZ, hour: 'numeric', minute: '2-digit' }) : '—'}</span>}
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={copyUpdate}>{copied ? '✓ Copied' : '📋 Copy update'}</button>
      </div>

      {/* Headline metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label="Fill Rate (staffed ÷ scheduled)" big={data.fill_rate == null ? '—' : data.fill_rate + '%'} bigColor={rateColor(data.fill_rate)}
          sub={data.is_today ? `${data.occupancy_hours_todate} / ${data.scheduled_hours_todate} hrs to-date` : 'today only'} />
        <StatCard label="Coverage (slots claimed)" big={(data.coverage_pct ?? '—') + '%'} bigColor={rateColor(data.coverage_pct)}
          sub={`${data.filled_spots} of ${data.total_spots} slots`} />
        <StatCard label="Open Slots" big={String(data.open_spots)} bigColor={data.open_spots > 0 ? '#b71c1c' : '#1b5e20'}
          sub={opens.length ? `${opens.length} interval${opens.length > 1 ? 's' : ''}` : 'fully covered'} />
        <StatCard label="Scheduled Hours" big={String(data.scheduled_hours_full)} sub="planned slot-hours today" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {/* Open intervals to chase */}
        <div className="card">
          <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)', marginBottom: 10 }}>Unassigned Intervals</div>
          {opens.length === 0 ? (
            <p className="page-sub" style={{ fontSize: 13, margin: 0 }}>Every interval is fully covered. 🎉</p>
          ) : opens.map((o, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none', fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>{o.start}–{o.end}</span>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: '#fdecea', color: '#b71c1c' }}>{o.open} of {o.spots} open</span>
            </div>
          ))}
        </div>

        {/* Tier mix of scheduled hours */}
        <div className="card">
          <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)', marginBottom: 10 }}>Tier Mix (scheduled hours)</div>
          {tiers.length === 0 ? (
            <p className="page-sub" style={{ fontSize: 13, margin: 0 }}>No claimed intervals yet.</p>
          ) : (
            <div>
              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
                {tiers.map((t, i) => <div key={i} title={`${t.tier} ${t.pct}%`} style={{ width: t.pct + '%', background: TIER_COLOR[t.tier] || '#6b7280' }} />)}
              </div>
              {tiers.map((t, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 13.5 }}>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: TIER_COLOR[t.tier] || '#6b7280', marginRight: 8 }} />{t.tier}</span>
                  <span style={{ fontWeight: 600 }}>{t.pct}% <span style={{ color: 'var(--ink-soft)', fontWeight: 400, fontSize: 12 }}>({t.hours}h)</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="page-sub" style={{ fontSize: 11.5, marginTop: 12 }}>
        Fill rate = actual Five9 staffed hours ÷ scheduled slot-hours, counted up to now. Occupancy refreshes hourly from Five9 → BigQuery; make that export more frequent for finer intraday accuracy.
      </p>
    </div>
  )
}

function StatCard({ label, big, sub, bigColor }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, margin: '6px 0 2px', color: bigColor || 'inherit' }}>{big}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{sub}</div>
    </div>
  )
}
