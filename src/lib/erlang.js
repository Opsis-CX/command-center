// ============================================================
// ERLANG C — workforce math for Command Center (2026-11-09)
// Pure functions, no React. Used by modules/Workforce.jsx and AiSpeedToLead.jsx.
//
//   A  = traffic in Erlangs = calls per interval × AHT ÷ interval seconds
//   N  = agents on the phones (net of shrinkage)
//   Erlang B is computed iteratively so large N never overflows;
//   Erlang C (probability a call waits) is derived from it.
// ============================================================

export function erlangB(N, A) {
  if (A <= 0) return 0
  let b = 1
  for (let k = 1; k <= N; k++) b = (A * b) / (k + A * b)
  return b
}

// Probability an arriving call has to wait (0..1). 1 when the queue is unstable (N <= A).
export function erlangC(N, A) {
  if (A <= 0) return 0
  if (N <= A) return 1
  const b = erlangB(N, A)
  return (N * b) / (N - A * (1 - b))
}

// Share of calls answered within T seconds.
export function serviceLevel(N, A, aht, T) {
  if (A <= 0) return 1
  if (N <= A) return 0
  const c = erlangC(N, A)
  return Math.max(0, Math.min(1, 1 - c * Math.exp(-(N - A) * (T / aht))))
}

// Average speed of answer, seconds (all calls, including those answered immediately).
export function asa(N, A, aht) {
  if (A <= 0) return 0
  if (N <= A) return Infinity
  return (erlangC(N, A) * aht) / (N - A)
}

// Rough abandon estimate: share of callers who would still be waiting after `patience` seconds.
export function abandonEst(N, A, aht, patience) {
  if (A <= 0) return 0
  if (N <= A) return 1
  return Math.max(0, Math.min(1, erlangC(N, A) * Math.exp(-(N - A) * (patience / aht))))
}

// One interval's staffing answer.
//   calls        forecast calls in the interval
//   aht          average handle time in seconds (talk + hold + wrap)
//   intervalSec  1800 for 30-minute intervals
//   slPct        target service level, e.g. 0.8
//   slSec        answered within this many seconds, e.g. 30
//   maxOcc       occupancy ceiling, e.g. 0.85 (people burn out above ~85-90%)
//   shrink       share of paid time agents are NOT on the phones (breaks, coaching, absence)
//   patience     seconds a caller waits before hanging up (for the abandon estimate)
//   minAgents    floor (e.g. 1 agent whenever the line is open)
export function staffInterval({ calls, aht, intervalSec = 1800, slPct = 0.8, slSec = 30, maxOcc = 0.85, shrink = 0.3, patience = 90, minAgents = 0 }) {
  const A = calls > 0 && aht > 0 ? (calls * aht) / intervalSec : 0
  if (A <= 0) {
    const N0 = minAgents
    return { A: 0, N: N0, scheduled: Math.ceil(N0 / Math.max(0.05, 1 - shrink)), sl: 1, asa: 0, occ: 0, pWait: 0, abandon: 0 }
  }
  let N = Math.max(minAgents, Math.floor(A) + 1)
  for (let guard = 0; guard < 2000; guard++) {
    const sl = serviceLevel(N, A, aht, slSec)
    if (sl >= slPct && A / N <= maxOcc) break
    N++
  }
  return {
    A,
    N,
    scheduled: Math.ceil(N / Math.max(0.05, 1 - shrink)),
    sl: serviceLevel(N, A, aht, slSec),
    asa: asa(N, A, aht),
    occ: A / N,
    pWait: erlangC(N, A),
    abandon: abandonEst(N, A, aht, patience),
  }
}

// How a GIVEN number of agents performs (used for "what we have scheduled" vs need).
export function performance({ calls, aht, N, intervalSec = 1800, slSec = 30, patience = 90 }) {
  const A = calls > 0 && aht > 0 ? (calls * aht) / intervalSec : 0
  if (A <= 0) return { A: 0, N, sl: 1, asa: 0, occ: 0, pWait: 0, abandon: 0 }
  if (!N || N <= 0) return { A, N: 0, sl: 0, asa: Infinity, occ: 1, pWait: 1, abandon: 1 }
  return { A, N, sl: serviceLevel(N, A, aht, slSec), asa: asa(N, A, aht), occ: Math.min(1, A / N), pWait: erlangC(N, A), abandon: abandonEst(N, A, aht, patience) }
}

// Sensitivity table: how SL / ASA / occupancy move as agents are added.
export function sensitivity({ calls, aht, intervalSec = 1800, slSec = 30, patience = 90, from, count = 10 }) {
  const A = calls > 0 && aht > 0 ? (calls * aht) / intervalSec : 0
  const start = Math.max(1, from ?? Math.floor(A) + 1)
  return Array.from({ length: count }, (_, i) => {
    const N = start + i
    return { N, ...performance({ calls, aht, N, intervalSec, slSec, patience }) }
  })
}

// Outbound / blended campaign workload. Returns agent-hours of work and agents for a window.
//   records          contacts to work
//   attemptsPerRec   average dial attempts per record over the campaign
//   connectRate      share of attempts that reach a live person
//   talk, wrap       seconds per live connect
//   ringSec          seconds an agent spends per attempt that does NOT connect (ring, VM detect, disposition)
//   previewSec       seconds reviewing a record before each attempt (preview mode)
//   efficiency       share of logged-in time an agent is actually working attempts (dialer pacing; preview ~0.75, progressive ~0.85, predictive ~0.92)
export function outboundWork({ records, attemptsPerRec = 2.5, connectRate = 0.3, talk = 180, wrap = 45, ringSec = 25, previewSec = 0, efficiency = 0.85, shrink = 0.3 }) {
  const attempts = records * attemptsPerRec
  const connects = attempts * connectRate
  const workSec = attempts * (previewSec) + (attempts - connects) * ringSec + connects * (talk + wrap)
  const prodHours = workSec / 3600 / Math.max(0.05, efficiency)
  const paidHours = prodHours / Math.max(0.05, 1 - shrink)
  return { attempts, connects, workSec, prodHours, paidHours, contactsPerHour: connects / Math.max(1e-9, prodHours) }
}

// Formatting helpers shared by the WFM screens.
export const pct = (v, d = 0) => (v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`)
export const secs = v => (v == null ? '—' : !isFinite(v) ? '∞' : v < 60 ? `${Math.round(v)}s` : `${Math.floor(v / 60)}m ${String(Math.round(v % 60)).padStart(2, '0')}s`)
export const slotLabel = (slot, short = false) => {
  const h = Math.floor(slot / 2), m = slot % 2 ? '30' : '00'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return short ? `${h12}:${m}${h >= 12 ? 'p' : 'a'}` : `${h12}:${m} ${h >= 12 ? 'PM' : 'AM'}`
}
