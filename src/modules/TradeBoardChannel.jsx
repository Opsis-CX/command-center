import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'
import { COMPANY_TZ, wallTimeToViewer } from '../lib/tz'

// Interval acceptance verbiage (Becky picked Option 2, 2026-09-03). Same text
// as Schedule.jsx.
const INTERVAL_COMMITMENT = "By accepting this interval, you are committing to service it. Once the 4-day (96-hour) schedule lock has passed, responsibility for the interval remains with you unless it is successfully transferred through the Trade Board."

// ============================================================
// TRADE BOARD CHANNEL
// Renders inside Chat in place of the #GarageCo: Appointment
// Setters channel. Shows a live board of:
//   1. Available to take  — intervals other setters put up for trade
//   2. Open seats         — unclaimed setter seats you can grab (incl. releases)
//   3. Your offers        — intervals you put up for trade (take back)
//
// SAFETY: like Schedule.jsx, the checks here give instant feedback,
// but the DATABASE is the real authority — the shift_claims trigger
// and the interval-trade RPCs enforce capacity / overlap / 40h / cert.
// ============================================================

// Only intervals for this role belong on this board.
const ROLE = 'GarageCo: Appointment Setter'
const POLL_MS = 20000
const SEAT_CAP = 60   // cap open-seat cards rendered at once (agents see far fewer via the release window)

// ---- date/time helpers (Eastern), mirrored from Schedule.jsx ----
function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function blockTimeInViewer(dateStr, timeStr, viewerTZ) {
  if (!timeStr) return ''
  if (!viewerTZ || viewerTZ === COMPANY_TZ) return formatTime(timeStr)
  return wallTimeToViewer(dateStr, timeStr, COMPANY_TZ, viewerTZ)
}

