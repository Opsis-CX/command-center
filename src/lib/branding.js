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

// Menu fonts: '' = Command Center default. Google Fonts load on demand.
export const FONTS = ['', 'Poppins', 'Inter', 'Montserrat', 'Lato', 'Open Sans', 'Roboto', 'Nunito', 'Raleway', 'Source Sans 3', 'Work Sans', 'DM Sans', 'Playfair Display', 'Merriweather', 'Georgia', 'Arial']
const SYSTEM_FONTS = { Georgia: 'Georgia, serif', Arial: 'Arial, Helvetica, sans-serif' }
export const fontStack = (f) => !f ? '' : SYSTEM_FONTS[f] || `'${f}', system-ui, sans-serif`
export function loadFont(f) {
  if (!f || SYSTEM_FONTS[f] || typeof document === 'undefined') return
  const id = 'cc-font-' + f.replace(/\s+/g, '-')
  if (document.getElementById(id)) return
  const link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`
  document.head.appendChild(link)
}
// Logo frame for a shape + size (px height). Used by the sidebar and the preview.
export function logoStyle(b) {
  const size = Number(b?.logo_size) || null, shape = b?.logo_shape || 'original'
  const frame = b?.logo_frame_color || '#ffffff'
  if (shape === 'original') return size ? { h: size + 'px', w: 'auto', maxh: size + 'px', radius: '0', frame: 'transparent', pad: '0' } : null
  const h = (size || 64) + 'px'
  if (shape === 'wide') return { h, w: Math.round((size || 64) * 2.6) + 'px', maxh: h, radius: '10px', frame, pad: '6px 10px' }
  return { h, w: h, maxh: h, radius: shape === 'circle' ? '50%' : shape === 'rounded' ? '22%' : '4px', frame, pad: shape === 'circle' ? '14%' : '9%' }
}
export const ICON_FILTERS = { color: 'none', bw: 'grayscale(1)', white: 'grayscale(1) brightness(0) invert(1)', black: 'grayscale(1) brightness(0)' }

export function applyBranding(b) {
  const root = document.documentElement.style
  const setOr = (k, v) => v ? root.setProperty(k, v) : root.removeProperty(k)
  // logo size/shape
  const ls = logoStyle(b)
  setOr('--logo-h', ls?.h); setOr('--logo-w', ls?.w); setOr('--logo-maxh', ls?.maxh); setOr('--logo-radius', ls?.radius); setOr('--logo-frame', ls?.frame); setOr('--logo-pad', ls?.pad)
  // menu font / size / color / icons
  if (b?.nav_font) loadFont(b.nav_font)
  setOr('--nav-font', fontStack(b?.nav_font))
  setOr('--nav-size', b?.nav_font_size ? b.nav_font_size + 'px' : '')
  setOr('--nav-ink', hexOk(b?.nav_text_color) ? b.nav_text_color : '')
  // 'bw' = Line icons: drawn outlines (NavIcon), so no filter; white/black silhouette the emojis
  setOr('--nav-ic-filter', ['white', 'black'].includes(b?.nav_icon_style) ? ICON_FILTERS[b.nav_icon_style] : '')
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
