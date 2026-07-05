import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// SCHEDULE INSIGHTS — Stage 3 (admin)
// Today / Tomorrow / All / Unassigned staffing views grouped by
// client and hour, each with a tier fill-rate breakdown, plus an
// exportable Activity log.
// ============================================================

function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function hourLabel(t) {
  const [h] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:00 ${period}`
}
function dateLabel(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

const TIER_COLORS = {
  'Top Performer': { bg: 'var(--passed-bg)', text: 'var(--passed)' },
  'High Performer': { bg: 'var(--accent-bg)', text: 'var(--accent)' },
  'Developing Performer': { bg: 'var(--needed-bg)', text: 'var(--needed)' },
  'Improvement Opportunity': { bg: 'var(--failed-bg)', text: 'var(--failed)' },
}
function tierColor(name) { return TIER_COLORS[name] || { bg: 'var(--canvas)', text: 'var(--ink-soft)' } }

export default function ScheduleInsights() {
  const [schedules, setSchedules] = useState([])
  const [blocks, setBlocks] = useState([])
  const [claims, setClaims] = useState([])
  const [profiles, setProfiles] = useState([])
  const [tiers, setTiers] = useState([])
  const [clients, setClients] = useState([])
  const [positions, setPositions] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('today') // today | tomorrow | all | unassigned | activity

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [schRes, blkRes, clmRes, profRes, tierRes, cliRes, posRes, actRes] = await Promise.all([
        supabase.from('schedules').select('*'),
        supabase.from('shift_blocks').select('*'),
        supabase.from('shift_claims').select('*'),
        supabase.from('profiles').select('id, full_name, tier_id'),
        supabase.from('performance_tiers').select('*').order('sort_order'),
        supabase.from('clients').select('*').order('name'),
        supabase.from('call_types').select('id, name'),
        supabase.from('schedule_activity_log').select('*').order('created_at', { ascending: false }).limit(500),
      ])
      if (schRes.error) throw schRes.error
      setSchedules(schRes.data || [])
      setBlocks(blkRes.data || [])
      setClaims(clmRes.data || [])
      setProfiles(profRes.data || [])
      setTiers(tierRes.data || [])
      setClients(cliRes.data || [])
      setPositions(posRes.data || [])
      setActivity(actRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // helpers
  const scheduleById = (id) => schedules.find(s => s.id === id)
  const clientNameForBlock = (b) => {
    const s = scheduleById(b.schedule_id)
    return clients.find(c => c.id === s?.client_id)?.name || 'Unassigned client'
  }
  const positionForBlock = (b) => {
    const s = scheduleById(b.schedule_id)
    return positions.find(p => p.id === s?.call_type_id)?.name || ''
  }
  const publishedBlocks = () => {
    const pubIds = new Set(schedules.filter(s => s.status === 'published').map(s => s.id))
    return blocks.filter(b => pubIds.has(b.schedule_id))
  }
  const claimsFor = (blockId) => claims.filter(c => c.shift_block_id === blockId)
  const tierOf = (profileId) => {
    const p = profiles.find(x => x.id === profileId)
    return tiers.find(t => t.id === p?.tier_id)
  }

  // fill-rate by tier over a set of blocks
  function tierBreakdown(blockSet) {
    const totalSpots = blockSet.reduce((s, b) => s + b.total_spots, 0)
    const claimed = blockSet.flatMap(b => claimsFor(b.id))
    const byTier = {}
    claimed.forEach(c => {
      const t = tierOf(c.profile_id)
      const key = t?.name || 'No tier'
      byTier[key] = (byTier[key] || 0) + 1
    })
    return { totalSpots, claimedCount: claimed.length, byTier }
  }

  if (loading) return <p className="page-sub">Loading insights…</p>

  const today = isoDate(etNow())
  const tomorrowD = new Date(etNow()); tomorrowD.setDate(tomorrowD.getDate() + 1)
  const tomorrow = isoDate(tomorrowD)

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title">Schedule insights</h1>
        <p className="page-sub">Coverage by client and hour, fill rate by tier, and the full activity log.</p>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[['today', 'Today'], ['tomorrow', 'Tomorrow'], ['all', 'All'], ['unassigned', 'Unassigned'], ['activity', 'Activity']].map(([k, label]) => (
          <button key={k} className={'btn ' + (tab === k ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'today' && <StaffingView dateFilter={today} label={dateLabel(today)} {...{ publishedBlocks, clientNameForBlock, positionForBlock, claimsFor, profiles, tierOf, tierBreakdown, tiers }} />}
      {tab === 'tomorrow' && <StaffingView dateFilter={tomorrow} label={dateLabel(tomorrow)} {...{ publishedBlocks, clientNameForBlock, positionForBlock, claimsFor, profiles, tierOf, tierBreakdown, tiers }} />}
      {tab === 'all' && <StaffingView dateFilter={null} label="All published intervals" {...{ publishedBlocks, clientNameForBlock, positionForBlock, claimsFor, profiles, tierOf, tierBreakdown, tiers }} />}
      {tab === 'unassigned' && <UnassignedView {...{ publishedBlocks, clientNameForBlock, positionForBlock, claimsFor, tierBreakdown, tiers }} />}
      {tab === 'activity' && <ActivityView activity={activity} profiles={profiles} />}
    </div>
  )
}

// ---------- TIER FILL-RATE BAR ----------
function TierFillBar({ breakdown, tiers }) {
  const { totalSpots, claimedCount, byTier } = breakdown
  const fillPct = totalSpots ? Math.round((claimedCount / totalSpots) * 100) : 0
  return (
    <div className="card" style={{ marginBottom: 16, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <b style={{ fontSize: 14 }}>Fill rate: {claimedCount}/{totalSpots} ({fillPct}%)</b>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tiers.map(t => {
            const n = byTier[t.name] || 0
            if (!n) return null
            const pct = claimedCount ? Math.round((n / claimedCount) * 100) : 0
            const col = tierColor(t.name)
            return <span key={t.id} className="badge" style={{ background: col.bg, color: col.text }}>{t.name}: {n} ({pct}%)</span>
          })}
          {byTier['No tier'] ? <span className="badge" style={{ background: 'var(--canvas)', color: 'var(--ink-soft)' }}>No tier: {byTier['No tier']}</span> : null}
        </div>
      </div>
      <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
        {tiers.map(t => {
          const n = byTier[t.name] || 0
          if (!n || !totalSpots) return null
          const col = tierColor(t.name)
          return <div key={t.id} style={{ width: `${(n / totalSpots) * 100}%`, background: col.text, height: '100%' }} title={`${t.name}: ${n}`} />
        })}
      </div>
    </div>
  )
}

// ---------- STAFFING VIEW (Today / Tomorrow / All) ----------
function StaffingView({ dateFilter, label, publishedBlocks, clientNameForBlock, positionForBlock, claimsFor, profiles, tierOf, tierBreakdown, tiers }) {
  let set = publishedBlocks()
  if (dateFilter) set = set.filter(b => b.block_date === dateFilter)
  set = set.sort((a, b) => (a.block_date + a.start_time).localeCompare(b.block_date + b.start_time))

  if (!set.length) return (
    <>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{label}</div>
      <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No published intervals{dateFilter ? ' for this day' : ''}.</div></div>
    </>
  )

  // group by client, then by hour
  const byClient = {}
  set.forEach(b => { const c = clientNameForBlock(b); (byClient[c] = byClient[c] || []).push(b) })

  return (
    <>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{label}</div>
      <TierFillBar breakdown={tierBreakdown(set)} tiers={tiers} />
      {Object.keys(byClient).sort().map(clientName => {
        const cBlocks = byClient[clientName]
        // group by hour
        const byHour = {}
        cBlocks.forEach(b => { const hk = b.start_time.slice(0, 5); (byHour[hk] = byHour[hk] || []).push(b) })
        return (
          <div className="card" key={clientName} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{clientName}</h3>
              <span className="page-sub" style={{ fontSize: 12 }}>{cBlocks.length} interval{cBlocks.length !== 1 ? 's' : ''}</span>
            </div>
            {Object.keys(byHour).sort().map(hk => (
              <div key={hk} style={{ borderTop: '1px solid var(--line-soft)', padding: '10px 0' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6 }}>{hourLabel(hk)}</div>
                {byHour[hk].map(b => {
                  const cl = claimsFor(b.id)
                  const left = b.total_spots - cl.length
                  return (
                    <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 150 }}>{formatTime(b.start_time)}–{formatTime(b.end_time)}{positionForBlock(b) ? ` · ${positionForBlock(b)}` : ''}{b.role ? ` · ${b.role}` : ''}</span>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
                        {cl.map(c => {
                          const p = profiles.find(x => x.id === c.profile_id)
                          const t = tierOf(c.profile_id)
                          const col = t ? tierColor(t.name) : { bg: 'var(--canvas)', text: 'var(--ink-soft)' }
                          const status = c.status === 'no_show' ? ' · no-show' : c.checked_in_at ? ' · in' : ''
                          return <span key={c.id} className="badge" style={{ background: col.bg, color: col.text }}>{p?.full_name || 'Unknown'}{status}</span>
                        })}
                        {left > 0 && <span className="badge" style={{ background: 'var(--canvas)', color: 'var(--ink-soft)', border: '1px dashed var(--line)' }}>{left} open</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}

// ---------- UNASSIGNED VIEW (open intervals by date/hour/client) ----------
function UnassignedView({ publishedBlocks, clientNameForBlock, positionForBlock, claimsFor, tierBreakdown, tiers }) {
  const open = publishedBlocks().filter(b => claimsFor(b.id).length < b.total_spots)
    .sort((a, b) => (a.block_date + a.start_time).localeCompare(b.block_date + b.start_time))

  if (!open.length) return (
    <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No unfilled intervals — everything's claimed. 🎉</div></div>
  )

  // group by date
  const byDate = {}
  open.forEach(b => { (byDate[b.block_date] = byDate[b.block_date] || []).push(b) })

  return (
    <>
      <TierFillBar breakdown={tierBreakdown(publishedBlocks())} tiers={tiers} />
      {Object.keys(byDate).sort().map(ds => (
        <div className="card" key={ds} style={{ marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>{dateLabel(ds)}</h3>
          {byDate[ds].map(b => {
            const left = b.total_spots - claimsFor(b.id).length
            return (
              <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', minWidth: 90 }}>{hourLabel(b.start_time.slice(0, 5))}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{formatTime(b.start_time)}–{formatTime(b.end_time)}</span>
                <span className="page-sub" style={{ fontSize: 12.5 }}>{clientNameForBlock(b)}{positionForBlock(b) ? ` · ${positionForBlock(b)}` : ''}{b.role ? ` · ${b.role}` : ''}</span>
                <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)', marginLeft: 'auto' }}>{left} of {b.total_spots} open</span>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

// ---------- ACTIVITY LOG ----------
const VERBS = {
  claimed: 'claimed', released: 'released', released_late: 'released (late)', checked_in: 'checked in to',
  marked_no_show: 'was marked a no-show for', schedule_created: 'created schedule', schedule_updated: 'updated schedule',
  schedule_published: 'published schedule', schedule_deleted: 'deleted schedule', block_created: 'added an interval to',
  block_updated: 'updated an interval in', block_deleted: 'removed an interval from',
}

function ActivityView({ activity, profiles }) {
  function exportCSV() {
    if (!activity.length) return
    const header = ['Date/Time (ET)', 'Actor', 'Action', 'Schedule', 'Interval', 'Affected Person', 'Detail']
    const esc = v => { const s = String(v ?? '').replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s }
    const rows = activity.map(a => {
      const actor = a.actor_id ? profiles.find(p => p.id === a.actor_id) : null
      const actorName = actor?.full_name || (a.actor_id ? 'Unknown' : 'System')
      const time = new Date(a.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })
      return [time, actorName, VERBS[a.action] || a.action, a.schedule_title || '', a.block_label || '', a.affected_profile_name || '', a.detail || ''].map(esc).join(',')
    })
    const csv = [header.map(esc).join(','), ...rows].join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const el = document.createElement('a')
    el.href = url; el.download = `schedule-activity-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(el); el.click(); document.body.removeChild(el); URL.revokeObjectURL(url)
  }

  if (!activity.length) return <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No activity yet.</div></div>

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-ghost" onClick={exportCSV}>↓ Export CSV</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {activity.map(a => {
          const actor = a.actor_id ? profiles.find(p => p.id === a.actor_id) : null
          const actorName = actor?.full_name || (a.actor_id ? 'Unknown' : 'System (automated)')
          const verb = VERBS[a.action] || a.action
          const target = a.schedule_title || a.block_label || ''
          const affected = a.affected_profile_name && a.affected_profile_id !== a.actor_id ? ` — ${a.affected_profile_name}` : ''
          const time = new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
          return (
            <div key={a.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
              <div><b>{actorName}</b> {verb} {target}{affected}{a.detail ? ` — ${a.detail}` : ''}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{time} ET</div>
            </div>
          )
        })}
      </div>
    </>
  )
}