export default function TradeBoardChannel({ me: meProp, isMobile, onBack }) {
  const { isAdmin, appRole } = useAuth()
  const canViewAll = isAdmin || can(appRole, 'schedule.view_all_schedules')
  const noReleaseTimes = isAdmin || can(appRole, 'schedule.no_release_times')

  const [me, setMe] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [blocks, setBlocks] = useState([])
  const [claims, setClaims] = useState([])
  const [trades, setTrades] = useState([])
  const [schedules, setSchedules] = useState([])
  const [audience, setAudience] = useState([])
  const [certRecords, setCertRecords] = useState([])
  const [certifications, setCertifications] = useState([])
  const [tiers, setTiers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(null)   // trade/block id currently acting on
  const [toast, setToast] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [meRes, profRes, blkRes, clmRes, trdRes, schRes, audRes, recRes, certRes, tierRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('id, full_name').order('full_name'),
        supabase.from('shift_blocks').select('*').eq('role', ROLE).order('block_date').order('start_time'),
        fetchAllRows(() => supabase.from('shift_claims').select('*').order('id')),
        supabase.from('interval_trades').select('*').eq('status', 'open'),
        supabase.from('schedules').select('*'),
        supabase.from('schedule_audience').select('*'),
        supabase.from('agent_cert_records').select('*'),
        supabase.from('certifications').select('id, call_type_id, active'),
        supabase.from('performance_tiers').select('*'),
      ])
      if (meRes.error) throw meRes.error
      setMe(meRes.data)
      setProfiles(profRes.data || [])
      setBlocks(blkRes.data || [])
      setClaims(clmRes.data || [])
      setTrades(trdRes.data || [])
      setSchedules(schRes.data || [])
      setAudience(audRes.data || [])
      setCertRecords(recRes.data || [])
      setCertifications(certRes.data || [])
      setTiers(tierRes.data || [])
    } catch (e) { setErr(e.message) } finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const ch = supabase.channel('tradeboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_claims' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_blocks' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interval_trades' }, () => load(true))
      .subscribe()
    const t = setInterval(() => load(true), POLL_MS)
    return () => { supabase.removeChannel(ch); clearInterval(t) }
  }, [load])

  function flash(m) { setToast(m); setTimeout(() => setToast(''), 3500) }

  // ---- eligibility helpers (mirror Schedule.jsx) ----
  const scheduleOf = (block) => schedules.find(s => s.id === block.schedule_id)
  function hasPassedCertForCallType(callTypeId) {
    const gating = certifications.filter(c => c.call_type_id === callTypeId && c.active !== false).map(c => c.id)
    if (!gating.length) return true
    return certRecords.some(r => r.profile_id === me?.id && gating.includes(r.certification_id) && r.status === 'passed')
  }
  const certOkForBlock = (block) => { const s = scheduleOf(block); return s ? (noReleaseTimes || hasPassedCertForCallType(s.call_type_id)) : true }
  const inAudience = (scheduleId) => audience.some(a => a.schedule_id === scheduleId && a.profile_id === me?.id)

  function hasIntervalStarted(block) {
    const now = etNow(); const todayStr = isoDate(now)
    if (block.block_date < todayStr) return true
    if (block.block_date > todayStr) return false
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const [h, m] = block.start_time.slice(0, 5).split(':').map(Number)
    return (h * 60 + m) <= nowMinutes
  }

  // Rolling release window: agents see today..today+horizon. No-release roles see all.
  function horizonISO() {
    if (noReleaseTimes) return '9999-12-31'
    const tier = tiers.find(t => t.id === me?.tier_id)
    let h = 11, m = 45
    if (tier && tier.release_time) { [h, m] = tier.release_time.split(':').map(Number) }
    const now = etNow(); const rel = new Date(now); rel.setHours(h, m, 0, 0)
    const horizonDays = now >= rel ? 14 : 13
    const d = etNow(); d.setDate(d.getDate() + horizonDays); return isoDate(d)
  }

  const nameOf = (id) => (profiles.find(p => p.id === id) || {}).full_name || 'Someone'
  const dayLabel = (block) => new Date(block.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const viewerTZ = me?.timezone

  // ---- actions ----
  async function acceptTrade(tr) {
    if (!window.confirm(INTERVAL_COMMITMENT + '\n\nAccept this interval?')) return
    setBusy(tr.id)
    const { error } = await supabase.rpc('accept_interval_trade', { p_trade_id: tr.id })
    setBusy(null)
    if (error) { flash(error.message || 'Could not accept that interval'); return }
    flash('✓ Interval is yours — check My Schedule'); load(true)
  }
  async function cancelTrade(tr) {
    setBusy(tr.id)
    const { error } = await supabase.rpc('cancel_interval_trade', { p_trade_id: tr.id })
    setBusy(null)
    if (error) { flash(error.message || 'Could not take that back'); return }
    flash('Taken back off the board'); load(true)
  }
  async function claimSeat(block) {
    if (!window.confirm(INTERVAL_COMMITMENT + '\n\nAccept this interval?')) return
    setBusy(block.id)
    const { error } = await supabase.from('shift_claims').insert({ shift_block_id: block.id, profile_id: me.id, status: 'claimed' })
    setBusy(null)
    if (error) { flash(error.message || 'Could not claim that seat'); load(true); return }
    flash('✓ Seat claimed — check My Schedule'); load(true)
  }

  // ---- derived rows ----
  const todayStr = isoDate(etNow())
  const myId = me?.id

  // 1) Available to take: open trades offered by others, block in future, not started.
  const takeRows = trades
    .map(tr => ({ tr, block: blocks.find(b => b.id === tr.shift_block_id) }))
    .filter(x => x.block && x.tr.offered_by !== myId && x.block.block_date >= todayStr && !hasIntervalStarted(x.block))
    .sort((a, b) => (a.block.block_date + a.block.start_time).localeCompare(b.block.block_date + b.block.start_time))

  // 3) Your offers: my open trades.
  const mineRows = trades
    .map(tr => ({ tr, block: blocks.find(b => b.id === tr.shift_block_id) }))
    .filter(x => x.block && x.tr.offered_by === myId)
    .sort((a, b) => (a.block.block_date + a.block.start_time).localeCompare(b.block.block_date + b.block.start_time))

  // 2) Open seats: unclaimed setter seats I can grab (includes released seats).
  const horizon = horizonISO()
  const seatRows = blocks
    .filter(b => {
      if (b.block_date < todayStr || hasIntervalStarted(b)) return false
      if (b.block_date > horizon) return false
      const s = scheduleOf(b)
      if (!s || s.status !== 'published') return false
      if (!(isAdmin || canViewAll || inAudience(b.schedule_id))) return false
      if (!certOkForBlock(b)) return false
      const held = claims.filter(c => c.shift_block_id === b.id)
      if (held.length >= (b.total_spots || 0)) return false        // no seat left
      if (held.some(c => c.profile_id === myId)) return false        // I already hold one
      return true
    })
    .map(b => ({ block: b, left: (b.total_spots || 0) - claims.filter(c => c.shift_block_id === b.id).length }))
    .sort((a, b) => (a.block.block_date + a.block.start_time).localeCompare(b.block.block_date + b.block.start_time))

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: 'var(--surface)' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        {isMobile && <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onBack}>‹</button>}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>🔁 GarageCo Trade Board</div>
          <div className="page-sub" style={{ fontSize: 12 }}>Grab an open seat or pick up an interval another setter can’t cover.</div>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 12.5, flex: 'none' }} onClick={() => load()} disabled={loading}>↻ Refresh</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: 16 }}>
        {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 14 }}><b style={{ color: 'var(--failed)' }}>Something went wrong.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}
        {loading && !me ? <p className="page-sub">Loading the board…</p> : (
          <>
            {/* Your offers */}
            {mineRows.length > 0 && (
              <>
                <div style={hdr}>Your offers</div>
                <div style={grid}>
                  {mineRows.map(({ tr, block }) => (
                    <div key={tr.id} className="iv mine" style={cardStyle}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{dayLabel(block)}</div>
                      <div style={{ fontSize: 15 }}>{blockTimeInViewer(block.block_date, block.start_time, viewerTZ)} – {blockTimeInViewer(block.block_date, block.end_time, viewerTZ)}</div>
                      <div style={{ fontSize: 11, color: 'var(--cta)', fontWeight: 700, margin: '6px 0 8px' }}>🔁 On the board — you still hold it</div>
                      <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, border: '1px solid var(--line)' }} disabled={busy === tr.id} onClick={() => cancelTrade(tr)}>{busy === tr.id ? '…' : 'Take back'}</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Available to take (trades) */}
            <div style={hdr}>Available to take {takeRows.length ? `(${takeRows.length})` : ''}</div>
            {takeRows.length === 0
              ? <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 20 }}>Nothing up for trade right now.</div></div>
              : <div style={grid}>
                  {takeRows.map(({ tr, block }) => {
                    const eligible = certOkForBlock(block)
                    return (
                      <div key={tr.id} className="iv" style={cardStyle}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{dayLabel(block)}</div>
                        <div style={{ fontSize: 15 }}>{blockTimeInViewer(block.block_date, block.start_time, viewerTZ)} – {blockTimeInViewer(block.block_date, block.end_time, viewerTZ)}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '4px 0 8px' }}>Offered by {nameOf(tr.offered_by)}</div>
                        {eligible
                          ? <button className="btn btn-primary" style={{ width: '100%', fontSize: 12 }} disabled={busy === tr.id} onClick={() => acceptTrade(tr)}>{busy === tr.id ? '…' : (hasIntervalStarted(block) ? 'Accept (started)' : 'Accept this interval')}</button>
                          : <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Not certified for this position yet.</div>}
                      </div>
                    )
                  })}
                </div>}

            {/* Open seats to claim */}
            <div style={{ ...hdr, marginTop: 18 }}>Open seats {seatRows.length ? `(${seatRows.length})` : ''}</div>
            {seatRows.length === 0
              ? <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 20 }}>No open seats available right now.</div></div>
              : <div style={grid}>
                  {seatRows.slice(0, SEAT_CAP).map(({ block, left }) => (
                    <div key={block.id} className="iv open" style={cardStyle}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{dayLabel(block)}</div>
                      <div style={{ fontSize: 15 }}>{blockTimeInViewer(block.block_date, block.start_time, viewerTZ)} – {blockTimeInViewer(block.block_date, block.end_time, viewerTZ)}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)', margin: '4px 0 8px' }}>{left} seat{left === 1 ? '' : 's'} open</div>
                      <button className="btn btn-primary" style={{ width: '100%', fontSize: 12 }} disabled={busy === block.id} onClick={() => claimSeat(block)}>{busy === block.id ? '…' : (hasIntervalStarted(block) ? 'Claim (started)' : 'Claim this seat')}</button>
                    </div>
                  ))}
                </div>}
            {seatRows.length > SEAT_CAP && <div className="page-sub" style={{ fontSize: 12 }}>Showing the soonest {SEAT_CAP} of {seatRows.length} open seats. Grab these first — more open up as the window rolls forward.</div>}
          </>
        )}
      </div>

      {toast && <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'var(--ink)', color: 'var(--surface)', padding: '9px 16px', borderRadius: 999, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,.2)', zIndex: 20 }}>{toast}</div>}
    </div>
  )
}

const hdr = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', margin: '4px 0 10px' }
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12, marginBottom: 20 }
const cardStyle = { padding: '14px 16px' }
