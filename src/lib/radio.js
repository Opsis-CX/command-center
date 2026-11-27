import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from './supabase'

// ============================================================
// OPSIS RADIO (2026-11-27): shared state + helpers.
// The player itself lives in components/OpsisRadio.jsx (mounted once at the app level so the music
// keeps playing while you move between pages). The top-bar button and the player talk through this store.
// The playlist link and who can see the radio live in the radio_config table (one row), edited by admins
// from the gear inside the player: no code change needed to swap playlists.
// ============================================================

// ---- tiny shared store (open / minimized / playing). Never persisted: the radio never reopens or starts by itself. ----
let state = { open: false, min: false, playing: false }
const subs = new Set()
export const radioState = () => state
export function setRadio(patch) {
  state = { ...state, ...patch }
  subs.forEach(f => f())
}
export function useRadio() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => state)
}

// ---- playlist link -> playlist id ----
export function parsePlaylistId(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (/^[A-Za-z0-9_-]{10,80}$/.test(s)) return s                 // a bare playlist id
  try { const id = new URL(s).searchParams.get('list'); if (id && /^[A-Za-z0-9_-]+$/.test(id)) return id } catch { /* not a URL */ }
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

// ---- YouTube IFrame API (loaded once, only when someone opens the radio) ----
let ytPromise = null
export function loadYT() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT)
  if (ytPromise) return ytPromise
  ytPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { try { prev && prev() } catch { /* ignore */ } resolve(window.YT) }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => { ytPromise = null; reject(new Error('YouTube could not be reached')) }
    document.head.appendChild(s)
  })
  return ytPromise
}

// ---- radio_config + who the person is (cached; refreshed when an admin saves) ----
let cfgCache = null      // { config, isAdmin, uid }
let cfgLoading = null
async function readConfig(uid) {
  const [{ data: cfg }, { data: prof }] = await Promise.all([
    supabase.from('radio_config').select('playlist_url, visibility, allowed_profile_ids').eq('id', 1).maybeSingle(),
    supabase.from('profiles').select('is_admin, role').eq('id', uid).maybeSingle(),
  ])
  const isAdmin = !!prof?.is_admin || /^(owner|admin)$/i.test(String(prof?.role || ''))
  cfgCache = { uid, config: cfg || null, isAdmin }
  window.dispatchEvent(new Event('cc:radio-config'))
  return cfgCache
}
export function refreshRadioConfig(uid) { cfgLoading = null; return readConfig(uid) }

export function useRadioConfig(uid) {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick(t => t + 1)
    window.addEventListener('cc:radio-config', f)
    return () => window.removeEventListener('cc:radio-config', f)
  }, [])
  useEffect(() => {
    if (!uid) return
    if (cfgCache && cfgCache.uid === uid) return
    if (!cfgLoading) cfgLoading = readConfig(uid).catch(() => { cfgLoading = null })
  }, [uid])
  const c = cfgCache && cfgCache.uid === uid ? cfgCache : null
  const config = c?.config || null
  const allowed = !!c && !!config && (config.visibility === 'team' || (config.allowed_profile_ids || []).includes(uid))
  return { ready: !!c, allowed, isAdmin: !!c?.isAdmin, config }
}

// ---- each person's own volume (this browser only) ----
export const volKey = (uid) => `cc.radio.vol.${uid}`
export function readVol(uid) { try { const v = parseInt(localStorage.getItem(volKey(uid)), 10); return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50 } catch { return 50 } }
export function saveVol(uid, v) { try { localStorage.setItem(volKey(uid), String(v)) } catch { /* private mode */ } }
