import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// ============================================================
// Company branding (2026-11-04). Loads org_branding and applies it to the whole app:
// brand color → buttons/links/highlights (--accent, its tint and text color), sidebar color,
// logo, browser-tab icon. Cached in localStorage so the colors show instantly on load.
// Where branding isn't set (or the table doesn't exist yet, e.g. live), nothing changes.
// ============================================================
const KEY = 'cc.branding'
const DEFAULT_LOGO = '/opsis-logo.png'
let _b = null
const _subs = new Set()

const hexOk = (h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h)
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
// readable text on top of a color
export const inkOn = (hex) => hexOk(hex) && luminance(hex) > 0.45 ? '#111827' : '#ffffff'

export function applyBranding(b) {
  const root = document.documentElement.style
  if (b && hexOk(b.primary_color)) {
    root.setProperty('--accent', b.primary_color)
    root.setProperty('--accent-bg', `color-mix(in srgb, ${b.primary_color} 13%, transparent)`)
    root.setProperty('--accent-ink', inkOn(b.primary_color))
    root.setProperty('--grad-accent', `linear-gradient(135deg, color-mix(in srgb, ${b.primary_color} 82%, white) 0%, ${b.primary_color} 100%)`)
  } else { ['--accent', '--accent-bg', '--accent-ink', '--grad-accent'].forEach(v => root.removeProperty(v)) }
  if (b && hexOk(b.sidebar_color)) {
    root.setProperty('--sidebar', b.sidebar_color)
    // the sidebar normally has a dark overlay; with a brand color, use the color itself (subtle depth)
    root.setProperty('--sidebar-bg', `linear-gradient(180deg, color-mix(in srgb, ${b.sidebar_color} 88%, white), ${b.sidebar_color} 55%, color-mix(in srgb, ${b.sidebar_color} 88%, black))`)
  } else { root.removeProperty('--sidebar'); root.removeProperty('--sidebar-bg') }
  const icon = b?.icon_url
  if (icon) {
    let link = document.querySelector('link[rel="icon"]')
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    if (link.href !== icon) link.href = icon
  }
  if (b?.company_name && !document.title.includes(b.company_name)) document.title = `${b.company_name} · Command Center`
}

export async function loadBranding(force = false) {
  if (_b && !force) return _b
  const { data, error } = await supabase.from('org_branding').select('*').maybeSingle()
  _b = error ? {} : (data || {})
  try { localStorage.setItem(KEY, JSON.stringify(_b)) } catch { /* private mode */ }
  applyBranding(_b)
  _subs.forEach(fn => fn(_b))
  return _b
}

// Apply the cached branding right away, then refresh from the database.
export function initBranding() {
  try { const cached = JSON.parse(localStorage.getItem(KEY) || 'null'); if (cached) { _b = cached; applyBranding(cached) } } catch { /* ignore */ }
  loadBranding(true).catch(() => {})
}

// Logo to show on a dark background (sidebar) or a light one.
export function logoFor(b, onDark = true) {
  if (!b) return DEFAULT_LOGO
  return (onDark ? (b.logo_dark_url || b.logo_url) : (b.logo_url || b.logo_dark_url)) || DEFAULT_LOGO
}

export function useBranding() {
  const [b, setB] = useState(_b)
  useEffect(() => { _subs.add(setB); if (!_b) loadBranding().then(setB).catch(() => {}); return () => { _subs.delete(setB) } }, [])
  return b
}
