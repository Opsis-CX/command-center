import React, { useCallback, useEffect, useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { companyTimeToInstant } from '../lib/tz'
import { CheckIcon } from './HeaderIcons'

// ============================================================
// SHIFT CHECK-IN / CHECK-OUT (top "work" bar, 2026-11-02)
// Employee shift attendance only. Separate from the task timer (HeaderTaskTimer): it has its own data and its own
// clock, so it works whether or not tasks are loading, and a running task never affects it.
// Same rules as before: shown for everyone, only while one of your claimed intervals is active (15 min grace either
// side). Checking out outside your scheduled time asks for a note. Mirrors the Schedule module's check-in/out.
// ============================================================

const GRACE_MIN = 15

// interpret a company-zone wall time (date + "HH:MM") as a true instant (robust)
function companyInstant(dateStr, timeStr) {
  return companyTimeToInstant(dateStr, (timeStr || '00:00').slice(0, 5))
}

export default function HeaderShiftControls({ tickMs = 30000 }) {
  const { user } = useAuth()
  const userId = user?.id || null
  const [claims, setClaims] = useState([])
  const [blocks, setBlocks] = useState([])
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    if (!userId) return
    const [clmRes, blkRes] = await Promise.all([
      supabase.from('shift_claims').select('id, shift_block_id, profile_id, status, checked_in_at, checked_out_at').eq('profile_id', userId),
      fetchAllRows(() => supabase.from('shift_blocks').select('id, block_date, start_time, end_time, role').order('id')),
    ])
    // a failed read keeps what we already had, so a blip never makes the button vanish
    if (!clmRes.error) setClaims(clmRes.data || [])
    if (!blkRes.error) setBlocks(blkRes.data || [])
  }, [userId])

  useEffect(() => { load() }, [load])
  // refresh button / coming back to the tab
  useEffect(() => {
    const h = () => load()
    window.addEventListener('cc:refresh', h)
    return () => window.removeEventListener('cc:refresh', h)
  }, [load])

  // Its own clock: the button must appear when the interval opens even if nothing else re-renders.
  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), tickMs)
    const onVis = () => { if (!document.hidden) tick(x => x + 1) }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [tickMs])

  if (!userId) return null

  const now = new Date()   // real instant; compare against company-tz instants
  const activeClaim = claims.map(c => ({ c, b: blocks.find(b => b.id === c.shift_block_id) }))
    .filter(({ c, b }) => {
      if (!b || c.status === 'no_show' || c.checked_out_at) return false
      const start = companyInstant(b.block_date, b.start_time)
      const end = companyInstant(b.block_date, b.end_time)
      return now >= new Date(start.getTime() - GRACE_MIN * 60000) && now <= new Date(end.getTime() + GRACE_MIN * 60000)
    })[0]
  if (!activeClaim) return null

  async function checkIn() {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.from('shift_claims').update({ checked_in_at: new Date().toISOString(), status: 'checked_in' }).eq('id', activeClaim.c.id)
    setBusy(false)
    if (error) { window.alert('Could not check in: ' + error.message); return }
    load()
  }
  async function checkOut() {
    if (busy) return
    const b = activeClaim.b
    const end = companyInstant(b.block_date, b.end_time)
    const outOfWindow = Math.abs((new Date() - end) / 60000) > GRACE_MIN
    let note = ''
    if (outOfWindow) { note = window.prompt("You're outside your scheduled time. Add a note (required):") || ''; if (!note.trim()) return }
    const payload = { checked_out_at: new Date().toISOString(), status: outOfWindow ? 'pending_review' : 'completed' }
    if (note.trim()) payload.checkout_note = note.trim()
    setBusy(true)
    const { error } = await supabase.from('shift_claims').update(payload).eq('id', activeClaim.c.id)
    setBusy(false)
    if (error) { window.alert('Could not check out: ' + error.message); return }
    load()
  }

  return !activeClaim.c.checked_in_at ? (
    <button type="button" className="wb-btn wb-checkin" onClick={checkIn} disabled={busy} aria-label="I'm here — check in" title="I'm here — check in to my shift">
      <CheckIcon /> Check in
    </button>
  ) : (
    <div className="wb-checkgroup" role="group" aria-label="Shift attendance">
      <span className="wb-checked"><CheckIcon /> Checked in</span>
      <button type="button" className="wb-btn" onClick={checkOut} disabled={busy} title="Check out of my shift">Check out</button>
    </div>
  )
}
