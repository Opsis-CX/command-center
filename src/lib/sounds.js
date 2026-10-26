import { supabase } from './supabase'

// ============================================================
// sounds.js — notification sounds.
//
// All sounds are synthesized with Web Audio (no audio files to host or load).
// Each person picks a sound + volume, and optionally a different sound for
// things aimed at them directly (DMs, @mentions, replies, @here, @update).
// Saved in public.notification_sound_prefs so it follows them to any device.
//
// Who plays the sound:
//   • App open & in front      → the bell's realtime listener (no pop-up)
//   • App open in background   → the service worker asks this page to play it
//                                (pop-up shown silently, so only one sound)
//   • App fully closed         → the pop-up plays the computer's own sound
// playForNotification() de-dupes by notification id, so the realtime path
// and the service-worker path never double up.
// ============================================================

export const SOUNDS = [
  { key: 'chime',    label: 'Chime' },
  { key: 'bubble',   label: 'Bubble' },
  { key: 'marimba',  label: 'Marimba' },
  { key: 'pluck',    label: 'Pluck' },
  { key: 'twinkle',  label: 'Twinkle' },
  { key: 'doorbell', label: 'Doorbell' },
  { key: 'harp',     label: 'Harp' },
  { key: 'kalimba',  label: 'Kalimba' },
  { key: 'none',     label: 'None (silent)' },
]
// Sounds that were retired → what they now play (old saved choices keep working).
const RETIRED = { ding: 'doorbell', pop: 'bubble', knock: 'kalimba' }
const resolveKey = (k) => RETIRED[k] || k

// Things aimed at you directly — eligible for the "separate sound" option.
export const DIRECT_TYPES = new Set([
  'chat_dm', 'chat_mention', 'chat_reply', 'chat_here', 'chat_update',
  'task_mention', 'task_assigned', 'incoming_call',
])

export const DEFAULT_SOUND_PREFS = { sound: 'chime', direct_sound: null, volume: 70 }

// ---------- audio context ----------
let ctx = null
function getCtx() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { ctx = null } }
  return ctx
}
// Call from any click/keypress: browsers only allow audio after a user gesture.
export function primeAudio() {
  const c = getCtx()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}
// True if a sound can actually be heard right now (used to decide whether a
// background pop-up should stay silent).
export async function audioReady() {
  const c = getCtx()
  if (!c) return false
  if (c.state === 'suspended') { try { await c.resume() } catch { /* ignore */ } }
  return c.state === 'running'
}

// ---------- synth helpers ----------
function tone(c, out, { freq, start, dur = 0.35, type = 'sine', peak = 1, attack = 0.01, bend = null }) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (bend) osc.frequency.exponentialRampToValueAtTime(bend, start + dur)
  osc.connect(g); g.connect(out)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.linearRampToValueAtTime(peak, start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.start(start); osc.stop(start + dur + 0.05)
}

// Pitches are kept above ~400 Hz so laptop speakers actually reproduce them.
const SYNTHS = {
  chime: (c, o, t) => { tone(c, o, { freq: 880, start: t }); tone(c, o, { freq: 1174.66, start: t + 0.11 }) },
  bubble: (c, o, t) => {
    tone(c, o, { freq: 700, bend: 1500, start: t, dur: 0.16, attack: 0.004 })
    tone(c, o, { freq: 850, bend: 1800, start: t + 0.13, dur: 0.18, attack: 0.004, peak: 0.9 })
  },
  marimba: (c, o, t) => {
    ;[523.25, 659.25, 783.99].forEach((f, i) => {
      tone(c, o, { freq: f, start: t + i * 0.09, dur: 0.3, attack: 0.003 })
      tone(c, o, { freq: f * 4, start: t + i * 0.09, dur: 0.08, attack: 0.002, peak: 0.15 })
    })
  },
  pluck: (c, o, t) => {
    tone(c, o, { freq: 659.25, start: t, dur: 0.45, type: 'triangle', attack: 0.002 })
    tone(c, o, { freq: 987.77, start: t + 0.07, dur: 0.5, type: 'triangle', attack: 0.002, peak: 0.7 })
  },
  twinkle: (c, o, t) => {
    ;[1567.98, 2093, 2637.02, 3135.96].forEach((f, i) => tone(c, o, { freq: f, start: t + i * 0.06, dur: 0.28, peak: 0.6 }))
  },
  // "ding-dong": E5 then C5, each with a soft octave shimmer
  doorbell: (c, o, t) => {
    tone(c, o, { freq: 659.25, start: t, dur: 0.7, attack: 0.006 })
    tone(c, o, { freq: 1318.5, start: t, dur: 0.3, attack: 0.004, peak: 0.2 })
    tone(c, o, { freq: 523.25, start: t + 0.32, dur: 0.9, attack: 0.006 })
    tone(c, o, { freq: 1046.5, start: t + 0.32, dur: 0.35, attack: 0.004, peak: 0.2 })
  },
  // quick rising strum: C5 E5 G5 C6
  harp: (c, o, t) => {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(c, o, { freq: f, start: t + i * 0.055, dur: 0.55, type: 'triangle', attack: 0.002, peak: 0.8 })
      tone(c, o, { freq: f * 2, start: t + i * 0.055, dur: 0.2, attack: 0.002, peak: 0.15 })
    })
  },
  // thumb-piano: two tines with a tiny pitch settle and a bright tick on top
  kalimba: (c, o, t) => {
    tone(c, o, { freq: 1046.5, bend: 1030, start: t, dur: 0.6, attack: 0.002 })
    tone(c, o, { freq: 3140, start: t, dur: 0.12, attack: 0.001, peak: 0.3 })
    tone(c, o, { freq: 1568, bend: 1550, start: t + 0.14, dur: 0.5, attack: 0.002, peak: 0.6 })
    tone(c, o, { freq: 4700, start: t + 0.14, dur: 0.08, attack: 0.001, peak: 0.15 })
  },
}

