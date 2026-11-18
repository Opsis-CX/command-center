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
// Add a holiday = add an entry to SEASONS (month/day, inclusive).
// ============================================================

export const SEASONS = [
  { key: 'halloween', from: [10, 27], to: [10, 31],
    greeting: (first) => `Happy Halloween week${first ? `, ${first}` : ''}!`,
    hat: 'witch' },
  { key: 'thanksgiving', from: [11, 18], to: [11, 29],
    greeting: (first) => `Happy Thanksgiving${first ? `, ${first}` : ''}! We're thankful for you 🧡`,
    hat: 'pilgrim' },
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
export function Leaf({ size = 26, color = ORANGE_D }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 42" aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d="M20 3 L23.5 11 L30.5 8 L28.5 16 L37 17 L31 23 L34 28 L24.5 26 L22 33 L20 36 L18 33 L15.5 26 L6 28 L9 23 L3 17 L11.5 16 L9.5 8 L16.5 11 Z"
        fill={color} stroke={color} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M20 13 L20 41 M20 22 L27 17 M20 22 L13 17 M20 28 L26 25 M20 28 L14 25" stroke="rgba(255,255,255,.45)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  )
}
function Acorn({ size = 30, face = true }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d="M20 10 Q21 4 25 2" stroke={BARK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="28" rx="13" ry="15" fill={AMBER} />
      <path d="M5 19 Q20 6 35 19 Q35 23 20 23 Q5 23 5 19 Z" fill={BARK} />
      <path d="M9 16 L14 21 M15 12.5 L20 21 M21 11.5 L25 21 M27 13 L30 20" stroke="#92400E" strokeWidth="1.2" strokeLinecap="round" />
      {face && <>
        <g className="cc-blink"><ellipse cx="15.5" cy="29" rx="2" ry="2.5" fill={INK} /><ellipse cx="24.5" cy="29" rx="2" ry="2.5" fill={INK} /></g>
        <ellipse cx="12" cy="33" rx="2.2" ry="1.4" fill={BLUSH} /><ellipse cx="28" cy="33" rx="2.2" ry="1.4" fill={BLUSH} />
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
      <path d="M31 6 l1 2 2 .4 -2 .8 -.6 2 -.8-2 -2-.6 2-.8z" fill={GOLD} />
    </svg>
  )
}
const LEAF_COLORS = [ORANGE_D, CRAN, AMBER, GOLD, RUST, '#B45309']

// A little autumn branch in the top-right corner with a swinging acorn.
function CornerBranch() {
  const still = reduceMotion()
  return (
    <div aria-hidden="true" style={{ position: 'fixed', top: 0, right: 0, width: 150, height: 130, pointerEvents: 'none', zIndex: 2300 }}>
      <svg width="150" height="60" viewBox="0 0 150 60" style={{ position: 'absolute', top: 0, right: 0, overflow: 'visible' }}>
        <path d="M150 6 Q110 10 82 22 Q60 31 34 30" stroke={BARK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M104 14 Q100 30 92 38 M70 26 Q66 38 58 44" stroke={BARK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </svg>
      {[[112, -4, 28, CRAN, -20], [86, 8, 26, AMBER, 25], [52, 16, 24, ORANGE_D, -35], [128, 18, 22, GOLD, 40], [92, 30, 20, RUST, 10], [40, 30, 22, CRAN, -10]].map(([x, y, sz, c, r], i) => (
        <div key={i} style={{ position: 'absolute', left: x, top: y, transform: `rotate(${r}deg)`, transformOrigin: 'center top', animation: still ? 'none' : `ccHang ${3 + i * .35}s ease-in-out ${i * .3}s infinite` }}><Leaf size={sz} color={c} /></div>
      ))}
      <div style={{ position: 'absolute', left: 64, top: 28, transformOrigin: 'top center', animation: still ? 'none' : 'ccSwing 3.6s ease-in-out infinite' }}>
        <div style={{ width: 1, height: 34, background: '#D6B38A', margin: '0 auto' }} />
        <div style={{ marginTop: -3 }}><Acorn size={28} /></div>
      </div>
    </div>
  )
}
// Leaves and acorns hanging under the top bar, with a few twinkles.
function TopLeaves() {
  const still = reduceMotion()
  const hang = (left, len, node, delay) => (
    <div key={left} style={{ position: 'fixed', top: 60, left, transformOrigin: 'top center', animation: still ? 'none' : `ccHang ${3.4 + delay}s ease-in-out ${delay}s infinite`, pointerEvents: 'none', zIndex: 2300 }}>
      <div style={{ width: 1, height: len, background: '#D6B38A', margin: '0 auto' }} />
      <div style={{ marginTop: -2 }}>{node}</div>
    </div>
  )
  return (
    <div aria-hidden="true" className="cc-desktop-only">
      {hang('34%', 12, <Leaf size={24} color={CRAN} />, 0)}{hang('47%', 22, <Acorn size={22} />, .5)}{hang('61%', 10, <Leaf size={22} color={AMBER} />, .9)}{hang('76%', 18, <Leaf size={24} color={ORANGE_D} />, 1.3)}
      {[['40%', 68, GOLD, 0], ['54%', 72, '#FDBA74', .6], ['69%', 66, GOLD, 1.1], ['85%', 70, '#FCA5A5', 1.6]].map(([left, top, c, d]) => (
        <div key={left} style={{ position: 'fixed', left, top, pointerEvents: 'none', zIndex: 2300 }}><Sparkle size={11} color={c} delay={d} /></div>
      ))}
    </div>
  )
}
// Harvest corner, bottom right: pumpkins, a turkey and a pie.
function HarvestPatch() {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', right: 92, bottom: -4, zIndex: 2300, pointerEvents: 'none', display: 'flex', alignItems: 'flex-end', opacity: .97 }}>
      <div style={{ marginRight: -14, transform: 'rotate(-6deg)' }}><Pumpkin size={54} /></div>
      <div style={{ zIndex: 1 }}><Turkey size={78} /></div>
      <div style={{ marginLeft: -12, marginBottom: 2 }}><Pie size={42} /></div>
      <div style={{ position: 'absolute', left: -14, bottom: 2, transform: 'rotate(-30deg)' }}><Leaf size={20} color={CRAN} /></div>
      <div style={{ position: 'absolute', right: -10, bottom: 0, transform: 'rotate(24deg)' }}><Leaf size={18} color={GOLD} /></div>
      <div style={{ position: 'absolute', left: 44, top: -10 }}><Sparkle size={13} delay={.2} /></div>
    </div>
  )
}
// Harvest basket by the page title. Click it and goodies tumble out, then hop back in.
const BASKET_BITS = [['leaf', CRAN], ['acorn'], ['leaf', AMBER], ['pie'], ['leaf', ORANGE_D], ['spark', GOLD], ['acorn'], ['leaf', RUST]]
function HarvestBasket() {
  const crumb = useAnchorRect('.topbar .crumb', 900)
  const [spill, setSpill] = useState(null)
  const [wobble, setWobble] = useState(0)
  const still = reduceMotion()
  if (!crumb) return null
  const x = crumb.right + 12, y = crumb.top + crumb.height / 2 - 20
  function tip() {
    setWobble(w => w + 1)
    if (still || spill) return
    setSpill({ id: Date.now(), bits: BASKET_BITS.map(([k, c], i) => ({ k, c, i,
      dx: `${Math.round(-70 + i * 22 + (Math.random() - .5) * 14)}px`, dy: `${Math.round(70 + Math.random() * 60)}px`,
      rot: `${Math.round((Math.random() - .5) * 360)}deg`, delay: i * 0.04 })) })
    setTimeout(() => setSpill(null), 2600)
  }
  return (
    <>
      <style>{SPILL_CSS}</style>
      <button className="cc-bucket" onClick={tip} title="Happy Thanksgiving! 🦃" aria-label="Happy Thanksgiving — harvest basket"
        style={{ position: 'fixed', left: x, top: y, zIndex: 2360, width: 42, height: 40, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', transition: 'transform .15s' }}>
        <span key={wobble} style={{ display: 'block', transformOrigin: '50% 90%', animation: wobble ? 'ccWobble .5s ease' : 'none' }}>
          <svg width="42" height="40" viewBox="0 0 50 48" aria-hidden="true" style={{ overflow: 'visible' }}>
            <path d="M9 22 Q25 0 41 22" stroke="#92400E" strokeWidth="3" fill="none" strokeLinecap="round" />
            <circle cx="18" cy="19" r="6" fill={CRAN} /><path d="M18 13 Q19 10 21 9" stroke={BARK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
            <ellipse cx="31" cy="16" rx="4.2" ry="8" fill={GOLD} transform="rotate(20 31 16)" /><path d="M27 22 Q24 13 29 8 M34 23 Q38 15 33 9" stroke="#65A30D" strokeWidth="2" fill="none" strokeLinecap="round" />
            <g transform="translate(36 13) rotate(30) scale(.42)"><Leaf size={26} color={ORANGE_D} /></g>
            <path d="M6 22 L44 22 L40 43 Q25 47 10 43 Z" fill="#B45309" />
            <path d="M7.5 28 L42.5 28 M8.6 34 L41.4 34 M9.6 40 L40.4 40" stroke="#92400E" strokeWidth="1.4" />
            <path d="M14 22 L15 44 M21 22 L21.5 45 M29 22 L28.5 45 M36 22 L35 44" stroke="#D97706" strokeWidth="1.2" opacity=".7" />
            <ellipse cx="25" cy="22" rx="19.5" ry="3.2" fill="#D97706" />
          </svg>
        </span>
      </button>
      {spill && (
        <div aria-hidden="true" style={{ position: 'fixed', left: x + 14, top: y + 10, zIndex: 2359, pointerEvents: 'none' }}>
          {spill.bits.map(b => (
            <span key={b.i} style={{ position: 'absolute', '--dx': b.dx, '--dy': b.dy, '--rot': b.rot, animation: `ccSpill 2.4s cubic-bezier(.3,.7,.4,1) ${b.delay}s both` }}>
              {b.k === 'leaf' ? <Leaf size={22} color={b.c} /> : b.k === 'acorn' ? <Acorn size={20} face={false} /> : b.k === 'pie' ? <Pie size={26} /> : <Sparkle size={14} color={b.c} />}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

// ---------- Thanksgiving: cozy colors, countdown, gratitude tree ----------
// Warm tint on the top bar and page background (gentler in dark mode).
const TG_COZY_CSS = `
body.cc-thanksgiving { --tg-a: 60%; --tg-b: 10%; }
:root[data-theme="dark"] body.cc-thanksgiving { --tg-a: 16%; --tg-b: 5%; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) body.cc-thanksgiving { --tg-a: 16%; --tg-b: 5%; } }
body.cc-thanksgiving .topbar {
  background: linear-gradient(90deg, color-mix(in srgb, #FFEDD5 var(--tg-a), var(--surface)) 0%, color-mix(in srgb, #FEF3C7 var(--tg-a), var(--surface)) 55%, color-mix(in srgb, #FFE4E6 var(--tg-a), var(--surface)) 100%) !important;
  border-bottom-color: color-mix(in srgb, #FDBA74 50%, var(--line)) !important;
}
body.cc-thanksgiving .main { background: color-mix(in srgb, #FED7AA var(--tg-b), var(--canvas)); }
.tg-pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 999px; font-size: 12.5px; font-weight: 700; white-space: nowrap;
  background: color-mix(in srgb, #FFF7ED 85%, var(--surface)); color: #9A3412; border: 1px solid #FDBA74; box-shadow: 0 4px 12px -8px rgba(194,65,12,.6); }
button.tg-pill { cursor: pointer; font-family: inherit; transition: transform .15s, box-shadow .15s; }
button.tg-pill:hover { transform: translateY(-1px); box-shadow: 0 8px 18px -10px rgba(194,65,12,.7); }
.tg-tree-leaf { cursor: pointer; transition: transform .15s; transform-box: fill-box; transform-origin: center; }
.tg-tree-leaf:hover, .tg-tree-leaf.on { transform: scale(1.35); }
@keyframes tgLeafIn { from { opacity: 0; transform: translateY(-40px) rotate(-90deg) scale(.4) } to { opacity: 1; transform: none } }
@media (max-width: 900px) { .tg-count-pill { display: none !important; } }
`
const TG_DAY = [11, 26]
function etMonthDay() {
  const [mo, da] = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).split('/').map(Number)
  return [mo, da]
}
function countdownText() {
  const [mo, da] = etMonthDay()
  if (mo !== 11) return null
  const left = TG_DAY[1] - da
  if (left > 1) return `🦃 ${left} days to the long weekend`
  if (left === 1) return '🦃 The long weekend starts tomorrow!'
  if (left === 0) return '🦃 Happy Thanksgiving!'
  return '🥧 Enjoy the long weekend!'
}
const GRAT_SEASON = 'thanksgiving-2026'
function TgTopBar() {
  const crumb = useAnchorRect('.topbar .crumb', 900)
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(null)
  const refresh = () => supabase.from('gratitude_leaves').select('id', { count: 'exact', head: true }).eq('season', GRAT_SEASON).then(({ count: c }) => setCount(c ?? 0))
  useEffect(() => { refresh() }, [])
  if (!crumb) return null
  const text = countdownText()
  return (
    <>
      <div style={{ position: 'fixed', left: crumb.right + 64, top: crumb.top + crumb.height / 2 - 15, zIndex: 2360, display: 'flex', gap: 8, alignItems: 'center' }}>
        {text && <span className="tg-pill tg-count-pill">{text}</span>}
        <button className="tg-pill" onClick={() => setOpen(true)} title="Add what you're thankful for">🌳 Gratitude tree{count ? ` · ${count}` : ''}</button>
      </div>
      {open && <GratitudeTree onClose={() => { setOpen(false); refresh() }} />}
    </>
  )
}
const LEAF_D = 'M20 3 L23.5 11 L30.5 8 L28.5 16 L37 17 L31 23 L34 28 L24.5 26 L22 33 L20 36 L18 33 L15.5 26 L6 28 L9 23 L3 17 L11.5 16 L9.5 8 L16.5 11 Z'
const hashNum = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h) }
function GratitudeTree({ onClose }) {
  const { user, isAdmin } = useAuth()
  const [leaves, setLeaves] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const [fresh, setFresh] = useState(null)
  const load = () => supabase.from('gratitude_leaves').select('id, message, created_at, profile_id, profiles(full_name)').eq('season', GRAT_SEASON).order('created_at', { ascending: true }).limit(400)
    .then(({ data, error }) => { if (error) setErr(error.message); setLeaves(data || []) })
  useEffect(() => { load() }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  async function add(e) {
    e.preventDefault()
    const m = text.trim(); if (!m) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('gratitude_leaves').insert({ message: m, season: GRAT_SEASON }).select('id, message, created_at, profile_id, profiles(full_name)').single()
    setBusy(false)
    if (error) { setErr(/row-level security/i.test(error.message) ? "You've added a lot of leaves today. Try again tomorrow!" : error.message); return }
    setLeaves(l => [...(l || []), data]); setText(''); setSel(data.id); setFresh(data.id)
    const r = document.getElementById('tg-tree-svg')?.getBoundingClientRect()
    if (r) celebrate(r.left + r.width / 2, r.top + r.height * .35)
  }
  async function remove(l) {
    setLeaves(ls => ls.filter(x => x.id !== l.id)); if (sel === l.id) setSel(null)
    const { error } = await supabase.from('gratitude_leaves').delete().eq('id', l.id)
    if (error) { setErr(error.message); load() }
  }
  const list = leaves || []
  const N = Math.max(36, list.length)
  const placed = list.map((l, i) => {
    const r = Math.sqrt((i + .6) / N), a = i * 2.39996 + 0.6
    const h = hashNum(l.id)
    return { l, x: 300 + Math.cos(a) * r * 200, y: 122 + Math.sin(a) * r * 92, rot: (h % 120) - 60, c: LEAF_COLORS[h % LEAF_COLORS.length], s: .62 + (h % 5) * .05 }
  })
  const selected = list.find(l => l.id === sel)
  const first = (l) => (l?.profiles?.full_name || 'Someone')
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 2600, background: 'rgba(28,16,6,.42)', display: 'grid', placeItems: 'center', padding: 14 }}>
      <div role="dialog" aria-label="Gratitude tree" style={{ width: 'min(760px, 100%)', maxHeight: '92vh', overflow: 'auto', background: 'linear-gradient(180deg, #FFF7ED 0%, var(--surface) 46%)', color: 'var(--ink)', borderRadius: 20, boxShadow: '0 30px 70px -20px rgba(0,0,0,.45)', padding: '18px 22px 20px', border: '1px solid #FED7AA' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 26 }}>🌳</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 20, color: '#9A3412' }}>Our Gratitude Tree</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Add a leaf for something you're thankful for. Everyone on the team can see the tree.</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: '4px 10px' }}>✕</button>
        </div>
        <svg id="tg-tree-svg" viewBox="0 0 600 320" style={{ width: '100%', maxHeight: 330, height: 'auto', display: 'block', marginTop: 6 }}>
          <defs>
            <radialGradient id="tgCanopy" cx="50%" cy="45%" r="60%"><stop offset="0%" stopColor="#FFEDD5" /><stop offset="100%" stopColor="#FED7AA" stopOpacity=".55" /></radialGradient>
            <linearGradient id="tgBark" x1="0" x2="1"><stop offset="0%" stopColor="#7A3E17" /><stop offset="55%" stopColor="#9A5426" /><stop offset="100%" stopColor="#6B3412" /></linearGradient>
          </defs>
          <ellipse cx="300" cy="306" rx="190" ry="11" fill="#FDE7CF" />
          {[[300, 124, 205, 96], [205, 150, 92, 62], [395, 150, 92, 62], [300, 74, 120, 58]].map(([cx, cy, rx, ry], i) => <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#tgCanopy)" />)}
          <path d="M280 308 C286 270 288 242 284 214 C268 198 244 186 214 180 L217 170 C246 175 270 186 287 199 C289 178 288 160 292 138 L300 136 L308 138 C312 160 311 178 313 199 C330 184 354 174 386 168 L389 178 C358 186 332 198 316 214 C312 242 314 270 320 308 Z" fill="url(#tgBark)" />
          <path d="M300 150 Q298 230 302 300" stroke="#B8683A" strokeWidth="3" fill="none" opacity=".5" strokeLinecap="round" />
          <path d="M292 140 Q268 112 236 100 M308 140 Q334 110 370 98 M300 136 L300 92" stroke="url(#tgBark)" strokeWidth="7" fill="none" strokeLinecap="round" />
          {list.length === 0 && [[210, 140], [300, 80], [390, 132], [250, 190], [352, 192]].map(([x, y], i) => (
            <path key={i} d={LEAF_D} transform={`translate(${x - 14} ${y - 14}) scale(.7)`} fill={LEAF_COLORS[i]} opacity=".22" />
          ))}
          {placed.map(({ l, x, y, rot, c, s: sc }) => (
            <g key={l.id} className={'tg-tree-leaf' + (sel === l.id ? ' on' : '')} onClick={() => setSel(l.id)}
              style={fresh === l.id ? { animation: 'tgLeafIn .9s cubic-bezier(.3,.7,.4,1)' } : undefined}>
              <title>{`${first(l)}: ${l.message}`}</title>
              <path d={LEAF_D} transform={`translate(${x} ${y}) rotate(${rot}) scale(${sc}) translate(-20 -20)`} fill={c} stroke={sel === l.id ? '#7C2D12' : c} strokeWidth="2.4" strokeLinejoin="round" />
            </g>
          ))}
        </svg>
        <div style={{ minHeight: 46, margin: '2px 0 10px', padding: '10px 14px', borderRadius: 12, background: selected ? '#FFF7ED' : 'transparent', border: selected ? '1px solid #FED7AA' : '1px dashed var(--line)', fontSize: 14 }}>
          {selected ? <span><b style={{ color: '#9A3412' }}>{first(selected)}</b> is thankful for: {selected.message}</span>
            : <span style={{ color: 'var(--ink-soft)' }}>{leaves === null ? 'Loading the tree…' : list.length ? 'Tap a leaf to read it.' : 'No leaves yet. Be the first to add one!'}</span>}
        </div>
        <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input value={text} onChange={e => setText(e.target.value)} maxLength={140} placeholder="I'm thankful for…" aria-label="I'm thankful for"
            style={{ flex: 1, border: '1px solid #FDBA74', borderRadius: 12, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }} />
          <button className="btn btn-primary" disabled={busy || !text.trim()} style={{ background: '#EA580C', borderColor: '#EA580C', whiteSpace: 'nowrap' }}>{busy ? 'Adding…' : 'Add my leaf 🍂'}</button>
        </form>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4, textAlign: 'right' }}>{text.length}/140</div>
        {err && <div className="login-err" style={{ marginTop: 6 }}>{err}</div>}
        {list.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#9A3412', marginBottom: 6 }}>All leaves ({list.length})</div>
            <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflow: 'auto', paddingRight: 4 }}>
              {list.slice().reverse().map(l => (
                <div key={l.id} onClick={() => setSel(l.id)} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', borderRadius: 10, cursor: 'pointer', background: sel === l.id ? '#FFF7ED' : 'var(--canvas)', border: '1px solid ' + (sel === l.id ? '#FED7AA' : 'var(--line)'), fontSize: 13.5 }}>
                  <span style={{ flex: 'none', marginTop: 1 }}><Leaf size={16} color={LEAF_COLORS[hashNum(l.id) % LEAF_COLORS.length]} /></span>
                  <span style={{ flex: 1 }}><b>{first(l)}</b> · {l.message}</span>
                  {(l.profile_id === user?.id || isAdmin) && <button onClick={(e) => { e.stopPropagation(); remove(l) }} title="Remove this leaf" aria-label="Remove this leaf"
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: '0 4px' }}>✕</button>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// for the profile header corner
export function SeasonHeaderDecor() {
  if (!seasonalHat()) return null
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
      window.dispatchEvent(new Event('cc:seasonal-state'))
      if (enabled) {
        const key = `cc.season.greet.${season.key}.${new Date().toDateString()}`
        try { if (!localStorage.getItem(key)) setGreet({ text: season.greeting((data?.full_name || '').split(' ')[0]), key }) } catch { /* ignore */ }
      }
    })
    read()
    window.addEventListener('cc:seasonal-changed', read)
    return () => { alive = false; window.removeEventListener('cc:seasonal-changed', read); document.body.classList.remove('cc-halloween'); document.body.classList.remove('cc-thanksgiving') }
  }, [user?.id, season?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Intentional edge moments (no more floaters through the middle of the screen):
  //  • a little flock of bats flutters along just under the top bar (every ~45–80s)
  //  • a ghost pops up behind the pumpkin patch and waves (every ~1.5–2.5 min)
  // Thanksgiving: a gentle flurry of falling leaves, a turkey waddling along the bottom, and one popping up by the harvest.
  useEffect(() => {
    if (!on || !season || still || season.key !== 'thanksgiving') return
    let t1, t2, t3
    const flurry = () => {
      if (document.visibilityState === 'visible') {
        const id = ++idRef.current
        const leaves = Array.from({ length: 9 }, (_, i) => ({ i, left: `${4 + Math.random() * 90}vw`, c: LEAF_COLORS[i % LEAF_COLORS.length], size: 18 + Math.round(Math.random() * 14),
          drift: `${Math.round((Math.random() - .5) * 160)}px`, spin: `${Math.round(180 + Math.random() * 360) * (Math.random() < .5 ? -1 : 1)}deg`, dur: 9 + Math.random() * 5, delay: Math.random() * 4 }))
        setFloaters(f => [...f, { id, kind: 'leaves', leaves }])
        setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 19000)
      }
      t1 = setTimeout(flurry, 28000 + Math.random() * 22000)
    }
    const walk = () => {
      if (document.visibilityState === 'visible') { const id = ++idRef.current; setFloaters(f => [...f, { id, kind: 'walk', dur: 16 + Math.random() * 5 }]) }
      t2 = setTimeout(walk, 70000 + Math.random() * 50000)
    }
    const rise = () => {
      if (document.visibilityState === 'visible') { const id = ++idRef.current; setFloaters(f => [...f, { id, kind: 'rise' }]); setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 5200) }
      t3 = setTimeout(rise, 90000 + Math.random() * 60000)
    }
    t1 = setTimeout(flurry, 4000); t2 = setTimeout(walk, 25000); t3 = setTimeout(rise, 45000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const set = season.key === 'thanksgiving' ? CONFETTI_TG : CONFETTI
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

  if (season.key === 'thanksgiving') return (
    <>
      <style>{CSS}</style>
      <CornerBranch />
      <TopLeaves />
      <HarvestPatch />
      <style>{TG_COZY_CSS}</style>
      <HarvestBasket />
      <TgTopBar />
      <div className="cc-season-layer" aria-hidden="true">
        {floaters.map(f => f.kind === 'leaves' ? (
          <React.Fragment key={f.id}>
            {f.leaves.map(l => (
              <div key={l.i} style={{ position: 'absolute', top: 0, left: l.left, '--drift': l.drift, '--spin': l.spin, animation: `ccFall ${l.dur}s linear ${l.delay}s both` }}>
                <div style={{ animation: `ccSway ${2.4 + l.i % 3 * .5}s ease-in-out infinite` }}><Leaf size={l.size} color={l.c} /></div>
              </div>
            ))}
          </React.Fragment>
        ) : f.kind === 'walk' ? (
          <div key={f.id} style={{ position: 'absolute', bottom: 2, left: 0, animation: `ccWalk ${f.dur}s linear forwards` }}
            onAnimationEnd={(e) => { if (e.target === e.currentTarget) setFloaters(x => x.filter(y => y.id !== f.id)) }}>
            <div style={{ animation: 'ccWaddle .6s ease-in-out infinite' }}><Turkey size={58} sway={false} /></div>
          </div>
        ) : (
          <div key={f.id} style={{ position: 'fixed', right: 210, bottom: 26, overflow: 'hidden', width: 92, height: 92, zIndex: 2299 }}>
            <div style={{ animation: 'ccRise 5s ease-in-out forwards' }}><Turkey size={80} /></div>
          </div>
        ))}
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
      {greet && (
        <div role="status" style={{ position: 'fixed', top: 68, left: '50%', transform: 'translateX(-50%)', zIndex: 2500, animation: 'ccGreetIn .45s ease',
          background: 'linear-gradient(120deg, #FFF7ED 0%, #FFEDD5 55%, #FEF3C7 100%)', border: '1.5px solid #FED7AA', borderRadius: 999, padding: '6px 10px 6px 8px',
          boxShadow: '0 14px 34px -14px rgba(194,65,12,.5)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, color: '#9A3412' }}>
          <Turkey size={34} sway={false} /><span>{greet.text}</span><Leaf size={22} color={CRAN} />
          <button onClick={closeGreet} aria-label="Close" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: RUST, fontSize: 14, padding: '2px 6px', marginLeft: 2 }}>✕</button>
        </div>
      )}
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
