import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// SEASONAL DECORATIONS (2026-10-27, Brittney) — cute, never scary.
// Turns itself on/off by date. Each person can switch it off in Settings
// (profiles.seasonal_effects). "Reduce motion" gets the still parts only.
// Purely decorative: pointer-events: none everywhere, nothing touches data.
// Halloween = kawaii hand-drawn characters (ghost, bats, candy, pumpkins, kitty).
// Add a holiday = add an entry to SEASONS (month/day, inclusive).
// ============================================================

export const SEASONS = [
  { key: 'halloween', from: [10, 27], to: [10, 31],
    greeting: (first) => `Happy Halloween week${first ? `, ${first}` : ''}!`,
    hat: 'witch' },
]

let _off = false
export function activeSeason(d = new Date()) {
  const md = (d.getMonth() + 1) * 100 + d.getDate()
  return SEASONS.find(s => md >= s.from[0] * 100 + s.from[1] && md <= s.to[0] * 100 + s.to[1]) || null
}
export function seasonalHat() { if (_off) return null; return activeSeason()?.hat || null }
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
.cc-blink { transform-box: fill-box; transform-origin: center; animation: ccBlink 4.5s infinite; }
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
    <svg width="104" height="110" viewBox="0 0 104 110" aria-hidden="true" style={{ position: 'fixed', top: 0, right: 0, opacity: .7, pointerEvents: 'none', zIndex: 2300, overflow: 'visible' }}>
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

// Little pumpkin patch with a kitty, bottom corner (left of the phone button).
function PumpkinPatch() {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', right: 92, bottom: -4, zIndex: 2300, pointerEvents: 'none', display: 'flex', alignItems: 'flex-end', gap: 0, opacity: .96 }}>
      <div style={{ marginRight: -10, transform: 'rotate(-6deg)' }}><Pumpkin size={44} /></div>
      <div style={{ zIndex: 1 }}><Kitty size={58} /></div>
      <div style={{ marginLeft: -8 }}><Pumpkin size={36} /></div>
      <div style={{ position: 'absolute', left: 30, top: -10 }}><Sparkle size={11} delay={.2} /></div>
      <div style={{ position: 'absolute', right: 6, top: 2 }}><Sparkle size={9} color="#F9A8D4" delay={.9} /></div>
    </div>
  )
}

// for the profile header corner
export function SeasonHeaderDecor() {
  if (!seasonalHat()) return null
  return (
    <div aria-hidden="true" style={{ position: 'absolute', right: 14, top: 4, display: 'flex', alignItems: 'center', gap: 2, pointerEvents: 'none' }}>
      <Bat size={30} delay={.1} /><Ghost size={26} /><Pumpkin size={26} /><Sparkle size={10} delay={.4} />
    </div>
  )
}

// ---------- the layer ----------
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
      if (enabled) {
        const key = `cc.season.greet.${season.key}.${new Date().toDateString()}`
        try { if (!localStorage.getItem(key)) setGreet({ text: season.greeting((data?.full_name || '').split(' ')[0]), key }) } catch { /* ignore */ }
      }
    })
    read()
    window.addEventListener('cc:seasonal-changed', read)
    return () => { alive = false; window.removeEventListener('cc:seasonal-changed', read) }
  }, [user?.id, season?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // floating friends: a ghost, a little flock of bats, or a candy — every 25–45s
  useEffect(() => {
    if (!on || !season || still) return
    let t, n = 0
    const kinds = ['ghost', 'bats', 'ghost', 'candy', 'bats', 'ghost']
    const spawn = () => {
      if (document.visibilityState === 'visible') {
        const id = ++idRef.current
        setFloaters(f => [...f, { id, kind: kinds[n++ % kinds.length], top: `${10 + Math.random() * 62}vh`, dur: 16 + Math.random() * 8 }])
      }
      t = setTimeout(spawn, 25000 + Math.random() * 20000)
    }
    t = setTimeout(spawn, 3000)
    return () => clearTimeout(t)
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
      const bits = Array.from({ length: 16 }, (_, i) => ({ k: i, C: CONFETTI[i % CONFETTI.length],
        dx: `${Math.round((Math.random() - .5) * 280)}px`, dy: `${Math.round(-70 - Math.random() * 190)}px`, rot: `${Math.round((Math.random() - .5) * 540)}deg`, d: 1 + Math.random() * .6 }))
      setBursts(b => [...b, { id, x, y, bits }])
      setTimeout(() => setBursts(b => b.filter(z => z.id !== id)), 1800)
    }
    window.addEventListener('cc:celebrate', fire)
    return () => window.removeEventListener('cc:celebrate', fire)
  }, [on, season?.key, still]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!season || !on) return null
  const closeGreet = () => { try { localStorage.setItem(greet.key, '1') } catch { /* ignore */ } setGreet(null) }

  return (
    <>
      <style>{CSS}</style>
      <CornerWeb />
      <PumpkinPatch />
      <div className="cc-season-layer" aria-hidden="true">
        {floaters.map(f => (
          <div key={f.id} style={{ position: 'absolute', top: f.top, left: 0, animation: `ccAcross ${f.dur}s linear forwards` }}
            onAnimationEnd={() => setFloaters(x => x.filter(y => y.id !== f.id))}>
            <div style={{ animation: 'ccBob 2.8s ease-in-out infinite' }}>
              {f.kind === 'ghost' && <Ghost size={58} />}
              {f.kind === 'candy' && <Candy size={40} />}
              {f.kind === 'bats' && <div style={{ position: 'relative', width: 120, height: 70 }}>
                <div style={{ position: 'absolute', left: 0, top: 22 }}><Bat size={44} /></div>
                <div style={{ position: 'absolute', left: 46, top: 0 }}><Bat size={34} delay={.12} /></div>
                <div style={{ position: 'absolute', left: 74, top: 30 }}><Bat size={28} delay={.24} /></div>
              </div>}
            </div>
          </div>
        ))}
        {peek && (
          <div key={peek.id} style={{ position: 'absolute', right: 0, top: peek.top, animation: 'ccPeek 4.5s ease-in-out forwards', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ background: '#fff', border: `1.5px solid ${LAV}`, borderRadius: 14, padding: '5px 11px', fontWeight: 800, color: PURPLE, fontSize: 14, boxShadow: '0 6px 16px -8px rgba(124,58,237,.5)' }}>Boo! 💜</div>
            <div style={{ marginRight: -14 }}><Ghost size={64} /></div>
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
  const w = Math.max(12, Math.round(size * 0.72))
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
