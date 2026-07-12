// Timezone helper — the single source of truth for converting between the
// company authoring zone (Eastern) and each viewer's local zone.
//
// Model: schedules/events are authored in COMPANY_TZ. A stored value like
// date="2026-07-13", time="08:00" means "8:00 AM Eastern on that date".
// We turn that into a real instant, then format it in the viewer's zone.
// This correctly accounts for daylight saving (offsets depend on the date).

export const COMPANY_TZ = 'America/New_York'

// Browser's detected zone (used as the default suggestion in settings).
export function detectedTZ() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || COMPANY_TZ }
  catch { return COMPANY_TZ }
}

// Given a wall-clock time in a named zone, return the true UTC instant (Date).
// Browser-safe: uses formatToParts (never Date string parsing, which is
// locale/zone dependent). Computes the zone's offset at that moment and applies it.
function zonedWallTimeToInstant(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = (timeStr || '00:00').split(':').map(Number)
  // Start with the naive UTC value for these wall numbers.
  const naiveUTC = Date.UTC(y, mo - 1, d, h, mi)
  // Ask what wall-clock time that instant shows as IN the target zone.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(naiveUTC)).reduce((a, p) => (a[p.type] = p.value, a), {})
  // The zone rendered naiveUTC as this wall time; the gap is the zone's offset.
  let zonedAsUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
  const offset = zonedAsUTC - naiveUTC
  // Subtract the offset so the wall numbers land in the target zone.
  return new Date(naiveUTC - offset)
}

// Company-authored date+time → real instant (Date).
export function companyTimeToInstant(dateStr, timeStr) {
  return zonedWallTimeToInstant(dateStr, timeStr, COMPANY_TZ)
}

// Format an instant in a given zone.
export function formatInTZ(instant, tz, opts = {}) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || COMPANY_TZ,
    hour: 'numeric', minute: '2-digit',
    ...opts,
  }).format(instant)
}

// Company-authored time → "h:mm a" string in the viewer's zone.
// e.g. companyTimeToViewer('2026-07-13','08:00','America/Chicago') → "7:00 AM"
export function companyTimeToViewer(dateStr, timeStr, viewerTZ) {
  const inst = companyTimeToInstant(dateStr, timeStr)
  return formatInTZ(inst, viewerTZ || COMPANY_TZ)
}

// Wall time authored in `srcTZ` on `dateStr` → "h:mm AM" shown in `viewerTZ`.
// Robust/browser-safe. Used for manual events (creator tz) and shifts (company tz).
export function wallTimeToViewer(dateStr, timeStr, srcTZ, viewerTZ) {
  if (!timeStr) return ''
  try {
    const inst = zonedWallTimeToInstant(dateStr, timeStr, srcTZ || COMPANY_TZ)
    return formatInTZ(inst, viewerTZ || COMPANY_TZ)
  } catch { return timeStr }
}

// Same, but returns 24h "HH:MM" (for positioning in day/week grids).
export function wallTimeToViewerHHMM(dateStr, timeStr, srcTZ, viewerTZ) {
  if (!timeStr) return timeStr
  try {
    const inst = zonedWallTimeToInstant(dateStr, timeStr, srcTZ || COMPANY_TZ)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: viewerTZ || COMPANY_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(inst).reduce((a, p) => (a[p.type] = p.value, a), {})
    return `${parts.hour % 24 === 24 ? '00' : parts.hour}:${parts.minute}`
  } catch { return timeStr }
}

// Get the viewer's zone abbreviation (e.g. "CST") for labeling.
export function tzAbbrev(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date())
    return (parts.find(p => p.type === 'timeZoneName') || {}).value || ''
  } catch { return '' }
}

// A friendly list of common US zones for the settings picker.
export const US_ZONES = [
  ['America/New_York', 'Eastern (ET)'],
  ['America/Chicago', 'Central (CT)'],
  ['America/Denver', 'Mountain (MT)'],
  ['America/Phoenix', 'Arizona (no DST)'],
  ['America/Los_Angeles', 'Pacific (PT)'],
  ['America/Anchorage', 'Alaska (AKT)'],
  ['Pacific/Honolulu', 'Hawaii (HT)'],
]
