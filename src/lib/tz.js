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
// Works by asking what that zone's local time is for a guessed UTC and correcting.
function zonedWallTimeToInstant(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = (timeStr || '00:00').split(':').map(Number)
  // start from UTC guess, then find the offset that zone had at that moment
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const asZoned = new Date(guess).toLocaleString('en-US', { timeZone: tz })
  const diff = guess - new Date(asZoned).getTime()
  return new Date(guess + diff)
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
