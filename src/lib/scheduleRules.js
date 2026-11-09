import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// ============================================================
// Schedule rules (Configuration → Schedule rules, 2026-11-05). One place the screens read the
// company's rules from — the database enforces the same row. Defaults = the long-standing policy.
// ============================================================
export const RULES = {
  release_enabled: true, release_mode: 'weekly', release_weekday: 3, release_time: '11:00', release_weeks_before: 1, release_days_before: 14, release_now_days: 2,
  waves_enabled: true, waves: [],
  cap_enabled: true, cap_hours: 40,
  lock_enabled: true, lock_hours: 96,
  grace_enabled: true, grace_min: 15,
  auto_checkout_enabled: true, auto_checkout_min: 15,
}
// Per-schedule overrides (2026-11-05): a schedule can replace whole sections of the company rules.
export const OVERRIDES = {}   // schedule_id → { cap_hours: …, lock_enabled: …, … }
let promise = null
export function loadScheduleRules(force) {
  if (!promise || force) promise = Promise.all([
      supabase.from('schedule_rules').select('*').maybeSingle(),
      supabase.from('schedule_rule_overrides').select('schedule_id, rules'),
    ]).then(([{ data }, ov]) => {
      if (data) Object.assign(RULES, data, { cap_hours: Number(data.cap_hours) })
      for (const k of Object.keys(OVERRIDES)) delete OVERRIDES[k]
      for (const o of ov?.data || []) OVERRIDES[o.schedule_id] = o.rules || {}
      return RULES
    }).catch(() => RULES)
  return promise
}
// the rules for one schedule (company rules + that schedule's overrides)
export const rulesFor = (scheduleId) => (scheduleId && OVERRIDES[scheduleId] ? { ...RULES, ...OVERRIDES[scheduleId] } : RULES)
export function useScheduleRules() {
  const [, tick] = useState(0)
  useEffect(() => { let alive = true; loadScheduleRules().then(() => { if (alive) tick(t => t + 1) }); return () => { alive = false } }, [])
  return RULES
}
// helpers the screens use
// pass a schedule id to get that schedule's rule (leave it out for the company default)
export const capOn = (sid) => rulesFor(sid).cap_enabled !== false
export const capHours = (sid) => Number(rulesFor(sid).cap_hours) || 40
export const lockOn = (sid) => rulesFor(sid).lock_enabled !== false
export const lockHours = (sid) => Number(rulesFor(sid).lock_hours) || 96
export const graceOn = (sid) => rulesFor(sid).grace_enabled !== false
export const graceMin = (sid) => Number(rulesFor(sid).grace_min) || 15
const hrsLabel = (h) => h % 24 === 0 ? `${h / 24}-day (${h}-hour)` : `${h}-hour`
export function commitmentText(sid) {
  return lockOn(sid)
    ? `By accepting this interval, you are committing to service it. Once the ${hrsLabel(lockHours(sid))} schedule lock has passed, responsibility for the interval remains with you unless it is successfully transferred through the Trade Board.`
    : 'By accepting this interval, you are committing to service it. If you can no longer make it, release it or put it up on the Trade Board.'
}
export const lockLabel = (sid) => { const h = lockHours(sid); return h % 24 === 0 ? `within ${h / 24} day${h === 24 ? '' : 's'} of start` : `within ${h} hours of start` }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const fmtClock = (t) => { const [h, m] = String(t || '11:00').split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
// plain-language description of the release schedule, e.g. "every Wednesday at 11:00 AM ET (for the following week)"
export function releaseText() {
  if (!RULES.release_enabled) return 'as soon as they’re published'
  if (RULES.release_mode === 'daily') return `daily at ${fmtClock(RULES.release_time)} ET, ${RULES.release_days_before} days ahead`
  const wk = RULES.release_weeks_before === 1 ? 'the following week' : `${RULES.release_weeks_before} weeks out`
  return `every ${DAYS[RULES.release_weekday]} at ${fmtClock(RULES.release_time)} ET (for ${wk})`
}