// Loudness matching: measured (A-weighted, laptop-speaker roll-off) against
// Chime so every sound plays at about the same perceived volume, then all
// raised 15% (Brittney, 2026-10-25). Worst case at 100% volume stays well
// below clipping (~0.34 of full scale).
const BOOST = 1.15
const LEVEL = { chime: 1, bubble: 1.69, marimba: 1.17, pluck: 1.48, twinkle: 1.1, doorbell: 1.29, harp: 1.04, kalimba: 0.95 }

// Play a sound by key at a volume 0–100. Returns true if it could play.
export async function playSound(key, volume = 70) {
  key = resolveKey(key)
  if (!key || key === 'none' || !SYNTHS[key]) return false
  if (!(await audioReady())) return false
  const c = getCtx()
  const out = c.createGain()
  out.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.18 * (LEVEL[key] || 1) * BOOST
  out.connect(c.destination)
  SYNTHS[key](c, out, c.currentTime + 0.01)
  return true
}

// ---------- prefs ----------
let _prefs = { ...DEFAULT_SOUND_PREFS }
export function currentSoundPrefs() { return _prefs }

export async function loadSoundPrefs(profileId) {
  if (!profileId) return _prefs
  const { data } = await supabase.from('notification_sound_prefs')
    .select('sound, direct_sound, volume').eq('profile_id', profileId).maybeSingle()
  _prefs = { ...DEFAULT_SOUND_PREFS, ...(data || {}) }
  _prefs.sound = resolveKey(_prefs.sound)
  if (_prefs.direct_sound) _prefs.direct_sound = resolveKey(_prefs.direct_sound)
  return _prefs
}

export async function saveSoundPrefs(profileId, next) {
  _prefs = { ..._prefs, ...next }
  window.dispatchEvent(new CustomEvent('cc:soundprefs', { detail: _prefs }))
  const { error } = await supabase.from('notification_sound_prefs').upsert({
    profile_id: profileId, sound: _prefs.sound, direct_sound: _prefs.direct_sound,
    volume: _prefs.volume, updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' })
  if (error) throw new Error(error.message)
  return _prefs
}

export function soundKeyForType(prefs, type) {
  const p = prefs || _prefs
  if (DIRECT_TYPES.has(type) && p.direct_sound) return p.direct_sound
  return p.sound || 'chime'
}

// ---------- play once per notification ----------
// Both the realtime listener and the service worker may ask for the same
// notification; the second caller gets the first one's result.
const _played = new Map() // notification id -> { ts, result: Promise<boolean> }
export function playForNotification(id, type) {
  const now = Date.now()
  for (const [k, v] of _played) if (now - v.ts > 120000) _played.delete(k)
  if (id && _played.has(id)) return _played.get(id).result
  const result = playSound(soundKeyForType(_prefs, type), _prefs.volume)
  if (id) _played.set(id, { ts: now, result })
  return result
}
