// ============================================================
// SCHEDULE RELEASE POLICY (2026-11-06)
// Tier-based release times are OFF for now: every agent gets each daily release at the same moment.
// The release SCHEDULE itself is unchanged (each shift opens at its stored release time, 11:00 AM ET).
// The database side is the same switch: release_wave() returns one wave with no delay (the previous version is saved
// in perf_function_backup). To bring tiers back, set TIERED_RELEASE = true AND restore release_wave() from that backup.
// ============================================================
export const TIERED_RELEASE = false
export const ALL_AGENTS_RELEASE = { h: 11, m: 0, label: '11:00 AM' }
