import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// SEASONAL DECORATIONS (2026-10-27, Brittney) — cute, never scary.
// Turns itself on/off by date. Each person can switch it off in Settings
// (profiles.seasonal_effects). "Reduce motion" gets the still parts only.
// Purely decorative: pointer-events: none everywhere, nothing touches data.
// Halloween = kawaii hand-drawn characters (ghost, bats, candy, pumpkins, kitty).
// Thanksgiving (2026-11-18) = warm autumn: turkey, falling leaves, acorns, pie, harvest basket.
// Christmas (2026-11-18) = icy blue + teal: pine garlands, snowman, snowy forest, falling snow.
// Add a holiday = add an entry to SEASONS (month/day, inclusive).
// ============================================================

export const SEASONS = [
  { key: 'halloween', from: [10, 27], to: [10, 31],
    greeting: (first) => `Happy Halloween week${first ? `, ${first}` : ''}!`,
    hat: 'witch' },
  { key: 'thanksgiving', from: [11, 22], to: [11, 28],
    greeting: (first) => `Happy Thanksgiving${first ? `, ${first}` : ''}! We're thankful for you 🧡`,
    hat: 'pilgrim' },
  // Christmas: live now for testing (Brittney will send the real go-live/end dates). Thanksgiving is
  // listed first, so Nov 22–28 still shows Thanksgiving and Christmas picks back up after.
  { key: 'christmas', from: [11, 18], to: [12, 31],
    greeting: (first) => `Merry Christmas${first ? `, ${first}` : ''}! 🎄`,
    hat: 'santa' },
]

let _off = false
// Dates are checked in America/New_York, so Halloween ends at midnight Nov 1 Eastern for everyone.
export function activeSeason(d = new Date()) {
  const [mo, da] = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).split('/').map(Number)
  const md = mo * 100 + da
  return SEASONS.find(s => md >= s.from[0] * 100 + s.from[1] && md <= s.to[0] * 100 + s.to[1]) || null
}
export function seasonalHat() { if (_off) return null; return activeSeason()?.hat || null }
// Re-render when the person's on/off setting is known or changes.
export function useSeasonOn() {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick(t => t + 1); window.addEventListener('cc:seasonal-state', f); return () => window.removeEventListener('cc:seasonal-state', f) }, [])
  return !!seasonalHat()
}
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
export function celebrate(x, y) { window.dispatchEvent(new CustomEvent('cc:celebrate', { detail: { x, y } })) }

const PURPLE = '#7C3AED', LAV = '#C4B5FD', ORANGE = '#FB923C', ORANGE_D = '#F97316', BLUSH = '#F9A8D4', INK = '#2E1065'

const CSS = `
@keyframes ccAcross { from { transform: translateX(-160px) } to { transform: translateX(calc(100vw + 160px)) } }
@keyframes ccBob { 0%, 100% { transform: translateY(0) rotate(-5deg) } 50% { transform: translateY(-22px) rotate(5deg) } }
@keyframes ccFlap { 0%, 100% { transform: scaleY(1) } 50% { transform: scaleY(.35) } }
@keyframes ccWave { 0%, 100% { transform: rotate(0) } 50% { transform: rotate(-28deg) } }
@keyframes ccSwing { 0%, 100% { transform: rotate(-5deg) } 50% { transform: rotate(5deg) } }
@keyframes ccSwish { 0%, 100% { transform: rotate(-10deg) } 50% { transform: rotate(14deg) } }
@keyframes ccBlink { 0%, 92%, 100% { transform: scaleY(1) } 95% { transform: scaleY(.1) } }
@keyframes ccPeek { 0% { transform: translateX(110%) } 18%, 82% { transform: translateX(0) } 100% { transform: translateX(110%) } }
@keyframes ccPop { 0% { transform: translate(0,0) scale(.3) rotate(0); opacity: 0 } 12% { opacity: 1 }
  100% { transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--rot)); opacity: 0 } }
@keyframes ccGreetIn { from { opacity: 0; transform: translate(-50%, -10px) scale(.96) } to { opacity: 1; transform: translate(-50%, 0) scale(1) } }
@keyframes ccSparkle { 0%, 100% { opacity: .2; transform: scale(.7) } 50% { opacity: 1; transform: scale(1) } }
.cc-season-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2400; overflow: hidden; }
@keyframes ccFlyTop { from { transform: translateX(-180px) } to { transform: translateX(calc(100vw + 180px)) } }
@keyframes ccRise { 0% { transform: translateY(105%) } 20%, 78% { transform: translateY(0) } 100% { transform: translateY(105%) } }
@keyframes ccHang { 0%, 100% { transform: rotate(-7deg) } 50% { transform: rotate(7deg) } }
@keyframes ccShimmer { from { background-position: 0 0 } to { background-position: 400px 0 } }
.cc-desktop-only { display: block; }
@media (max-width: 900px) { .cc-desktop-only { display: none !important; } }
.cc-blink { transform-box: fill-box; transform-origin: center; animation: ccBlink 4.5s infinite; }
@keyframes ccFall { from { transform: translate(0, -70px) rotate(0) } to { transform: translate(var(--drift), 108vh) rotate(var(--spin)) } }
@keyframes ccSway { 0%, 100% { transform: translateX(-14px) } 50% { transform: translateX(14px) } }
@keyframes ccWaddle { 0%, 100% { transform: translateY(0) rotate(-4deg) } 50% { transform: translateY(-5px) rotate(4deg) } }
@keyframes ccWalk { from { transform: translateX(-130px) } to { transform: translateX(calc(100vw + 130px)) } }
`

// ---------- characters ----------
export function Ghost({ size = 54, wave = true }) {
  return (
    <svg width={size} height={size * 1.08} viewBox="0 0 60 65" aria-hidden="true" style={{ overflow: 'visible', filter: 'drop-shadow(0 6px 10px rgba(124,58,237,.18))' }}>
      <g style={{ transformOrigin: '52px 34px', transformBox: 'view-box', animation: wave ? 'ccWave 1.4s ease-in-out infinite' : 'none' }}>
        <ellipse cx="55" cy="30" rx="5" ry="4" fill="#fff" stroke="#E9D5FF" strokeWidth="1.5" />
      </g>
      <path d="M30 4 C14 4 7 17 7 32 L7 55 Q11 61 16 55 Q20.5 49 25 56 Q30 62 35 56 Q39.5 49 44 55 Q49 61 53 55 L53 32 C53 17 46 4 30 4 Z" fill="#fff" stroke="#E9D5FF" strokeWidth="1.5" />
      <g className="cc-blink">
        <ellipse cx="22" cy="28" rx="3.2" ry="4.2" fill={INK} /><ellipse cx="38" cy="28" rx="3.2" ry="4.2" fill={INK} />
      </g>
      <circle cx="23.2" cy="26.5" r="1.1" fill="#fff" /><circle cx="39.2" cy="26.5" r="1.1" fill="#fff" />
      <ellipse cx="16.5" cy="35" rx="4.2" ry="2.6" fill={BLUSH} opacity=".85" /><ellipse cx="43.5" cy="35" rx="4.2" ry="2.6" fill={BLUSH} opacity=".85" />
      <path d="M26.5 35.5 Q30 39.5 33.5 35.5" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}
function Bat({ size = 46, delay = 0 }) {
  const flap = { transformBox: 'fill-box', animation: `ccFlap .38s ease-in-out ${delay}s infinite` }
  return (
    <svg width={size} height={size * .6} viewBox="0 0 80 48" aria-hidden="true" style={{ overflow: 'visible' }}>
      <path style={{ ...flap, transformOrigin: 'right center' }} d="M30 24 Q18 6 2 14 Q8 18 6 24 Q12 22 14 28 Q20 24 22 30 Z" fill={PURPLE} />
      <path style={{ ...flap, transformOrigin: 'left center' }} d="M50 24 Q62 6 78 14 Q72 18 74 24 Q68 22 66 28 Q60 24 58 30 Z" fill={PURPLE} />
      <path d="M31 14 L33 5 L37 12 Z M49 14 L47 5 L43 12 Z" fill="#6D28D9" />
      <circle cx="40" cy="25" r="13" fill="#8B5CF6" />
      <g className="cc-blink"><circle cx="35" cy="23" r="3.6" fill="#fff" /><circle cx="45" cy="23" r="3.6" fill="#fff" /></g>
      <circle cx="35.6" cy="23.6" r="1.9" fill={INK} /><circle cx="45.6" cy="23.6" r="1.9" fill={INK} />
      <ellipse cx="31" cy="29" rx="2.6" ry="1.6" fill={BLUSH} /><ellipse cx="49" cy="29" rx="2.6" ry="1.6" fill={BLUSH} />
      <path d="M37.5 29.5 Q40 31.5 42.5 29.5" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}
function Candy({ size = 34, color = '#F472B6' }) {
  return (
    <svg width={size} height={size * .55} viewBox="0 0 60 33" aria-hidden="true">
      <path d="M16 16.5 L3 6 Q1 16.5 3 27 Z" fill={color} opacity=".85" /><path d="M44 16.5 L57 6 Q59 16.5 57 27 Z" fill={color} opacity=".85" />
      <circle cx="30" cy="16.5" r="13" fill={color} />
      <path d="M20 9 Q30 16 24 28 M30 4 Q40 14 33 29 M38 7 Q45 16 41 25" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".9" />
    </svg>
  )
}
function Pumpkin({ size = 56, face = true }) {
  return (
    <svg width={size} height={size * .86} viewBox="0 0 64 55" aria-hidden="true">
      <path d="M32 10 Q30 3 35 1" stroke="#65A30D" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M35 6 Q44 1 47 8 Q40 10 35 6 Z" fill="#84CC16" />
      <ellipse cx="20" cy="32" rx="15" ry="20" fill={ORANGE_D} /><ellipse cx="44" cy="32" rx="15" ry="20" fill={ORANGE_D} />
      <ellipse cx="32" cy="32" rx="16" ry="21" fill={ORANGE} />
      {face && <>
        <g className="cc-blink"><ellipse cx="25" cy="30" rx="3" ry="3.8" fill={INK} /><ellipse cx="39" cy="30" rx="3" ry="3.8" fill={INK} /></g>
        <circle cx="26" cy="28.6" r="1" fill="#fff" /><circle cx="40" cy="28.6" r="1" fill="#fff" />
        <ellipse cx="19.5" cy="37" rx="3.6" ry="2.2" fill="#FDA4AF" /><ellipse cx="44.5" cy="37" rx="3.6" ry="2.2" fill="#FDA4AF" />
        <path d="M28 37 Q32 41 36 37" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </>}
    </svg>
  )
}
function Kitty({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ overflow: 'visible' }}>
      <path style={{ transformOrigin: '46px 54px', transformBox: 'view-box', animation: 'ccSwish 2.4s ease-in-out infinite' }}
        d="M46 54 Q60 50 58 36 Q57 30 61 27" stroke="#312E81" strokeWidth="5" fill="none" strokeLinecap="round" />
      <ellipse cx="32" cy="50" rx="17" ry="13" fill="#312E81" />
      <path d="M17 22 L19 8 L28 17 Z M47 22 L45 8 L36 17 Z" fill="#312E81" />
      <path d="M20 19 L21 12 L25.5 17 Z M44 19 L43 12 L38.5 17 Z" fill="#F9A8D4" />
      <circle cx="32" cy="28" r="16" fill="#312E81" />
      <g className="cc-blink"><ellipse cx="25.5" cy="27" rx="4" ry="4.8" fill="#FDE047" /><ellipse cx="38.5" cy="27" rx="4" ry="4.8" fill="#FDE047" /></g>
      <ellipse cx="25.5" cy="27.6" rx="1.6" ry="3.4" fill={INK} /><ellipse cx="38.5" cy="27.6" rx="1.6" ry="3.4" fill={INK} />
      <circle cx="26.6" cy="25.4" r="1" fill="#fff" /><circle cx="39.6" cy="25.4" r="1" fill="#fff" />
      <path d="M30.5 32.5 L33.5 32.5 L32 34.2 Z" fill="#F9A8D4" />
      <path d="M32 34.2 Q30 36.4 28.5 35.2 M32 34.2 Q34 36.4 35.5 35.2" stroke="#F9A8D4" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M20 32 L12 30 M20 34.5 L12 35.5 M44 32 L52 30 M44 34.5 L52 35.5" stroke="#A5B4FC" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
function Sparkle({ size = 14, color = '#FDE047', delay = 0 }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={{ animation: `ccSparkle 1.8s ease-in-out ${delay}s infinite` }}>
    <path d="M10 0 Q11.5 8.5 20 10 Q11.5 11.5 10 20 Q8.5 11.5 0 10 Q8.5 8.5 10 0 Z" fill={color} /></svg>
}

// A soft web with a smiling, swinging spider.
function CornerWeb() {
  return (
    <svg width="130" height="138" viewBox="0 0 104 110" aria-hidden="true" style={{ position: 'fixed', top: 0, right: 0, opacity: .75, pointerEvents: 'none', zIndex: 2300, overflow: 'visible' }}>
      <g stroke={LAV} strokeWidth="1.3" fill="none" strokeLinecap="round">
        <path d="M104 0 L14 6 M104 0 L30 52 M104 0 L60 84 M104 0 L96 96" />
        <path d="M82 1.4 Q84 12 86 13 Q92 18 102 22" /><path d="M59 3 Q64 22 68 27 Q80 38 101 45" /><path d="M36 4.5 Q44 32 50 40 Q68 58 99 68" />
      </g>
      <g style={{ transformOrigin: '44px 0', transformBox: 'view-box', animation: reduceMotion() ? 'none' : 'ccSwing 3.6s ease-in-out infinite' }}>
        <line x1="44" y1="0" x2="44" y2="54" stroke={LAV} strokeWidth="1.2" />
        <g stroke="#6D28D9" strokeWidth="1.8" strokeLinecap="round"><path d="M36 58 l-7 -4 M36 62 l-7 1 M36 66 l-6 4 M52 58 l7 -4 M52 62 l7 1 M52 66 l6 4" /></g>
        <circle cx="44" cy="62" r="9.5" fill={PURPLE} />
        <circle cx="40.5" cy="60.5" r="2.4" fill="#fff" /><circle cx="47.5" cy="60.5" r="2.4" fill="#fff" />
        <circle cx="40.9" cy="60.9" r="1.1" fill={INK} /><circle cx="47.9" cy="60.9" r="1.1" fill={INK} />
        <ellipse cx="37.5" cy="65" rx="2" ry="1.2" fill={BLUSH} /><ellipse cx="50.5" cy="65" rx="2" ry="1.2" fill={BLUSH} />
        <path d="M41.5 65.5 Q44 67.5 46.5 65.5" stroke="#FDE68A" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  )
}

// A smaller, mirrored web for the top-left of the main area (just right of the sidebar).
function LeftWeb() {
  return (
    <svg className="cc-desktop-only" width="92" height="92" viewBox="0 0 104 110" aria-hidden="true"
      style={{ position: 'fixed', top: 60, left: 238, transform: 'scaleX(-1)', opacity: .5, pointerEvents: 'none', zIndex: 2300 }}>
      <g stroke={LAV} strokeWidth="1.3" fill="none" strokeLinecap="round">
        <path d="M104 0 L14 6 M104 0 L30 52 M104 0 L60 84 M104 0 L96 96" />
        <path d="M82 1.4 Q84 12 86 13 Q92 18 102 22" /><path d="M59 3 Q64 22 68 27 Q80 38 101 45" /><path d="M36 4.5 Q44 32 50 40 Q68 58 99 68" />
      </g>
    </svg>
  )
}
// Three tiny bats hanging under the top bar on silk threads, and a few twinkling sparkles.
function TopDecor() {
  const still = reduceMotion()
  const hang = (left, len, size, delay) => (
    <div key={left} style={{ position: 'fixed', top: 60, left, transformOrigin: 'top center', animation: still ? 'none' : `ccHang ${3.4 + delay}s ease-in-out ${delay}s infinite`, pointerEvents: 'none', zIndex: 2300 }}>
      <div style={{ width: 1, height: len, background: LAV, margin: '0 auto' }} />
      <div style={{ transform: 'rotate(180deg)', marginTop: -2 }}><Bat size={size} delay={delay} /></div>
    </div>
  )
  return (
    <div aria-hidden="true" className="cc-desktop-only">
      {hang('36%', 10, 30, 0)}{hang('57%', 18, 26, .7)}{hang('78%', 8, 28, 1.3)}
      {[['30%', 66, '#C084FC', 0], ['46%', 70, '#F9A8D4', .6], ['66%', 64, '#FDE047', 1.1], ['86%', 70, '#C084FC', 1.6]].map(([left, top, c, d]) => (
        <div key={left} style={{ position: 'fixed', left, top, pointerEvents: 'none', zIndex: 2300 }}><Sparkle size={12} color={c} delay={d} /></div>
      ))}
    </div>
  )
}

// Little pumpkin patch with a kitty, bottom corner (left of the phone button).
function PumpkinPatch() {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', right: 92, bottom: -4, zIndex: 2300, pointerEvents: 'none', display: 'flex', alignItems: 'flex-end', gap: 0, opacity: .96 }}>
      <div style={{ marginRight: -12, transform: 'rotate(-6deg)' }}><Pumpkin size={58} /></div>
      <div style={{ zIndex: 1 }}><Kitty size={76} /></div>
      <div style={{ marginLeft: -10 }}><Pumpkin size={46} /></div>
      <div style={{ position: 'absolute', left: 38, top: -12 }}><Sparkle size={13} delay={.2} /></div>
      <div style={{ position: 'absolute', right: 8, top: 4 }}><Sparkle size={11} color="#F9A8D4" delay={.9} /></div>
    </div>
  )
}


// ---------- Thanksgiving ----------
const RUST = '#C2410C', AMBER = '#F59E0B', GOLD = '#FACC15', CRAN = '#DC2626', BARK = '#78350F', COCOA = '#3B1D0A', CREAM = '#FFF7ED'
export function Turkey({ size = 64, sway = true }) {
  const feathers = [[-62, CRAN], [-31, ORANGE_D], [0, AMBER], [31, ORANGE_D], [62, CRAN], [-46, GOLD], [46, GOLD], [-15, RUST], [15, RUST]]
  return (
    <svg width={size} height={size * .92} viewBox="0 0 80 74" aria-hidden="true" style={{ overflow: 'visible', filter: 'drop-shadow(0 6px 10px rgba(194,65,12,.18))' }}>
      <g style={{ transformOrigin: '40px 46px', transformBox: 'view-box', animation: sway ? 'ccSwing 2.6s ease-in-out infinite' : 'none' }}>
        {feathers.map(([a, c], i) => <ellipse key={i} cx="40" cy="17" rx="8.5" ry="19" fill={c} transform={`rotate(${a} 40 46)`} />)}
        {feathers.slice(0, 5).map(([a], i) => <ellipse key={'t' + i} cx="40" cy="6" rx="4" ry="5" fill={CREAM} opacity=".55" transform={`rotate(${a} 40 46)`} />)}
      </g>
      <path d="M33 66 l-3 6 M33 66 l0 7 M33 66 l3 6 M47 66 l-3 6 M47 66 l0 7 M47 66 l3 6" stroke={AMBER} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="40" cy="50" rx="17" ry="17" fill="#9A4A1E" />
      <ellipse cx="40" cy="55" rx="10" ry="10" fill="#E8B07A" />
      <circle cx="40" cy="31" r="11.5" fill="#B5652F" />
      <g className="cc-blink"><ellipse cx="35.5" cy="29" rx="2.4" ry="3" fill={INK} /><ellipse cx="44.5" cy="29" rx="2.4" ry="3" fill={INK} /></g>
      <circle cx="36.2" cy="28" r=".9" fill="#fff" /><circle cx="45.2" cy="28" r=".9" fill="#fff" />
      <ellipse cx="31.5" cy="34" rx="2.6" ry="1.7" fill={BLUSH} /><ellipse cx="48.5" cy="34" rx="2.6" ry="1.7" fill={BLUSH} />
      <path d="M37.2 32.5 L42.8 32.5 L40 36.5 Z" fill={AMBER} />
      <path d="M41.6 35.2 Q44.5 39 42.4 42.2 Q39.6 40.4 41 35.6 Z" fill={CRAN} />
    </svg>
  )
}
// ---------- Thanksgiving v3 (2026-11-18, Brittney's mockup) ----------
// Everything below is only drawn during the Thanksgiving dates and sits on fixed layers with
// pointer-events: none (except the Gratitude Tree button, the announcement and the popup),
// lined up with the app's own header and content area so it never covers controls.
const SHADE = (hex, pct) => {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255
  const f = (c) => Math.max(0, Math.min(255, Math.round(pct >= 0 ? c + (255 - c) * pct / 100 : c * (1 + pct / 100))))
  return '#' + [f(r), f(g), f(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}
const MAPLE_D = 'M50.0 65.0C49.9 65.0 49.8 65.4 49.7 65.7C49.7 65.9 49.6 66.1 49.5 66.3C49.4 66.5 49.3 66.7 49.1 66.9C49.0 67.1 48.9 67.3 48.8 67.5C48.7 67.7 48.5 67.9 48.4 68.1C48.3 68.3 48.1 68.4 48.0 68.6C47.9 68.8 47.7 69.0 47.6 69.1C47.4 69.3 47.3 69.4 47.1 69.6C47.0 69.7 46.8 69.8 46.6 70.0C46.5 70.1 46.3 70.2 46.2 70.3C46.0 70.4 45.9 70.4 45.7 70.4C45.6 70.4 45.5 70.3 45.4 70.3C45.2 70.2 45.1 70.2 45.0 70.1C44.9 70.1 44.7 70.1 44.6 70.0C44.5 70.0 44.4 69.9 44.3 69.9C44.1 69.8 44.0 69.8 43.9 69.7C43.8 69.6 43.7 69.6 43.5 69.5C43.4 69.5 43.3 69.4 43.2 69.4C43.1 69.3 43.0 69.2 42.8 69.2C42.7 69.1 42.6 69.1 42.5 69.0C42.4 68.9 42.3 68.9 42.2 68.8C42.1 68.7 41.9 68.7 41.8 68.6C41.7 68.5 41.6 68.4 41.5 68.4C41.4 68.3 41.3 68.2 41.2 68.1C41.0 68.1 40.9 68.1 40.7 68.1C40.5 68.1 40.4 68.1 40.0 68.3C39.7 68.5 39.2 68.9 38.6 69.4C38.0 69.8 37.2 70.5 36.4 71.1C35.6 71.7 34.8 72.3 33.9 73.0C33.0 73.6 31.8 74.5 31.0 75.0C30.3 75.4 29.5 75.7 29.3 75.7C29.0 75.6 29.3 75.0 29.3 74.6C29.3 74.3 29.3 74.0 29.2 73.8C29.1 73.5 29.1 73.3 28.9 73.1C28.7 72.9 28.5 72.8 28.1 72.8C27.6 72.9 26.8 73.2 26.1 73.3C25.5 73.5 24.8 73.7 24.0 73.8C23.3 74.0 22.4 74.3 21.8 74.3C21.3 74.3 20.7 74.3 20.8 73.9C20.8 73.5 21.7 72.7 22.1 72.1C22.6 71.5 23.0 70.9 23.5 70.4C23.9 69.8 24.5 69.3 24.8 68.8C25.2 68.4 25.4 68.0 25.4 67.7C25.5 67.4 25.3 67.3 25.1 67.1C24.9 66.9 24.7 66.7 24.5 66.6C24.2 66.4 23.7 66.4 23.6 66.1C23.4 65.9 23.1 65.8 23.6 65.3C24.1 64.9 25.7 64.1 26.7 63.6C27.7 63.0 28.7 62.5 29.6 62.0C30.5 61.6 31.4 61.2 32.2 60.8C33.0 60.4 33.9 60.0 34.3 59.8C34.8 59.5 34.8 59.4 34.9 59.2C35.1 59.0 35.2 58.9 35.2 58.7C35.3 58.6 35.2 58.5 35.2 58.3C35.2 58.2 35.1 58.1 35.1 58.0C35.1 57.8 35.1 57.7 35.1 57.6C35.1 57.4 35.1 57.3 35.0 57.2C35.0 57.0 35.0 56.9 35.0 56.8C35.0 56.7 35.0 56.5 35.0 56.4C35.0 56.3 35.0 56.1 35.0 56.0C35.0 55.9 35.0 55.7 35.0 55.6C35.0 55.5 35.0 55.3 35.0 55.2C35.0 55.1 35.1 55.0 35.0 54.8C34.9 54.7 34.8 54.5 34.6 54.4C34.4 54.2 34.1 54.1 33.9 53.9C33.6 53.7 33.4 53.5 33.0 53.3C32.6 53.1 32.3 52.9 31.4 52.6C30.5 52.2 28.9 51.7 27.4 51.2C26.0 50.7 24.4 50.1 22.8 49.5C21.2 48.8 19.5 48.1 17.8 47.4C16.1 46.6 13.1 45.4 12.5 44.9C12.0 44.4 13.7 44.5 14.3 44.4C14.9 44.3 15.7 44.2 16.2 44.0C16.8 43.9 17.3 43.8 17.8 43.6C18.2 43.5 18.7 43.4 18.7 43.0C18.7 42.7 18.1 42.2 17.6 41.6C17.1 41.0 16.4 40.3 15.8 39.7C15.1 39.0 14.5 38.3 13.9 37.6C13.2 36.9 12.6 36.1 12.0 35.4C11.3 34.6 10.7 33.8 10.1 33.0C9.5 32.1 8.3 30.9 8.2 30.4C8.2 29.9 9.0 29.8 9.7 29.8C10.5 29.9 11.8 30.2 12.8 30.4C13.8 30.6 14.8 30.9 15.7 31.1C16.7 31.3 17.6 31.6 18.5 31.9C19.4 32.1 20.3 32.4 21.2 32.7C22.0 32.9 23.1 33.4 23.7 33.5C24.3 33.6 24.6 33.5 24.7 33.2C24.9 33.0 24.7 32.5 24.7 32.0C24.6 31.5 24.5 30.9 24.3 30.3C24.1 29.7 23.6 28.6 23.7 28.3C23.9 28.0 24.2 27.8 25.2 28.4C26.1 29.0 28.2 30.9 29.5 32.1C30.9 33.2 32.2 34.4 33.5 35.6C34.7 36.7 35.9 37.9 36.9 38.9C37.9 39.9 38.8 40.9 39.4 41.5C40.0 42.0 40.1 41.9 40.4 42.1C40.8 42.3 41.0 42.5 41.3 42.6C41.6 42.7 41.8 42.9 42.0 42.9C42.2 43.0 42.4 43.1 42.5 43.0C42.6 42.9 42.6 42.7 42.7 42.5C42.7 42.3 42.7 42.0 42.7 41.7C42.7 41.4 42.7 41.1 42.7 40.7C42.7 40.4 42.7 40.1 42.7 39.5C42.6 39.0 42.6 38.5 42.3 37.4C42.0 36.3 41.5 34.4 41.1 32.7C40.7 31.1 40.2 29.2 39.8 27.3C39.4 25.4 39.1 23.4 38.7 21.3C38.4 19.2 37.7 15.5 37.8 14.8C37.9 14.1 39.0 16.3 39.5 16.9C40.1 17.6 40.6 18.2 41.0 18.7C41.5 19.2 42.0 19.7 42.4 20.1C42.8 20.4 43.2 20.9 43.5 20.7C43.8 20.5 43.9 19.6 44.1 18.9C44.3 18.1 44.5 17.0 44.7 16.1C45.0 15.2 45.2 14.2 45.5 13.2C45.8 12.3 46.1 11.3 46.4 10.3C46.7 9.3 47.1 8.3 47.4 7.3C47.8 6.3 48.2 5.2 48.6 4.2C49.1 3.1 49.5 1.0 50.0 1.0C50.5 1.0 50.9 3.1 51.4 4.2C51.8 5.2 52.2 6.3 52.6 7.3C52.9 8.3 53.3 9.3 53.6 10.3C53.9 11.3 54.2 12.3 54.5 13.2C54.8 14.2 55.0 15.2 55.3 16.1C55.5 17.0 55.7 18.1 55.9 18.9C56.1 19.6 56.2 20.5 56.5 20.7C56.8 20.9 57.2 20.4 57.6 20.1C58.0 19.7 58.5 19.2 59.0 18.7C59.4 18.2 59.9 17.6 60.5 16.9C61.0 16.3 62.1 14.1 62.2 14.8C62.3 15.5 61.6 19.2 61.3 21.3C60.9 23.4 60.6 25.4 60.2 27.3C59.8 29.2 59.3 31.1 58.9 32.7C58.5 34.4 58.0 36.3 57.7 37.4C57.4 38.5 57.4 39.0 57.3 39.5C57.3 40.1 57.3 40.4 57.3 40.7C57.3 41.1 57.3 41.4 57.3 41.7C57.3 42.0 57.3 42.3 57.3 42.5C57.4 42.7 57.4 42.9 57.5 43.0C57.6 43.1 57.8 43.0 58.0 42.9C58.2 42.9 58.4 42.7 58.7 42.6C59.0 42.5 59.2 42.3 59.6 42.1C59.9 41.9 60.0 42.0 60.6 41.5C61.2 40.9 62.1 39.9 63.1 38.9C64.1 37.9 65.3 36.7 66.5 35.6C67.8 34.4 69.1 33.2 70.5 32.1C71.8 30.9 73.9 29.0 74.8 28.4C75.8 27.8 76.1 28.0 76.3 28.3C76.4 28.6 75.9 29.7 75.7 30.3C75.5 30.9 75.4 31.5 75.3 32.0C75.3 32.5 75.1 33.0 75.3 33.2C75.4 33.5 75.7 33.6 76.3 33.5C76.9 33.4 78.0 32.9 78.8 32.7C79.7 32.4 80.6 32.1 81.5 31.9C82.4 31.6 83.3 31.3 84.3 31.1C85.2 30.9 86.2 30.6 87.2 30.4C88.2 30.2 89.5 29.9 90.3 29.8C91.0 29.8 91.8 29.9 91.8 30.4C91.7 30.9 90.5 32.1 89.9 33.0C89.3 33.8 88.7 34.6 88.0 35.4C87.4 36.1 86.8 36.9 86.1 37.6C85.5 38.3 84.9 39.0 84.2 39.7C83.6 40.3 82.9 41.0 82.4 41.6C81.9 42.2 81.3 42.7 81.3 43.0C81.3 43.4 81.8 43.5 82.2 43.6C82.7 43.8 83.2 43.9 83.8 44.0C84.3 44.2 85.1 44.3 85.7 44.4C86.3 44.5 88.0 44.4 87.5 44.9C86.9 45.4 83.9 46.6 82.2 47.4C80.5 48.1 78.8 48.8 77.2 49.5C75.6 50.1 74.0 50.7 72.6 51.2C71.1 51.7 69.5 52.2 68.6 52.6C67.7 52.9 67.4 53.1 67.0 53.3C66.6 53.5 66.4 53.7 66.1 53.9C65.9 54.1 65.6 54.2 65.4 54.4C65.2 54.5 65.1 54.7 65.0 54.8C64.9 55.0 65.0 55.1 65.0 55.2C65.0 55.3 65.0 55.5 65.0 55.6C65.0 55.7 65.0 55.9 65.0 56.0C65.0 56.1 65.0 56.3 65.0 56.4C65.0 56.5 65.0 56.7 65.0 56.8C65.0 56.9 65.0 57.0 65.0 57.2C64.9 57.3 64.9 57.4 64.9 57.6C64.9 57.7 64.9 57.8 64.9 58.0C64.9 58.1 64.8 58.2 64.8 58.3C64.8 58.5 64.7 58.6 64.8 58.7C64.8 58.9 64.9 59.0 65.1 59.2C65.2 59.4 65.2 59.5 65.7 59.8C66.1 60.0 67.0 60.4 67.8 60.8C68.6 61.2 69.5 61.6 70.4 62.0C71.3 62.5 72.3 63.0 73.3 63.6C74.3 64.1 75.9 64.9 76.4 65.3C76.9 65.8 76.6 65.9 76.4 66.1C76.3 66.4 75.8 66.4 75.5 66.6C75.3 66.7 75.1 66.9 74.9 67.1C74.7 67.3 74.5 67.4 74.6 67.7C74.6 68.0 74.8 68.4 75.2 68.8C75.5 69.3 76.1 69.8 76.5 70.4C77.0 70.9 77.4 71.5 77.9 72.1C78.3 72.7 79.2 73.5 79.2 73.9C79.3 74.3 78.7 74.3 78.2 74.3C77.6 74.3 76.7 74.0 76.0 73.8C75.2 73.7 74.5 73.5 73.9 73.3C73.2 73.2 72.4 72.9 71.9 72.8C71.5 72.8 71.3 72.9 71.1 73.1C70.9 73.3 70.9 73.5 70.8 73.8C70.7 74.0 70.7 74.3 70.7 74.6C70.7 75.0 71.0 75.6 70.7 75.7C70.5 75.7 69.7 75.4 69.0 75.0C68.2 74.5 67.0 73.6 66.1 73.0C65.2 72.3 64.4 71.7 63.6 71.1C62.8 70.5 62.0 69.8 61.4 69.4C60.8 68.9 60.3 68.5 60.0 68.3C59.6 68.1 59.5 68.1 59.3 68.1C59.1 68.1 59.0 68.1 58.8 68.1C58.7 68.2 58.6 68.3 58.5 68.4C58.4 68.4 58.3 68.5 58.2 68.6C58.1 68.7 57.9 68.7 57.8 68.8C57.7 68.9 57.6 68.9 57.5 69.0C57.4 69.1 57.3 69.1 57.2 69.2C57.0 69.2 56.9 69.3 56.8 69.4C56.7 69.4 56.6 69.5 56.5 69.5C56.3 69.6 56.2 69.6 56.1 69.7C56.0 69.8 55.9 69.8 55.7 69.9C55.6 69.9 55.5 70.0 55.4 70.0C55.3 70.1 55.1 70.1 55.0 70.1C54.9 70.2 54.8 70.2 54.6 70.3C54.5 70.3 54.4 70.4 54.3 70.4C54.1 70.4 54.0 70.4 53.8 70.3C53.7 70.2 53.5 70.1 53.4 70.0C53.2 69.8 53.0 69.7 52.9 69.6C52.7 69.4 52.6 69.3 52.4 69.1C52.3 69.0 52.1 68.8 52.0 68.6C51.9 68.4 51.7 68.3 51.6 68.1C51.5 67.9 51.3 67.7 51.2 67.5C51.1 67.3 51.0 67.1 50.9 66.9C50.7 66.7 50.6 66.5 50.5 66.3C50.4 66.1 50.3 65.9 50.3 65.7C50.2 65.4 50.1 65.0 50.0 65.0Z'
const MAPLE_VEINS = 'M50 60 L50.0 8.7 M50 60 L86.5 33.2 M50 60 L13.5 33.2 M50 60 L75.5 72.0 M50 60 L24.5 72.0'
const MAPLE_STEM = 'M50 64 Q51 86 54 98'
export function Leaf({ size = 26, color = ORANGE_D }) {
  const id = 'tgl' + color.replace('#', '')
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
      <defs><radialGradient id={id} cx="50%" cy="58%" r="62%"><stop offset="0%" stopColor={SHADE(color, 28)} /><stop offset="100%" stopColor={SHADE(color, -18)} /></radialGradient></defs>
      <path d={MAPLE_STEM} stroke="#7C2D12" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d={MAPLE_D} fill={`url(#${id})`} stroke="#7C2D12" strokeOpacity=".28" strokeWidth="1.2" />
      <path d={MAPLE_VEINS} stroke="#7C2D12" strokeOpacity=".38" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}
function Acorn({ size = 30, face = true }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d="M20 10 Q21 4 25 2" stroke={BARK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="28" rx="13" ry="15" fill={AMBER} />
      <path d="M5 19 Q20 6 35 19 Q35 23 20 23 Q5 23 5 19 Z" fill={BARK} />
      {face && <>
        <g className="cc-blink"><ellipse cx="15.5" cy="29" rx="2" ry="2.5" fill={INK} /><ellipse cx="24.5" cy="29" rx="2" ry="2.5" fill={INK} /></g>
        <path d="M18 33 Q20 35 22 33" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>}
    </svg>
  )
}
function Pie({ size = 36 }) {
  return (
    <svg width={size} height={size * .72} viewBox="0 0 50 36" aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d="M3 30 L44 17 Q48 25 44 32 Z" fill="#E9A86A" />
      <path d="M5 28 L42 17.5 L42 24 L6 31 Z" fill="#EA7A2B" />
      <path d="M3 30 L44 32" stroke="#C9874A" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 17 Q29 11 34 11 Q35 6 39.5 9 Q44 8 43.5 13 Q46 16 41 18 Q35 20 30 17 Z" fill="#fff" stroke="#FDE7CF" strokeWidth="1" />
    </svg>
  )
}
function PilgrimHatSvg({ size }) {
  const w = Math.max(13, Math.round(size * 0.82))
  return (
    <svg aria-hidden="true" width={w} height={w} viewBox="0 0 40 40"
      style={{ position: 'absolute', left: -Math.round(size * 0.12), top: -Math.round(size * 0.5), transform: 'rotate(-12deg)', pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
      <ellipse cx="20" cy="33" rx="18" ry="4.6" fill="#1F2937" />
      <path d="M10 32 L12.5 9 Q20 6.5 27.5 9 L30 32 Z" fill="#334155" />
      <path d="M11.2 24.5 Q20 27 28.8 24.5 L29.5 30.5 Q20 33 10.5 30.5 Z" fill="#92400E" />
      <rect x="16.5" y="24.6" width="7" height="6.2" rx="1" fill="none" stroke={GOLD} strokeWidth="1.8" />
    </svg>
  )
}
const LEAF_COLORS = ['#EA580C', '#C2410C', '#DC2626', '#F59E0B', '#D97706', '#B45309', '#E8A33D', '#9A3412']
// Golden leafy sprig (header lettering, popup title).
function Sprig({ w = 86, flip = false }) {
  const pts = [16, 30, 44, 58, 72, 86]
  const ys = (x) => 30 - (x - 2) * 0.19
  const cs = ['#D97706', '#EA580C', '#F59E0B', '#C2410C', '#E8A33D', '#B45309']
  return (
    <svg width={w} height={w * .44} viewBox="0 0 100 44" aria-hidden="true" style={{ overflow: 'visible', transform: flip ? 'scaleX(-1)' : 'none', flex: 'none' }}>
      <path d="M2 30 Q50 24 99 11" stroke="#A16207" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {pts.map((x, i) => (
        <g key={x}>
          <ellipse cx={x + 4} cy={ys(x) - 6} rx="8" ry="3.4" transform={`rotate(-32 ${x + 4} ${ys(x) - 6})`} fill={cs[i]} />
          <ellipse cx={x + 4} cy={ys(x) + 5} rx="8" ry="3.4" transform={`rotate(26 ${x + 4} ${ys(x) + 5})`} fill={cs[(i + 3) % cs.length]} />
        </g>
      ))}
      <ellipse cx="98" cy="10" rx="7" ry="3.2" transform="rotate(-15 98 10)" fill="#F59E0B" />
    </svg>
  )
}
function HarvestPumpkin({ size = 50, tone = 'orange' }) {
  const c = tone === 'cream' ? ['#FFF8EA', '#EEDCB8', '#CFB07A'] : ['#FDBA74', '#F97316', '#C2410C']
  const id = 'hp' + tone
  return (
    <svg width={size} height={size * .8} viewBox="0 0 64 51" aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
      <defs><radialGradient id={id} cx="40%" cy="35%" r="72%"><stop offset="0%" stopColor={c[0]} /><stop offset="68%" stopColor={c[1]} /><stop offset="100%" stopColor={c[2]} /></radialGradient></defs>
      <path d="M32 12 Q31 5 35 2" stroke="#6B5528" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M35 6 Q42 1 46 7" stroke="#4D7C0F" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <ellipse cx="15" cy="31" rx="13" ry="17.5" fill={`url(#${id})`} /><ellipse cx="49" cy="31" rx="13" ry="17.5" fill={`url(#${id})`} />
      <ellipse cx="23.5" cy="31" rx="12" ry="19.5" fill={`url(#${id})`} stroke={c[2]} strokeOpacity=".35" />
      <ellipse cx="40.5" cy="31" rx="12" ry="19.5" fill={`url(#${id})`} stroke={c[2]} strokeOpacity=".35" />
      <ellipse cx="32" cy="31" rx="11" ry="20" fill={`url(#${id})`} stroke={c[2]} strokeOpacity=".45" />
      <ellipse cx="27" cy="22" rx="3" ry="6.5" fill="#fff" opacity=".22" />
    </svg>
  )
}
// A lush corner spray like the mockup: overlapping maple leaves of different sizes plus golden sprigs,
// spreading along both edges of the frame. Coordinates are [along top, along side, size, rotation, color]
// from the frame corner; leaves stay close to the frame line so they sit in the page margin.
const SPRAY = [
  [-2, -2, 48, -35, '#C2410C'], [30, -4, 40, 25, '#EA580C'], [-4, 30, 40, -100, '#F59E0B'], [58, 0, 34, 60, '#DC2626'],
  [0, 58, 34, -130, '#D97706'], [84, -3, 30, 10, '#E8A33D'], [-3, 84, 30, -60, '#B91C1C'], [108, 1, 26, 40, '#EA580C'],
  [1, 108, 26, 100, '#F59E0B'], [132, -2, 22, -20, '#9A3412'], [-2, 132, 22, 150, '#C2410C'], [16, 12, 24, -10, '#FBBF24'],
  [152, 2, 18, 30, '#D97706'], [2, 154, 18, -40, '#DC2626'],
]
function CornerSpray({ scale = 1, flipX = false, flipY = false, sprigs = true }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`, pointerEvents: 'none' }}>
      {sprigs && <>
        <div style={{ position: 'absolute', left: 40 * scale, top: -24 * scale }}><Sprig w={120 * scale} /></div>
        <div style={{ position: 'absolute', left: 24 * scale, top: 40 * scale, transform: 'rotate(90deg)', transformOrigin: '0 0' }}><Sprig w={110 * scale} /></div>
      </>}
      {SPRAY.slice().reverse().map(([x, y, sz, r, c], i) => {
        const S = sz * scale
        return <div key={i} style={{ position: 'absolute', left: x * scale - S / 2, top: y * scale - S / 2, transform: `rotate(${r}deg)` }}><Leaf size={S} color={c} /></div>
      })}
    </div>
  )
}


// ---------- Painted artwork (2026-11-18) ----------
// Cut from Brittney's Thanksgiving mockup (transparent PNGs in public/seasonal/thanksgiving/), so the
// decorations look painted like the mockup instead of flat. Sizes are the images' natural pixel sizes.
const ART = '/seasonal/thanksgiving/'
const ART_SIZE = {"corner_tl": [236, 68], "title": [352, 64], "sprig_l": [103, 50], "sprig_r": [93, 50], "corner_tr": [236, 68], "side_r": [100, 140], "corner_bl": [227, 148], "pumpkins": [213, 94], "corner_br": [42, 206], "hdr_l": [112, 56], "hdr_r": [86, 56], "hdr_title": [322, 54], "btn_leaf": [34, 36], "ann_leaf": [34, 36], "tree": [545, 232], "leaf_0": [28, 27], "leaf_1": [32, 33], "leaf_2": [37, 41], "leaf_3": [22, 28], "leaf_4": [46, 48], "leaf_5": [32, 26], "leaf_6": [49, 49], "leaf_7": [22, 27], "leaf_8": [43, 39], "leaf_9": [26, 22], "leaf_10": [29, 25]}
const LEAF_ART = Array.from({ length: 11 }, (_, i) => 'leaf_' + i)
// where leaves can land on the painted tree (percent of its width/height). The first 11 are where the
// leaves sit in the mockup, so the tree fills in to look like the design.
const TREE_ART_SLOTS = [[32.8, 4.9], [59.5, 6.4], [66.9, 11.4], [44.2, 12.3], [24.9, 18.4], [68.9, 22.9], [17.3, 31.5], [49.1, 28.6], [77.1, 49.8], [19.8, 53.9], [67.0, 57.8], [36.0, 50.9], [55.2, 52.6], [33.9, 28.0], [59.1, 29.3], [79.4, 29.3], [27.5, 44.0], [44.2, 57.8], [41.5, 36.2], [70.1, 40.9], [62.0, 45.3], [38.3, 17.7], [54.7, 19.0], [53.9, 36.6], [22.0, 39.2], [30.5, 55.6], [30.6, 17.2], [63.3, 21.1], [32.8, 40.5], [74.3, 33.2], [40.9, 48.3], [28.1, 27.2], [38.7, 6.9], [41.5, 25.4], [23.7, 48.7], [72.8, 48.7], [37.2, 34.5], [66.2, 45.3], [62.9, 54.7], [58.0, 44.8], [35.0, 12.5], [55.2, 28.0], [44.0, 43.1], [58.0, 14.7], [62.9, 37.1], [30.8, 47.4], [76.3, 25.9], [70.8, 33.2], [59.8, 51.7], [25.1, 39.2], [44.0, 50.4], [42.6, 18.5], [65.9, 25.0], [41.5, 55.2], [31.0, 28.9], [33.0, 52.2], [61.8, 27.2], [35.2, 44.4], [69.5, 47.4], [32.5, 22.4]]
const isDarkTheme = () => {
  const t = document.documentElement.getAttribute('data-theme')
  if (t) return t === 'dark'
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}
function ArtImg({ name, h, w, style, ...rest }) {
  const [nw, nh] = ART_SIZE[name] || [1, 1]
  const width = w || (h ? h * nw / nh : nw), height = h || (w ? w * nh / nw : nh)
  return <img src={ART + name + '.png'} alt="" aria-hidden="true" draggable="false" width={Math.round(width)} height={Math.round(height)} style={{ display: 'block', userSelect: 'none', ...style }} {...rest} />
}

const TG_COZY_CSS = `
body.cc-thanksgiving { --tg-a: 62%; --tg-b: 9%; --tg-frame: rgba(234,88,12,.55); }
:root[data-theme="dark"] body.cc-thanksgiving { --tg-a: 16%; --tg-b: 4%; --tg-frame: rgba(234,88,12,.45); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) body.cc-thanksgiving { --tg-a: 16%; --tg-b: 4%; --tg-frame: rgba(234,88,12,.45); } }
body.cc-thanksgiving .topbar {
  background: linear-gradient(90deg, color-mix(in srgb, #FFEDD5 var(--tg-a), var(--surface)) 0%, color-mix(in srgb, #FFF4E2 var(--tg-a), var(--surface)) 50%, color-mix(in srgb, #FFE8D2 var(--tg-a), var(--surface)) 100%) !important;
  border-bottom-color: color-mix(in srgb, #FDBA74 50%, var(--line)) !important;
}
body.cc-thanksgiving .workbar { background: color-mix(in srgb, #FFF3E3 calc(var(--tg-a) * .8), var(--workbar-bg)); border-bottom-color: color-mix(in srgb, #FDBA74 40%, var(--workbar-line)); }
body.cc-thanksgiving .main { background: color-mix(in srgb, #FED7AA var(--tg-b), var(--canvas)); }
.tg-script { font-family: 'Kaushan Script', 'Dancing Script', cursive; font-weight: 400; letter-spacing: .3px; line-height: 1; white-space: nowrap; }
.tg-btn { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 8px 0 14px; border-radius: 999px; cursor: pointer; font-family: inherit;
  font-size: 14px; font-weight: 700; color: #FFF3E3; white-space: nowrap; border: 1px solid #C2410C; background: linear-gradient(180deg, #A53D12 0%, #7C2D12 100%);
  box-shadow: 0 6px 16px -8px rgba(124,45,18,.8), inset 0 1px 0 rgba(255,255,255,.18); transition: transform .15s, box-shadow .15s; }
.tg-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -10px rgba(124,45,18,.9), inset 0 1px 0 rgba(255,255,255,.2); }
.tg-btn:focus-visible, .tg-ann:focus-visible { outline: 2px solid #FDBA74; outline-offset: 2px; }
.tg-badge { min-width: 26px; height: 26px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center; background: #F97316; color: #fff; font-size: 12.5px; font-weight: 800; box-shadow: inset 0 0 0 2px rgba(255,255,255,.25); }
.tg-ann { pointer-events: auto; display: inline-flex; align-items: center; gap: 10px; height: 38px; padding: 0 8px 0 14px; border-radius: 999px; border: 2px solid #EA580C; background: #FFFCF6;
  color: #9A3412; font-family: inherit; font-size: 14px; font-weight: 700; white-space: nowrap; box-shadow: 0 6px 18px -10px rgba(194,65,12,.7); }
:root[data-theme="dark"] .tg-ann { background: #2A1A10; color: #FDBA74; }
.tg-ann-main { display: inline-flex; align-items: center; gap: 10px; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tg-ann-btn { cursor: pointer; padding: 0 8px 0 14px; transition: transform .15s, box-shadow .15s; }
.tg-ann-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -10px rgba(194,65,12,.75); }
.tg-ann-x { border: 0; background: transparent; color: inherit; cursor: pointer; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 15px; }
.tg-ann-x:hover { background: rgba(234,88,12,.12); }
.tg-tree-leaf { cursor: pointer; }
.tg-tree-leaf > g { transition: transform .15s; transform-box: fill-box; transform-origin: center; }
.tg-tree-leaf:hover > g, .tg-tree-leaf.on > g { transform: scale(1.4); }
@keyframes tgLeafIn { from { opacity: 0; transform: translateY(-50px) rotate(-120deg) scale(.3) } to { opacity: 1; transform: none } }
.tg-tab { border: 0; background: transparent; font: inherit; font-size: 15px; font-weight: 700; color: var(--ink); padding: 6px 2px 8px; margin-right: 22px; cursor: pointer; border-bottom: 3px solid transparent; }
.tg-tab.on { color: #EA580C; border-bottom-color: #EA580C; }
`
const GRAT_SEASON = 'thanksgiving-2026'
const hashNum = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h) }

// "Happy Thanksgiving!" lettering + Gratitude Tree button, centered in the empty middle of the top bar.
// measure text width once per string (canvas; falls back to an estimate)
const _tw = {}
function textWidth(str, font) {
  const key = font + '|' + str
  if (_tw[key]) return _tw[key]
  // a web font (quoted family) only counts once it has actually loaded, otherwise we'd remember the fallback width
  let ready = true
  const fam = (font.match(/'([^']+)'/) || [])[1]
  if (fam) { try { ready = [...document.fonts].some(f => f.family.replace(/["']/g, '') === fam && f.status === 'loaded') } catch { ready = true } }
  let w = str.length * parseFloat(font) * .5
  try { const c = document.createElement('canvas').getContext('2d'); c.font = font; w = c.measureText(str).width } catch { /* ignore */ }
  if (!ready) return w
  return (_tw[key] = w)
}
const TG_LINE_2 = "We're thankful for you!"
// "Happy Thanksgiving! We're thankful for you!" with the leaf sprigs, centered in the top bar.
// It's centered on the bar itself; if the page name or the right-side icons would get in the way it
// drops the second line, then the sprigs, then hides. The Fall Mode switch stays at the far right.
function TgHeader({ count, onOpen, fall, setFall }) {
  const left = useAnchorRect('.topbar .crumb', 800), right = useAnchorRect('.topbar .tb-right', 800), bar = useAnchorRect('.topbar', 800)
  if (!left || !right || !bar) return null
  const wide = window.innerWidth >= 1000
  const freeAll = right.left - left.right - 32
  // narrow screens: Fall Mode switch sits at the right end of the free space
  const fallW = wide ? 0 : (freeAll >= 420 ? 148 : freeAll >= 120 ? 70 : 0)
  const lo = left.right + 16, hi = right.left - 16 - (fallW ? fallW + 12 : 0)
  const center = bar.left + bar.width / 2
  const half = Math.min(center - lo, hi - center)
  const dark = isDarkTheme()
  // measure the whole message at full size, then scale everything (lettering + sprigs) down to fit
  const widthAt = (H, parts) => {
    const sprigH = H * .78
    const titleW = dark ? textWidth('Happy Thanksgiving!', `${Math.round(H * .66)}px 'Kaushan Script'`) : H * ART_SIZE.title[0] / ART_SIZE.title[1]
    const line2W = textWidth(TG_LINE_2, `${Math.round(H * .58)}px 'Kaushan Script'`) + 14
    const sprigsW = sprigH * (ART_SIZE.sprig_l[0] + ART_SIZE.sprig_r[0]) / ART_SIZE.sprig_l[1] + 20
    return titleW + (parts.line2 ? line2W : 0) + (parts.sprigs ? sprigsW : 0)
  }
  const H0 = Math.min(46, bar.height - 10), room = Math.max(0, half * 2 - 8)
  let mode = null, H = H0
  for (const [m, parts] of [['title+sprigs', { sprigs: 1 }], ['title', {}]]) {
    const f = Math.min(1, room / widthAt(H0, parts))
    if (f >= .62) { mode = m; H = Math.floor(H0 * f); break }
  }
  const sprigH = Math.round(H * .78), fs2 = Math.round(H * .58)
  const showLine2 = mode === 'full' || mode === 'nosprigs', showSprigs = mode === 'full' || mode === 'title+sprigs'
  const line2Style = dark ? { color: '#FDBA74' } : { background: 'linear-gradient(180deg, #A3261A 0%, #7A1610 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
  return (
    <>
    {wide
      ? <div style={{ position: 'fixed', top: bar.top, height: bar.height, left: right.right + 12, width: 140, zIndex: 2360, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
          <FallToggle on={fall} onChange={setFall} />
        </div>
      : fallW > 0 && <div style={{ position: 'fixed', top: bar.top, height: bar.height, left: right.left - 16 - fallW, width: fallW, zIndex: 2360, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pointerEvents: 'none' }}>
          <FallToggle on={fall} onChange={setFall} compact={fallW < 100} />
        </div>}
    {mode && (
      <div aria-label="Happy Thanksgiving!" role="img" style={{ position: 'fixed', top: bar.top, height: bar.height, left: center - half, width: half * 2, zIndex: 2360, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none' }}>
        {showSprigs && (dark ? <Sprig w={sprigH * 2} flip /> : <ArtImg name="sprig_l" h={sprigH} />)}
        {dark
          ? <span className="tg-script" style={{ fontSize: Math.round(H * .66), color: '#FDBA74' }}>Happy Thanksgiving!</span>
          : <ArtImg name="title" h={H} />}
        {showLine2 && <span className="tg-script" style={{ fontSize: fs2, padding: '4px 4px 6px', marginLeft: 2, ...line2Style }}>{TG_LINE_2}</span>}
        {showSprigs && (dark ? <Sprig w={sprigH * 2} /> : <ArtImg name="sprig_r" h={sprigH} />)}
      </div>
    )}
    {/* very small screens (no room for the work-bar button): a little leaf button opens the tree */}
    {window.innerWidth < 760 && (
      <div style={{ position: 'fixed', top: bar.top, height: bar.height, left: left.right + 10, zIndex: 2360, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
        <button className="tg-btn" onClick={onOpen} title="Gratitude Tree" aria-label="Open the Gratitude Tree" style={{ padding: 0, width: 38, justifyContent: 'center' }}><ArtImg name="btn_leaf" h={22} /></button>
      </div>
    )}
    </>
  )
}
// The main Gratitude Tree button: "Share what you're thankful for on our Gratitude Tree!" with the
// live leaf count, centered under the header message (in the work bar, between Status and the
// shift/timer controls). Always shown (no dismiss). Shortens to "Gratitude Tree" when space is tight.
function TgAnnounce({ onOpen, count }) {
  const left = useAnchorRect('.workbar .wb-left', 800), right = useAnchorRect('.workbar .wb-right', 800), bar = useAnchorRect('.workbar', 800), top = useAnchorRect('.topbar', 800)
  if (!bar) return null
  const lo = (left ? left.right : bar.left) + 22, hi = (right ? right.left : bar.right) - 22
  const center = top ? top.left + top.width / 2 : bar.left + bar.width / 2
  const half = Math.min(center - lo, hi - center)
  const LONG = "Share what you're thankful for on our Gratitude Tree!"
  const extra = 24 + 20 + 30 + 3 * 10 + 26 + 24   // leaf + heart + count + gaps + padding/border + safety
  const longW = textWidth(LONG, "700 14px Montserrat") + extra, shortW = textWidth('Gratitude Tree', "700 14px Montserrat") + extra
  let mode = half * 2 >= longW ? 'long' : half * 2 >= shortW ? 'short' : null
  let boxLeft = center - half, boxW = half * 2
  if (!mode && hi - lo >= shortW) { mode = 'short'; boxLeft = lo; boxW = hi - lo }   // not centered, but still reachable
  if (!mode) return null
  return (
    <div style={{ position: 'fixed', top: bar.top, height: bar.height, left: boxLeft, width: boxW, zIndex: 2360, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <button className="tg-ann tg-ann-btn" onClick={onOpen} title="Open the Gratitude Tree">
        <ArtImg name="ann_leaf" h={24} />
        <span>{mode === 'long' ? LONG : 'Gratitude Tree'}</span>
        <svg width="20" height="18" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 20 C5 15 2 11.5 2 7.5 C2 4.4 4.4 2 7.3 2 C9.3 2 11 3.1 12 4.8 C13 3.1 14.7 2 16.7 2 C19.6 2 22 4.4 22 7.5 C22 11.5 19 15 12 20 Z" fill="none" stroke="#C2410C" strokeWidth="2" strokeLinejoin="round" /></svg>
        {count != null && <span className="tg-badge" aria-label={`${count} leaves`}>{count}</span>}
      </button>
    </div>
  )
}
// Fall frame around the content area (below the header): one clean orange line, a leaf cluster in the
// bottom-left corner and a pumpkin patch on the bottom edge. Purely visual, never takes clicks. (The frame_* art has its own painted line
// removed, so the only line is ours and the leaves sit on top of it.)
const FRAME_ART = { tl: [236, 68], tr: [236, 68], bl: [227, 148], br: [42, 206], side_r: [100, 140], pumpkins: [213, 94] }
function FrameImg({ name, w, style }) {
  const [nw, nh] = FRAME_ART[name]
  return <img src={ART + 'frame_' + name + '.png'} alt="" aria-hidden="true" draggable="false" width={Math.round(w)} height={Math.round(w * nh / nw)} style={{ position: 'absolute', display: 'block', userSelect: 'none', ...style }} />
}
function TgFrame() {
  const main = useAnchorRect('.main', 800), head = useAnchorRect('.header-wrap', 800)
  const [vh, setVh] = useState(() => window.innerHeight)
  useEffect(() => { const f = () => setVh(window.innerHeight); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  if (!main || !head) return null
  const top = head.top + head.height + 8, left = main.left + 8, right = main.right - 10, bottom = vh - 8
  const w = right - left, h = bottom - top
  if (w < 640 || h < 320) return null
  const k = Math.max(.7, Math.min(1.1, w / 1490))
  // place a piece so the point (cx, cy) in the art (where its corner of the line was painted) lands on (x, y) in the frame box
  const at = (name, cx, cy, x, y, kk = k, extra = {}) => {
    const [nw] = FRAME_ART[name]
    return <FrameImg key={name} name={name} w={nw * kk} style={{ left: x - cx * kk, top: y - cy * kk, ...extra }} />
  }
  const L = -1, R = w - 3, B = h - 3   // the 2px line's center, measured from inside the border
  return (
    <div aria-hidden="true" className="cc-desktop-only" style={{ position: 'fixed', top, left, width: w, height: h, zIndex: 2300, pointerEvents: 'none',
      border: '2px solid #F98524', borderRadius: 20, boxSizing: 'border-box' }}>
      {/* just two touches: the leaf cluster in the bottom-left corner and the pumpkin patch on the bottom edge */}
      {at('bl', 3, 146, L, B)}
      {at('pumpkins', 314, 92, R, B)}
    </div>
  )
}


// ---------- Fall Mode (optional, personal) ----------
// A temporary warm color layer. It only re-points the app's existing color variables (and the sidebar,
// which has its own colors) while <html> has the class "cc-fall". Removing the class restores the normal
// Opsis colors instantly. Nothing in index.css is changed. Each person's choice is saved in
// public.seasonal_prefs (key 'fall_mode-2026'), cached in localStorage so it applies without a flash.
const FALL_KEY = 'fall_mode-2026'
const FALL_CSS = `
html.cc-fall {
  --accent: #C2410C; --accent-bg: #FDDCC0; --accent-ink: #fff;
  --blue: #C2410C; --cyan: #F97316; --teal: #6B3418; --ink-soft: #6B3418; --ink: #2B1408;
  --cta: #E2622A; --cta-ink: #fff;
  --surface: #FFF8F0; --canvas: #FCEBDA; --bg-soft: #FFF3E6; --line: #F0D3B6; --line-soft: #F7E4D1;
  --needed: #9A3412; --needed-bg: #FDE4CC;
  --opsis-accent: #EA580C;
  --grad-accent: linear-gradient(180deg, #A93C12 0%, #7C2D12 100%);
  --composer-toolbar-bg: #FFF3E6;
}
/* sidebar: deep rust with cream text, orange pill for the current page (mockup) */
html.cc-fall .sidebar { background: linear-gradient(180deg, #8C3514 0%, #74290F 45%, #5E200B 100%) !important; border-right: 0; }
html.cc-fall .sidebar .nav-label, html.cc-fall .sidebar .nav-group-label { color: rgba(255,236,218,.62); }
html.cc-fall .sidebar .nav-item, html.cc-fall .sidebar .nav-subitem { color: #FFF1E4; }
html.cc-fall .sidebar .nav-subitem { color: rgba(255,241,228,.86); }
html.cc-fall .sidebar .nav-item .ic, html.cc-fall .sidebar .nav-item svg, html.cc-fall .sidebar .nav-caret { color: #FFE2C8; }
html.cc-fall .sidebar .nav-item:hover { background: rgba(255,214,180,.13); color: #fff; }
html.cc-fall .sidebar .nav-item.on { background: linear-gradient(180deg, #EC7436 0%, #D4561F 100%); color: #fff; box-shadow: 0 6px 14px -8px rgba(0,0,0,.45); }
html.cc-fall .sidebar .nav-item.on .ic, html.cc-fall .sidebar .nav-item.on svg { color: #fff; }
html.cc-fall .sidebar .user-chip { background: linear-gradient(180deg, #EC7436 0%, #D4561F 100%); border-color: rgba(255,214,180,.35); }
html.cc-fall .sidebar .user-name, html.cc-fall .sidebar .user-role { color: #fff; }
html.cc-fall .sidebar .user-av { background: #FFF3E6; color: #9A3412; box-shadow: 0 0 0 2px #FDBA74; }
html.cc-fall .sidebar .signout { color: rgba(255,241,228,.8); }
html.cc-fall .sidebar .signout:hover { color: #fff; }
html.cc-fall .hd-avatar { background: #9A3412; box-shadow: 0 0 0 2px #F97316; }
html.cc-fall .btn-primary { background: linear-gradient(180deg, #A93C12 0%, #7C2D12 100%); border-color: #7C2D12; color: #fff; box-shadow: 0 8px 22px -12px rgba(124,45,18,.8); }
html.cc-fall .topbar { background: linear-gradient(90deg, #FFF3E4 0%, #FFF8EF 50%, #FFF1E2 100%) !important; }
html.cc-fall .workbar { background: #FFF5EA; border-bottom-color: #F3D2AE; }
/* dark mode: deep browns */
:root.cc-fall[data-theme="dark"] { --ink: #F7E7D8; --canvas: #1A120C; --bg-soft: #20160F; --surface: #24180F; --line: #3B2A1E; --line-soft: #2C1F16; --ink-soft: #E7B48A; --teal: #E7B48A; --accent-bg: #4A2716; --composer-toolbar-bg: #24180F; }
:root.cc-fall[data-theme="dark"] .topbar, :root.cc-fall[data-theme="dark"] .workbar { background: #24180F !important; }
@media (prefers-color-scheme: dark) {
  :root.cc-fall:not([data-theme="light"]) { --ink: #F7E7D8; --canvas: #1A120C; --bg-soft: #20160F; --surface: #24180F; --line: #3B2A1E; --line-soft: #2C1F16; --ink-soft: #E7B48A; --teal: #E7B48A; --accent-bg: #4A2716; --composer-toolbar-bg: #24180F; }
  :root.cc-fall:not([data-theme="light"]) .topbar, :root.cc-fall:not([data-theme="light"]) .workbar { background: #24180F !important; }
}
/* room for the Fall Mode switch at the far right of the top bar (Thanksgiving only, wide screens) */
@media (min-width: 1000px) { body.cc-thanksgiving .topbar .tb-right { margin-right: 168px; } }
.tg-fall { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 4px 0 6px; border-radius: 999px; border: 0; background: transparent;
  color: #3B1A0A; font-family: inherit; font-size: 14px; font-weight: 700; white-space: nowrap; cursor: pointer; }
:root[data-theme="dark"] .tg-fall { color: #FDE7D2; }
.tg-fall:focus-visible { outline: 2px solid #F97316; outline-offset: 2px; }
.tg-switch { position: relative; width: 46px; height: 26px; border-radius: 999px; background: #D6D3D1; transition: background .2s; flex: none; box-shadow: inset 0 1px 2px rgba(0,0,0,.15); }
.tg-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .2s; }
.tg-fall[aria-checked="true"] .tg-switch { background: linear-gradient(180deg, #F57C35, #D4561F); }
.tg-fall[aria-checked="true"] .tg-switch::after { transform: translateX(20px); }
`
function FallToggle({ on, onChange, compact }) {
  return (
    <button type="button" role="switch" aria-checked={on ? 'true' : 'false'} className="tg-fall" onClick={() => onChange(!on)}
      title={on ? 'Fall Mode is on — only you see it' : 'Turn on Fall Mode (warm autumn colors, just for you)'}>
      <Leaf size={18} color="#EA580C" />{!compact && <span>Fall Mode</span>}<span className="tg-switch" />
    </button>
  )
}


// ============================================================
// CLUCK NORRIS 🦃 (Thanksgiving, 2026-11-18) — a little turkey who strolls along the top edge of the
// chat message box (only in the open space between "Post as @update" and "Schedule send", never over
// the text you type or any button). Typing → he stops, looks down at your words, then up at you.
// Stop typing → short pause, then he walks again. Send → happy gobble + feather shake.
// Purely visual (pointer-events: none). Reduced motion → he stands still and only changes pose.
// Finds the composer through the page itself, so Chat.jsx is untouched.
// ============================================================
const CLUCK_W = 54, CLUCK_H = 50
function CluckSvg({ pose, step }) {
  // pose: 'walk' | 'idle' | 'down' | 'up' | 'gobble'
  const head = pose === 'down' ? 'rotate(34deg)' : pose === 'up' ? 'rotate(-16deg)' : pose === 'gobble' ? 'rotate(-8deg)' : 'rotate(0deg)'
  const pupil = pose === 'down' ? [.9, 1.3] : pose === 'up' ? [-.5, -1.3] : [1, 0]
  const fan = pose === 'gobble' ? 'scale(1.12)' : 'scale(1)'
  const feathers = [[-150, '#B91C1C'], [-132, '#EA580C'], [-114, '#F59E0B'], [-96, '#C2410C'], [-78, '#EA580C'], [-60, '#D97706'], [-42, '#B91C1C'], [-24, '#F59E0B']]
  return (
    <svg width={CLUCK_W} height={CLUCK_H} viewBox="0 0 100 92" aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <radialGradient id="ckBody" cx="58%" cy="40%" r="70%"><stop offset="0%" stopColor="#B8672F" /><stop offset="70%" stopColor="#874019" /><stop offset="100%" stopColor="#5E2A0E" /></radialGradient>
        <radialGradient id="ckHead" cx="40%" cy="35%" r="70%"><stop offset="0%" stopColor="#E9B48A" /><stop offset="100%" stopColor="#C2814F" /></radialGradient>
        <linearGradient id="ckWing" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9A4E22" /><stop offset="100%" stopColor="#6B3112" /></linearGradient>
        {feathers.map(([, c], i) => (
          <linearGradient key={i} id={'ckF' + i} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#5E2A0E" /><stop offset="45%" stopColor={c} /><stop offset="86%" stopColor={SHADE(c, 35)} /><stop offset="100%" stopColor="#FFF1DC" />
          </linearGradient>
        ))}
      </defs>
      {/* tail fan */}
      <g style={{ transformOrigin: '36px 54px', transform: fan, transition: 'transform .2s' }} className={pose === 'gobble' ? 'ck-shake' : undefined}>
        {feathers.map(([a], i) => (
          <path key={i} d="M36 54 C30 41 30 21 36 9 C42 21 42 41 36 54 Z" fill={`url(#ckF${i})`} stroke="#5E2A0E" strokeOpacity=".25" strokeWidth=".8" transform={`rotate(${a + 90} 36 54)`} />
        ))}
      </g>
      {/* legs */}
      <g stroke="#E8892B" strokeWidth="3" strokeLinecap="round" fill="none">
        <g style={{ transformOrigin: '46px 70px', transform: `rotate(${step ? 16 : -10}deg)`, transition: 'transform .22s' }}><path d="M46 70 L46 84 M46 84 l-4 3 M46 84 l1 4 M46 84 l5 2" /></g>
        <g style={{ transformOrigin: '55px 70px', transform: `rotate(${step ? -10 : 16}deg)`, transition: 'transform .22s' }}><path d="M55 70 L55 84 M55 84 l-4 3 M55 84 l1 4 M55 84 l5 2" /></g>
      </g>
      {/* neck (behind the body so it grows out of the chest) */}
      <g style={{ transform: head, transformOrigin: '63px 50px', transformBox: 'view-box', transition: 'transform .35s cubic-bezier(.3,.7,.4,1)' }}>
        <path d="M60 56 Q65 42 70 33" stroke="#B9774A" strokeWidth="10" strokeLinecap="round" fill="none" />
      </g>
      {/* body */}
      <ellipse cx="50" cy="58" rx="22" ry="17" fill="url(#ckBody)" />
      <ellipse cx="62" cy="61" rx="8" ry="9" fill="#D49A66" opacity=".45" />
      <path d="M40 54 l3 3 3-3 M48 50 l3 3 3-3 M44 62 l3 3 3-3 M53 58 l3 3 3-3" stroke="#E2A877" strokeOpacity=".55" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* wing */}
      <path d="M33 55 Q46 43 61 52 Q59 61 51 66 Q41 68 35 62 Z" fill="url(#ckWing)" />
      <path d="M38 61 Q43 57 49 61 M42 56 Q48 52 54 56 M46 64 Q51 61 56 63" stroke="#C47A45" strokeOpacity=".7" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {/* neck + head */}
      <g style={{ transform: head, transformOrigin: '63px 50px', transformBox: 'view-box', transition: 'transform .35s cubic-bezier(.3,.7,.4,1)' }} className={pose === 'gobble' ? 'ck-gobble' : undefined}>
        <path d="M66 41 Q68 36 70 33" stroke="#B9774A" strokeWidth="10" strokeLinecap="round" fill="none" />
        <circle cx="72" cy="27" r="9" fill="url(#ckHead)" />
        <path d="M80 27 L88 29.5 L80 32 Z" fill="#F59E0B" stroke="#C2410C" strokeWidth=".8" strokeLinejoin="round" />
        <path d="M80 26 Q83 30 81 36 Q79 39 78 34 Q78 30 80 26 Z" fill="#DC2626" />
        <path d="M74 33 Q77 38 74 43 Q71 40 72 35 Z" fill="#DC2626" />
        <ellipse cx="68" cy="31" rx="2.6" ry="1.6" fill="#F9A8D4" opacity=".85" />
        <circle cx="74.5" cy="25" r="3" fill="#fff" />
        <circle cx={74.5 + pupil[0]} cy={25 + pupil[1]} r="1.8" fill="#2B1408" />
        <circle cx={75.2 + pupil[0]} cy={24.2 + pupil[1]} r=".6" fill="#fff" />
        <path d="M71 21.5 Q74 20 77 21.5" stroke="#5E2A0E" strokeWidth="1" fill="none" strokeLinecap="round" opacity={pose === 'up' || pose === 'down' ? 1 : 0} />
      </g>
    </svg>
  )
}
const CLUCK_CSS = `
@keyframes ckBob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
@keyframes ckShake { 0%, 100% { transform: scale(1.12) rotate(0) } 25% { transform: scale(1.14) rotate(-6deg) } 75% { transform: scale(1.14) rotate(6deg) } }
@keyframes ckGobble { 0%, 100% { transform: rotate(-8deg) } 30% { transform: rotate(6deg) translateY(1px) } 60% { transform: rotate(-12deg) } }
@keyframes ckPop { from { opacity: 0; transform: translate(-50%, 4px) scale(.8) } to { opacity: 1; transform: translate(-50%, 0) scale(1) } }
.ck-shake { animation: ckShake .32s ease-in-out 3; transform-box: view-box; }
.ck-gobble { animation: ckGobble .3s ease-in-out 3; transform-box: view-box; }
`
function findComposer() {
  const pane = document.querySelector('[data-cc-chatpane]')
  if (!pane) return null
  const wraps = [...pane.querySelectorAll('.re-wrap')].filter(w => w.offsetParent)
  if (!wraps.length) return null
  // the main composer is the bottom-most, widest editor in the chat pane
  const wrap = wraps.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]
  const r = wrap.getBoundingClientRect()
  if (r.width < 260) return null
  // the "Post as @update · Schedule send" row sits just above the editor; walk only in the gap between them
  let lo = r.left + 18, hi = r.right - 18
  let row = wrap.parentElement
  while (row && row.parentElement && !row.previousElementSibling) row = row.parentElement
  for (let el = row && row.parentElement ? row.parentElement.firstElementChild : null; el; el = el.nextElementSibling) {
    if (el.contains(wrap)) break
    const er = el.getBoundingClientRect()
    if (er.height < 4 || er.bottom < r.top - 60) continue
    const label = el.querySelector('label'), btns = [...el.querySelectorAll('button')]
    if (label) lo = Math.max(lo, label.getBoundingClientRect().right + 14)
    const sched = btns.find(b => /schedule|cancel/i.test(b.textContent || ''))
    if (sched) hi = Math.min(hi, sched.getBoundingClientRect().left - 14)
  }
  return { wrap, top: r.top, lo, hi, editable: wrap.querySelector('[contenteditable="true"]') }
}
function CluckNorris() {
  const still = reduceMotion()
  const [box, setBox] = useState(null)          // { top, lo, hi }
  const [x, setX] = useState(null)              // left position (px)
  const [face, setFace] = useState(1)           // 1 = facing right, -1 = left
  const [pose, setPose] = useState('idle')
  const [step, setStep] = useState(false)
  const [bubble, setBubble] = useState(false)
  const st = useRef({ target: null, typingUntil: 0, gobbleUntil: 0, pauseUntil: 0, lastSwap: 0, look: 0, x: null })
  // keep track of where the composer is (it moves when the window resizes or the editor grows)
  useEffect(() => {
    let alive = true
    const read = () => {
      const c = findComposer()
      if (!alive) return
      setBox(prev => {
        if (!c || c.hi - c.lo < CLUCK_W + 20) return null
        if (prev && Math.abs(prev.top - c.top) < 1 && Math.abs(prev.lo - c.lo) < 1 && Math.abs(prev.hi - c.hi) < 1) return prev
        return { top: c.top, lo: c.lo, hi: c.hi }
      })
    }
    read()
    const iv = setInterval(read, 600)
    window.addEventListener('resize', read)
    return () => { alive = false; clearInterval(iv); window.removeEventListener('resize', read) }
  }, [])
  // typing + sending
  useEffect(() => {
    const inComposer = (t) => { const c = findComposer(); return !!(c && t && c.wrap.contains(t)) }
    const onInput = (e) => { if (inComposer(e.target)) st.current.typingUntil = Date.now() + 1400 }
    const onKey = (e) => {
      if (!inComposer(e.target)) return
      if (e.key === 'Enter' && !e.shiftKey) gobble()
      else if (e.key.length === 1 || e.key === 'Backspace') st.current.typingUntil = Date.now() + 1400
    }
    const gobble = () => { st.current.gobbleUntil = Date.now() + 1100; st.current.typingUntil = 0; st.current.pauseUntil = Date.now() + 1700 }
    const onCelebrate = () => { if (findComposer()) gobble() }
    document.addEventListener('input', onInput, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('cc:celebrate', onCelebrate)
    return () => { document.removeEventListener('input', onInput, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('cc:celebrate', onCelebrate) }
  }, [])
  // the little brain: ~12 updates a second, very light
  useEffect(() => {
    if (!box) return
    const s = st.current
    if (s.x == null || s.x < box.lo || s.x > box.hi - CLUCK_W) { s.x = box.lo + Math.random() * Math.max(0, box.hi - box.lo - CLUCK_W); setX(s.x) }
    const iv = setInterval(() => {
      const now = Date.now()
      if (now < s.gobbleUntil) { setPose('gobble'); setBubble(true); return }
      setBubble(false)
      if (now < s.typingUntil) {
        // nosy: look down at the words, then up at you, back and forth
        if (!s.look || now - s.look > 1300) { s.look = now; setPose(p => (p === 'down' ? 'up' : 'down')) }
        s.pauseUntil = now + 900
        return
      }
      s.look = 0
      if (still) { setPose('idle'); return }
      if (now < s.pauseUntil) { setPose('idle'); return }
      if (s.target == null || Math.abs(s.target - s.x) < 2) {
        if (s.target != null) { s.target = null; s.pauseUntil = now + 900 + Math.random() * 2200; setPose('idle'); return }
        s.target = box.lo + Math.random() * Math.max(0, box.hi - box.lo - CLUCK_W)
      }
      const dir = Math.sign(s.target - s.x)
      s.x += dir * Math.min(2.6, Math.abs(s.target - s.x))
      setFace(dir >= 0 ? 1 : -1); setX(s.x); setPose('walk')
      if (now - s.lastSwap > 230) { s.lastSwap = now; setStep(v => !v) }
    }, 85)
    return () => clearInterval(iv)
  }, [box, still])
  if (!box || x == null) return null
  const walking = pose === 'walk'
  return (
    <>
      <style>{CLUCK_CSS}</style>
      <div aria-hidden="true" className="cc-desktop-only" style={{ position: 'fixed', left: x, top: box.top - CLUCK_H + 3, width: CLUCK_W, height: CLUCK_H, zIndex: 2340, pointerEvents: 'none' }}>
        {bubble && (
          <div style={{ position: 'absolute', left: '50%', bottom: CLUCK_H - 2, transform: 'translateX(-50%)', animation: 'ckPop .18s ease-out', background: '#fff', border: '1.5px solid #FDBA74', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 800, color: '#C2410C', whiteSpace: 'nowrap', boxShadow: '0 4px 10px -6px rgba(194,65,12,.6)' }}>Gobble! 🧡</div>
        )}
        <div style={{ transform: `scaleX(${face})`, transition: 'transform .18s' }}>
          <div style={{ animation: walking && !still ? 'ckBob .46s ease-in-out infinite' : 'none' }}>
            <CluckSvg pose={pose} step={walking && !still ? step : false} />
          </div>
        </div>
      </div>
    </>
  )
}

// ---------- Gratitude Tree popup ----------
// Branch curves (quadratic: start, control, end, width). Leaves land on slots along them, so the tree
// starts bare and fills in as people add leaves.
const TREE_BRANCHES = [
  [[260, 196], [206, 166], [150, 156], 12], [[262, 196], [318, 164], [374, 152], 12], [[260, 188], [255, 140], [262, 86], 11],
  [[204, 170], [182, 134], [160, 114], 7], [[170, 160], [132, 164], [104, 182], 6], [[322, 168], [344, 132], [366, 112], 7],
  [[356, 156], [394, 160], [418, 178], 6], [[258, 138], [230, 110], [210, 82], 6], [[261, 124], [292, 100], [308, 74], 6],
  [[150, 156], [128, 146], [116, 130], 3.5], [[374, 152], [398, 144], [408, 126], 3.5], [[262, 86], [252, 70], [246, 56], 3.5],
]
const qpt = ([a, b, c], t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]]
const TREE_SLOTS = (() => {
  const out = []
  TREE_BRANCHES.forEach((br, bi) => {
    ;[.42, .58, .74, .9, 1].forEach((t, k) => {
      const [x, y] = qpt(br, t), [x2, y2] = qpt(br, Math.min(1, t + .02))
      const dx = x2 - x, dy = y2 - y, len = Math.hypot(dx, dy) || 1, side = (k + bi) % 2 ? 1 : -1, off = br[3] > 8 ? 15 : 11
      out.push([x + (-dy / len) * off * side, y + (dx / len) * off * side])
    })
  })
  return out.map((p, i) => ({ p, k: (i * 37) % out.length })).sort((a, b) => a.k - b.k).map(x => x.p)
})()
function treeSpot(i) {
  if (i < TREE_SLOTS.length) return TREE_SLOTS[i]
  const j = i - TREE_SLOTS.length, a = j * 2.39996, r = Math.sqrt((j + .5) / 60)
  return [262 + Math.cos(a) * r * 170, 128 + Math.sin(a) * r * 70]
}
function GratitudeTree({ onClose, onChanged }) {
  const { isAdmin } = useAuth()
  const [leaves, setLeaves] = useState(null)
  const [text, setText] = useState('')
  const [anon, setAnon] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const [fresh, setFresh] = useState(null)
  const [tab, setTab] = useState('all')
  const load = () => supabase.rpc('gratitude_list', { p_season: GRAT_SEASON }).then(({ data, error }) => { if (error) setErr(error.message); setLeaves(data || []); return data || [] })
  useEffect(() => { load() }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  async function add(e) {
    e.preventDefault()
    const m = text.trim(); if (!m) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('gratitude_leaves').insert({ message: m, season: GRAT_SEASON, is_anonymous: anon })
    if (error) { setBusy(false); setErr(/row-level security/i.test(error.message) ? "You've added a lot of leaves today. Try again tomorrow!" : error.message); return }
    const data = await load(); setBusy(false)
    const mineNew = data.filter(l => l.mine).slice(-1)[0]
    setText(''); setAnon(false); if (mineNew) { setSel(mineNew.id); setFresh(mineNew.id) }
    onChanged && onChanged()
    const r = document.getElementById('tg-tree-svg')?.getBoundingClientRect()
    if (r) celebrate(r.left + r.width / 2, r.top + r.height * .4)
  }
  async function remove(l) {
    setLeaves(ls => ls.filter(x => x.id !== l.id)); if (sel === l.id) setSel(null)
    const { error } = await supabase.from('gratitude_leaves').delete().eq('id', l.id)
    if (error) { setErr(error.message); load() } else onChanged && onChanged()
  }
  const list = leaves || []
  const mine = list.filter(l => l.mine)
  const who = (l) => l.mine ? (l.is_anonymous ? 'You (anonymous)' : (l.author || 'You')) : (l.is_anonymous || !l.author ? 'Anonymous' : l.author)
  const selected = list.find(l => l.id === sel)
  const shown = (tab === 'mine' ? mine : list).slice().reverse()
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 2600, background: 'rgba(40,20,8,.45)', display: 'grid', placeItems: 'center', padding: 12 }}>
      <div role="dialog" aria-label="Our Gratitude Tree" style={{ width: 'min(640px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', background: '#FFF8EE', color: '#2B1A10', borderRadius: 24, border: '2px solid #EA580C', boxShadow: '0 34px 80px -24px rgba(0,0,0,.55)', overflow: 'hidden' }}>
        <div style={{ position: 'relative', flex: 'none', height: 78, background: 'linear-gradient(180deg, #A53D12 0%, #7C2D12 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '0 56px' }}>
          <ArtImg name="hdr_l" h={52} style={{ flex: 'none' }} />
          <ArtImg name="hdr_title" h={50} style={{ maxWidth: '58%', height: 'auto' }} />
          <ArtImg name="hdr_r" h={52} style={{ flex: 'none' }} />
          <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', right: 14, top: 18, width: 40, height: 40, borderRadius: '50%', border: 0, background: '#fff', color: '#1F2937', fontSize: 18, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,.25)' }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '14px 22px 18px' }}>
          <p style={{ margin: '0 0 4px', textAlign: 'center', fontSize: 14.5, fontWeight: 600, lineHeight: 1.45 }}>Add a leaf for something you're thankful for. Watch our tree fill with gratitude throughout the week!</p>
          <div id="tg-tree-svg" style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '4px auto 0', aspectRatio: `${ART_SIZE.tree[0]} / ${ART_SIZE.tree[1]}` }}>
            <ArtImg name="tree" style={{ width: '100%', height: '100%' }} />
            {list.map((l, i) => {
              const h = hashNum(l.id), name = LEAF_ART[h % LEAF_ART.length], [nw, nh] = ART_SIZE[name], on = sel === l.id
              const [px, py] = i < TREE_ART_SLOTS.length ? TREE_ART_SLOTS[i] : [22 + ((i * 37) % 56), 6 + ((i * 53) % 46)]
              return (
                <button key={l.id} type="button" onClick={() => setSel(l.id)} title={`${who(l)}: ${l.message}`} aria-label={`Leaf from ${who(l)}`}
                  style={{ position: 'absolute', left: `${px}%`, top: `${py}%`, width: `${nw / ART_SIZE.tree[0] * 100}%`, aspectRatio: `${nw} / ${nh}`, transform: `translate(-50%, -50%) rotate(${(h % 50) - 25}deg) scale(${on ? 1.35 : 1})`,
                    padding: 0, border: 0, background: 'transparent', cursor: 'pointer', transition: 'transform .15s', zIndex: on ? 2 : 1, filter: on ? 'drop-shadow(0 0 3px #7C2D12) drop-shadow(0 2px 4px rgba(0,0,0,.3))' : 'drop-shadow(0 1px 1px rgba(0,0,0,.15))' }}>
                  <span style={{ display: 'block', width: '100%', height: '100%', animation: fresh === l.id ? 'tgLeafIn .9s cubic-bezier(.3,.7,.4,1)' : undefined }}>
                    <img src={ART + name + '.png'} alt="" draggable="false" style={{ width: '100%', height: '100%', display: 'block' }} />
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ minHeight: 44, margin: '6px 0 10px', padding: '10px 14px', borderRadius: 14, background: selected ? '#FFF1E0' : 'transparent', border: selected ? '1.5px solid #FDBA74' : '1.5px dashed #F3D2AE', fontSize: 14 }}>
            {selected ? <span><b style={{ color: '#9A3412' }}>{who(selected)}</b> is thankful for: {selected.message}</span>
              : <span style={{ color: '#8A6A55' }}>{leaves === null ? 'Loading the tree…' : list.length ? 'Click a leaf on the tree to read it.' : 'The tree is bare. Be the first to add a leaf!'}</span>}
          </div>
          <form onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 14px', borderRadius: 999, background: '#fff', border: '1.5px solid #F3D2AE', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.04)' }}>
              <ArtImg name="ann_leaf" h={22} />
              <input value={text} onChange={e => setText(e.target.value)} maxLength={140} placeholder="I'm thankful for..." aria-label="I'm thankful for"
                style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 14.5, fontFamily: 'inherit', color: '#2B1A10' }} />
            </label>
            <button disabled={busy || !text.trim()} style={{ height: 46, padding: '0 20px', borderRadius: 999, border: 0, cursor: busy || !text.trim() ? 'default' : 'pointer', opacity: busy || !text.trim() ? .65 : 1,
              background: 'linear-gradient(180deg, #C2410C 0%, #9A3412 100%)', color: '#fff', fontWeight: 800, fontSize: 14.5, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', boxShadow: '0 8px 18px -10px rgba(154,52,18,.9)' }}>
              <ArtImg name="btn_leaf" h={20} />{busy ? 'Adding…' : 'Add My Leaf'}
            </button>
          </form>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 6px 0', fontSize: 13 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={anon} onChange={e => setAnon(e.target.checked)} /> Post anonymously</label>
            <span style={{ color: '#8A6A55' }}>{text.length}/140</span>
          </div>
          {err && <div className="login-err" style={{ marginTop: 8 }}>{err}</div>}
          <div style={{ marginTop: 14, borderBottom: '1px solid #F3D2AE' }}>
            <button className={'tg-tab' + (tab === 'all' ? ' on' : '')} onClick={() => setTab('all')}>All Leaves ({list.length})</button>
            <button className={'tg-tab' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>My Leaves ({mine.length})</button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {shown.length === 0 && <div style={{ fontSize: 13.5, color: '#8A6A55', padding: '6px 4px' }}>{tab === 'mine' ? "You haven't added a leaf yet." : 'No leaves yet.'}</div>}
            {shown.map(l => (
              <div key={l.id} onClick={() => setSel(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, cursor: 'pointer', background: sel === l.id ? '#FFF1E0' : '#fff', border: '1.5px solid ' + (sel === l.id ? '#FDBA74' : '#F6E3CC'), fontSize: 13.5 }}>
                <ArtImg name={LEAF_ART[hashNum(l.id) % LEAF_ART.length]} h={22} style={{ flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0 }}><b>{who(l)}</b> · {l.message}</span>
                {(l.mine || isAdmin) && <button onClick={(e) => { e.stopPropagation(); remove(l) }} title="Remove this leaf" aria-label="Remove this leaf"
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#2B1A10', fontSize: 15, padding: '0 4px' }}>✕</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// for the profile header corner
export function SeasonHeaderDecor() {
  if (!seasonalHat()) return null
  if (activeSeason()?.key === 'christmas') return (
    <div aria-hidden="true" style={{ position: 'absolute', right: 14, top: 6, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
      <Snowflake size={18} color="#38A3B0" /><XImg name="gift" h={30} /><Snowflake size={24} color="#1B8590" /><Snowflake size={14} color="#7CC8D2" />
    </div>
  )
  if (activeSeason()?.key === 'thanksgiving') return (
    <div aria-hidden="true" style={{ position: 'absolute', right: 14, top: 4, display: 'flex', alignItems: 'center', gap: 2, pointerEvents: 'none' }}>
      <Leaf size={22} color={CRAN} /><Turkey size={38} /><Pie size={30} /><Acorn size={22} /><Sparkle size={12} delay={.4} />
    </div>
  )
  return (
    <div aria-hidden="true" style={{ position: 'absolute', right: 14, top: 4, display: 'flex', alignItems: 'center', gap: 2, pointerEvents: 'none' }}>
      <Bat size={38} delay={.1} /><Ghost size={32} /><Pumpkin size={32} /><Sparkle size={12} delay={.4} />
    </div>
  )
}

// ============================================================
// CHRISTMAS (2026-11-18, Brittney's mockup) — icy blues + teal, painted pine garlands with warm
// lights, a snowman, a snowy forest behind the chat messages, gently falling snow, a centered
// "Merry Christmas!" header and the "25 Days of Christmas" button. Like Thanksgiving, everything
// here is a fixed, pointer-events:none layer (or a background color/image), so it never covers a
// click target and nothing in the app's own files changes. The art lives in public/seasonal/christmas/.
// The bottom-right corner is left empty on purpose so the phone button stays clear.
// ============================================================
const XART = '/seasonal/christmas/'
const XART_SIZE = { top_garland: [365, 133], corner_tl: [392, 275], corner_tr: [935, 365], snowman: [442, 340], drift_l: [90, 116], drift_m: [1650, 116], drift_r: [175, 116], scene: [1225, 924], gift: [64, 64] }
const XTEAL = '#13707A', XTEAL_D = '#0B555E'
const XMAS_KEY = 'christmas_mode-2026'
function XImg({ name, w, h, style, ...rest }) {
  const [nw, nh] = XART_SIZE[name]
  const width = w || (h ? h * nw / nh : nw / 2), height = h || width * nh / nw
  return <img src={XART + name + '.webp'} alt="" aria-hidden="true" draggable="false" width={Math.round(width)} height={Math.round(height)} style={{ display: 'block', userSelect: 'none', ...style }} {...rest} />
}
// a crisp six-armed snowflake (header, sidebar, falling snow, confetti)
function Snowflake({ size = 22, color = XTEAL, sw = 1.6, style }) {
  const arm = (
    <g>
      <line x1="12" y1="12" x2="12" y2="1.5" />
      <polyline points="9.4,3.6 12,6 14.6,3.6" fill="none" />
      <polyline points="9.9,7.2 12,9 14.1,7.2" fill="none" />
    </g>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <g stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        {[0, 60, 120, 180, 240, 300].map(r => <g key={r} transform={`rotate(${r} 12 12)`}>{arm}</g>)}
      </g>
      <circle cx="12" cy="12" r="1.5" fill={color} />
    </svg>
  )
}
function SantaHatSvg({ size }) {
  const w = Math.max(13, Math.round(size * 0.86))
  return (
    <svg aria-hidden="true" width={w} height={w} viewBox="0 0 40 40"
      style={{ position: 'absolute', left: -Math.round(size * 0.14), top: -Math.round(size * 0.5), transform: 'rotate(-14deg)', pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
      <path d="M8 31 Q11 14 22 8 Q31 4 35 13 Q31 11 28 15 Q30 22 31 31 Z" fill="#DC2626" />
      <path d="M22 8 Q29 6 33 11 Q29 10 27 13 Z" fill="#B91C1C" />
      <rect x="5" y="28" width="29" height="8" rx="4" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth=".8" />
      <circle cx="35" cy="14" r="4.2" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth=".8" />
    </svg>
  )
}
const XM_CSS = `
body.cc-christmas { --xm-a: 72%; --xm-b: 55%; --xm-shade: 0; }
:root[data-theme="dark"] body.cc-christmas { --xm-a: 12%; --xm-b: 7%; --xm-shade: .72; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) body.cc-christmas { --xm-a: 12%; --xm-b: 7%; --xm-shade: .72; } }
body.cc-christmas .topbar {
  background: linear-gradient(90deg, color-mix(in srgb, #E3EFF6 var(--xm-a), var(--surface)) 0%, color-mix(in srgb, #F3F8FB var(--xm-a), var(--surface)) 50%, color-mix(in srgb, #E5F0F7 var(--xm-a), var(--surface)) 100%) !important;
  border-bottom-color: color-mix(in srgb, #BCD8E6 50%, var(--line)) !important;
}
body.cc-christmas .workbar { background: color-mix(in srgb, #EDF5FA calc(var(--xm-a) * .9), var(--workbar-bg)); border-bottom-color: color-mix(in srgb, #BCD8E6 45%, var(--workbar-line)); }
body.cc-christmas .main { background: color-mix(in srgb, #C9DFEC var(--xm-b), var(--canvas)); }
body.cc-christmas [data-cc-chatpane] { background: linear-gradient(180deg, color-mix(in srgb, #F0F6FA var(--xm-a), var(--surface)) 0%, color-mix(in srgb, #E3EEF5 var(--xm-a), var(--surface)) 100%); }
/* the snowy forest sits behind the messages, anchored bottom-right (it never scrolls with them) */
body.cc-christmas [data-cc-chatpane] > div[style*="overflow-y: auto"] {
  background: linear-gradient(rgba(15,23,32,var(--xm-shade)), rgba(15,23,32,var(--xm-shade))), url(${'/seasonal/christmas/scene.webp'}) right bottom / contain no-repeat;
}
@media (min-width: 1000px) { body.cc-christmas .topbar .tb-right { margin-right: 196px; } }
.xm-script { font-family: 'Kaushan Script', 'Dancing Script', cursive; font-weight: 400; letter-spacing: .3px; line-height: 1.25; white-space: nowrap; }
.xm-toggle { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 4px 0 6px; border-radius: 999px; border: 0; background: transparent;
  font: inherit; font-size: 14px; font-weight: 700; color: #0F3D45; cursor: pointer; white-space: nowrap; }
:root[data-theme="dark"] .xm-toggle { color: #D7EEF3; }
.xm-toggle:focus-visible { outline: 2px solid #38A3B0; outline-offset: 2px; }
.xm-switch { position: relative; width: 46px; height: 26px; border-radius: 999px; background: #D5DEE3; transition: background .2s; flex: none; box-shadow: inset 0 1px 2px rgba(0,0,0,.15); }
.xm-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .2s; }
.xm-toggle[aria-checked="true"] .xm-switch { background: linear-gradient(180deg, #1F8C97, #0E6670); }
.xm-toggle[aria-checked="true"] .xm-switch::after { transform: translateX(20px); }
.xm-btn { pointer-events: auto; display: inline-flex; align-items: center; gap: 12px; height: 40px; padding: 0 12px 0 10px; border-radius: 999px; cursor: pointer; font-family: inherit;
  font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; border: 1px solid #0B5961; background: linear-gradient(180deg, #1A7F89 0%, #0F6670 55%, #0C5A63 100%);
  box-shadow: 0 8px 18px -10px rgba(8,70,78,.85), inset 0 1px 0 rgba(255,255,255,.22); transition: transform .15s, box-shadow .15s; }
.xm-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 24px -12px rgba(8,70,78,.9), inset 0 1px 0 rgba(255,255,255,.25); }
.xm-btn:focus-visible { outline: 2px solid #7DD3DC; outline-offset: 2px; }
.xm-day { background: #EAF6F8; color: #0C5A63; border-radius: 999px; padding: 3px 11px; font-size: 13.5px; font-weight: 800; box-shadow: inset 0 0 0 1px rgba(12,90,99,.15); }
.xm-door { position: relative; aspect-ratio: 1; border-radius: 14px; border: 1.5px solid #C7DFE8; background: linear-gradient(160deg, #FFFFFF 0%, #EAF4F9 100%); cursor: pointer;
  display: grid; place-items: center; font: inherit; font-size: 22px; font-weight: 800; color: #0F5B64; transition: transform .15s, box-shadow .15s; }
.xm-door:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 20px -12px rgba(12,90,99,.6); }
.xm-door.today { border-color: #13707A; box-shadow: 0 0 0 3px rgba(19,112,122,.18); }
.xm-door.on { background: linear-gradient(160deg, #1A7F89 0%, #0E6670 100%); color: #fff; border-color: #0E6670; }
.xm-door:disabled { cursor: default; color: #9DB5BE; background: #F3F7F9; }
:root[data-theme="dark"] .xm-door { background: #12262C; border-color: #24464F; color: #BFE6EC; }
:root[data-theme="dark"] .xm-door:disabled { background: #0E1D21; color: #47636B; }
@keyframes xmIn { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: none } }
`
// "Merry Christmas! Wishing you a season filled with joy!" with a snowflake on each side, centered in
// the top bar (shortens to "Merry Christmas!" and then hides when the page name or icons need the room).
// The Christmas Mode switch sits at the far right like Fall Mode did.
function XmHeader({ mode, setMode, garlandRight }) {
  const left = useAnchorRect('.topbar .crumb', 800), right = useAnchorRect('.topbar .tb-right', 800), bar = useAnchorRect('.topbar', 800)
  if (!left || !right || !bar) return null
  const wide = window.innerWidth >= 1000
  const freeAll = right.left - left.right - 32
  const togW = wide ? 0 : (freeAll >= 460 ? 176 : freeAll >= 120 ? 70 : 0)
  const lo = Math.max(left.right + 16, (garlandRight || 0) + 8), hi = right.left - 16 - (togW ? togW + 12 : 0)
  const center = bar.left + bar.width / 2
  const half = Math.min(center - lo, hi - center)
  const H0 = Math.min(50, bar.height - 8), room = Math.max(0, half * 2 - 8)
  const LINE = 'Merry Christmas! Wishing you a season filled with joy!', SHORT = 'Merry Christmas!'
  const widthAt = (H, text, flakes) => textWidth(text, `${Math.round(H * .66)}px 'Kaushan Script'`) + (flakes ? 2 * (H * .7 + 14) : 0)
  let text = null, flakes = false, H = H0, boxL = center - half, boxW = half * 2
  for (const [t, f] of [[LINE, true], [LINE, false], [SHORT, true], [SHORT, false]]) {
    const k = Math.min(1, room / widthAt(H0, t, f))
    if (k >= (t === LINE ? .6 : .7)) { text = t; flakes = f; H = Math.floor(H0 * k); break }
  }
  // not enough room to center it on the bar: center it in the open space instead (better than hiding)
  if (!text && hi - lo > 120) {
    const room2 = hi - lo - 8
    for (const [t, f] of [[LINE, true], [LINE, false], [SHORT, true], [SHORT, false]]) {
      const k = Math.min(1, room2 / widthAt(H0, t, f))
      if (k >= .7) { text = t; flakes = f; H = Math.floor(H0 * k); boxL = lo; boxW = hi - lo; break }
    }
  }
  const dark = isDarkTheme()
  const ink = dark ? { color: '#9EDCE4' } : { color: XTEAL }
  return (
    <>
      {wide
        ? <div style={{ position: 'fixed', top: bar.top, height: bar.height, left: right.right + 12, width: 186, zIndex: 2360, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
            <XmToggle on={mode} onChange={setMode} />
          </div>
        : togW > 0 && <div style={{ position: 'fixed', top: bar.top, height: bar.height, left: right.left - 16 - togW, width: togW, zIndex: 2360, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pointerEvents: 'none' }}>
            <XmToggle on={mode} onChange={setMode} compact={togW < 100} />
          </div>}
      {text && (
        <div aria-label={text} role="img" style={{ position: 'fixed', top: bar.top, height: bar.height, left: boxL, width: boxW, zIndex: 2360, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, pointerEvents: 'none' }}>
          {flakes && <Snowflake size={Math.round(H * .72)} color={dark ? '#7CCFD9' : '#1B8590'} sw={1.5} />}
          <span className="xm-script" style={{ fontSize: Math.round(H * .66), padding: '2px 4px 4px', textShadow: dark ? 'none' : '0 1px 0 rgba(255,255,255,.8), 0 2px 6px rgba(19,112,122,.18)', ...ink }}>{text}</span>
          {flakes && <Snowflake size={Math.round(H * .72)} color={dark ? '#7CCFD9' : '#1B8590'} sw={1.5} />}
        </div>
      )}
    </>
  )
}
function XmToggle({ on, onChange, compact }) {
  return (
    <button type="button" role="switch" aria-checked={on ? 'true' : 'false'} className="xm-toggle" onClick={() => onChange(!on)}
      title={on ? 'Christmas Mode is on — only you see it' : 'Christmas Mode (coming soon — only you will see it)'}>
      <Snowflake size={18} color="#1B8590" sw={2} />{!compact && <span>Christmas Mode</span>}<span className="xm-switch" />
    </button>
  )
}
// The pine branch hanging from the top bar, just to the right of the page name.
function XmTopGarland({ onRight }) {
  const crumb = useAnchorRect('.topbar .crumb', 800), bar = useAnchorRect('.topbar', 800)
  const right = crumb && bar ? crumb.right + 8 + (XART_SIZE.top_garland[0] / 2) * Math.min(1.15, Math.max(.8, bar.height / 64)) : null
  useEffect(() => { onRight?.(right) }, [right]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!crumb || !bar || window.innerWidth < 900) return null
  const k = Math.min(1.15, Math.max(.8, bar.height / 64))
  return <XImg name="top_garland" w={XART_SIZE.top_garland[0] / 2 * k} className="cc-desktop-only" style={{ position: 'fixed', left: crumb.right + 8, top: bar.top, zIndex: 2355, pointerEvents: 'none' }} />
}
// "25 Days of Christmas" — the main button, centered in the work bar under the header.
const xmDay = () => {
  const [mo, da] = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).split('/').map(Number)
  return mo === 12 ? Math.min(25, da) : 1   // before December this is a preview, so Day 1 is open
}
function XmButton({ onOpen }) {
  const left = useAnchorRect('.workbar .wb-left', 800), right = useAnchorRect('.workbar .wb-right', 800), bar = useAnchorRect('.workbar', 800), top = useAnchorRect('.topbar', 800)
  if (!bar) return null
  const lo = (left ? left.right : bar.left) + 22, hi = (right ? right.left : bar.right) - 22
  const center = top ? top.left + top.width / 2 : bar.left + bar.width / 2
  const half = Math.min(center - lo, hi - center)
  const day = xmDay()
  const longW = textWidth('25 Days of Christmas', '700 15px Montserrat') + 30 + 64 + 18 + 3 * 12 + 26
  const shortW = textWidth('25 Days', '700 15px Montserrat') + 30 + 64 + 18 + 3 * 12 + 26
  let mode = half * 2 >= longW ? 'long' : half * 2 >= shortW ? 'short' : null
  let boxLeft = center - half, boxW = half * 2
  if (!mode && hi - lo >= shortW) { mode = 'short'; boxLeft = lo; boxW = hi - lo }
  if (!mode) return null
  return (
    <div style={{ position: 'fixed', top: bar.top, height: bar.height, left: boxLeft, width: boxW, zIndex: 2360, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <button className="xm-btn" onClick={onOpen} title="Open the 25 Days of Christmas">
        <XImg name="gift" h={28} />
        <span>{mode === 'long' ? '25 Days of Christmas' : '25 Days'}</span>
        <span className="xm-day">Day {day}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  )
}
// One little thing a day, Dec 1–25 (placeholder ideas until Brittney sends the real list).
const XM_DAYS = [
  'Share your favorite holiday movie in chat 🎬', 'Tell us the best gift you ever got 🎁', 'Ugly sweater day! Post a pic if you have one 🧶',
  'What\'s your go-to holiday cookie? 🍪', 'Give a shout-out to a teammate who helped you this year 🙌', 'Favorite holiday song — go! 🎶',
  'Hot cocoa or eggnog? ☕', 'Share a holiday tradition from your family 🕯️', 'Snow day dream: where would you spend it? ❄️',
  'Post your desk or workspace decorations 🎄', 'What\'s on your wish list this year? 📝', 'Random act of kindness day 💙',
  'Best holiday memory from when you were a kid ⭐', 'Name your favorite reindeer 🦌', 'Real tree or fake tree? 🌲',
  'Share a win from this year you\'re proud of 🏆', 'Favorite holiday food at the big dinner 🍽️', 'Pajama day! 🛌',
  'Which holiday character are you? 🎅', 'Send a thank-you note to someone today ✉️', 'Gingerbread house: builder or eater? 🏠',
  'Your best gift-wrapping tip 🎀', 'What are you most looking forward to next year? ✨', 'Christmas Eve plans? 🌟', 'Merry Christmas, team! 🎄💙',
]
function XmAdvent({ onClose }) {
  const today = xmDay()
  const [pick, setPick] = useState(today)
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const preview = (() => { const mo = Number(new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric' })); return mo !== 12 })()
  return (
    <div role="dialog" aria-modal="true" aria-label="25 Days of Christmas" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2600, background: 'rgba(8,32,40,.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(540px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 20, background: 'var(--surface)', boxShadow: '0 30px 70px -20px rgba(8,40,48,.6)', animation: 'xmIn .25s ease' }}>
        <div style={{ position: 'relative', padding: '18px 22px 16px', borderRadius: '20px 20px 0 0', background: 'linear-gradient(180deg, #1A7F89 0%, #0E6670 100%)', color: '#fff', display: 'flex', alignItems: 'center', gap: 12 }}>
          <XImg name="gift" h={36} />
          <div style={{ flex: 1 }}>
            <div className="xm-script" style={{ fontSize: 28, lineHeight: 1.1 }}>25 Days of Christmas</div>
            <div style={{ fontSize: 13, opacity: .9, marginTop: 2 }}>{preview ? 'Preview — Day 1 is open so you can try it out' : `Day ${today} of 25 · a little something every day`}</div>
          </div>
          <Snowflake size={26} color="rgba(255,255,255,.85)" />
          <button onClick={onClose} aria-label="Close" style={{ border: 0, background: 'rgba(255,255,255,.15)', color: '#fff', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {Array.from({ length: 25 }, (_, i) => i + 1).map(d => (
              <button key={d} className={'xm-door' + (d === today ? ' today' : '') + (d === pick ? ' on' : '')} disabled={d > today} onClick={() => setPick(d)}
                title={d > today ? `Opens Dec ${d}` : `Day ${d}`} aria-label={d > today ? `Day ${d}, opens December ${d}` : `Open day ${d}`}>
                {d > today ? <span style={{ fontSize: 18 }}>{d}<span style={{ display: 'block', fontSize: 10, fontWeight: 700, marginTop: -2 }}>🔒</span></span> : d}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 16, borderRadius: 14, padding: '14px 16px', background: 'color-mix(in srgb, #E6F2F7 70%, var(--surface))', border: '1px solid color-mix(in srgb, #BCD8E6 60%, var(--line))', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="xm-script" style={{ fontSize: 26, color: XTEAL, minWidth: 64 }}>Day {pick}</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{XM_DAYS[pick - 1]}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
// Painted pieces around the page content: garlands on the top corners (with the hanging ornaments),
// the snowman bottom-left and the snow drift along the bottom. The bottom-right corner stays empty.
function XmFrame() {
  const main = useAnchorRect('.main', 800), head = useAnchorRect('.header-wrap', 800)
  const [vh, setVh] = useState(() => window.innerHeight)
  useEffect(() => { const f = () => setVh(window.innerHeight); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  if (!main || !head) return null
  const top = head.top + head.height + 10, left = main.left + 14, right = main.right - 14, bottom = vh
  const w = right - left
  if (w < 640 || bottom - top < 320) return null
  // scale against the mockup (its content area was ~1290px wide); art is stored at 2x
  const k = Math.max(.72, Math.min(1.25, w / 1290))
  const s = (name) => XART_SIZE[name][0] / 2 * k
  const ph = (name) => XART_SIZE[name][1] / 2 * k
  const pos = { position: 'fixed', pointerEvents: 'none' }
  // drift: left pine + stretchy snow + right pine, from the snowman to just short of the right edge
  const dl = s('drift_l'), dr = s('drift_r'), dh = ph('drift_m')
  const dStart = left + s('snowman') * .78, dEnd = right - 70 * k
  const dMid = Math.max(0, dEnd - dStart - dl - dr)
  return (
    <div aria-hidden="true" className="cc-desktop-only" style={{ position: 'fixed', inset: 0, zIndex: 2300, pointerEvents: 'none' }}>
      <XImg name="corner_tl" w={s('corner_tl') * .84} style={{ ...pos, left: left - 14 - 2 * k / 2, top: top - 8 - 22 * k / 2 }} />
      <XImg name="corner_tr" w={s('corner_tr') * .9} style={{ ...pos, left: right + 6 - 920 * .9 * k / 2, top: top - 10 - 22 * k / 2 }} />
      {dMid > 40 && <>
        <XImg name="drift_l" w={dl} h={dh} style={{ ...pos, left: dStart, top: bottom - dh }} />
        <XImg name="drift_m" w={dMid} h={dh} style={{ ...pos, left: dStart + dl, top: bottom - dh }} />
        <XImg name="drift_r" w={dr} h={dh} style={{ ...pos, left: dStart + dl + dMid, top: bottom - dh }} />
      </>}
      <XImg name="snowman" w={s('snowman')} style={{ ...pos, left: left - 2 * k / 2, top: bottom - ph('snowman') }} />
    </div>
  )
}
// a few white snowflakes sprinkled on the sidebar (like the mockup)
const XM_SIDE_FLAKES = [[86, 14, 14], [90, 23, 10], [80, 33, 16], [92, 42, 11], [84, 51, 15], [90, 61, 12], [82, 70, 17], [91, 79, 11], [86, 88, 15], [12, 95, 13], [62, 97, 10]]
function XmSidebarFlakes() {
  const sb = useAnchorRect('.sidebar', 900)
  if (!sb || sb.width < 120) return null
  return (
    <div aria-hidden="true" className="cc-desktop-only" style={{ position: 'fixed', left: sb.left, top: sb.top, width: sb.width, height: sb.height, zIndex: 2290, pointerEvents: 'none', overflow: 'hidden' }}>
      {XM_SIDE_FLAKES.map(([x, y, sz], i) => <Snowflake key={i} size={sz} color="rgba(255,255,255,.55)" sw={1.4} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: `rotate(${i * 17}deg)` }} />)}
    </div>
  )
}
// Gently falling snow over the whole app. One canvas, ~30fps, pauses when the tab is hidden.
// Reduced motion → no falling snow.
function XmSnow() {
  const ref = useRef(null)
  useEffect(() => {
    if (reduceMotion()) return
    const cv = ref.current; if (!cv) return
    const ctx = cv.getContext('2d')
    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, alive = true
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0) }
    resize()
    const count = () => Math.round(Math.min(90, Math.max(35, W * H / 26000)))
    const mk = (y) => { const big = Math.random() < .22; return { x: Math.random() * W, y: y ?? Math.random() * H, r: big ? 3 + Math.random() * 2.6 : 1.3 + Math.random() * 2, big,
      vy: .35 + Math.random() * .7, sway: Math.random() * Math.PI * 2, sw: .4 + Math.random() * .8, rot: Math.random() * 6, vr: (Math.random() - .5) * .02, a: .55 + Math.random() * .4 } }
    let flakes = Array.from({ length: count() }, () => mk())
    const drawFlake = (f) => {
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.globalAlpha = f.a
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, f.r * .22); ctx.lineCap = 'round'
      ctx.shadowColor = 'rgba(70,120,150,.45)'; ctx.shadowBlur = 3
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -f.r * 2)
        ctx.moveTo(-f.r * .5, -f.r * 1.15); ctx.lineTo(0, -f.r * 1.5); ctx.lineTo(f.r * .5, -f.r * 1.15); ctx.stroke()
      }
      ctx.restore()
    }
    const tick = (t) => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      if (t - last < 33) return
      const dt = Math.min(3, (t - last) / 16.7); last = t
      ctx.clearRect(0, 0, W, H)
      for (const f of flakes) {
        f.y += f.vy * dt; f.sway += .012 * dt; f.x += Math.sin(f.sway) * f.sw * .35 * dt; f.rot += f.vr * dt
        if (f.y > H + 12) Object.assign(f, mk(-12))
        if (f.x < -12) f.x = W + 10; else if (f.x > W + 12) f.x = -10
        if (f.big) drawFlake(f)
        else { ctx.globalAlpha = f.a; ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = 'rgba(70,120,150,.4)'; ctx.shadowBlur = 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill() }
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0
    }
    raf = requestAnimationFrame(tick)
    const onVis = () => { if (document.visibilityState === 'hidden') { cancelAnimationFrame(raf) } else { last = 0; raf = requestAnimationFrame(tick) } }
    const onResize = () => { resize(); const n = count(); if (flakes.length < n) flakes = flakes.concat(Array.from({ length: n - flakes.length }, () => mk())); else flakes.length = n }
    document.addEventListener('visibilitychange', onVis); window.addEventListener('resize', onResize)
    return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', onResize) }
  }, [])
  return <canvas ref={ref} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 2295, pointerEvents: 'none' }} />
}
const CONFETTI_XM = [
  () => <Snowflake size={18} color="#38A3B0" />, () => <Snowflake size={14} color="#7CC8D2" />, () => <Sparkle size={14} color={GOLD} />,
  () => <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><rect x="5" y="0" width="4" height="3" rx="1" fill="#C9A227" /><circle cx="7" cy="9.5" r="6" fill="#1F8C97" /><circle cx="5" cy="7.5" r="1.6" fill="#fff" opacity=".7" /></svg>,
  () => <Snowflake size={16} color="#1B8590" />, () => <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><rect x="5" y="0" width="4" height="3" rx="1" fill="#C9A227" /><circle cx="7" cy="9.5" r="6" fill="#DC2626" /><circle cx="5" cy="7.5" r="1.6" fill="#fff" opacity=".7" /></svg>,
]

// ---------- the layer ----------
const CONFETTI_TG = [
  () => <Leaf size={20} color={CRAN} />, () => <Leaf size={20} color={AMBER} />, () => <Leaf size={20} color={ORANGE_D} />,
  () => <Acorn size={16} face={false} />, () => <Sparkle size={14} color={GOLD} />, () => <Leaf size={18} color={GOLD} />,
]
const CONFETTI = [
  () => <Candy size={20} color="#F472B6" />, () => <Candy size={20} color="#A78BFA" />, () => <Candy size={20} color={ORANGE} />,
  () => <Sparkle size={14} />, () => <Sparkle size={12} color="#F9A8D4" />, () => <Pumpkin size={18} face={false} />,
]

export default function Seasonal() {
  const { user } = useAuth()
  const [on, setOn] = useState(null)
  const [floaters, setFloaters] = useState([])
  const [bursts, setBursts] = useState([])
  const [peek, setPeek] = useState(null)
  const [greet, setGreet] = useState(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const [gCount, setGCount] = useState(null)
  const fallCacheKey = user?.id ? `cc.${FALL_KEY}.${user.id}` : null
  const [fall, setFallState] = useState(false)
  const xmCacheKey = user?.id ? `cc.${XMAS_KEY}.${user.id}` : null
  const [xmMode, setXmModeState] = useState(false)
  const [adventOpen, setAdventOpen] = useState(false)
  const [garlandRight, setGarlandRight] = useState(null)
  const season = activeSeason()
  const idRef = useRef(0)
  const still = reduceMotion()

  useEffect(() => {
    if (!user?.id || !season) return
    let alive = true
    const read = () => supabase.from('profiles').select('seasonal_effects, full_name').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (!alive) return
      const enabled = data?.seasonal_effects !== false
      _off = !enabled; setOn(enabled)
      document.body.classList.toggle('cc-halloween', enabled && season.key === 'halloween')
      document.body.classList.toggle('cc-thanksgiving', enabled && season.key === 'thanksgiving')
      document.body.classList.toggle('cc-christmas', enabled && season.key === 'christmas')
      window.dispatchEvent(new Event('cc:seasonal-state'))
      if (enabled) {
        const key = `cc.season.greet.${season.key}.${new Date().toDateString()}`
        try { if (!localStorage.getItem(key)) setGreet({ text: season.greeting((data?.full_name || '').split(' ')[0]), key }) } catch { /* ignore */ }
      }
    })
    read()
    window.addEventListener('cc:seasonal-changed', read)
    return () => { alive = false; window.removeEventListener('cc:seasonal-changed', read); document.body.classList.remove('cc-halloween'); document.body.classList.remove('cc-thanksgiving'); document.body.classList.remove('cc-christmas') }
  }, [user?.id, season?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Intentional edge moments (no more floaters through the middle of the screen):
  //  • a little flock of bats flutters along just under the top bar (every ~45–80s)
  //  • a ghost pops up behind the pumpkin patch and waves (every ~1.5–2.5 min)
  // Thanksgiving: now and then a few leaves drift down (gentle, every ~50–80s).
  useEffect(() => {
    if (!on || !season || still || season.key !== 'thanksgiving') return
    let t1
    const flurry = () => {
      if (document.visibilityState === 'visible') {
        const id = ++idRef.current
        const leaves = Array.from({ length: 6 }, (_, i) => ({ i, left: `${12 + Math.random() * 78}vw`, c: LEAF_COLORS[i % LEAF_COLORS.length], size: 18 + Math.round(Math.random() * 10),
          drift: `${Math.round((Math.random() - .5) * 160)}px`, spin: `${Math.round(180 + Math.random() * 360) * (Math.random() < .5 ? -1 : 1)}deg`, dur: 10 + Math.random() * 5, delay: Math.random() * 4 }))
        setFloaters(f => [...f, { id, kind: 'leaves', leaves }])
        setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 20000)
      }
      t1 = setTimeout(flurry, 50000 + Math.random() * 30000)
    }
    t1 = setTimeout(flurry, 6000)
    return () => clearTimeout(t1)
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps
  // Fall Mode: read the cached choice right away, then the saved one; apply/remove the class on <html>.
  useEffect(() => {
    if (!on || season?.key !== 'thanksgiving' || !user?.id) return
    try { if (localStorage.getItem(fallCacheKey) === '1') setFallState(true) } catch { /* ignore */ }
    supabase.from('seasonal_prefs').select('enabled').eq('profile_id', user.id).eq('key', FALL_KEY).maybeSingle()
      .then(({ data }) => { if (data) { setFallState(!!data.enabled); try { localStorage.setItem(fallCacheKey, data.enabled ? '1' : '0') } catch { /* ignore */ } } })
  }, [on, season?.key, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const active = !!(on && season?.key === 'thanksgiving' && fall)
    document.documentElement.classList.toggle('cc-fall', active)
    return () => document.documentElement.classList.remove('cc-fall')
  }, [on, season?.key, fall])
  // Christmas Mode: saved per person like Fall Mode (the look itself comes with the next mockup).
  useEffect(() => {
    if (!on || season?.key !== 'christmas' || !user?.id) return
    try { if (localStorage.getItem(xmCacheKey) === '1') setXmModeState(true) } catch { /* ignore */ }
    supabase.from('seasonal_prefs').select('enabled').eq('profile_id', user.id).eq('key', XMAS_KEY).maybeSingle()
      .then(({ data }) => { if (data) { setXmModeState(!!data.enabled); try { localStorage.setItem(xmCacheKey, data.enabled ? '1' : '0') } catch { /* ignore */ } } })
    let link = document.getElementById('cc-xm-font')
    if (!link) { link = document.createElement('link'); link.id = 'cc-xm-font'; link.rel = 'stylesheet'; link.href = 'https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap'; document.head.appendChild(link) }
    return () => { document.getElementById('cc-xm-font')?.remove() }
  }, [on, season?.key, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const active = !!(on && season?.key === 'christmas' && xmMode)
    document.documentElement.classList.toggle('cc-xmas', active)
    return () => document.documentElement.classList.remove('cc-xmas')
  }, [on, season?.key, xmMode])
  // Gratitude Tree count (header badge) + the script font for the lettering, only while Thanksgiving is on.
  useEffect(() => {
    if (!on || season?.key !== 'thanksgiving') return
    const refresh = () => supabase.rpc('gratitude_count', { p_season: GRAT_SEASON }).then(({ data }) => { if (typeof data === 'number') setGCount(data) })
    refresh()
    const iv = setInterval(refresh, 60000)
    let link = document.getElementById('cc-tg-font')
    if (!link) { link = document.createElement('link'); link.id = 'cc-tg-font'; link.rel = 'stylesheet'; link.href = 'https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap'; document.head.appendChild(link) }
    window.addEventListener('cc:gratitude-changed', refresh)
    return () => { clearInterval(iv); window.removeEventListener('cc:gratitude-changed', refresh); document.getElementById('cc-tg-font')?.remove() }
  }, [on, season?.key])

  useEffect(() => {
    if (!on || !season || still || season.key !== 'halloween') return
    let t1, t2
    const bats = () => {
      if (document.visibilityState === 'visible') {
        const id = ++idRef.current
        setFloaters(f => [...f, { id, kind: 'bats', top: 66 + Math.round(Math.random() * 18), dur: 13 + Math.random() * 5 }])
      }
      t1 = setTimeout(bats, 45000 + Math.random() * 35000)
    }
    const rise = () => {
      if (document.visibilityState === 'visible') { const id = ++idRef.current; setFloaters(f => [...f, { id, kind: 'rise' }]); setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 5200) }
      t2 = setTimeout(rise, 90000 + Math.random() * 60000)
    }
    // floating ghosts drift across now and then (they were missed!)
    let t3
    const ghost = () => {
      if (document.visibilityState === 'visible') {
        const id = ++idRef.current
        setFloaters(f => [...f, { id, kind: 'ghost', top: `${18 + Math.random() * 55}vh`, dur: 17 + Math.random() * 7 }])
      }
      t3 = setTimeout(ghost, 30000 + Math.random() * 25000)
    }
    t1 = setTimeout(bats, 6000)
    t2 = setTimeout(rise, 35000)
    t3 = setTimeout(ghost, 12000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps

  // peek-a-boo ghost from the right edge every ~1.5–2.5 min
  useEffect(() => {
    if (!on || !season || still) return
    let t
    const go = () => {
      if (document.visibilityState === 'visible') { setPeek({ id: ++idRef.current, top: `${30 + Math.random() * 35}vh` }); setTimeout(() => setPeek(null), 4600) }
      t = setTimeout(go, 90000 + Math.random() * 60000)
    }
    t = setTimeout(go, 20000)
    return () => clearTimeout(t)
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps

  // confetti
  useEffect(() => {
    if (!on || !season) return
    const fire = (e) => {
      if (still) return
      const x = e?.detail?.x ?? window.innerWidth / 2, y = e?.detail?.y ?? window.innerHeight - 140
      const id = ++idRef.current
      const set = season.key === 'thanksgiving' ? CONFETTI_TG : season.key === 'christmas' ? CONFETTI_XM : CONFETTI
      const bits = Array.from({ length: 16 }, (_, i) => ({ k: i, C: set[i % set.length],
        dx: `${Math.round((Math.random() - .5) * 280)}px`, dy: `${Math.round(-70 - Math.random() * 190)}px`, rot: `${Math.round((Math.random() - .5) * 540)}deg`, d: 1 + Math.random() * .6 }))
      setBursts(b => [...b, { id, x, y, bits }])
      setTimeout(() => setBursts(b => b.filter(z => z.id !== id)), 1800)
    }
    window.addEventListener('cc:celebrate', fire)
    return () => window.removeEventListener('cc:celebrate', fire)
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!season || !on) return null
  const closeGreet = () => { try { localStorage.setItem(greet.key, '1') } catch { /* ignore */ } setGreet(null) }

  const setFall = (v) => {
    setFallState(v)
    try { localStorage.setItem(fallCacheKey, v ? '1' : '0') } catch { /* ignore */ }
    supabase.from('seasonal_prefs').upsert({ profile_id: user.id, key: FALL_KEY, enabled: v, updated_at: new Date().toISOString() }, { onConflict: 'profile_id,key' }).then(() => {})
  }
  const setXmMode = (v) => {
    setXmModeState(v)
    try { localStorage.setItem(xmCacheKey, v ? '1' : '0') } catch { /* ignore */ }
    supabase.from('seasonal_prefs').upsert({ profile_id: user.id, key: XMAS_KEY, enabled: v, updated_at: new Date().toISOString() }, { onConflict: 'profile_id,key' }).then(() => {})
  }
  if (season.key === 'christmas') return (
    <>
      <style>{CSS}</style>
      <style>{XM_CSS}</style>
      <XmSnow />
      <XmSidebarFlakes />
      <XmFrame />
      <XmTopGarland onRight={setGarlandRight} />
      <XmHeader mode={xmMode} setMode={setXmMode} garlandRight={garlandRight} />
      <XmButton onOpen={() => setAdventOpen(true)} />
      {adventOpen && <XmAdvent onClose={() => setAdventOpen(false)} />}
      <div className="cc-season-layer" aria-hidden="true">
        {bursts.map(b => (
          <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y }}>
            {b.bits.map(({ k, C, dx, dy, rot, d }) => (
              <span key={k} style={{ position: 'absolute', '--dx': dx, '--dy': dy, '--rot': rot, animation: `ccPop ${d}s ease-out forwards` }}><C /></span>
            ))}
          </div>
        ))}
      </div>
    </>
  )
  if (season.key === 'thanksgiving') return (
    <>
      <style>{CSS}</style>
      <style>{TG_COZY_CSS}</style>
      <style>{FALL_CSS}</style>
      <TgFrame />
      <TgHeader count={gCount} onOpen={() => setTreeOpen(true)} fall={fall} setFall={setFall} />
      <TgAnnounce onOpen={() => setTreeOpen(true)} count={gCount} />
      <CluckNorris />
      {treeOpen && <GratitudeTree onClose={() => setTreeOpen(false)} onChanged={() => window.dispatchEvent(new Event('cc:gratitude-changed'))} />}
      <div className="cc-season-layer" aria-hidden="true">
        {floaters.map(f => f.kind === 'leaves' ? (
          <React.Fragment key={f.id}>
            {f.leaves.map(l => (
              <div key={l.i} style={{ position: 'absolute', top: 0, left: l.left, '--drift': l.drift, '--spin': l.spin, animation: `ccFall ${l.dur}s linear ${l.delay}s both` }}>
                <div style={{ animation: `ccSway ${2.4 + l.i % 3 * .5}s ease-in-out infinite` }}><Leaf size={l.size} color={l.c} /></div>
              </div>
            ))}
          </React.Fragment>
        ) : null)}
        {peek && (
          <div key={peek.id} style={{ position: 'absolute', right: 0, top: peek.top, animation: 'ccPeek 4.5s ease-in-out forwards', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ background: '#fff', border: '1.5px solid #FED7AA', borderRadius: 14, padding: '5px 11px', fontWeight: 800, color: RUST, fontSize: 14, boxShadow: '0 6px 16px -8px rgba(194,65,12,.5)' }}>Gobble gobble! 🧡</div>
            <div style={{ marginRight: -14 }}><Turkey size={80} /></div>
          </div>
        )}
        {bursts.map(b => (
          <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y }}>
            {b.bits.map(({ k, C, dx, dy, rot, d }) => (
              <span key={k} style={{ position: 'absolute', '--dx': dx, '--dy': dy, '--rot': rot, animation: `ccPop ${d}s ease-out forwards` }}><C /></span>
            ))}
          </div>
        ))}
      </div>
    </>
  )

  return (
    <>
      <style>{CSS}</style>
      <CornerWeb />
      <TopDecor />
      <PumpkinPatch />
      <ChatGhost />
      <CandyBucket />
      <div className="cc-season-layer" aria-hidden="true">
        {floaters.map(f => f.kind === 'ghost' ? (
          <div key={f.id} style={{ position: 'absolute', top: f.top, left: 0, animation: `ccAcross ${f.dur}s linear forwards` }}
            onAnimationEnd={() => setFloaters(x => x.filter(y => y.id !== f.id))}>
            <div style={{ animation: 'ccBob 2.8s ease-in-out infinite' }}><Ghost size={66} /></div>
          </div>
        ) : f.kind === 'bats' ? (
          <div key={f.id} style={{ position: 'absolute', top: f.top, left: 0, animation: `ccFlyTop ${f.dur}s linear forwards` }}
            onAnimationEnd={() => setFloaters(x => x.filter(y => y.id !== f.id))}>
            <div style={{ position: 'relative', width: 150, height: 60, animation: 'ccBob 2.2s ease-in-out infinite' }}>
              <div style={{ position: 'absolute', left: 0, top: 18 }}><Bat size={48} /></div>
              <div style={{ position: 'absolute', left: 54, top: 0 }}><Bat size={38} delay={.12} /></div>
              <div style={{ position: 'absolute', left: 92, top: 24 }}><Bat size={32} delay={.24} /></div>
            </div>
          </div>
        ) : (
          <div key={f.id} style={{ position: 'fixed', right: 150, bottom: 30, overflow: 'hidden', width: 86, height: 84, zIndex: 2299 }}>
            <div style={{ animation: 'ccRise 5s ease-in-out forwards' }}><Ghost size={74} /></div>
          </div>
        ))}
        {peek && (
          <div key={peek.id} style={{ position: 'absolute', right: 0, top: peek.top, animation: 'ccPeek 4.5s ease-in-out forwards', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ background: '#fff', border: `1.5px solid ${LAV}`, borderRadius: 14, padding: '5px 11px', fontWeight: 800, color: PURPLE, fontSize: 14, boxShadow: '0 6px 16px -8px rgba(124,58,237,.5)' }}>Boo! 💜</div>
            <div style={{ marginRight: -16 }}><Ghost size={80} /></div>
          </div>
        )}
        {bursts.map(b => (
          <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y }}>
            {b.bits.map(({ k, C, dx, dy, rot, d }) => (
              <span key={k} style={{ position: 'absolute', '--dx': dx, '--dy': dy, '--rot': rot, animation: `ccPop ${d}s ease-out forwards` }}><C /></span>
            ))}
          </div>
        ))}
      </div>
      {greet && (
        <div role="status" style={{ position: 'fixed', top: 68, left: '50%', transform: 'translateX(-50%)', zIndex: 2500, animation: 'ccGreetIn .45s ease',
          background: 'linear-gradient(120deg, #FFF7ED 0%, #FDF4FF 55%, #F5F3FF 100%)', border: '1.5px solid #E9D5FF', borderRadius: 999, padding: '6px 10px 6px 8px',
          boxShadow: '0 14px 34px -14px rgba(124,58,237,.55)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, color: '#5B21B6' }}>
          <Ghost size={34} /><span>{greet.text}</span><Pumpkin size={26} />
          <button onClick={closeGreet} aria-label="Close" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: PURPLE, fontSize: 14, padding: '2px 6px', marginLeft: 2 }}>✕</button>
        </div>
      )}
    </>
  )
}

// A tiny cute witch hat (Chat avatars during Halloween week).
export function WitchHat({ size }) {
  if (seasonalHat() === 'pilgrim') return <PilgrimHatSvg size={size} />
  if (seasonalHat() === 'santa') return <SantaHatSvg size={size} />
  const w = Math.max(13, Math.round(size * 0.8))
  return (
    <svg aria-hidden="true" width={w} height={w} viewBox="0 0 40 40"
      style={{ position: 'absolute', left: -Math.round(size * 0.1), top: -Math.round(size * 0.5), transform: 'rotate(-14deg)', pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
      <ellipse cx="20" cy="33" rx="18" ry="4.6" fill="#6D28D9" />
      <path d="M11 32 Q14 18 19 10 Q22 5 29.5 3 Q25 9 26 15 Q27 23 29 32 Z" fill={PURPLE} />
      <path d="M11.4 28.8 Q20 31.4 28.7 28.8 L29 31.6 Q20 34 11.1 31.6 Z" fill={ORANGE} />
      <rect x="17.4" y="28.4" width="5.2" height="4.6" rx="1.2" fill="#FDE68A" stroke="#B45309" strokeWidth=".8" />
      <circle cx="29.5" cy="3.4" r="1.8" fill="#FDE047" />
      <path d="M33 9 l1 2 2 .4 -2 .8 -.6 2 -.8-2 -2-.6 2-.8z" fill="#FDE047" />
    </svg>
  )
}


// ============================================================
// SHY CHAT GHOST — peeks up from the top edge of the chat panel's header. When the mouse
// comes near, it ducks and hides; a few seconds after the mouse leaves, it peeks back.
// Drawn as a fixed layer lined up with the chat panel ([data-cc-chatpane]) so nothing in
// Chat can clip or cover it, and it never takes clicks (mousemove check only).
// ============================================================
function useAnchorRect(selector, every = 700) {
  const [rect, setRect] = useState(null)
  useEffect(() => {
    const read = () => {
      const el = document.querySelector(selector)
      const r = el && el.getBoundingClientRect()
      setRect(prev => {
        if (!r || r.width < 1) return prev ? null : prev
        if (prev && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.right - r.right) < 1) return prev
        return { top: r.top, left: r.left, right: r.right, width: r.width, height: r.height }
      })
    }
    read()
    const t = setInterval(read, every)
    window.addEventListener('resize', read)
    return () => { clearInterval(t); window.removeEventListener('resize', read) }
  }, [selector, every])
  return rect
}
function ChatGhost() { return <ChatPeeker kind="ghost" /> }
function ChatPeeker({ kind = 'ghost' }) {
  const pane = useAnchorRect('[data-cc-chatpane]')
  const boxRef = useRef(null)
  const [state, setState] = useState('hidden')
  const still = reduceMotion()
  const show = pane && pane.width >= 620
  useEffect(() => {
    if (!show) return
    let back, raf = 0, near = false
    const t0 = setTimeout(() => setState('peek'), 1500)
    if (still) return () => clearTimeout(t0)
    const onMove = (e) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = boxRef.current; if (!el) return
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
        const isNear = dx * dx + dy * dy < 130 * 130
        if (isNear && !near) { near = true; clearTimeout(back); setState('hidden') }
        else if (!isNear && near) { near = false; clearTimeout(back); back = setTimeout(() => setState('peek'), 2600 + Math.random() * 1800) }
      })
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    return () => { clearTimeout(t0); clearTimeout(back); cancelAnimationFrame(raf); document.removeEventListener('mousemove', onMove) }
  }, [show, still])
  if (!show) return null
  const left = pane.right - Math.min(pane.width * 0.38, 360) - 84
  return (
    <div ref={boxRef} aria-hidden="true" className="cc-desktop-only"
      style={{ position: 'fixed', top: pane.top, left, width: 84, height: 60, overflow: 'hidden', pointerEvents: 'none', zIndex: 2350 }}>
      <div style={{ position: 'absolute', left: 6, bottom: 0, transition: still ? 'none' : 'transform .45s cubic-bezier(.34,1.56,.64,1)',
        transform: state === 'peek' ? 'translateY(20px)' : 'translateY(78px)' }}>
        {kind === 'turkey' ? <div style={{ marginLeft: -2, marginTop: -6 }}><Turkey size={74} /></div> : <>
        <Ghost size={68} wave={false} />
        <svg width="72" height="12" viewBox="0 0 72 12" style={{ position: 'absolute', left: -2, top: 30 }}>
          <ellipse cx="11" cy="6" rx="6.5" ry="5" fill="#fff" stroke="#E9D5FF" strokeWidth="1.4" />
          <ellipse cx="61" cy="6" rx="6.5" ry="5" fill="#fff" stroke="#E9D5FF" strokeWidth="1.4" />
        </svg></>}
      </div>
    </div>
  )
}

// ============================================================
// CANDY BUCKET — a cute pumpkin pail next to the page title in the top bar. Click it and
// candy tumbles out, then hops back in. Only the bucket itself is clickable.
// ============================================================
const BUCKET_CANDY = [['#F472B6'], ['#A78BFA'], [ORANGE], ['#34D399'], ['#F472B6'], ['#FDE047'], ['#A78BFA'], [ORANGE]]
function CandyBucket() {
  const crumb = useAnchorRect('.topbar .crumb', 900)
  const [spill, setSpill] = useState(null)
  const [wobble, setWobble] = useState(0)
  const still = reduceMotion()
  if (!crumb) return null
  const x = crumb.right + 12, y = crumb.top + crumb.height / 2 - 20
  function tip() {
    setWobble(w => w + 1)
    if (still || spill) return
    const id = Date.now()
    setSpill({ id, bits: BUCKET_CANDY.map(([c], i) => ({ c, i,
      dx: `${Math.round(-70 + i * 22 + (Math.random() - .5) * 14)}px`, dy: `${Math.round(70 + Math.random() * 60)}px`,
      rot: `${Math.round((Math.random() - .5) * 360)}deg`, delay: i * 0.04 })) })
    setTimeout(() => setSpill(null), 2600)
  }
  return (
    <>
      <style>{SPILL_CSS}</style>
      <style>{`
        @keyframes ccSpillUnused { 0% { transform: translate(0,0) rotate(0) scale(.6); opacity: 0 }
          8% { opacity: 1; transform: translate(calc(var(--dx) * .3), -18px) rotate(calc(var(--rot) * .3)) scale(.9) }
          38% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1) }
          44% { transform: translate(var(--dx), calc(var(--dy) - 10px)) rotate(var(--rot)) scale(1) }
          50%, 66% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1) }
          82% { transform: translate(calc(var(--dx) * .4), -26px) rotate(0) scale(.9); opacity: 1 }
          100% { transform: translate(0, 6px) rotate(0) scale(.5); opacity: 0 } }
        @keyframes ccWobble { 0%, 100% { transform: rotate(0) } 25% { transform: rotate(-14deg) } 60% { transform: rotate(9deg) } }
        .cc-bucket:hover { transform: translateY(-2px) scale(1.06); }
        .cc-bucket:focus-visible { outline: 2px solid #A78BFA; outline-offset: 3px; border-radius: 10px; }
      `}</style>
      <button className="cc-bucket" onClick={tip} title="Trick or treat! 🍬" aria-label="Trick or treat — candy bucket"
        style={{ position: 'fixed', left: x, top: y, zIndex: 2360, width: 40, height: 40, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', transition: 'transform .15s' }}>
        <span key={wobble} style={{ display: 'block', transformOrigin: '50% 90%', animation: wobble ? 'ccWobble .5s ease' : 'none' }}>
          <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true" style={{ overflow: 'visible' }}>
            <path d="M8 16 Q24 -6 40 16" stroke="#6D28D9" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <g transform="translate(15 9) rotate(-18)"><Candy size={14} color="#F472B6" /></g>
            <g transform="translate(25 8) rotate(16)"><Candy size={13} color="#A78BFA" /></g>
            <circle cx="22" cy="13" r="3.6" fill="#34D399" /><path d="M22 13 L19 4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
            <ellipse cx="24" cy="31" rx="18" ry="14.5" fill={ORANGE_D} />
            <ellipse cx="24" cy="31" rx="12" ry="14.5" fill={ORANGE} />
            <ellipse cx="24" cy="17.5" rx="14.5" ry="3.8" fill="#C2410C" />
            <ellipse cx="18.5" cy="29" rx="2.3" ry="2.9" fill={INK} /><ellipse cx="29.5" cy="29" rx="2.3" ry="2.9" fill={INK} />
            <circle cx="19.2" cy="28" r=".8" fill="#fff" /><circle cx="30.2" cy="28" r=".8" fill="#fff" />
            <ellipse cx="14.5" cy="34" rx="2.8" ry="1.7" fill="#FDA4AF" /><ellipse cx="33.5" cy="34" rx="2.8" ry="1.7" fill="#FDA4AF" />
            <path d="M21 34 Q24 37 27 34" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {spill && (
        <div aria-hidden="true" style={{ position: 'fixed', left: x + 14, top: y + 10, zIndex: 2359, pointerEvents: 'none' }}>
          {spill.bits.map(b => (
            <span key={b.i} style={{ position: 'absolute', '--dx': b.dx, '--dy': b.dy, '--rot': b.rot, animation: `ccSpill 2.4s cubic-bezier(.3,.7,.4,1) ${b.delay}s both` }}>
              {b.i % 4 === 3 ? <Sparkle size={14} color={b.c} /> : <Candy size={24} color={b.c} />}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

const SPILL_CSS = `
@keyframes ccSpill { 0% { transform: translate(0,0) rotate(0) scale(.6); opacity: 0 }
  8% { opacity: 1; transform: translate(calc(var(--dx) * .3), -18px) rotate(calc(var(--rot) * .3)) scale(.9) }
  38% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1) }
  44% { transform: translate(var(--dx), calc(var(--dy) - 10px)) rotate(var(--rot)) scale(1) }
  50%, 66% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1) }
  82% { transform: translate(calc(var(--dx) * .4), -26px) rotate(0) scale(.9); opacity: 1 }
  100% { transform: translate(0, 6px) rotate(0) scale(.5); opacity: 0 } }
@keyframes ccWobble { 0%, 100% { transform: rotate(0) } 25% { transform: rotate(-14deg) } 60% { transform: rotate(9deg) } }
.cc-bucket:hover { transform: translateY(-2px) scale(1.06); }
.cc-bucket:focus-visible { outline: 2px solid #FB923C; outline-offset: 3px; border-radius: 10px; }
`
